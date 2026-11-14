// Browser-safe attestation checks, following https://docs.near.ai/cloud/verification.
// The Intel quote verifier and the GPU verdict are injected: dcap-qvl-node + NRAS in the CLI,
// dcap-qvl-web (+ NRAS when reachable) in the browser.
import { sha384 } from "@noble/hashes/sha2.js";
import { fromHex, sha256Hex, toHex } from "./sig.ts";

export interface ModelAttestation {
  model_name: string;
  signing_address: string;
  signing_algo: string;
  request_nonce: string;
  intel_quote: string;
  nvidia_payload?: string;
  event_log: EventLogEntry[] | string;
  info: { tcb_info: string | { app_compose: string; [k: string]: unknown }; [k: string]: unknown };
  [k: string]: unknown;
}

interface EventLogEntry {
  imr: number;
  event_type: number;
  digest: string;
  event: string;
  event_payload: string;
}

/** One verification result. `ok: null` means "not checkable in this environment". */
export interface Check {
  name: string;
  ok: boolean | null;
  detail?: string;
}

export interface AttestationResult {
  ok: boolean;
  signingAddress: string;
  checks: Check[];
}

/** Fields from a verified TDX quote (dcap-qvl TD10 report). */
export interface QuoteVerdict {
  status: string;
  reportData: string;
  mrConfig: string;
  rtmr3: string;
}

export interface EvidenceVerifiers {
  verifyQuote(quote: Uint8Array): Promise<QuoteVerdict>;
  /** NVIDIA's verdict, or null when NRAS is unreachable from this environment. */
  verifyGpu(payloadJson: string): Promise<boolean | null>;
}

export const INTEL_PCS = "https://api.trustedservices.intel.com/tdx/certification/v4";
export const NVIDIA_NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";

/** OutOfDate = platform TCB behind Intel's latest advisory; the quote signature still verifies. */
const ACCEPTED_QUOTE_STATUSES = new Set(["UpToDate", "OutOfDate"]);
const RTMR_BYTES = 48;
const KEY_HEX_CHARS = 64;
/** MRCONFIGID layout used by dstack: 0x01 || sha256(app_compose) || 15 zero bytes. */
const MRCONFIG_PREFIX = "01";
const MRCONFIG_PADDING = "00".repeat(15);

const enc = new TextEncoder();

export function sessionNonce(parts: { commit: string; packHash: string; requestId: string; salt: string }): string {
  return sha256Hex(`sealed-diligence/v1|${parts.commit}|${parts.packHash}|${parts.requestId}|${parts.salt}`);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function eventDigest(e: EventLogEntry): Uint8Array {
  const type = new Uint8Array(4);
  new DataView(type.buffer).setUint32(0, e.event_type >>> 0, true);
  return sha384(concat([type, enc.encode(":"), enc.encode(e.event), enc.encode(":"), fromHex(e.event_payload || "")]));
}

/** Replay imr=3 events into RTMR3 as documented, re-deriving each event digest on the way. */
export function replayRtmr3(eventLog: EventLogEntry[]): { rtmr3: string; digestsOk: boolean } {
  let rtmr: Uint8Array = new Uint8Array(RTMR_BYTES);
  let digestsOk = true;
  for (const e of eventLog.filter((x) => x.imr === 3)) {
    const digest = eventDigest(e);
    if (e.digest && e.digest.toLowerCase() !== toHex(digest)) digestsOk = false;
    rtmr = sha384(concat([rtmr, digest]));
  }
  return { rtmr3: toHex(rtmr), digestsOk };
}

async function verifiedQuote(att: ModelAttestation, v: EvidenceVerifiers): Promise<{ quote: QuoteVerdict; check: Check }> {
  const empty: QuoteVerdict = { status: "", reportData: "", mrConfig: "", rtmr3: "" };
  const name = "Intel TDX quote verifies";
  try {
    const quote = await v.verifyQuote(fromHex(att.intel_quote));
    return { quote, check: { name, ok: ACCEPTED_QUOTE_STATUSES.has(quote.status), detail: quote.status } };
  } catch (e) {
    return { quote: empty, check: { name, ok: false, detail: (e as Error).message } };
  }
}

function measurementChecks(att: ModelAttestation, quote: QuoteVerdict, nonce: string): Check[] {
  const key = att.signing_address.replace(/^0x/, "").toLowerCase();
  const log: EventLogEntry[] = typeof att.event_log === "string" ? JSON.parse(att.event_log) : att.event_log;
  const replay = replayRtmr3(log);
  const tcb = typeof att.info.tcb_info === "string" ? JSON.parse(att.info.tcb_info) : att.info.tcb_info;
  const composeHash = sha256Hex(tcb.app_compose as string);
  return [
    { name: "quote binds the signing key", ok: quote.reportData.slice(0, KEY_HEX_CHARS) === key.padEnd(KEY_HEX_CHARS, "0") },
    { name: "quote binds the session nonce", ok: quote.reportData.slice(KEY_HEX_CHARS, 2 * KEY_HEX_CHARS) === nonce },
    { name: "event log replays to the quote's RTMR3", ok: replay.digestsOk && quote.rtmr3 !== "" && replay.rtmr3 === quote.rtmr3 },
    { name: "measured app config matches MRCONFIGID", ok: quote.mrConfig === MRCONFIG_PREFIX + composeHash + MRCONFIG_PADDING, detail: composeHash },
  ];
}

async function gpuCheck(att: ModelAttestation, nonce: string, v: EvidenceVerifiers): Promise<Check> {
  const name = "GPU attestation (NVIDIA NRAS)";
  if (!att.nvidia_payload) return { name, ok: false, detail: "no GPU evidence" };
  const payload = JSON.parse(att.nvidia_payload) as { nonce: string };
  if (payload.nonce.toLowerCase() !== nonce) return { name, ok: false, detail: "GPU payload nonce mismatch" };
  try {
    const verdict = await v.verifyGpu(att.nvidia_payload);
    return { name, ok: verdict, detail: verdict === null ? "NVIDIA's service doesn't accept browser requests; run the CLI" : undefined };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message };
  }
}

export async function verifyEvidence(att: ModelAttestation, nonceHex: string, v: EvidenceVerifiers): Promise<AttestationResult> {
  const nonce = nonceHex.toLowerCase();
  const { quote, check: quoteCheck } = await verifiedQuote(att, v);
  const checks: Check[] = [
    { name: "signing algorithm is ed25519", ok: att.signing_algo === "ed25519" },
    { name: "report echoes the session nonce", ok: att.request_nonce?.toLowerCase() === nonce },
    quoteCheck,
    ...measurementChecks(att, quote, nonce),
    await gpuCheck(att, nonce, v),
  ];
  return {
    ok: checks.every((c) => c.ok !== false),
    signingAddress: att.signing_address.replace(/^0x/, "").toLowerCase(),
    checks,
  };
}

function field(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Map dcap-qvl's verify() output to the fields we check. */
export function quoteVerdictFromDcap(result: unknown): QuoteVerdict {
  const report = field(result, "report");
  const td = field(report, "TD10") ?? field(report, "TD15");
  const hex = (key: string) => String(field(td, key) ?? "").toLowerCase();
  return { status: String(field(result, "status") ?? ""), reportData: hex("report_data"), mrConfig: hex("mr_config_id"), rtmr3: hex("rt_mr3") };
}

/** NRAS returns [["JWT", token], ...]; the overall verdict is a claim in the first token. */
export function nrasVerdict(body: unknown): boolean {
  const jwt = (body as [string, string][])[0][1];
  const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  return claims["x-nvidia-overall-att-result"] === true;
}
