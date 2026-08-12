// Encrypted vault backup/transfer — byte-compatible with the desktop app's
// core-crypto export format so a file exported on one imports on the other.
//
// Layout: MAGIC(8 "PPFVLT01") | iters(4 LE) | salt(16) | nonce(12) | ciphertext+tag
// Key = PBKDF2-HMAC-SHA256(passphrase, salt, iters) -> AES-256-GCM. The header is
// the GCM associated data, so it can't be tampered with. There is NO plaintext export.
// Inner plaintext JSON: { "v":1, "subject":<string>, "data":{ key:value, ... } }.

const MAGIC = new TextEncoder().encode("PPFVLT01"); // 8 bytes
const ITERS = 600000;
const HLEN = 8 + 4 + 16;

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(passphrase, salt, iters) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Encrypt an inner-JSON object into the .ppfvault byte layout (shared by v1 + v2 exports).
async function seal(passphrase, obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const header = new Uint8Array(HLEN);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(8, ITERS, true); // little-endian
  header.set(salt, 12);
  const key = await deriveKey(passphrase, salt, ITERS);
  const plaintext = enc.encode(JSON.stringify(obj));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: header }, key, plaintext),
  );
  const out = new Uint8Array(HLEN + 12 + ct.length);
  out.set(header, 0);
  out.set(nonce, HLEN);
  out.set(ct, HLEN + 12);
  return out;
}

// vault: a plain { key: value } object. Returns a Uint8Array (the .ppfvault file).
// v1 format — a SINGLE profile. Kept for callers that back up just the active profile.
export async function exportVault(passphrase, vault, subject = "") {
  return seal(passphrase, { v: 1, subject, data: vault });
}

// v2 format — the WHOLE vault: every profile, each restored under its own name.
// profiles: [{ id?, name, data:{k:v} }]. Byte-compatible container; only the inner JSON differs,
// so a v2 file still decrypts on the desktop (which understands v2) and an old build reading it
// falls back to the first profile rather than erroring.
export async function exportVaultAll(passphrase, profiles, subject = "") {
  const clean = (profiles || []).map((p) => ({ id: p.id || "", name: p.name || "", data: p.data || {} }));
  return seal(passphrase, { v: 2, subject, profiles: clean });
}

// Returns { subject, data, profiles } or throws on wrong passphrase / tampering / bad format.
// - v2 file → `profiles` is the full list; `data` mirrors the first profile (back-compat).
// - v1 file → `profiles` is a single synthesized entry named after the subject; `data` is its map.
export async function importVault(passphrase, bytes) {
  const b = new Uint8Array(bytes);
  if (b.length < HLEN + 12 + 16) throw new Error("file too short / not a vault backup");
  const header = b.slice(0, HLEN);
  for (let i = 0; i < 8; i++) if (header[i] !== MAGIC[i]) throw new Error("not a PolyglotFormFill vault backup");
  const iters = new DataView(header.buffer, header.byteOffset).getUint32(8, true);
  if (iters === 0 || iters > 5000000) throw new Error("invalid backup header");
  const salt = header.slice(12, 28);
  const nonce = b.slice(HLEN, HLEN + 12);
  const ct = b.slice(HLEN + 12);
  const key = await deriveKey(passphrase, salt, iters);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: header }, key, ct);
  } catch (_) {
    throw new Error("wrong passphrase or the file was tampered with");
  }
  const obj = JSON.parse(dec.decode(plain));
  if (Array.isArray(obj.profiles)) {
    // v2 — the whole vault.
    const profiles = obj.profiles.map((p) => ({ id: (p && p.id) || "", name: (p && p.name) || "", data: (p && p.data) || {} }));
    return { subject: obj.subject || "", profiles, data: (profiles[0] && profiles[0].data) || {} };
  }
  // v1 — a single profile; present it as a one-entry profile list too, so callers have one shape.
  const data = obj.data || {};
  return { subject: obj.subject || "", data, profiles: [{ id: "", name: obj.subject || "", data }] };
}
