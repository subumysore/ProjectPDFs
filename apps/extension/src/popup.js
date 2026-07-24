// Popup UI: unlock (passphrase / passkey), fill the active page, lock.
// Single-source-of-truth: when "desktop vault mode" is on, the popup reads AND writes
// through the native companion, so the ONE desktop vault is authoritative — the
// extension keeps no separate copy.
import { exportVault, importVault } from "./backup.js";
import { collectTypedValues, newInformation } from "./pagecapture.js";
import { keyFromLabel, isCapturableLabel } from "./vaultkey.js";
import { UI_LANGS, translator, dirOf, detectUiLang } from "./i18n.js";
import { fillPdfBytes, fillPdfByProximity } from "./pdffill.js";
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");

// Pull the printed text layer (positions in PDF user space) so opaque XFA/LiveCycle forms can be
// filled by PROXIMITY to each box's real caption instead of its meaningless field name.
async function extractPdfTexts(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const texts = [];
  for (let pi = 0; pi < doc.numPages; pi++) {
    const tc = await (await doc.getPage(pi + 1)).getTextContent();
    for (const it of tc.items) { const s = (it.str || "").trim(); if (s) texts.push({ page: pi, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || 10, s }); }
  }
  return texts;
}
import { fillPage } from "./pagefill.js";
import { shouldUseDesktopVault, migrationPlan, reconcileVaults } from "./companion.js";
import { chooseDataProfile } from "./profileMatch.js";
const $ = (id) => document.getElementById(id);
// Show the loaded version in the header so it's always obvious which code is running.
try { const v = $("ver"); if (v) v.textContent = "v" + chrome.runtime.getManifest().version; } catch (_) { /* non-extension context */ }
const send = (msg) => chrome.runtime.sendMessage(msg);
function setMsg(text, ok = true) {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}
// When the vault can't be read, show a CLEAR, actionable message. In single-vault mode the vault
// lives in the desktop app, so a "locked" answer means "unlock the desktop app", not an error.
// Returns true if blocked (caller should stop).
function vaultBlocked(r) {
  if (r && r.ok) return false;
  if (r && r.locked) {
    setMsg("🔒 Your vault is shared with the desktop app, which is locked. Open the PolyglotFormFill desktop app and unlock it, then click again.", false);
  } else {
    setMsg((r && r.error) || "Vault unavailable — unlock it (or open the desktop app).", false);
  }
  return true;
}

const COMP = { on: false, profile: "" };
// Chrome caps a native-messaging message at 1 MB. Vaults can hold base64 images (passport scan,
// licence, photo, signature) that dwarf that, so every bulk desktop-vault read asks the host to omit
// values longer than this — keeping the response small so text autofill and sync never trip the cap.
// Big fields (images) are fetched individually, on demand, only when a PDF actually needs them.
const VAULT_TEXT_MAX = 200000;
// AUTOMATIC single vault (no toggle): if the desktop app's companion bridge is reachable, the
// desktop's ONE vault is authoritative and the extension reads/writes it. Otherwise the extension
// transparently uses its own local vault. Whichever app was started first, both end up on one vault.
async function resolveVaultMode() {
  const s = await chrome.storage.local.get(["companionProfile"]);
  COMP.profile = s.companionProfile || "";
  try {
    const ping = await send({ type: "companionPing" });
    if (shouldUseDesktopVault(ping)) {
      COMP.on = true;
      await compProfile();            // auto-pick (or create) the desktop profile
      COMP.synced = await autoSync(); // bidirectional last-write-wins, every open, no clicks
      return;
    }
  } catch (_) { /* companion not installed/running → local vault */ }
  COMP.on = false;
}
// Resolve which desktop profile the extension writes to. CRITICAL: bind to the profile that actually
// HOLDS DATA, never blindly to the first one. Earlier this latched onto profiles[0] (often an empty
// auto-created "Me"), then cached it forever — so with a populated profile present the extension still
// filled from the empty one (0 fields filled). The field COUNT comes back INSIDE listProfiles now
// (one cheap round-trip, no vault decryption), so this makes NO extra host calls — keeping the popup
// snappy. Keep a remembered choice while it still has data; else pick the profile with the most
// fields; create "Me" only when there are none at all.
async function compProfile() {
  let pl = await send({ type: "companionProfiles" });
  if (pl.ok && (!pl.profiles || pl.profiles.length === 0)) {
    const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    await send({ type: "companionCreateProfile", id, name: "Me" });
    pl = await send({ type: "companionProfiles" });
  }
  if (!pl.ok || !pl.profiles || !pl.profiles.length) return COMP.profile;
  const counts = {};
  for (const p of pl.profiles) counts[p.id] = p.count || 0;
  const chosen = chooseDataProfile(pl.profiles, counts, COMP.profile);
  if (chosen && chosen !== COMP.profile) {
    COMP.profile = chosen;
    await chrome.storage.local.set({ companionProfile: COMP.profile });
  }
  return COMP.profile;
}
// AUTO-SYNC (runs on every popup open): reconcile this browser's vault with the desktop vault by
// LAST-WRITE-WINS per field, in BOTH directions. Fields on only one side are copied over; when both
// hold a field, the newer `updated_at` wins. Nothing is ever deleted, so no data can be lost.
// Requires this browser's vault to be readable — it's encrypted, so it must have been unlocked
// (the session cache keeps it readable afterwards). Silent: no clicks, no prompts.
// Returns a short summary for the UI, or null when it couldn't run.
async function autoSync() {
  const st = await send({ type: "status" });
  if (!(st && st.ok && st.unlocked)) return null; // local vault not readable yet → nothing to do
  const profileId = await compProfile();
  if (!profileId) return null;
  const localR = await send({ type: "getVaultMeta" });
  const deskR = await send({ type: "companionVaultMeta", profileId, maxValueLen: VAULT_TEXT_MAX });
  if (!localR || !localR.ok || !deskR || !deskR.ok) return null; // desktop locked/unavailable → later
  const { toLocal, toRemote } = reconcileVaults(localR.meta, deskR.meta);
  for (const [key, o] of Object.entries(toRemote)) {
    await send({ type: "companionUpsert", profileId, key, value: o.value, updatedAt: o.updated_at });
  }
  for (const [key, o] of Object.entries(toLocal)) {
    await send({ type: "set", key, value: o.value, updatedAt: o.updated_at });
  }
  const n = Object.keys(toRemote).length + Object.keys(toLocal).length;
  return n ? `Synced ${n} field(s) with the desktop app.` : "";
}
// The active desktop profile's display name (so the popup shows WHICH profile's vault it's on —
// the same profile the desktop app shows). Falls back to the id.
async function compProfileName() {
  const id = await compProfile();
  const pl = await send({ type: "companionProfiles" });
  if (pl.ok && pl.profiles) {
    const p = pl.profiles.find((x) => x.id === id);
    if (p) return p.name || p.id;
  }
  return id || "—";
}

async function refresh() {
  await resolveVaultMode();
  if (COMP.on) {
    const s = await send({ type: "status" });
    // This browser has its own older encrypted vault that hasn't been read yet. It can only be
    // synced once it's unlocked (encryption — nothing can read it without the passphrase), so show
    // the normal unlock. After this single unlock it stays readable and syncs automatically.
    if (s && s.ok && s.hasLocal && !s.unlocked) {
      $("locked").classList.remove("hidden");
      $("unlocked").classList.add("hidden");
      const banner = $("banner");
      banner.classList.remove("hidden");
      banner.textContent =
        "Unlock this browser's vault once so its data syncs with the desktop app — after this it syncs automatically.";
      return;
    }
    $("locked").classList.add("hidden");
    $("unlocked").classList.remove("hidden");
    const banner = $("banner");
    banner.classList.remove("hidden");
    banner.textContent =
      `One vault · in sync with the desktop app · profile: ${await compProfileName()}` +
      (COMP.synced ? ` · ${COMP.synced}` : "");
    await renderEntries();
    return;
  }
  $("banner").classList.add("hidden");
  const s = await send({ type: "status" });
  const unlocked = s && s.ok && s.unlocked;
  $("locked").classList.toggle("hidden", unlocked);
  $("unlocked").classList.toggle("hidden", !unlocked);
  if (unlocked) await renderEntries();
}

// Read the active vault — the desktop one in companion mode, else the local one. Bulk reads omit
// oversized image blobs (VAULT_TEXT_MAX) so the desktop response never trips Chrome's 1 MB cap;
// a caller that needs a specific image fetches it on demand (getField).
async function readVault() {
  if (COMP.on) {
    const profileId = await compProfile();
    return send({ type: "companionVault", profileId: profileId || undefined, maxValueLen: VAULT_TEXT_MAX });
  }
  return send({ type: "getVault" });
}

// Show every saved field with its value + a delete button.
async function renderEntries() {
  const r = await readVault();
  const box = $("entries");
  box.textContent = "";
  if (!r.ok) {
    box.innerHTML = r.locked
      ? `<div class="empty">🔒 Your vault is shared with the desktop app, which is <b>locked</b>. Open the PolyglotFormFill desktop app and unlock it — your fields appear here automatically.</div>`
      : `<div class="empty">${COMP.on ? "Desktop app vault unavailable — is the app installed &amp; the companion registered? " : ""}${(r.error || "")}</div>`;
    return;
  }
  renderNativeLang(r.vault);
  // native_language is edited via the dedicated "Your language" dropdown, not the
  // generic field list.
  const keys = Object.keys(r.vault || {}).filter((k) => k !== "native_language");
  if (!keys.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "No fields yet — add your name, email, etc. below.";
    box.appendChild(p);
    return;
  }
  for (const k of keys.sort()) {
    const row = document.createElement("div");
    row.className = "entry";
    const kEl = document.createElement("span");
    kEl.className = "k";
    kEl.textContent = k;
    // Image values show as a thumbnail, not a giant data-URI in a text box.
    const isImage = typeof r.vault[k] === "string" && r.vault[k].startsWith("data:image");
    let vEl;
    if (isImage) {
      vEl = document.createElement("img");
      vEl.src = r.vault[k];
      vEl.alt = k;
      vEl.style.cssText = "max-height:34px;max-width:150px;object-fit:contain;border:1px solid #d9e2e6;border-radius:4px;background:#fff";
      row.append(kEl, vEl, makeDelete(k));
      box.appendChild(row);
      continue;
    }
    // Editable value — type directly and it saves on Enter or when you click away.
    vEl = document.createElement("input");
    vEl.className = "vin";
    vEl.value = r.vault[k] ?? "";
    vEl.placeholder = "— add value —";
    const saveVal = async () => {
      const val = vEl.value;
      if (val === (r.vault[k] ?? "")) return;
      let res;
      if (COMP.on) res = await send({ type: "companionUpsert", profileId: await compProfile(), key: k, value: val });
      else res = await send({ type: "set", key: k, value: val });
      if (res && res.ok) { r.vault[k] = val; setMsg(`Saved “${k}”.`); }
      else setMsg((res && res.error) || "Save failed", false);
    };
    vEl.onblur = saveVal;
    vEl.onkeydown = (e) => { if (e.key === "Enter") vEl.blur(); };
    row.append(kEl, vEl, makeDelete(k));
    box.appendChild(row);
  }

  function makeDelete(key) {
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "✕";
    x.title = "Delete";
    x.onclick = async () => {
      if (COMP.on) await send({ type: "companionDelete", profileId: await compProfile(), key });
      else await send({ type: "del", key });
      renderEntries();
    };
    return x;
  }
}

// Add / update a field — write-through to the desktop vault in companion mode.
async function addField() {
  const key = $("newKey").value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const value = $("newVal").value;
  if (!key) return setMsg("Enter a field name (e.g. full_name).", false);
  let r;
  if (COMP.on) {
    const profileId = await compProfile();
    if (!profileId) return setMsg("No desktop profile found. Create one in the desktop app first.", false);
    r = await send({ type: "companionUpsert", profileId, key, value });
  } else {
    r = await send({ type: "set", key, value });
  }
  if (vaultBlocked(r)) return;
  $("newKey").value = "";
  $("newVal").value = "";
  setMsg(`Saved “${key}”${COMP.on ? " to the desktop vault" : ""}.`);
  renderEntries();
}

if ($("resetVault")) $("resetVault").onclick = async (e) => {
  e.preventDefault();
  if (!confirm("Reset the vault?\n\nThis ERASES all saved details on this device and lets you set a NEW passphrase. It cannot be undone (that's what the encryption guarantees).")) return;
  await send({ type: "resetVault" });
  $("pass").value = "";
  setMsg("Vault reset — type a new passphrase and click Unlock to start fresh.");
};
$("unlock").onclick = async () => {
  const r = await send({ type: "unlock", passphrase: $("pass").value });
  $("pass").value = "";
  if (r.ok) {
    setMsg(`Unlocked. ${r.keys.length} field(s) remembered.`);
    refresh();
  } else setMsg(r.error || "Unlock failed (wrong passphrase?)", false);
};

// WebAuthn PRF unlock: the passkey's PRF extension yields a per-credential secret
// that only exists when the hardware authenticator is present + the user gestures.
$("unlockPasskey").onclick = async () => {
  try {
    const { credId } = await chrome.storage.local.get(["credId"]);
    if (!credId) {
      setMsg("No passkey enrolled yet. Enrol one in options (coming) or use a passphrase.", false);
      return;
    }
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: Uint8Array.from(atob(credId), (c) => c.charCodeAt(0)), type: "public-key" }],
        userVerification: "required",
        extensions: { prf: { eval: { first: new TextEncoder().encode("projectpdfs-vault") } } },
      },
    });
    const prf = assertion.getClientExtensionResults().prf;
    if (!prf || !prf.results || !prf.results.first) {
      setMsg("This authenticator doesn't support PRF. Use a passphrase.", false);
      return;
    }
    const secretB64 = btoa(String.fromCharCode(...new Uint8Array(prf.results.first)));
    const r = await send({ type: "unlockWebAuthn", prfSecret: secretB64 });
    if (r.ok) {
      setMsg("Unlocked with passkey (hardware-backed).");
      refresh();
    } else setMsg(r.error || "Passkey unlock failed", false);
  } catch (e) {
    setMsg("Passkey unlock cancelled/failed: " + ((e && e.message) || e), false);
  }
};

// ---- Encrypted backup / transfer ----
function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

$("export").onclick = async () => {
  const pass = $("bkPass").value;
  if (pass.length < 8) return setMsg("Choose a backup passphrase (8+ characters).", false);
  const r = await readVault();
  if (vaultBlocked(r)) return;
  const withVal = Object.entries(r.vault || {}).filter(([, v]) => v && String(v).trim());
  if (!withVal.length) return setMsg("Your fields are empty — type some values first, then export.", false);
  const bytes = await exportVault(pass, r.vault, "");
  try {
    // chrome.downloads is reliable from a popup and shows a Save dialog (saveAs).
    await chrome.downloads.download({
      url: "data:application/octet-stream;base64," + toBase64(bytes),
      filename: "polyglotformfill-vault.ppfvault",
      saveAs: true,
    });
    setMsg(`Exporting ${withVal.length} filled field(s) — choose where to save the file.`);
  } catch (e) {
    setMsg("Export failed: " + ((e && e.message) || e), false);
  }
};

$("importBtn").onclick = () => $("bkFile").click();
$("bkFile").onchange = async () => {
  const file = $("bkFile").files[0];
  if (!file) return;
  const pass = $("bkPass").value;
  if (!pass) { $("bkFile").value = ""; return setMsg("Enter the backup passphrase to import.", false); }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { data } = await importVault(pass, bytes);
    const entries = Object.entries(data);
    for (const [k, v] of entries) {
      if (COMP.on) await send({ type: "companionUpsert", profileId: await compProfile(), key: k, value: v });
      else await send({ type: "set", key: k, value: v });
    }
    setMsg(`Imported ${entries.length} field(s).`);
    renderEntries();
  } catch (e) {
    setMsg("Import failed: " + ((e && e.message) || e), false);
  }
  $("bkFile").value = "";
};

// Translate tool — dynamic-imports the (large) engine only when first used.
$("trBtn").onclick = async () => {
  const text = $("trIn").value;
  if (!text.trim()) return;
  if (!(await ensurePro("On-device translation"))) return; // Translation = Pro
  $("trBtn").disabled = true;
  $("trOut").textContent = "loading…";
  try {
    const { translate } = await import("./translate.js");
    $("trOut").textContent = await translate(text, $("trDir").value, (s) => {
      $("trOut").textContent = s;
    });
  } catch (e) {
    $("trOut").textContent = "Translate failed: " + ((e && e.message) || e);
  }
  $("trBtn").disabled = false;
};

$("add").onclick = addField;
$("newVal").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addField();
});

$("lock").onclick = async () => {
  await send({ type: "lock" });
  setMsg("Locked.");
  refresh();
};

// Collect the fillable fields' labels from the page (SAME order/skip rules as fillPage),
// so we can translate a foreign form's labels into English for the ontology to match.
function collectFillLabels() {
  const labelOf = (el) => {
    // The visible caption is often a SIBLING (Angular/React forms rarely use <label for>),
    // and the id can be misspelt (e.g. "passportExpirtyDate"). Read the nearest ancestor's
    // short text so the real, human-visible label is seen — not just the field's own tags.
    let gt = "", a = el.parentElement;
    for (let i = 0; i < 4 && a; i++, a = a.parentElement) {
      const t = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length >= 3 && t.length <= 200) { gt = t; break; }
    }
    return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
      (el.labels && el.labels[0] && el.labels[0].textContent) || "",
      (el.closest("label") && el.closest("label").textContent) || "", gt].join(" ");
  };
  const out = [];
  for (const el of document.querySelectorAll("input, textarea")) {
    if (["password", "hidden", "checkbox", "radio", "file", "submit", "button"].includes(el.type)) continue;
    if (el.disabled) continue; // NOTE: readOnly fields ARE included (date pickers are often readOnly)
    out.push(labelOf(el).replace(/\s+/g, " ").trim());
  }
  return out;
}

async function fillActivePage(vault) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // LANGUAGE-AWARE FILL: if the form is in another language, translate its labels into
  // English (the ontology's language) so the resolver still matches — on-device. The
  // form's values are placed as-is, so the SUBMITTED form stays in its own language.
  let tLabels = null;
  try {
    const [{ result: labels } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectFillLabels });
    if (labels && labels.some(Boolean)) {
      const { detectLang } = await import("./lang.js");
      const formLang = detectLang(labels.join(" ")).lang;
      if (formLang !== "en") {
        setMsg(`Form looks ${formLang.toUpperCase()} — translating labels on-device (first run downloads the model)…`);
        const { translateText } = await import("./translate.js");
        const cache = {};
        tLabels = [];
        for (const lab of labels) {
          if (!lab) { tLabels.push(""); continue; }
          if (cache[lab] === undefined) { try { cache[lab] = await translateText(lab, formLang, "en", (s) => setMsg(s)); } catch (_) { cache[lab] = lab; } }
          tLabels.push(cache[lab]);
        }
      }
    }
  } catch (_) { /* translation unavailable → fill with original labels */ }
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillPage,
    args: [vault, tLabels],
  });
  return result || 0;
}

// Fill a PDF open in the tab: read its bytes on-device, fill via AcroForm field names
// (or hand off to OCR), stash the result + label/value pairs + languages, and open the
// viewer — which renders the filled PDF AND the bilingual (label + value) side panel.
// Shared by "Fill this page" and, for a PDF, "View this page in my language".
async function runPdfFlow(r, tab, url, view = false) {
  setMsg(view ? "Reading the PDF to show it in your language…" : "Reading the PDF…");
  // Fetch the PDF bytes in the BACKGROUND service worker (robust — not tied to the popup).
  const fetched = await send({ type: "fetchBytes", url });
  if (!fetched || !fetched.ok) return setMsg("Couldn't read the PDF (" + ((fetched && fetched.error) || "no response") + "). Reload the page and try again.", false);
  try {
    const bytes = Uint8Array.from(atob(fetched.b64), (c) => c.charCodeAt(0));
    // Name the download after the original file: Sample-Fillable-PDF.pdf -> Sample-Fillable-PDF-filled.pdf
    const base = (url.split("?")[0].split("#")[0].split("/").pop() || "form.pdf").replace(/\.pdf$/i, "");
    let acro = await fillPdfBytes(bytes, r.vault);
    // Opaque XFA/LiveCycle form (meaningless field names): fill by proximity to printed captions.
    // Use it when it beats the name-based pass (e.g. the Japan MOFA visa form fills ~0 by name).
    if (!view && acro.xfa) {
      try {
        const prox = await fillPdfByProximity(bytes, r.vault, await extractPdfTexts(bytes));
        if (prox.filled > acro.filled) acro = prox;
      } catch (_) { /* keep the name-based result */ }
    }

    // VIEW-ONLY: "View this page in my language" must NOT fill the form. We still resolve
    // the label→value pairs (so the panel can show what WOULD fill each field, in your
    // language), but the document shown is the ORIGINAL, untouched form.
    if (view) {
      let obin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) obin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const pairs = acro.pairs || [];
      let formLang = "en";
      try { const { detectLang } = await import("./lang.js"); if (pairs.length) formLang = detectLang(pairs.map((p) => p.label).join(" ")).lang; } catch (_) { /* default en */ }
      const ob64 = btoa(obin);
      await chrome.storage.session.set({
        ppf_filled: ob64, ppf_orig: ob64, ppf_url: url, ppf_name: `${base}.pdf`, ppf_view: true,
        ppf_pairs: pairs, ppf_formLang: formLang, ppf_nativeLang: (r.vault && r.vault.native_language) || "en",
      });
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("viewer.html") });
      return setMsg("Showing this form in your language — the form itself is NOT filled. ✓");
    }
    // Trust the AcroForm layer only when it's a real, non-XFA form that actually
    // filled. XFA/LiveCycle hybrids (W-2/W-4/W-9) expose an unreliable AcroForm
    // shadow — OCR reads their true printed labels instead.
    // Proximity fills produce a real, viewable AcroForm result even though the form is XFA —
    // route them to the viewer too (NOT the OCR fallback, which would discard them).
    if (acro.filled && acro.bytes && (!acro.xfa || acro.proximity)) {
      // Fast path: matched by AcroForm field names. Show the result in the viewer,
      // passing the field labels + languages so the viewer can offer a translated
      // label+value side panel (view a foreign PDF in your language).
      let bin = "";
      for (let i = 0; i < acro.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, acro.bytes.subarray(i, i + 0x8000));
      const pairs = acro.pairs || [];
      let formLang = "en";
      try { const { detectLang } = await import("./lang.js"); if (pairs.length) formLang = detectLang(pairs.map((p) => p.label).join(" ")).lang; } catch (_) { /* default en */ }
      // Keep the ORIGINAL (unfilled) bytes too, so the viewer can offer a
      // "Show original form" toggle (re-fill manually, compare, or download blank).
      let obin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) obin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      await chrome.storage.session.set({
        ppf_filled: btoa(bin), ppf_orig: btoa(obin), ppf_url: url, ppf_name: `${base}-filled.pdf`,
        ppf_view: false, // this IS a fill — clear any stale view-mode flag from a prior "View"
        ppf_pairs: pairs, ppf_formLang: formLang, ppf_nativeLang: (r.vault && r.vault.native_language) || "en",
      });
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("viewer.html") });
      return setMsg(`Filled ${acro.filled} of ${acro.total} field(s) via form fields — showing your filled PDF + labels/values in your language. ✓`);
    }
    // OCR path (XFA/LiveCycle like the IRS W-2, scanned, or unlabeled). Hand the
    // SOURCE bytes + vault to the VIEWER TAB, which runs the OCR there — a closing
    // popup can no longer interrupt it (OCR can take several seconds per page). The
    // decrypted vault sits in ephemeral session storage only and is removed the
    // moment the viewer has read it.
    await chrome.storage.session.set({
      ppf_src: fetched.b64,
      ppf_vault: r.vault,
      ppf_url: url,
      ppf_name: `${base}-filled.pdf`,
      ppf_mode: "ocr",
      ppf_xfa: !!acro.xfa,
      ppf_view: false, // this IS a fill — clear any stale view-mode flag
    });
    await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("viewer.html") });
    return setMsg("Reading the form with OCR in the opened tab — watch the progress there. ✓");
  } catch (e) {
    return setMsg("PDF fill failed: " + ((e && e.message) || e), false);
  }
}

$("fill").onclick = async () => {
  const r = await readVault();
  if (vaultBlocked(r)) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  // A PDF open in the browser? Fill it on-device with pdf-lib and show the result.
  if (/\.pdf(\?|#|$)/i.test(url)) {
    // Filling starts from the ORIGINAL PDF re-fetched from its URL. Selections the user
    // made in Chrome's OWN built-in PDF viewer live inside that plugin and are NOT
    // readable by any extension — so they can't be merged and would be replaced. Warn
    // FIRST (never silently discard manual work), and steer to the order that works:
    // fill first, then complete the rest in the viewer that opens.
    const notViewer = !/^chrome-extension:\/\/[a-z]+\/viewer\.html/i.test(url); // our own viewer is fine
    if (notViewer && !confirm(
      "Fill this form from your vault?\n\n" +
      "This starts from the ORIGINAL form. Any changes you already made in the browser's " +
      "PDF viewer (e.g. a dropdown choice or checkbox) can't be read by the extension and " +
      "will NOT be kept.\n\n" +
      "Tip: click Fill FIRST, then complete the remaining fields in the viewer that opens.",
    )) return setMsg("Cancelled — nothing was changed.");
    return runPdfFlow(r, tab, url);
  }
  setMsg(`Filled ${await fillActivePage(r.vault)} field(s) on this page${COMP.on ? " (desktop vault)" : ""}.`);
};

// ✍️ Sign / handwrite: open the current PDF in the annotate tool where the user can draw
// or stamp their saved signature/photo anywhere, then flatten + download. Works on ANY
// PDF (printed boxes, scanned forms) — no fillable field required.
if ($("signPdf")) $("signPdf").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  const nameFrom = (u) => ((u || "form").split("?")[0].split("#")[0].split("/").pop() || "form").replace(/\.pdf$/i, "") || "form";
  const s = await chrome.storage.session.get(["ppf_sign_src", "ppf_filled", "ppf_orig", "ppf_name", "ppf_sign_name", "ppf_url"]);
  let b64 = s.ppf_sign_src || s.ppf_filled || s.ppf_orig || null;
  let name = s.ppf_sign_name || (s.ppf_name && s.ppf_name.replace(/\.pdf$/i, "")) || nameFrom(s.ppf_url);

  // FALLBACK (robust): no signable bytes in session, but we know the source form URL — REBUILD the
  // filled PDF from it and sign THAT. This makes Sign work from the viewer even if the viewer tab
  // is stale / cleared the session, WITHOUT the user having to re-fill. No fragile URL matching.
  if (!b64 && s.ppf_url) {
    setMsg("Preparing your filled form to sign…");
    const fetched = await send({ type: "fetchBytes", url: s.ppf_url });
    if (fetched && fetched.ok) {
      try {
        const bytes = Uint8Array.from(atob(fetched.b64), (c) => c.charCodeAt(0));
        const r = await readVault();
        let acro = r.ok ? await fillPdfBytes(bytes, r.vault) : null;
        if (acro && acro.xfa && r.ok) { try { const prox = await fillPdfByProximity(bytes, r.vault, await extractPdfTexts(bytes)); if (prox.filled > acro.filled) acro = prox; } catch (_) { /* keep name-based */ } }
        const outBytes = (acro && acro.bytes) ? acro.bytes : bytes;
        let bin = ""; for (let i = 0; i < outBytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, outBytes.subarray(i, i + 0x8000));
        b64 = btoa(bin);
      } catch (_) { b64 = fetched.b64; } // sign the original if the re-fill fails
      name = nameFrom(s.ppf_url);
    }
  }

  // Or a raw PDF is open directly in the tab.
  if (!b64 && /\.pdf(\?|#|$)/i.test(url)) {
    const fetched = await send({ type: "fetchBytes", url });
    if (fetched && fetched.ok) { b64 = fetched.b64; name = nameFrom(url); }
    else return setMsg("Couldn't read the PDF (" + ((fetched && fetched.error) || "no response") + ").", false);
  }

  if (!b64) return setMsg("Open or Fill a PDF first, then Sign / handwrite it.", false);
  setMsg("Opening the sign tool…");
  await chrome.storage.session.set({ ppf_sign_src: b64, ppf_sign_name: name });
  await chrome.tabs.create({ url: chrome.runtime.getURL("sign.html") });
};

// Add an IMAGE field (photo / signature) — stored as a data-URI value in the vault,
// then DRAWN into matching PDF photo/signature boxes at fill time.
$("imgFile").onchange = async () => {
  const file = $("imgFile").files && $("imgFile").files[0];
  if (!file) return;
  if (!(await ensurePro("Photo / signature image fields"))) { $("imgFile").value = ""; return; } // images = Pro
  const key = ($("imgKey").value.trim() || "signature").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("couldn't read the image"));
    r.readAsDataURL(file);
  }).catch((e) => { setMsg(e.message, false); return null; });
  if (!dataUrl) return;
  let r;
  if (COMP.on) r = await send({ type: "companionUpsert", profileId: await compProfile(), key, value: dataUrl });
  else r = await send({ type: "set", key, value: dataUrl });
  if (r && r.ok) { setMsg(`Saved image “${key}”.`); $("imgKey").value = ""; $("imgFile").value = ""; renderEntries(); }
  else setMsg((r && r.error) || "Save failed", false);
};

// ---- Handwrite a signature on the pad → saved as the "signature" image, drawn into any
// signature box on a form (reuses the image-field pipeline). Pointer + touch.
if ($("sigPad")) {
  const pad = $("sigPad");
  const ctx = pad.getContext("2d");
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#101a20";
  // INK COLOUR. Black is not always right: plenty of authorities require blue ink, some require
  // a particular colour, and a signature drawn in the wrong colour can get a form rejected. The
  // swatches are the common cases in one click; the colour well beside them is a real colour
  // input, so the whole spectrum is available. The choice is remembered per browser.
  // Changing colour NEVER clears what is already drawn — strokes keep the colour they were made
  // with, so a two-colour signature (e.g. initials in red) is possible.
  const INKS = [
    ["#101a20", "Black"], ["#123a8f", "Blue"], ["#0a5c2e", "Green"],
    ["#8f1414", "Red"], ["#4b2e83", "Purple"], ["#6b4a10", "Brown"],
  ];
  const swatches = $("sigSwatches");
  const colorInput = $("sigColor");
  const widthInput = $("sigWidth");
  const applyInk = (hex) => { ctx.strokeStyle = hex; if (colorInput) colorInput.value = hex; };
  if (swatches) {
    for (const [hex, name] of INKS) {
      const b = document.createElement("button");
      b.type = "button"; b.title = name;
      b.style.cssText = `width:18px;height:18px;padding:0;margin:0;border-radius:50%;border:1px solid #cfd8d8;cursor:pointer;background:${hex}`;
      b.onclick = () => { applyInk(hex); chrome.storage.local.set({ sigInk: hex }); };
      swatches.appendChild(b);
    }
  }
  if (colorInput) {
    colorInput.oninput = () => { applyInk(colorInput.value); chrome.storage.local.set({ sigInk: colorInput.value }); };
  }
  if (widthInput) {
    widthInput.oninput = () => { ctx.lineWidth = +widthInput.value; chrome.storage.local.set({ sigWidth: +widthInput.value }); };
  }
  chrome.storage.local.get(["sigInk", "sigWidth"]).then((s) => {
    if (s.sigInk) applyInk(s.sigInk);
    if (s.sigWidth) { ctx.lineWidth = s.sigWidth; if (widthInput) widthInput.value = String(s.sigWidth); }
  }).catch(() => { /* first run: defaults are already set */ });
  let drawing = false, dirty = false, last = null;
  const pos = (e) => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) }; };
  const start = (e) => { drawing = true; dirty = true; last = pos(e); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; e.preventDefault(); };
  const end = () => { drawing = false; };
  pad.addEventListener("pointerdown", start);
  pad.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  $("sigClear").onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); dirty = false; };
  $("sigSave").onclick = async () => {
    if (!dirty) return setMsg("Draw your signature first.", false);
    if (!(await ensurePro("Handwritten signature"))) return; // signature = Pro
    const dataUrl = pad.toDataURL("image/png");
    const r = COMP.on
      ? await send({ type: "companionUpsert", profileId: await compProfile(), key: "signature", value: dataUrl })
      : await send({ type: "set", key: "signature", value: dataUrl });
    if (r && r.ok) { setMsg("Signature saved — it'll fill signature boxes on forms."); renderEntries(); }
    else setMsg((r && r.error) || "Save failed", false);
  };
}

// ---- View this page in MY language (spec: language-aware filling — the "understand"
// direction). Translate a foreign form's visible labels INTO the user's native language,
// in place, so they can READ it. The form still submits in its own language (we only
// change label text, never field values). Reversible.
function collectLabelsForView() {
  const items = [];
  let i = 0;
  const seen = new Set();
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (["password", "hidden", "submit", "button", "file"].includes(el.type)) continue;
    let node = (el.labels && el.labels[0]) || null;
    if (!node) {
      const prev = el.previousElementSibling;
      if (prev && /^(LABEL|SPAN|DIV|P|B|STRONG)$/.test(prev.tagName) && !prev.querySelector("input,textarea,select")) {
        const t = prev.textContent.trim();
        if (t && t.length <= 50) node = prev;
      }
    }
    if (node && !seen.has(node) && node.textContent.trim()) {
      node.setAttribute("data-ppf-i", String(i)); items.push({ i, text: node.textContent.trim() }); seen.add(node); i++;
    }
    if (el.placeholder && el.placeholder.trim()) { el.setAttribute("data-ppf-ph", String(i)); items.push({ i, text: el.placeholder.trim() }); i++; }
  }
  return items;
}
function applyLabelsForView(map) {
  Object.keys(map).forEach((i) => {
    const lab = document.querySelector('[data-ppf-i="' + i + '"]');
    if (lab) { if (!lab.hasAttribute("data-ppf-orig")) lab.setAttribute("data-ppf-orig", lab.textContent); lab.textContent = map[i]; }
    const ph = document.querySelector('[data-ppf-ph="' + i + '"]');
    if (ph) { if (!ph.hasAttribute("data-ppf-pho")) ph.setAttribute("data-ppf-pho", ph.placeholder); ph.placeholder = map[i]; }
  });
}
function restoreLabelsForView() {
  document.querySelectorAll("[data-ppf-orig]").forEach((el) => { el.textContent = el.getAttribute("data-ppf-orig"); el.removeAttribute("data-ppf-orig"); });
  document.querySelectorAll("[data-ppf-pho]").forEach((el) => { el.placeholder = el.getAttribute("data-ppf-pho"); el.removeAttribute("data-ppf-pho"); });
}

$("viewLang").onclick = async () => {
  if (!(await ensurePro("Reading a form in your language"))) return; // Translation = Pro
  const r = await readVault();
  const nativeLang = (r.ok && r.vault && r.vault.native_language) || "en";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  // A PDF opens in Chrome's own plugin, whose fields an extension can't rewrite in
  // place — so "view it in my language" runs the SAME pipeline as Fill and opens the
  // viewer, which shows every label AND value translated into the user's language
  // (the bilingual side panel). Exactly the post-fill translated view the user wants.
  if (/\.pdf(\?|#|$)/i.test(url)) {
    const rv = await readVault();
    if (!rv.ok) return setMsg(rv.error || "Locked", false);
    return runPdfFlow(rv, tab, url, true); // VIEW only — do not fill the form
  }
  const [{ result: items } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectLabelsForView });
  if (!items || !items.length) return setMsg("No form labels found on this page. (Open a web form, or for a PDF use “Fill this page”.)", false);
  const { detectLang } = await import("./lang.js");
  const formLang = detectLang(items.map((x) => x.text).join(" ")).lang;
  if (formLang === nativeLang) return setMsg(`This page is already in your language (${nativeLang.toUpperCase()}).`);
  setMsg(`Translating this page to ${nativeLang.toUpperCase()} on-device (first run downloads the model)…`);
  try {
    const { translateText } = await import("./translate.js");
    const cache = {}; const map = {};
    for (const it of items) {
      if (cache[it.text] === undefined) { try { cache[it.text] = await translateText(it.text, formLang, nativeLang, (s) => setMsg(s)); } catch (_) { cache[it.text] = it.text; } }
      map[it.i] = cache[it.text];
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: applyLabelsForView, args: [map] });
    $("restoreLang").classList.remove("hidden");
    setMsg(`✓ Page shown in ${nativeLang.toUpperCase()}. It still submits in its own language.`);
  } catch (e) {
    setMsg("Translation failed: " + ((e && e.message) || e), false);
  }
};
$("restoreLang").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: restoreLabelsForView });
  $("restoreLang").classList.add("hidden");
  setMsg("Showing the original.");
};

// Gate a Pro-only feature. Returns true if licensed (Pro+); else shows an upsell and false.
async function ensurePro(feature) {
  const { isPro } = await import("./license.js");
  if (await isPro()) return true;
  setMsg(`🔒 ${feature} is a Pro feature. Activate your license below, or Get Pro → polyglotformfill.mooo.com/#pricing`, false);
  return false;
}

// ---- Licensing (offline, ADR-0015/0011): paste the signed token from a Lemon Squeezy
// purchase; verify it on-device against the embedded vendor public key. No phone-home.
const TIER_LABEL = { free: "Free plan", pro: "Pro ✓", family: "Family ✓" };
async function refreshLicenseUI() {
  const { getEntitlement, getDeviceId } = await import("./license.js");
  const dev = await getDeviceId();
  const d = $("licDevice"); if (d) d.textContent = dev;
  const ent = await getEntitlement();
  const st = $("licStatus"); if (st) st.textContent = TIER_LABEL[ent.tier] || (ent.licensed ? "Licensed ✓" : "Free plan");
  $("licRemove").classList.toggle("hidden", !ent.licensed);
  $("licBuy").classList.toggle("hidden", !!ent.licensed);
  if (!ent.licensed && ent.reason) { const m = $("licMsg"); m.className = "sub err"; m.textContent = ent.reason; }
}
if ($("licActivate")) {
  $("licActivate").onclick = async () => {
    const token = ($("licToken").value || "").trim();
    if (!token) return;
    const m = $("licMsg"); m.className = "sub"; m.textContent = "Verifying on-device…";
    const { verifyLicense, saveLicenseToken, getDeviceId } = await import("./license.js");
    const ent = await verifyLicense(token, { deviceId: await getDeviceId() });
    if (!ent.licensed) {
      m.className = "sub err"; m.textContent = ent.reason || "That token isn't valid.";
      // Surface the REAL reason at the top too (the license box may be scrolled out of view),
      // so a device-binding / expiry failure isn't mistaken for "nothing happened".
      setMsg("License not activated: " + (ent.reason || "invalid token") + ". (A token is tied to the device ID shown in the License section — re-issue it for THIS device if you switched browsers/profiles.)", false);
      return;
    }
    await saveLicenseToken(token);
    $("licToken").value = "";
    m.className = "sub ok"; m.textContent = `Activated — ${TIER_LABEL[ent.tier] || ent.tier}${ent.subject ? " (" + ent.subject + ")" : ""}.`;
    // Clear the stale Pro-gate error from the TOP bar and confirm there — this is the message the user sees.
    setMsg(`Pro activated ✓ — ${TIER_LABEL[ent.tier] || ent.tier}. Translation & "View in my language" are unlocked; click the feature again.`);
    refreshLicenseUI();
  };
  $("licRemove").onclick = async () => {
    const { clearLicense } = await import("./license.js");
    await clearLicense();
    const m = $("licMsg"); m.className = "sub"; m.textContent = "License removed — back to Free.";
    refreshLicenseUI();
  };
  $("licCopyDev").onclick = async () => {
    try { await navigator.clipboard.writeText($("licDevice").textContent); const m = $("licMsg"); m.className = "sub ok"; m.textContent = "Device ID copied."; } catch (_) {}
  };
  // Auto-activate the moment a complete token is pasted — no need to hunt for the button.
  $("licToken").addEventListener("input", () => {
    if (/^PPDF1\.[\w-]+\.[\w-]+$/.test(($("licToken").value || "").replace(/\s+/g, ""))) $("licActivate").click();
  });
  refreshLicenseUI();
}

// Native language — a PROFILE field in the vault (spec: language-aware filling).
function renderNativeLang(vault) {
  const sel = $("nativeLang");
  if (!sel) return;
  sel.value = (vault && vault.native_language) || "en";
}
$("nativeLang").onchange = async () => {
  const value = $("nativeLang").value;
  let res;
  if (COMP.on) res = await send({ type: "companionUpsert", profileId: await compProfile(), key: "native_language", value });
  else res = await send({ type: "set", key: "native_language", value });
  const el = $("nativeLangMsg");
  if (res && res.ok) { el.className = "sub"; el.textContent = `Your language: ${$("nativeLang").options[$("nativeLang").selectedIndex].text}.`; }
  else { el.className = "sub err"; el.textContent = (res && res.error) || "Couldn't save."; }
};

// Scan an ID / document with the camera → extract profile fields (opens a full tab,
// where camera access + on-device OCR run without the popup closing).
$("scan").onclick = async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("capture.html") });
  window.close();
};

// Companion: fetch the vault from the native app (keys never enter the extension).
$("companionFill").onclick = async () => {
  setMsg("Contacting native app…");
  const r = await send({ type: "companionVault" });
  if (!r.ok) return setMsg(r.error || "Native app unavailable", false);
  setMsg(`Filled ${await fillActivePage(r.vault)} field(s) from the native app.`);
};

// Injected into the page. Self-contained on-device resolver: understands what each
// form field MEANS (via a general identity ontology, not per-form rules) and DERIVES
// the value from your atomic vault facts. Two directions, both inherent — no rules
// engine, no per-form cases:
//   • SPLIT  — a "Middle Initial" box gets the first letter of your middle name.
//   • COMBINE — a lone "Address" line absorbs street1+street2+city+state+zip, but if
//     the form ALSO has separate City/State/Zip fields, that line collapses to just
//     the street parts. Each atom flows to the most specific field the form exposes;
//     a coarse field collects exactly the descendants no finer field claimed.
// Runs in the page, reads only the DOM, sends nothing out. tLabels (optional) is an
// array of English-translated field labels aligned to collectFillLabels(), used when the
// form is in another language so the (English) ontology can match it.

// ---- Learn NEW details from the page, with consent ------------------------------------------
// The desktop app shows every value it did not already know and saves only what the user ticks.
// The extension had no equivalent, so the same action behaved two ways across one product and
// extension users simply lost what they typed. This is the desktop's posture, ported.
let learnPending = [];
$("learnPage").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  if (/\.pdf(\?|#|$)/i.test(url)) {
    return setMsg("This is a PDF — Chrome's own PDF plugin doesn't let an extension read what you typed there.", false);
  }
  const rv = await readVault();
  if (!rv.ok) return setMsg(rv.error || "Locked", false);
  let typed = [];
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectTypedValues });
    typed = result || [];
  } catch (e) {
    return setMsg("Couldn't read this page: " + ((e && e.message) || e), false);
  }
  learnPending = newInformation(typed, rv.vault || {}, keyFromLabel, isCapturableLabel);
  if (!learnPending.length) {
    $("learnCard").classList.add("hidden");
    return setMsg("Nothing new on this page — everything filled in is already in your vault.");
  }
  const list = $("learnList");
  list.textContent = "";
  learnPending.forEach((p, i) => {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;gap:6px;align-items:flex-start;margin-bottom:5px;font-size:12px";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = true; cb.dataset.i = String(i); cb.className = "learnPick";
    const txt = document.createElement("span");
    txt.textContent = `${p.label} → ${p.value}` + (p.existing ? ` (replaces “${p.existing}”)` : "");
    row.append(cb, txt);
    list.appendChild(row);
  });
  $("learnMsg").textContent = "";
  $("learnCard").classList.remove("hidden");
  setMsg(`Found ${learnPending.length} new detail(s) — tick what to keep.`);
};
$("learnCancel").onclick = () => { $("learnCard").classList.add("hidden"); learnPending = []; };
$("learnSave").onclick = async () => {
  const picks = [...document.querySelectorAll(".learnPick")].filter((c) => c.checked).map((c) => learnPending[+c.dataset.i]);
  if (!picks.length) { $("learnMsg").textContent = "Nothing ticked, so nothing was saved."; return; }
  let saved = 0;
  for (const p of picks) {
    const res = COMP.on
      ? await send({ type: "companionUpsert", profileId: await compProfile(), key: p.key, value: p.value })
      : await send({ type: "set", key: p.key, value: p.value });
    if (res && res.ok) saved++;
  }
  $("learnCard").classList.add("hidden");
  learnPending = [];
  renderEntries();
  setMsg(`Saved ${saved} new detail(s) to your vault — they'll fill automatically next time.`);
};

// ---- UI LANGUAGE ---------------------------------------------------------------------------
// The whole popup is shown in the user's own language, from the catalogue shared with the
// desktop app and the website. Chosen on first open (pre-selected from the browser's own
// language list), changed any time, remembered per browser.
//
// This is the UI language ONLY. It never changes the form's language, and it never changes the
// keys or values in the vault — those keep whatever script the user typed them in.
let UI = "en";
function applyI18n() {
  const tr = translator(UI);
  document.documentElement.lang = UI;
  document.documentElement.dir = dirOf(UI);
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = tr(el.dataset.i18nPlaceholder);
}
async function initUiLang() {
  const sel = $("uiLang");
  if (!sel) return;
  const stored = (await chrome.storage.local.get(["uiLang"])).uiLang;
  // No stored choice yet -> pre-select from the browser's OWN language order, so a Tamil user
  // sees Tamil the very first time the popup opens rather than having to find the setting.
  const preferred = (chrome.i18n && chrome.i18n.getAcceptLanguages)
    ? await new Promise((r) => chrome.i18n.getAcceptLanguages(r)).catch(() => [])
    : navigator.languages || [navigator.language];
  UI = stored || detectUiLang(preferred || []);
  sel.textContent = "";
  for (const [code, label] of Object.entries(UI_LANGS)) {
    const o = document.createElement("option");
    o.value = code; o.textContent = label; if (code === UI) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = async () => {
    UI = sel.value;
    await chrome.storage.local.set({ uiLang: UI });
    applyI18n();
  };
  applyI18n();
}

initUiLang();
refresh();
