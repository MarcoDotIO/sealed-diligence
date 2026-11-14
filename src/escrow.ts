// Reads the escrow request named by a receipt (request id "<contract>#<n>") and checks that the
// on-chain record was paid for with this exact seal. Browser-safe: plain JSON-RPC over fetch.
import type { Check } from "./evidence.ts";
import type { Receipt } from "./receipt.ts";

const RPC = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
};

export interface EscrowRecord {
  request_id: string;
  investor: string;
  founder: string;
  commit: string;
  pack_hash: string;
  model: string;
  enclave_key: string;
  fee: string;
  status: "Open" | "Fulfilled" | "Refunded";
  seal_text: string | null;
}

export interface EscrowRef {
  contract: string;
  id: number;
  network: keyof typeof RPC;
}

/** "sealed-diligence.testnet#2" → contract + id; null for receipts not tied to an escrow. */
export function escrowRef(requestId: string): EscrowRef | null {
  const match = /^([a-z0-9._-]+\.(?:near|testnet))#(\d+)$/.exec(requestId);
  if (!match) return null;
  return { contract: match[1], id: Number(match[2]), network: match[1].endsWith(".testnet") ? "testnet" : "mainnet" };
}

async function callView(rpc: string, ref: EscrowRef): Promise<EscrowRecord | null> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "sealed-diligence",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: ref.contract,
        method_name: "get_request",
        args_base64: btoa(JSON.stringify({ id: ref.id })),
      },
    }),
  });
  const body = (await res.json()) as { result?: { result: number[] }; error?: unknown };
  if (!body.result) throw new Error(`RPC error ${JSON.stringify(body.error).slice(0, 120)}`);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result)));
}

export async function fetchEscrowRecord(ref: EscrowRef): Promise<EscrowRecord | null> {
  let lastError: unknown;
  for (const rpc of RPC[ref.network]) {
    try {
      return await callView(rpc, ref);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function mismatches(record: EscrowRecord, r: Receipt): string[] {
  const expected: [string, string | null, string][] = [
    ["commit", record.commit, r.commit],
    ["question pack", record.pack_hash, r.pack_hash],
    ["model", record.model, r.model],
    ["enclave key", record.enclave_key, r.enclave_key.toLowerCase()],
    ["seal", record.seal_text, r.seal.signature.text],
  ];
  return expected.filter(([, onChain, local]) => onChain !== local).map(([name]) => name);
}

/** null when the receipt isn't tied to an escrow request. */
export async function escrowCheck(r: Receipt): Promise<Check | null> {
  const ref = escrowRef(r.request_id);
  if (!ref) return null;
  const name = `Escrow ${ref.contract} request #${ref.id} was paid for this seal`;
  try {
    const record = await fetchEscrowRecord(ref);
    if (!record) return { name, ok: false, detail: "no such request on-chain" };
    if (record.status !== "Fulfilled") return { name, ok: false, detail: `request is ${record.status}` };
    const differs = mismatches(record, r);
    return { name, ok: differs.length === 0, detail: differs.length ? `on-chain ${differs.join(", ")} differ` : undefined };
  } catch (e) {
    return { name, ok: null, detail: `couldn't reach NEAR RPC: ${e instanceof Error ? e.message : String(e)}` };
  }
}
