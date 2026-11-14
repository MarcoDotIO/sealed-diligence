// Guards the published sample (docs/sample, escrow request sealed-diligence.testnet#2): any change to the
// question pack, the receipt format or the report renderer would make a real, already-signed report fail.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PACK_HASH } from "../src/core/pack.ts";
import { type Receipt, verifySignatures } from "../src/core/receipt.ts";
import { renderDiligence } from "../src/core/report.ts";

const SAMPLE = new URL("../docs/sample/", import.meta.url);
const receipt = JSON.parse(readFileSync(new URL("receipt.json", SAMPLE), "utf8")) as Receipt;
const diligence = readFileSync(new URL("DILIGENCE.md", SAMPLE), "utf8");

test("the question pack still hashes to the one the sample was signed under", () => {
  assert.equal(PACK_HASH, receipt.pack_hash);
});

test("the sample report re-renders byte for byte", () => {
  assert.equal(renderDiligence(receipt), diligence);
});

test("every signature in the sample still verifies", async () => {
  const failed = (await verifySignatures(receipt)).filter((c) => c.ok !== true);
  assert.deepEqual(failed, []);
});
