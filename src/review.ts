// Run a sealed diligence review of a repository at one commit.
import { randomBytes } from "node:crypto";
import { fetchModelAttestations, sessionNonce, verifyModelAttestation } from "./attest.ts";
import { signedCompletion, type SignedCall } from "./nearai.ts";
import {
  MODEL,
  PACK_HASH,
  PACK_VERSION,
  PROTOCOL,
  fileRequest,
  parseJsonReplyOr,
  readmeRequest,
  reviewOf,
  sealRequest,
  type FileReview,
  type SealInput,
} from "./pack.ts";
import { findReadme, isReviewable, readAt, resolveCommit, trackedFiles, type RepoFile } from "./repo.ts";
import type { Receipt, SignedEntry } from "./receipt.ts";
import { checkSignedCall, sha256Hex } from "./sig.ts";

export const DEFAULT_MAX_FILES = 60;
const DEFAULT_CONCURRENCY = 4;
const SALT_BYTES = 16;
const SHORT_HASH = 12;

export interface EnclaveClient {
  attest(nonce: string): Promise<{ enclaveKey: string; attestation: Record<string, unknown> }>;
  complete(requestBody: string): Promise<SignedCall>;
}

export interface ReviewOptions {
  repo: string;
  ref?: string;
  requestId: string;
  repoLabel: string;
  enclave: EnclaveClient;
  maxFiles?: number;
  concurrency?: number;
  log?: (msg: string) => void;
}

type Log = (msg: string) => void;

/** The real enclave: NEAR AI Cloud, attested (TDX + GPU) before any code is sent. */
export function nearAiEnclave(apiKey: string, log: Log = () => {}): EnclaveClient {
  return {
    async attest(nonce) {
      const candidates = await fetchModelAttestations(MODEL, nonce, apiKey);
      const results = await Promise.all(candidates.map((a) => verifyModelAttestation(a, nonce)));
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const names = failed.checks.filter((c) => c.ok === false).map((c) => c.name);
        throw new Error(`enclave attestation failed: ${names.join(", ")}`);
      }
      const keys = new Set(results.map((r) => r.signingAddress));
      if (keys.size !== 1) throw new Error("attestation candidates disagree on the signing key");
      const [enclaveKey] = keys;
      log(`enclave attested (TDX + GPU), signing key ${enclaveKey.slice(0, 16)}…`);
      const attestation = candidates.find((a) => a.signing_address.toLowerCase() === enclaveKey);
      return { enclaveKey, attestation: attestation as unknown as Record<string, unknown> };
    },
    complete: (body) => signedCompletion(apiKey, body),
  };
}

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

const entryOf = (c: SignedCall): SignedEntry => ({
  chat_id: c.chatId,
  request_hash: c.requestHash,
  response_body: c.responseBody,
  signature: c.sig,
});

/** Every call is checked as it returns, so a bad signature stops the run instead of reaching the receipt. */
class Session {
  constructor(
    private readonly enclave: EnclaveClient,
    private readonly enclaveKey: string,
  ) {}

  async call(requestBody: string, label: string): Promise<SignedCall> {
    const call = await this.enclave.complete(requestBody);
    const result = await checkSignedCall({
      model: MODEL,
      requestHash: call.requestHash,
      responseBody: call.responseBody,
      sig: call.sig,
      enclaveKey: this.enclaveKey,
    });
    if (!result.ok) throw new Error(`${label}: ${result.problems.join("; ")}`);
    return call;
  }
}

interface FileResult {
  file: RepoFile;
  call: SignedCall;
  review: FileReview;
}

async function reviewFiles(session: Session, files: RepoFile[], o: ReviewOptions, log: Log): Promise<FileResult[]> {
  let done = 0;
  return mapConcurrently(files, o.concurrency ?? DEFAULT_CONCURRENCY, async (file) => {
    const call = await session.call(fileRequest(file.path, file.content, file.truncated), file.path);
    log(`  [${++done}/${files.length}] ${file.path}`);
    return { file, call, review: reviewOf(call.content) };
  });
}

async function checkReadme(session: Session, readme: RepoFile | null, results: FileResult[]): Promise<SignedCall | null> {
  if (!readme) return null;
  const purposes = results.map((r) => ({ path: r.file.path, purpose: String(r.review.purpose ?? "") }));
  return session.call(readmeRequest(readme.content, purposes), "README check");
}

function sealInput(o: ReviewOptions, commit: string, trackedCount: number, results: FileResult[], readme: SignedCall | null): SealInput {
  return {
    protocol: PROTOCOL,
    request_id: o.requestId,
    commit,
    pack_version: PACK_VERSION,
    pack_hash: PACK_HASH,
    repo_label: o.repoLabel,
    tracked_files: trackedCount,
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

export async function runReview(o: ReviewOptions): Promise<Receipt> {
  const log = o.log ?? (() => {});
  const commit = resolveCommit(o.repo, o.ref);
  const paths = trackedFiles(o.repo, commit);
  const files = paths
    .filter(isReviewable)
    .slice(0, o.maxFiles ?? DEFAULT_MAX_FILES)
    .map((p) => readAt(o.repo, commit, p))
    .filter((f): f is RepoFile => f !== null);
  log(`commit ${commit.slice(0, SHORT_HASH)}: ${paths.length} tracked files, reviewing ${files.length}`);

  const salt = randomBytes(SALT_BYTES).toString("hex");
  const nonce = sessionNonce({ commit, packHash: PACK_HASH, requestId: o.requestId, salt });
  const { enclaveKey, attestation } = await o.enclave.attest(nonce);
  const session = new Session(o.enclave, enclaveKey);

  const results = await reviewFiles(session, files, o, log);
  const readmePath = findReadme(paths);
  const readme = await checkReadme(session, readmePath ? readAt(o.repo, commit, readmePath) : null, results);
  const seal = await session.call(sealRequest(sealInput(o, commit, paths.length, results, readme)), "seal");
  log("  sealed");

  return {
    protocol: PROTOCOL,
    model: MODEL,
    request_id: o.requestId,
    repo_label: o.repoLabel,
    commit,
    pack_version: PACK_VERSION,
    pack_hash: PACK_HASH,
    nonce: { salt, value: nonce },
    enclave_key: enclaveKey,
    attestation,
    files: results.map(({ file, call }) => ({ path: file.path, file_sha256: file.sha256, truncated: file.truncated, ...entryOf(call) })),
    readme_check: readme && entryOf(readme),
    seal: { ...entryOf(seal), request_body: seal.requestBody },
    generated_at: new Date().toISOString(),
  };
}
