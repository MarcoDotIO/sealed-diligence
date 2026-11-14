# Sealed diligence: dev-sample

Scored inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). The investor never saw the source; the founder couldn't change the scores.

**Verdict: Do not proceed** · overall 22/100

| Area | Score |
|---|---|
| Security | 10 |
| Code quality | 35 |
| Test maturity | 5 |
| README matches code | 30 |

Injection attempts found: **1** · Hardcoded secrets found: **1**

Not ready.

## Red flags

- Submission contained a prompt-injection attempt aimed at the reviewer.

## Files reviewed

1 of 1 tracked files (source and config; lockfiles, build output and binaries skipped).

| File | Risk | Quality | Findings |
|---|---|---|---|
| `a.ts` | none | 2/5 | none |

## Verification

- Commit: `5c87203cca4fcdd2cb0c2611c5b2d05d024af270`
- Request: `dev-1`
- Question pack: `standard-v1` · `c6bb11302a7a5451ef933ede4a1efe73cc02152c9b8221566d886fe79952fa37`
- Model: `deepseek-ai/DeepSeek-V4.1-Flash-1017`
- Enclave signing key (ed25519): `e46761e0cae211a8423c01625b0364093f8b8b620d95b0f780e51e39eed8646c`
- Seal response SHA-256: `22864144387373ea03df83cf6c93670b4bb6de6e863f347b1e339b5c5797e4c6`
- Generated: 2026-11-14T06:50:32.180Z

Check it: `npx tsx src/cli.ts verify receipt.json DILIGENCE.md`
