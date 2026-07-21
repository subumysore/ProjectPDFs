// Popup UI: unlock (passphrase / passkey), fill the active page, lock.
// Single-source-of-truth: when "desktop vault mode" is on, the popup reads AND writes
// through the native companion, so the ONE desktop vault is authoritative — the
// extension keeps no separate copy.
import { exportVault, importVault } from "./backup.js";
import { fillPdfBytes } from "./pdffill.js";
import { fillPage } from "./pagefill.js";
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

// ---- Handwrite a signature on the pad → saved as the "signature" image, drawn into any
// signature box on a form (reuses the image-field pipeline). Pointer + touch.
if ($("sigPad")) {
  const pad = $("sigPad");
  const ctx = pad.getContext("2d");
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#101a20";
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

refresh();
