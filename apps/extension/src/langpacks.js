// RFC-0006 Phase 1 — on-device language-pack manager.
// Downloads a pack's weights (assets DOWN only — no user content is ever sent),
// verifies their sha256, and stores them in IndexedDB so each pack can be installed
// and removed independently, with honest disk-usage accounting. The translation
// ENGINE that consumes these weights is Phase 2; this module is only about getting
// packs on/off the device.

const CDN = "https://polyglotformfill.surge.sh";
export const MANIFEST_URL = `${CDN}/langpacks/manifest.json`;
const DB = "ppf-langpacks";
const V = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, V);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("weights")) db.createObjectStore("weights", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}
const done = (t) => new Promise((res, rej) => { t.transaction.oncomplete = () => res(); t.transaction.onerror = () => rej(t.transaction.error); });
const getAll = (s) => new Promise((res, rej) => { const r = s.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Available packs from the hosted manifest (falls back to empty on network error).
export async function listAvailable() {
  const res = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const m = await res.json();
  return Array.isArray(m.packs) ? m.packs : [];
}

export async function listInstalled() {
  const db = await openDb();
  const rows = await getAll(tx(db, "packs", "readonly"));
  db.close();
  return rows;
}

export async function usageBytes() {
  const rows = await listInstalled();
  return rows.reduce((n, p) => n + (p.size || 0), 0);
}

// Download + verify + store one pack. onProgress(received, total) for a progress bar.
export async function install(pack, onProgress) {
  const res = await fetch(`${CDN}${pack.url}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const total = Number(res.headers.get("content-length")) || pack.size || 0;

  // Stream so we can report progress.
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done: d, value } = await reader.read();
    if (d) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, total);
  }
  const bytes = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }

  // Integrity: refuse a pack whose bytes don't match the manifest hash (anti-tamper).
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (pack.sha256 && digest !== pack.sha256.toLowerCase()) {
    throw new Error("checksum mismatch — refusing to install");
  }

  const db = await openDb();
  const wt = tx(db, "weights", "readwrite");
  wt.put({ id: pack.id, bytes: bytes.buffer });
  await done(wt);
  const pt = tx(db, "packs", "readwrite");
  pt.put({ id: pack.id, from: pack.from, to: pack.to, label: pack.label, size: bytes.length, sha256: digest, engine: pack.engine || "stub", installedAt: Date.now() });
  await done(pt);
  db.close();
  return { id: pack.id, size: bytes.length };
}

// Remove a pack — deletes its weights and frees the space.
export async function remove(id) {
  const db = await openDb();
  const wt = tx(db, "weights", "readwrite");
  wt.delete(id);
  await done(wt);
  const pt = tx(db, "packs", "readwrite");
  pt.delete(id);
  await done(pt);
  db.close();
}

// Phase-1 stub translator: no engine yet, so return the text unchanged if the pack
// is installed. Phase 2 replaces this with the bundled Bergamot/Marian WASM.
export async function translate({ text, from, to }) {
  const installed = await listInstalled();
  const has = installed.some((p) => p.from === from && p.to === to);
  if (!has) { const e = new Error("pack-missing"); e.code = "pack-missing"; throw e; }
  return text; // engine arrives in Phase 2
}
