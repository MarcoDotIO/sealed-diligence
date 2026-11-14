/**
 * Runs a sealed review of a repository at one commit and returns the receipt. Node only.
 *
 * The order matters: the enclave is attested for this session's nonce before any code leaves the
 * machine; each file then goes in its own request; the README is checked against the per-file purposes;
 * and the seal aggregates every signed answer by hash. Every signature is checked as it arrives.
 * @module
 */
import { randomBytes } from "node:crypto";
import { sessionNonce } from "../core/attestation.ts";
import { sha256Hex } from "../core/bytes.ts";
import {
  type FileReview,
  fileRequest,
  MODEL,
  PACK_HASH,
  PACK_VERSION,
  PROTOCOL,
  parseJsonReplyOr,
  readmeRequest,
  reviewOf,
  type SealInput,
  sealRequest,
} from "../core/pack.ts";
import type { Receipt, SignedEntry } from "../core/receipt.ts";
import { type EnclaveClient, type Log, SignatureCheckingEnclave } from "./enclave.ts";
import { GitSnapshot, type RepoFile } from "./git.ts";
import type { EnclaveCall } from "./near-ai.ts";

/** Review at most this many files unless told otherwise. */
export const DEFAULT_MAX_FILES = 60;
const DEFAULT_CONCURRENCY = 4;
const SALT_BYTES = 16;
const SHORT_HASH = 12;

/** What to review, for whom, and through which enclave. */
export interface ReviewOptions {
  /** Path to a git repository. */
  repo: string;
  /** Branch, tag or commit; defaults to `HEAD`. */
  ref?: string;
  /** The escrow request (`<contract>#<n>`) this review fulfils, or any unique id. */
  requestId: string;
  /** The name shown in the report. */
  repoLabel: string;
  enclave: EnclaveClient;
  maxFiles?: number;
  /** How many file reviews run at once. */
  concurrency?: number;
  log?: Log;
}

/** One file with its signed review. */
interface FileResult {
  file: RepoFile;
  call: EnclaveCall;
  review: FileReview;
}

/** Review `options.repo` inside the enclave and return the receipt (which contains no source). */
export async function runReview(options: ReviewOptions): Promise<Receipt> {
  const log = options.log ?? (() => {});
  const snapshot = GitSnapshot.at(options.repo, options.ref);
  const { commit } = snapshot;
  const tracked = snapshot.paths().length;
  const files = snapshot.reviewableFiles(options.maxFiles ?? DEFAULT_MAX_FILES);
  log(`commit ${commit.slice(0, SHORT_HASH)}: ${tracked} tracked files, reviewing ${files.length}`);

  const salt = randomBytes(SALT_BYTES).toString("hex");
  const nonce = sessionNonce({ commit, packHash: PACK_HASH, requestId: options.requestId, salt });
  const { enclaveKey, attestation } = await options.enclave.attest(nonce);
  const enclave = new SignatureCheckingEnclave(options.enclave, enclaveKey);

  const results = await reviewFiles(enclave, files, options.concurrency ?? DEFAULT_CONCURRENCY, log);
  const readme = await checkReadme(enclave, snapshot.readme(), results);
  const input = sealInput({ requestId: options.requestId, repoLabel: options.repoLabel, commit, tracked, results, readme });
  const seal = await enclave.complete(sealRequest(input), "seal");
  log("  sealed");

  return {
    protocol: PROTOCOL,
    model: MODEL,
    request_id: options.requestId,
    repo_label: options.repoLabel,
    commit,
    pack_version: PACK_VERSION,
    pack_hash: PACK_HASH,
    nonce: { salt, value: nonce },
    enclave_key: enclaveKey,
    attestation,
    files: results.map(({ file, call }) => ({
      path: file.path,
      file_sha256: file.sha256,
      truncated: file.truncated,
      ...signedEntry(call),
    })),
    readme_check: readme && signedEntry(readme),
    seal: { ...signedEntry(seal), request_body: seal.requestBody },
    generated_at: new Date().toISOString(),
  };
}

async function reviewFiles(enclave: SignatureCheckingEnclave, files: RepoFile[], concurrency: number, log: Log): Promise<FileResult[]> {
  let done = 0;
  return mapConcurrently(files, concurrency, async (file) => {
    const call = await enclave.complete(fileRequest(file.path, file.content, file.truncated), file.path);
    log(`  [${++done}/${files.length}] ${file.path}`);
    return { file, call, review: reviewOf(call.content) };
  });
}

async function checkReadme(enclave: SignatureCheckingEnclave, readme: RepoFile | null, results: FileResult[]): Promise<EnclaveCall | null> {
  if (!readme) return null;
  const purposes = results.map((r) => ({ path: r.file.path, purpose: String(r.review.purpose ?? "") }));
  return enclave.complete(readmeRequest(readme.content, purposes), "README check");
}

interface SealParts {
  requestId: string;
  repoLabel: string;
  commit: string;
  tracked: number;
  results: FileResult[];
  readme: EnclaveCall | null;
}

/** The seal's input: every signed answer by hash, plus the findings, and no source. */
function sealInput(parts: SealParts): SealInput {
  const { results, readme } = parts;
  return {
    protocol: PROTOCOL,
    request_id: parts.requestId,
    commit: parts.commit,
    pack_version: PACK_VERSION,
    pack_hash: PACK_HASH,
    repo_label: parts.repoLabel,
    tracked_files: parts.tracked,
    reviewed_files: results.length,
    files: results.map(({ file, call, review }) => ({
      path: file.path,
      file_sha256: file.sha256,
      truncated: file.truncated,
      request_hash: call.requestHash,
      response_hash: sha256Hex(call.responseBody),
      review,
    })),
    readme_check: readme && {
      request_hash: readme.requestHash,
      response_hash: sha256Hex(readme.responseBody),
      result: parseJsonReplyOr<unknown>(readme.content, { error: "unparseable" }),
    },
  };
}

/** The receipt's record of a call: everything but the request body. */
function signedEntry(call: EnclaveCall): SignedEntry {
  return { chat_id: call.chatId, request_hash: call.requestHash, response_body: call.responseBody, signature: call.signature };
}

/** `Promise.all` over `items` with at most `limit` in flight; results keep the input order. */
async function mapConcurrently<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
