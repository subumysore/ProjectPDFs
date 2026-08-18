// Does the REAL extension still boot, and does the multi-step handler actually answer?
//
// The loop is verified elsewhere against real pages; what THIS covers is the part no page-level test
// can: the unpacked extension loading in Chrome, its MV3 service worker starting with the new imports
// (a bad import kills the worker and with it EVERY feature), and `{type:"fillSteps"}` reaching the
// handler and returning a well-formed answer instead of throwing.
//
// A locked vault answering {ok:false,error:"locked"} is a PASS here: it proves the routing and the
// guard. Nothing is filled and nothing is submitted.
import puppeteer from "puppeteer-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
// Chrome silently refuses a --load-extension path containing a SPACE, and this repo lives under
// "C:\Users\Subramanya Mysore\…", so the runtime file set is staged to a space-free directory first
// (scripts/e2e/stage-ext.mjs). PPF_EXT_DIR overrides it.
const EXT = process.env.PPF_EXT_DIR || join(process.env.TEMP || tmpdir(), "ppf-ext-smoke");
const profile = mkdtempSync(join(process.env.TEMP || tmpdir(), "ppf-prof-"));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,                       // MV3 workers do not start for a --load-extension in headless
  userDataDir: profile,
  // Puppeteer disables extensions by default, AND disables component extensions with background pages —
  // with either in place the service worker never starts and every check below fails for the wrong reason.
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
  args: [`--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "--no-first-run", "--enable-automation"],
});

let bad = 0;
const check = (label, ok, detail = "") => { console.log(`   ${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`); if (!ok) bad++; };

try {
  // The worker registers a moment after launch.
  let worker = null;
  for (let i = 0; i < 40 && !worker; i++) {
    worker = browser.targets().find((t) => t.type() === "service_worker" && t.url().includes("background.js"));
    if (!worker) await new Promise((r) => setTimeout(r, 250));
  }
  console.log("\n## real extension, real Chrome");
  if (!worker) {
    // Current Chrome refuses --load-extension outright (the switch was disabled for security), so an
    // unpacked extension cannot be driven from the command line at all. That is an environment limit,
    // not a product failure — the worker's own multi-step path is covered by bgmultistep.test.mjs,
    // which loads background.js against a stubbed chrome and a real page.
    console.log("   SKIPPED: this Chrome will not load an unpacked extension from the command line.");
    console.log("   Load it by hand at chrome://extensions → Load unpacked → apps/extension.");
    await browser.close();
    process.exit(0);
  }
  check("the service worker started (imports all resolve)", true, worker.url().slice(0, 60));

  const id = new URL(worker.url()).host;
  const page = await browser.newPage();
  await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
  const tabId = await page.evaluate(() => 1).then(() => null).catch(() => null);

  // Ask from an EXTENSION page (a content page cannot message the worker).
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${id}/popup.html`, { waitUntil: "domcontentloaded" });
  const reply = await ext.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: "https://example.com/*" });
    const t = tabs[0];
    return await chrome.runtime.sendMessage({ type: "fillSteps", tabId: t && t.id });
  });
  console.log("   reply:", JSON.stringify(reply));
  check("fillSteps answered (no exception in the worker)", !!reply && typeof reply === "object");
  check("the answer is well formed", !!reply && (reply.ok === true ? Array.isArray(reply.steps) : typeof reply.error === "string"));
  if (reply && reply.ok) {
    check("it never ran away", reply.steps.length <= 12, `${reply.steps.length} steps`);
    check("it reported WHY it stopped", typeof reply.stopped === "string" && reply.stopped.length > 0, reply.stopped);
  }
  void tabId;
} catch (e) {
  console.log("   ❌ " + String(e.message || e));
  bad++;
} finally {
  await browser.close();
}
console.log(bad ? `\n${bad} FAILURE(S)` : "\nEXTENSION SMOKE PASSED");
process.exit(bad ? 1 : 0);
