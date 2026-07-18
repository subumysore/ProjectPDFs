// Popup UI: unlock (passphrase / passkey), fill the active page, lock.
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
function setMsg(text, ok = true) {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

async function refresh() {
  const s = await send({ type: "status" });
  const unlocked = s && s.ok && s.unlocked;
  $("locked").classList.toggle("hidden", unlocked);
  $("unlocked").classList.toggle("hidden", !unlocked);
  if (unlocked) await renderEntries();
}

// Show every saved field with its value + a delete button.
async function renderEntries() {
  const r = await send({ type: "getVault" });
  const box = $("entries");
  box.textContent = "";
  const keys = r.ok ? Object.keys(r.vault) : [];
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
    const vEl = document.createElement("span");
    vEl.className = "v";
    vEl.textContent = r.vault[k];
    vEl.title = r.vault[k];
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "✕";
    x.title = "Delete";
    x.onclick = async () => {
      await send({ type: "del", key: k });
      renderEntries();
    };
    row.append(kEl, vEl, x);
    box.appendChild(row);
  }
}

// Add / update a field.
async function addField() {
  const key = $("newKey").value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const value = $("newVal").value;
  if (!key) return setMsg("Enter a field name (e.g. full_name).", false);
  const r = await send({ type: "set", key, value });
  if (!r.ok) return setMsg(r.error || "Locked", false);
  $("newKey").value = "";
  $("newVal").value = "";
  setMsg(`Saved “${key}”.`);
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
  const r = await send({ type: "getVault" });
  if (!r.ok) return setMsg(r.error || "Locked", false);
  setMsg(`Filled ${await fillActivePage(r.vault)} field(s) on this page.`);
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
// the value from your atomic vault facts (compose a full name from parts, reduce a
// name to an initial when the form asks for one). Runs in the page, reads only the
// DOM, sends nothing out.
function fillPage(vault) {
  const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const initial = (s) => { const m = (s || "").trim().match(/\p{L}/u); return m ? m[0].toUpperCase() : ""; };

  // 1) Canonical "atoms" <- the many ways a user might have named a key.
  //    General knowledge, applied to every form — not a rule for a specific form.
  const ALIASES = {
    given:    ["given name", "given", "first name", "first", "forename", "fname", "christian name"],
    middle:   ["middle name", "middle", "mname", "middle names", "middle initial", "mi", "m i"],
    family:   ["family name", "last name", "last", "surname", "lname", "family"],
    full:     ["full name", "name", "complete name", "legal name", "applicant name", "your name"],
    email:    ["email", "e mail", "mail", "email address"],
    phone:    ["phone", "mobile", "telephone", "tel", "cell", "contact number", "phone number", "msisdn"],
    dob:      ["date of birth", "dob", "birth date", "birthday", "born"],
    address:  ["address", "street address", "residential address", "addr", "street"],
    city:     ["city", "town"],
    state:    ["state", "province", "region"],
    zip:      ["zip", "zip code", "postal code", "pincode", "pin code", "postcode"],
    country:  ["country", "nation"],
    nationality: ["nationality", "citizenship"],
    passport: ["passport", "passport no", "passport number"],
  };
  const rawVault = {};
  for (const [k, v] of Object.entries(vault)) rawVault[norm(k)] = v;
  const atoms = {};
  for (const [canon, al] of Object.entries(ALIASES)) {
    for (const key of Object.keys(rawVault)) {
      if (al.some((a) => key === norm(a))) { atoms[canon] = rawVault[key]; break; }
    }
  }
  const nameParts = [atoms.given, atoms.middle, atoms.family].filter(Boolean);

  // 2) Concepts a form field can ask for, and how to DERIVE the value from atoms.
  const CONCEPTS = [
    { key: "full",        syn: ALIASES.full,        val: () => (nameParts.length ? nameParts.join(" ") : atoms.full), name: true },
    { key: "given",       syn: ALIASES.given,       val: () => atoms.given ?? (atoms.full || "").split(/\s+/)[0], name: true },
    { key: "middle",      syn: ALIASES.middle,      val: () => atoms.middle, name: true },
    { key: "family",      syn: ALIASES.family,      val: () => atoms.family ?? (atoms.full || "").split(/\s+/).slice(-1)[0], name: true },
    { key: "email",       syn: ALIASES.email,       val: () => atoms.email },
    { key: "phone",       syn: ALIASES.phone,       val: () => atoms.phone },
    { key: "dob",         syn: ALIASES.dob,         val: () => atoms.dob },
    { key: "address",     syn: ALIASES.address,     val: () => atoms.address },
    { key: "city",        syn: ALIASES.city,        val: () => atoms.city },
    { key: "state",       syn: ALIASES.state,       val: () => atoms.state },
    { key: "zip",         syn: ALIASES.zip,         val: () => atoms.zip },
    { key: "country",     syn: ALIASES.country,     val: () => atoms.country },
    { key: "nationality", syn: ALIASES.nationality, val: () => atoms.nationality ?? atoms.country },
    { key: "passport",    syn: ALIASES.passport,    val: () => atoms.passport },
    // Concepts we usually have NO personal atom for: matching one out-scores the
    // generic "name" concept, so an org/username field is skipped instead of being
    // wrongly filled with the person's name (unless the user saved such a value).
    { key: "organization", syn: ["company", "company name", "organization", "organisation", "employer", "business name", "firm"], val: () => rawVault["organization"] ?? rawVault["company"] ?? rawVault["employer"] },
    { key: "username",     syn: ["username", "user name", "login", "user id", "userid", "handle"], val: () => rawVault["username"] },
  ];

  // Score how well a field label matches a concept: token overlap against each
  // synonym phrase, with a bonus when a whole phrase is matched (so "middle" beats
  // the single shared token "name" for a "middle name" box).
  const score = (label, syn) => {
    const lt = new Set(norm(label).split(" ").filter(Boolean));
    let best = 0;
    for (const phrase of syn) {
      const pt = norm(phrase).split(" ").filter(Boolean);
      if (!pt.length) continue;
      let hit = 0;
      for (const t of pt) if (lt.has(t)) hit++;
      // reward absolute matched tokens so a specific 2-word phrase ("first name")
      // beats a generic 1-word one ("name"); bonus when the whole phrase matches.
      const s = hit * (hit / pt.length) * (hit === pt.length ? 1.6 : 1);
      if (s > best) best = s;
    }
    return best;
  };

  const labelOf = (el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
    (el.labels && el.labels[0] && el.labels[0].textContent) || "",
    (el.closest("label") && el.closest("label").textContent) || ""].join(" ");

  // The form itself tells us to reduce a name to an initial: the word "initial",
  // or a one-character field. No value is hardcoded — the transform is general.
  const wantsInitial = (label, el) => /\binitial\b|\binit\b/.test(norm(label)) || el.maxLength === 1;

  let filled = 0;
  for (const el of document.querySelectorAll("input, textarea")) {
    if (["password", "hidden", "checkbox", "radio", "file", "submit", "button"].includes(el.type)) continue;
    if (el.disabled || el.readOnly) continue;
    const label = labelOf(el);
    let pick = null, top = 0;
    for (const c of CONCEPTS) { const s = score(label, c.syn); if (s > top) { top = s; pick = c; } }
    if (!pick || top < 1.5) continue; // require a full-phrase match — avoids false fills
    let value = pick.val();
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
