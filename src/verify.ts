// Full verification (Node): enclave attestation + every signature + DILIGENCE.md integrity.
import { readFileSync } from "node:fs";
import { sessionNonce, verifyModelAttestation, type ModelAttestation } from "./attest.ts";
import { sealInputOf, verifySignatures, type Receipt, type VerifyLine } from "./receipt.ts";
import { renderDiligence } from "./render.ts";
import { fileRequest, readmeRequest, reviewOf } from "./pack.ts";
import { findReadme, readAt, trackedFiles } from "./repo.ts";
import { sha256Hex } from "./sig.ts";

export async function verifyReceipt(r: Receipt, diligenceMd?: string, opts: { skipGpu?: boolean } = {}): Promise<VerifyLine[]> {
  const lines: VerifyLine[] = [];
  const nonce = sessionNonce({ commit: r.commit, packHash: r.pack_hash, requestId: r.request_id, salt: r.nonce.salt });
  lines.push({ name: "attestation nonce derives from this commit, question pack and request", ok: nonce === r.nonce.value });
  const att = await verifyModelAttestation(r.attestation as unknown as ModelAttestation, r.nonce.value, opts);
  lines.push({
    name: "enclave attestation (TDX quote, key + nonce binding, RTMR3, config, GPU)",
    ok: att.ok,
    detail: att.checks.filter((c) => !c.ok).map((c) => c.name).join(", ") || undefined,
  });
  lines.push({ name: "attested key is the receipt's enclave key", ok: att.signingAddress === r.enclave_key.toLowerCase() });
  lines.push(...(await verifySignatures(r)));
  if (diligenceMd !== undefined) {
    let rendered = "";
    try {
      rendered = renderDiligence(r);
    } catch (e) {
      rendered = `render failed: ${(e as Error).message}`;
    }
    lines.push({ name: "DILIGENCE.md matches the signed scorecard exactly", ok: rendered === diligenceMd });
  }
  return lines;
}

/**
 * Closing audit: with the source in hand, rebuild every per-file request byte for byte and compare
 * to the hashes the enclave signed. Proves which files were reviewed and that prompts were not altered.
 */
export function auditAgainstSource(r: Receipt, repo: string): VerifyLine[] {
  const lines: VerifyLine[] = [];
  const mismatched: string[] = [];
  for (const f of r.files) {
    const file = readAt(repo, r.commit, f.path);
    if (!file) {
      mismatched.push(`${f.path} (missing)`);
      continue;
    }
    const ok = file.sha256 === f.file_sha256 && sha256Hex(fileRequest(f.path, file.content, file.truncated)) === f.request_hash;
    if (!ok) mismatched.push(f.path);
  }
  lines.push({
    name: `${r.files.length} per-file requests rebuilt from source match the signed hashes`,
    ok: mismatched.length === 0,
    detail: mismatched.join(", ") || undefined,
  });
  const paths = trackedFiles(repo, r.commit);
  const declared = sealInputOf(r).tracked_files;
  lines.push({ name: "declared tracked-file count matches the commit", ok: declared === paths.length, detail: `${declared} vs ${paths.length}` });
  if (r.readme_check) {
    const readmePath = findReadme(paths);
    const readme = readmePath ? readAt(repo, r.commit, readmePath) : null;
    const reviews = r.files.map((f) => reviewOf(JSON.parse(f.response_body).choices?.[0]?.message?.content ?? ""));
    const purposes = r.files.map((f, i) => ({ path: f.path, purpose: String(reviews[i].purpose ?? "") }));
    const ok = !!readme && sha256Hex(readmeRequest(readme.content, purposes)) === r.readme_check.request_hash;
    lines.push({ name: "README check request rebuilt from source matches", ok });
  }
  return lines;
}

export function loadReceipt(path: string): Receipt {
  return JSON.parse(readFileSync(path, "utf8")) as Receipt;
}
