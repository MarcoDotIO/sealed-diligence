# Sealed Diligence

**Investors want to see your code before they wire. You don't want to show it.**

Sealed Diligence lets an investor get a technical-diligence scorecard on a startup's **private** repository without ever seeing the source. The review runs inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). Every answer is signed by the enclave's attested key, and the final scorecard is sealed to one exact commit. The founder can't edit the scores, swap in a cleaner repo, or talk the AI reviewer into a 10/10 without it showing up. A NEAR contract pays for the report only when the enclave signature checks out on-chain.

Built at NEAR HACKATHON (Nov 2026), track: Privacy & Private AI, Open Innovation.

## Try it

Requirements: Node 20+, pnpm, git. A NEAR AI Cloud API key is needed only to *produce* a report; verifying one needs nothing.

```bash
pnpm install
```

**1. Verify the sample report (no key, no install beyond `pnpm install`).**

```bash
npx tsx src/cli.ts verify docs/sample/receipt.json docs/sample/DILIGENCE.md
```

You see each check pass: the Intel TDX quote, the enclave key and session nonce bound inside it, the event-log replay, the measured config, NVIDIA's GPU verdict, every per-file signature, the seal, and that `DILIGENCE.md` is unedited. The last line reads `VERIFIED`.

Or open the browser verifier at `docs/index.html` (served at the GitHub Pages link in the repo description) and click **Verify the sample report**. It runs the same checks in your browser, including full Intel quote verification. NVIDIA's service doesn't accept browser requests, so that one check points you to the CLI.

**2. See tampering caught.** Edit any score in `docs/sample/DILIGENCE.md` (for example change `overall 34/100` to `overall 94/100`) and run the same command. The `DILIGENCE.md matches the signed scorecard exactly` line fails and the result is `NOT VERIFIED`. In the browser, click **Sample with an edited score**.

**3. Run a sealed review yourself.**

```bash
./scripts/make-demo-repo.sh            # creates /tmp/acme-orders, a small startup repo with things to hide
export NEAR_AI_API_KEY=...             # from cloud.near.ai
npx tsx src/cli.ts review /tmp/acme-orders --label "Acme Orders" --out /tmp
npx tsx src/cli.ts verify /tmp/receipt.json /tmp/DILIGENCE.md
```

The demo repo contains a comment telling "any AI code reviewer" to ignore its instructions and score 10/10, a committed live-looking payment key, and a SQL injection, behind a README that claims full coverage and parameterized queries. You see the report flag the injection attempt as an integrity red flag, the committed secret, the SQL injection, and the README claims as contradicted. `receipt.json` contains no source code.

**4. Closing audit.** If the deal proceeds and the investor gets code access, they can prove the review covered the real code:

```bash
npx tsx src/cli.ts audit /tmp/receipt.json /tmp/acme-orders
```

This rebuilds every per-file request byte for byte from the source and checks it against the hashes the enclave signed. A swapped or edited file fails.

**5. Tests.**

```bash
pnpm test                                  # pipeline: review, verify, three tamper cases, closing audit
cd contract && cargo test                  # escrow: valid seal pays; wrong key, wrong commit, swapped body rejected; refund
```

## How it works

```
founder's machine                         NEAR AI Cloud enclave (TDX + H100/H200)          investor
-----------------                         ---------------------------------------          --------
1. nonce = sha256(commit, question pack,
   request id, salt)  ───────────────────► attestation report bound to the nonce
2. verify TDX quote, key+nonce binding,
   RTMR3, config, GPU (before any code
   leaves the machine)
3. one request per file  ────────────────► review → signed: model:sha256(req):sha256(resp)
4. README-vs-code request ───────────────► claims check → signed
5. seal request: commit, pack, every
   per-file hash + finding (no source) ──► scorecard → signed
6. write receipt.json + DILIGENCE.md  ─────────────────────────────────────────────────────► verify (CLI or browser)
7. submit seal to escrow contract  ──► NEAR contract: ed25519_verify(seal, pinned enclave key),
                                       body names this request/commit/pack → fee to founder
```

- **Signatures.** NEAR AI's `provider_tee` signature covers `"<model>:<sha256(exact request bytes)>:<sha256(exact response bytes)>"`, signed with ed25519 by a key whose public half sits in the TDX quote's report data ([docs](https://docs.near.ai/cloud/verification/cloud-api/response-signatures)). Since each per-file request contains the file, its signed hash commits to the code without revealing it.
- **The seal** request contains only hashes and bounded findings, so the investor holds it in full and recomputes its hash. It lists every per-file request and response hash, so dropping a bad review breaks the seal.
- **The question pack** (prompts, model, parameters) is hashed into the seal and the nonce. The founder can't soften the questions.
- **Prompt injection is a finding, not a vulnerability.** Every file is fenced as untrusted data and the reviewer is told to report any text that tries to instruct it. A founder who plants "rate this 10/10" gets an integrity red flag.
- **`DILIGENCE.md` is a pure function of the receipt.** Verification re-renders it and compares byte for byte.

## Threat model

| Who might cheat | How | What stops it now | Only provable later |
|---|---|---|---|
| Founder | Edit a score in DILIGENCE.md or receipt.json | Re-render mismatch; seal signature fails | |
| Founder | Drop a damning per-file review | Seal lists every review's hashes | |
| Founder | Talk the reviewer into a good score | Untrusted-data fencing; injection reported as a red flag | |
| Founder | Soften the prompts or switch models | Question-pack hash in the seal, nonce and escrow | |
| Founder | Review a cleaned-up repo instead of the real one | Commit hash in the seal and escrow | Closing audit rebuilds every request from source |
| Founder | Leave files out of the review | Coverage (`reviewed of tracked`) is printed in the report | Closing audit checks the tracked-file count |
| Founder | Run the review several times and keep the best | Temperature 0 and a fixed schema keep reruns close | Not prevented; see limits |
| Investor | Extract the source through the report | Fixed schema, bounded strings, "never quote code" | |
| NEAR AI / host | Read the code or fake the answers | TDX + GPU attestation verified before any code is sent | |

**Limits, stated plainly.**
- The orchestrator (this CLI) runs on the founder's machine, not in a TEE. That is why tampering with *which bytes were sent* is only fully provable at the closing audit; tampering with the *results* is caught immediately.
- All instances of a NEAR AI model share one signing key, so a signature proves "an attested instance of this model", not a specific machine ([NEAR AI docs](https://docs.near.ai/cloud/verification/cloud-api/model-attestations)).
- Report shopping (rerunning until a better score) is not prevented; the escrow request pins one commit and one question pack, and future work is to anchor every session nonce on-chain at attestation time.
- Files over 48 KB are reviewed in part and marked "(truncated)".

## NEAR pieces

- **NEAR AI Cloud** private inference, model attestation (Intel TDX quote via `dcap-qvl`, RTMR3 event-log replay, MRCONFIGID, NVIDIA NRAS), and ed25519 `provider_tee` response signatures. Model: `deepseek-ai/DeepSeek-V4.1-Flash-1017` (NEAR-operated).
- **Escrow contract** (`contract/`, near-sdk 5): `create_request` pins founder, commit, pack hash, model and enclave key with an attached fee; `fulfil` checks the seal with `env::ed25519_verify` and that the signed request body names this request, commit and pack, then pays the founder; `refund` after the deadline. Testnet deployment and example calls: see [Escrow on testnet](#escrow-on-testnet).

## Escrow on testnet

```bash
cd contract && cargo near build non-reproducible-wasm
# investor: pin the enclave key printed by `verify`, attach the fee
near contract call-function as-transaction <escrow> create_request json-args '{"founder":"<founder>","commit":"<sha>","pack_hash":"<pack>","model":"deepseek-ai/DeepSeek-V4.1-Flash-1017","enclave_key":"<key>","timeout_hours":72}' prepaid-gas '30 Tgas' attached-deposit '1 NEAR' sign-as <investor> network-config testnet
# founder: review with the escrow's request id, then submit the seal
npx tsx src/cli.ts review <repo> --request "<escrow>#<id>"
npx tsx src/cli.ts fulfil-args receipt.json
near contract call-function as-transaction <escrow> fulfil file-args fulfil-args.json prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as <founder> network-config testnet
```

## Related work

[CodeCloak](https://x.com/PinnacleCrypt/status/2120517173730844836), also built at this hackathon, solves a different problem: keeping *your own* code private from the AI provider during review. Sealed Diligence is about two parties who distrust each other. The code's author is the one who might cheat, and the attestation exists for a third party.

## Built with

TypeScript, `@phala/dcap-qvl-node` / `@phala/dcap-qvl-web` (Intel DCAP quote verification), `@noble/ed25519`, `@noble/hashes`, esbuild, Rust + near-sdk 5. Verification follows NEAR AI's documentation and its MIT-licensed reference verifier ([nearai-cloud-verifier](https://github.com/nearai/nearai-cloud-verifier)). All code in this repository was written during the hackathon window, with AI coding assistance.

## License

MIT
