// Popup UI: unlock (passphrase / passkey), fill the active page, lock.
// Single-source-of-truth: when "desktop vault mode" is on, the popup reads AND writes
// through the native companion, so the ONE desktop vault is authoritative — the
// extension keeps no separate copy.
import { exportVault, importVault } from "./backup.js";
import { fillPdfBytes } from "./pdffill.js";
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
function setMsg(text, ok = true) {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

const COMP = { on: false, profile: "" };
async function loadCompMode() {
  const s = await chrome.storage.local.get(["companionMode", "companionProfile"]);
  COMP.on = !!s.companionMode;
  COMP.profile = s.companionProfile || "";
}
// Resolve (and remember) which desktop profile the extension writes to.
async function compProfile() {
  if (COMP.profile) return COMP.profile;
  const pl = await send({ type: "companionProfiles" });
  if (pl.ok && pl.profiles && pl.profiles.length) {
    COMP.profile = pl.profiles[0].id;
    await chrome.storage.local.set({ companionProfile: COMP.profile });
  }
  return COMP.profile;
}

async function refresh() {
  await loadCompMode();
  if (COMP.on) {
    // No local unlock in desktop-vault mode — the desktop app holds the key.
    $("locked").classList.add("hidden");
    $("unlocked").classList.remove("hidden");
    $("banner").classList.remove("hidden");
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

// Read the active vault — the desktop one in companion mode, else the local one.
async function readVault() {
  if (COMP.on) {
    const profileId = await compProfile();
    return send({ type: "companionVault", profileId: profileId || undefined });
  }
  return send({ type: "getVault" });
}

// Show every saved field with its value + a delete button.
async function renderEntries() {
  const r = await readVault();
  const box = $("entries");
  box.textContent = "";
  if (!r.ok) {
    box.innerHTML = `<div class="empty">${COMP.on ? "Desktop app vault unavailable — is the app installed & the companion registered? " : ""}${(r.error || "")}</div>`;
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
  if (!r.ok) return setMsg(r.error || "Locked", false);
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
  if (!r.ok) return setMsg(r.error || "Locked", false);
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
    const acro = await fillPdfBytes(bytes, r.vault);

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
    if (acro.filled && acro.bytes && !acro.xfa) {
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
  if (!r.ok) return setMsg(r.error || "Locked", false);
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
    if (!ent.licensed) { m.className = "sub err"; m.textContent = ent.reason || "That token isn't valid."; return; }
    await saveLicenseToken(token);
    $("licToken").value = "";
    m.className = "sub ok"; m.textContent = `Activated — ${TIER_LABEL[ent.tier] || ent.tier}${ent.subject ? " (" + ent.subject + ")" : ""}.`;
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
async function fillPage(vault, tLabels) {
  const norm = (s) => (s || "").toString()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2") // split camelCase / letter-digit
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const initial = (s) => { const m = (s || "").trim().match(/\p{L}/u); return m ? m[0].toUpperCase() : ""; };

  // 1) Canonical "atoms" <- the many ways a user might have named a key.
  const ALIASES = {
    given:    ["given name", "given", "first name", "first", "forename", "fname", "christian name"],
    middle:   ["middle name", "middle", "mname", "middle names", "middle initial", "mi", "m i"],
    family:   ["family name", "last name", "last", "surname", "lname", "family"],
    full:     ["full name", "name", "complete name", "legal name", "applicant name", "your name"],
    street1:  ["address line 1", "address 1", "address1", "street address", "street address 1", "addr1", "address line one", "house number", "house no", "flat no"],
    street2:  ["address line 2", "address 2", "address2", "addr2", "apartment", "apt", "suite", "unit", "address line two", "landmark"],
    city:     ["city", "town", "city town", "village"],
    state:    ["state", "province", "region", "state province"],
    zip:      ["zip", "zip code", "postal code", "pincode", "pin code", "postcode", "post code"],
    country:  ["country", "nation"],
    nationality: ["nationality", "citizenship"],
    email:    ["email", "e mail", "mail", "email address"],
    phonecc:  ["phone country code", "country code", "dialing code", "dial code", "isd code", "std code"],
    cellphone: ["cell phone", "cell", "mobile", "mobile number", "mobile phone", "cell number", "cellphone"],
    homephone: ["home phone", "landline", "home number", "residence phone", "home telephone"],
    phone:    ["phone", "telephone", "tel", "contact number", "phone number", "phone no", "contact no"],
    gender:   ["gender", "sex"],
    salutation: ["salutation", "title", "prefix", "honorific"],
    dob:      ["date of birth", "dob", "d o b", "birth date", "birthday", "born", "birthdate"],
    passport: ["passport", "passport no", "passport number"],
    passport_expiry: ["passport expiry date", "passport expiry", "passport expiration date", "passport expiration", "date of expiry", "expiry date", "expiration date", "expires", "valid until", "date of expiration", "expiry date of passport"],
    passport_issue:  ["passport issue date", "passport issuance date", "passport issuance", "date of issue", "issue date", "issuance date", "date of issuance", "issued on", "valid from", "passport valid from"],
    dl_expiry:       ["dl expiry date", "driver license expiry date", "drivers license expiry date", "driving licence expiry date", "license expiry date", "licence expiry date", "license expiry", "licence expiry", "dl expiry", "dl exp", "license expiration date", "driver license expiration", "licence expiration"],
    dl_issue:        ["dl issue date", "driver license issue date", "drivers license issue date", "driving licence issue date", "license issue date", "licence issue date", "license issue", "licence issue", "dl issue", "licence valid from", "license valid from"],
    organization: ["company", "company name", "organization", "organisation", "employer", "business name", "firm"],
    username: ["username", "user name", "login", "user id", "userid", "handle"],
    dependent_name: ["name of dependent", "dependent name", "dependant name", "nominee name", "nominee", "guardian name", "beneficiary name", "next of kin", "spouse name", "emergency contact name"],
    dependent_dob: ["dependent dob", "dependant dob", "dependent date of birth", "dependant date of birth"],
  };
  const rawVault = {};
  for (const [k, v] of Object.entries(vault)) rawVault[norm(k)] = v;
  const atoms = {};
  for (const [canon, al] of Object.entries(ALIASES)) {
    for (const key of Object.keys(rawVault)) {
      if (al.some((a) => key === norm(a))) { atoms[canon] = rawVault[key]; break; }
    }
  }
  // Prefix a bare phone number with the stored country code (unless it already has one).
  const withCC = (num) => {
    const n = (num || "").toString().trim();
    if (!n) return "";
    const cc = (atoms.phonecc || "").toString().trim();
    return cc && !n.startsWith("+") ? cc + " " + n : n;
  };
  // Atom value, with graceful fallbacks that don't hardcode a form.
  const atomVal = (key) => {
    if (key === "given")  return atoms.given ?? (atoms.full || "").split(/\s+/)[0];
    if (key === "family") return atoms.family ?? ((atoms.full || "").split(/\s+/).slice(-1)[0]);
    if (key === "nationality") return atoms.nationality ?? atoms.country;
    if (key === "cellphone") return withCC(atoms.cellphone);
    if (key === "homephone") return withCC(atoms.homephone);
    if (key === "phone")     return withCC(atoms.cellphone ?? atoms.phone ?? atoms.homephone);
    return atoms[key];
  };

  // 2) COMPOSITE concepts: a coarse field made of finer member atoms, joined in order.
  //    Its value excludes any member the form claims with a more-specific field.
  const COMPOSITES = {
    full:    { syn: ALIASES.full, members: ["given", "middle", "family"], sep: " ", name: true, fallback: () => atoms.full },
    address: { syn: ["address", "mailing address", "residential address", "postal address", "full address", "permanent address", "current address"], members: ["street1", "street2", "city", "state", "zip", "country"], sep: ", " },
  };

  // 3) The full concept list: every atom (except `full`, which is only a composite) as
  //    an atomic target, plus the two composites.
  const CONCEPTS = [];
  for (const [k, syn] of Object.entries(ALIASES)) {
    if (k === "full") continue;
    CONCEPTS.push({ key: k, syn, kind: "atom", name: ["given", "middle", "family"].includes(k) });
  }
  for (const [k, c] of Object.entries(COMPOSITES)) CONCEPTS.push({ key: k, syn: c.syn, kind: "composite", cmp: c, name: !!c.name });

  // Score how well a field label matches a concept: token overlap against each synonym
  // phrase; reward absolute matched tokens so a specific 2-word phrase ("first name")
  // beats a generic 1-word one ("name"), with a bonus for a whole-phrase match.
  const score = (label, syn) => {
    const lt = new Set(norm(label).split(" ").filter(Boolean));
    let best = 0;
    for (const phrase of syn) {
      const pt = norm(phrase).split(" ").filter(Boolean);
      if (!pt.length) continue;
      let hit = 0;
      for (const t of pt) if (lt.has(t)) hit++;
      const s = hit * (hit / pt.length) * (hit === pt.length ? 1.6 : 1);
      if (s > best) best = s;
    }
    return best;
  };

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
  const wantsInitial = (label, el) => /\binitial\b|\binit\b/.test(norm(label)) || el.maxLength === 1;

  const fields = [];
  let fi = 0; // index aligned with collectFillLabels() so tLabels[fi] is this field's translated label
  for (const el of document.querySelectorAll("input, textarea")) {
    if (["password", "hidden", "checkbox", "radio", "file", "submit", "button"].includes(el.type)) continue;
    if (el.disabled) continue; // readOnly fields ARE included (date pickers) — see setFieldValue
    const label = tLabels && tLabels[fi] ? tLabels[fi] : labelOf(el); // use the English-translated label if provided
    fi++;
    let pick = null, top = 0;
    for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
    if (!pick || top < 1.5) continue; // require a full-phrase match — avoids false fills
    fields.push({ el, label, pick });
  }

  // Which member atoms does the form claim with a dedicated (atomic) field? A composite
  // then absorbs only the members NOT claimed here.
  const claimed = new Set(fields.filter((f) => f.pick.kind === "atom").map((f) => f.pick.key));

  // Reformat a stored date (vault convention MM/DD/YYYY) to match what THIS field asks for.
  // Many forms state the order in the placeholder/label — "dd/mm/yyyy", "DD-MMM-YYYY" — and
  // <input type="date"> needs ISO. Honour it; non-date values pass through untouched.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parseVaultDate = (v) => {
    const m = String(v).match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (!m) return null;
    const a = +m[1], b = +m[2]; let y = m[3];
    const [month, day] = (a > 12 && b <= 12) ? [b, a] : [a, b]; // stored MM/DD; swap only if impossible
    if (day > 31 || month > 12) return null;
    if (y.length === 2) y = (+y > new Date().getFullYear() % 100 ? "19" : "20") + y;
    return { day, month, year: +y };
  };
  // Page-wide date order: forms usually state the required format ONCE (e.g. a DOB hint
  // "dd/mm/yyyy") and expect it for EVERY date field. Detect it from the whole page as a
  // fallback for fields (like Passport Expiry) whose own hint doesn't repeat the format.
  // Slash/dash/dot separators only (a space separator would match ordinary prose).
  const pageDateFmt = (() => {
    const hay = (document.body ? document.body.textContent : "").toLowerCase();
    const m = hay.match(/(d{1,2}|m{1,3}|y{2,4})([\/.\-])(d{1,2}|m{1,3}|y{2,4})\2(d{1,2}|m{1,3}|y{2,4})/);
    return m ? { tokens: [m[1], m[3], m[4]], sep: m[2] } : null;
  })();
  const detectDateFmt = (el, label) => {
    // Forms state the required order in various places: placeholder, label, a tooltip, an
    // aria-describedby hint, or a help/error line in the field's container ("Please enter
    // the date in dd/mm/yyyy"). Search all of them.
    const parts = [el.placeholder, label, el.getAttribute("title")];
    const db = el.getAttribute("aria-describedby");
    if (db) db.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) parts.push(n.textContent); });
    // The hint often sits in a sibling within the field's form-GROUP, not the input's
    // immediate wrapper — search a form-group-like ancestor (falls back a few levels up).
    const box = el.closest("[class*='form'], [class*='field'], [class*='group'], [class*='date'], fieldset, li, tr, section, td")
      || (el.parentElement && el.parentElement.parentElement) || el.parentElement;
    if (box) parts.push(box.textContent.slice(0, 500));
    const hay = parts.filter(Boolean).join(" ").toLowerCase();
    const m = hay.match(/(d{1,2}|m{1,3}|y{2,4})([\/.\- ])(d{1,2}|m{1,3}|y{2,4})\2(d{1,2}|m{1,3}|y{2,4})/);
    return m ? { tokens: [m[1], m[3], m[4]], sep: m[2] } : null;
  };
  const formatDateForField = (value, el, label) => {
    const dt = parseVaultDate(value);
    if (!dt) return value; // not a date — leave as-is
    const pad = (n, w) => String(n).padStart(w, "0");
    if (el.type === "date") return `${dt.year}-${pad(dt.month, 2)}-${pad(dt.day, 2)}`;
    const f = detectDateFmt(el, label) || pageDateFmt; // field hint, else the page-wide order
    if (f) return f.tokens.map((t) =>
      /^d/.test(t) ? pad(dt.day, t.length)
        : /^m{3}$/.test(t) ? MONTHS[dt.month - 1]
          : /^m/.test(t) ? pad(dt.month, t.length)
            : t.length === 2 ? String(dt.year).slice(-2) : String(dt.year)).join(f.sep);
    return `${pad(dt.month, 2)}/${pad(dt.day, 2)}/${dt.year}`; // default: US MM/DD/YYYY, 4-digit year
  };
  // Set a value in a way FRAMEWORKS honour: React/Angular ignore a plain `el.value =`, and
  // date pickers are often readOnly. Use the native value setter, briefly clear readOnly,
  // and fire a full event sequence.
  const setFieldValue = (el, value) => {
    const ro = el.readOnly; if (ro) el.readOnly = false;
    try { el.focus(); } catch (_) { /* ignore */ }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    for (const t of ["keydown", "keypress", "input", "keyup", "change", "blur"]) el.dispatchEvent(new Event(t, { bubbles: true }));
    if (ro) el.readOnly = ro;
    return true;
  };

  let filled = 0;
  for (const { el, label, pick } of fields) {
    let value;
    if (pick.kind === "composite") {
      const parts = pick.cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean);
      value = parts.length ? parts.join(pick.cmp.sep) : (pick.cmp.fallback ? pick.cmp.fallback() : "");
    } else {
      value = atomVal(pick.key);
    }
    if (!value) continue;
    if (pick.name && wantsInitial(label, el)) value = initial(value);
    value = formatDateForField(value, el, label); // adapt dates to the field's requested format
    if (setFieldValue(el, value)) filled++;
  }

  // Native <select> dropdowns / list boxes (e.g. "Current Nationality"): choose the option
  // whose text or value SEMANTICALLY matches the concept value ("Indian" -> "India").
  const nOpt = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const optEq = (a, b) => {
    const x = nOpt(a), y = nOpt(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    return s.length >= 3 && l.startsWith(s);
  };
  for (const sel of document.querySelectorAll("select")) {
    if (sel.disabled) continue;
    const label = labelOf(sel);
    let pick = null, top = 0;
    for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
    if (!pick || top < 1.5) continue;
    const value = pick.kind === "composite"
      ? (pick.cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean).join(pick.cmp.sep) || (pick.cmp.fallback ? pick.cmp.fallback() : ""))
      : atomVal(pick.key);
    if (!value) continue;
    // Candidate values to match an option against: the raw value plus expansions (a stored
    // gender "M" should match a "Male" option; "F" -> "Female").
    const cands = [value];
    const g = norm(value);
    if (pick.key === "gender") { if (g === "m" || g === "male") cands.push("male"); if (g === "f" || g === "female") cands.push("female"); }
    const opts = [...sel.options];
    const match = opts.find((o) => cands.some((cv) => optEq(o.textContent, cv) || optEq(o.value, cv)));
    if (match) {
      sel.value = match.value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
    }
  }

  // CUSTOM dropdowns (any framework — ng-select, mat-select, react-select, PrimeNG, or an
  // ARIA combobox). We don't target a specific site: we detect a widget that BEHAVES like a
  // chooser (standard roles / common widget roots), open it, then click the option whose
  // VISIBLE TEXT matches the value. Only widgets that resolve to a concept + have a value are
  // opened, so unrelated menus are never touched.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const hosts = [...document.querySelectorAll(
    'ng-select, mat-select, [role="combobox"], [aria-haspopup="listbox"], [class*="ng-select"], [class*="mat-select"], [class*="react-select"], [class*="dropdown-toggle"], [class*="ant-select"], [class*="p-dropdown"]',
  )].filter((h) => h.tagName !== "SELECT" && !h.closest("select"));
  const seen = new Set();
  for (const h of hosts) {
    if (seen.has(h) || [...seen].some((s) => s.contains(h) || h.contains(s))) continue;
    seen.add(h);
    let pick = null, top = 0;
    const label = labelOf(h);
    for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
    if (!pick || top < 1.5) continue;
    const value = pick.kind === "composite"
      ? (pick.cmp.members.filter((m) => !claimed.has(m)).map(atomVal).filter(Boolean).join(pick.cmp.sep) || (pick.cmp.fallback ? pick.cmp.fallback() : ""))
      : atomVal(pick.key);
    if (!value) continue;
    const cands = [value]; const g = norm(value);
    if (pick.key === "gender") { if (g === "m" || g === "male") cands.push("male"); if (g === "f" || g === "female") cands.push("female"); }
    try {
      const opener = h.querySelector('input, [role="combobox"], [class*="control"], [class*="selection"], [class*="toggle"], [class*="trigger"]') || h;
      opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      opener.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      if (opener.click) opener.click();
      opener.focus && opener.focus();
      await wait(200); // let the option list render (overlays may attach to <body>)
      const opts = [...document.querySelectorAll(
        '[role="option"], .ng-option, mat-option, .ant-select-item-option, .p-dropdown-item, li[role="option"], [class*="option"]:not([class*="options"]), [class*="dropdown-item"], [class*="menu-item"]',
      )].filter((o) => o.offsetParent !== null && (o.textContent || "").trim());
      const opt = opts.find((o) => cands.some((cv) => optEq(o.textContent.trim(), cv)))
        || opts.find((o) => cands.some((cv) => optEq((o.textContent || "").trim().split(/\n|\s{2,}/)[0], cv)));
      if (opt) {
        opt.scrollIntoView && opt.scrollIntoView({ block: "nearest" });
        opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        if (opt.click) opt.click();
        filled++;
        await wait(80);
      } else {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        opener.blur && opener.blur();
      }
    } catch (_) { /* leave this widget alone on any error */ }
  }
  return filled;
}

refresh();
