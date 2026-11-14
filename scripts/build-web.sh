#!/bin/sh
# Build the static verifier into docs/ (served by GitHub Pages).
set -e
cd "$(dirname "$0")/.."
mkdir -p docs/sample
npx esbuild web/app.ts --bundle --format=esm --target=es2022 --outfile=docs/app.js --log-level=warning
cp web/index.html web/favicon.svg docs/
mkdir -p docs/assets && cp web/assets/* docs/assets/
cp node_modules/@phala/dcap-qvl-web/dcap-qvl-web_bg.wasm docs/
[ -f receipt.json ] && cp receipt.json DILIGENCE.md docs/sample/ || true
echo "built docs/"
