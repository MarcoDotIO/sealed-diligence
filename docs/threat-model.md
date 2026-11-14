# Threat model

Two parties distrust each other. The founder wants a good report without revealing the code. The investor wants a report the founder couldn't shape. The enclave operator and the network are untrusted as well.

| Who might cheat | How | What stops it now | Only provable later |
|---|---|---|---|
| Founder | Edit a score in DILIGENCE.md or receipt.json | The re-rendered report doesn't match; the seal signature fails | |
| Founder | Drop a damning per-file review | The seal lists every review's hashes | |
| Founder | Talk the reviewer into a good score | Untrusted-data fencing; an injection attempt is reported as an integrity red flag | |
| Founder | Soften the prompts or switch models | The question-pack hash is in the seal, the nonce and the escrow | |
| Founder | Review a cleaned-up repo instead of the real one | The commit hash is in the seal and the escrow | The closing audit rebuilds every request from source |
| Founder | Leave files out of the review | Coverage (`reviewed of tracked`) is printed in the report | The closing audit checks the tracked-file count |
| Founder | Run the review several times and keep the best | Temperature 0 and a fixed schema keep reruns close | Not prevented (see limits) |
| Founder | Replay an old attestation | The nonce binds commit, pack, request and a fresh salt, and the quote binds the nonce | |
| Investor | Extract the source through the report | A fixed schema, bounded strings, and "never quote code" in every prompt | |
| NEAR AI or the host | Read the code or fake the answers | TDX and GPU attestation are verified before any code is sent; answers are signed by the attested key | |
| Anyone | Claim the escrow paid for a different report | The contract stores the seal text; the verifiers compare it with the receipt | |

## Limits, stated plainly

- **The orchestrator isn't in a TEE.** The CLI runs on the founder's machine. Tampering with the *results* is caught immediately; tampering with *which bytes were sent* is fully provable only at the closing audit.
- **One key per model.** All instances of a NEAR AI model share one signing key, so a signature proves "an attested instance of this model", not a specific machine ([NEAR AI docs](https://docs.near.ai/cloud/verification/cloud-api/model-attestations)).
- **Report shopping.** Rerunning until the score improves isn't prevented. The escrow pins one commit and one question pack; future work is to anchor every session nonce on-chain when the enclave is attested.
- **Large files** over 48 KB are reviewed in part and marked "(truncated)" in the report.
- **The model's judgement** is only as good as the model. Verification proves who said what, not that it's right.
- **GPU check in the browser.** NVIDIA's service refuses browser requests, so the page reports that check as "needs the CLI" instead of passing it.
