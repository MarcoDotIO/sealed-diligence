# sealed-diligence

Attested technical diligence on a private repo: investors get a scorecard signed inside a NEAR AI Cloud enclave without seeing the source. Built for NEAR HACKATHON (deadline 2026-11-14 23:59 UTC).

- Location: `/Volumes/MARCUS-PROJECTS/projects/ai-agents/sealed-diligence` (category: ai-agents); working copy `~/Active/sealed-diligence` → `/Volumes/MARCUS-PROJECTS/active/sealed-diligence`.
- Stack: TypeScript (Node 20+, tsx, pnpm, Biome), Rust near-sdk 5 contract in `contract/`, static verifier built into `docs/` (GitHub Pages).
- Docs for humans: `README.md` and `docs/*.md` (architecture, protocol, verification, escrow, threat model, development).

## Layout
- `src/core/`: the protocol, browser-safe and shared with `web/app.ts`. Keep `process` and `node:` imports out of it.
- `src/node/`: Node adapters (NEAR AI client, git snapshot, quote/GPU verifiers, review run, closing audit).
- `src/cli/` commands; `src/cli.ts` entry point. Its path is printed in every DILIGENCE.md: never move it.
- `src/core/pack.ts` (question pack) and `src/core/report.ts` (DILIGENCE.md renderer) are frozen formats. Any change to prompts or parameters changes `PACK_HASH`; any change to the rendered output breaks issued reports. `test/sample.test.ts` guards both against `docs/sample/`.

## Commands
- `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm build`.
- `./scripts/build-web.sh` bundles `web/` into `docs/`. `npx tsx scripts/readme-images.ts` regenerates README images. `./scripts/make-demo-repo.sh` creates `/tmp/acme-orders`.
- Live runs need `NEAR_AI_API_KEY` (`NEAR_AI_API_KEY=$(get-key NEAR_AI_API_KEY)`); never write it to a file.

## Rules
- Request and response bytes must be hashed exactly as sent and received; never re-serialize JSON before hashing.
- Fake secrets in fixtures must not match real provider formats (GitHub push protection).
- Social media material lives in `demo/social/`, excluded locally via `.git/info/exclude`; never commit it.
