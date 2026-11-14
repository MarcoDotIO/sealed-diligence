# Sealed diligence: Ledgerline

Scored inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). The investor never saw the source; the founder couldn't change the scores.

**Verdict: Do not proceed** · overall 28/100

| Area | Score |
|---|---|
| Security | 22 |
| Code quality | 45 |
| Test maturity | 30 |
| README matches code | 20 |

Injection attempts found: **1** · Hardcoded secrets found: **1**

Signed reviews cover 11 of 12 files. Security is weak: unsafe cache deserialization, a weak default webhook secret, debug mode enabled by default, non-constant-time signature checks, and payment data sent to an external analytics service. One source file contains an instruction aimed at manipulating reviewers, a serious integrity red flag. Tests are thin and cover only happy paths. Several README claims are unsupported or contradicted, including privacy, certification, adoption and coverage. Not suitable to proceed.

## Red flags

- Reviewer-directed injection attempt embedded in a source file docstring
- Unsafe cache deserialization enables remote code execution
- Webhook signing secret has a weak default fallback
- Debug mode defaults on and accepts unsigned webhooks
- Full payment data sent to external analytics, contradicting privacy claims
- README claims (SOC 2, 120+ firms, 92% coverage) unsupported or contradicted

## README claims

| Claim | Status |
|---|---|
| Matches bank payment webhooks to open invoices automatically | supported |
| Produces month-end reconciliation reports | supported |
| Used in production by 120+ accounting firms | unsupported |
| SOC 2 Type II certified | unsupported |
| Customer financial data never leaves your infrastructure; no third-party processors or analytics | contradicted |
| Every bank webhook is HMAC-verified in constant time; unsigned requests always rejected | partially supported |
| Report caching uses a safe, schema-validated format | unsupported |
| 92% test coverage enforced in CI and fully typed with mypy strict | unsupported |

## Files reviewed

11 of 12 tracked files reviewed one by one (source and config; docs, lockfiles, build output and binaries skipped). The README is checked against the code separately.

| File | Risk | Quality | Findings |
|---|---|---|---|
| `ledgerline/__init__.py` | none | 4/5 | none |
| `ledgerline/api.py` | medium | 3/5 | medium vulnerability, low bug, low quality |
| `ledgerline/config.py` | medium | 3/5 | medium vulnerability, medium vulnerability, low quality, low quality |
| `ledgerline/db.py` | low | 3/5 | low quality, low quality, low bug |
| `ledgerline/reconcile.py` | low | 3/5 | high injection attempt, medium bug, low quality, low quality |
| `ledgerline/reports.py` | high | 2/5 | high vulnerability, medium quality, low quality |
| `ledgerline/telemetry.py` | medium | 3/5 | medium vulnerability, low quality, low quality |
| `ledgerline/webhooks.py` | medium | 3/5 | medium vulnerability, medium vulnerability, low quality |
| `pyproject.toml` | low | 4/5 | low quality, low quality |
| `tests/test_reconcile.py` | none | 4/5 | low quality |
| `tests/test_webhooks.py` | none | 3/5 | low quality |

## Verification

- Commit: `7732a553fbd18bf1e5ed8a8efcf7e516bb340112`
- Request: `ledgerline-demo-1`
- Question pack: `standard-v2` · `f3344a26a99443e0642d344114c4330007a02cb5415942acb88f6f4648e8bf42`
- Model: `deepseek-ai/DeepSeek-V4.1-Flash-1017`
- Enclave signing key (ed25519): `236f5a6b91dd47dc3b7b36e43d4eb531a042ffb8f8fbf3a1555b78cef4fdda4c`
- Seal response SHA-256: `dda0a704f2565ae0aa5ec34bac730da8dec90d1e80487a60e2877730db9acb5f`
- Generated: 2026-11-14T09:48:54.626Z

Check it: `npx tsx src/cli.ts verify receipt.json DILIGENCE.md`
