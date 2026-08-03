# PDF Fill Battery — proof of testing (2026-08-02)

Real public forms, each run through the **exact fill logic the desktop app uses**: pdf-lib AcroForm
fill first; when pdf-lib reports 0 fields (or cannot parse the form), fall back to the pdf.js widget
layer and `saveDocument()`. A known vault was used and the output was **reloaded** to confirm the
values are present AND the form stays **editable** (widget count preserved).

Vault used: `first_name=SUBRAMANYA, middle_name=VISHWANATHAN, last_name=MYSORE,
date_of_birth=11/30/1968, address_1=4308 ALBINO DEER WAY, city=WAKE FOREST, state=NC, zip=27587,
ssn=123-45-6789, email=subumysore@gmail.com, phone=919-555-0100`.

## Results

| Form | Kind | Fill path | Fields | Filled | Editable after? | Values verified | Verdict |
|------|------|-----------|-------:|-------:|-----------------|-----------------|---------|
| USCIS **I-9** | AcroForm w/ tooltips | pdf-lib | 128 | 59 | ✅ 130 widgets | MYSORE · SUBRAMANYA · WAKE FOREST | ✅ PASS |
| USCIS **I-130** | Hybrid-XFA (pdf-lib sees 0) | pdf.js widgets + saveDocument | 405 | 155 | ✅ 450 widgets | MYSORE · SUBRAMANYA · WAKE FOREST | ✅ PASS |
| USCIS **N-400** | Hybrid-XFA (pdf-lib sees 0) | pdf.js widgets + saveDocument | 391 | 68 | ✅ 440 widgets | MYSORE · SUBRAMANYA · WAKE FOREST | ✅ PASS |
| IRS **W-4** | AcroForm, **no tooltips**, bracket names, labels ABOVE boxes | proximity | 48 | ~1 | ✅ | address only | ⚠️ WEAK — see limitation |
| IRS **W-9** | AcroForm, **no tooltips**, bracket names | proximity | 23 | ~3 | ✅ | address/zip only | ⚠️ WEAK — see limitation |
| DoS **DS-11**, HUD **92006**, SBA **413** | — | — | — | — | — | — | ⛔ could not obtain (gov sites returned HTML / blocked scripted download; retest in-app manually) |

## The headline fix (this session)

**Hybrid-XFA / LiveCycle forms (USCIS N-400, I-130, and family) were previously UNFILLABLE.** pdf-lib
cannot parse their object structure — `getForm().getFields()` returns **0**, and even `getPages()`
throws `Expected instance of PDFDict`. The app therefore treated a fully-fillable 440-widget form as
"flat", offered no fill, and its OCR fallback found nothing useful.

Fix: pdf.js already renders these forms; it can also **write** them. We set each widget's value in
pdf.js's annotation storage and call `saveDocument()`, which emits a valid PDF that **keeps every
field editable** (verified: a filled N-400 reloads with all 440 widgets intact and the values in
place). Boxes are labelled by their **printed caption** via the shared proximity planner — no
per-form rules. Same fix wired into both the auto-fill-on-load path and the "Fill from my vault"
button (now a prominent primary button, not hidden under "manual/demo tools").

## Known limitation (documented, NOT fixed this session)

**AcroForm PDFs that have no field tooltips AND print their labels ABOVE the boxes (IRS W-4, W-9).**
The proximity planner labels each box by nearby printed text; when the true label sits above and a
stray heading word ("Enter", "Information") sits to its left on the same row, the wrong caption wins
(e.g. W-4 name boxes resolve to "Enter" → no value). i-9 is unaffected because USCIS ships full field
tooltips (58/115 filled via tooltip). This is a **pre-existing** proximity-engine limitation, not a
regression from the XFA work. A fix (prefer the above-label when the same-row caption is a known
non-label token) needs visual placement verification and is deferred so it cannot destabilise the
i-130/n-400/i-9 fills that now pass. Tracked as a follow-up.

## Also fixed & verified this session

- **Driver-licence surname OCR (MYSORE).** Default page-segmentation (PSM 3) mangled the NC licence's
  `1 MYSORE` surname line to garbage. Added a **sparse-text (PSM 11) OCR pass** + made **AAMVA field 1
  authoritative** for the surname. Desktop `ocr.ts` and extension `parse.js` both now read
  `first=SUBRAMANYA, middle=VISHWANATHAN, last=MYSORE`. Desktop OCR tests 8/8 pass; extension parse
  tests 12/12 pass.
