// Browser verifier: the same checks as `sealed-diligence verify`, run locally in the page.
// Nothing is uploaded. Intel collateral comes from Phala's public PCCS mirror and the escrow record
// from public NEAR RPC, both of which allow browser requests.
import init, { js_get_collateral, js_verify } from "@phala/dcap-qvl-web";
import { quoteVerdictFromDcap, type Check, type CheckGroup, type EvidenceVerifiers } from "../src/evidence.ts";
import type { Scorecard, SealInput } from "../src/pack.ts";
import { scorecardOf, sealInputOf, type Receipt } from "../src/receipt.ts";
import { VERDICT_LABEL } from "../src/render.ts";
import { allPassed, verifyReceipt } from "../src/verify-core.ts";

const PCCS = "https://pccs.phala.network/tdx/certification/v4";
const SAMPLE = { receipt: "sample/receipt.json", diligence: "sample/DILIGENCE.md" };
const TAMPERED_OVERALL = 94;
const SHORT = 8;
const TAPE_REPEATS = 6;
const GROUP_ORDER: CheckGroup[] = ["Enclave hardware", "Signed answers", "Report file", "On-chain payment"];

type TapeState = "idle" | "checking" | "sealed" | "void";

interface ReadmeClaim {
  claim: string;
  status: string;
}
interface FileReviewSummary {
  security_risk?: string;
  findings?: { kind: string; severity: string }[];
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) =>
  Object.assign(document.createElement(tag), props);
const words = (s: string) => s.replace(/_/g, " ");

let wasmReady: Promise<unknown> | null = null;

const browserVerifiers: EvidenceVerifiers = {
  async verifyQuote(quote) {
    wasmReady ??= init({ module_or_path: new URL("./dcap-qvl-web_bg.wasm", import.meta.url) });
    await wasmReady;
    const collateral = await js_get_collateral(PCCS, quote);
    return quoteVerdictFromDcap(js_verify(quote, collateral, BigInt(Math.floor(Date.now() / 1000))));
  },
  verifyGpu: async () => null,
};

function setTape(state: TapeState, receipt?: Receipt): void {
  const phrase = {
    idle: "Sealed Diligence ◆ check before you trust",
    checking: "Checking the seal",
    sealed: receipt ? `Sealed ◆ ${receipt.request_id} ◆ commit ${receipt.commit.slice(0, SHORT)} ◆ enclave ${receipt.enclave_key.slice(0, SHORT)}` : "Sealed",
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

function showReport(receipt: Receipt, s: Scorecard, input: SealInput): void {
  $("#verdict").textContent = VERDICT_LABEL[s.verdict] ?? s.verdict;
  $("#verdict").dataset.v = s.verdict;
  $("#overall").textContent = String(s.overall);
  $("#subject").textContent = `${receipt.repo_label}, commit ${receipt.commit.slice(0, 12)}. ${s.injection_attempts} prompt-injection attempt(s), ${s.hardcoded_secrets} hardcoded secret(s).`;
  $("#scores").replaceChildren(
    scoreRow("Security", s.security),
    scoreRow("Code quality", s.code_quality),
    scoreRow("Test maturity", s.test_maturity),
    scoreRow("README matches code", s.readme_alignment),
  );
  $("#summary").textContent = s.summary;
  $("#flags").replaceChildren(...(s.red_flags ?? []).map((f) => element("li", { textContent: f })));
}

function showClaims(input: SealInput): void {
  const claims = ((input.readme_check?.result ?? {}) as { claims?: ReadmeClaim[] }).claims ?? [];
  $("#claims").replaceChildren(
    ...claims.map((c) => tableRow([c.claim, words(c.status)], ["", `status-${c.status.replace(/_/g, "-")}`])),
  );
}

function showFiles(input: SealInput): void {
  const readme = input.readme_check ? " The README is checked against them separately." : "";
  $("#coverage").textContent = `${input.reviewed_files} of ${input.tracked_files} tracked files were reviewed one by one.${readme}`;
  $("#files").replaceChildren(
    ...input.files.map((f) => {
      const review = (f.review ?? {}) as FileReviewSummary;
      const findings = (review.findings ?? []).map((x) => `${x.severity} ${words(x.kind)}`).join(", ") || "none";
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

function showChecks(checks: Check[]): void {
  const groups = GROUP_ORDER.map((group) => ({ group, items: checks.filter((c) => c.group === group) })).filter((g) => g.items.length);
  $("#groups").replaceChildren(
    ...groups.flatMap(({ group, items }) => {
      const passed = items.filter((c) => c.ok === true).length;
      const heading = element("h3", { textContent: group });
      heading.append(element("small", { textContent: `${passed} of ${items.length} passed` }));
      const list = element("ul", { className: "checks" });
      list.append(...items.map(checkItem));
      return [heading, list];
    }),
  );
}

function copyButton(value: string): HTMLButtonElement {
  const button = element("button", { className: "copy", type: "button", textContent: "Copy" });
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
  return button;
}

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

function show(receipt: Receipt, checks: Check[]): void {
  const passed = allPassed(checks);
  const input = sealInputOf(receipt);
  setTape(passed ? "sealed" : "void", receipt);
  $("#result").hidden = false;
  $("#result").classList.toggle("untrusted", !passed);
  showReport(receipt, scorecardOf(receipt), input);
  showClaims(input);
  showFiles(input);
  showChecks(checks);
  showEvidence(receipt);
}

function setStatus(text: string, isError = false): void {
  $("#status").textContent = text;
  $("#status").classList.toggle("error", isError);
}

function summarize(label: string, checks: Check[]): string {
  const failed = checks.filter((c) => c.ok === false).map((c) => c.name);
  if (!failed.length) return `${label}: every check passed.`;
  return `${label} failed verification, so don't rely on the scores shown. Failed: ${failed.join("; ")}.`;
}

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
    setStatus(`Couldn't check ${label}: ${e instanceof Error ? e.message : String(e)}. Make sure it's a receipt.json produced by sealed-diligence.`, true);
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

async function runUrls(receiptUrl: string, diligenceUrl: string | null, label: string, editMd: (md: string) => string = (md) => md): Promise<void> {
  try {
    const [receipt, md] = await Promise.all([fetchText(receiptUrl), diligenceUrl ? fetchText(diligenceUrl) : Promise.resolve(null)]);
    await run(receipt, md === null ? null : editMd(md), label);
  } catch (e) {
    setStatus(`Couldn't load ${label}: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

const raiseOverall = (md: string) => md.replace(/overall \d+\/100/, `overall ${TAMPERED_OVERALL}/100`);

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
  setTape("idle");
  if (shared) void runUrls(shared, params.get("md"), "The linked report");
  else void runUrls(SAMPLE.receipt, SAMPLE.diligence, "The sample report");
}

start();
