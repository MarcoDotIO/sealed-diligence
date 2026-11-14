/**
 * A minimal NEAR AI Cloud client that keeps the exact request and response bytes, because the enclave's
 * signature covers SHA-256 of exactly those bytes. Node only (reads the base URL from the environment).
 * @module
 */

import type { ModelAttestation } from "../core/attestation.ts";
import { sha256Hex } from "../core/bytes.ts";
import type { SignatureRecord } from "../core/signatures.ts";

/** NEAR AI Cloud's API root; override with `NEAR_AI_BASE_URL`. */
export const API_BASE = process.env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai";

/** One completion together with the bytes and signature needed to prove it came from the enclave. */
export interface EnclaveCall {
  chatId: string;
  requestHash: string;
  requestBody: string;
  responseBody: string;
  /** The assistant message's text. */
  content: string;
  signature: SignatureRecord;
}

const COMPLETION_RETRY = { attempts: 4, backoffMs: 1500 } as const;
/** Signatures are recorded asynchronously; NEAR AI documents a short, bounded retry on 404. */
const SIGNATURE_RETRY = { attempts: 8, backoffMs: 750 } as const;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const ERROR_EXCERPT = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryable = (status: number) => status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;

/**
 * Call `attempt` until it returns a value, waiting `backoffMs × attempt number` between tries.
 * `attempt` returns `undefined` to ask for another try; the last try's `undefined` becomes `onExhausted()`.
 */
async function retrying<T>(
  policy: { attempts: number; backoffMs: number },
  attempt: (n: number) => Promise<T | undefined>,
  onExhausted: () => T,
): Promise<T> {
  for (let n = 1; n <= policy.attempts; n++) {
    const result = await attempt(n);
    if (result !== undefined) return result;
    if (n < policy.attempts) await sleep(policy.backoffMs * n);
  }
  return onExhausted();
}

/** NEAR AI Cloud, authenticated with one API key. */
export class NearAiCloud {
  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl: string = API_BASE,
  ) {}

  /** The model's attestation reports, bound to `nonceHex` (no API key needed). */
  async attestationReport(model: string, nonceHex: string): Promise<ModelAttestation[]> {
    const url = new URL(`${this.baseUrl}/v1/attestation/report`);
    url.searchParams.set("model", model);
    url.searchParams.set("provider", "near");
    url.searchParams.set("signing_algo", "ed25519");
    url.searchParams.set("nonce", nonceHex);
    url.searchParams.set("include_tls_fingerprint", "false");
    const res = await fetch(url, { headers: { ...this.authorization(), Accept: "application/json", "x-no-aliasing": "true" } });
    if (!res.ok) throw new Error(`attestation report: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { model_attestations?: ModelAttestation[] };
    if (!body.model_attestations?.length) throw new Error("attestation report has no NEAR model attestations");
    return body.model_attestations;
  }

  /** Send `requestBody` exactly as given, then fetch the enclave's signature for the call. */
  async complete(requestBody: string): Promise<EnclaveCall> {
    const res = await this.postCompletion(requestBody);
    const responseBody = await res.text();
    if (!res.ok) throw new Error(`completion: HTTP ${res.status} ${responseBody.slice(0, ERROR_EXCERPT)}`);
    const parsed = JSON.parse(responseBody);
    const model = JSON.parse(requestBody).model as string;
    return {
      chatId: parsed.id,
      requestHash: sha256Hex(requestBody),
      requestBody,
      responseBody,
      content: parsed.choices?.[0]?.message?.content ?? "",
      signature: await this.signature(parsed.id, model),
    };
  }

  /** The enclave's ed25519 signature for one completion. */
  signature(chatId: string, model: string): Promise<SignatureRecord> {
    const url = new URL(`${this.baseUrl}/v1/signature/${encodeURIComponent(chatId)}`);
    url.searchParams.set("model", model);
    url.searchParams.set("signing_algo", "ed25519");
    return retrying(
      SIGNATURE_RETRY,
      async () => {
        const res = await fetch(url, { headers: { ...this.authorization(), Accept: "application/json" } });
        const text = await res.text();
        if (!res.ok && res.status !== HTTP_NOT_FOUND) throw new Error(`signature: HTTP ${res.status} ${text.slice(0, ERROR_EXCERPT)}`);
        const body = res.ok ? (JSON.parse(text) as Partial<SignatureRecord>) : null;
        return body?.signature && body.text ? (body as SignatureRecord) : undefined;
      },
      () => {
        throw new Error(`no signature available for ${chatId}`);
      },
    );
  }

  /** POST a completion, retrying rate limits and server errors; returns the last response either way. */
  private postCompletion(requestBody: string): Promise<Response> {
    let last: Response | undefined;
    return retrying(
      COMPLETION_RETRY,
      async () => {
        last = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { ...this.authorization(), "Content-Type": "application/json", "x-no-aliasing": "true", "Accept-Encoding": "identity" },
          body: requestBody,
        });
        return isRetryable(last.status) ? undefined : last;
      },
      () => last as Response,
    );
  }

  private authorization(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }
}
