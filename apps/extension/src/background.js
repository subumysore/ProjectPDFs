// MV3 service worker: the vault's in-memory trust boundary.
// The derived AES key + decrypted vault live ONLY in this worker's memory while
// unlocked, and are dropped on lock (or when the worker is evicted). chrome.storage
// holds only the SALT and the AES-GCM CIPHERTEXT — never the key, never plaintext.
import { derivePassphraseKey, deriveWebAuthnKey, seal, open, newSalt } from "./vault.js";

let key = null; // CryptoKey (non-extractable), memory-only
let vault = null; // decrypted { ontology_key: value }, memory-only

async function store() {
  return chrome.storage.local.get(["salt", "blob", "kdf"]);
}

async function unlockPassphrase(passphrase) {
  let { salt, blob, kdf } = await store();
  if (blob && kdf && kdf !== "pbkdf2") throw new Error("this vault uses a passkey — unlock with the passkey");
  if (!salt) salt = newSalt();
  const k = await derivePassphraseKey(passphrase, salt);
  if (blob) vault = await open(k, blob); // throws on wrong passphrase / tamper
  else {
    vault = {};
    await chrome.storage.local.set({ salt, kdf: "pbkdf2", blob: await seal(k, vault) });
  }
  key = k;
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
    vault = {};
    await chrome.storage.local.set({ salt, kdf: "webauthn-prf", blob: await seal(k, vault) });
  }
  key = k;
  return Object.keys(vault);
}

async function persist() {
  if (!key) throw new Error("locked");
  await chrome.storage.local.set({ blob: await seal(key, vault) });
}

function lock() {
  key = null;
  vault = null;
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
        case "status":
          sendResponse({ ok: true, unlocked: !!key, keys: vault ? Object.keys(vault) : [] });
          break;
        case "getVault":
          if (!key) throw new Error("locked");
          sendResponse({ ok: true, vault });
          break;
        case "set":
          if (!key) throw new Error("locked");
          vault[msg.key] = msg.value; // silent capture back into the vault
          await persist();
          sendResponse({ ok: true });
          break;
        case "lock":
          lock();
          sendResponse({ ok: true });
          break;
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
        default:
          sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
