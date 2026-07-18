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
  if (unlocked) $("keys").textContent = s.keys.length ? `Remembered: ${s.keys.join(", ")}` : "Vault is empty.";
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

$("lock").onclick = async () => {
  await send({ type: "lock" });
  setMsg("Locked.");
  refresh();
};

$("fill").onclick = async () => {
  const r = await send({ type: "getVault" });
  if (!r.ok) return setMsg(r.error || "Locked", false);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillPage,
    args: [r.vault],
  });
  setMsg(`Filled ${result || 0} field(s) on this page.`);
};

// Injected into the page. Self-contained: maps each form field to an ontology key
// and fills it from the vault. Runs in the page, reads only the DOM, sends nothing out.
function fillPage(vault) {
  const HINTS = [
    [/full.?name|^name$/i, "full_name"],
    [/date.?of.?birth|dob|birth/i, "date_of_birth"],
    [/nationalit/i, "nationality"],
    [/passport/i, "passport_no"],
    [/phone|mobile|tel/i, "phone"],
    [/e.?mail/i, "email"],
    [/address/i, "address"],
  ];
  const keyFor = (el) => {
    const hay = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), (el.labels && el.labels[0] && el.labels[0].textContent) || ""].join(" ").toLowerCase();
    const norm = hay.replace(/[^a-z0-9]+/g, "_");
    if (vault[norm] !== undefined) return norm;
    for (const [re, k] of HINTS) if (re.test(hay) && vault[k] !== undefined) return k;
    return null;
  };
  let filled = 0;
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (el.type === "password" || el.type === "hidden" || el.disabled) continue;
    const k = keyFor(el);
    if (!k) continue;
    el.value = vault[k];
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    filled++;
  }
  return filled;
}

refresh();
