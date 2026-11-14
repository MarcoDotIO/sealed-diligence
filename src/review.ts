// Run a sealed diligence review of a repository at one commit.
import { randomBytes } from "node:crypto";
import { fetchModelAttestations, sessionNonce, verifyModelAttestation } from "./attest.ts";
import { signedCompletion, type SignedCall } from "./nearai.ts";
import { MODEL, PACK_HASH, PACK_VERSION, fileRequest, parseJsonReply, readmeRequest, reviewOf, sealRequest, type SealInput } from "./pack.ts";
import { findReadme, isReviewable, readAt, resolveCommit, trackedFiles, type RepoFile } from "./repo.ts";
import type { Receipt, SignedEntry } from "./receipt.ts";
import { checkSignedCall, sha256Hex } from "./sig.ts";

export interface ReviewOptions {
  repo: string;
  ref?: string;
  requestId: string;
  repoLabel: string;
  apiKey: string;
  maxFiles?: number;
  concurrency?: number;
  log?: (msg: string) => void;
  /** Injected in tests; defaults to the real NEAR AI Cloud client. */
  enclave?: EnclaveClient;
}

export interface EnclaveClient {
  attest(nonce: string): Promise<{ enclaveKey: string; attestation: Record<string, unknown> }>;
  complete(requestBody: string): Promise<SignedCall>;
}

export function nearAiEnclave(apiKey: string, log: (m: string) => void = () => {}): EnclaveClient {
  return {
    async attest(nonce) {
      const atts = await fetchModelAttestations(MODEL, nonce, apiKey);
      const results = await Promise.all(atts.map((a) => verifyModelAttestation(a, nonce)));
      const failed = results.find((r) => !r.ok);
      if (failed) throw new Error(`enclave attestation failed: ${failed.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`);
      const keys = new Set(results.map((r) => r.signingAddress));
      if (keys.size !== 1) throw new Error("attestation candidates disagree on the signing key");
      const enclaveKey = [...keys][0];
      log(`enclave attested (TDX + GPU), signing key ${enclaveKey.slice(0, 16)}…`);
      const attestation = atts.find((a) => a.signing_address.toLowerCase() === enclaveKey) as unknown as Record<string, unknown>;
      return { enclaveKey, attestation };
    },
    complete: (body) => signedCompletion(apiKey, body),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const entryOf = (c: SignedCall): SignedEntry => ({
  chat_id: c.chatId,
  request_hash: c.requestHash,
  response_body: c.responseBody,
  signature: c.sig,
});

export async function runReview(o: ReviewOptions): Promise<Receipt> {
  const log = o.log ?? (() => {});
  const commit = resolveCommit(o.repo, o.ref);
  const paths = trackedFiles(o.repo, commit);
  const candidates = paths.filter(isReviewable);
  const chosen = candidates.slice(0, o.maxFiles ?? 60);
  log(`commit ${commit.slice(0, 12)}: ${paths.length} tracked files, reviewing ${chosen.length}`);

  // 1. Attest the enclave before any code leaves this machine. The nonce commits to this session.
  const salt = randomBytes(16).toString("hex");
  const nonce = sessionNonce({ commit, packHash: PACK_HASH, requestId: o.requestId, salt });
  const enclave = o.enclave ?? nearAiEnclave(o.apiKey, log);
  const { enclaveKey, attestation } = await enclave.attest(nonce);

  const checked = async (c: SignedCall, what: string) => {
    const r = await checkSignedCall({ model: MODEL, requestHash: c.requestHash, responseBody: c.responseBody, sig: c.sig, enclaveKey });
    if (!r.ok) throw new Error(`${what}: ${r.problems.join("; ")}`);
    return c;
  };

  // 2. Per-file reviews.
  const files = chosen.map((p) => readAt(o.repo, commit, p)).filter((f): f is RepoFile => f !== null);
  let done = 0;
  const calls = await pool(files, o.concurrency ?? 4, async (f) => {
    const c = await checked(await enclave.complete(fileRequest(f.path, f.content, f.truncated)), f.path);
    log(`  [${++done}/${files.length}] ${f.path}`);
    return c;
  });
  const reviews = calls.map((c) => reviewOf(c.content));

  // 3. README claims vs code.
  const readmePath = findReadme(paths);
  let readmeCall: SignedCall | null = null;
  if (readmePath) {
    const readme = readAt(o.repo, commit, readmePath);
    if (readme) {
      const purposes = files.map((f, i) => ({ path: f.path, purpose: String(reviews[i].purpose ?? "") }));
      readmeCall = await checked(await enclave.complete(readmeRequest(readme.content, purposes)), "README check");
      log("  README claims checked");
    }
  }

  // 4. Seal.
  const input: SealInput = {
    protocol: "sealed-diligence/v1",
    request_id: o.requestId,
    commit,
    pack_version: PACK_VERSION,
    pack_hash: PACK_HASH,
    repo_label: o.repoLabel,
    tracked_files: paths.length,
    reviewed_files: files.length,
    files: files.map((f, i) => ({
      path: f.path,
      file_sha256: f.sha256,
      truncated: f.truncated,
      request_hash: calls[i].requestHash,
      response_hash: sha256Hex(calls[i].responseBody),
      review: reviews[i],
    })),
    readme_check: readmeCall
      ? { request_hash: readmeCall.requestHash, response_hash: sha256Hex(readmeCall.responseBody), result: safeParse(readmeCall.content) }
      : null,
  };
  const seal = await checked(await enclave.complete(sealRequest(input)), "seal");
  log("  sealed");

  return {
    protocol: "sealed-diligence/v1",
    model: MODEL,
    request_id: o.requestId,
    repo_label: o.repoLabel,
    commit,
    pack_version: PACK_VERSION,
    pack_hash: PACK_HASH,
    nonce: { salt, value: nonce },
    enclave_key: enclaveKey,
    attestation,
    files: files.map((f, i) => ({ path: f.path, file_sha256: f.sha256, truncated: f.truncated, ...entryOf(calls[i]) })),
    readme_check: readmeCall ? entryOf(readmeCall) : null,
    seal: { ...entryOf(seal), request_body: seal.requestBody },
    generated_at: new Date().toISOString(),
  };
}

function safeParse(s: string): unknown {
  try {
    return parseJsonReply(s);
  } catch {
    return { error: "unparseable" };
  }
}
