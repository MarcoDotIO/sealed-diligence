// Every check an investor runs on a receipt. Browser-safe: the CLI and the web page both call this,
// passing their own Intel quote and NVIDIA GPU verifiers.
import { sessionNonce, verifyEvidence, type Check, type EvidenceVerifiers, type ModelAttestation } from "./evidence.ts";
import { verifySignatures, type Receipt } from "./receipt.ts";
import { renderDiligence } from "./render.ts";

function renderedOrError(receipt: Receipt): string {
  try {
    return renderDiligence(receipt);
  } catch (e) {
    return `render failed: ${(e as Error).message}`;
  }
}

export async function verifyReceipt(receipt: Receipt, diligenceMd: string | null, verifiers: EvidenceVerifiers): Promise<Check[]> {
  const expectedNonce = sessionNonce({
    commit: receipt.commit,
    packHash: receipt.pack_hash,
    requestId: receipt.request_id,
    salt: receipt.nonce.salt,
  });
  const attestation = await verifyEvidence(receipt.attestation as unknown as ModelAttestation, receipt.nonce.value, verifiers);
  const checks: Check[] = [
    { name: "Attestation nonce derives from this commit, question pack and request", ok: expectedNonce === receipt.nonce.value },
    ...attestation.checks.map((c) => ({ ...c, name: `Enclave: ${c.name}` })),
    { name: "Attested key is the receipt's enclave key", ok: attestation.signingAddress === receipt.enclave_key.toLowerCase() },
    ...(await verifySignatures(receipt)),
  ];
  if (diligenceMd !== null) {
    checks.push({ name: "DILIGENCE.md matches the signed scorecard exactly", ok: renderedOrError(receipt) === diligenceMd });
  }
  return checks;
}

export const allPassed = (checks: Check[]) => checks.every((c) => c.ok !== false);
