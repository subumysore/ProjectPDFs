# Store listing copy (Chrome Web Store / Edge Add-ons / Firefox AMO)

Keep the on-device / privacy angle in the first two lines — it's the differentiator and
what the review teams reward.

## Name (≤ 45 chars)
**ProjectPDFs — Private PDF & Form Autofill**

## Short description (≤ 132 chars)
Fill PDFs, Word, Excel & web forms from a reusable vault. On-device OCR, translation & signing — your data never leaves your device.

## Categories
Productivity · Tools

## Keywords / tags (ASO)
pdf filler, fill pdf, form autofill, fillable pdf, scanned form, ocr pdf, offline pdf,
private pdf, translate form, multilingual form, docx form, xlsx form, esign, passport form,
kyc form, visa form, form filler

## Full description

**Fill any form — privately.** ProjectPDFs fills PDFs, Word, Excel, and web forms from a
reusable data vault that lives **only on your device**. No cloud, no tracking, no telemetry.

**What makes it different**

- 🔒 **On-device, always.** OCR, translation, field-detection, filling and signing all run
  locally. Your documents and personal data never travel to us or anyone else.
- 🧩 **Make any PDF fillable.** Got a flat PDF or a *photo/scan* of a form with no fields?
  On-device OCR detects the fields, places them, and fills them.
- 🌍 **Polyglot / translated fill.** Fill an English form from your data in another language
  (English ↔ Hindi today) — translation happens on your device.
- 📄 **Not just PDF.** Fills Word (.docx) and Excel (.xlsx) forms too, and exports a PDF.
- 🧠 **A vault that learns.** Answer a new field once; it's remembered for next time
  (encrypted, on your device).
- ✍️ **Trustworthy signing.** Non-delegable, device-bound signatures with verifiable provenance.
- 🔗 **Companion to the desktop app.** Pair with the ProjectPDFs desktop app so your keys and
  vault stay in a hardened native trust anchor — the extension never holds them.

**Security built in.** Your vault is AES-256 encrypted and unlocked by a passphrase or a
**passkey (WebAuthn)** — hardware-backed, so nobody (not even us) can read it.

**Privacy promise.** The only things that ever leave your device are actions *you* explicitly
take — submitting a completed form to its intended recipient, or a web search you type. Nothing
else. Ever.

Free to use. Pro features (multi-format, OCR make-fillable, translation, signing) via an
**offline license** — paid, but still zero-telemetry.

## Permissions justification (for review)
- `storage` — store your encrypted vault locally.
- `activeTab` + `scripting` — fill the form on the page you're on, only when you click.
- `nativeMessaging` — talk to the optional desktop companion app on your own machine.
- No host permissions requested for background access; no analytics; no remote code (MV3).

## Required links
- Privacy policy: `https://<your-domain>/privacy` (see docs/marketing/privacy-policy.md)
- Homepage / support: `https://<your-domain>`

## Assets checklist
- 128×128 icon (replace the placeholder)
- Screenshots 1280×800 (≥3): autofill, make-scanned-form-fillable, translated fill, passkey unlock
- Small promo tile 440×280; marquee 1400×560 (optional)
- 30–60s demo video (optional but boosts conversion)
