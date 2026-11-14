#!/usr/bin/env -S npx tsx
// sealed-diligence: review | verify | audit
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runReview } from "./review.ts";
import { renderDiligence } from "./render.ts";
import { auditAgainstSource, loadReceipt, verifyReceipt } from "./verify.ts";
import { scorecardOf, type VerifyLine } from "./receipt.ts";
import { signatureBytes } from "./sig.ts";

const USAGE = `sealed-diligence <command>

  review <repo> [--ref HEAD] [--request <id>] [--label <name>] [--out <dir>] [--max-files 60]
      Founder: review the repo at one commit inside a NEAR AI enclave.
      Writes DILIGENCE.md and receipt.json (no source code in either). Needs NEAR_AI_API_KEY.

  verify <receipt.json> [DILIGENCE.md] [--skip-gpu]
      Investor: check the enclave attestation, every signature, and that DILIGENCE.md is unedited.

  audit <receipt.json> <repo>
      At closing, with source access: rebuild every signed request from the source and compare.

  fulfil-args <receipt.json> [--out fulfil-args.json]
      Arguments for the escrow contract's fulfil call (review with --request <contract>#<id>).
`;

function flag(args: string[], name: string, def?: string) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

function print(lines: VerifyLine[]): boolean {
  for (const l of lines) console.log(`${l.ok ? "  ✓" : "  ✗"} ${l.name}${!l.ok && l.detail ? `\n      ${l.detail}` : ""}`);
  const ok = lines.every((l) => l.ok);
  console.log(ok ? "\nVERIFIED" : "\nNOT VERIFIED");
  return ok;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "review") {
    const repo = resolve(args[0] ?? ".");
    const apiKey = process.env.NEAR_AI_API_KEY;
    if (!apiKey) throw new Error("set NEAR_AI_API_KEY");
    const out = resolve(flag(args, "--out", ".")!);
    const receipt = await runReview({
      repo,
      ref: flag(args, "--ref", "HEAD"),
      requestId: flag(args, "--request", randomUUID())!,
      repoLabel: flag(args, "--label", basename(repo))!,
      maxFiles: Number(flag(args, "--max-files", "60")),
      apiKey,
      log: (m) => console.log(m),
    });
    writeFileSync(`${out}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n");
    writeFileSync(`${out}/DILIGENCE.md`, renderDiligence(receipt));
    const s = scorecardOf(receipt);
    console.log(`\n${s.verdict} · overall ${s.overall}/100 · injection attempts ${s.injection_attempts} · secrets ${s.hardcoded_secrets}`);
    console.log(`wrote ${out}/DILIGENCE.md and ${out}/receipt.json`);
  } else if (cmd === "verify") {
    const receipt = loadReceipt(args[0]);
    const mdPath = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
    const md = mdPath ? readFileSync(mdPath, "utf8") : undefined;
    console.log(`Verifying ${receipt.repo_label} @ ${receipt.commit.slice(0, 12)} (request ${receipt.request_id})`);
    process.exitCode = print(await verifyReceipt(receipt, md, { skipGpu: args.includes("--skip-gpu") })) ? 0 : 1;
  } else if (cmd === "fulfil-args") {
    // Arguments for the escrow contract's `fulfil` call, built from the receipt.
    const receipt = loadReceipt(args[0]);
    const id = Number(receipt.request_id.split("#").pop());
    if (!Number.isInteger(id)) throw new Error(`request id ${receipt.request_id} is not an escrow request (<contract>#<n>)`);
    const sig = receipt.seal.signature;
    const out = { id, seal_request_body: receipt.seal.request_body, seal_text: sig.text, signature_hex: Buffer.from(signatureBytes(sig.signature)).toString("hex") };
    writeFileSync(flag(args, "--out", "fulfil-args.json")!, JSON.stringify(out));
    console.log(`wrote ${flag(args, "--out", "fulfil-args.json")} for request ${receipt.request_id}`);
  } else if (cmd === "audit") {
    const receipt = loadReceipt(args[0]);
    console.log(`Closing audit of ${receipt.repo_label} @ ${receipt.commit.slice(0, 12)} against ${args[1]}`);
    process.exitCode = print(auditAgainstSource(receipt, resolve(args[1]))) ? 0 : 1;
  } else {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exitCode = 1;
});
