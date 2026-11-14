// The receipt an investor receives. It contains no source code: per-file requests appear only as hashes.
import type { Check } from "./evidence.ts";
import { PROTOCOL, parseJsonReply, type Scorecard, type SealInput } from "./pack.ts";
import { checkSignedCall, sha256Hex, type SignatureRecord } from "./sig.ts";

export interface SignedEntry {
  chat_id: string;
  request_hash: string;
  response_body: string;
  signature: SignatureRecord;
}

export interface FileEntry extends SignedEntry {
  path: string;
  file_sha256: string;
  truncated: boolean;
}

export interface Receipt {
  protocol: typeof PROTOCOL;
  model: string;
  request_id: string;
  repo_label: string;
  commit: string;
  pack_version: string;
  pack_hash: string;
  nonce: { salt: string; value: string };
  enclave_key: string;
  attestation: Record<string, unknown>;
  files: FileEntry[];
  readme_check: SignedEntry | null;
  seal: SignedEntry & { request_body: string };
  generated_at: string;
}

export const replyContent = (responseBody: string): string => JSON.parse(responseBody).choices?.[0]?.message?.content ?? "";

export const scorecardOf = (r: Receipt): Scorecard => parseJsonReply<Scorecard>(replyContent(r.seal.response_body));

export function sealInputOf(r: Receipt): SealInput {
  const user = JSON.parse(r.seal.request_body).messages[1].content as string;
  return JSON.parse(user.slice(user.indexOf("{")));
}

function signatureProblems(r: Receipt, e: SignedEntry): Promise<string[]> {
  return checkSignedCall({
    model: r.model,
    requestHash: e.request_hash,
    responseBody: e.response_body,
    sig: e.signature,
    enclaveKey: r.enclave_key,
  }).then((c) => c.problems);
}

async function sealChecks(r: Receipt): Promise<Check[]> {
  const problems = await signatureProblems(r, r.seal);
  return [
    { name: "Seal request hash recomputed", ok: sha256Hex(r.seal.request_body) === r.seal.request_hash },
    { name: "Seal signed by the enclave key", ok: problems.length === 0, detail: problems.join("; ") || undefined },
    { name: "Seal used the declared model", ok: JSON.parse(r.seal.request_body).model === r.model },
  ];
}

async function fileReviewCheck(r: Receipt, input: SealInput): Promise<Check> {
  const listedByPath = new Map(input.files.map((f) => [f.path, f]));
  const problems: string[] = [];
  for (const f of r.files) {
    const listed = listedByPath.get(f.path);
    const consistent =
      listed?.request_hash === f.request_hash &&
      listed.response_hash === sha256Hex(f.response_body) &&
      listed.file_sha256 === f.file_sha256;
    const issues = [...(await signatureProblems(r, f)), ...(consistent ? [] : ["not consistent with the seal"])];
    if (issues.length) problems.push(`${f.path}: ${issues.join(", ")}`);
  }
  return {
    name: `${r.files.length} per-file reviews signed and listed in the seal`,
    ok: problems.length === 0 && listedByPath.size === r.files.length,
    detail: problems.join(" | ") || undefined,
  };
}

async function readmeCheck(r: Receipt, readme: SignedEntry, input: SealInput): Promise<Check> {
  const problems = await signatureProblems(r, readme);
  const listed =
    input.readme_check?.request_hash === readme.request_hash && input.readme_check.response_hash === sha256Hex(readme.response_body);
  return { name: "README check signed and listed in the seal", ok: problems.length === 0 && listed, detail: problems.join("; ") || undefined };
}

/** Checks that need only the receipt: no network, no source. */
export async function verifySignatures(r: Receipt): Promise<Check[]> {
  const checks = await sealChecks(r);
  let input: SealInput;
  try {
    input = sealInputOf(r);
  } catch (e) {
    return [...checks, { name: "Seal input readable", ok: false, detail: (e as Error).message }];
  }
  checks.push({
    name: "Seal is bound to this request, commit and question pack",
    ok: input.request_id === r.request_id && input.commit === r.commit && input.pack_hash === r.pack_hash,
  });
  checks.push(await fileReviewCheck(r, input));
  if (r.readme_check) checks.push(await readmeCheck(r, r.readme_check, input));
  return checks;
}
