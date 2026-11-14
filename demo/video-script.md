# Demo video

Built by `demo/video/make-video.ts` from a real run captured by `demo/video/capture.sh` (escrow request `sealed-diligence.testnet#2`). Every value on screen comes from that run. Visual beats and subtitles are placed on the narrator's words using ElevenLabs character timestamps.

Organising idea: the dark editor is the founder's private side, light paper is what the investor sees, and the security tape is the only thing that crosses between them.

| Scene | On screen | Beat on the words |
|---|---|---|
| Hook | `src/server.ts` in a VS Code-style editor | lines 5–6 light up on "tells" |
| Problem | editor shrinks and blurs; tape slaps across it; headline sets | shrink + tape slap on "won't hand it over", headline on "Now neither" |
| 1 Request | `create_request` slip with the real fields | each row on "this commit", "these questions", "this enclave key", "fee in escrow"; request tape after "escrow" |
| 2 Review | editor beside the enclave panel; command chip; attestation checks; each file's signed answer with its real signature; seal | chip on "one command", checks on "proves it's real hardware", files from "reviews each file" |
| 3 Verify | the real verifier page: full width, then the report column, then the ringed red flag with the triggering code docked beneath, then the checks column | verdict on "do not proceed", flag on "the trick", code on "line five", ring on "red flag" |
| 4 Tamper | `DILIGENCE.md`: the 8 is selected and retyped as 94; cut to the VOID tape and the failed check | select on "Eight", type on "becomes", cut and tear on "The seal breaks" |
| 5 Settle | `fulfil` slip: the contract's checks, fee paid to the founder, FULFILLED stamp | checks on "checks the enclave's signature", fee and stamp on "releases the fee" |
| Outro | headline, sealed tape with the real serial, verifier URL and repo | — |

Rebuild: `ELEVEN_LABS_API_KEY=… npx tsx demo/video/make-video.ts` (voice clips and effects are cached by text).
