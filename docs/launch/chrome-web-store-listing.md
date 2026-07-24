# Chrome Web Store — listing & review content (copy-paste)

Everything the Developer Dashboard asks for, pre-written for PolyglotFormFill. Paste each
field into the matching box. Keep the manifest `key` handling in mind (see bottom).

## Store listing

- **Item name:** PolyglotFormFill Autofill
- **Category:** Productivity
- **Language:** English (add others later)
- **Summary (≤132 chars):**
  Privacy-first form autofill & on-device translation. Your encrypted profile never leaves your device.

- **Detailed description:**
  PolyglotFormFill fills web forms and PDFs from a private profile that is encrypted and stored
  ONLY on your device — unlocked by a passphrase or a passkey (WebAuthn). Nothing you enter is
  ever sent to us or any third party.

  • On-device autofill — one click completes a form using your saved details, matched by meaning
    (a "Given name" box gets your first name, an "Address" line is composed from its parts).
  • PDF forms — fill AcroForm PDFs on-device; unfilled fields stay editable.
  • Read any form in YOUR language — on-device translation of a form's labels and the values that
    will fill them (Hindi, Spanish, French, German, Chinese, Arabic, Russian, English). Names and
    numbers are transliterated into your script, never mistranslated.
  • Scan an ID / document — use your camera or an image to capture details (all OCR runs on-device).
  • Encrypted backup/transfer — move your profile between devices with a passphrase you choose.

  Privacy is the product: every operation — autofill, OCR, translation, PDF fill — runs on your
  device. Our servers only serve downloadable assets (fonts, language models); they never receive
  your content. No analytics, no tracking, no content telemetry.

  ▶ Watch the 5-minute walkthrough: https://polyglotformfill.mooo.com/download/guide.mp4

- **Promotional video (LEAVE BLANK — deliberately):** The field only accepts a YouTube URL, and
  Google locks API-uploaded videos to private on an unverified project — so we do NOT maintain a
  YouTube copy. The walkthrough is self-hosted (link in the description above, and a permanent URL:
  `https://polyglotformfill.mooo.com/download/guide.mp4`). Leaving this optional field empty is
  normal and expected; the screenshots below carry the visual story. If a public YouTube presence is
  ever wanted, upload manually in YouTube Studio and paste the long `https://www.youtube.com/watch?v=<id>`
  form here (it rejects `youtu.be/…`).

- **Screenshots (need 1–5; 1280×800 or 640×400 PNG):**
  Ready in `docs/guide/output/screenshots/` — good picks:
  `w3-extension-webform.png` (one-click fill), `03-id-capture.png`, `06-one-click-fill.png`,
  `w1-website-kannada.png` (languages), `09-profiles.png`.
  1. Popup: unlocked vault with saved fields.
  2. A web form being filled in one click.
  3. The filled-PDF viewer.
  4. The bilingual "read this form in your language" panel (label + value in Hindi).
  5. Scan ID / document screen.
- **Store icon:** 128×128 (icon128.png — already in the package).
- **Small promo tile (optional):** 440×280.

## Privacy practices tab

- **Single purpose (required):**
  Fill web forms and PDFs from a private, on-device encrypted profile, with optional on-device
  translation of form labels/values into the user's language.

- **Permission justifications (one per requested permission):**
  - **storage** — Store the user's encrypted profile (the "vault") and settings locally on the
    device. No remote storage.
  - **activeTab** — Read and fill the form on the page the user is actively on, only when they
    click "Fill this page."
  - **scripting** — Inject the on-device fill/translate logic into the current page on user action
    to complete its form fields. No code is fetched remotely.
  - **downloads** — Save the completed PDF to the user's computer when they choose to download it.
  - **nativeMessaging** — Optional: connect to the user's own PolyglotFormFill desktop app over a
    local bridge so the extension can use that app's vault. Keys never enter the extension. Used
    only if the user installs the companion app.
  - **host permissions `<all_urls>`** — Forms can appear on any website, so the extension must be
    able to read and fill the page the user explicitly asks to fill. It acts only on user action,
    processes everything on-device, and sends no page content anywhere.

- **Data usage declarations (Data collected):**
  - Select **"This item does NOT collect or use user data"** is NOT accurate because the extension
    handles personal info locally — instead declare the personal info categories the user stores
    (name, address, etc.) and check:
    - Data is **NOT sold** to third parties.
    - Data is **NOT used or transferred** for purposes unrelated to the item's single purpose.
    - Data is **NOT used or transferred** to determine creditworthiness or for lending.
  - Certify compliance with the Developer Program Policies.
  - Key honest framing: all personal data stays on the user's device (client-side only); we operate
    no server that receives it.

- **Privacy policy URL (required):** https://polyglotformfill.mooo.com/privacy
  (A privacy policy page must be live at this URL before submitting — see docs/launch task.)

## Remote-code / MV3 compliance note (for the reviewer, if asked)
All executable code (JS + WASM for OCR/translation) is bundled in the package — no remote code is
loaded or eval'd. The extension downloads only DATA assets (fonts, ML model weights) from the
developer's server; it never uploads user content. CSP restricts scripts to `'self'` +
`'wasm-unsafe-eval'`.

## Manifest `key` / extension ID
- The local `key` pins the dev ID `ikocicibacolgmamehagnpcgfabcamfk`.
- On first upload, CWS assigns the production ID. To keep dev == prod, after creating the item copy
  the **public key** CWS provides and set it as `manifest.key`, then rebuild. If the IDs differ,
  update the hardcoded ID in `deploy/dev-reload.mjs`.
- Bump `version` for every store upload (CWS rejects re-uploads of the same version).
</content>
