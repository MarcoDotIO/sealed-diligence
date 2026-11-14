// Dev aid: a receipt with REAL live enclave attestation but signatures from a local key.
// The web verifier should pass the enclave checks and fail the signature checks.
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ed from "@noble/ed25519";
import { runReview } from "../src/review.ts";
import { renderDiligence } from "../src/render.ts";
import { fetchModelAttestations } from "../src/attest.ts";
import { MODEL } from "../src/pack.ts";
import { sha256Hex, toHex } from "../src/sig.ts";

const dir = mkdtempSync(join(tmpdir(), "sd-web-"));
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
g("init", "-q"); writeFileSync(join(dir, "a.ts"), "export const x = 1;\n"); g("add", "."); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
const secret = ed.utils.randomSecretKey(); const pub = toHex(await ed.getPublicKeyAsync(secret));
const r = await runReview({ repo: dir, requestId: "dev-1", repoLabel: "dev-sample", apiKey: "x", enclave: {
  async attest(nonce) { const a = (await fetchModelAttestations(MODEL, nonce))[0]; return { enclaveKey: pub, attestation: a as any }; },
  async complete(body) {
    const sys = JSON.parse(body).messages[0].content as string;
    const content = sys.includes("final reviewer") ? { verdict: "proceed", overall: 80, security: 80, code_quality: 80, test_maturity: 60, readme_alignment: 70, injection_attempts: 0, hardcoded_secrets: 0, red_flags: [], summary: "dev sample" } : { purpose: "x", quality: 4, security_risk: "none", tests_present: false, findings: [] };
    const responseBody = JSON.stringify({ id: "c", choices: [{ message: { content: JSON.stringify(content) } }] });
    const text = `${MODEL}:${sha256Hex(body)}:${sha256Hex(responseBody)}`;
    return { chatId: "c", requestHash: sha256Hex(body), requestBody: body, responseBody, content: JSON.stringify(content), sig: { text, signature: toHex(await ed.signAsync(new TextEncoder().encode(text), secret)), signing_address: pub, signing_algo: "ed25519", signature_kind: "provider_tee" } };
  } } });
mkdirSync("docs/sample", { recursive: true });
writeFileSync("docs/sample/receipt.json", JSON.stringify(r, null, 2)); writeFileSync("docs/sample/DILIGENCE.md", renderDiligence(r));
console.log("wrote docs/sample (dev receipt)");
