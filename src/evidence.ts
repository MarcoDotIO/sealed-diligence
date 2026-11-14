// Browser-safe attestation checks, following https://docs.near.ai/cloud/verification.
// The Intel quote verifier and the GPU verdict are injected: dcap-qvl-node + NRAS in the CLI,
// dcap-qvl-web (+ NRAS when the browser can reach it) on the web page.
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

export interface Check {
  name: string;
  ok: boolean | null; // null = not checked in this environment
  detail?: string;
}

export interface AttestationResult {
  ok: boolean;
  signingAddress: string;
  checks: Check[];
}

/** Fields from a verified TDX quote (dcap-qvl output, TD10 report). */
export interface QuoteVerdict {
  status: string;
  reportData: string;
  mrConfig: string;
  rtmr3: string;
}

export interface EvidenceVerifiers {
  verifyQuote(quote: Uint8Array): Promise<QuoteVerdict>;
  /** Return true/false for NVIDIA's verdict, or null when NRAS is unreachable from here. */
  verifyGpu?(payloadJson: string): Promise<boolean | null>;
}

const enc = new TextEncoder();

export function sessionNonce(parts: { commit: string; packHash: string; requestId: string; salt: string }): string {
  return sha256Hex(`sealed-diligence/v1|${parts.commit}|${parts.packHash}|${parts.requestId}|${parts.salt}`);
}

/** Replay imr=3 events into RTMR3 as documented; also re-derives each event digest. */
export function replayRtmr3(eventLog: EventLogEntry[]): { rtmr3: string; digestsOk: boolean } {
  let rtmr: Uint8Array = new Uint8Array(48);
  let digestsOk = true;
  for (const e of eventLog) {
    if (e.imr !== 3) continue;
    const type = new Uint8Array(4);
    new DataView(type.buffer).setUint32(0, e.event_type >>> 0, true);
    const parts = [type, enc.encode(":"), enc.encode(e.event), enc.encode(":"), fromHex(e.event_payload || "")];
    const digest = sha384(concat(parts));
    if (e.digest && e.digest.toLowerCase() !== toHex(digest)) digestsOk = false;
    rtmr = sha384(concat([rtmr, digest]));
  }
  return { rtmr3: toHex(rtmr), digestsOk };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function verifyEvidence(att: ModelAttestation, nonceHex: string, v: EvidenceVerifiers): Promise<AttestationResult> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean | null, detail?: string) => checks.push({ name, ok, detail });
  const nonce = nonceHex.toLowerCase();

  add("signing algorithm is ed25519", att.signing_algo === "ed25519");
  add("report echoes the session nonce", att.request_nonce?.toLowerCase() === nonce);

  let q: QuoteVerdict = { status: "", reportData: "", mrConfig: "", rtmr3: "" };
  try {
    q = await v.verifyQuote(fromHex(att.intel_quote));
    // OutOfDate = platform TCB behind Intel's latest advisory; the quote signature still verifies.
    add("Intel TDX quote verifies", q.status === "UpToDate" || q.status === "OutOfDate", q.status);
  } catch (e) {
    add("Intel TDX quote verifies", false, (e as Error).message);
  }

  const key = att.signing_address.replace(/^0x/, "").toLowerCase();
  add("quote binds the signing key", q.reportData.slice(0, 64) === key.padEnd(64, "0"));
  add("quote binds the session nonce", q.reportData.slice(64, 128) === nonce);

  const log: EventLogEntry[] = typeof att.event_log === "string" ? JSON.parse(att.event_log) : att.event_log;
  const replay = replayRtmr3(log);
  add("event log replays to the quote's RTMR3", replay.digestsOk && q.rtmr3 !== "" && replay.rtmr3 === q.rtmr3);

  const tcb = typeof att.info.tcb_info === "string" ? JSON.parse(att.info.tcb_info) : att.info.tcb_info;
  const composeHash = sha256Hex(tcb.app_compose as string);
  add("measured app config matches MRCONFIGID", q.mrConfig === "01" + composeHash + "00".repeat(15), composeHash);

  if (v.verifyGpu) {
    if (!att.nvidia_payload) add("GPU attestation (NVIDIA NRAS)", false, "no GPU evidence");
    else {
      const payload = JSON.parse(att.nvidia_payload) as { nonce: string };
      if (payload.nonce.toLowerCase() !== nonce) add("GPU attestation (NVIDIA NRAS)", false, "GPU payload nonce mismatch");
      else {
        try {
          const verdict = await v.verifyGpu(att.nvidia_payload);
          add("GPU attestation (NVIDIA NRAS)", verdict, verdict === null ? "NVIDIA's service is not reachable from a browser; run the CLI" : undefined);
        } catch (e) {
          add("GPU attestation (NVIDIA NRAS)", false, (e as Error).message);
        }
      }
    }
  }

  return { ok: checks.every((c) => c.ok !== false), signingAddress: key, checks };
}

/** Map dcap-qvl's verify() output to the fields we check. */
export function quoteVerdictFromDcap(result: any): QuoteVerdict {
  const td = result?.report?.TD10 ?? result?.report?.TD15 ?? {};
  return {
    status: String(result?.status ?? ""),
    reportData: String(td.report_data ?? "").toLowerCase(),
    mrConfig: String(td.mr_config_id ?? "").toLowerCase(),
    rtmr3: String(td.rt_mr3 ?? td.rtmr3 ?? "").toLowerCase(),
  };
}

/** NRAS returns [["JWT", token], ...]; the overall verdict is a claim in the first token. */
export function nrasVerdict(body: unknown): boolean {
  const jwt = (body as [string, string][])[0][1];
  const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  return claims["x-nvidia-overall-att-result"] === true;
}

export const INTEL_PCS = "https://api.trustedservices.intel.com/tdx/certification/v4";
export const NVIDIA_NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";
