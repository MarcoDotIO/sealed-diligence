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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function signedCompletion(apiKey: string, requestBody: string): Promise<SignedCall> {
  let res: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-no-aliasing": "true",
        "Accept-Encoding": "identity",
      },
      body: requestBody,
    });
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1500 * (attempt + 1));
  }
  const responseBody = await res!.text();
  if (!res!.ok) throw new Error(`completion: HTTP ${res!.status} ${responseBody.slice(0, 300)}`);
  const parsed = JSON.parse(responseBody);
  const model = JSON.parse(requestBody).model as string;
  const sig = await fetchSignature(apiKey, parsed.id, model);
  return {
    chatId: parsed.id,
    requestHash: sha256Hex(requestBody),
    requestBody,
    responseBody,
    content: parsed.choices?.[0]?.message?.content ?? "",
    sig,
  };
}

/** The signature is recorded asynchronously; a short bounded retry on 404 is documented behaviour. */
export async function fetchSignature(apiKey: string, chatId: string, model: string): Promise<SignatureRecord> {
  const url = new URL(`${API_BASE}/v1/signature/${encodeURIComponent(chatId)}`);
  url.searchParams.set("model", model);
  url.searchParams.set("signing_algo", "ed25519");
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const text = await res.text();
    if (res.ok) {
      const body = JSON.parse(text);
      if (body.signature && body.text) return body as SignatureRecord;
    } else if (res.status !== 404) {
      throw new Error(`signature: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    await sleep(750 * (attempt + 1));
  }
  throw new Error(`no signature available for ${chatId}`);
}
