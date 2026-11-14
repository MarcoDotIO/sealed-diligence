// Node side of attestation: fetch NEAR AI model attestations; verify quotes with dcap-qvl-node and GPUs with NVIDIA NRAS.
import { js_get_collateral, js_verify } from "@phala/dcap-qvl-node";
import {
  INTEL_PCS,
  NVIDIA_NRAS,
  nrasVerdict,
  quoteVerdictFromDcap,
  verifyEvidence,
  type AttestationResult,
  type EvidenceVerifiers,
  type ModelAttestation,
} from "./evidence.ts";

export { sessionNonce, type ModelAttestation } from "./evidence.ts";
export const API_BASE = process.env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai";

/** Fetch the NEAR model attestation report for `model`, bound to `nonceHex`. */
export async function fetchModelAttestations(model: string, nonceHex: string, apiKey?: string): Promise<ModelAttestation[]> {
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

const unixSeconds = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));

async function nrasCheck(payload: string): Promise<boolean> {
  const res = await fetch(NVIDIA_NRAS, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: payload,
  });
  if (!res.ok) throw new Error(`NRAS HTTP ${res.status}`);
  return nrasVerdict(await res.json());
}

export function nodeVerifiers(opts: { skipGpu?: boolean } = {}): EvidenceVerifiers {
  return {
    async verifyQuote(quote) {
      const collateral = await js_get_collateral(INTEL_PCS, quote);
      return quoteVerdictFromDcap(js_verify(quote, collateral, unixSeconds(new Date())));
    },
    verifyGpu: opts.skipGpu ? async () => null : nrasCheck,
  };
}

export function verifyModelAttestation(att: ModelAttestation, nonceHex: string): Promise<AttestationResult> {
  return verifyEvidence(att, nonceHex, nodeVerifiers());
}
