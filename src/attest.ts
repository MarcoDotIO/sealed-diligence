// Verification of NEAR AI Cloud model attestations, following
// https://docs.near.ai/cloud/verification (model attestations, quote/nonce/signer binding).
// Each check is reported separately so the verifier can show exactly what passed.
import { createHash } from "node:crypto";
import { js_get_collateral, js_verify } from "@phala/dcap-qvl-node";

export const API_BASE = process.env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai";
const INTEL_PCS = "https://api.trustedservices.intel.com/tdx/certification/v4";
const NVIDIA_NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";

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

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface AttestationResult {
  ok: boolean;
  signingAddress: string;
  signingAlgo: string;
  checks: Check[];
}

/** Fetch the NEAR model attestation report for `model`, bound to `nonceHex`. Returns parsed JSON. */
export async function fetchModelAttestations(model: string, nonceHex: string, apiKey?: string) {
  const url = new URL(`${API_BASE}/v1/attestation/report`);
  url.searchParams.set("model", model);
  url.searchParams.set("provider", "near");
  url.searchParams.set("signing_algo", "ed25519");
  url.searchParams.set("nonce", nonceHex);
  url.searchParams.set("include_tls_fingerprint", "false");
  const headers: Record<string, string> = { Accept: "application/json", "x-no-aliasing": "true" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`attestation report: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { model_attestations?: ModelAttestation[] };
  if (!body.model_attestations?.length) throw new Error("attestation report has no NEAR model attestations");
  return body.model_attestations;
}

const sha384 = (b: Buffer) => createHash("sha384").update(b).digest();

/** Replay imr=3 events into RTMR3 as documented; also re-derives each event digest. */
export function replayRtmr3(eventLog: EventLogEntry[]): { rtmr3: string; digestsOk: boolean } {
  let rtmr = Buffer.alloc(48);
  let digestsOk = true;
  for (const e of eventLog) {
    if (e.imr !== 3) continue;
    const type = Buffer.alloc(4);
    type.writeUInt32LE(e.event_type >>> 0);
    const digest = sha384(
      Buffer.concat([type, Buffer.from(":"), Buffer.from(e.event, "utf8"), Buffer.from(":"), Buffer.from(e.event_payload, "hex")]),
    );
    if (e.digest && e.digest.toLowerCase() !== digest.toString("hex")) digestsOk = false;
    rtmr = sha384(Buffer.concat([rtmr, digest]));
  }
  return { rtmr3: rtmr.toString("hex"), digestsOk };
}

function tcbInfo(att: ModelAttestation): { app_compose: string; [k: string]: unknown } {
  const raw = att.info.tcb_info;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

/**
 * Run every documented check on one model attestation against the nonce the caller generated.
 * Network: Intel PCS (quote collateral) and NVIDIA NRAS (GPU verdict). Set `skipGpu` to avoid NRAS.
 */
export async function verifyModelAttestation(
  att: ModelAttestation,
  nonceHex: string,
  opts: { skipGpu?: boolean; now?: Date } = {},
): Promise<AttestationResult> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  add("signing algorithm is ed25519", att.signing_algo === "ed25519", att.signing_algo);
  add("report echoes our nonce", att.request_nonce?.toLowerCase() === nonceHex.toLowerCase());

  // 1. Intel TDX quote.
  let reportData = "";
  let mrConfig = "";
  let rtmr3 = "";
  try {
    const quote = Buffer.from(att.intel_quote, "hex");
    const collateral = await js_get_collateral(INTEL_PCS, quote);
    const now = BigInt(Math.floor((opts.now ?? new Date()).getTime() / 1000));
    const result: any = js_verify(quote, collateral, now);
    const td = result?.report?.TD10 ?? result?.report?.TD15 ?? {};
    reportData = String(td.report_data ?? "").toLowerCase();
    mrConfig = String(td.mr_config_id ?? "").toLowerCase();
    rtmr3 = String(td.rt_mr3 ?? td.rtmr3 ?? "").toLowerCase();
    // OutOfDate means the platform TCB is behind Intel's latest advisory, not a broken signature.
    const status = String(result?.status ?? "");
    add("Intel TDX quote verifies", status === "UpToDate" || status === "OutOfDate", status);
  } catch (e) {
    add("Intel TDX quote verifies", false, (e as Error).message);
  }

  // 2. Report data = signing key (32 bytes) || our nonce (32 bytes).
  const key = Buffer.from(att.signing_address.replace(/^0x/, ""), "hex");
  const expectedFirst = Buffer.concat([key, Buffer.alloc(Math.max(0, 32 - key.length))]).toString("hex");
  add("quote binds the signing key", reportData.slice(0, 64) === expectedFirst);
  add("quote binds our nonce", reportData.slice(64, 128) === nonceHex.toLowerCase());

  // 3. RTMR3 event log replay.
  const log: EventLogEntry[] = typeof att.event_log === "string" ? JSON.parse(att.event_log) : att.event_log;
  const replay = replayRtmr3(log);
  add("event log replays to the quote's RTMR3", replay.digestsOk && rtmr3 !== "" && replay.rtmr3 === rtmr3);

  // 4. Measured configuration (app_compose) matches MRCONFIGID = 01 || sha256(app_compose) || 15 zero bytes.
  const compose = tcbInfo(att).app_compose;
  const composeHash = createHash("sha256").update(compose, "utf8").digest("hex");
  const expectedMr = "01" + composeHash + "00".repeat(15);
  add("measured app config matches MRCONFIGID", mrConfig === expectedMr, composeHash);

  // 5. NVIDIA GPU evidence.
  if (!opts.skipGpu) {
    if (!att.nvidia_payload) add("GPU attestation (NVIDIA NRAS)", false, "no GPU evidence");
    else {
      try {
        const payload = JSON.parse(att.nvidia_payload) as { nonce: string };
        if (payload.nonce.toLowerCase() !== nonceHex.toLowerCase()) throw new Error("GPU payload nonce mismatch");
        const res = await fetch(NVIDIA_NRAS, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: att.nvidia_payload,
        });
        const body = (await res.json()) as [string, string][];
        const jwt = body[0][1];
        const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
        add("GPU attestation (NVIDIA NRAS)", claims["x-nvidia-overall-att-result"] === true);
      } catch (e) {
        add("GPU attestation (NVIDIA NRAS)", false, (e as Error).message);
      }
    }
  }

  return {
    ok: checks.every((c) => c.ok),
    signingAddress: att.signing_address.toLowerCase(),
    signingAlgo: att.signing_algo,
    checks,
  };
}

/** The nonce for a diligence session: binds the attestation to this commit, question pack and request. */
export function sessionNonce(parts: { commit: string; packHash: string; requestId: string; salt: string }): string {
  return createHash("sha256")
    .update(`sealed-diligence/v1|${parts.commit}|${parts.packHash}|${parts.requestId}|${parts.salt}`)
    .digest("hex");
}
