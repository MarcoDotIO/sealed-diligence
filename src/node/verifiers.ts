/**
 * The Node implementation of {@link EvidenceVerifiers}: Intel TDX quotes through dcap-qvl-node and Intel's
 * collateral service, GPU evidence through NVIDIA's attestation service (NRAS).
 * @module
 */
import { js_get_collateral, js_verify } from "@phala/dcap-qvl-node";
import {
  type AttestationResult,
  type EvidenceVerifiers,
  INTEL_PCS,
  type ModelAttestation,
  NVIDIA_NRAS,
  nrasVerdict,
  quoteVerdictFromDcap,
  verifyEvidence,
} from "../core/attestation.ts";

/** Options for {@link nodeVerifiers}. */
export interface NodeVerifierOptions {
  /** Report the GPU check as "couldn't run" instead of calling NRAS (offline use). */
  skipGpu?: boolean;
}

const unixSeconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000));

async function nrasAttest(payload: string): Promise<boolean> {
  const res = await fetch(NVIDIA_NRAS, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: payload,
  });
  if (!res.ok) throw new Error(`NRAS HTTP ${res.status}`);
  return nrasVerdict(await res.json());
}

/** Quote and GPU verifiers for the CLI. */
export function nodeVerifiers(options: NodeVerifierOptions = {}): EvidenceVerifiers {
  return {
    async verifyQuote(quote) {
      const collateral = await js_get_collateral(INTEL_PCS, quote);
      return quoteVerdictFromDcap(js_verify(quote, collateral, unixSeconds(new Date())));
    },
    verifyGpu: options.skipGpu ? async () => null : nrasAttest,
  };
}

/** Fully verify one model attestation from Node, GPU included. */
export function verifyModelAttestation(att: ModelAttestation, nonceHex: string): Promise<AttestationResult> {
  return verifyEvidence(att, nonceHex, nodeVerifiers());
}
