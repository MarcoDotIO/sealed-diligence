// The receipt an investor receives. Contains no source code: per-file requests appear only as hashes.
// Everything here is browser-safe so the web verifier runs the same checks as the CLI.
import { checkSignedCall, sha256Hex, type SignatureRecord } from "./sig.ts";
import { parseJsonReply, type Scorecard, type SealInput } from "./pack.ts";

export interface SignedEntry {
  chat_id: string;
  request_hash: string;
  response_body: string;
  signature: SignatureRecord;
}

export interface Receipt {
  protocol: "sealed-diligence/v1";
  model: string;
  request_id: string;
  repo_label: string;
  commit: string;
  pack_version: string;
  pack_hash: string;
  nonce: { salt: string; value: string };
  enclave_key: string;
  attestation: Record<string, unknown>;
  files: (SignedEntry & { path: string; file_sha256: string; truncated: boolean })[];
  readme_check: SignedEntry | null;
  seal: SignedEntry & { request_body: string };
  generated_at: string;
  founder_seal?: unknown;
}

export interface VerifyLine {
  name: string;
  ok: boolean;
  detail?: string;
}

const content = (responseBody: string) => JSON.parse(responseBody).choices?.[0]?.message?.content ?? "";

export function scorecardOf(r: Receipt): Scorecard {
  return parseJsonReply<Scorecard>(content(r.seal.response_body));
}

export function sealInputOf(r: Receipt): SealInput {
  const user = JSON.parse(r.seal.request_body).messages[1].content as string;
  return JSON.parse(user.slice(user.indexOf("{")));
}

/** All checks that need only the receipt (no network, no source). */
export async function verifySignatures(r: Receipt): Promise<VerifyLine[]> {
  const lines: VerifyLine[] = [];
  const add = (name: string, ok: boolean, detail?: string) => lines.push({ name, ok, detail });
  const sig = (e: SignedEntry) =>
    checkSignedCall({ model: r.model, requestHash: e.request_hash, responseBody: e.response_body, sig: e.signature, enclaveKey: r.enclave_key });

  // Seal: the request body is held in full, so its hash is recomputed here.
  const sealReqHash = sha256Hex(r.seal.request_body);
  add("seal request hash recomputed", sealReqHash === r.seal.request_hash);
  const sealSig = await sig(r.seal);
  add("seal signed by the attested enclave", sealSig.ok, sealSig.problems.join("; ") || undefined);
  add("seal used the declared model", JSON.parse(r.seal.request_body).model === r.model);

  // The seal input names this request, commit and question pack.
  let input: SealInput | null = null;
  try {
    input = sealInputOf(r);
  } catch (e) {
    add("seal input readable", false, (e as Error).message);
  }
  if (input) {
    add(
      "seal is bound to this request, commit and question pack",
      input.request_id === r.request_id && input.commit === r.commit && input.pack_hash === r.pack_hash,
    );
    // Every per-file review is signed and listed in the seal with matching hashes.
    const byPath = new Map(input.files.map((f) => [f.path, f]));
    let bad = 0;
    const problems: string[] = [];
    for (const f of r.files) {
      const s = await sig(f);
      const listed = byPath.get(f.path);
      const consistent =
        !!listed &&
        listed.request_hash === f.request_hash &&
        listed.response_hash === sha256Hex(f.response_body) &&
        listed.file_sha256 === f.file_sha256;
      if (!s.ok || !consistent) {
        bad++;
        problems.push(`${f.path}: ${[...s.problems, consistent ? "" : "not consistent with seal"].filter(Boolean).join(", ")}`);
      }
    }
    add(`${r.files.length} per-file reviews signed and listed in the seal`, bad === 0 && byPath.size === r.files.length, problems.join(" | ") || undefined);
    if (r.readme_check) {
      const s = await sig(r.readme_check);
      const listed =
        input.readme_check?.request_hash === r.readme_check.request_hash &&
        input.readme_check?.response_hash === sha256Hex(r.readme_check.response_body);
      add("README check signed and listed in the seal", s.ok && listed, s.problems.join("; ") || undefined);
    }
  }
  return lines;
}
