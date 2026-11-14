/**
 * Every check an investor runs on a receipt. Browser-safe: the CLI and the web verifier both call
 * {@link verifyReceipt}, each passing its own {@link EvidenceVerifiers}.
 * @module
 */
import { type EvidenceVerifiers, type ModelAttestation, sessionNonce, verifyEvidence } from "./attestation.ts";
import { type Check, errorMessage, inGroup } from "./checks.ts";
import { escrowCheck } from "./escrow.ts";
import { type Receipt, verifySignatures } from "./receipt.ts";
import { renderDiligence } from "./report.ts";

/**
 * Verify a receipt end to end, in four groups:
 * - **Enclave hardware**: the attestation was fetched for this session and proves the signing key;
 * - **Signed answers**: every answer and the seal are signed by that key and consistent;
 * - **Report file**: `diligenceMd`, when given, is exactly what the receipt renders to;
 * - **On-chain payment**: the escrow request (if any) was fulfilled with this seal.
 */
export async function verifyReceipt(receipt: Receipt, diligenceMd: string | null, verifiers: EvidenceVerifiers): Promise<Check[]> {
  const checks: Check[] = [
    ...(await hardwareChecks(receipt, verifiers)).map(inGroup("Enclave hardware")),
    ...(await verifySignatures(receipt)).map(inGroup("Signed answers")),
  ];
  if (diligenceMd !== null) checks.push(inGroup("Report file")(reportFileCheck(receipt, diligenceMd)));
  const escrow = await escrowCheck(receipt);
  if (escrow) checks.push(inGroup("On-chain payment")(escrow));
  return checks;
}

async function hardwareChecks(receipt: Receipt, verifiers: EvidenceVerifiers): Promise<Check[]> {
  const expectedNonce = sessionNonce({
    commit: receipt.commit,
    packHash: receipt.pack_hash,
    requestId: receipt.request_id,
    salt: receipt.nonce.salt,
  });
  const attestation = await verifyEvidence(receipt.attestation as unknown as ModelAttestation, receipt.nonce.value, verifiers);
  return [
    { name: "Attestation nonce derives from this commit, question pack and request", ok: expectedNonce === receipt.nonce.value },
    ...attestation.checks,
    { name: "Attested key is the receipt's enclave key", ok: attestation.signingAddress === receipt.enclave_key.toLowerCase() },
  ];
}

function reportFileCheck(receipt: Receipt, diligenceMd: string): Check {
  return { name: "DILIGENCE.md matches the signed scorecard exactly", ok: renderedOrError(receipt) === diligenceMd };
}

/** The rendered report, or an error string that can never equal a real report. */
function renderedOrError(receipt: Receipt): string {
  try {
    return renderDiligence(receipt);
  } catch (error) {
    return `render failed: ${errorMessage(error)}`;
  }
}
