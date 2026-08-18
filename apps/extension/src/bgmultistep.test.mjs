// The BACKGROUND worker's own multi-step path — the one piece the page-level tests cannot reach.
//
// The loop is proven in multistep.test.mjs and in real Chrome; what is proven HERE is the wiring in
// background.js: that the module graph loads, that a {type:"fillSteps"} message reaches the handler,
// that it injects the filler, the capture and the probe into the right frames, banks the answers via
// the real save path, and answers with a summary — without ever clicking Submit.
//
// Chrome's APIs are stubbed just far enough to run: executeScript really executes the function against
// a jsdom page, so the injected code is the real code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// ---- a Chrome the worker can run against -------------------------------------------------------
const storage = { local: {}, session: {} };
const saved = [];                     // what reached the vault
let onMessage = null;
let page = null;                      // the current jsdom window

const area = (bag) => ({
  get: async (keys) => {
    if (keys == null) return { ...bag };
    const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
    const out = {};
    for (const k of list) out[k] = bag[k];
    return out;
  },
  set: async (obj) => { Object.assign(bag, obj); },
  remove: async (keys) => { for (const k of [].concat(keys)) delete bag[k]; },
});

globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => { onMessage = fn; } },
    onInstalled: { addListener: () => {} },
    connect: () => { throw new Error("no native host in this test"); },
    getURL: (p) => "chrome-extension://test/" + p,
    lastError: null,
  },
  storage: { local: area(storage.local), session: area(storage.session), onChanged: { addListener: () => {} } },
  tabs: { onUpdated: { addListener: () => {} }, query: async () => [], create: async () => ({}) },
  windows: { onRemoved: { addListener: () => {} }, onBoundsChanged: { addListener: () => {} }, getAll: async () => [], create: async () => ({ id: 1 }) },
  action: { onClicked: { addListener: () => {} } },
  // The real injection contract: run `func(...args)` in the page and return [{ result }].
  scripting: {
    executeScript: async ({ func, args = [] }) => {
      const w = page;
      for (const k of ["window", "document", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement",
        "MouseEvent", "KeyboardEvent", "Event", "Node", "Element", "getComputedStyle", "CSS"]) globalThis[k] = w[k];
      const result = await func(...args);
      return [{ result }];
    },
  },
};

const { default: _ } = await import("./background.js").then((m) => ({ default: m })).catch((e) => { throw e; });
assert.ok(onMessage, "background.js registered no message handler — the worker would be dead");

const send = (msg) => new Promise((resolve) => {
  // Returning true is how an MV3 listener keeps the reply channel open for an async answer; without it
  // every reply would be dropped and the popup would hang.
  const kept = onMessage(msg, {}, resolve);
  assert.equal(kept, true, "the handler did not keep the reply channel open");
});

function wizard(steps) {
  const dom = new JSDOM(`<!doctype html><body>${steps[0]}</body>`, { pretendToBeVisual: true, url: "https://jobs.example.com/apply" });
  const w = dom.window;
  page = w;
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });
  w.Element.prototype.getBoundingClientRect = function () { return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }; };
  const state = { i: 0, submitClicks: 0 };
  const wire = () => {
    for (const b of w.document.querySelectorAll("button")) {
      const t = (b.textContent || "").trim();
      if (/submit|send application/i.test(t)) { b.addEventListener("click", () => { state.submitClicks++; }); continue; }
      b.addEventListener("click", () => {
        if ([...w.document.querySelectorAll("[required]")].some((e) => !String(e.value || "").trim())) return;
        if (state.i < steps.length - 1) { state.i++; w.document.body.innerHTML = steps[state.i]; wire(); }
      });
    }
  };
  wire();
  return { w, state };
}

test("the worker answers fillSteps with a clear 'locked' when there is no vault", async () => {
  wizard([`<form><label>First name <input></label></form>`]);
  const res = await send({ type: "fillSteps", tabId: 7 });
  assert.equal(res.ok, false);
  assert.equal(res.error, "locked");
});

test("with a vault, the worker fills a 3-step wizard, banks the answers and stops at Submit", async () => {
  // Unlock a real local vault through the worker's own message API, so the save path is the real one.
  const r = await send({ type: "unlock", passphrase: "correct horse battery staple" });
  assert.ok(r.ok, "unlock failed");
  for (const [k, v] of Object.entries({ first_name: "Asha", last_name: "Rao", email_address: "asha.rao@example.com", city: "Raleigh" })) {
    const s = await send({ type: "set", key: k, value: v });
    assert.ok(s.ok, `could not seed ${k}`);
  }

  const h = wizard([
    `<h1>Step 1</h1><form><label>First name <input required></label><label>Last name <input required></label>
      <label>Mother maiden name <input id="mmn"></label><button type="button">Next</button></form>`,
    `<h1>Step 2</h1><form><label>Email <input required></label><label>City <input></label>
      <button type="button">Continue</button></form>`,
    `<h1>Step 3</h1><form><label>Anything else? <textarea></textarea></label>
      <button type="button">Submit application</button></form>`,
  ]);
  h.w.document.getElementById("mmn").value = "Kamala";   // an answer the vault has never seen

  const res = await send({ type: "fillSteps", tabId: 7 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.steps.length, 3, `reached ${res.steps.length} steps: ${JSON.stringify(res.steps)}`);
  assert.equal(res.stopped, "at-submit");
  assert.equal(h.state.submitClicks, 0, "THE WORKER PRESSED SUBMIT");
  assert.ok(res.filled >= 4, `only ${res.filled} filled`);

  // The new answer must be readable back OUT of the vault — that is what "documented in the Vault" means.
  const v = await send({ type: "getVault" });
  const banked = Object.entries(v.vault || {}).find(([, val]) => val === "Kamala");
  assert.ok(banked, `the new answer never reached the vault: ${JSON.stringify(Object.keys(v.vault || {}))}`);
  assert.match(banked[0], /maiden/i);
  void saved;
});

test("with 'save new details' turned off, nothing is banked — but the fill still runs", async () => {
  await chrome.storage.local.set({ autoSaveDetails: false });
  const h = wizard([`<form><label>First name <input></label><label>Favourite colour <input id="c"></label></form>`]);
  h.w.document.getElementById("c").value = "Teal";
  const res = await send({ type: "fillSteps", tabId: 7 });
  assert.equal(res.saved, 0, "an answer was saved with saving switched off");
  assert.equal(res.stopped, "no-next");
  const v = await send({ type: "getVault" });
  assert.equal(Object.values(v.vault || {}).includes("Teal"), false);
  await chrome.storage.local.set({ autoSaveDetails: true });
});
