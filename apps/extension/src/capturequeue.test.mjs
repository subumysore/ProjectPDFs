// An answer the user types must never be lost because the vault happened to be unreachable — which in
// shared-vault mode is the normal state (desktop app closed or locked, bridge refusing, local vault
// locked). Before this, every captured pair in that situation was silently dropped, which is exactly
// what "I do not see new key/value pairs at all" looks like from the outside.
//
// These tests drive the real queue helpers out of background.js with a fake chrome.storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "background.js"), "utf8");

// Extract the two helpers (background.js is a service worker module full of chrome APIs; we exercise
// the queue logic itself, which is pure apart from chrome.storage).
function loadQueue(storage) {
  const queueSrc = SRC.slice(SRC.indexOf("const PENDING_KEY ="), SRC.indexOf("const lastAutoSaveInstall"));
  const chrome = {
    storage: {
      local: {
        get: async (k) => (typeof k === "string" ? { [k]: storage[k] } : { ...storage }),
        set: async (o) => Object.assign(storage, o),
        remove: async (k) => { delete storage[k]; },
      },
    },
  };
  const saved = [];
  const saveNewToVault = async (pairs) => { saved.push(...pairs); return pairs.length; };
  const fn = new Function("chrome", "saveNewToVault", `${queueSrc}; return { queueForLater, flushPendingCaptures };`);
  return { ...fn(chrome, saveNewToVault), saved };
}

test("an answer captured while the vault is unreachable is QUEUED, not dropped", async () => {
  const storage = {};
  const { queueForLater } = loadQueue(storage);
  await queueForLater([{ label: "Preferred contact method", value: "Email" }]);
  assert.equal(storage.pendingCaptures.length, 1);
  assert.equal(storage.pendingCaptures[0].value, "Email");
});

test("the same answer is not queued twice", async () => {
  const storage = {};
  const { queueForLater } = loadQueue(storage);
  const pair = [{ label: "Shift", value: "Night" }];
  await queueForLater(pair);
  await queueForLater(pair);
  assert.equal(storage.pendingCaptures.length, 1);
});

test("the queue is capped so a runaway page cannot fill storage", async () => {
  const storage = {};
  const { queueForLater } = loadQueue(storage);
  await queueForLater(Array.from({ length: 500 }, (_, i) => ({ label: "Q" + i, value: "A" + i })));
  assert.ok(storage.pendingCaptures.length <= 200, `queue grew to ${storage.pendingCaptures.length}`);
  assert.equal(storage.pendingCaptures.at(-1).value, "A499", "the newest answers are the ones kept");
});

test("flushing writes everything queued and empties the queue", async () => {
  const storage = { pendingCaptures: [{ label: "Mother's maiden name", value: "Kamala" }] };
  const { flushPendingCaptures, saved } = loadQueue(storage);
  const n = await flushPendingCaptures();
  assert.equal(n, 1);
  assert.equal(saved[0].value, "Kamala");
  assert.equal(storage.pendingCaptures, undefined, "the queue is cleared once written");
});

test("flushing an empty queue is a no-op", async () => {
  const storage = {};
  const { flushPendingCaptures, saved } = loadQueue(storage);
  assert.equal(await flushPendingCaptures(), 0);
  assert.equal(saved.length, 0);
});
