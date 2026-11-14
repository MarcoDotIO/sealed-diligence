// Browser-safe signature and hash helpers shared by the CLI verifier and the web verifier.
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";

const enc = new TextEncoder();

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(h: string): Uint8Array {
  const s = h.replace(/^0x/i, "");
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error("bad hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const sha256Hex = (s: string | Uint8Array) => toHex(sha256(typeof s === "string" ? enc.encode(s) : s));

/** What NEAR AI Cloud's /v1/signature/{id} returns. */
export interface SignatureRecord {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind?: string;
}

/** Signatures come back as hex (optionally 0x) or base64; normalize to 64 raw bytes. */
export function signatureBytes(sig: string): Uint8Array {
  const s = sig.replace(/^0x/i, "");
  if (/^[0-9a-f]{128}$/i.test(s)) return fromHex(s);
  const b = fromB64(sig);
  if (b.length !== 64) throw new Error(`unexpected signature length ${b.length}`);
  return b;
}

export interface SignedCallCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Check one signed completion against the documented provider_tee payload:
 * text = "<MODEL_ID>:<sha256(request bytes)>:<sha256(response bytes)>", ed25519 over UTF-8 text,
 * signer = the attested enclave key. `requestHash` is used when the request bytes are withheld.
 */
export async function checkSignedCall(args: {
  model: string;
  requestHash: string;
  responseBody: string;
  sig: SignatureRecord;
  enclaveKey: string;
}): Promise<SignedCallCheck> {
  const problems: string[] = [];
  const { sig } = args;
  if (sig.signing_algo !== "ed25519") problems.push(`algorithm ${sig.signing_algo}, expected ed25519`);
  if (sig.signature_kind && sig.signature_kind !== "provider_tee")
    problems.push(`signature_kind ${sig.signature_kind}: not bound to the model enclave`);
  if (sig.signing_address.toLowerCase() !== args.enclaveKey.toLowerCase()) problems.push("signer is not the attested enclave key");
  const expected = `${args.model}:${args.requestHash}:${sha256Hex(args.responseBody)}`;
  if (sig.text !== expected) problems.push("signed text does not match this request/response");
  try {
    const ok = await ed.verifyAsync(signatureBytes(sig.signature), enc.encode(sig.text), fromHex(sig.signing_address));
    if (!ok) problems.push("ed25519 signature invalid");
  } catch (e) {
    problems.push(`signature check error: ${(e as Error).message}`);
  }
  return { ok: problems.length === 0, problems };
}
