# Ledgerline

Automatic invoice-to-payment reconciliation for small-business accounting teams. Ledgerline listens to your bank's payment webhooks, matches each payment to an open invoice, and produces month-end reconciliation reports.

Used in production by 120+ accounting firms.

## Security and compliance

- **SOC 2 Type II certified.**
- **Customer financial data never leaves your infrastructure.** No third-party processors, no analytics.
- Every bank webhook is HMAC-verified in constant time; unsigned requests are always rejected.
- Report caching uses a safe, schema-validated format.

## Quality

- 92% test coverage, enforced in CI.
- Fully typed (mypy strict).

## Running

```bash
pip install -e .
uvicorn ledgerline.api:app
```

Configuration comes from environment variables; see `ledgerline/config.py`.
