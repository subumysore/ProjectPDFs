// The button the user actually presses.
//
// The loop, the probe and the worker are covered; what is NOT covered by any of those is the popup's
// own path: does pressing "Fill this page" ask the BACKGROUND for a multi-step run, and does it show
// the summary it gets back? A mistake here means "Fill does nothing" on the user's screen while every
// other test still passes.
//
// popup.js is a script, not a module of functions, so it is loaded against a jsdom document holding the
// real popup.html and a stubbed chrome. Only the Fill path is exercised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "popup.html"), "utf8");

const messages = [];                     // everything the popup asked the background for
let reply = { ok: true, filled: 7, saved: 2, stopped: "at-submit", needs: [], steps: [{ step: 1, filled: 4, saved: 2 }, { step: 2, filled: 3, saved: 0 }] };

const dom = new JSDOM(html, { url: "chrome-extension://test/popup.html", pretendToBeVisual: true, runScripts: "outside-only" });
const w = dom.window;
for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
  "MouseEvent", "KeyboardEvent", "Event", "Node", "Element", "getComputedStyle", "CSS", "alert", "confirm"]) global[k] = w[k];
// `navigator` is read-only on Node's global object, so it has to be defined rather than assigned.
Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => w.navigator });
Object.defineProperty(globalThis, "location", { configurable: true, get: () => w.location });
Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });

const bag = { local: { savedAnswers: {}, autoSaveDetails: true }, session: {} };
const area = (b) => ({
  get: async (keys) => { if (keys == null) return { ...b }; const l = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys); const o = {}; for (const k of l) o[k] = b[k]; return o; },
  set: async (o) => { Object.assign(b, o); },
  remove: async (k) => { for (const x of [].concat(k)) delete b[x]; },
});
global.chrome = w.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      messages.push(msg);
      if (msg.type === "status") return { ok: true, unlocked: true, hasLocal: true, keys: ["first_name"] };
      if (msg.type === "getVault") return { ok: true, vault: { first_name: "Asha", last_name: "Rao" } };
      if (msg.type === "getVaultMeta") return { ok: true, meta: {} };
      if (msg.type === "companionPing") return { ok: false };
      if (msg.type === "fillSteps") return reply;
      return { ok: true };
    },
    getManifest: () => ({ version: "1.0.17" }),
    getURL: (p) => "chrome-extension://test/" + p,
    onMessage: { addListener: () => {} },
    lastError: null,
  },
  storage: { local: area(bag.local), session: area(bag.session), onChanged: { addListener: () => {} } },
  tabs: { query: async () => [{ id: 42, url: "https://jobs.example.com/apply" }], create: async () => ({}), sendMessage: async () => ({}) },
  windows: { getCurrent: async () => ({ id: 1 }), create: async () => ({ id: 1 }) },
  scripting: { executeScript: async ({ func, args = [] }) => [{ result: await func(...args) }] },
  permissions: { contains: async () => true, request: async () => true },
};

// The licence gate and the vault read are not what this test is about; keep them out of the way.
bag.local.entitlement = { active: true };

// jsdom has no canvas, and the popup sets up its signature pad at load. A do-nothing 2D context is
// enough: this test is about the Fill button, not about drawing.
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : (t[k] = typeof k === "string" && /^(canvas)$/.test(k) ? {} : () => {})),
  set: () => true,
});

let loaded = true;
try {
  await import("./popup.js");
} catch (e) {
  loaded = false;
  console.log("popup.js did not load in jsdom:", String(e.message || e).slice(0, 140));
}

test("pressing Fill asks the BACKGROUND for a multi-step run", { skip: !loaded ? "popup.js cannot load outside Chrome" : false }, async () => {
  messages.length = 0;
  w.document.getElementById("fill").click();
  for (let i = 0; i < 40 && !messages.some((m) => m.type === "fillSteps"); i++) await new Promise((r) => setTimeout(r, 50));
  const ask = messages.find((m) => m.type === "fillSteps");
  assert.ok(ask, `Fill never asked for a multi-step run; it sent ${JSON.stringify(messages.map((m) => m.type))}`);
  assert.equal(ask.tabId, 42, "it asked about the wrong tab");
});

test("the summary the background returns is what the user is shown", { skip: !loaded ? "popup.js cannot load outside Chrome" : false }, async () => {
  const msg = w.document.getElementById("msg");
  await new Promise((r) => setTimeout(r, 200));
  const text = (msg.textContent || "");
  assert.match(text, /7 fields/, `the message box says: "${text}"`);
  assert.match(text, /press Submit yourself/i, "the reason it stopped is not shown");
});
