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
  const keys = Object.keys(r.vault || {});
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
    // Editable value — type directly and it saves on Enter or when you click away.
    const vEl = document.createElement("input");
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
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "✕";
    x.title = "Delete";
    x.onclick = async () => {
      if (COMP.on) await send({ type: "companionDelete", profileId: await compProfile(), key: k });
      else await send({ type: "del", key: k });
      renderEntries();
    };
    row.append(kEl, vEl, x);
    box.appendChild(row);
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

async function fillActivePage(vault) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillPage,
    args: [vault],
  });
  return result || 0;
}

$("fill").onclick = async () => {
  const r = await readVault();
  if (!r.ok) return setMsg(r.error || "Locked", false);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  // A PDF open in the browser? Fill it on-device with pdf-lib and download the result.
  if (/\.pdf(\?|#|$)/i.test(url)) {
    setMsg("Reading the PDF…");
    // Fetch the PDF bytes in the BACKGROUND service worker (robust — not tied to the popup).
    const fetched = await send({ type: "fetchBytes", url });
    if (!fetched || !fetched.ok) return setMsg("Couldn't read the PDF (" + ((fetched && fetched.error) || "no response") + "). Reload the page and try again.", false);
    try {
      const bytes = Uint8Array.from(atob(fetched.b64), (c) => c.charCodeAt(0));
      // Name the download after the original file: Sample-Fillable-PDF.pdf -> Sample-Fillable-PDF-filled.pdf
      const base = (url.split("?")[0].split("#")[0].split("/").pop() || "form.pdf").replace(/\.pdf$/i, "");
      const acro = await fillPdfBytes(bytes, r.vault);
      // Trust the AcroForm layer only when it's a real, non-XFA form that actually
      // filled. XFA/LiveCycle hybrids (W-2/W-4/W-9) expose an unreliable AcroForm
      // shadow — OCR reads their true printed labels instead.
      if (acro.filled && acro.bytes && !acro.xfa) {
        // Fast path: matched by AcroForm field names. Show the result in the viewer.
        let bin = "";
        for (let i = 0; i < acro.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, acro.bytes.subarray(i, i + 0x8000));
        await chrome.storage.session.set({ ppf_filled: btoa(bin), ppf_name: `${base}-filled.pdf` });
        await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("viewer.html") });
        return setMsg(`Filled ${acro.filled} of ${acro.total} field(s) via form fields — showing your filled PDF. ✓`);
      }
      // OCR path (XFA/LiveCycle like the IRS W-2, scanned, or unlabeled). Hand the
      // SOURCE bytes + vault to the VIEWER TAB, which runs the OCR there — a closing
      // popup can no longer interrupt it (OCR can take several seconds per page). The
      // decrypted vault sits in ephemeral session storage only and is removed the
      // moment the viewer has read it.
      await chrome.storage.session.set({
        ppf_src: fetched.b64,
        ppf_vault: r.vault,
        ppf_name: `${base}-filled.pdf`,
        ppf_mode: "ocr",
        ppf_xfa: !!acro.xfa,
      });
      await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("viewer.html") });
      return setMsg("Reading the form with OCR in the opened tab — watch the progress there. ✓");
    } catch (e) {
      return setMsg("PDF fill failed: " + ((e && e.message) || e), false);
    }
  }
  setMsg(`Filled ${await fillActivePage(r.vault)} field(s) on this page${COMP.on ? " (desktop vault)" : ""}.`);
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
function fillPage(vault, tLabels) {
  const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
    dob:      ["date of birth", "dob", "birth date", "birthday", "born"],
    passport: ["passport", "passport no", "passport number"],
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

  const labelOf = (el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
    (el.labels && el.labels[0] && el.labels[0].textContent) || "",
    (el.closest("label") && el.closest("label").textContent) || ""].join(" ");
  const wantsInitial = (label, el) => /\binitial\b|\binit\b/.test(norm(label)) || el.maxLength === 1;

  const fields = [];
  let fi = 0; // index aligned with collectFillLabels() so tLabels[fi] is this field's translated label
  for (const el of document.querySelectorAll("input, textarea")) {
    if (["password", "hidden", "checkbox", "radio", "file", "submit", "button"].includes(el.type)) continue;
    if (el.disabled || el.readOnly) continue;
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
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    filled++;
  }
  return filled;
}

refresh();
