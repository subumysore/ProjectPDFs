// MV3 service worker: the vault's in-memory trust boundary.
// The derived AES key + decrypted vault live ONLY in this worker's memory while
// unlocked, and are dropped on lock (or when the worker is evicted). chrome.storage
// holds only the SALT and the AES-GCM CIPHERTEXT — never the key, never plaintext.
import { derivePassphraseKey, deriveWebAuthnKey, seal, open, newSalt, exportKeyB64, importKeyB64 } from "./vault.js";
import { starterVault } from "./seed.js";

let key = null; // CryptoKey, memory-only (+ mirrored to storage.session, see below)
let vault = null; // decrypted { ontology_key: value }, memory-only

async function store() {
  return chrome.storage.local.get(["salt", "blob", "kdf"]);
}

// MV3 evicts this worker after brief idleness, dropping `key`/`vault` and spuriously
// re-locking mid-use. Mirror the unlocked session into chrome.storage.session — an
// IN-MEMORY, extension-only area cleared when the browser closes — and restore from it
// when the worker respawns. Nothing here touches disk.
async function cacheSession() {
  if (!key) return;
  await chrome.storage.session.set({ skey: await exportKeyB64(key), svault: vault });
}
async function ensureUnlocked() {
  if (key && vault) return;
  const { skey, svault } = await chrome.storage.session.get(["skey", "svault"]);
  if (!skey) return; // genuinely locked
  key = await importKeyB64(skey);
  vault = svault || {};
}
async function clearSession() {
  try { await chrome.storage.session.remove(["skey", "svault"]); } catch (_) { /* ignore */ }
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
  await cacheSession();
  return Object.keys(vault);
}

async function persist() {
  if (!key) throw new Error("locked");
  await chrome.storage.local.set({ blob: await seal(key, vault) });
  await cacheSession(); // keep the session mirror in step with the latest vault
}

function lock() {
  key = null;
  vault = null;
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
          try { await chrome.storage.session.remove(["skey", "svault"]); } catch (_) { /* ignore */ }
          sendResponse({ ok: true });
          break;
        case "status":
          await ensureUnlocked();
          sendResponse({ ok: true, unlocked: !!key, keys: vault ? Object.keys(vault) : [] });
          break;
        case "getVault":
          await ensureUnlocked();
          if (!key) throw new Error("locked");
          sendResponse({ ok: true, vault });
          break;
        case "set":
          await ensureUnlocked();
          if (!key) throw new Error("locked");
          vault[msg.key] = msg.value; // silent capture back into the vault
          await persist();
          sendResponse({ ok: true });
          break;
        case "del":
          await ensureUnlocked();
          if (!key) throw new Error("locked");
          delete vault[msg.key];
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
          sendResponse(await hostRequest({ type: "getVault", profileId }));
          break;
        }
        case "companionProfiles":
          sendResponse(await hostRequest({ type: "listProfiles" }));
          break;
        case "companionUpsert":
          // Write-through to the ONE authoritative desktop vault (single source of truth).
          sendResponse(await hostRequest({ type: "upsertData", profileId: msg.profileId, key: msg.key, value: msg.value }));
          break;
        case "companionDelete":
          sendResponse(await hostRequest({ type: "deleteData", profileId: msg.profileId, key: msg.key }));
          break;
        case "companionCreateProfile":
          sendResponse(await hostRequest({ type: "createProfile", id: msg.id, name: msg.name }));
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
