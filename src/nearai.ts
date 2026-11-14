// Minimal NEAR AI Cloud client that keeps the exact request and response bytes,
// because the enclave signature covers SHA-256 of those exact bytes.
import { API_BASE } from "./attest.ts";
import { sha256Hex, type SignatureRecord } from "./sig.ts";

export interface SignedCall {
  chatId: string;
  requestHash: string;
  requestBody: string;
  responseBody: string;
  content: string;
  sig: SignatureRecord;
}

const COMPLETION_ATTEMPTS = 4;
const COMPLETION_BACKOFF_MS = 1500;
const SIGNATURE_ATTEMPTS = 8;
const SIGNATURE_BACKOFF_MS = 750;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const ERROR_EXCERPT = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryable = (status: number) => status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR;

async function postCompletion(apiKey: string, requestBody: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-no-aliasing": "true",
        "Accept-Encoding": "identity",
      },
      body: requestBody,
    });
    if (!isRetryable(res.status) || attempt === COMPLETION_ATTEMPTS) return res;
    await sleep(COMPLETION_BACKOFF_MS * attempt);
  }
}

export async function signedCompletion(apiKey: string, requestBody: string): Promise<SignedCall> {
  const res = await postCompletion(apiKey, requestBody);
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
    sig: await fetchSignature(apiKey, parsed.id, model),
  };
}

/** Signatures are recorded asynchronously; NEAR AI documents a short bounded retry on 404. */
export async function fetchSignature(apiKey: string, chatId: string, model: string): Promise<SignatureRecord> {
  const url = new URL(`${API_BASE}/v1/signature/${encodeURIComponent(chatId)}`);
  url.searchParams.set("model", model);
  url.searchParams.set("signing_algo", "ed25519");
  for (let attempt = 1; attempt <= SIGNATURE_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok && res.status !== HTTP_NOT_FOUND) throw new Error(`signature: HTTP ${res.status} ${text.slice(0, ERROR_EXCERPT)}`);
    const body = res.ok ? JSON.parse(text) : null;
    if (body?.signature && body.text) return body as SignatureRecord;
    await sleep(SIGNATURE_BACKOFF_MS * attempt);
  }
  throw new Error(`no signature available for ${chatId}`);
}
