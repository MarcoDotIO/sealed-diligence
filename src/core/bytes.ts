/**
 * Byte and hash helpers shared by every layer. Browser-safe: no Node built-ins.
 * @module
 */
import { sha256 } from "@noble/hashes/sha2.js";

const utf8 = new TextEncoder();

/** Encode a string as UTF-8 bytes. */
export function utf8Bytes(text: string): Uint8Array {
  return utf8.encode(text);
}

/** Lowercase hex, two characters per byte, no prefix. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decode hex (an optional `0x` prefix is allowed). Throws on odd length or non-hex characters. */
export function fromHex(hex: string): Uint8Array {
  const digits = hex.replace(/^0x/i, "");
  if (digits.length % 2 || /[^0-9a-f]/i.test(digits)) throw new Error("bad hex");
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Decode standard or URL-safe base64 (padding optional). */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Join byte arrays end to end. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * SHA-256 as lowercase hex. Strings are hashed as their UTF-8 bytes, so callers must pass the exact
 * text that went over the wire: re-serializing JSON first would change the hash.
 */
export function sha256Hex(data: string | Uint8Array): string {
  return toHex(sha256(typeof data === "string" ? utf8Bytes(data) : data));
}
