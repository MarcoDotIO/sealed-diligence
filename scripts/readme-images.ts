/**
 * Regenerates the README's images: the banner, and light/dark screenshots of the verifier checking the
 * sample report (full pages in `demo/screens/`, README crops in `docs/assets/`). Needs Google Chrome and
 * a built site (`./scripts/build-web.sh`).
 *
 *   npx tsx scripts/readme-images.ts
 * @module
 */
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const SITE = join(ROOT, "docs");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCREEN = { width: 1440, height: 900 };
const RETINA = 2;
const VERIFIED = "Seal intact";
const CHECK_TIMEOUT_MS = 60_000;
/** The tape, the verdict and the first checks, in CSS pixels. */
const README_CROP = { x: 0, y: 665, width: 1440, height: 950 };
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

/** Serve the built site on a free localhost port. */
function serveSite(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = join(SITE, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(SITE)) return void res.writeHead(403).end();
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    createReadStream(file)
      .on("error", () => res.writeHead(404).end())
      .pipe(res);
  });
  return new Promise((ready) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      ready({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
    }),
  );
}

async function banner(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 520 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(ROOT, "scripts/readme-banner.html")).href);
  await page.evaluate("document.fonts.ready");
  await page.screenshot({ path: join(SITE, "assets/readme-banner.png") });
  await page.close();
}

async function verifierShot(browser: Browser, url: string, colorScheme: "light" | "dark"): Promise<void> {
  const page = await browser.newPage({ viewport: SCREEN, deviceScaleFactor: RETINA, colorScheme, reducedMotion: "reduce" });
  await page.goto(url);
  await page.getByText(VERIFIED).waitFor({ timeout: CHECK_TIMEOUT_MS });
  await page.screenshot({ path: join(ROOT, `demo/screens/verifier-${colorScheme}.png`), fullPage: true });
  const suffix = colorScheme === "dark" ? "-dark" : "";
  await page.screenshot({ path: join(SITE, `assets/readme-verifier${suffix}.png`), clip: README_CROP, fullPage: true, scale: "css" });
  await page.close();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const site = await serveSite();
try {
  await banner(browser);
  await verifierShot(browser, site.url, "light");
  await verifierShot(browser, site.url, "dark");
} finally {
  site.close();
  await browser.close();
}
