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
  let { salt, blob } = await store();
  if (!salt) {
    salt = newSalt();
    await chrome.storage.local.set({ salt, kdf: "pbkdf2" });
  }
  const k = await derivePassphraseKey(passphrase, salt);
  if (blob) vault = await open(k, blob); // throws on wrong passphrase / tamper
  else {
    vault = {};
    await chrome.storage.local.set({ blob: await seal(k, vault) });
  }
  key = k;
  return Object.keys(vault);
}

async function unlockWebAuthn(prfSecretB64) {
  let { salt } = await store();
  if (!salt) {
    salt = newSalt();
    await chrome.storage.local.set({ salt, kdf: "webauthn-prf" });
  }
  const secret = Uint8Array.from(atob(prfSecretB64), (c) => c.charCodeAt(0));
  const k = await deriveWebAuthnKey(secret, salt);
  const { blob } = await store();
  if (blob) vault = await open(k, blob);
  else {
    vault = {};
    await chrome.storage.local.set({ blob: await seal(k, vault) });
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
        default:
          sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
