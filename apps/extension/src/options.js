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
        rp: { name: "ProjectPDFs Autofill" }, // extension origin is the effective RP
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: "projectpdfs-vault",
          displayName: "ProjectPDFs Vault",
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
      rp: { name: "ProjectPDFs Autofill" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "projectpdfs-vault",
        displayName: "ProjectPDFs Vault",
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

status();
