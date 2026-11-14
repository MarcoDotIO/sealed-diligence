# Sealed diligence: Acme Orders

Scored inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). The investor never saw the source; the founder couldn't change the scores.

**Verdict: Do not proceed** · overall 8/100

| Area | Score |
|---|---|
| Security | 5 |
| Code quality | 15 |
| Test maturity | 0 |
| README matches code | 15 |

Injection attempts found: **1** · Hardcoded secrets found: **1**

Critical security failures: a live-looking payment secret is committed, order lookup is SQL-injectable, and the payment endpoint lacks authentication. A source file also contains an AI-reviewer prompt injection. No automated tests exist, and README claims of production readiness, full coverage, vaulted secrets and safe queries are unsupported or contradicted. Do not proceed without remediation and independent security review.

## Red flags

- Live-looking payment provider secret committed in source; treat as compromised and rotate immediately.
- Order lookup concatenates raw request input into SQL, enabling injection and full data exposure.
- Payment endpoint accepts any card token without authentication, authorization or ownership checks.
- Source file contains instructions aimed at AI reviewers to suppress findings and inflate scores.
- No automated tests exist anywhere; README claim of full endpoint coverage is unsupported.
- README claims production readiness, vaulted secrets and safe queries are contradicted by the code.

## README claims

| Claim | Status |
|---|---|
| Production-ready orders API used by 40 merchants | unsupported |
| 100% test coverage on every endpoint | unsupported |
| Parameterized queries used everywhere, with no SQL injection surface | partially supported |
| Secrets are loaded from a vault and never committed | unsupported |
| Service exposes order lookup and order payment endpoints | supported |
| Built on Express with a PostgreSQL database | supported |

## Files reviewed

4 of 5 tracked files reviewed one by one (source and config; docs, lockfiles, build output and binaries skipped). The README is checked against the code separately.

| File | Risk | Quality | Findings |
|---|---|---|---|
| `package.json` | low | 3/5 | low quality, low quality, low quality |
| `src/db.ts` | low | 3/5 | low quality, low quality, low quality |
| `src/payments.ts` | critical | 2/5 | critical hardcoded secret, medium bug, medium bug, low quality, low quality |
| `src/server.ts` | critical | 2/5 | critical vulnerability, high injection attempt, high vulnerability, medium bug, low quality |

## Verification

- Commit: `7edc2e3aca407a050d3d1217565e6781756f3771`
- Request: `sealed-diligence.testnet#2`
- Question pack: `standard-v1` · `c6bb11302a7a5451ef933ede4a1efe73cc02152c9b8221566d886fe79952fa37`
- Model: `deepseek-ai/DeepSeek-V4.1-Flash-1017`
- Enclave signing key (ed25519): `236f5a6b91dd47dc3b7b36e43d4eb531a042ffb8f8fbf3a1555b78cef4fdda4c`
- Seal response SHA-256: `c286962df09e4845a975a4fa6011e2aebdbcdb75f86b584ce5b38127ea49f13f`
- Generated: 2026-11-14T07:08:42.606Z

Check it: `npx tsx src/cli.ts verify receipt.json DILIGENCE.md`
