// Go/no-go half 1: fetch and fully verify a live NEAR model attestation (no API key needed).
import { randomBytes } from "node:crypto";
import { fetchModelAttestations, verifyModelAttestation } from "../src/attest.ts";
const model = process.argv[2] ?? "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const nonce = randomBytes(32).toString("hex");
const atts = await fetchModelAttestations(model, nonce);
console.log(`${atts.length} candidate(s) for ${model}`);
for (const a of atts) {
  const r = await verifyModelAttestation(a, nonce);
  console.log(r.ok ? "PASS" : "FAIL", r.signingAddress);
  for (const c of r.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` (${c.detail.slice(0, 80)})` : ""}`);
}
