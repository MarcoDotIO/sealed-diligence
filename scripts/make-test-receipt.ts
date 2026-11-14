// Dev aid: a receipt with REAL live enclave attestation but signatures from a local key, for checking
// the browser verifier before a NEAR AI key is available. It must fail exactly the key-binding check.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchModelAttestations } from "../src/attest.ts";
import { MODEL } from "../src/pack.ts";
import { renderDiligence } from "../src/render.ts";
import { runReview } from "../src/review.ts";
import { fakeEnclave } from "../test/fake-enclave.ts";

const repo = mkdtempSync(join(tmpdir(), "sd-web-"));
const git = (...a: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
git("init", "-q");
writeFileSync(join(repo, "a.ts"), "export const x = 1;\n");
git("add", ".");
git("commit", "-qm", "x");

const liveAttestation = async (nonce: string) => (await fetchModelAttestations(MODEL, nonce))[0] as unknown as Record<string, unknown>;
const receipt = await runReview({ repo, requestId: "dev-1", repoLabel: "dev-sample", enclave: await fakeEnclave(undefined, liveAttestation) });
mkdirSync("docs/sample", { recursive: true });
writeFileSync("docs/sample/receipt.json", JSON.stringify(receipt, null, 2) + "\n");
writeFileSync("docs/sample/DILIGENCE.md", renderDiligence(receipt));
console.log("wrote docs/sample (dev receipt)");
