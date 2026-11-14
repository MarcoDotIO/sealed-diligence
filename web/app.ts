// Browser verifier: the same checks as `sealed-diligence verify`, run locally in the page.
// Nothing is uploaded; only Intel collateral is fetched (via Phala's public PCCS mirror, which allows browsers).
import init, { js_get_collateral, js_verify } from "@phala/dcap-qvl-web";
import { quoteVerdictFromDcap, sessionNonce, verifyEvidence, type ModelAttestation } from "../src/evidence.ts";
import { verifySignatures, scorecardOf, sealInputOf, type Receipt, type VerifyLine } from "../src/receipt.ts";
import { renderDiligence } from "../src/render.ts";

const PCCS = "https://pccs.phala.network/tdx/certification/v4";
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let wasmReady: Promise<unknown> | null = null;

async function verifyAll(receipt: Receipt, md: string | null): Promise<{ lines: (VerifyLine | { name: string; ok: null; detail?: string })[] }> {
  wasmReady ??= init({ module_or_path: new URL("./dcap-qvl-web_bg.wasm", import.meta.url) });
  await wasmReady;
  const lines: { name: string; ok: boolean | null; detail?: string }[] = [];
  const nonce = sessionNonce({ commit: receipt.commit, packHash: receipt.pack_hash, requestId: receipt.request_id, salt: receipt.nonce.salt });
  lines.push({ name: "Attestation nonce derives from this commit, question pack and request", ok: nonce === receipt.nonce.value });
  const att = await verifyEvidence(receipt.attestation as unknown as ModelAttestation, receipt.nonce.value, {
    async verifyQuote(quote) {
      const collateral = await js_get_collateral(PCCS, quote);
      return quoteVerdictFromDcap(js_verify(quote, collateral, BigInt(Math.floor(Date.now() / 1000))));
    },
    async verifyGpu() {
      return null; // NVIDIA NRAS does not allow browser requests.
    },
  });
  for (const c of att.checks) lines.push({ name: `Enclave: ${c.name}`, ok: c.ok, detail: c.detail });
  lines.push({ name: "Attested key is the receipt's enclave key", ok: att.signingAddress === receipt.enclave_key.toLowerCase() });
  for (const l of await verifySignatures(receipt)) lines.push({ ...l, name: l.name.charAt(0).toUpperCase() + l.name.slice(1) });
  if (md !== null) lines.push({ name: "DILIGENCE.md matches the signed scorecard exactly", ok: renderDiligence(receipt) === md });
  return { lines };
}

function show(receipt: Receipt, lines: { name: string; ok: boolean | null; detail?: string }[]) {
  const s = scorecardOf(receipt);
  const input = sealInputOf(receipt);
  const failed = lines.some((l) => l.ok === false);
  $("#result").hidden = false;
  $("#result").classList.toggle("untrusted", failed);
  $("#banner").className = `banner ${failed ? "bad" : "good"}`;
  $("#banner").textContent = failed ? "Not verified: something was altered or doesn't check out" : "Verified: scored inside an attested enclave, unaltered";
  $("#repo").textContent = `${receipt.repo_label} @ ${receipt.commit.slice(0, 12)}`;
  $("#verdict").textContent = { proceed: "Proceed", proceed_with_caution: "Proceed with caution", do_not_proceed: "Do not proceed" }[s.verdict] ?? s.verdict;
  $("#verdict").dataset.v = s.verdict;
  $("#overall").textContent = String(s.overall);
  const scores: [string, number][] = [["Security", s.security], ["Code quality", s.code_quality], ["Test maturity", s.test_maturity], ["README matches code", s.readme_alignment]];
  $("#scores").replaceChildren(
    ...scores.map(([k, v]) => {
      const row = document.createElement("div");
      row.className = "score";
      row.innerHTML = `<span></span><div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div><b></b>`;
      row.querySelector("span")!.textContent = k;
      row.querySelector("b")!.textContent = String(v);
      return row;
    }),
  );
  $("#counts").textContent = `${s.injection_attempts} injection attempt(s) · ${s.hardcoded_secrets} hardcoded secret(s) · ${input.reviewed_files} of ${input.tracked_files} files reviewed`;
  $("#summary").textContent = s.summary;
  $("#flags").replaceChildren(...(s.red_flags ?? []).map((f) => Object.assign(document.createElement("li"), { textContent: f })));
  $("#checks").replaceChildren(
    ...lines.map((l) => {
      const li = document.createElement("li");
      li.className = l.ok === null ? "skip" : l.ok ? "ok" : "fail";
      li.textContent = l.name;
      if (l.detail && l.ok !== true) li.append(Object.assign(document.createElement("small"), { textContent: l.detail }));
      return li;
    }),
  );
  $("#meta").textContent = `Request ${receipt.request_id} · model ${receipt.model} · enclave key ${receipt.enclave_key.slice(0, 16)}… · ${receipt.generated_at}`;
}

async function run(receiptText: string, md: string | null) {
  $("#status").textContent = "Verifying…";
  try {
    const receipt = JSON.parse(receiptText) as Receipt;
    const { lines } = await verifyAll(receipt, md);
    show(receipt, lines);
    $("#status").textContent = "";
  } catch (e) {
    $("#status").textContent = `Could not verify: ${(e as Error).message}`;
  }
}

async function readFiles(files: FileList | File[]) {
  let receipt: string | null = null;
  let md: string | null = null;
  for (const f of Array.from(files)) {
    if (f.name.endsWith(".json")) receipt = await f.text();
    else if (f.name.endsWith(".md")) md = await f.text();
  }
  if (!receipt) return void ($("#status").textContent = "Add the receipt.json (and optionally DILIGENCE.md).");
  await run(receipt, md);
}

const drop = $("#drop");
drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("over")));
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer?.files) void readFiles(e.dataTransfer.files);
});
$<HTMLInputElement>("#file").addEventListener("change", (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (files) void readFiles(files);
});
$("#sample").addEventListener("click", async (e) => {
  e.preventDefault();
  const [r, m] = await Promise.all([fetch("sample/receipt.json").then((x) => x.text()), fetch("sample/DILIGENCE.md").then((x) => x.text())]);
  await run(r, m);
});
$("#tamper").addEventListener("click", async (e) => {
  e.preventDefault();
  const [r, m] = await Promise.all([fetch("sample/receipt.json").then((x) => x.text()), fetch("sample/DILIGENCE.md").then((x) => x.text())]);
  await run(r, m.replace(/overall (\d+)\/100/, (_, n) => `overall ${Math.min(100, Number(n) + 50)}/100`));
});
