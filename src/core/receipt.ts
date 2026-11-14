/**
 * The receipt the investor receives, and the checks that need nothing but the receipt. Browser-safe.
 *
 * A receipt contains no source code: per-file requests appear only as hashes, and the answers were
 * written under a prompt that forbids quoting code. What it does contain is every signed answer, the
 * attestation that vouches for the signing key, and the full seal request (hashes and findings only).
 * @module
 */
import { sha256Hex } from "./bytes.ts";
import { type Check, checkFromProblems } from "./checks.ts";
import { type PROTOCOL, parseJsonReply, type Scorecard, type SealInput } from "./pack.ts";
import { type SignatureRecord, signatureProblems } from "./signatures.ts";

/** One signed call. The request body is withheld; its hash is what the signature covers. */
export interface SignedEntry {
  chat_id: string;
  request_hash: string;
  /** The exact response bytes as received from NEAR AI. */
  response_body: string;
  signature: SignatureRecord;
}

/** A per-file review. */
export interface FileEntry extends SignedEntry {
  path: string;
  /** SHA-256 of the file's full contents at the commit. */
  file_sha256: string;
  /** True when only the first part of a large file was sent. */
  truncated: boolean;
}

/** The seal, whose request is safe to share and is included in full. */
export interface SealEntry extends SignedEntry {
  request_body: string;
}

/** The complete record of one sealed review (`receipt.json`). */
export interface Receipt {
  protocol: typeof PROTOCOL;
  model: string;
  /** Escrow request (`<contract>#<n>`) or a random id for a review not tied to an escrow. */
  request_id: string;
  repo_label: string;
  commit: string;
  pack_version: string;
  pack_hash: string;
  nonce: { salt: string; value: string };
  /** The attested enclave signing key, hex. */
  enclave_key: string;
  /** The model attestation the key was verified against, as NEAR AI returned it. */
  attestation: Record<string, unknown>;
  files: FileEntry[];
  readme_check: SignedEntry | null;
  seal: SealEntry;
  generated_at: string;
}

/** The assistant message inside a raw chat-completion response body. */
export function replyContent(responseBody: string): string {
  return JSON.parse(responseBody).choices?.[0]?.message?.content ?? "";
}

/** The scorecard the seal returned. */
export function scorecardOf(receipt: Receipt): Scorecard {
  return parseJsonReply<Scorecard>(replyContent(receipt.seal.response_body));
}

/** The seal input, read back out of the seal's request body (the user message after its label). */
export function sealInputOf(receipt: Receipt): SealInput {
  const user = JSON.parse(receipt.seal.request_body).messages[1].content as string;
  return JSON.parse(user.slice(user.indexOf("{")));
}

/** Problems with one signed entry, judged against the receipt's model and enclave key. */
function entryProblems(receipt: Receipt, entry: SignedEntry): Promise<string[]> {
  return signatureProblems({
    model: receipt.model,
    requestHash: entry.request_hash,
    responseBody: entry.response_body,
    signature: entry.signature,
    enclaveKey: receipt.enclave_key,
  });
}

/**
 * Every check that needs only the receipt: no network, no source. Covers the seal's signature and
 * request, its binding to this request/commit/pack, and that every per-file review and the README check
 * are both signed and listed in the seal, so none can be swapped or dropped.
 */
export async function verifySignatures(receipt: Receipt): Promise<Check[]> {
  const checks = await sealChecks(receipt);
  let input: SealInput;
  try {
    input = sealInputOf(receipt);
  } catch (error) {
    return [...checks, { name: "Seal input readable", ok: false, detail: (error as Error).message }];
  }
  checks.push({
    name: "Seal is bound to this request, commit and question pack",
    ok: input.request_id === receipt.request_id && input.commit === receipt.commit && input.pack_hash === receipt.pack_hash,
  });
  checks.push(await fileReviewsCheck(receipt, input));
  if (receipt.readme_check) checks.push(await readmeCheck(receipt, receipt.readme_check, input));
  return checks;
}

async function sealChecks(receipt: Receipt): Promise<Check[]> {
  const { seal } = receipt;
  return [
    { name: "Seal request hash recomputed", ok: sha256Hex(seal.request_body) === seal.request_hash },
    checkFromProblems("Seal signed by the enclave key", await entryProblems(receipt, seal)),
    { name: "Seal used the declared model", ok: JSON.parse(seal.request_body).model === receipt.model },
  ];
}

async function fileReviewsCheck(receipt: Receipt, input: SealInput): Promise<Check> {
  const listedByPath = new Map(input.files.map((f) => [f.path, f]));
  const problems: string[] = [];
  for (const file of receipt.files) {
    const listed = listedByPath.get(file.path);
    const consistent =
      listed?.request_hash === file.request_hash &&
      listed.response_hash === sha256Hex(file.response_body) &&
      listed.file_sha256 === file.file_sha256;
    const issues = [...(await entryProblems(receipt, file)), ...(consistent ? [] : ["not consistent with the seal"])];
    if (issues.length) problems.push(`${file.path}: ${issues.join(", ")}`);
  }
  const check = checkFromProblems(`${receipt.files.length} per-file reviews signed and listed in the seal`, problems, " | ");
  return { ...check, ok: check.ok && listedByPath.size === receipt.files.length };
}

async function readmeCheck(receipt: Receipt, readme: SignedEntry, input: SealInput): Promise<Check> {
  const listed = input.readme_check;
  const consistent = listed?.request_hash === readme.request_hash && listed.response_hash === sha256Hex(readme.response_body);
  const check = checkFromProblems("README check signed and listed in the seal", await entryProblems(receipt, readme));
  return { ...check, ok: check.ok && consistent };
}
