/**
 * Verifies a NEAR AI Cloud model attestation: proof that the model runs in an Intel TDX + NVIDIA GPU
 * enclave and that its signing key lives there. Browser-safe.
 *
 * Follows https://docs.near.ai/cloud/verification/model-attestations:
 *  1. the Intel TDX quote verifies against Intel's collateral;
 *  2. the quote's report data is `signing key (32 bytes) || session nonce (32 bytes)`;
 *  3. replaying the event log reproduces the quote's RTMR3;
 *  4. MRCONFIGID is `0x01 || sha256(app_compose) || 15 zero bytes` (dstack's layout);
 *  5. NVIDIA's attestation service accepts the GPU evidence, which echoes the same nonce.
 *
 * The two steps that need outside services are injected as an {@link EvidenceVerifiers} strategy:
 * dcap-qvl-node plus NVIDIA NRAS in the CLI, dcap-qvl-web in the browser.
 * @module
 */
import { sha384 } from "@noble/hashes/sha2.js";
import { concatBytes, fromHex, sha256Hex, toHex, utf8Bytes } from "./bytes.ts";
import { type Check, errorMessage } from "./checks.ts";

/** One entry of NEAR AI's `GET /v1/attestation/report` → `model_attestations`. */
export interface ModelAttestation {
  model_name: string;
  /** The enclave's ed25519 public key, hex. */
  signing_address: string;
  signing_algo: string;
  request_nonce: string;
  intel_quote: string;
  nvidia_payload?: string;
  event_log: EventLogEntry[] | string;
  info: { tcb_info: string | { app_compose: string; [k: string]: unknown }; [k: string]: unknown };
  [k: string]: unknown;
}

/** A dstack event log entry. Only `imr: 3` entries extend RTMR3. */
interface EventLogEntry {
  imr: number;
  event_type: number;
  digest: string;
  event: string;
  event_payload: string;
}

/** The outcome of verifying one attestation. */
export interface AttestationResult {
  ok: boolean;
  /** The attested signing key, lowercase hex without `0x`. */
  signingAddress: string;
  checks: Check[];
}

/** The fields of a verified TDX quote (dcap-qvl's TD10/TD15 report) that the checks compare. */
export interface QuoteVerdict {
  status: string;
  reportData: string;
  mrConfig: string;
  rtmr3: string;
}

/**
 * The environment-specific half of attestation (Strategy pattern). The CLI, the browser and the tests
 * each supply their own.
 */
export interface EvidenceVerifiers {
  /** Verify a raw TDX quote against Intel collateral and return its measured fields. */
  verifyQuote(quote: Uint8Array): Promise<QuoteVerdict>;
  /** NVIDIA's verdict on the GPU evidence, or `null` when NRAS can't be reached from here. */
  verifyGpu(payloadJson: string): Promise<boolean | null>;
}

/** Intel's TDX collateral service. Browsers use a CORS-enabled mirror instead. */
export const INTEL_PCS = "https://api.trustedservices.intel.com/tdx/certification/v4";
/** NVIDIA Remote Attestation Service (refuses cross-origin browser requests). */
export const NVIDIA_NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";

/** `OutOfDate` means the platform's TCB trails Intel's latest advisory; the quote signature still verifies. */
const ACCEPTED_QUOTE_STATUSES = new Set(["UpToDate", "OutOfDate"]);
const RTMR3_INDEX = 3;
const RTMR_BYTES = 48;
const KEY_HEX_CHARS = 64;
const MRCONFIG_PREFIX = "01";
const MRCONFIG_PADDING = "00".repeat(15);
const NONCE_DOMAIN = "sealed-diligence/v1";

/** The values a review session's attestation nonce is derived from. */
export interface NonceInputs {
  commit: string;
  packHash: string;
  requestId: string;
  /** Random per session, so two sessions never share a nonce. */
  salt: string;
}

/**
 * The attestation nonce for one review session. Binding the commit, question pack and request id into
 * the nonce lets the investor check that the attestation was fetched for this review, not replayed.
 */
export function sessionNonce(inputs: NonceInputs): string {
  return sha256Hex(`${NONCE_DOMAIN}|${inputs.commit}|${inputs.packHash}|${inputs.requestId}|${inputs.salt}`);
}

/** Replay the `imr: 3` events into RTMR3, re-deriving each event's digest on the way. */
export function replayRtmr3(eventLog: EventLogEntry[]): { rtmr3: string; digestsOk: boolean } {
  let rtmr: Uint8Array = new Uint8Array(RTMR_BYTES);
  let digestsOk = true;
  for (const event of eventLog.filter((e) => e.imr === RTMR3_INDEX)) {
    const digest = eventDigest(event);
    if (event.digest && event.digest.toLowerCase() !== toHex(digest)) digestsOk = false;
    rtmr = sha384(concatBytes([rtmr, digest]));
  }
  return { rtmr3: toHex(rtmr), digestsOk };
}

/** dstack's event digest: `sha384(le32(event_type) || ":" || event || ":" || payload)`. */
function eventDigest(event: EventLogEntry): Uint8Array {
  const type = new Uint8Array(4);
  new DataView(type.buffer).setUint32(0, event.event_type >>> 0, true);
  return sha384(concatBytes([type, utf8Bytes(":"), utf8Bytes(event.event), utf8Bytes(":"), fromHex(event.event_payload || "")]));
}

/** Run every attestation check on `att` against the session nonce `nonceHex`. */
export async function verifyEvidence(att: ModelAttestation, nonceHex: string, verifiers: EvidenceVerifiers): Promise<AttestationResult> {
  const nonce = nonceHex.toLowerCase();
  const { quote, check: quoteCheck } = await verifiedQuote(att, verifiers);
  const checks: Check[] = [
    { name: "Signing algorithm is ed25519", ok: att.signing_algo === "ed25519" },
    { name: "Report echoes the session nonce", ok: att.request_nonce?.toLowerCase() === nonce },
    quoteCheck,
    ...measurementChecks(att, quote, nonce),
    await gpuCheck(att, nonce, verifiers),
  ];
  return { ok: checks.every((c) => c.ok !== false), signingAddress: normalizedKey(att.signing_address), checks };
}

function normalizedKey(signingAddress: string): string {
  return signingAddress.replace(/^0x/, "").toLowerCase();
}

const NO_QUOTE: QuoteVerdict = { status: "", reportData: "", mrConfig: "", rtmr3: "" };

async function verifiedQuote(att: ModelAttestation, verifiers: EvidenceVerifiers): Promise<{ quote: QuoteVerdict; check: Check }> {
  const name = "Intel TDX quote verifies";
  try {
    const quote = await verifiers.verifyQuote(fromHex(att.intel_quote));
    return { quote, check: { name, ok: ACCEPTED_QUOTE_STATUSES.has(quote.status), detail: quote.status } };
  } catch (error) {
    return { quote: NO_QUOTE, check: { name, ok: false, detail: errorMessage(error) } };
  }
}

/** Checks that compare what the quote measured with what the attestation claims. */
function measurementChecks(att: ModelAttestation, quote: QuoteVerdict, nonce: string): Check[] {
  const key = normalizedKey(att.signing_address);
  const replay = replayRtmr3(parsedIfString<EventLogEntry[]>(att.event_log));
  const composeHash = sha256Hex(parsedIfString<{ app_compose: string }>(att.info.tcb_info).app_compose);
  const expectedMrConfig = MRCONFIG_PREFIX + composeHash + MRCONFIG_PADDING;
  return [
    { name: "Quote binds the signing key", ok: quote.reportData.slice(0, KEY_HEX_CHARS) === key.padEnd(KEY_HEX_CHARS, "0") },
    { name: "Quote binds the session nonce", ok: quote.reportData.slice(KEY_HEX_CHARS, 2 * KEY_HEX_CHARS) === nonce },
    { name: "Event log replays to the quote's RTMR3", ok: replay.digestsOk && quote.rtmr3 !== "" && replay.rtmr3 === quote.rtmr3 },
    { name: "Measured app config matches MRCONFIGID", ok: quote.mrConfig === expectedMrConfig, detail: composeHash },
  ];
}

/** NEAR AI sends some nested structures as JSON strings and others as objects. */
function parsedIfString<T>(value: string | T): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

async function gpuCheck(att: ModelAttestation, nonce: string, verifiers: EvidenceVerifiers): Promise<Check> {
  const name = "GPU attestation (NVIDIA NRAS)";
  if (!att.nvidia_payload) return { name, ok: false, detail: "no GPU evidence" };
  const payload = JSON.parse(att.nvidia_payload) as { nonce: string };
  if (payload.nonce.toLowerCase() !== nonce) return { name, ok: false, detail: "GPU payload nonce mismatch" };
  try {
    const verdict = await verifiers.verifyGpu(att.nvidia_payload);
    return { name, ok: verdict, detail: verdict === null ? "NVIDIA's service doesn't accept browser requests; run the CLI" : undefined };
  } catch (error) {
    return { name, ok: false, detail: errorMessage(error) };
  }
}

function field(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Map dcap-qvl's `verify()` output (Node and WebAssembly builds alike) to the fields the checks compare. */
export function quoteVerdictFromDcap(result: unknown): QuoteVerdict {
  const report = field(result, "report");
  const td = field(report, "TD10") ?? field(report, "TD15");
  const hex = (key: string) => String(field(td, key) ?? "").toLowerCase();
  return {
    status: String(field(result, "status") ?? ""),
    reportData: hex("report_data"),
    mrConfig: hex("mr_config_id"),
    rtmr3: hex("rt_mr3"),
  };
}

/** NRAS answers `[["JWT", token], ...]`; the overall verdict is a claim in the first token. */
export function nrasVerdict(body: unknown): boolean {
  const jwt = (body as [string, string][])[0][1];
  const payload = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const claims = JSON.parse(atob(payload + "=".repeat((4 - (payload.length % 4)) % 4)));
  return claims["x-nvidia-overall-att-result"] === true;
}
