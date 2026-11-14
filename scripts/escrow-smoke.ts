// Dev aid: produce a fake-enclave receipt for /tmp/acme-orders bound to an escrow request id,
// to exercise create_request/fulfil on testnet before a NEAR AI key is available.
import { writeFileSync } from "node:fs";
import { runReview } from "../src/review.ts";
import { PACK_HASH, MODEL } from "../src/pack.ts";
import { fakeEnclave } from "../test/fake-enclave.ts";

const [requestId, outDir] = process.argv.slice(2);
const receipt = await runReview({ repo: "/tmp/acme-orders", requestId, repoLabel: "Acme Orders", enclave: await fakeEnclave() });
writeFileSync(`${outDir}/receipt.json`, JSON.stringify(receipt));
writeFileSync(
  `${outDir}/create-args.json`,
  JSON.stringify({ founder: "sealed-diligence.testnet", commit: receipt.commit, pack_hash: PACK_HASH, model: MODEL, enclave_key: receipt.enclave_key, timeout_hours: 72 }),
);
console.log(`receipt for ${requestId} at commit ${receipt.commit.slice(0, 12)}`);
