# Sealed diligence: dev-sample

Scored inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). The reviewer never saw this file's reader, and the reader never saw the source.

**Verdict: Proceed** · overall 80/100

| Area | Score |
|---|---|
| Security | 80 |
| Code quality | 80 |
| Test maturity | 60 |
| README matches code | 70 |

Injection attempts found: **0** · Hardcoded secrets found: **0**

dev sample

## Files reviewed

1 of 1 tracked files (source and config; lockfiles, build output and binaries skipped).

| File | Risk | Quality | Findings |
|---|---|---|---|
| `a.ts` | none | 4/5 | none |

## Verification

- Commit: `15881c3bf8bae1f16d92fa01231e7d3ec37bce14`
- Request: `dev-1`
- Question pack: `standard-v1` · `674dce3ef3d1368801a32ffc61fbd2e64f92a2d11ddb7c5b8f8f64dcb9a37ea8`
- Model: `deepseek-ai/DeepSeek-V4.1-Flash-1017`
- Enclave signing key (ed25519): `c1f2b969bf6f0077da9d3bea0569e64499041ac8b6c6facb1336dd23cccf9601`
- Seal response SHA-256: `62195ecc12b85abc0c578336aa0d65f8e90bc50f588956362e1dede42cf9d94b`
- Generated: 2026-11-14T06:43:26.537Z

Check it: `npx tsx src/cli.ts verify receipt.json DILIGENCE.md`
