// Extension vault crypto — "security built in".
//
// The vault is AES-256-GCM encrypted at rest. The KEY is NEVER stored: it is
// derived on unlock from one of two hardware-or-secret sources, mirroring the
// native app's OS-keystore protection as closely as a browser allows:
//
//   1. Passphrase  → PBKDF2-SHA256 (600k iters) → AES-GCM key. Key exists only
//      in memory while unlocked; forgotten on lock.
//   2. WebAuthn PRF → a per-credential secret that only materialises when the
//      user's HARDWARE authenticator (passkey/security key) is present and the
//      user gestures. That secret → HKDF → AES-GCM key. Hardware-backed, so a
//      silently-swapped extension update cannot decrypt without the authenticator.
//
// Isomorphic: uses WebCrypto (globalThis.crypto.subtle), so it runs in the MV3
// service worker AND in Node for tests. No plaintext, no key, ever leaves the device.

const subtle = globalThis.crypto.subtle;

// ---- base64 helpers (browser + Node) ----
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}
function b64ToBytes(b64) {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 16 random bytes, base64 — a per-vault KDF salt. */
export function newSalt() {
  return bytesToB64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

// The derived key is EXTRACTABLE so the unlocked session can be cached in
// chrome.storage.session (in-memory only, extension-only, wiped when the browser
// closes) — MV3 evicts the service worker, which would otherwise drop the key and
// spuriously re-lock the vault mid-use. The raw key never touches disk and never
// leaves the extension's own memory; storage.local still holds only salt + ciphertext.
/** Derive an AES-256-GCM key from a passphrase (PBKDF2-SHA256). */
export async function derivePassphraseKey(passphrase, saltB64, iterations = 600_000) {
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    true, // extractable — only ever exported into memory-only session storage
    ["encrypt", "decrypt"],
  );
}

/** Derive an AES-256-GCM key from a WebAuthn PRF secret (32+ bytes) via HKDF. */
export async function deriveWebAuthnKey(prfSecretBytes, saltB64) {
  const material = await subtle.importKey("raw", prfSecretBytes, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: b64ToBytes(saltB64), info: new TextEncoder().encode("projectpdfs-vault") },
    material,
    { name: "AES-GCM", length: 256 },
    true, // extractable — see note above
    ["encrypt", "decrypt"],
  );
}

/** Export a derived key to raw base64 (for memory-only session caching). */
export async function exportKeyB64(key) {
  return bytesToB64(new Uint8Array(await subtle.exportKey("raw", key)));
}

/** Re-import a raw base64 AES-256-GCM key (from session cache). */
export async function importKeyB64(b64) {
  return subtle.importKey("raw", b64ToBytes(b64), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Encrypt a JSON-able object → compact "ivB64.ctB64" string. */
export async function seal(key, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, pt));
  return `${bytesToB64(iv)}.${bytesToB64(ct)}`;
}

/** Decrypt an "ivB64.ctB64" string → object. Throws on wrong key or tamper. */
export async function open(key, blob) {
  const [ivB64, ctB64] = String(blob).split(".");
  if (!ivB64 || !ctB64) throw new Error("malformed vault blob");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64));
  return JSON.parse(new TextDecoder().decode(pt));
}
