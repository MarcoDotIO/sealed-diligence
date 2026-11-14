/**
 * Renders `DILIGENCE.md`, the human-readable report. Browser-safe.
 *
 * The report is a pure function of the receipt. Verification renders it again and compares byte for byte,
 * so editing a score in the Markdown (or in the receipt) is caught. Any change to the output here makes
 * every report already issued fail that comparison: treat the format as frozen and test it against
 * `docs/sample/`.
 * @module
 */
import { sha256Hex } from "./bytes.ts";
import type { Scorecard, SealInput } from "./pack.ts";
import { type Receipt, scorecardOf, sealInputOf } from "./receipt.ts";

/** How each verdict reads to a person. */
export const VERDICT_LABEL: Record<Scorecard["verdict"], string> = {
  proceed: "Proceed",
  proceed_with_caution: "Proceed with caution",
  do_not_proceed: "Do not proceed",
};

interface ReadmeResult {
  claims?: { claim: string; status: string }[];
}

interface ReviewSummary {
  security_risk?: string;
  quality?: number;
  findings?: { kind: string; severity: string }[];
}

/** Make a value safe inside a Markdown table cell. */
const cell = (s: unknown) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
const words = (s: string) => s.replace(/_/g, " ");

function scoreSection(s: Scorecard): string[] {
  return [
    `**Verdict: ${VERDICT_LABEL[s.verdict] ?? s.verdict}** · overall ${s.overall}/100`,
    "",
    "| Area | Score |",
    "|---|---|",
    `| Security | ${s.security} |`,
    `| Code quality | ${s.code_quality} |`,
    `| Test maturity | ${s.test_maturity} |`,
    `| README matches code | ${s.readme_alignment} |`,
    "",
    `Injection attempts found: **${s.injection_attempts}** · Hardcoded secrets found: **${s.hardcoded_secrets}**`,
    "",
    cell(s.summary),
    "",
  ];
}

function redFlagSection(s: Scorecard): string[] {
  if (!s.red_flags?.length) return [];
  return ["## Red flags", "", ...s.red_flags.map((f) => `- ${cell(f)}`), ""];
}

function readmeSection(input: SealInput): string[] {
  const claims = (input.readme_check?.result as ReadmeResult | undefined)?.claims;
  if (!claims?.length) return [];
  return [
    "## README claims",
    "",
    "| Claim | Status |",
    "|---|---|",
    ...claims.map((c) => `| ${cell(c.claim)} | ${words(cell(c.status))} |`),
    "",
  ];
}

function fileRow(f: SealInput["files"][number]): string {
  const review = (f.review ?? {}) as ReviewSummary;
  const findings = (review.findings ?? []).map((x) => `${x.severity} ${words(x.kind)}`).join(", ") || "none";
  const name = `\`${cell(f.path)}\`${f.truncated ? " (truncated)" : ""}`;
  return `| ${name} | ${cell(review.security_risk)} | ${cell(review.quality)}/5 | ${cell(findings)} |`;
}

function coverageLine(input: SealInput): string {
  const readme = input.readme_check ? " The README is checked against the code separately." : "";
  return `${input.reviewed_files} of ${input.tracked_files} tracked files reviewed one by one (source and config; docs, lockfiles, build output and binaries skipped).${readme}`;
}

function fileSection(input: SealInput): string[] {
  return [
    "## Files reviewed",
    "",
    coverageLine(input),
    "",
    "| File | Risk | Quality | Findings |",
    "|---|---|---|---|",
    ...input.files.map(fileRow),
    "",
  ];
}

function verificationSection(r: Receipt): string[] {
  return [
    "## Verification",
    "",
    `- Commit: \`${r.commit}\``,
    `- Request: \`${r.request_id}\``,
    `- Question pack: \`${r.pack_version}\` · \`${r.pack_hash}\``,
    `- Model: \`${r.model}\``,
    `- Enclave signing key (ed25519): \`${r.enclave_key}\``,
    `- Seal response SHA-256: \`${sha256Hex(r.seal.response_body)}\``,
    `- Generated: ${r.generated_at}`,
    "",
    "Check it: `npx tsx src/cli.ts verify receipt.json DILIGENCE.md`",
    "",
  ];
}

/** Render the report for `r`. Deterministic: the same receipt always gives the same bytes. */
export function renderDiligence(r: Receipt): string {
  const scorecard = scorecardOf(r);
  const input = sealInputOf(r);
  return [
    `# Sealed diligence: ${r.repo_label}`,
    "",
    "Scored inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). The investor never saw the source; the founder couldn't change the scores.",
    "",
    ...scoreSection(scorecard),
    ...redFlagSection(scorecard),
    ...readmeSection(input),
    ...fileSection(input),
    ...verificationSection(r),
  ].join("\n");
}
