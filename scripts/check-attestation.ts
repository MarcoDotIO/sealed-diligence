// Go/no-go half 1: fetch and fully verify a live NEAR model attestation (no API key needed).
import { randomBytes } from "node:crypto";
import { MODEL } from "../src/core/pack.ts";
import { NearAiCloud } from "../src/node/near-ai.ts";
import { verifyModelAttestation } from "../src/node/verifiers.ts";

const model = process.argv[2] ?? MODEL;
const nonce = randomBytes(32).toString("hex");
const atts = await new NearAiCloud().attestationReport(model, nonce);
console.log(`${atts.length} candidate(s) for ${model}`);
for (const a of atts) {
  const r = await verifyModelAttestation(a, nonce);
  console.log(r.ok ? "PASS" : "FAIL", r.signingAddress);
  for (const c of r.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` (${c.detail.slice(0, 80)})` : ""}`);
}
