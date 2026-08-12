// MV3 service worker: the vault's in-memory trust boundary.
// The derived AES key + decrypted vault live ONLY in this worker's memory while
// unlocked, and are dropped on lock (or when the worker is evicted). chrome.storage
// holds only the SALT and the AES-GCM CIPHERTEXT — never the key, never plaintext.
import { derivePassphraseKey, deriveWebAuthnKey, seal, open, newSalt, exportKeyB64, importKeyB64 } from "./vault.js";
import { starterVault } from "./seed.js";
import { fillPage } from "./pagefill.js";
import { parseEducation } from "./education.js";
import { chooseDataProfile } from "./profileMatch.js";
import { collectTypedValues, newInformation } from "./pagecapture.js";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";

let key = null; // CryptoKey, memory-only (+ mirrored to storage.session, see below)
let vault = null; // decrypted { ontology_key: value }, memory-only
// Per-field edit times { ontology_key: epoch-secs } powering LAST-WRITE-WINS sync with the
// desktop vault. Timestamps reveal nothing sensitive, so they live beside the sealed blob.
let times = {};
const nowSecs = () => Math.floor(Date.now() / 1000);

async function store() {
  return chrome.storage.local.get(["salt", "blob", "kdf"]);
}

// MV3 evicts this worker after brief idleness, dropping `key`/`vault` and spuriously
// re-locking mid-use. Mirror the unlocked session into chrome.storage.session — an
// IN-MEMORY, extension-only area cleared when the browser closes — and restore from it
// when the worker respawns. Nothing here touches disk.
async function cacheSession() {
  if (!key) return;
  await chrome.storage.session.set({ skey: await exportKeyB64(key), svault: vault, stimes: times });
}
async function ensureUnlocked() {
  if (key && vault) return;
  const { skey, svault, stimes } = await chrome.storage.session.get(["skey", "svault", "stimes"]);
  if (!skey) return; // genuinely locked
  key = await importKeyB64(skey);
  vault = svault || {};
  times = stimes || {};
}
/** Load the per-field edit times that sit beside the sealed blob (after a real unlock). */
async function loadTimes() {
  const { vtimes } = await chrome.storage.local.get("vtimes");
  times = vtimes || {};
}
async function clearSession() {
  try { await chrome.storage.session.remove(["skey", "svault", "stimes"]); } catch (_) { /* ignore */ }
}

async function unlockPassphrase(passphrase) {
  let { salt, blob, kdf } = await store();
  if (blob && kdf && kdf !== "pbkdf2") throw new Error("this vault uses a passkey — unlock with the passkey");
  if (!salt) salt = newSalt();
  const k = await derivePassphraseKey(passphrase, salt);
  if (blob) {
    // Opening decrypts + authenticates (AES-GCM). A wrong passphrase (or a tampered blob)
    // throws a raw "OperationError" — translate it to a message the user can act on.
    try { vault = await open(k, blob); }
    catch { throw new Error("Incorrect passphrase — this vault was created with a different one."); }
  } else {
    vault = starterVault(); // first launch: seed starter keys + inferred country code
    await chrome.storage.local.set({ salt, kdf: "pbkdf2", blob: await seal(k, vault) });
  }
  key = k;
  await loadTimes();
  await cacheSession();
  return Object.keys(vault);
}

async function unlockWebAuthn(prfSecretB64) {
  let { salt, blob, kdf } = await store();
  if (blob && kdf !== "webauthn-prf") throw new Error("this vault uses a passphrase — unlock with the passphrase");
  if (!salt) salt = newSalt();
  const secret = Uint8Array.from(atob(prfSecretB64), (c) => c.charCodeAt(0));
  const k = await deriveWebAuthnKey(secret, salt);
  if (blob) vault = await open(k, blob);
  else {
    vault = starterVault(); // first launch: seed starter keys + inferred country code
    await chrome.storage.local.set({ salt, kdf: "webauthn-prf", blob: await seal(k, vault) });
  }
  key = k;
  await loadTimes();
  await cacheSession();
  return Object.keys(vault);
}

async function persist() {
  if (!key) throw new Error("locked");
  await chrome.storage.local.set({ blob: await seal(key, vault), vtimes: times });
  await cacheSession(); // keep the session mirror in step with the latest vault
}

function lock() {
  key = null;
  vault = null;
  times = {};
  clearSession();
}

// Companion mode: talk to the native app's native-messaging host. The vault + keys
// stay in the trusted native binary; the extension never holds them. This is the
// strongest answer to the served-code trust gap.
const HOST = "com.projectpdfs.host";
function hostRequest(msg) {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch {
      resolve({ ok: false, error: "native host not available (install + register it)" });
      return;
    }
    const timer = setTimeout(() => {
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: "native host timed out" });
    }, 5000);
    port.onMessage.addListener((resp) => {
      clearTimeout(timer);
      port.disconnect();
      resolve(resp);
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      resolve({ ok: false, error: err || "native host disconnected (not registered?)" });
    });
    port.postMessage(msg);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "unlock":
          sendResponse({ ok: true, keys: await unlockPassphrase(msg.passphrase) });
          break;
        case "unlockWebAuthn":
          sendResponse({ ok: true, keys: await unlockWebAuthn(msg.prfSecret) });
          break;
        case "resetVault":
          // Forgot-passphrase recovery: erase the encrypted vault so a new one can be
          // created. Destroys saved data on this device (there is no recovery without the
          // passphrase — that's the point of the encryption).
          key = null; vault = null;
          await chrome.storage.local.remove(["salt", "blob", "kdf"]);
          try { await chrome.storage.session.remove(["skey", "svault", "stimes"]); } catch (_) { /* ignore */ }
          sendResponse({ ok: true });
          break;
        case "status": {
          await ensureUnlocked();
          // `hasLocal` = this browser has its own encrypted vault on disk. Lets the popup ask for
          // the one-time unlock ONLY when there is actually local data to sync into the shared vault.
          const { blob } = await store();
          sendResponse({ ok: true, unlocked: !!key, hasLocal: !!blob, keys: vault ? Object.keys(vault) : [] });
          break;
        }
        case "getVault":
          await ensureUnlocked();
          if (!key) throw new Error("locked");
          sendResponse({ ok: true, vault });
          break;
        // This vault WITH per-field timestamps — the local input to last-write-wins sync.
        case "getVaultMeta": {
          await ensureUnlocked();
          if (!key) throw new Error("locked");
          const meta = {};
          for (const k of Object.keys(vault || {})) meta[k] = { value: vault[k], updated_at: times[k] || 0 };
          sendResponse({ ok: true, meta });
          break;
        }
        case "set":
          await ensureUnlocked();
          if (!key) throw new Error("locked");
          vault[msg.key] = msg.value; // silent capture back into the vault
          // Stamp the edit. A sync write carries the winning timestamp so it doesn't look newer
          // than it is and bounce back on the next reconcile.
          times[msg.key] = typeof msg.updatedAt === "number" ? msg.updatedAt : nowSecs();
          await persist();
          sendResponse({ ok: true });
          break;
        // AUTO-SAVE: values the user typed on a page, captured on submit/hide by the injected beacon.
        // Only genuinely NEW fields (never overwrite an existing value) are saved — silently, to the
        // same vault autofill uses (desktop if bridged, else this browser). Nothing leaves the device.
        case "autoSaveCapture": {
          const { autoSaveDetails } = await chrome.storage.local.get("autoSaveDetails");
          if (autoSaveDetails === false) { sendResponse({ ok: true, saved: 0, off: true }); break; }
          const saved = await saveNewToVault(Array.isArray(msg.pairs) ? msg.pairs : []);
          sendResponse({ ok: true, saved });
          break;
        }
        case "openToolWindow":
          await openToolWindow();
          sendResponse({ ok: true });
          break;
        case "del":
          await ensureUnlocked();
          if (!key) throw new Error("locked");
          delete vault[msg.key];
          delete times[msg.key];
          await persist();
          sendResponse({ ok: true });
          break;
        case "lock":
          lock();
          sendResponse({ ok: true });
          break;
        case "migrateToPasskey": {
          // Re-seal the CURRENTLY-UNLOCKED vault with a WebAuthn-PRF key.
          if (!key) throw new Error("unlock the vault (passphrase) first");
          let { salt } = await store();
          if (!salt) salt = newSalt();
          const secret = Uint8Array.from(atob(msg.prfSecret), (c) => c.charCodeAt(0));
          const newKey = await deriveWebAuthnKey(secret, salt);
          await chrome.storage.local.set({
            salt,
            kdf: "webauthn-prf",
            credId: msg.credId,
            blob: await seal(newKey, vault),
          });
          key = newKey; // now unlocked under the passkey
          sendResponse({ ok: true });
          break;
        }
        case "companionPing":
          sendResponse(await hostRequest({ type: "ping" }));
          break;
        case "companionVault": {
          // Pull the vault from the native app (first profile, or a given one).
          let profileId = msg.profileId;
          if (!profileId) {
            const pl = await hostRequest({ type: "listProfiles" });
            if (!pl.ok) {
              sendResponse(pl);
              break;
            }
            if (!pl.profiles || pl.profiles.length === 0) {
              sendResponse({ ok: false, error: "no profiles in the native app yet" });
              break;
            }
            profileId = pl.profiles[0].id;
          }
          // Forward maxValueLen so a picture-heavy vault stays under Chrome's 1 MB message cap.
          sendResponse(await hostRequest({ type: "getVault", profileId, maxValueLen: msg.maxValueLen }));
          break;
        }
        case "companionProfiles":
          sendResponse(await hostRequest({ type: "listProfiles" }));
          break;
        // Desktop vault WITH per-field timestamps — the remote input to last-write-wins sync.
        case "companionVaultMeta":
          sendResponse(await hostRequest({ type: "getVaultMeta", profileId: msg.profileId, maxValueLen: msg.maxValueLen }));
          break;
        case "companionUpsert":
          // Write-through to the ONE authoritative desktop vault (single source of truth).
          // `updatedAt` carries the winning timestamp so both sides agree on recency.
          sendResponse(await hostRequest({
            type: "upsertData",
            profileId: msg.profileId,
            key: msg.key,
            value: msg.value,
            updatedAt: typeof msg.updatedAt === "number" ? msg.updatedAt : nowSecs(),
          }));
          break;
        case "companionDelete":
          sendResponse(await hostRequest({ type: "deleteData", profileId: msg.profileId, key: msg.key }));
          break;
        case "companionCreateProfile":
          sendResponse(await hostRequest({ type: "createProfile", id: msg.id, name: msg.name }));
          break;
        case "companionGetFieldChunk":
          // A byte slice of one big field (image), so values over the 1 MB native-message cap stream.
          sendResponse(await hostRequest({ type: "getFieldChunk", profileId: msg.profileId, key: msg.key, offset: msg.offset, len: msg.len }));
          break;
        case "fetchBytes": {
          // Fetch a URL (e.g. a PDF) from the service worker and return base64 bytes.
          try {
            const res = await fetch(msg.url);
            if (!res.ok) { sendResponse({ ok: false, error: "HTTP " + res.status }); break; }
            const buf = new Uint8Array(await res.arrayBuffer());
            let bin = "";
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            sendResponse({ ok: true, b64: btoa(bin) });
          } catch (e) {
            sendResponse({ ok: false, error: (e && e.message) || String(e) });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});

// ---- AUTO-FILL ON PAGE LOAD (opt-in) ---------------------------------------------------------
// When the user turns on "auto-fill on load", every http(s) page that finishes loading is filled
// from the active profile WITHOUT opening the popup. Passwords are NEVER auto-filled here (writing a
// saved password into every page on load is unsafe) — those stay manual via the popup's Fill button.
const AUTOFILL_VAULT_MAX = 200000; // keep the desktop read under Chrome's 1 MB native-message cap

// Resolve the vault to fill from: the shared DESKTOP vault (active/explicit profile) if reachable,
// else this browser's own unlocked vault. Returns { ok, vault } — text-only (images omitted).
async function vaultForAutofill() {
  try {
    const ping = await hostRequest({ type: "ping" });
    if (ping && ping.ok) {
      const pl = await hostRequest({ type: "listProfiles" });
      if (pl.ok && pl.profiles && pl.profiles.length) {
        const { companionProfile, companionProfileExplicit } = await chrome.storage.local.get(["companionProfile", "companionProfileExplicit"]);
        const counts = {}; for (const p of pl.profiles) counts[p.id] = p.count || 0;
        const profileId = chooseDataProfile(pl.profiles, counts, companionProfile, companionProfileExplicit);
        if (profileId) {
          const gv = await hostRequest({ type: "getVault", profileId, maxValueLen: AUTOFILL_VAULT_MAX });
          if (gv.ok && gv.vault && Object.keys(gv.vault).length) return { ok: true, vault: gv.vault };
        }
      }
    }
  } catch (_) { /* fall through to local */ }
  // Local vault (this browser), if unlocked — cap large image fields the same way.
  if (vault && Object.keys(vault).length) {
    const capped = {};
    for (const [k, v] of Object.entries(vault)) if (String(v == null ? "" : v).length <= AUTOFILL_VAULT_MAX) capped[k] = v;
    return { ok: true, vault: capped };
  }
  return { ok: false };
}

// Save only genuinely NEW fields (never overwrite an existing value) from what the user typed. Writes
// to the desktop vault when bridged (same profile autofill picks), else this browser's local vault.
async function saveNewToVault(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return 0;
  // Desktop (companion) target first — mirror vaultForAutofill's choice.
  try {
    const ping = await hostRequest({ type: "ping" });
    if (ping && ping.ok) {
      const pl = await hostRequest({ type: "listProfiles" });
      if (pl.ok && pl.profiles && pl.profiles.length) {
        const { companionProfile, companionProfileExplicit } = await chrome.storage.local.get(["companionProfile", "companionProfileExplicit"]);
        const counts = {}; for (const p of pl.profiles) counts[p.id] = p.count || 0;
        const profileId = chooseDataProfile(pl.profiles, counts, companionProfile, companionProfileExplicit);
        if (profileId) {
          const gv = await hostRequest({ type: "getVault", profileId, maxValueLen: AUTOFILL_VAULT_MAX });
          const cur = (gv.ok && gv.vault) || {};
          const fresh = newInformation(pairs, cur, keyFromLabel, isCapturableLabel).filter((p) => p.existing === undefined);
          let n = 0;
          for (const p of fresh) { await hostRequest({ type: "upsertData", profileId, key: p.key, value: p.value, updatedAt: nowSecs() }); n++; }
          return n;
        }
      }
    }
  } catch (_) { /* fall through to local */ }
  // Local browser vault (only if unlocked).
  try {
    if (!vault || !key) return 0;
    const fresh = newInformation(pairs, vault, keyFromLabel, isCapturableLabel).filter((p) => p.existing === undefined);
    let n = 0;
    for (const p of fresh) { vault[p.key] = p.value; times[p.key] = nowSecs(); n++; }
    if (n) await persist();
    return n;
  } catch (_) { return 0; }
}

const lastAutoSaveInstall = new Map(); // tabId -> url — install the beacon once per page load
const lastAutofill = new Map(); // tabId -> { url, at } — never refill the same page in a tight loop
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  try {
    if (info.status !== "complete") return;
    const url = (tab && tab.url) || "";
    if (!/^https?:\/\//i.test(url)) return;               // real web pages only

    // AUTO-SAVE beacon (default ON): install a tiny listener that, on form submit / page hide, captures
    // what the user typed (reusing collectTypedValues) and hands it to the background to save NEW fields.
    try {
      const { autoSaveDetails } = await chrome.storage.local.get("autoSaveDetails");
      if (autoSaveDetails !== false && lastAutoSaveInstall.get(tabId) !== url) {
        lastAutoSaveInstall.set(tabId, url);
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: (collectSrc) => {
            if (window.__ppfAutoSave) return; window.__ppfAutoSave = true;
            let collect; try { collect = new Function("return (" + collectSrc + ")")(); } catch (_) { return; }
            const fire = () => { try { const p = collect(); if (p && p.length) chrome.runtime.sendMessage({ type: "autoSaveCapture", pairs: p }); } catch (_) { /* ignore */ } };
            window.addEventListener("submit", fire, true);
            window.addEventListener("pagehide", fire, true);
            document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") fire(); }, true);
          },
          args: [collectTypedValues.toString()],
        });
      }
    } catch (_) { /* auto-save must never break the worker */ }

    const { autofillOnLoad } = await chrome.storage.local.get("autofillOnLoad");
    if (autofillOnLoad === false) return;                 // default ON — only an explicit false disables
    const prev = lastAutofill.get(tabId);
    if (prev && prev.url === url && Date.now() - prev.at < 4000) return; // debounce repeat 'complete's
    const r = await vaultForAutofill();
    if (!r.ok) return;                                    // locked / unavailable → silent no-op
    // Trial/licence gate: only auto-fill with an ACTIVE entitlement (paid or unexpired trial).
    // Lazily mint the trial on first eligible page; if it's spent/unavailable, silently skip.
    const { ensureTrial, getEntitlement } = await import("./license.js");
    let ent = await getEntitlement();
    if (!ent.active && !ent.expired) { await ensureTrial(); ent = await getEntitlement(); }
    if (!ent.active) return;
    lastAutofill.set(tabId, { url, at: Date.now() });
    const { savedAnswers } = await chrome.storage.local.get("savedAnswers");
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },               // reach iframe-embedded ATS forms too
      // Run the fill NOW, and — GLOBALLY, for any single-page app — re-run it when the form appears
      // LATER (after an "Apply" click, a route change, a modal). Many ATS forms (ADP WorkforceNow,
      // Workday, Greenhouse) render the fields only after interaction, long after page load; without
      // this the one-shot fill hits an empty page. A debounced MutationObserver re-fills on new fields;
      // fill is idempotent (never overwrites) so re-running is safe. Capped so it stops observing.
      func: (fillSrc, vault, edu, opts) => {
        let fill; try { fill = new Function("return (" + fillSrc + ")")(); } catch (_) { return; }
        const run = () => { try { fill(vault, null, edu, opts); } catch (_) { /* ignore */ } };
        run();
        if (window.__ppfAutofillObs) return;            // one observer per frame
        window.__ppfAutofillObs = true;
        let t = 0;
        const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(run, 500); });
        try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) { return; }
        setTimeout(() => { try { obs.disconnect(); } catch (_) {} window.__ppfAutofillObs = false; }, 90000);
      },
      args: [fillPage.toString(), r.vault, parseEducation(r.vault), { skipPassword: true, savedAnswers: savedAnswers || {} }],
    });
  } catch (_) { /* auto-fill must never throw into the worker */ }
});

// ---- Sticky enlarged tool window (strict singleton) ------------------------------------------------
// The user can pop the popup out into a resizable window; once they do, it stays their default (across
// sites + tabs) until they manually close it. The background OWNS the window so there is never a
// duplicate, remembers its size+position, and clears the sticky flag when the window is closed.
let _toolWinBusy = false;
async function openToolWindow() {
  const { winWindowId, winBounds } = await chrome.storage.local.get(["winWindowId", "winBounds"]);
  // Focus the existing window if it's still open.
  if (winWindowId != null) {
    try { await chrome.windows.get(winWindowId); await chrome.windows.update(winWindowId, { focused: true }); return; }
    catch (_) { /* it was closed — fall through to (re)create */ }
  }
  if (_toolWinBusy) return;               // guard against a create race from rapid opens
  _toolWinBusy = true;
  try {
    // Double-check nothing slipped through (a stray tool window with no stored id).
    const all = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
    const stray = all.find((w) => (w.tabs || []).some((t) => (t.url || "").includes("popup.html?win=1")));
    if (stray) { await chrome.storage.local.set({ winWindowId: stray.id }); await chrome.windows.update(stray.id, { focused: true }); return; }
    const b = winBounds || {};
    const opts = { url: chrome.runtime.getURL("popup.html?win=1"), type: "popup", width: b.width || 560, height: b.height || 760 };
    if (Number.isInteger(b.left)) opts.left = b.left;
    if (Number.isInteger(b.top)) opts.top = b.top;
    const w = await chrome.windows.create(opts);
    await chrome.storage.local.set({ winWindowId: w.id });
  } finally { _toolWinBusy = false; }
}

// Manual close of the tool window reverts to the compact popup (clears the sticky flag).
chrome.windows.onRemoved.addListener(async (id) => {
  try {
    const { winWindowId } = await chrome.storage.local.get("winWindowId");
    if (id === winWindowId) await chrome.storage.local.set({ winMode: false, winWindowId: null });
  } catch (_) { /* ignore */ }
});
// Remember the window's size + position as the user drags/resizes it.
if (chrome.windows.onBoundsChanged) {
  chrome.windows.onBoundsChanged.addListener(async (win) => {
    try {
      const { winWindowId } = await chrome.storage.local.get("winWindowId");
      if (win.id === winWindowId) await chrome.storage.local.set({ winBounds: { width: win.width, height: win.height, left: win.left, top: win.top } });
    } catch (_) { /* ignore */ }
  });
}
