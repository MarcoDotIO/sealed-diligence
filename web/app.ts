/**
 * The browser verifier: the same checks as `sealed-diligence verify`, run locally in the page.
 *
 * Nothing is uploaded. Intel collateral comes from Phala's public PCCS mirror and the escrow record from
 * public NEAR RPC, both of which allow browser requests. NVIDIA's attestation service doesn't, so the GPU
 * check is reported as "needs the CLI" rather than passed.
 *
 * Bundled into `docs/app.js` by `scripts/build-web.sh`; the page is `web/index.html`.
 * @module
 */
import init, { js_get_collateral, js_verify } from "@phala/dcap-qvl-web";
import { type EvidenceVerifiers, quoteVerdictFromDcap } from "../src/core/attestation.ts";
import { allPassed, CHECK_GROUPS, type Check, errorMessage } from "../src/core/checks.ts";
import { escrowRef, fetchEscrowRecord } from "../src/core/escrow.ts";
import type { Scorecard, SealInput } from "../src/core/pack.ts";
import { type Receipt, scorecardOf, sealInputOf } from "../src/core/receipt.ts";
import { VERDICT_LABEL } from "../src/core/report.ts";
import { verifyReceipt } from "../src/core/verify.ts";

/** A CORS-enabled mirror of Intel's TDX collateral service. */
const PCCS = "https://pccs.phala.network/tdx/certification/v4";
const SAMPLE = { receipt: "sample/receipt.json", diligence: "sample/DILIGENCE.md" };
/** The score the "edit the report" demo writes in place of the real one. */
const TAMPERED_OVERALL = 94;
/** Hex characters of the request's commit and key printed on the tape. */
const SHORT = 8;
const SHORT_COMMIT = 12;
/** Enough copies of the tape text to run past the widest screen. */
const TAPE_REPEATS = 6;
const COPIED_FEEDBACK_MS = 1500;
const NEAR_DECIMALS = 24;

/** The security tape: grey while idle or checking, cobalt when the seal holds, red VOID when it doesn't. */
type TapeState = "idle" | "checking" | "sealed" | "void";

interface ReadmeClaim {
  claim: string;
  status: string;
}
interface FileReviewSummary {
  security_risk?: string;
  findings?: { kind: string; severity: string }[];
}

/** The element matching `sel` (the page's markup guarantees it exists). */
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) =>
  Object.assign(document.createElement(tag), props);
const words = (s: string) => s.replace(/_/g, " ");

let wasmReady: Promise<unknown> | null = null;

/** The browser's attestation strategy: dcap-qvl compiled to WebAssembly; no GPU verdict (CORS). */
const browserVerifiers: EvidenceVerifiers = {
  async verifyQuote(quote) {
    wasmReady ??= init({ module_or_path: new URL("./dcap-qvl-web_bg.wasm", import.meta.url) });
    await wasmReady;
    const collateral = await js_get_collateral(PCCS, quote);
    return quoteVerdictFromDcap(js_verify(quote, collateral, BigInt(Math.floor(Date.now() / 1000))));
  },
  verifyGpu: async () => null,
};

/** Set the tape's state and text; a final state replays the "tape applied" animation. */
function setTape(state: TapeState, receipt?: Receipt): void {
  const phrase = {
    idle: "Sealed Diligence ◆ check before you trust",
    checking: "Checking the seal",
    sealed: receipt
      ? `Sealed ◆ ${receipt.request_id} ◆ commit ${receipt.commit.slice(0, SHORT)} ◆ enclave ${receipt.enclave_key.slice(0, SHORT)}`
      : "Sealed",
    void: "Void ◆ seal broken ◆ do not rely on this report",
  }[state];
  const tape = $("#tape");
  tape.dataset.state = state;
  $("#tape-text").textContent = Array(TAPE_REPEATS).fill(phrase).join("  ◆  ");
  if (state === "sealed" || state === "void") {
    tape.classList.remove("fresh");
    void tape.offsetWidth; // restart the one-shot animation
    tape.classList.add("fresh");
  }
}

function scoreRow(label: string, value: number): HTMLElement {
  const fill = element("i");
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  const meter = element("div", { className: "meter" });
  meter.append(fill);
  const row = element("div", { className: "score" });
  row.append(element("span", { textContent: label }), meter, element("b", { textContent: String(value) }));
  return row;
}

function tableRow(cells: (string | HTMLElement)[], classes: string[] = []): HTMLTableRowElement {
  const tr = element("tr");
  cells.forEach((cell, i) => {
    const td = element("td", { className: classes[i] ?? "" });
    td.append(cell);
    tr.append(td);
  });
  return tr;
}

/** The report column: verdict, scores, summary and red flags, exactly as signed. */
function showReport(receipt: Receipt, s: Scorecard): void {
  $("#verdict").textContent = VERDICT_LABEL[s.verdict] ?? s.verdict;
  $("#verdict").dataset.v = s.verdict;
  $("#overall").textContent = String(s.overall);
  $("#subject").textContent =
    `${receipt.repo_label}, commit ${receipt.commit.slice(0, SHORT_COMMIT)}. ${s.injection_attempts} prompt-injection attempt(s), ${s.hardcoded_secrets} hardcoded secret(s).`;
  $("#scores").replaceChildren(
    scoreRow("Security", s.security),
    scoreRow("Code quality", s.code_quality),
    scoreRow("Test maturity", s.test_maturity),
    scoreRow("README matches code", s.readme_alignment),
  );
  $("#summary").textContent = s.summary;
  $("#flags").replaceChildren(...injectionFirst(s.red_flags ?? []).map((f) => element("li", { textContent: f })));
}

const INJECTION_FLAG = /\breviewers?\b|prompt[- ]injection|manipulat/i;

/** The reviewer-manipulation flag is the integrity finding, so it leads. Order only; text is as signed. */
function injectionFirst(flags: string[]): string[] {
  return [...flags.filter((f) => INJECTION_FLAG.test(f)), ...flags.filter((f) => !INJECTION_FLAG.test(f))];
}

const SEVERITY_RANK = ["low", "medium", "high", "critical"];
const KIND_PLURAL: Record<string, [string, string]> = {
  vulnerability: ["vulnerability", "vulnerabilities"],
  hardcoded_secret: ["hardcoded secret", "hardcoded secrets"],
  injection_attempt: ["injection attempt", "injection attempts"],
  bug: ["bug", "bugs"],
  quality: ["quality issue", "quality issues"],
};

/** "1 hardcoded secret (critical), 2 bugs (medium)" instead of repeating each finding. */
function findingCounts(findings: { kind: string; severity: string }[]): string {
  const byKind = new Map<string, { count: number; worst: string }>();
  for (const f of findings) {
    const entry = byKind.get(f.kind) ?? { count: 0, worst: "low" };
    entry.count++;
    if (SEVERITY_RANK.indexOf(f.severity) > SEVERITY_RANK.indexOf(entry.worst)) entry.worst = f.severity;
    byKind.set(f.kind, entry);
  }
  const parts = [...byKind].sort((a, b) => SEVERITY_RANK.indexOf(b[1].worst) - SEVERITY_RANK.indexOf(a[1].worst));
  return (
    parts
      .map(([kind, { count, worst }]) => {
        const [one, many] = KIND_PLURAL[kind] ?? [words(kind), words(kind)];
        return `${count} ${count === 1 ? one : many} (${worst})`;
      })
      .join(", ") || "none"
  );
}

function showClaims(input: SealInput): void {
  const claims = ((input.readme_check?.result ?? {}) as { claims?: ReadmeClaim[] }).claims ?? [];
  $("#claims").replaceChildren(...claims.map((c) => tableRow([c.claim, words(c.status)], ["", `status-${c.status.replace(/_/g, "-")}`])));
}

function showFiles(input: SealInput): void {
  const readme = input.readme_check ? " The README is checked against them separately." : "";
  $("#coverage").textContent = `${input.reviewed_files} of ${input.tracked_files} tracked files were reviewed one by one.${readme}`;
  $("#files").replaceChildren(
    ...input.files.map((f) => {
      const review = (f.review ?? {}) as FileReviewSummary;
      const findings = findingCounts(review.findings ?? []);
      const name = element("code", { textContent: f.path + (f.truncated ? " (first part)" : "") });
      return tableRow([name, review.security_risk ?? "", findings], ["", `risk-${review.security_risk ?? ""}`, ""]);
    }),
  );
}

function checkItem(c: Check): HTMLElement {
  const li = element("li", { className: c.ok === null ? "skip" : c.ok ? "ok" : "fail", textContent: c.name });
  if (c.detail && c.ok !== true) li.append(element("small", { textContent: c.detail }));
  return li;
}

/** The proof column: every check under its group heading, with a tally per group. */
function showChecks(checks: Check[]): void {
  const groups = CHECK_GROUPS.map((group) => ({ group, items: checks.filter((c) => c.group === group) })).filter((g) => g.items.length);
  $("#groups").replaceChildren(
    ...groups.flatMap(({ group, items }) => {
      const heading = element("h3", { textContent: group });
      heading.append(element("small", { textContent: groupTally(items) }));
      const list = element("ul", { className: "checks" });
      list.append(...items.map(checkItem));
      return [heading, list];
    }),
  );
}

/** "9 passed, 1 needs the CLI". */
function groupTally(items: Check[]): string {
  const count = (ok: boolean | null) => items.filter((c) => c.ok === ok).length;
  const parts = [`${count(true)} passed`];
  if (count(null)) parts.push(`${count(null)} needs the CLI`);
  if (count(false)) parts.push(`${count(false)} failed`);
  return parts.join(", ");
}

const YOCTO_PER_NEAR = 10n ** BigInt(NEAR_DECIMALS);
/** Yoctonear as a NEAR amount without trailing zeros ("0.1"). */
const formatNear = (yocto: string) => {
  const whole = BigInt(yocto) / YOCTO_PER_NEAR;
  const frac = (BigInt(yocto) % YOCTO_PER_NEAR).toString().padStart(NEAR_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

/** Report header line for receipts tied to an escrow request: who paid, how much, and its state. */
async function showEscrow(receipt: Receipt): Promise<void> {
  const target = $("#escrow");
  target.replaceChildren();
  const ref = escrowRef(receipt.request_id);
  if (!ref) return;
  try {
    const record = await fetchEscrowRecord(ref);
    if (!record) return;
    const link = element("a", {
      href: `https://explorer.${ref.network}.near.org/accounts/${ref.contract}`,
      textContent: `${ref.contract} request #${ref.id}`,
    });
    target.append(
      `Escrow `,
      link,
      `: ${formatNear(record.fee)} NEAR from ${record.investor} to ${record.founder}, ${record.status.toLowerCase()}.`,
    );
  } catch {
    target.textContent = `Escrow ${ref.contract} request #${ref.id}: couldn't reach NEAR RPC.`;
  }
}

function copyButton(value: string): HTMLButtonElement {
  const button = element("button", { className: "copy", type: "button", textContent: "Copy" });
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, COPIED_FEEDBACK_MS);
  });
  return button;
}

/** The values an investor may want to paste elsewhere (an explorer, the escrow call), with copy buttons. */
function showEvidence(receipt: Receipt): void {
  const rows: [string, string][] = [
    ["Request", receipt.request_id],
    ["Commit", receipt.commit],
    ["Enclave key", receipt.enclave_key],
    ["Question pack", receipt.pack_hash],
    ["Model", receipt.model],
    ["Generated", receipt.generated_at],
  ];
  $("#evidence").replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dd = element("dd");
      dd.append(element("span", { className: "hash", textContent: value }), copyButton(value));
      return [element("dt", { textContent: label }), dd];
    }),
  );
}

/** Render a verified (or failed) receipt. The report is shown either way; a failure turns the tape VOID. */
function show(receipt: Receipt, checks: Check[]): void {
  const passed = allPassed(checks);
  const input = sealInputOf(receipt);
  setTape(passed ? "sealed" : "void", receipt);
  $("#result").hidden = false;
  $("#result").classList.toggle("untrusted", !passed);
  showReport(receipt, scorecardOf(receipt));
  showClaims(input);
  showFiles(input);
  showChecks(checks);
  showEvidence(receipt);
  void showEscrow(receipt);
}

function setStatus(text: string, isError = false): void {
  $("#status").textContent = text;
  $("#status").classList.toggle("error", isError);
}

function summarize(label: string, checks: Check[]): string {
  const failed = checks.filter((c) => c.ok === false).map((c) => c.name);
  if (!failed.length) return "Seal intact. Below is exactly what the enclave signed.";
  return `${label} failed verification, so don't rely on the scores shown. Failed: ${failed.join("; ")}.`;
}

/** Verify a receipt (and optionally its report) and show the result. `label` names it in status messages. */
async function run(receiptText: string, diligenceMd: string | null, label: string): Promise<void> {
  setTape("checking");
  setStatus(`Checking ${label}…`);
  try {
    const receipt = JSON.parse(receiptText) as Receipt;
    const checks = await verifyReceipt(receipt, diligenceMd, browserVerifiers);
    show(receipt, checks);
    setStatus(summarize(label, checks), !allPassed(checks));
  } catch (e) {
    setTape("idle");
    setStatus(`Couldn't check ${label}: ${errorMessage(e)}. Make sure it's a receipt.json produced by sealed-diligence.`, true);
  }
}

async function runFiles(files: FileList): Promise<void> {
  const list = Array.from(files);
  const receipt = list.find((f) => f.name.endsWith(".json"));
  const diligence = list.find((f) => f.name.endsWith(".md"));
  if (!receipt) return setStatus("Add the receipt.json. DILIGENCE.md is optional.", true);
  await run(await receipt.text(), diligence ? await diligence.text() : null, receipt.name);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

/** Fetch and verify a receipt by URL; `editMd` lets the tamper demo change the report first. */
async function runUrls(
  receiptUrl: string,
  diligenceUrl: string | null,
  label: string,
  editMd: (md: string) => string = (md) => md,
): Promise<void> {
  try {
    const [receipt, md] = await Promise.all([fetchText(receiptUrl), diligenceUrl ? fetchText(diligenceUrl) : Promise.resolve(null)]);
    await run(receipt, md === null ? null : editMd(md), label);
  } catch (e) {
    setStatus(`Couldn't load ${label}: ${errorMessage(e)}`, true);
  }
}

const raiseOverall = (md: string) => md.replace(/overall \d+\/100/, `overall ${TAMPERED_OVERALL}/100`);

/** Accept a receipt (and report) dropped anywhere on the page. */
function wireDragAndDrop(): void {
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (++depth === 1) document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", () => {
    if (--depth === 0) document.body.classList.remove("dragging");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    if (e.dataTransfer?.files.length) void runFiles(e.dataTransfer.files);
  });
}

function start(): void {
  wireDragAndDrop();
  $<HTMLInputElement>("#file").addEventListener("change", (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files?.length) void runFiles(files);
  });
  $("#sample").addEventListener("click", () => void runUrls(SAMPLE.receipt, SAMPLE.diligence, "The sample report"));
  $("#tamper").addEventListener("click", () => void runUrls(SAMPLE.receipt, SAMPLE.diligence, "The edited copy", raiseOverall));

  // Shareable links: ?receipt=<url>&md=<url>. With no link, the sample is checked on arrival.
  const params = new URLSearchParams(location.search);
  const shared = params.get("receipt");
  if (params.get("view") === "report") document.body.classList.add("report-view");
  setTape("idle");
  if (shared) void runUrls(shared, params.get("md"), "The linked report");
  else void runUrls(SAMPLE.receipt, SAMPLE.diligence, "The sample report");
}

start();
