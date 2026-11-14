// Browser journey through the real UI, against a running deployment.
//
//   BASE_URL=https://your-app.vercel.app BROWSER_PATH=/path/to/chrome npm run e2e
//
// Registers a throwaway account, uploads public/samples/sample_sales.csv through the upload
// control, runs ONE real analysis (this uses model quota), checks the report, exports, themes,
// phone-width layout and sign-out/sign-in, then deletes the account. Screenshots and
// downloads go to e2e/output/. Exits non-zero if any check fails.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = path.resolve(process.env.E2E_OUTPUT ?? path.join(here, "output"));
const SAMPLE = path.join(here, "..", "public", "samples", "sample_sales.csv");
const DEFAULT_BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const EDGE =
  process.env.BROWSER_PATH ?? DEFAULT_BROWSERS.find((candidate) => fs.existsSync(candidate));
if (!EDGE) {
  console.error("No Chrome, Edge or Chromium found. Set BROWSER_PATH.");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "downloads"), { recursive: true });

const results = [];
const problems = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  " + detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on("response", (r) => {
  const url = r.url();
  if (
    r.status() >= 500 ||
    (r.status() >= 400 && !url.includes("/auth/me") && !url.includes("_rsc"))
  )
    problems.push(`http ${r.status()} ${r.request().method()} ${url.replace(BASE, "")}`);
});
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: path.join(OUT, "downloads"),
});

const shot = async (name, fullPage = true) =>
  page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
const api = (p, init = {}) =>
  page.evaluate(
    async (p, init) => {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("awa_csrf="))
        ?.split("=")[1];
      const res = await fetch(`/api/v1${p}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
        },
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    p,
    init,
  );
const overflow = () =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Clicks the first visible element of `selector` whose own text (trimmed) starts with `text`.
const clickText = async (text, selector = "button, a, [role=menuitem]") => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const handles = await page.$$(selector);
    for (const handle of handles) {
      const match = await handle.evaluate((el, text) => {
        const rect = el.getBoundingClientRect();
        const visible =
          rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
        return visible && el.textContent.trim().startsWith(text);
      }, text);
      if (match) {
        await handle.click();
        return;
      }
    }
    await sleep(200);
  }
  throw new Error(`no visible ${selector} starting with "${text}"`);
};

const email = `e2e-${Date.now()}@example.com`;
const password = "E2e-browser-pass-42";

try {
  // ---------------------------------------------------------------- landing
  await page.goto(BASE, { waitUntil: "networkidle0" });
  check("landing page renders", (await page.title()).length > 0 && (await page.$("h1")) !== null);
  await shot("01-landing", false);
  await shot("01-landing-full");

  // ---------------------------------------------------------------- register
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle0" });
  await page.click("button[type=submit]");
  await sleep(400);
  const validation = await page.$$eval("[role=alert], [aria-invalid=true]", (els) => els.length);
  check("empty registration shows validation errors", validation > 0, `found ${validation}`);
  await page.type('input[name="name"]', "Browser Tester");
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await shot("02-register", false);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("button[type=submit]"),
  ]);
  check("registration lands on the dashboard", new URL(page.url()).pathname === "/app", page.url());
  await sleep(800);
  await shot("03-dashboard-empty");

  // ---------------------------------------------------------------- upload through the UI
  await page.goto(`${BASE}/app/analyses/new`, { waitUntil: "networkidle0" });
  let input = await page.$("input[type=file]");
  if (!input) {
    await page.goto(`${BASE}/app/datasets`, { waitUntil: "networkidle0" });
    await clickText("Upload");
    input = await page.waitForSelector("input[type=file]", { timeout: 10000 });
  }
  await input.uploadFile(SAMPLE);
  const uploaded = await page
    .waitForFunction(() => /dataset=|\/app\/datasets\/[0-9a-f-]{36}/.test(location.href), {
      timeout: 60000,
    })
    .then(() => true)
    .catch(() => false);
  await sleep(1500);
  const datasets = await api("/datasets");
  check(
    "upload through the UI created a dataset",
    uploaded && datasets.body?.total === 1,
    JSON.stringify(datasets.body)?.slice(0, 200),
  );
  const dataset = datasets.body.items[0];
  check(
    "uploaded dataset was profiled",
    dataset.row_count === 2400 && dataset.column_count === 11,
    `${dataset.row_count}x${dataset.column_count}`,
  );

  // ---------------------------------------------------------------- dataset workspace
  await page.goto(`${BASE}/app/datasets/${dataset.id}`, { waitUntil: "networkidle0" });
  await sleep(1000);
  const workspaceText = await page.evaluate(() => document.body.innerText);
  check(
    "dataset workspace shows columns and preview",
    workspaceText.includes("region") && workspaceText.includes("ORD-"),
    "missing column or preview rows",
  );
  await shot("04-dataset-workspace");

  // ---------------------------------------------------------------- run an analysis
  await page.goto(`${BASE}/app/analyses/new?dataset=${dataset.id}`, { waitUntil: "networkidle0" });
  const question =
    "Analyze regional sales performance, identify underperforming regions, calculate revenue growth, and recommend actions.";
  await page.waitForSelector('textarea[placeholder^="What would you like"]', { visible: true });
  await page.type('textarea[placeholder^="What would you like"]', question);
  await shot("05-new-analysis", false);
  await Promise.all([
    page.waitForFunction(() => /\/app\/analyses\/[0-9a-f-]{36}/.test(location.pathname), {
      timeout: 30000,
    }),
    clickText("Start analysis", "button"),
  ]);
  const analysisId = page.url().split("/").pop().split("?")[0];
  check(
    "analysis started and opened its workspace",
    /^[0-9a-f-]{36}$/.test(analysisId),
    page.url(),
  );

  const started = Date.now();
  let status = "queued";
  let midShot = false;
  while (Date.now() - started < 420000) {
    const r = await api(`/analyses/${analysisId}`);
    status = r.body?.status;
    if (!midShot && Date.now() - started > 12000) {
      await shot("06-analysis-running", false);
      midShot = true;
    }
    if (["completed", "failed", "cancelled"].includes(status)) break;
    await sleep(3000);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const detail = await api(`/analyses/${analysisId}`);
  check(
    `analysis completed in the browser (${seconds}s)`,
    status === "completed",
    `status=${status} error=${detail.body?.error}`,
  );
  await sleep(3000);
  const workspace = await page.evaluate(() => document.body.innerText);
  check(
    "report is rendered inline in the conversation",
    /Executive summary|Key metrics/i.test(workspace),
  );
  check("verification badge is shown", /verified/i.test(workspace));
  const svgCharts = await page.$$eval(".recharts-wrapper, [role=img]", (els) => els.length);
  check("charts are rendered from report data", svgCharts > 0, `charts=${svgCharts}`);
  const spinning = await page.$$eval("[data-state=running]", (els) => els.length);
  check(
    "no timeline step is left spinning after completion",
    spinning === 0,
    `running steps=${spinning}`,
  );
  await shot("07-analysis-report");

  // ---------------------------------------------------------------- report page and exports
  const reportId = detail.body.messages.find((m) => m.role === "assistant")?.report_id;
  await page.goto(`${BASE}/app/reports/${reportId}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await shot("08-report-page");
  const evidenceChip = await page.$("::-p-text(E1)");
  check("evidence references are present on the report page", evidenceChip !== null);

  for (const [label, ext, magic] of [
    ["PDF (.pdf)", ".pdf", "%PDF"],
    ["Excel (.xlsx)", ".xlsx", "PK"],
    ["Markdown (.md)", ".md", "# "],
  ]) {
    // Remove earlier downloads of this type: a report with the same title gets the same file
    // name, so a rerun would otherwise overwrite the old file and look like no download.
    for (const old of fs.readdirSync(path.join(OUT, "downloads"))) {
      if (old.endsWith(ext)) fs.rmSync(path.join(OUT, "downloads", old), { force: true });
    }
    const before = new Set(fs.readdirSync(path.join(OUT, "downloads")));
    await clickText("Export", "button");
    await clickText(label);
    let file = null;
    for (let i = 0; i < 40 && !file; i++) {
      await sleep(250);
      file = fs
        .readdirSync(path.join(OUT, "downloads"))
        .find((f) => !before.has(f) && f.endsWith(ext));
    }
    const head = file
      ? fs
          .readFileSync(path.join(OUT, "downloads", file))
          .subarray(0, 4)
          .toString("latin1")
      : "";
    check(
      `export ${ext} downloads a valid file`,
      Boolean(file) && head.startsWith(magic),
      `file=${file} head=${JSON.stringify(head)}`,
    );
    await page.keyboard.press("Escape");
  }

  // ---------------------------------------------------------------- follow-up question
  await page.goto(`${BASE}/app/analyses/${analysisId}`, { waitUntil: "networkidle0" });
  const followUp = await page.$('textarea[placeholder^="Ask a follow-up"]');
  check("follow-up composer is available after completion", followUp !== null);

  // ---------------------------------------------------------------- other pages
  for (const [route, name] of [
    ["/app", "09-dashboard"],
    ["/app/datasets", "10-datasets"],
    ["/app/analyses", "11-analyses"],
    ["/app/reports", "12-reports"],
    ["/app/settings", "13-settings"],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0" });
    await sleep(800);
    await shot(name);
  }
  const usage = await page.evaluate(() => document.body.innerText);
  check(
    "settings page shows usage against limits",
    /of\s+10|\/\s*10/.test(usage),
    "no usage figures",
  );

  // ---------------------------------------------------------------- dark theme
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  for (const [route, name] of [
    [`/app/reports/${reportId}`, "14-report-dark"],
    ["/app", "15-dashboard-dark"],
    ["/", "16-landing-dark"],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    check(`dark theme applied on ${route}`, dark);
    await shot(name, route === "/");
  }
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  for (const [route, name, full] of [
    [`/app/reports/${reportId}`, "24-report-light", true],
    [`/app/analyses/${analysisId}`, "25-analysis-light", false],
    [`/app/datasets/${dataset.id}`, "26-dataset-light", false],
    ["/", "27-landing-light", false],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const light = await page.evaluate(() => !document.documentElement.classList.contains("dark"));
    check(`light theme applied on ${route}`, light);
    await shot(name, full);
  }
  const metricsText = await (async () => {
    await page.goto(`${BASE}/app/reports/${reportId}`, { waitUntil: "networkidle0" });
    return page.evaluate(() => document.body.innerText);
  })();
  check(
    "key metrics are rounded for reading (no 3+ decimal values in the summary)",
    !/\d,\d{3}\.\d{3,}/.test(metricsText.split("Methodology")[0]),
    (metricsText.split("Methodology")[0].match(/\d,\d{3}\.\d{3,}/g) || []).join(", "),
  );

  // ---------------------------------------------------------------- phone width
  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  for (const [route, name] of [
    ["/", "17-mobile-landing"],
    ["/app", "18-mobile-dashboard"],
    [`/app/datasets/${dataset.id}`, "19-mobile-dataset"],
    [`/app/analyses/${analysisId}`, "20-mobile-analysis"],
    [`/app/reports/${reportId}`, "21-mobile-report"],
    ["/app/settings", "22-mobile-settings"],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const extra = await overflow();
    check(`no horizontal page scroll at 390px on ${route}`, extra <= 0, `overflow=${extra}px`);
    await shot(name, false);
  }
  const navButton = await page.$('[aria-label="Open navigation"]');
  check("mobile navigation button is present", navButton !== null);
  if (navButton) {
    await navButton.click();
    await sleep(500);
    await shot("23-mobile-nav", false);
    await page.keyboard.press("Escape");
  }
  await page.setViewport({ width: 1440, height: 900 });

  // ---------------------------------------------------------------- sign out and back in
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle0" });
  await api("/auth/logout", { method: "POST" });
  await page.goto(`${BASE}/app/reports`, { waitUntil: "networkidle0" });
  check(
    "signed-out visitor is sent to sign in",
    new URL(page.url()).pathname === "/login",
    page.url(),
  );
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("button[type=submit]"),
  ]);
  await sleep(1000);
  const afterLogin = await api("/reports");
  check(
    "report is still there after signing back in",
    afterLogin.body?.total === 1,
    JSON.stringify(afterLogin.body)?.slice(0, 120),
  );
} catch (error) {
  check("script completed without an exception", false, String(error).slice(0, 400));
  await shot("zz-failure", false).catch(() => {});
} finally {
  const deleted = await api("/users/me/delete", {
    method: "POST",
    body: JSON.stringify({ password }),
  }).catch(() => null);
  check("cleanup: test account deleted", deleted?.status === 204, String(deleted?.status));
  await browser.close();
}

const unexpected = problems.filter((p) => !p.includes("/auth/logout"));
console.log(`\nConsole errors / failed requests (${unexpected.length}):`);
for (const p of [...new Set(unexpected)].slice(0, 30)) console.log("   " + p);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
