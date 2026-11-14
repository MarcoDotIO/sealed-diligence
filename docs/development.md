# Development

## Setup

Node 20+, pnpm and git for the TypeScript; Rust with `cargo-near` for the contract; Google Chrome only for regenerating screenshots.

```bash
pnpm install
```

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Type-check, the TypeScript tests (pipeline against a fake enclave, escrow ids, the published sample), then the contract tests |
| `pnpm lint` | Biome (lint and format check) on the TypeScript; `cargo fmt --check` and `cargo clippy -D warnings` on the contract |
| `pnpm format` | Apply Biome's formatting and safe fixes, and `cargo fmt` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Type-check, bundle the verifier into `docs/`, build the contract wasm |
| `./scripts/build-web.sh` | Bundle `web/app.ts` into `docs/app.js` and copy the page and assets |
| `npx tsx scripts/readme-images.ts` | Regenerate the README banner and verifier screenshots (needs Chrome and a built site) |
| `npx tsx scripts/check-attestation.ts` | Fetch and fully verify a live NEAR AI attestation (no key needed) |
| `./scripts/make-demo-repo.sh` | Create `/tmp/acme-orders`, the demo repo with planted problems |

TypeScript 7 ships without the JavaScript API that typescript-eslint needs, so linting uses [Biome](https://biomejs.dev) (`biome.json`).

## Layout rules

- **`src/core/` stays browser-safe.** No `node:` imports and no `process`. The web verifier bundles it.
- **`src/core/pack.ts` and `src/core/report.ts` are frozen formats.** Changing a prompt or parameter changes `PACK_HASH`. Changing the report's output makes every issued `DILIGENCE.md` fail its byte-for-byte check. `test/sample.test.ts` catches both against the real, already-signed sample in `docs/sample/`.
- **`src/cli.ts` must not move.** Every report prints `npx tsx src/cli.ts verify …`.
- **Hash exact bytes.** Request and response bodies are hashed as sent and received; never re-serialize JSON before hashing.
- **Fake secrets in fixtures must not match real provider formats** (GitHub push protection). The demo uses `acmepay_live_…`.

## Adding a check

1. Return a `Check` (`{ name, ok, detail? }`) from the module that owns the data: `core/attestation.ts`, `core/receipt.ts` or `core/escrow.ts`.
2. Wire it into `verifyReceipt` (`core/verify.ts`) under the right group. The CLI and the browser pick it up automatically.
3. Use `ok: null` only for "couldn't run here", never for "didn't apply".
4. Add a tamper case to `test/pipeline.test.ts` that makes it fail.

## Live runs

Producing a report needs a NEAR AI Cloud API key in `NEAR_AI_API_KEY`. Keep it in the environment, never in a file in the repo. `NEAR_AI_BASE_URL` and `SEALED_DILIGENCE_MODEL` override the endpoint and the model (the model is part of the pack hash).

## Regenerating the sample

After a pack change, run a live review of `/tmp/acme-orders` against a new escrow request (see [escrow](escrow.md)). Copy `receipt.json` and `DILIGENCE.md` into `docs/sample/`, run `./scripts/build-web.sh` and `npx tsx scripts/readme-images.ts`, and update the request id quoted in the README and the docs.
