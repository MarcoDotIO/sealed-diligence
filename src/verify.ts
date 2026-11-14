// Node-side verification: the shared checks with Node's quote/GPU verifiers, plus the closing audit.
import { readFileSync } from "node:fs";
import { nodeVerifiers } from "./attest.ts";
import type { Check } from "./evidence.ts";
import { fileRequest, readmeRequest, reviewOf } from "./pack.ts";
import { replyContent, sealInputOf, type FileEntry, type Receipt } from "./receipt.ts";
import { findReadme, readAt, trackedFiles } from "./repo.ts";
import { sha256Hex } from "./sig.ts";
import { verifyReceipt } from "./verify-core.ts";

export function verifyReceiptLocally(receipt: Receipt, diligenceMd: string | null, opts: { skipGpu?: boolean } = {}): Promise<Check[]> {
  return verifyReceipt(receipt, diligenceMd, nodeVerifiers(opts));
}

function fileMatchesSource(entry: FileEntry, repo: string, commit: string): boolean {
  const file = readAt(repo, commit, entry.path);
  if (!file) return false;
  const rebuilt = fileRequest(entry.path, file.content, file.truncated);
  return file.sha256 === entry.file_sha256 && sha256Hex(rebuilt) === entry.request_hash;
}

function readmeMatchesSource(r: Receipt, repo: string, paths: string[]): boolean {
  const readmePath = findReadme(paths);
  const readme = readmePath ? readAt(repo, r.commit, readmePath) : null;
  if (!readme || !r.readme_check) return false;
  const purposes = r.files.map((f) => ({ path: f.path, purpose: String(reviewOf(replyContent(f.response_body)).purpose ?? "") }));
  return sha256Hex(readmeRequest(readme.content, purposes)) === r.readme_check.request_hash;
}

/**
 * Closing audit: with the source in hand, rebuild every signed request byte for byte.
 * Proves which files were reviewed and that the prompts were not altered.
 */
export function auditAgainstSource(r: Receipt, repo: string): Check[] {
  const mismatched = r.files.filter((f) => !fileMatchesSource(f, repo, r.commit)).map((f) => f.path);
  const paths = trackedFiles(repo, r.commit);
  const declared = sealInputOf(r).tracked_files;
  const checks: Check[] = [
    {
      name: `${r.files.length} per-file requests rebuilt from source match the signed hashes`,
      ok: mismatched.length === 0,
      detail: mismatched.join(", ") || undefined,
    },
    { name: "Declared tracked-file count matches the commit", ok: declared === paths.length, detail: `${declared} vs ${paths.length}` },
  ];
  if (r.readme_check) checks.push({ name: "README check request rebuilt from source matches", ok: readmeMatchesSource(r, repo, paths) });
  return checks;
}

export const loadReceipt = (path: string): Receipt => JSON.parse(readFileSync(path, "utf8")) as Receipt;
