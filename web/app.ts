// Browser verifier: the same checks as `sealed-diligence verify`, run locally in the page.
// Nothing is uploaded. Intel collateral comes from Phala's public PCCS mirror, which allows browser requests.
import init, { js_get_collateral, js_verify } from "@phala/dcap-qvl-web";
import { quoteVerdictFromDcap, type Check, type EvidenceVerifiers } from "../src/evidence.ts";
import type { Scorecard } from "../src/pack.ts";
import { scorecardOf, sealInputOf, type Receipt } from "../src/receipt.ts";
import { VERDICT_LABEL } from "../src/render.ts";
import { allPassed, verifyReceipt } from "../src/verify-core.ts";

const PCCS = "https://pccs.phala.network/tdx/certification/v4";
const SAMPLE = { receipt: "sample/receipt.json", diligence: "sample/DILIGENCE.md" };
const TAMPER_BUMP = 50;
const KEY_PREVIEW = 16;
const SHORT_HASH = 12;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) =>
  Object.assign(document.createElement(tag), props);

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

function scoreRow(label: string, value: number): HTMLElement {
  const fill = element("i");
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  const bar = element("div", { className: "bar" });
  bar.append(fill);
  const row = element("div", { className: "score" });
  row.append(element("span", { textContent: label }), bar, element("b", { textContent: String(value) }));
  return row;
}

function checkItem(c: Check): HTMLElement {
  const li = element("li", { className: c.ok === null ? "skip" : c.ok ? "ok" : "fail", textContent: c.name });
  if (c.detail && c.ok !== true) li.append(element("small", { textContent: c.detail }));
  return li;
}

function showScorecard(receipt: Receipt, s: Scorecard): void {
  const input = sealInputOf(receipt);
  $("#repo").textContent = `${receipt.repo_label} @ ${receipt.commit.slice(0, SHORT_HASH)}`;
  $("#verdict").textContent = VERDICT_LABEL[s.verdict] ?? s.verdict;
  $("#verdict").dataset.v = s.verdict;
  $("#overall").textContent = String(s.overall);
  $("#scores").replaceChildren(
    scoreRow("Security", s.security),
    scoreRow("Code quality", s.code_quality),
    scoreRow("Test maturity", s.test_maturity),
    scoreRow("README matches code", s.readme_alignment),
  );
  $("#counts").textContent = `${s.injection_attempts} injection attempt(s) · ${s.hardcoded_secrets} hardcoded secret(s) · ${input.reviewed_files} of ${input.tracked_files} files reviewed`;
  $("#summary").textContent = s.summary;
  $("#flags").replaceChildren(...(s.red_flags ?? []).map((f) => element("li", { textContent: f })));
}

function show(receipt: Receipt, checks: Check[]): void {
  const passed = allPassed(checks);
  $("#result").hidden = false;
  $("#result").classList.toggle("untrusted", !passed);
  $("#banner").className = `banner ${passed ? "good" : "bad"}`;
  $("#banner").textContent = passed ? "Verified: scored inside an attested enclave, unaltered" : "Not verified: something was altered or doesn't check out";
  showScorecard(receipt, scorecardOf(receipt));
  $("#checks").replaceChildren(...checks.map(checkItem));
  $("#meta").textContent = `Request ${receipt.request_id} · model ${receipt.model} · enclave key ${receipt.enclave_key.slice(0, KEY_PREVIEW)}… · ${receipt.generated_at}`;
}

async function run(receiptText: string, diligenceMd: string | null): Promise<void> {
  $("#status").textContent = "Verifying…";
  try {
    const receipt = JSON.parse(receiptText) as Receipt;
    show(receipt, await verifyReceipt(receipt, diligenceMd, browserVerifiers));
    $("#status").textContent = "";
  } catch (e) {
    $("#status").textContent = `Could not verify: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function runFiles(files: FileList): Promise<void> {
  const list = Array.from(files);
  const receipt = list.find((f) => f.name.endsWith(".json"));
  const diligence = list.find((f) => f.name.endsWith(".md"));
  if (!receipt) {
    $("#status").textContent = "Add the receipt.json (and optionally DILIGENCE.md).";
    return;
  }
  await run(await receipt.text(), diligence ? await diligence.text() : null);
}

async function runSample(editMd: (md: string) => string = (md) => md): Promise<void> {
  const [receipt, md] = await Promise.all([fetch(SAMPLE.receipt), fetch(SAMPLE.diligence)].map((p) => p.then((r) => r.text())));
  await run(receipt, editMd(md));
}

const raiseOverall = (md: string) => md.replace(/overall (\d+)\/100/, (_, n) => `overall ${Math.min(100, Number(n) + TAMPER_BUMP)}/100`);

function onClick(sel: string, handler: () => Promise<void>): void {
  $(sel).addEventListener("click", (e) => {
    e.preventDefault();
    void handler();
  });
}

const drop = $("#drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer?.files) void runFiles(e.dataTransfer.files);
});
$<HTMLInputElement>("#file").addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files) void runFiles(files);
});
onClick("#sample", () => runSample());
onClick("#tamper", () => runSample(raiseOverall));
