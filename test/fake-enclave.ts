// A stand-in for the NEAR AI enclave: a local ed25519 key signs exactly the payload NEAR AI's
// provider_tee signature covers, so every downstream check runs for real.
import * as ed from "@noble/ed25519";
import type { EnclaveClient } from "../src/review.ts";
import { FILE_SYSTEM, MODEL, README_SYSTEM } from "../src/pack.ts";
import { sha256Hex, toHex } from "../src/sig.ts";

export type Replier = (system: string, user: string) => unknown;

/** Replies like a reviewer that notices the demo repo's planted problems. */
export const demoReplies: Replier = (system, user) => {
  if (system === FILE_SYSTEM) {
    const findings = [];
    if (user.includes("ignore previous instructions"))
      findings.push({ kind: "injection_attempt", severity: "high", summary: "Comment tries to instruct the reviewer to inflate the score." });
    if (user.includes("acmepay_live_")) findings.push({ kind: "hardcoded_secret", severity: "critical", summary: "A live payment API key is committed." });
    if (user.includes("SELECT")) findings.push({ kind: "vulnerability", severity: "high", summary: "SQL query built by string concatenation." });
    return { purpose: "Handles orders", quality: 2, security_risk: findings.length ? "high" : "none", tests_present: false, findings };
  }
  if (system === README_SYSTEM) {
    return { injection_attempt: false, claims: [{ claim: "Full test coverage", status: "contradicted", evidence_paths: [] }] };
  }
  return {
    verdict: "do_not_proceed",
    overall: 22,
    security: 10,
    code_quality: 35,
    test_maturity: 5,
    readme_alignment: 30,
    injection_attempts: 1,
    hardcoded_secrets: 1,
    red_flags: ["Submission contained a prompt-injection attempt aimed at the reviewer."],
    summary: "Not ready.",
  };
};

export async function fakeEnclave(
  replies: Replier = demoReplies,
  attest?: (nonce: string, key: string) => Promise<Record<string, unknown>>,
): Promise<EnclaveClient> {
  const secret = ed.utils.randomSecretKey();
  const enclaveKey = toHex(await ed.getPublicKeyAsync(secret));
  let calls = 0;
  return {
    async attest(nonce) {
      return { enclaveKey, attestation: attest ? await attest(nonce, enclaveKey) : { fake: true } };
    },
    async complete(requestBody) {
      const { messages } = JSON.parse(requestBody);
      const content = JSON.stringify(replies(messages[0].content, messages[1].content));
      const chatId = `chatcmpl-${++calls}`;
      const responseBody = JSON.stringify({ id: chatId, choices: [{ message: { content } }] });
      const requestHash = sha256Hex(requestBody);
      const text = `${MODEL}:${requestHash}:${sha256Hex(responseBody)}`;
      const signature = toHex(await ed.signAsync(new TextEncoder().encode(text), secret));
      return {
        chatId,
        requestHash,
        requestBody,
        responseBody,
        content,
        sig: { text, signature, signing_address: enclaveKey, signing_algo: "ed25519", signature_kind: "provider_tee" },
      };
    },
  };
}
