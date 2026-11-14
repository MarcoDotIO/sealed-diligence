#!/bin/sh
# Run the whole demo for real and save each step's output for the video. Nothing in the video is mocked:
# the terminal scenes replay these captured outputs, and the browser scene opens the receipt produced here.
# Needs NEAR_AI_API_KEY and FOUNDER_KEY (the founder's testnet private key) in the environment.
set -e
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
CAP="$ROOT/demo/video/capture"
ESCROW=sealed-diligence.testnet
INVESTOR=sealed-diligence.testnet
FOUNDER=marcodotio-testnet.testnet
MODEL=deepseek-ai/DeepSeek-V4.1-Flash-1017
rm -rf "$CAP" && mkdir -p "$CAP"

# near CLI prints the full command (including any key) when it finishes; keep only event and explorer lines.
chain_lines() { grep -E "EVENT_JSON|transactions/" | sed -E 's/^[│ ]+//'; }

./scripts/make-demo-repo.sh /tmp/acme-orders > /dev/null
{
  echo "$ sed -n '5,6p' src/server.ts"
  sed -n '5,6p' /tmp/acme-orders/src/server.ts
  echo "$ grep -n live src/payments.ts"
  grep -n "_live_" /tmp/acme-orders/src/payments.ts
} > "$CAP/1-repo.txt"

ID=$(near contract call-function as-read-only "$ESCROW" next_id json-args '{}' network-config testnet now 2>/dev/null | tail -1 | tr -dc 0-9)
COMMIT=$(git -C /tmp/acme-orders rev-parse HEAD)
PACK=$(npx tsx -e 'import("./src/pack.ts").then(m => console.log(m.PACK_HASH))')
KEY=$(npx tsx scripts/check-attestation.ts | awk '/^PASS/ && !k {print $2; k=1}')
printf '{"founder":"%s","commit":"%s","pack_hash":"%s","model":"%s","enclave_key":"%s","timeout_hours":168}' \
  "$FOUNDER" "$COMMIT" "$PACK" "$MODEL" "$KEY" > "$CAP/create-args.json"
{
  echo "$ near contract call-function as-transaction $ESCROW create_request \\"
  echo "    commit=${COMMIT%????????????????????????????????} pack=${PACK%????????????????????????????????????????????????} enclave_key=${KEY%????????????????????????????????????????????????} fee=0.1 NEAR"
  near contract call-function as-transaction "$ESCROW" create_request file-args "$CAP/create-args.json" \
    prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as "$INVESTOR" network-config testnet sign-with-legacy-keychain send 2>&1 | chain_lines
} > "$CAP/2-request.txt"

{
  echo "$ sealed-diligence review ./acme-orders --request $ESCROW#$ID"
  npx tsx src/cli.ts review /tmp/acme-orders --label "Acme Orders" --request "$ESCROW#$ID" --out "$CAP"
} > "$CAP/3-review.txt" 2>&1

{
  echo "$ sealed-diligence verify receipt.json DILIGENCE.md"
  npx tsx src/cli.ts verify "$CAP/receipt.json" "$CAP/DILIGENCE.md"
} > "$CAP/4-verify.txt" 2>&1

cp "$CAP/DILIGENCE.md" "$CAP/DILIGENCE.tampered.md"
sed -i '' -E 's/overall ([0-9]+)\/100/overall 94\/100/' "$CAP/DILIGENCE.tampered.md"
{
  echo "$ sed -i 's/overall [0-9]*\\/100/overall 94\\/100/' DILIGENCE.md"
  echo "$ sealed-diligence verify receipt.json DILIGENCE.md"
  npx tsx src/cli.ts verify "$CAP/receipt.json" "$CAP/DILIGENCE.tampered.md" | tail -4 || true
} > "$CAP/5-tamper.txt" 2>&1

npx tsx src/cli.ts fulfil-args "$CAP/receipt.json" --out "$CAP/fulfil-args.json" > /dev/null
{
  echo "$ near contract call-function as-transaction $ESCROW fulfil (seal + enclave signature)"
  near contract call-function as-transaction "$ESCROW" fulfil file-args "$CAP/fulfil-args.json" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$FOUNDER" network-config testnet \
    sign-with-plaintext-private-key "$FOUNDER_KEY" send 2>&1 | chain_lines
} > "$CAP/6-fulfil.txt"

{
  echo "$ near contract call-function as-read-only $ESCROW get_request '{\"id\":$ID}'"
  near contract call-function as-read-only "$ESCROW" get_request json-args "{\"id\":$ID}" network-config testnet now 2>/dev/null \
    | grep -E '"(status|founder|investor|commit|fee|request_id)"'
} >> "$CAP/6-fulfil.txt"

grep -ho "https://explorer.testnet.near.org/transactions/[A-Za-z0-9]*" "$CAP"/6-fulfil.txt | head -1 > "$CAP/fulfil-tx.txt"
echo "captured request $ESCROW#$ID into $CAP"
