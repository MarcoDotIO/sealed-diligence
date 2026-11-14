#!/bin/sh
# The demo, one step per Enter press, for screen recording.
# Needs NEAR_AI_API_KEY. Writes to /tmp/sealed-demo. Escrow steps use sealed-diligence.testnet.
set -e
cd "$(dirname "$0")/.."
OUT=/tmp/sealed-demo
ESCROW=sealed-diligence.testnet
FOUNDER=${FOUNDER:-sealed-diligence.testnet}
INVESTOR=${INVESTOR:-sealed-diligence.testnet}
mkdir -p "$OUT"

step() { printf '\n\033[1m▶ %s\033[0m  (Enter)' "$1"; read -r _; }

step "A founder's private repo. Look at what's hiding in it"
./scripts/make-demo-repo.sh /tmp/acme-orders
sed -n '5,7p' /tmp/acme-orders/src/server.ts
grep -n "LIVE\|_live_" /tmp/acme-orders/src/payments.ts | head -1

step "The investor opens an escrowed diligence request on NEAR, pinning commit, questions and enclave key"
ID=$(near contract call-function as-read-only "$ESCROW" next_id json-args '{}' network-config testnet now 2>/dev/null | tail -1 | tr -dc 0-9)
COMMIT=$(git -C /tmp/acme-orders rev-parse HEAD)
PACK=$(npx tsx -e 'import("./src/pack.ts").then(m => console.log(m.PACK_HASH))')
KEY=$(npx tsx scripts/check-attestation.ts | awk '/^PASS/ {print $2; exit}')
printf '{"founder":"%s","commit":"%s","pack_hash":"%s","model":"deepseek-ai/DeepSeek-V4.1-Flash-1017","enclave_key":"%s","timeout_hours":72}' \
  "$FOUNDER" "$COMMIT" "$PACK" "$KEY" > "$OUT/create-args.json"
near contract call-function as-transaction "$ESCROW" create_request file-args "$OUT/create-args.json" \
  prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as "$INVESTOR" network-config testnet sign-with-legacy-keychain send 2>&1 | grep -E "EVENT_JSON|explorer"

step "The founder runs a sealed review: the enclave is attested before any code leaves the machine"
npx tsx src/cli.ts review /tmp/acme-orders --label "Acme Orders" --request "$ESCROW#$ID" --out "$OUT"

step "The investor verifies it without ever seeing the source"
npx tsx src/cli.ts verify "$OUT/receipt.json" "$OUT/DILIGENCE.md"

step "The founder tries to bump the score"
sed -i '' -E 's/overall ([0-9]+)\/100/overall 94\/100/' "$OUT/DILIGENCE.md"
npx tsx src/cli.ts verify "$OUT/receipt.json" "$OUT/DILIGENCE.md" || true

step "The seal goes on-chain: the contract checks the enclave signature and pays for the report"
npx tsx src/cli.ts fulfil-args "$OUT/receipt.json" --out "$OUT/fulfil-args.json"
near contract call-function as-transaction "$ESCROW" fulfil file-args "$OUT/fulfil-args.json" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$FOUNDER" network-config testnet sign-with-legacy-keychain send 2>&1 | grep -E "EVENT_JSON|explorer"
