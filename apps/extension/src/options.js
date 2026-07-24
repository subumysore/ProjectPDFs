// Passkey enrolment. Creates a WebAuthn credential with the PRF extension enabled,
// stores its id, and marks the vault KDF as webauthn-prf. The actual PRF secret is
// obtained at UNLOCK time (popup → navigator.credentials.get), never stored.
const $ = (id) => document.getElementById(id);
function setMsg(text, ok = true) {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

async function status() {
  const { credId, kdf, blob } = await chrome.storage.local.get(["credId", "kdf", "blob"]);
  $("status").innerHTML =
    `Passkey enrolled: <b>${credId ? "yes" : "no"}</b> · KDF: <b>${kdf || "passphrase (default)"}</b> · ` +
    `Vault created: <b>${blob ? "yes" : "no"}</b>`;
}

$("enrol").onclick = async () => {
  try {
    const { blob, kdf } = await chrome.storage.local.get(["blob", "kdf"]);
    if (blob && kdf !== "webauthn-prf") {
      setMsg(
        "A passphrase vault already exists. Migrating it to a passkey isn't wired yet — start from an empty vault (remove it) to enrol a passkey.",
        false,
      );
      return;
    }
    setMsg("Follow your authenticator's prompt…");
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "PolyglotFormFill Autofill" }, // extension origin is the effective RP
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: "projectpdfs-vault",
          displayName: "PolyglotFormFill Vault",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
        extensions: { prf: {} },
      },
    });
    const ext = cred.getClientExtensionResults();
    const prfSupported = ext && ext.prf && ext.prf.enabled;
    const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    await chrome.storage.local.set({ credId, kdf: "webauthn-prf" });
    if (prfSupported) {
      setMsg("Passkey enrolled and PRF supported. Unlock with 'Unlock with passkey' in the popup.");
    } else {
      setMsg(
        "Passkey enrolled, but this authenticator didn't confirm PRF support. Unlock may fall back to a passphrase.",
        false,
      );
    }
    status();
  } catch (e) {
    setMsg("Enrolment cancelled/failed: " + ((e && e.message) || e), false);
  }
};

// Enrol a passkey and obtain its PRF secret (create → get), returning {credId, prfSecret}.
async function enrolAndGetPrf() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "PolyglotFormFill Autofill" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "projectpdfs-vault",
        displayName: "PolyglotFormFill Vault",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      extensions: { prf: {} },
    },
  });
  const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  const rawId = new Uint8Array(cred.rawId);
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: rawId, type: "public-key" }],
      userVerification: "required",
      extensions: { prf: { eval: { first: new TextEncoder().encode("projectpdfs-vault") } } },
    },
  });
  const prf = assertion.getClientExtensionResults().prf;
  if (!prf || !prf.results || !prf.results.first) throw new Error("authenticator has no PRF support");
  const prfSecret = btoa(String.fromCharCode(...new Uint8Array(prf.results.first)));
  return { credId, prfSecret };
}

$("migrate").onclick = async () => {
  try {
    const s = await chrome.runtime.sendMessage({ type: "status" });
    if (!s || !s.ok || !s.unlocked) {
      setMsg("Unlock the vault first (open the popup, enter your passphrase), then migrate.", false);
      return;
    }
    setMsg("Enrol the passkey when prompted…");
    const { credId, prfSecret } = await enrolAndGetPrf();
    const r = await chrome.runtime.sendMessage({ type: "migrateToPasskey", credId, prfSecret });
    if (r && r.ok) {
      setMsg("Migrated: your vault is now unlocked by the passkey.");
      status();
    } else setMsg((r && r.error) || "Migration failed", false);
  } catch (e) {
    setMsg("Migration cancelled/failed: " + ((e && e.message) || e), false);
  }
};

// ---- Base language ----
async function renderBaseLang() {
  const { baseLang } = await chrome.storage.local.get(["baseLang"]);
  $("baseLang").value = baseLang || "en";
}
$("baseLang").onchange = async () => {
  await chrome.storage.local.set({ baseLang: $("baseLang").value });
  const el = $("baseLangMsg");
  el.className = "msg ok";
  el.textContent = `Base language set to ${$("baseLang").options[$("baseLang").selectedIndex].text}. Install its language pack below to enable on-device translation.`;
};

// ---- Single vault / desktop-app companion mode ----
function setCompMsg(text, ok = true) {
  const el = $("companionMsg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

// Single vault is AUTOMATIC — there is nothing to switch on. This panel just reports whether
// the desktop app is detected and, when it is, lets you choose which shared profile to use.
async function renderCompanion() {
  const box = $("companionProfiles");
  const ping = await chrome.runtime.sendMessage({ type: "companionPing" });
  const on = !!(ping && ping.ok);
  const cb = $("companionMode");
  if (cb) { cb.checked = on; cb.disabled = true; } // informational only — the behavior is automatic
  if (!on) {
    setCompMsg(
      "Desktop app not detected — this browser is using its own vault. Install and run the desktop app and the two will automatically share ONE vault (no setup, no toggle).",
      true,
    );
    box.textContent = "";
    return;
  }
  setCompMsg("✓ One shared vault — this browser and the desktop app use the same vault automatically.");
  const pl = await chrome.runtime.sendMessage({ type: "companionProfiles" });
  if (!pl || !pl.ok || !pl.profiles || !pl.profiles.length) { box.textContent = ""; return; }
  const { companionProfile } = await chrome.storage.local.get("companionProfile");
  const active = companionProfile || pl.profiles[0].id;
  if (!companionProfile) await chrome.storage.local.set({ companionProfile: active });
  const opts = pl.profiles
    .map((p) => `<option value="${p.id}" ${p.id === active ? "selected" : ""}>${p.name || p.id}</option>`)
    .join("");
  box.innerHTML = `Profile (shared with the desktop app): <select id="companionProfileSel">${opts}</select>`;
  const sel = $("companionProfileSel");
  sel.onchange = async () => {
    // An EXPLICIT choice: mark it so it STAYS selected until the user changes it here again — the
    // auto "profile with the most data" pick never overrides a profile the user deliberately chose.
    await chrome.storage.local.set({ companionProfile: sel.value, companionProfileExplicit: true });
    setCompMsg("Profile selected — it stays until you change it here.");
  };
}

// ---- Translation languages (download at will; nothing bundled) ----
const LANGS = [
  { code: "hi", name: "हिन्दी (Hindi)" },
  { code: "es", name: "Español (Spanish)" },
  { code: "fr", name: "Français (French)" },
  { code: "de", name: "Deutsch (German)" },
  { code: "zh", name: "中文 (Chinese)" },
  { code: "ar", name: "العربية (Arabic)" },
  { code: "ru", name: "Русский (Russian)" },
];
// Guess the region's language from the OS locale/timezone (on-device, no network).
function localeLang() {
  try {
    const r = (new Intl.Locale(navigator.language).region || "").toUpperCase();
    const byRegion = { IN: "hi", ES: "es", MX: "es", AR: "es", FR: "fr", DE: "de", AT: "de", CH: "de", CN: "zh", TW: "zh", SA: "ar", AE: "ar", EG: "ar", RU: "ru" };
    if (byRegion[r]) return byRegion[r];
    const l = (navigator.language || "").slice(0, 2).toLowerCase();
    if (LANGS.some((x) => x.code === l)) return l;
  } catch (_) { /* ignore */ }
  return "";
}

async function renderLanguages() {
  const { baseLang } = await chrome.storage.local.get(["baseLang"]);
  const suggest = new Set([baseLang, localeLang()].filter((c) => c && c !== "en"));
  $("langSuggest").innerHTML = suggest.size
    ? `Suggested for you: <b>${[...suggest].map((c) => (LANGS.find((l) => l.code === c) || {}).name || c).join(", ")}</b> (your base language / region).`
    : "";
  const box = $("langList");
  box.textContent = "";
  for (const { code, name } of LANGS) {
    const row = document.createElement("div");
    row.className = "pack";
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.innerHTML = `${name} <small>· English ↔ ${code} · ~220 MB</small>` + (suggest.has(code) ? ' <span class="badge">suggested</span>' : "");
    const btn = document.createElement("button");
    btn.textContent = "Download";
    btn.onclick = async () => {
      btn.disabled = true;
      setLangMsg(`Downloading ${name} — first time only, then cached…`);
      try {
        const { translate } = await import("./translate.js");
        await translate("hello", `en-${code}`, (s) => setLangMsg(`${name}: ${s}`));
        await translate("hello", `${code}-en`, (s) => setLangMsg(`${name}: ${s}`));
        setLangMsg(`✓ ${name} ready — works offline now.`);
        btn.textContent = "Downloaded ✓";
      } catch (e) {
        setLangMsg(`Download failed for ${name}: ${(e && e.message) || e}`, false);
        btn.disabled = false;
      }
    };
    row.append(lbl, btn);
    box.appendChild(row);
  }
}
function setLangMsg(text, ok = true) {
  const el = $("langMsg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

renderBaseLang();
renderCompanion();
renderLanguages();
status();
