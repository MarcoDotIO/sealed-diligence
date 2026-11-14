/**
 * Checks NEAR AI Cloud's per-call enclave signatures. Browser-safe.
 *
 * NEAR AI signs `"<model>:<sha256(request bytes)>:<sha256(response bytes)>"` with ed25519, using a key
 * whose public half is bound into the enclave's TDX quote (see `attestation.ts`). Because each
 * per-file request contains the file, its signed hash commits to the code without revealing it.
 * Docs: https://docs.near.ai/cloud/verification/cloud-api/response-signatures
 * @module
 */
import * as ed from "@noble/ed25519";
import { fromBase64, fromHex, sha256Hex, utf8Bytes } from "./bytes.ts";
import { errorMessage } from "./checks.ts";

const ED25519_SIGNATURE_BYTES = 64;
const ED25519_SIGNATURE_HEX = /^[0-9a-f]{128}$/i;

/** What NEAR AI Cloud's `GET /v1/signature/{chat_id}` returns. */
export interface SignatureRecord {
  /** The signed text: `"<model>:<request sha256>:<response sha256>"`. */
  text: string;
  signature: string;
  /** The signer's ed25519 public key, hex. */
  signing_address: string;
  signing_algo: string;
  /** `provider_tee` when the model's own enclave signed (absent on older responses). */
  signature_kind?: string;
}

/** Signatures arrive as hex (optionally `0x`-prefixed) or base64; normalize to the 64 raw bytes. */
export function signatureBytes(signature: string): Uint8Array {
  const hex = signature.replace(/^0x/i, "");
  if (ED25519_SIGNATURE_HEX.test(hex)) return fromHex(hex);
  const bytes = fromBase64(signature);
  if (bytes.length !== ED25519_SIGNATURE_BYTES) throw new Error(`unexpected signature length ${bytes.length}`);
  return bytes;
}

/** One signed completion, as the verifier sees it. */
export interface SignedCall {
  model: string;
  /** SHA-256 of the exact request bytes. Only the hash is needed, so the request (with the code) can stay private. */
  requestHash: string;
  /** The exact response bytes as received. */
  responseBody: string;
  signature: SignatureRecord;
  /** The attested enclave key the signature must come from. */
  enclaveKey: string;
}

/**
 * Every reason `call` is not a valid enclave signature over exactly this request and response.
 * An empty list means the call verifies.
 */
export async function signatureProblems(call: SignedCall): Promise<string[]> {
  const { signature } = call;
  const problems: string[] = [];
  if (signature.signing_algo !== "ed25519") problems.push(`algorithm ${signature.signing_algo}, expected ed25519`);
  if (signature.signature_kind && signature.signature_kind !== "provider_tee")
    problems.push(`signature_kind ${signature.signature_kind}: not bound to the model enclave`);
  if (signature.signing_address.toLowerCase() !== call.enclaveKey.toLowerCase()) problems.push("signer is not the attested enclave key");
  if (signature.text !== signedText(call)) problems.push("signed text does not match this request/response");
  problems.push(...(await ed25519Problems(signature)));
  return problems;
}

/** The text NEAR AI signs for this call. */
function signedText(call: SignedCall): string {
  return `${call.model}:${call.requestHash}:${sha256Hex(call.responseBody)}`;
}

async function ed25519Problems(signature: SignatureRecord): Promise<string[]> {
  try {
    const valid = await ed.verifyAsync(signatureBytes(signature.signature), utf8Bytes(signature.text), fromHex(signature.signing_address));
    return valid ? [] : ["ed25519 signature invalid"];
  } catch (error) {
    return [`signature check error: ${errorMessage(error)}`];
  }
}
