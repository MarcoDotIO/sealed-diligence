/**
 * The enclave port the review talks to, its NEAR AI adapter, and a decorator that checks every signature
 * as calls return.
 *
 * {@link EnclaveClient} is the seam between the review and the outside world (Ports and Adapters):
 * production uses {@link NearAiEnclave}; the tests use a local ed25519 key that signs the same payload.
 * @module
 */
import { MODEL } from "../core/pack.ts";
import { signatureProblems } from "../core/signatures.ts";
import type { EnclaveCall } from "./near-ai.ts";
import { NearAiCloud } from "./near-ai.ts";
import { verifyModelAttestation } from "./verifiers.ts";

/** An attested enclave: the key its answers are signed with, and the evidence for it. */
export interface AttestedEnclave {
  enclaveKey: string;
  attestation: Record<string, unknown>;
}

/** What a review needs from an enclave. */
export interface EnclaveClient {
  /** Prove the enclave is genuine for this session's `nonce` and return its signing key. */
  attest(nonce: string): Promise<AttestedEnclave>;
  /** Run one completion and return it with its enclave signature. */
  complete(requestBody: string): Promise<EnclaveCall>;
}

/** A progress callback for the CLI. */
export type Log = (message: string) => void;

const KEY_PREVIEW = 16;

/**
 * NEAR AI Cloud as an {@link EnclaveClient}. `attest` verifies every attestation candidate in full
 * (TDX quote, key and nonce binding, RTMR3, app config, GPU) and refuses to continue unless all pass
 * and agree on one signing key. Nothing is sent for review before that.
 */
export class NearAiEnclave implements EnclaveClient {
  private readonly cloud: NearAiCloud;

  constructor(
    apiKey: string,
    private readonly log: Log = () => {},
  ) {
    this.cloud = new NearAiCloud(apiKey);
  }

  async attest(nonce: string): Promise<AttestedEnclave> {
    const candidates = await this.cloud.attestationReport(MODEL, nonce);
    const results = await Promise.all(candidates.map((a) => verifyModelAttestation(a, nonce)));
    const failed = results.find((r) => !r.ok);
    if (failed) {
      const names = failed.checks.filter((c) => c.ok === false).map((c) => c.name);
      throw new Error(`enclave attestation failed: ${names.join(", ")}`);
    }
    const keys = new Set(results.map((r) => r.signingAddress));
    if (keys.size !== 1) throw new Error("attestation candidates disagree on the signing key");
    const [enclaveKey] = keys;
    this.log(`enclave attested (TDX + GPU), signing key ${enclaveKey.slice(0, KEY_PREVIEW)}…`);
    const attestation = candidates.find((a) => a.signing_address.toLowerCase() === enclaveKey);
    return { enclaveKey, attestation: attestation as unknown as Record<string, unknown> };
  }

  complete(requestBody: string): Promise<EnclaveCall> {
    return this.cloud.complete(requestBody);
  }
}

/**
 * Wraps an {@link EnclaveClient} so every completion is checked against the attested key as it returns
 * (Decorator pattern). A bad signature stops the run instead of reaching the receipt.
 */
export class SignatureCheckingEnclave {
  constructor(
    private readonly enclave: EnclaveClient,
    private readonly enclaveKey: string,
  ) {}

  /** Complete `requestBody`; throws with `label` and every problem if the signature doesn't verify. */
  async complete(requestBody: string, label: string): Promise<EnclaveCall> {
    const call = await this.enclave.complete(requestBody);
    const problems = await signatureProblems({
      model: MODEL,
      requestHash: call.requestHash,
      responseBody: call.responseBody,
      signature: call.signature,
      enclaveKey: this.enclaveKey,
    });
    if (problems.length) throw new Error(`${label}: ${problems.join("; ")}`);
    return call;
  }
}
