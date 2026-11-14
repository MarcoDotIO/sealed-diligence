/**
 * Node-side verification: the shared receipt checks with Node's quote and GPU verifiers, and the closing
 * audit that compares a receipt with the source once the investor is allowed to see it.
 * @module
 */
import { readFileSync } from "node:fs";
import { sha256Hex } from "../core/bytes.ts";
import type { Check } from "../core/checks.ts";
import { fileRequest, readmeRequest, reviewOf } from "../core/pack.ts";
import { type FileEntry, type Receipt, replyContent, sealInputOf } from "../core/receipt.ts";
import { verifyReceipt } from "../core/verify.ts";
import { GitSnapshot } from "./git.ts";
import { type NodeVerifierOptions, nodeVerifiers } from "./verifiers.ts";

/** Read and parse a `receipt.json`. */
export function loadReceipt(path: string): Receipt {
  return JSON.parse(readFileSync(path, "utf8")) as Receipt;
}

/** {@link verifyReceipt} with Node's verifiers (GPU attestation included unless skipped). */
export function verifyReceiptLocally(receipt: Receipt, diligenceMd: string | null, options: NodeVerifierOptions = {}): Promise<Check[]> {
  return verifyReceipt(receipt, diligenceMd, nodeVerifiers(options));
}

/**
 * The closing audit: with the source in hand, rebuild every signed request byte for byte. Proves which
 * files were reviewed, that they weren't swapped for cleaner ones, and that the prompts weren't altered.
 */
export function auditAgainstSource(receipt: Receipt, repo: string): Check[] {
  const snapshot = GitSnapshot.at(repo, receipt.commit);
  const mismatched = receipt.files.filter((f) => !fileMatchesSource(f, snapshot)).map((f) => f.path);
  const tracked = snapshot.paths().length;
  const declared = sealInputOf(receipt).tracked_files;
  const checks: Check[] = [
    {
      name: `${receipt.files.length} per-file requests rebuilt from source match the signed hashes`,
      ok: mismatched.length === 0,
      detail: mismatched.join(", ") || undefined,
    },
    { name: "Declared tracked-file count matches the commit", ok: declared === tracked, detail: `${declared} vs ${tracked}` },
  ];
  if (receipt.readme_check)
    checks.push({ name: "README check request rebuilt from source matches", ok: readmeMatchesSource(receipt, snapshot) });
  return checks;
}

function fileMatchesSource(entry: FileEntry, snapshot: GitSnapshot): boolean {
  const file = snapshot.read(entry.path);
  if (!file) return false;
  const rebuilt = fileRequest(entry.path, file.content, file.truncated);
  return file.sha256 === entry.file_sha256 && sha256Hex(rebuilt) === entry.request_hash;
}

function readmeMatchesSource(receipt: Receipt, snapshot: GitSnapshot): boolean {
  const readme = snapshot.readme();
  if (!readme || !receipt.readme_check) return false;
  const purposes = receipt.files.map((f) => ({ path: f.path, purpose: String(reviewOf(replyContent(f.response_body)).purpose ?? "") }));
  return sha256Hex(readmeRequest(readme.content, purposes)) === receipt.readme_check.request_hash;
}
