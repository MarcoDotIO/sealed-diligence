// DILIGENCE.md is a pure function of the receipt. The verifier re-renders it and compares byte for byte,
// so editing a score in the Markdown (or in the receipt) is caught.
import { sha256Hex } from "./sig.ts";
import { scorecardOf, sealInputOf, type Receipt } from "./receipt.ts";

const VERDICT: Record<string, string> = {
  proceed: "Proceed",
  proceed_with_caution: "Proceed with caution",
  do_not_proceed: "Do not proceed",
};

const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderDiligence(r: Receipt): string {
  const s = scorecardOf(r);
  const input = sealInputOf(r);
  const readme = (input.readme_check?.result ?? null) as { injection_attempt?: boolean; claims?: { claim: string; status: string }[] } | null;
  const out: string[] = [];
  out.push(`# Sealed diligence: ${r.repo_label}`, "");
  out.push(
    `Scored inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE). The reviewer never saw this file's reader, and the reader never saw the source.`,
    "",
  );
  out.push(`**Verdict: ${VERDICT[s.verdict] ?? s.verdict}** · overall ${s.overall}/100`, "");
  out.push("| Area | Score |", "|---|---|");
  out.push(`| Security | ${s.security} |`, `| Code quality | ${s.code_quality} |`, `| Test maturity | ${s.test_maturity} |`, `| README matches code | ${s.readme_alignment} |`);
  out.push("", `Injection attempts found: **${s.injection_attempts}** · Hardcoded secrets found: **${s.hardcoded_secrets}**`, "");
  out.push(esc(s.summary), "");
  if (s.red_flags?.length) {
    out.push("## Red flags", "");
    for (const f of s.red_flags) out.push(`- ${esc(f)}`);
    out.push("");
  }
  if (readme?.claims?.length) {
    out.push("## README claims", "");
    out.push("| Claim | Status |", "|---|---|");
    for (const c of readme.claims) out.push(`| ${esc(c.claim)} | ${esc(c.status).replace(/_/g, " ")} |`);
    out.push("");
  }
  out.push("## Files reviewed", "");
  out.push(`${input.reviewed_files} of ${input.tracked_files} tracked files (source and config; lockfiles, build output and binaries skipped).`, "");
  out.push("| File | Risk | Quality | Findings |", "|---|---|---|---|");
  for (const f of input.files) {
    const rv = (f.review ?? {}) as { security_risk?: string; quality?: number; findings?: { kind: string; severity: string }[] };
    const fs = (rv.findings ?? []).map((x) => `${x.severity} ${x.kind.replace(/_/g, " ")}`).join(", ") || "none";
    out.push(`| \`${esc(f.path)}\`${f.truncated ? " (truncated)" : ""} | ${esc(rv.security_risk)} | ${esc(rv.quality)}/5 | ${esc(fs)} |`);
  }
  out.push("", "## Verification", "");
  out.push(`- Commit: \`${r.commit}\``);
  out.push(`- Request: \`${r.request_id}\``);
  out.push(`- Question pack: \`${r.pack_version}\` · \`${r.pack_hash}\``);
  out.push(`- Model: \`${r.model}\``);
  out.push(`- Enclave signing key (ed25519): \`${r.enclave_key}\``);
  out.push(`- Seal response SHA-256: \`${sha256Hex(r.seal.response_body)}\``);
  out.push(`- Generated: ${r.generated_at}`);
  out.push("", "Check it: `npx tsx src/cli.ts verify receipt.json DILIGENCE.md`", "");
  return out.join("\n");
}
