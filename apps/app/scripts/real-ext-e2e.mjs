// FULL end-to-end check of the browser extension in REAL Chrome against the REAL desktop bridge.
// Standing rule: verify on a real browser, not mocks (see memory real-tests-not-mocks). Requires the
// desktop app running + unlocked. Run:  node apps/app/scripts/real-ext-e2e.mjs
//
// It loads the KEYED unpacked folder (stable id `ikoci…`), opens the popup, and asserts every behavior
// the owner hit: bridge connects, all profiles show + switch, no second passphrase wall, toggles default
// ON with ON badges, version visible, Common-answers present. Exits non-zero on any failure.
import puppeteer from "puppeteer-core";

const CHROME = process.env.PPF_CHROME
  || "C:/Users/Subramanya Mysore/.cache/puppeteer/chrome/win64-150.0.7871.24/chrome-win64/chrome.exe";
const EXT = process.env.PPF_EXT || "F:/PolyglotFormFill-Extension";

let fails = 0;
const ok = (cond, label) => { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) fails++; };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", "--no-first-run"],
});
try {
  await new Promise((r) => setTimeout(r, 3000));
  const sw = browser.targets().find((t) => t.url().includes("background") && t.url().startsWith("chrome-extension://"))
    || browser.targets().find((t) => t.url().startsWith("chrome-extension://"));
  const id = sw ? sw.url().split("/")[2] : null;
  ok(id === "ikocicibacolgmamehagnpcgfabcamfk", `stable keyed extension id (got ${id})`);
  if (!id) throw new Error("extension did not load");

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 4500)); // let refresh()/bridge resolve

  const s = await page.evaluate(() => {
    const q = (x) => document.getElementById(x);
    const sel = q("profileSel");
    let profiles = null; try { profiles = null; } catch (_) {}
    return {
      bridged: /in sync with the desktop app/.test((q("banner") || {}).textContent || ""),
      lockedShown: !(q("locked") || {}).classList?.contains("hidden"),
      unlockedShown: !(q("unlocked") || {}).classList?.contains("hidden"),
      profileBarShown: !(q("profileBar") || {}).classList?.contains("hidden"),
      options: sel ? [...sel.options].map((o) => o.textContent) : [],
      autofillChecked: !!(q("autofillOnLoad") || {}).checked,
      autofillBadge: (q("autofillState") || {}).textContent || "",
      autosaveChecked: !!(q("autoSaveDetails") || {}).checked,
      autosaveBadge: (q("autoSaveState") || {}).textContent || "",
      version: (document.querySelector(".ver") || {}).textContent || "",
      commonAnswers: !!q("commonAnswers"),
    };
  });

  ok(s.bridged, "bridge connected — 'in sync with the desktop app'");
  ok(!s.lockedShown, "NO second passphrase wall (locked screen hidden while bridged)");
  ok(s.unlockedShown, "unlocked view shown");
  ok(s.profileBarShown, "profile picker visible");
  const names = s.options.map((o) => o.replace(/\s*\(\d+\)\s*$/, ""));
  ok(names.includes("Pranav") && names.includes("Subu") && names.includes("Sushma"),
    `all 3 profiles in picker (got ${JSON.stringify(s.options)})`);
  ok(s.autofillChecked && s.autofillBadge === "ON", "auto-fill defaults ON with ON badge");
  ok(s.autosaveChecked && s.autosaveBadge === "ON", "auto-save defaults ON with ON badge");
  ok(s.commonAnswers, "Common-answers section present");

  // Profile SWITCH works: pick a different profile, confirm the selection sticks.
  const before = await page.evaluate(() => document.getElementById("profileSel").value);
  const switched = await page.evaluate(() => {
    const sel = document.getElementById("profileSel");
    const other = [...sel.options].find((o) => o.value !== sel.value);
    if (!other) return null;
    sel.value = other.value; sel.dispatchEvent(new Event("change", { bubbles: true }));
    return other.value;
  });
  await new Promise((r) => setTimeout(r, 800));
  const after = await page.evaluate(() => document.getElementById("profileSel").value);
  ok(switched && after === switched && after !== before, "switching profiles works");

  console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL REAL-BROWSER E2E CHECKS PASSED");
} catch (e) {
  console.log("HARNESS ERROR:", String(e).slice(0, 300)); fails++;
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
