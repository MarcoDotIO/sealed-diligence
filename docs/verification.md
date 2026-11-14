# Verification

An investor can check a report two ways. Both run the same code (`verifyReceipt` in `src/core/verify.ts`); they differ only in how they verify the hardware evidence.

| | CLI: `sealed-diligence verify` | Browser: `docs/index.html` |
|---|---|---|
| Intel TDX quote | dcap-qvl-node, Intel collateral | dcap-qvl in WebAssembly, Phala's CORS-enabled collateral mirror |
| NVIDIA GPU | NVIDIA NRAS | Shown as "needs the CLI" (NRAS refuses browser requests) |
| Escrow state | NEAR RPC | NEAR RPC |
| Uploads | None | None; files stay in the page |

```bash
npx tsx src/cli.ts verify receipt.json DILIGENCE.md            # add --skip-gpu to stay offline from NVIDIA
```

A check is three-valued: passed, failed, or could not run here. The result is `VERIFIED` when nothing failed.

## Enclave hardware

| Check | Fails when |
|---|---|
| Attestation nonce derives from this commit, question pack and request | The nonce in the receipt isn't `sessionNonce(commit, pack, request, salt)`, so the attestation could be from another session |
| Signing algorithm is ed25519 | Another algorithm |
| Report echoes the session nonce | The attestation answered a different nonce |
| Intel TDX quote verifies | The quote is forged, revoked or not from TDX hardware |
| Quote binds the signing key | Report data doesn't start with the key |
| Quote binds the session nonce | Report data doesn't carry the nonce |
| Event log replays to the quote's RTMR3 | The claimed boot and app events aren't what was measured |
| Measured app config matches MRCONFIGID | The app compose isn't the measured one |
| GPU attestation (NVIDIA NRAS) | NVIDIA rejects the GPU evidence or its nonce differs |
| Attested key is the receipt's enclave key | The receipt names a key the attestation doesn't vouch for |

## Signed answers

| Check | Fails when |
|---|---|
| Seal request hash recomputed | The seal request in the receipt was edited |
| Seal signed by the enclave key | The seal's answer or signature was edited, or another key signed it |
| Seal used the declared model | The seal request names a different model |
| Seal is bound to this request, commit and question pack | The seal was made for something else |
| N per-file reviews signed and listed in the seal | A review was edited, re-signed by another key, swapped, or dropped |
| README check signed and listed in the seal | The README check was edited or swapped |

## Report file

| Check | Fails when |
|---|---|
| DILIGENCE.md matches the signed scorecard exactly | Any character of the Markdown differs from what the receipt renders to |

## On-chain payment

Only for receipts whose request id is an escrow request (`<contract>.testnet#<n>` or `.near`).

| Check | Fails when |
|---|---|
| Escrow `<contract>` request #n was paid for this seal | The request doesn't exist, isn't fulfilled, or its commit, pack, model, key or seal text differ from the receipt |

## Closing audit

When the deal proceeds and the investor gets source access, the audit proves the review covered the real code:

```bash
npx tsx src/cli.ts audit receipt.json /path/to/repo
```

| Check | Fails when |
|---|---|
| N per-file requests rebuilt from source match the signed hashes | A file was swapped, edited, or not the one at the commit; or the prompts were altered |
| Declared tracked-file count matches the commit | The seal under-reported how many files the repo has |
| README check request rebuilt from source matches | The README or the per-file purposes differ |

## What a pass means

A `VERIFIED` result means a genuine NEAR AI enclave, running the declared model with the declared question pack, gave every answer in the receipt for this commit; that the report says exactly what the enclave said; and, for escrowed reviews, that the contract checked the same seal before paying. It doesn't mean the model's judgement is right. See the [threat model](threat-model.md) for the limits.
