# Protocol

This page specifies what a review sends, what NEAR AI signs, and what the receipt contains. The protocol id is `sealed-diligence/v1`.

## Session nonce

Each review gets a fresh nonce, used as the attestation nonce:

```
nonce = sha256("sealed-diligence/v1|<commit>|<pack_hash>|<request_id>|<salt>")
```

`salt` is 16 random bytes (hex). The receipt stores both, so the investor can recompute the nonce and confirm the attestation was fetched for this commit, this question pack and this request, not replayed from another session.

## Attestation

The CLI calls `GET /v1/attestation/report?model=<model>&provider=near&signing_algo=ed25519&nonce=<nonce>` with `x-no-aliasing: true`. Every returned candidate must pass all of these checks, and all must agree on one signing key:

| Check | What it compares |
|---|---|
| Signing algorithm | `signing_algo == "ed25519"` |
| Nonce echo | `request_nonce == nonce` |
| Intel TDX quote | dcap-qvl verifies the quote against Intel collateral; status `UpToDate` or `OutOfDate` |
| Key binding | report data bytes 0–31 are the signing key |
| Nonce binding | report data bytes 32–63 are the nonce |
| RTMR3 | replaying the `imr: 3` event log (re-deriving each digest) reproduces the quote's RTMR3 |
| App config | MRCONFIGID is `01 ‖ sha256(app_compose) ‖ 00×15` (dstack's layout) |
| GPU | NVIDIA NRAS accepts the GPU evidence, whose nonce is the same session nonce |

## Question packs

`src/core/pack.ts` defines versioned question packs. Each fixes the model (`deepseek-ai/DeepSeek-V4.1-Flash-1017`), the three system prompts, `temperature: 0`, per-request `max_tokens`, `response_format: json_object`, and any extra request options. The pack hash commits to all of them:

```
pack_hash = sha256(JSON.stringify({ PACK_VERSION, MODEL, FILE_SYSTEM, README_SYSTEM, SEAL_SYSTEM, temperature, max_tokens[, request_options] }))
```

| Pack | Token budget (file / README / seal) | Request options | Hash | Status |
|---|---|---|---|---|
| `standard-v1` | 1200 / 1500 / 1500 | none | `c6bb1130…` | Retired. Issued the video sample (`docs/sample/`) |
| `standard-v2` | 4096 / 6144 / 8192 | `chat_template_kwargs: { thinking: false }` | `f3344a26…` | Current |

`standard-v1` let the model reason before answering. NEAR AI returns that reasoning inside the signed response, so the receipt (which must hold each response byte for byte) carried it, and reasoning can paraphrase or quote the code. It also used up v1's small budgets on repositories beyond a handful of files. `standard-v2` turns reasoning off. As a backstop, the CLI refuses to write a receipt if any answer contains reasoning text or was cut off by its budget.

The pack hash appears in the nonce, the seal input, the receipt and the escrow request, so the founder can't soften the questions. **A pack is never edited once issued.** To change a prompt or parameter, add a new version to `PACKS` and point `CURRENT_PACK` at it. Receipts name their pack, verification needs nothing from the code's pack, and the closing audit rebuilds requests with the pack the receipt names. `test/sample.test.ts` checks that the v1 sample still hashes and renders exactly as signed.

Every prompt fences the founder's material between `<<<BEGIN UNTRUSTED>>>` and `<<<END UNTRUSTED>>>` and makes any instruction inside it a finding of kind `injection_attempt`. Every prompt also forbids quoting code, secrets or URLs, because the answers are what the investor receives.

## Requests

Request bodies are built deterministically, so the closing audit can rebuild them byte for byte:

| Request | Built by | User message |
|---|---|---|
| One per reviewable file | `fileRequest(path, content, truncated)` | path, optional truncation note, fenced file content |
| README check | `readmeRequest(readme, purposes)` | fenced README, fenced list of `path: purpose` |
| Seal | `sealRequest(input)` | `DILIGENCE INPUT:` followed by the seal input JSON |

## Signatures

For every completion, the CLI fetches `GET /v1/signature/{chat_id}?model=<model>&signing_algo=ed25519` (with a short, bounded retry on 404, as NEAR AI documents). The signed text is:

```
<model>:<sha256(exact request bytes)>:<sha256(exact response bytes)>
```

It is signed with ed25519 by the attested key, with `signature_kind: provider_tee`. **The bytes are hashed exactly as sent and received; JSON is never re-serialized before hashing.** Because a per-file request contains the file, its signed hash commits to the code without revealing it.

## The seal

The seal input contains, for every reviewed file, its path, `file_sha256`, truncation flag, request hash, response hash and parsed review. For the README check it holds the request hash, response hash and result. It also carries the protocol, request id, commit, pack version, pack hash, repo label, and the tracked and reviewed file counts. It contains no source, so the receipt includes the full seal request and the investor recomputes its hash. Because the seal lists every review's hashes, dropping a bad review breaks the seal.

The seal's answer is the scorecard:

```json
{ "verdict": "proceed | proceed_with_caution | do_not_proceed", "overall": 0, "security": 0, "code_quality": 0,
  "test_maturity": 0, "readme_alignment": 0, "injection_attempts": 0, "hardcoded_secrets": 0,
  "red_flags": ["…"], "summary": "…" }
```

## Receipt (`receipt.json`)

| Field | Meaning |
|---|---|
| `protocol`, `model`, `pack_version`, `pack_hash` | What was asked, of which model |
| `request_id` | The escrow request (`<contract>#<n>`) or a random UUID |
| `repo_label`, `commit` | What was reviewed |
| `nonce` | `{ salt, value }` |
| `enclave_key` | The attested ed25519 key (hex) |
| `attestation` | The attestation candidate the key came from, as NEAR AI returned it |
| `files[]` | Per file: `path`, `file_sha256`, `truncated`, `chat_id`, `request_hash`, `response_body`, `signature` |
| `readme_check` | The same signed-entry shape, or `null` |
| `seal` | The same, plus the full `request_body` |
| `generated_at` | ISO timestamp |

## Report (`DILIGENCE.md`)

`renderDiligence(receipt)` is deterministic. Verification renders it again and compares byte for byte, so the format is frozen: changing a single character of the output would make every report already issued fail. The report ends with the command that verifies it (`npx tsx src/cli.ts verify receipt.json DILIGENCE.md`), which is why `src/cli.ts` must not move.
