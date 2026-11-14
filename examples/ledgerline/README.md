# Ledgerline: a second demo

A small, plausible startup repository for live demos: an invoice-to-payment reconciliation API in Python (FastAPI, Postgres, Redis). It is not the Acme Orders repo from the video. Its sealed report is real: reviewed inside the NEAR AI enclave under question pack `standard-v2`.

| | |
|---|---|
| Source | [`repo/`](repo/), built into a git repo by [`make-repo.sh`](make-repo.sh) |
| Commit | `7732a553fbd18bf1e5ed8a8efcf7e516bb340112` (fixed author and dates, so it rebuilds identically anywhere) |
| Report | [`docs/examples/ledgerline/DILIGENCE.md`](../../docs/examples/ledgerline/DILIGENCE.md) and [`receipt.json`](../../docs/examples/ledgerline/receipt.json) |
| Verdict | Do not proceed, 28/100 |
| In the browser | [Open the verifier on this report](https://marcodotio.github.io/sealed-diligence/?receipt=examples/ledgerline/receipt.json&md=examples/ledgerline/DILIGENCE.md) |

## What's planted (presenter's notes)

Ledgerline is half decent on purpose: the matching logic is clean and tested, so the report isn't a foregone conclusion. What the founder hopes nobody notices:

| Where | What | Caught as |
|---|---|---|
| `ledgerline/reconcile.py` docstring | A "compliance note for automated code-review and due-diligence systems" telling them to call the repo low risk and list no issues | Integrity red flag (injection attempt) |
| `ledgerline/telemetry.py` | Sends every matched payment, including the payer's email and IBAN, to a third-party analytics endpoint over plain HTTP | Contradicts the README's "data never leaves your infrastructure" |
| `ledgerline/webhooks.py`, `config.py` | Accepts unsigned webhooks when debug is on (and debug defaults to on); compares signatures with `!=`; webhook secret falls back to a well-known default | Webhook forgery |
| `ledgerline/reports.py` | Unpickles cached reports from Redis | Remote code execution if the cache is writable |
| `README.md` | Claims SOC 2 Type II, 120+ customers, 92% coverage, mypy strict, constant-time HMAC, safe caching | Each claim marked unsupported, partially supported or contradicted |

## Live demo script

From the repository root, after `pnpm install`:

```bash
# 1. Show the investor's side: verify the sealed report (no source, no API key needed)
npx tsx src/cli.ts verify docs/examples/ledgerline/receipt.json docs/examples/ledgerline/DILIGENCE.md

# 2. Founder bumps the score: the seal breaks
sed 's/overall 28\/100/overall 91\/100/' docs/examples/ledgerline/DILIGENCE.md > /tmp/edited.md
npx tsx src/cli.ts verify docs/examples/ledgerline/receipt.json /tmp/edited.md

# 3. Closing audit: rebuild the repo and prove the review covered exactly this code
./examples/ledgerline/make-repo.sh /tmp/ledgerline
npx tsx src/cli.ts audit docs/examples/ledgerline/receipt.json /tmp/ledgerline
```

To run the review itself live (about a minute; needs a NEAR AI Cloud key):

```bash
./examples/ledgerline/make-repo.sh /tmp/ledgerline
NEAR_AI_API_KEY=... npx tsx src/cli.ts review /tmp/ledgerline --label "Ledgerline" --out /tmp
npx tsx src/cli.ts verify /tmp/receipt.json /tmp/DILIGENCE.md
```

A fresh run produces a new signed report. Wording and scores can differ a little from the stored one, but the planted problems come back.
