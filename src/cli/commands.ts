/**
 * The CLI's commands (Command pattern): each declares its arguments, options and help text, so parsing and
 * the usage screen come from one definition.
 * @module
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { toHex } from "../core/bytes.ts";
import { escrowRef } from "../core/escrow.ts";
import { scorecardOf } from "../core/receipt.ts";
import { renderDiligence } from "../core/report.ts";
import { signatureBytes } from "../core/signatures.ts";
import { auditAgainstSource, loadReceipt, verifyReceiptLocally } from "../node/audit.ts";
import { NearAiEnclave } from "../node/enclave.ts";
import { DEFAULT_MAX_FILES, runReview } from "../node/review.ts";
import { printChecks } from "./print.ts";

/** Parsed command-line input for one command. */
export interface CommandInput {
  positionals: string[];
  options: Record<string, string | boolean | undefined>;
}

/** One CLI command. */
export interface Command {
  name: string;
  /** Argument synopsis for the usage screen. */
  synopsis: string;
  /** Who runs it and what it does. */
  description: string;
  /** Option names: `string` options take a value, `boolean` ones are flags. */
  options: Record<string, "string" | "boolean">;
  /** Positional arguments that must be present. */
  required: number;
  run(input: CommandInput): Promise<void>;
}

const SHORT_HASH = 12;

const text = (input: CommandInput, name: string): string | undefined => {
  const value = input.options[name];
  return typeof value === "string" ? value : undefined;
};

const review: Command = {
  name: "review",
  synopsis: `<repo> [--ref HEAD] [--request <id>] [--label <name>] [--out <dir>] [--max-files ${DEFAULT_MAX_FILES}]`,
  description:
    "Founder: review the repo at one commit inside a NEAR AI enclave.\nWrites DILIGENCE.md and receipt.json (no source code in either). Needs NEAR_AI_API_KEY.",
  options: { ref: "string", request: "string", label: "string", out: "string", "max-files": "string" },
  required: 0,
  async run(input) {
    const apiKey = process.env.NEAR_AI_API_KEY;
    if (!apiKey) throw new Error("set NEAR_AI_API_KEY");
    const repo = resolve(input.positionals[0] ?? ".");
    const outDir = resolve(text(input, "out") ?? ".");
    const log = (message: string) => console.log(message);
    const receipt = await runReview({
      repo,
      ref: text(input, "ref") ?? "HEAD",
      requestId: text(input, "request") ?? randomUUID(),
      repoLabel: text(input, "label") ?? basename(repo),
      maxFiles: Number(text(input, "max-files") ?? DEFAULT_MAX_FILES),
      enclave: new NearAiEnclave(apiKey, log),
      log,
    });
    writeFileSync(join(outDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    writeFileSync(join(outDir, "DILIGENCE.md"), renderDiligence(receipt));
    const s = scorecardOf(receipt);
    console.log(`\n${s.verdict} · overall ${s.overall}/100 · injection attempts ${s.injection_attempts} · secrets ${s.hardcoded_secrets}`);
    console.log(`wrote ${outDir}/DILIGENCE.md and ${outDir}/receipt.json`);
  },
};

const verify: Command = {
  name: "verify",
  synopsis: "<receipt.json> [DILIGENCE.md] [--skip-gpu]",
  description: "Investor: check the enclave attestation, every signature, and that DILIGENCE.md is unedited.",
  options: { "skip-gpu": "boolean" },
  required: 1,
  async run({ positionals, options }) {
    const [receiptPath, mdPath] = positionals;
    const receipt = loadReceipt(receiptPath);
    console.log(`Verifying ${receipt.repo_label} @ ${receipt.commit.slice(0, SHORT_HASH)} (request ${receipt.request_id})`);
    const md = mdPath ? readFileSync(mdPath, "utf8") : null;
    printChecks(await verifyReceiptLocally(receipt, md, { skipGpu: options["skip-gpu"] === true }));
  },
};

const audit: Command = {
  name: "audit",
  synopsis: "<receipt.json> <repo>",
  description: "At closing, with source access: rebuild every signed request from the source and compare.",
  options: {},
  required: 2,
  async run({ positionals: [receiptPath, repo] }) {
    const receipt = loadReceipt(receiptPath);
    console.log(`Closing audit of ${receipt.repo_label} @ ${receipt.commit.slice(0, SHORT_HASH)} against ${repo}`);
    printChecks(auditAgainstSource(receipt, resolve(repo)));
  },
};

const fulfilArgs: Command = {
  name: "fulfil-args",
  synopsis: "<receipt.json> [--out fulfil-args.json]",
  description: "Arguments for the escrow contract's fulfil call (review with --request <contract>#<id>).",
  options: { out: "string" },
  required: 1,
  async run(input) {
    const receipt = loadReceipt(input.positionals[0]);
    const ref = escrowRef(receipt.request_id);
    if (!ref) throw new Error(`request id ${receipt.request_id} is not an escrow request (<contract>#<n>)`);
    const out = text(input, "out") ?? "fulfil-args.json";
    const { text: sealText, signature } = receipt.seal.signature;
    const callArgs = {
      id: ref.id,
      seal_request_body: receipt.seal.request_body,
      seal_text: sealText,
      signature_hex: toHex(signatureBytes(signature)),
    };
    writeFileSync(out, JSON.stringify(callArgs));
    console.log(`wrote ${out} for request ${receipt.request_id}`);
  },
};

/** Every command, in the order the usage screen lists them. */
export const COMMANDS: readonly Command[] = [review, verify, audit, fulfilArgs];

/** The usage screen, generated from {@link COMMANDS}. */
export function usage(): string {
  const entries = COMMANDS.map((c) => `  ${c.name} ${c.synopsis}\n${c.description.replace(/^/gm, "      ")}`);
  return `sealed-diligence <command>\n\n${entries.join("\n\n")}\n`;
}
