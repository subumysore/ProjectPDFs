# PolyglotFormFill Autofill — browser extension (MV3)

Privacy-first form autofill as a browser extension, with **security built in**. The
vault is AES-256-GCM encrypted on-device; the key is derived on unlock and never
stored. See RFC-0004 / ADR-0014 for the architecture decision.

## Security model

- **Data stays on device.** The vault lives in `chrome.storage.local` (never
  `storage.sync`), so it is not cloud-synced. Only **salt + ciphertext** are stored —
  never the key, never plaintext.
- **Key at rest — two unlock paths** (`src/vault.js`, unit-tested):
  1. **Passphrase** → PBKDF2-SHA256 (600k iters) → non-extractable AES-GCM key.
  2. **WebAuthn PRF (passkey)** → a per-credential secret that only materialises when
     the user's **hardware authenticator** is present and they gesture → HKDF → AES-GCM
     key. Hardware-backed: a silently-swapped extension update **cannot** decrypt
     without the physical authenticator.
- **Key lives only in the service-worker's memory** while unlocked, and is dropped on
  lock/idle. The page never sees the key; the popup never sees it.
- **No remote code** (enforced by MV3) and a strict CSP (`script-src 'self'
  'wasm-unsafe-eval'`), mirroring the native app's execution-only policy.
- **Least privilege:** `activeTab` + `scripting` (fill only the page you're on, on your
  click) — no always-on `<all_urls>` content script.

## The irreducible gap (and how we shrink it)

A store extension **auto-updates code from Google/Mozilla** — the store is in the trust
path (the reason ADR-0002 chose native). We cannot fully remove this, but we shrink it:

1. **WebAuthn-PRF unlock** — even a malicious update can't decrypt the vault without the
   user's hardware passkey present. This is the strongest single mitigation.
2. **Companion mode (recommended)** — pair with the native app: the extension is a thin
   autofill client and the **native app holds the vault + keys + signing** over
   native-messaging. The sensitive material never lives in store-served code.
3. **Reproducible builds + published hashes** — so the store artifact can be verified
   against source.
4. **Self-hosted / enterprise distribution** — ship unlisted or force-installed by
   policy to avoid the public auto-update channel.
5. **No egress surface** — no analytics, minimal permissions, CSP `connect-src 'self'`.

## Load it (unpacked, dev)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this
   `apps/extension` folder. (Add a 128px `icon128.png` first, or remove the `icons`
   key from `manifest.json`.)
2. Click the toolbar icon → set a passphrase → **Unlock** (first unlock creates the
   vault) → open a web form → **Fill this page**.

## Test

```
node --test apps/extension/src/vault.test.mjs
```

## Status

Scaffold: vault crypto (tested), MV3 manifest, background service worker, popup
(passphrase + passkey unlock, fill/lock), page autofill. **Next:** passkey enrolment UI,
native-messaging companion bridge, and reuse of the app's OCR/PDF/Office engines.
