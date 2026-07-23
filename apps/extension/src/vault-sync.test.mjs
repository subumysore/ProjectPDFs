// THE WHOLE CHAIN THE USER ACTUALLY RELIES ON: they type something new onto a form, it is offered
// for capture, they tick it, it lands in the vault — and then the two vaults (browser extension and
// desktop app) agree, in both directions, without losing anything.
//
// Each piece was tested alone: capture in pagecapture.test.mjs, refill in roundtrip.test.mjs,
// reconciliation in companion.test.mjs. Nothing joined them up, and the join is where data loss
// would actually happen — a value captured in the browser that never reaches the desktop is
// invisible until the user opens the other app and finds their details missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { collectTypedValues, newInformation } from "./pagecapture.js";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";
import { reconcileVaults } from "./companion.js";
import { resolveFields } from "./resolver.js";

// A vault as the background script keeps it: value + the timestamp of the last edit.
function vault(entries = {}) {
  const store = { ...entries };
  return {
    store,
    set(key, value, at) { store[key] = { value, updated_at: at }; },
    plain() { return Object.fromEntries(Object.entries(store).map(([k, v]) => [k, v.value])); },
  };
}

// Type values onto a page and return what capture would OFFER for the given vault.
function typeOnForm(fields, known = {}) {
  const html = fields
    .map(([label, value], i) => `<label for="f${i}">${label}</label><input id="f${i}" name="f${i}" value="${value}">`)
    .join("");
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: "https://forms.test/" });
  globalThis.document = dom.window.document;
  return newInformation(collectTypedValues(), known, keyFromLabel, isCapturableLabel);
}

test("a value typed on a form reaches the vault once the user ticks it", () => {
  const v = vault();
  const proposed = typeOnForm([["Employee ID", "E-4471"], ["City", "Chennai"]], v.plain());
  assert.equal(proposed.length, 2, "both new values should be offered");

  // The user ticks only one of them. The other must NOT be saved.
  v.set(proposed[0].key, proposed[0].value, 100);
  assert.deepEqual(v.plain(), { employee_id: "E-4471" });
  assert.ok(!("city" in v.store), "an unticked value must never be saved");
});

test("the captured value then FILLS the same field next time", () => {
  const v = vault();
  for (const p of typeOnForm([["Employee ID", "E-4471"]], {})) v.set(p.key, p.value, 100);
  const [filled] = resolveFields(v.plain(), [{ label: "Employee ID" }]);
  assert.equal(filled, "E-4471", "the captured value did not come back");
});

test("a value captured in the BROWSER is pushed to the desktop vault", () => {
  const ext = vault();
  const desk = vault();
  for (const p of typeOnForm([["Passport no", "Z1234567"]], {})) ext.set(p.key, p.value, 500);

  const { toRemote, toLocal } = reconcileVaults(ext.store, desk.store);
  assert.deepEqual(Object.keys(toRemote), ["passport_no"], "the desktop never learns the new value");
  assert.deepEqual(toLocal, {}, "nothing should come back the other way");
  for (const [k, o] of Object.entries(toRemote)) desk.set(k, o.value, o.updated_at);
  assert.deepEqual(desk.plain(), ext.plain(), "the two vaults disagree after a sync");
});

test("a value added on the DESKTOP is pulled into the browser vault", () => {
  const ext = vault();
  const desk = vault();
  desk.set("blood_group", "O+", 700);
  const { toLocal } = reconcileVaults(ext.store, desk.store);
  for (const [k, o] of Object.entries(toLocal)) ext.set(k, o.value, o.updated_at);
  assert.deepEqual(ext.plain(), { blood_group: "O+" });
});

test("when both sides changed the same field, the NEWER edit wins — in both directions", () => {
  // Browser edited later.
  let ext = vault(); let desk = vault();
  ext.set("phone", "+91 90000 11111", 900);
  desk.set("phone", "+91 90000 22222", 500);
  let r = reconcileVaults(ext.store, desk.store);
  assert.equal(r.toRemote.phone.value, "+91 90000 11111");
  assert.deepEqual(r.toLocal, {}, "the older desktop value must not overwrite the newer one");

  // Desktop edited later.
  ext = vault(); desk = vault();
  ext.set("phone", "+91 90000 11111", 500);
  desk.set("phone", "+91 90000 22222", 900);
  r = reconcileVaults(ext.store, desk.store);
  assert.equal(r.toLocal.phone.value, "+91 90000 22222");
  assert.deepEqual(r.toRemote, {}, "the older browser value must not be pushed");
});

test("syncing is convergent: run it twice and nothing further moves", () => {
  const ext = vault(); const desk = vault();
  ext.set("email", "a@b.test", 100);
  desk.set("city", "Bengaluru", 200);

  let r = reconcileVaults(ext.store, desk.store);
  for (const [k, o] of Object.entries(r.toRemote)) desk.set(k, o.value, o.updated_at);
  for (const [k, o] of Object.entries(r.toLocal)) ext.set(k, o.value, o.updated_at);

  r = reconcileVaults(ext.store, desk.store);
  assert.deepEqual(r.toLocal, {}, "a second sync still wants to change things");
  assert.deepEqual(r.toRemote, {}, "a second sync still wants to change things");
  assert.deepEqual(ext.plain(), desk.plain());
});

test("nothing is ever DELETED by a sync — a field on one side only is copied, not dropped", () => {
  const ext = vault(); const desk = vault();
  ext.set("only_here", "keep me", 100);
  desk.set("only_there", "keep me too", 100);
  const r = reconcileVaults(ext.store, desk.store);
  for (const [k, o] of Object.entries(r.toRemote)) desk.set(k, o.value, o.updated_at);
  for (const [k, o] of Object.entries(r.toLocal)) ext.set(k, o.value, o.updated_at);
  assert.deepEqual(ext.plain(), { only_here: "keep me", only_there: "keep me too" });
  assert.deepEqual(desk.plain(), ext.plain());
});

test("keys captured in a NON-LATIN script survive the sync intact", () => {
  // The keys keep the user's own script (氏名, पूरा नाम). If sync mangled or collided them, a
  // Japanese or Hindi user's vault would quietly merge unrelated fields.
  const ext = vault(); const desk = vault();
  for (const p of typeOnForm([["氏名", "田中太郎"], ["電話番号", "03-1234-5678"]], {})) {
    ext.set(p.key, p.value, 300);
  }
  const r = reconcileVaults(ext.store, desk.store);
  for (const [k, o] of Object.entries(r.toRemote)) desk.set(k, o.value, o.updated_at);
  assert.deepEqual(desk.plain(), { 氏名: "田中太郎", 電話番号: "03-1234-5678" });
  // And they still fill afterwards.
  assert.equal(resolveFields(desk.plain(), [{ label: "氏名" }])[0], "田中太郎");
});

test("re-capturing an unchanged value proposes nothing, so sync stays quiet", () => {
  const v = vault();
  v.set("email", "a@b.test", 100);
  const proposed = typeOnForm([["Email", "a@b.test"]], v.plain());
  assert.deepEqual(proposed, [], "an unchanged value must not be offered again");
});

test("a CHANGED value is offered with its previous value, and wins after the user ticks it", () => {
  const ext = vault(); const desk = vault();
  ext.set("city", "Chennai", 100);
  desk.set("city", "Chennai", 100);

  const proposed = typeOnForm([["City", "Madurai"]], ext.plain());
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].existing, "Chennai", "the user must see what they are replacing");

  ext.set(proposed[0].key, proposed[0].value, 400); // ticked -> saved with a fresh timestamp
  const r = reconcileVaults(ext.store, desk.store);
  assert.equal(r.toRemote.city.value, "Madurai", "the desktop did not receive the newer value");
});
