# PolyglotFormFill — Use-case & Test-case Matrix (EXE + Extension)

Living matrix. Each row: an ID, the scenario, how it's tested (unit / headless-browser / real-app-CDP),
the surface(s), and the latest result. **Safety rule (learned the hard way):** destructive flows are
tested on a THROWAWAY profile only; never broad "click every Remove"; snapshot vault.db before.

Legend — Method: `U`=unit(node --test), `B`=headless browser harness (Edge+Chrome), `A`=real-app via
WebView2 CDP. Result: ✅ pass · ⚠️ partial/limitation · ⛔ blocked · ⬜ not yet run.

Run 2026-08-03: Extension unit **347/347**, Desktop ocr/appearances/office **8/8 each**. Browser
harnesses (Edge+Chrome) all pass. Results below.

## A. Shared engine (both surfaces) — unit
| ID | Scenario | Method | Result |
|----|----------|--------|--------|
| E1 | Resolver fills identity fields by concept aliases | U | ✅ (in 346) |
| E2 | Resolver/pagefill concept parity (every concept in both) | U | ✅ engine-parity |
| E3 | Proximity planner labels XFA boxes by printed caption | U | ✅ pdfproximity |
| E4 | Card record fills payment form (card_* + billing_*), mailing untouched | U | ✅ groups.test |
| E5 | detectCardBrand: visa/mc/amex/discover/diners/jcb/unionpay | U | ✅ |
| E6 | maskCard shows last-4 only; CVV flagged | U | ✅ |
| E7 | AAMVA DL parse (name/DOB/address/DL#) incl. MYSORE surname | U | ✅ parse.test |
| E8 | Passport MRZ (TD3) parse | U | ✅ parse.test |
| E9 | Education routing (degree/field/school/year/gpa) | U | ✅ |
| E10 | i18n: no hard-coded English control; every key in all 26 langs | U | ✅ (in 347) |
| E11 | Wrong-concept name boxes left BLANK (Other Names / interpreter / preparer); current name fills | U | ✅ pdfproximity 347/347 |

## B. Desktop EXE — real app (CDP) + unit
| ID | Scenario | Method | Result |
|----|----------|--------|--------|
| X1 | Unlock with passphrase | A | ✅ |
| X2 | Auto-select lone/last profile on unlock | A | ✅ Forms tab auto-enabled |
| X3 | Load N-400 (encrypted XFA) → auto-fill, stays editable | A | ✅ filled 77/391, editable |
| X4 | Load I-130 (XFA) → auto-fill | A | ✅ filled 167/405 |
| X5 | Load I-9 (AcroForm+tooltips) → fill | A | ✅ filled 67/128 |
| X6 | Fill button (top toolbar) manual fill | A | ✅ 77 filled |
| X7 | Live hourglass spinner shows during fill | A | ✅ animated ⏳ shown |
| X8 | Preview auto-jumps to a page with filled values | A | ✅ firstFilledPage |
| X9 | Add a card: brand logo, type badge, masked, billing pre-filled | A | ✅ Visa/Credit/masked/billing |
| X10 | Card fills a payment PDF from the primary card | A | ⬜ (engine ✅ E4; PDF pending) |
| X11 | Profiles strip scrolls when >5; delete button in-row | A | ✅ red glass in-row |
| X12 | Delete profile: confirm + optional encrypted backup first | A | ✅ dialog renders; removeProfile intact |
| X13 | Vault-save prompt on editing a form answer (caption→key) | A | ✅ earlier verified |
| X14 | Checkbox/radio overlays visible + clickable | A | ✅ BOLD teal ✓; click toggles false→true |
| X15 | Zoom in/out + larger form render | A | ✅ 960 base + zoom |
| X16 | Glass tabs + toolbar buttons render | A | ✅ |
| X17 | OCR import DL → identity fields + image | A | ✅ (MYSORE + image, earlier) |
| X18 | Flat/scanned PDF → OCR field detection | A | ⬜ pending |
| X19 | Word/Excel → export flow | A | ⬜ pending |
| X20 | Save filled PDF to Desktop | A | ✅ "Saved to Desktop as …" |

## C. Chrome Extension — unit + headless browser (Edge & Chrome)
| ID | Scenario | Method | Result |
|----|----------|--------|--------|
| C1 | Full extension unit suite | U | ✅ 346/346 |
| C2 | XFA PDF fill (pdfxfa.js saveDocument) on N-400 | B | ✅ Edge+Chrome: 66/391, 440 editable widgets |
| C3 | Web-form autofill (pagefill) on ATS form: text/email/radio/select | B | ✅ Edge+Chrome: radio=Yes, select=No |
| C4 | Card + billing fill on a web payment form | B | ✅ Edge+Chrome: card# ✓, billing ✓ |
| C5 | Popup i18n keys present + language switch | U | ✅ popup-i18n |
| C6 | PDF proximity fill (XFA field names) | U | ✅ pdffill.proximity |
| C7 | Image/signature fill into a PDF | U | ✅ pdffill.imagefill |
| C8 | Radio-group fill in a PDF | U | ✅ pdffill.radio |

## D. Known limitations / blocked
| ID | Item | Status |
|----|------|--------|
| L1 | IRS W-4/W-9 (no tooltips, labels-above-boxes) fill weakly | ⚠️ documented |
| L2 | Live Salesforce/LinkedIn/Workday submit — needs owner accounts; privacy | ⛔ can't |
| L3 | Publishing — F: signing key offline; store review lock | ⛔ blocked |
| L4 | Recovered vault ~26 of ~53 keys (incident 2026-08-03) | ⚠️ owner to re-add |
