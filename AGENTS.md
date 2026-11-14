# sealed-diligence

Attested technical diligence on a private repo: investors get a scorecard signed inside a NEAR AI Cloud enclave without seeing the source. Built for NEAR HACKATHON (deadline 2026-11-14 23:59 UTC).

- Location: `/Volumes/MARCUS-PROJECTS/projects/ai-agents/sealed-diligence` (category: ai-agents); working copy `~/Active/sealed-diligence` → `/Volumes/MARCUS-PROJECTS/active/sealed-diligence`.
- Stack: TypeScript (Node 20+, tsx, pnpm), Rust near-sdk 5 contract in `contract/`, static verifier built into `docs/` (GitHub Pages).

## Layout
- `src/evidence.ts` browser-safe attestation checks; `src/attest.ts` Node fetch + dcap-qvl-node + NRAS.
- `src/sig.ts`, `src/receipt.ts`, `src/render.ts`, `src/pack.ts` are browser-safe and shared with `web/app.ts`. Keep `process`/`node:` imports out of them.
- `src/pack.ts` defines the question pack. Any change to prompts or parameters changes `PACK_HASH`; regenerate `docs/sample/` afterwards.
- `src/review.ts` orchestrates; `src/verify.ts` full verify + closing audit; `src/cli.ts` entry point.

## Commands
- `pnpm test` (pipeline with a fake enclave), `npx tsc --noEmit -p .`, `cd contract && cargo test`, `cargo near build non-reproducible-wasm`.
- `./scripts/build-web.sh` bundles `web/` into `docs/`. `./scripts/make-demo-repo.sh` creates `/tmp/acme-orders`.
- Live runs need `NEAR_AI_API_KEY` (`NEAR_AI_API_KEY=$(get-key NEAR_AI_API_KEY)`); never write it to a file.

## Rules
- Request and response bytes must be hashed exactly as sent and received; never re-serialize JSON before hashing.
- Fake secrets in fixtures must not match real provider formats (GitHub push protection).
