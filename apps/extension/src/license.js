// Offline license verification for the browser extension — the JS counterpart of the
// Rust `core-license` crate (ADR-0015, ADR-0011). A purchase on the Lemon Squeezy
// storefront yields a signed token `PPDF1.<b64url(json)>.<b64url(sig)>`; the user pastes
// it in and we verify the Ed25519 signature ON-DEVICE against the embedded vendor PUBLIC
// key. No activation server, no phone-home — the privacy invariant is untouched.
//
// The signed payload (exact field order set by scripts/license/sign.mjs):
//   { subject, tier, features[], issued_at, expires_at, device_id }
//   expires_at 0 = perpetual; device_id "" = valid on any device.

// Vendor PUBLIC key (safe to ship). MUST match apps/app/src-tauri VENDOR_PUBLIC and
// scripts/license/vendor-key.json's publicHex.
export const VENDOR_PUBLIC_HEX = "122609890356e1440e4b10c7dc29d3c9dfbaed880979488fdb3c6cd0ef128c37";

const FREE = { licensed: false, tier: "free", features: [], subject: "", reason: "" };

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let _key;
async function vendorKey() {
  if (!_key) {
    const raw = hexToBytes(VENDOR_PUBLIC_HEX);
    // Chrome supports the standard "Ed25519" name; some runtimes use "NODE-ED25519".
    try {
      _key = { k: await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]), algo: { name: "Ed25519" } };
    } catch {
      _key = { k: await crypto.subtle.importKey("raw", raw, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }, false, ["verify"]), algo: { name: "NODE-ED25519" } };
    }
  }
  return _key;
}

/**
 * Verify a license token fully offline.
 * @returns {Promise<{licensed:boolean,tier:string,features:string[],subject:string,expires_at:number,reason:string}>}
 */
export async function verifyLicense(token, { now = Math.floor(Date.now() / 1000), deviceId = "" } = {}) {
  // A PPDF1 token contains NO whitespace, so strip any (line-wrapping when copied from chat/
  // email inserts spaces/newlines INSIDE the token — the #1 cause of "invalid" on paste).
  const t = (token || "").replace(/\s+/g, "");
  if (!t) return { ...FREE };
  const parts = t.split(".");
  if (parts.length !== 3 || parts[0] !== "PPDF1") return { ...FREE, reason: "Not a valid license token." };
  let json, sig, lic;
  try {
    json = b64urlToBytes(parts[1]);
    sig = b64urlToBytes(parts[2]);
    lic = JSON.parse(new TextDecoder().decode(json));
  } catch { return { ...FREE, reason: "License token is malformed." }; }

  let ok;
  try {
    const { k, algo } = await vendorKey();
    ok = await crypto.subtle.verify(algo, k, sig, json);
  } catch { ok = false; }
  if (!ok) return { ...FREE, reason: "Signature does not verify — not a genuine license." };

  if (lic.expires_at && lic.expires_at !== 0 && now > lic.expires_at) {
    return { ...FREE, tier: lic.tier || "free", subject: lic.subject || "", reason: "This license has expired." };
  }
  if (lic.device_id && deviceId && lic.device_id !== deviceId) {
    return { ...FREE, reason: "This license is registered to a different device." };
  }
  return {
    licensed: true,
    tier: lic.tier || "pro",
    features: Array.isArray(lic.features) ? lic.features : [],
    subject: lic.subject || "",
    expires_at: lic.expires_at || 0,
    reason: "",
  };
}

// A random per-install device id (an installation id, NOT a hardware fingerprint —
// privacy-preserving, ADR-0011). Shown to the buyer so a device-bound token can be issued.
export async function getDeviceId() {
  const { ppf_device_id } = await chrome.storage.local.get("ppf_device_id");
  if (ppf_device_id) return ppf_device_id;
  const id = (crypto.randomUUID && crypto.randomUUID()) ||
    Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ ppf_device_id: id });
  return id;
}

export async function saveLicenseToken(token) {
  await chrome.storage.local.set({ ppf_license: (token || "").replace(/\s+/g, "") });
}
export async function clearLicense() {
  await chrome.storage.local.remove("ppf_license");
}

const nowSec = () => Math.floor(Date.now() / 1000);

// The issuer endpoint that mints a device-bound 7-day trial (served DOWNWARD to us; we send only
// our random device id — never user content). This is the ONE sanctioned network call at trial start.
const ISSUER_TRIAL_URL = "https://polyglotformfill.com/issuer/trial";

/**
 * Ensure this install has a trial: if there's no paid license and no trial has EVER been minted
 * here (a stored trial token — valid or expired — blocks a re-mint so an expired trial can't be
 * silently renewed), mint one 7-day device-bound trial and store it. Best-effort: if offline, it
 * simply retries next time. Call at startup (popup + background).
 */
export async function ensureTrial() {
  const { ppf_license, ppf_trial } = await chrome.storage.local.get(["ppf_license", "ppf_trial"]);
  if (ppf_license || ppf_trial) return;
  const device = await getDeviceId();
  try {
    const r = await fetch(`${ISSUER_TRIAL_URL}?device=${encodeURIComponent(device)}`);
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.token) await chrome.storage.local.set({ ppf_trial: j.token });
  } catch { /* offline — no trial yet; try again next launch */ }
}

// The current entitlement. A paid license wins; else an unexpired trial; else locked (no free tier).
// `.active` is the single gate for fill/features. `.trial`/`.daysLeft`/`.expired` drive the UI.
export async function getEntitlement() {
  const deviceId = await getDeviceId();
  const { ppf_license, ppf_trial } = await chrome.storage.local.get(["ppf_license", "ppf_trial"]);
  if (ppf_license) {
    const e = await verifyLicense(ppf_license, { deviceId });
    if (e.licensed) {
      const daysLeft = e.expires_at ? Math.max(0, Math.ceil((e.expires_at - nowSec()) / 86400)) : -1;
      return { ...e, active: true, trial: false, daysLeft };
    }
  }
  if (ppf_trial) {
    const e = await verifyLicense(ppf_trial, { deviceId });
    if (e.licensed) {
      return { ...e, tier: "trial", active: true, trial: true, daysLeft: Math.max(0, Math.ceil((e.expires_at - nowSec()) / 86400)) };
    }
    return { ...FREE, active: false, trial: true, expired: true, reason: "Your 7-day free trial has ended." };
  }
  return { ...FREE, active: false };
}

export function hasFeature(entitlement, feature) {
  return !!entitlement && entitlement.active && (entitlement.features || []).includes(feature);
}

// Tier gating. `trial` ranks with `pro` — a trial unlocks everything for 7 days; then it drops to
// `free` (rank 0 = locked, no free-forever tier).
export const TIER_RANK = { free: 0, trial: 1, pro: 1, family: 2 };
export function tierAtLeast(entitlement, minTier) {
  if (entitlement && entitlement.active === false) return false;
  return (TIER_RANK[entitlement && entitlement.tier] || 0) >= (TIER_RANK[minTier] || 0);
}
/** True if there's an ACTIVE entitlement (paid Pro+ or an unexpired trial). */
export async function isActive() {
  return !!(await getEntitlement()).active;
}
/** Back-comat alias: Pro-or-trial-active gates historically called isPro(). */
export async function isPro() {
  return tierAtLeast(await getEntitlement(), "pro");
}
