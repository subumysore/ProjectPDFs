// Passkey enrolment. Creates a WebAuthn credential with the PRF extension enabled,
// stores its id, and marks the vault KDF as webauthn-prf. The actual PRF secret is
// obtained at UNLOCK time (popup → navigator.credentials.get), never stored.
import * as packs from "./langpacks.js";
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

// ---- Single vault / desktop-app companion mode ----
function setCompMsg(text, ok = true) {
  const el = $("companionMsg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

async function renderCompanion() {
  const { companionMode, companionProfile } = await chrome.storage.local.get(["companionMode", "companionProfile"]);
  $("companionMode").checked = !!companionMode;
  const box = $("companionProfiles");
  if (!companionMode) { box.textContent = ""; return; }
  const pl = await chrome.runtime.sendMessage({ type: "companionProfiles" });
  if (!pl || !pl.ok) {
    box.innerHTML = `<span class="err">Desktop companion unavailable: ${(pl && pl.error) || "not registered"}.</span>`;
    return;
  }
  if (!pl.profiles || !pl.profiles.length) {
    box.innerHTML = `<span class="err">No profiles in the desktop app yet — create one there first.</span>`;
    return;
  }
  const opts = pl.profiles
    .map((p) => `<option value="${p.id}" ${p.id === companionProfile ? "selected" : ""}>${p.name || p.id}</option>`)
    .join("");
  box.innerHTML = `Write to profile: <select id="companionProfileSel">${opts}</select>`;
  const sel = $("companionProfileSel");
  if (!companionProfile) await chrome.storage.local.set({ companionProfile: pl.profiles[0].id });
  sel.onchange = async () => { await chrome.storage.local.set({ companionProfile: sel.value }); setCompMsg("Profile set."); };
}

$("companionMode").onchange = async () => {
  const on = $("companionMode").checked;
  await chrome.storage.local.set({ companionMode: on });
  setCompMsg(on ? "Desktop vault mode ON — the popup now reads/writes the desktop app vault." : "Desktop vault mode off — using the extension's own vault.");
  renderCompanion();
};

// ---- Language packs (RFC-0006 Phase 1) ----
const fmtMB = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
function setPacksMsg(text, ok = true) {
  const el = $("packsMsg");
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}

async function renderPacks() {
  const box = $("packs");
  let available = [];
  try {
    available = await packs.listAvailable();
  } catch (e) {
    box.textContent = "Couldn't load the pack list (offline?). " + ((e && e.message) || e);
    return;
  }
  const installed = await packs.listInstalled();
  const isInstalled = (id) => installed.some((p) => p.id === id);
  box.textContent = "";
  if (!available.length) box.textContent = "No language packs published yet.";
  for (const p of available) {
    const row = document.createElement("div");
    row.className = "pack";
    const lbl = document.createElement("div");
    lbl.className = "lbl";
    lbl.innerHTML = `${p.label || p.id} <small>· ${fmtMB(p.size || 0)}</small>`;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.display = "none";
    const fill = document.createElement("i");
    bar.appendChild(fill);
    lbl.appendChild(bar);

    const btn = document.createElement("button");
    row.append(lbl, btn);

    if (isInstalled(p.id)) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "installed";
      row.insertBefore(badge, btn);
      btn.textContent = "Remove";
      btn.className = "rm";
      btn.onclick = async () => {
        btn.disabled = true;
        await packs.remove(p.id);
        setPacksMsg(`Removed ${p.label || p.id} — space freed.`);
        renderPacks();
      };
    } else {
      btn.textContent = "Install";
      btn.onclick = async () => {
        btn.disabled = true;
        bar.style.display = "block";
        setPacksMsg(`Downloading ${p.label || p.id}…`);
        try {
          await packs.install(p, (recv, total) => {
            fill.style.width = total ? Math.round((recv / total) * 100) + "%" : "100%";
          });
          setPacksMsg(`Installed ${p.label || p.id}.`);
        } catch (e) {
          setPacksMsg(`Install failed: ${(e && e.message) || e}`, false);
        }
        renderPacks();
      };
    }
  }
  const used = await packs.usageBytes();
  $("packsUsage").innerHTML = `Installed: <b>${installed.length}</b> pack(s) · Disk used: <b>${fmtMB(used)}</b>`;
}

renderCompanion();
renderPacks();
status();
