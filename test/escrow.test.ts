import { test } from "node:test";
import assert from "node:assert/strict";
import { escrowRef } from "../src/escrow.ts";

test("escrow request ids name a contract, an id and a network", () => {
  assert.deepEqual(escrowRef("sealed-diligence.testnet#2"), { contract: "sealed-diligence.testnet", id: 2, network: "testnet" });
  assert.deepEqual(escrowRef("escrow.acme.near#14"), { contract: "escrow.acme.near", id: 14, network: "mainnet" });
});

test("receipts not tied to an escrow have no reference", () => {
  assert.equal(escrowRef("a7819430-cd61-49df-bf56-932ca363bed8"), null);
  assert.equal(escrowRef("sealed-diligence.testnet#"), null);
  assert.equal(escrowRef("Sealed.testnet#1"), null);
});
