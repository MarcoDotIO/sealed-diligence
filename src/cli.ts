#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Check } from "./evidence.ts";
import { scorecardOf } from "./receipt.ts";
import { renderDiligence } from "./render.ts";
import { DEFAULT_MAX_FILES, nearAiEnclave, runReview } from "./review.ts";
import { signatureBytes, toHex } from "./sig.ts";
import { allPassed } from "./verify-core.ts";
import { auditAgainstSource, loadReceipt, verifyReceiptLocally } from "./verify.ts";

const USAGE = `sealed-diligence <command>

  review <repo> [--ref HEAD] [--request <id>] [--label <name>] [--out <dir>] [--max-files ${DEFAULT_MAX_FILES}]
      Founder: review the repo at one commit inside a NEAR AI enclave.
      Writes DILIGENCE.md and receipt.json (no source code in either). Needs NEAR_AI_API_KEY.

  verify <receipt.json> [DILIGENCE.md] [--skip-gpu]
      Investor: check the enclave attestation, every signature, and that DILIGENCE.md is unedited.

  audit <receipt.json> <repo>
      At closing, with source access: rebuild every signed request from the source and compare.

  fulfil-args <receipt.json> [--out fulfil-args.json]
      Arguments for the escrow contract's fulfil call (review with --request <contract>#<id>).
`;

const SHORT_HASH = 12;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function report(checks: Check[]): void {
  let group: string | undefined;
  for (const c of checks) {
    if (c.group && c.group !== group) console.log(`\n${(group = c.group)}`);
    const mark = c.ok === null ? "–" : c.ok ? "✓" : "✗";
    const detail = c.ok !== true && c.detail ? `\n      ${c.detail}` : "";
    console.log(`  ${mark} ${c.name}${detail}`);
  }
  const passed = allPassed(checks);
  console.log(passed ? "\nVERIFIED" : "\nNOT VERIFIED");
  process.exitCode = passed ? 0 : 1;
}

async function review(args: string[]): Promise<void> {
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) throw new Error("set NEAR_AI_API_KEY");
  const repo = resolve(args[0] ?? ".");
  const outDir = resolve(option(args, "--out") ?? ".");
  const log = (m: string) => console.log(m);
  const receipt = await runReview({
    repo,
    ref: option(args, "--ref") ?? "HEAD",
    requestId: option(args, "--request") ?? randomUUID(),
    repoLabel: option(args, "--label") ?? basename(repo),
    maxFiles: Number(option(args, "--max-files") ?? DEFAULT_MAX_FILES),
    enclave: nearAiEnclave(apiKey, log),
    log,
  });
  writeFileSync(`${outDir}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n");
  writeFileSync(`${outDir}/DILIGENCE.md`, renderDiligence(receipt));
  const s = scorecardOf(receipt);
  console.log(`\n${s.verdict} · overall ${s.overall}/100 · injection attempts ${s.injection_attempts} · secrets ${s.hardcoded_secrets}`);
  console.log(`wrote ${outDir}/DILIGENCE.md and ${outDir}/receipt.json`);
}

async function verify(args: string[]): Promise<void> {
  const receipt = loadReceipt(args[0]);
  const mdPath = args[1]?.startsWith("--") ? undefined : args[1];
  console.log(`Verifying ${receipt.repo_label} @ ${receipt.commit.slice(0, SHORT_HASH)} (request ${receipt.request_id})`);
  const md = mdPath ? readFileSync(mdPath, "utf8") : null;
  report(await verifyReceiptLocally(receipt, md, { skipGpu: args.includes("--skip-gpu") }));
}

async function audit(args: string[]): Promise<void> {
  const receipt = loadReceipt(args[0]);
  console.log(`Closing audit of ${receipt.repo_label} @ ${receipt.commit.slice(0, SHORT_HASH)} against ${args[1]}`);
  report(auditAgainstSource(receipt, resolve(args[1])));
}

async function fulfilArgs(args: string[]): Promise<void> {
  const receipt = loadReceipt(args[0]);
  const id = Number(receipt.request_id.split("#").pop());
  if (!Number.isInteger(id)) throw new Error(`request id ${receipt.request_id} is not an escrow request (<contract>#<n>)`);
  const out = option(args, "--out") ?? "fulfil-args.json";
  const { text, signature } = receipt.seal.signature;
  const callArgs = { id, seal_request_body: receipt.seal.request_body, seal_text: text, signature_hex: toHex(signatureBytes(signature)) };
  writeFileSync(out, JSON.stringify(callArgs));
  console.log(`wrote ${out} for request ${receipt.request_id}`);
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  review,
  verify,
  audit,
  "fulfil-args": fulfilArgs,
};

const [name, ...args] = process.argv.slice(2);
const command = COMMANDS[name];
if (!command) {
  console.log(USAGE);
  process.exitCode = name ? 1 : 0;
} else {
  command(args).catch((e: unknown) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
