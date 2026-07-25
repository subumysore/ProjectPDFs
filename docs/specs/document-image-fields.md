# Spec: document-image fields (DL / passport / signature) + attach-to-form

Status: **Accepted** (owner-requested 2026-07-20). Extends ADR-0016. On-device only.

## Intent
Let the user store a whole document IMAGE (driver's licence, passport, signature) as a
vault field value, and have it placed/sized into a form field that asks to ATTACH such a
copy — in addition to the structured text fields we already extract.

## Behaviour

### Capture (extension `capture.html`)
When a captured/uploaded image is processed, in addition to the extracted text fields we
add ONE **document-image field** to the review list, keyed by the detected document type
AND side (a decoded PDF417 barcode is the BACK; the printed/OCR side is the FRONT):
- Decoded a driver's-licence **PDF417 barcode** → `driver_license_back`.
- OCR text matches `/driver|licen[sc]e/i` → `driver_license_front`.
- OCR text matches `/passport/i` → `passport_image`.
- Otherwise → `document_image`.

The image is stored as a `data:image/jpeg` URI (the full captured frame). It appears in
the review list as a **thumbnail** (checkbox + key), and is saved to the vault like any
other field. A **signature** image is added via the popup's existing "add image" control
with key `signature`.

### Capture (desktop `App.tsx` — "Import a data source")  — parity added 2026-07-25
The desktop import path (`onDataSource`) previously saved only the extracted TEXT fields.
It now retains the whole source image too, under the **same ontology** (single shared
vault, one source of truth): the classification lives in one pure function,
`documentImageKey(fields, isBarcodeBack)` in `apps/app/src/ocr.ts` — a decoded PDF417
barcode → `driver_license_back`; a `passport_no` → `passport_image`; a `license_no` →
`driver_license_front`; otherwise → `document_image`. The retained image shows as a
thumbnail with a checkbox (default on) before "Save N to vault", exactly like the
extension's review list. (The desktop keys `license_front_scan`/… briefly introduced were
wrong and were corrected to this shared ontology before release.)

### Fill (`pdffill.js` — already the image-value path)
A form field whose label asks for a licence/passport/signature copy resolves (via the
shared resolver) to the corresponding image value and is **drawn fitted + centred inside
the field's rectangle** (the covering widget is removed so the image is visible). This
is best-effort sizing/placement within the form's constraints.

### Resolver concepts (semantic, not literal)
- `drivers_license` (FRONT) ← `driver_license_front`; matches "attach driver's licence",
  "copy of driver licence", "DL copy", "DL front", "driving licence", "licence copy".
- `drivers_license_back` ← `driver_license_back`; matches "DL back", "back of driver licence".
- `passport_copy` ← `passport_image`; matches "passport copy", "copy of passport",
  "attach passport", "passport scan" (NOT bare "passport", which stays the passport NUMBER).
- `signature` (existing) ← `signature`; matches "signature", "sign here", "applicant signature".

## Non-goals
- Web-form file inputs cannot be set by script (browser security) — image attach is PDF-only.
- OCR-draw path (XFA/scanned) skips image values (drawing a data-URI as text is wrong);
  image attach targets AcroForm fields.

## Verification
- Resolver: labels above → the stored image value (unit test).
- Capture: barcode → a `drivers_license_image` row added (extension end-to-end).
- Fill: image drawn inside the field rect (render proof — see feature B).
