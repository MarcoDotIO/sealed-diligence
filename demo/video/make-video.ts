// Build the demo video from the outputs of capture.sh: real screenshots of the verifier page,
// terminal scenes replaying captured output (including the contract state read back from testnet), voice-over, captions. Output: demo/video/out/sealed-diligence-demo.mp4
//   npx tsx demo/video/make-video.ts
// Voice: ElevenLabs when ELEVEN_LABS_API_KEY is set (ELEVENLABS_VOICE_ID optional), otherwise macOS `say`.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";

const HERE = resolve(import.meta.dirname);
const ROOT = resolve(HERE, "../..");
const CAPTURE = join(HERE, "capture");
const OUT = join(HERE, "out");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 30;
const SIZE = { width: 1920, height: 1080 };
const SHOT_VIEWPORT = { width: 1280, height: 720 };
const SHOT_SCALE = 1.25;
const VOICE_PAD = 0.9;
/** Social platforms play around -14 LUFS; normalize so the voice isn't quiet next to other posts. */
const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11";
const SAY_VOICE = "Samantha";
const ELEVEN_DEFAULT_VOICE = "cjVigY5qzO86Huf0OWal"; // Eric: smooth, trustworthy

interface Scene {
  type: "title" | "terminal" | "shot";
  voice: string;
  minDur?: number;
  start?: number;
  dur?: number;
  [k: string]: unknown;
}

const readCapture = (name: string) =>
  readFileSync(join(CAPTURE, name), "utf8")
    .replaceAll(`${CAPTURE}/`, "./")
    .trimEnd()
    .split("\n");

/** Serves the built verifier from docs/, plus the captured receipt under /capture/. */
function staticServer(docs: string): Promise<{ server: Server; url: string }> {
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".md": "text/markdown", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/\/$/, "/index.html");
    const [root, rel] = pathname.startsWith("/capture/") ? [CAPTURE, pathname.slice("/capture".length)] : [docs, pathname];
    const path = join(root, rel);
    if (!path.startsWith(root) || !existsSync(path)) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(res);
  });
  return new Promise((r) => server.listen(0, () => r({ server, url: `http://localhost:${(server.address() as { port: number }).port}/` })));
}

/** Opens the verifier on the captured receipt through its own shareable-link parameters. */
async function verifierShot(browser: Browser, url: string, diligenceFile: string, out: string, framing: "full-page" | "at-tape"): Promise<void> {
  const page = await browser.newPage({ viewport: SHOT_VIEWPORT, deviceScaleFactor: SHOT_SCALE, colorScheme: "light" });
  await page.goto(`${url}?receipt=capture/receipt.json&md=capture/${diligenceFile}`);
  await page.waitForSelector('#tape[data-state="sealed"], #tape[data-state="void"]', { timeout: 120_000 });
  await page.waitForTimeout(1200);
  if (framing === "at-tape") await page.evaluate("window.scrollTo(0, document.querySelector('.tape-zone').offsetTop - 330)");
  await page.screenshot({ path: out, fullPage: framing === "full-page" });
  await page.close();
}

const elevenKey = () => process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;

function audioSeconds(file: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

/** Clips are cached by voice + text, so rebuilding doesn't re-spend TTS credits on unchanged lines. */
async function speak(text: string, outDir: string): Promise<string> {
  const voice = elevenKey() ? `eleven-${process.env.ELEVENLABS_VOICE_ID ?? ELEVEN_DEFAULT_VOICE}` : `say-${SAY_VOICE}`;
  const base = join(outDir, `vo-${createHash("sha1").update(`${voice}|${text}`).digest("hex").slice(0, 16)}`);
  for (const ext of [".mp3", ".aiff"]) if (existsSync(base + ext)) return base + ext;
  return synthesize(text, `${base}.wav`);
}

async function synthesize(text: string, file: string): Promise<string> {
  const key = elevenKey();
  if (!key) {
    const aiff = file.replace(/\.\w+$/, ".aiff");
    execFileSync("say", ["-v", SAY_VOICE, "-r", "178", "-o", aiff, text]);
    return aiff;
  }
  const voice = process.env.ELEVENLABS_VOICE_ID ?? ELEVEN_DEFAULT_VOICE;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const mp3 = file.replace(/\.\w+$/, ".mp3");
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  return mp3;
}

function sealSerial(): string {
  const receipt = JSON.parse(readFileSync(join(CAPTURE, "receipt.json"), "utf8")) as { request_id: string; commit: string; enclave_key: string };
  return `Sealed ◆ ${receipt.request_id} ◆ commit ${receipt.commit.slice(0, 8)} ◆ enclave ${receipt.enclave_key.slice(0, 8)}`;
}

const VERIFIER_URL = "marcodotio.github.io/sealed-diligence";

function scenes(): Scene[] {
  return [
    {
      type: "title", brand: true,
      html: "Investors want to see your code before they wire. Founders don't want to show it.",
      tape: "Sealed Diligence ◆ check before you trust", tapeTop: 760, tapeAt: 1.2,
      voice: "Investors want to see your code before they wire. Founders don't want to show it.",
    },
    {
      type: "terminal", step: ["1", "The founder's private repo"], windowTitle: "acme-orders", lines: readCapture("1-repo.txt"),
      caption: "It hides a note asking AI reviewers for a perfect score, and a live payment key.",
      voice: "Here's a startup's private repo. It hides a comment asking A.I. reviewers for a perfect score, and a live payment key.",
    },
    {
      type: "terminal", step: ["2", "The investor asks on NEAR"], windowTitle: "investor", lines: readCapture("2-request.txt"),
      caption: "The fee is escrowed. The commit, the questions and the trusted enclave key are pinned.",
      voice: "The investor opens a diligence request on NEAR. It escrows a fee, and pins the commit, the questions, and the enclave they trust.",
    },
    {
      type: "terminal", step: ["3", "Sealed review inside NEAR AI"], windowTitle: "founder", lines: readCapture("3-review.txt"), lineGap: 0.75,
      caption: "The enclave proves its hardware before any code leaves the machine. Every answer is signed.",
      voice: "The founder runs Sealed Diligence. It verifies the NEAR A.I. enclave's Intel and NVIDIA attestation first. Then each file is reviewed inside it, and every answer comes back signed.",
    },
    {
      type: "shot", step: ["4", "The investor checks the seal"], url: VERIFIER_URL,
      image: "verified.png", panFrom: 420, panStart: 3.2, panDur: 8, panPx: 1750,
      caption: "Real Intel TDX attestation and every signature, checked in the browser. No source code anywhere.",
      voice: "The investor checks it in the browser. Real hardware attestation, every signature, and no source code anywhere. The verdict: do not proceed, with the injection attempt flagged as an integrity red flag.",
    },
    {
      type: "shot", step: ["5", "The founder edits one score"], url: VERIFIER_URL,
      image: "tampered.png", panStart: 99,
      caption: "One edited number, and the seal reads VOID.",
      voice: "Change a single score, and it no longer verifies.",
    },
    {
      type: "terminal", step: ["6", "Paid on-chain"], windowTitle: "founder", lines: readCapture("6-fulfil.txt"),
      caption: "The contract checks the enclave's signature itself, then pays. The request reads Fulfilled.",
      minDur: 10.5,
      voice: "On chain, the contract checks the enclave's signature itself, and only then pays for the report.",
    },
    {
      type: "title", brand: true,
      html: "Read the code review. Never see the code.",
      tape: sealSerial(), tapeTop: 470, tapeAt: 0.5,
      facts: [
        ["NEAR AI Cloud", "Reviews run in attested Intel TDX and NVIDIA GPU enclaves. Every answer is signed."],
        ["NEAR contract", "Checks the enclave's signature on-chain before it pays for a report."],
        ["Open source", "github.com/MarcoDotIO/sealed-diligence"],
      ],
      voice: "Sealed Diligence. Read the code review, never see the code. Built on NEAR A.I. and NEAR.",
      minDur: 6.5,
    },
  ];
}

async function renderFrames(browser: Browser, timeline: Scene[], total: number, video: string): Promise<void> {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  await page.addInitScript((t) => ((window as unknown as { TIMELINE: unknown }).TIMELINE = t), timeline);
  await page.goto(`file://${join(OUT, "stage.html")}`);
  await page.evaluate("window.render(0)");
  await page.evaluate("window.imagesReady()");
  const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", video], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.ceil(total * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate(`window.render(${f / FPS})`);
    ffmpeg.stdin.write(await page.screenshot({ type: "jpeg", quality: 95 }));
    if (f % (FPS * 10) === 0) console.log(`  frame ${f}/${frames}`);
  }
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on("close", r));
  await page.close();
}

function mixAudio(timeline: Scene[], clips: (string | null)[], total: number, out: string): void {
  const inputs: string[] = [];
  const filters: string[] = [];
  clips.forEach((clip, i) => {
    if (!clip) return;
    const n = inputs.length / 2;
    inputs.push("-i", clip);
    filters.push(`[${n}:a]adelay=${Math.round(((timeline[i].start ?? 0) + 0.35) * 1000)}:all=1[a${n}]`);
  });
  const n = inputs.length / 2;
  const graph = `${filters.join(";")};${Array.from({ length: n }, (_, i) => `[a${i}]`).join("")}amix=inputs=${n}:normalize=0,apad,atrim=0:${total}[out]`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", out]);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const [from, to] of [[join(HERE, "stage.html"), "stage.html"], [join(ROOT, "web/assets/archivo.woff2"), "archivo.woff2"], [join(ROOT, "web/assets/mark.svg"), "mark.svg"]]) {
    writeFileSync(join(OUT, to), readFileSync(from));
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const { server, url } = await staticServer(join(ROOT, "docs"));

  console.log("screenshots…");
  await verifierShot(browser, url, "DILIGENCE.md", join(OUT, "verified.png"), "full-page");
  await verifierShot(browser, url, "DILIGENCE.tampered.md", join(OUT, "tampered.png"), "at-tape");
  server.close();

  console.log(`voice-over (${elevenKey() ? "ElevenLabs" : "macOS say"})…`);
  const timeline = scenes();
  const clips: (string | null)[] = [];
  let clock = 0;
  for (const scene of timeline) {
    const clip = scene.voice ? await speak(scene.voice, OUT) : null;
    clips.push(clip);
    scene.start = clock;
    scene.dur = Math.max(scene.minDur ?? 0, clip ? audioSeconds(clip) + VOICE_PAD : 0);
    clock += scene.dur;
  }

  console.log(`rendering ${clock.toFixed(1)}s at ${FPS} fps…`);
  await renderFrames(browser, timeline, clock, join(OUT, "video.mp4"));
  await browser.close();
  mixAudio(timeline, clips, clock, join(OUT, "voice.m4a"));
  const final = join(OUT, "sealed-diligence-demo.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(OUT, "video.mp4"), "-i", join(OUT, "voice.m4a"), "-c:v", "copy", "-af", LOUDNESS, "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final]);
  console.log(`wrote ${final}`);
}

await main();
