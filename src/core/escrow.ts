/**
 * Reads the on-chain escrow request a receipt names and checks it was paid for with this exact seal.
 * Browser-safe: plain NEAR JSON-RPC over `fetch`.
 *
 * The escrow contract (`contract/`) pins the founder, commit, question pack, model and enclave key when the
 * investor opens a request, and pays the founder only after `env::ed25519_verify` accepts the seal. A
 * fulfilled request whose pinned values match the receipt is independent evidence that the contract
 * already checked this seal.
 * @module
 */
import { type Check, errorMessage } from "./checks.ts";
import type { Receipt } from "./receipt.ts";

/** Public RPC endpoints, tried in order (both allow browser requests). */
const RPC_ENDPOINTS = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
} as const;

/** A NEAR network the escrow can live on. */
export type Network = keyof typeof RPC_ENDPOINTS;

/** The contract's `get_request` view, as JSON. */
export interface EscrowRecord {
  request_id: string;
  investor: string;
  founder: string;
  commit: string;
  pack_hash: string;
  model: string;
  enclave_key: string;
  /** Yoctonear, as a decimal string. */
  fee: string;
  status: "Open" | "Fulfilled" | "Refunded";
  /** The signed seal text the contract accepted, once fulfilled. */
  seal_text: string | null;
}

/** Where an escrow request lives. */
export interface EscrowRef {
  contract: string;
  id: number;
  network: Network;
}

const ESCROW_REQUEST_ID = /^([a-z0-9._-]+\.(?:near|testnet))#(\d+)$/;
const RPC_ERROR_EXCERPT = 120;

/** Parse `"sealed-diligence.testnet#2"` into contract and id; `null` for receipts not tied to an escrow. */
export function escrowRef(requestId: string): EscrowRef | null {
  const match = ESCROW_REQUEST_ID.exec(requestId);
  if (!match) return null;
  const contract = match[1];
  return { contract, id: Number(match[2]), network: contract.endsWith(".testnet") ? "testnet" : "mainnet" };
}

/** Fetch the request's on-chain record, failing over across the network's RPC endpoints. */
export async function fetchEscrowRecord(ref: EscrowRef): Promise<EscrowRecord | null> {
  return firstSuccessful(RPC_ENDPOINTS[ref.network], (rpc) => viewRequest(rpc, ref));
}

/** Try `attempt` on each endpoint in turn; rethrow the last error if all fail. */
async function firstSuccessful<T>(endpoints: readonly string[], attempt: (endpoint: string) => Promise<T>): Promise<T> {
  let lastError: unknown = new Error("no RPC endpoints configured");
  for (const endpoint of endpoints) {
    try {
      return await attempt(endpoint);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Call the contract's `get_request` view method through one RPC endpoint. */
async function viewRequest(rpc: string, ref: EscrowRef): Promise<EscrowRecord | null> {
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
  if (!body.result) throw new Error(`RPC error ${JSON.stringify(body.error).slice(0, RPC_ERROR_EXCERPT)}`);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result)));
}

/** Names of the pinned values that differ between the chain and the receipt. */
function mismatches(record: EscrowRecord, receipt: Receipt): string[] {
  const pairs: [name: string, onChain: string | null, inReceipt: string][] = [
    ["commit", record.commit, receipt.commit],
    ["question pack", record.pack_hash, receipt.pack_hash],
    ["model", record.model, receipt.model],
    ["enclave key", record.enclave_key, receipt.enclave_key.toLowerCase()],
    ["seal", record.seal_text, receipt.seal.signature.text],
  ];
  return pairs.filter(([, onChain, inReceipt]) => onChain !== inReceipt).map(([name]) => name);
}

/**
 * Whether the receipt's escrow request was fulfilled with this seal. `null` when the receipt isn't tied
 * to an escrow; a check with `ok: null` when NEAR RPC can't be reached.
 */
export async function escrowCheck(receipt: Receipt): Promise<Check | null> {
  const ref = escrowRef(receipt.request_id);
  if (!ref) return null;
  const name = `Escrow ${ref.contract} request #${ref.id} was paid for this seal`;
  try {
    const record = await fetchEscrowRecord(ref);
    if (!record) return { name, ok: false, detail: "no such request on-chain" };
    if (record.status !== "Fulfilled") return { name, ok: false, detail: `request is ${record.status}` };
    const differs = mismatches(record, receipt);
    return { name, ok: differs.length === 0, detail: differs.length ? `on-chain ${differs.join(", ")} differ` : undefined };
  } catch (error) {
    return { name, ok: null, detail: `couldn't reach NEAR RPC: ${errorMessage(error)}` };
  }
}
