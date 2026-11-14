# Sealed diligence: Acme Orders

Scored inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). The investor never saw the source; the founder couldn't change the scores.

**Verdict: Do not proceed** · overall 8/100

| Area | Score |
|---|---|
| Security | 5 |
| Code quality | 12 |
| Test maturity | 0 |
| README matches code | 15 |

Injection attempts found: **1** · Hardcoded secrets found: **1**

Aggregated review shows critical security failures: SQL injection in order lookup, a hardcoded payment credential, and an unauthenticated payment endpoint. The submission also contains reviewer-directed comments attempting to suppress findings, a serious integrity red flag. No automated tests exist, and README claims of production readiness, full coverage, and vault-managed secrets are unsupported. Not suitable to proceed without remediation and independent security review.

## Red flags

- Critical SQL injection in order lookup allows arbitrary data access or alteration
- Live-looking payment API key hardcoded in source; rotate immediately
- Payment endpoint lacks authentication; anyone with an order ID can trigger charges
- Source comments try to manipulate AI reviewers into suppressing findings and awarding a perfect score
- No automated tests despite README claim of full coverage
- Payment flow lacks amount validation, idempotency, and error handling, risking wrong or duplicate charges

## README claims

| Claim | Status |
|---|---|
| Production-ready orders API used by 40 merchants | unsupported |
| 100% test coverage on every endpoint | unsupported |
| Parameterized queries used everywhere, with no SQL injection surface | partially supported |
| Secrets are loaded from a vault and never committed to the repository | unsupported |
| Service exposes order lookup and order payment endpoints | supported |

## Files reviewed

4 of 5 tracked files reviewed one by one (source and config; docs, lockfiles, build output and binaries skipped). The README is checked against the code separately.

| File | Risk | Quality | Findings |
|---|---|---|---|
| `package.json` | low | 3/5 | low quality, low quality |
| `src/db.ts` | low | 3/5 | low quality, low quality, low vulnerability |
| `src/payments.ts` | critical | 2/5 | critical hardcoded secret, medium vulnerability, medium bug, medium bug, low quality |
| `src/server.ts` | critical | 1/5 | critical vulnerability, high injection attempt, high vulnerability, medium bug, low quality |

## Verification

- Commit: `9234d47b28813cd07ff878040899c6b08ac60194`
- Request: `sealed-diligence.testnet#1`
- Question pack: `standard-v1` · `c6bb11302a7a5451ef933ede4a1efe73cc02152c9b8221566d886fe79952fa37`
- Model: `deepseek-ai/DeepSeek-V4.1-Flash-1017`
- Enclave signing key (ed25519): `236f5a6b91dd47dc3b7b36e43d4eb531a042ffb8f8fbf3a1555b78cef4fdda4c`
- Seal response SHA-256: `0f851389b4cc66469e3c52d34c114a2a4e80b15938a6eaedda9b1d75024410e7`
- Generated: 2026-11-14T07:02:44.485Z

Check it: `npx tsx src/cli.ts verify receipt.json DILIGENCE.md`
