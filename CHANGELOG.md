# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]
### Added — "Common answers": auto-answer screening / eligibility / EEO questions (2026-07-27)
- The extension can now fill **radio buttons, checkboxes, and dropdowns** for standard screening and
  self-identification questions — work authorization (US/Canada), visa sponsorship, security clearance,
  government-employment, relocation, NDA/non-compete restrictions, and the EEO self-ID fields (veteran,
  disability, gender, Hispanic/Latino, and multi-select race/ethnicity). It selects **only the answer the
  user pre-set** in a new **Common answers** panel in the popup; it NEVER guesses a legal or EEO
  declaration (an unset question is left blank). Answers are stored on-device (`chrome.storage.local`),
  passed to the fill via `opts.savedAnswers`, and matched by a curated question-pattern library
  (`QA_LIBRARY` in `pagefill.js`). Already-answered questions are left untouched. Tests +3
  (`pagefill.test.mjs`), suite 324/324.

### Fixed — web autofill reaches forms inside cross-origin IFRAMES (Greenhouse/Lever) (2026-07-27)
- Many ATS embed their application form in a cross-origin iframe (e.g. Greenhouse `boards.greenhouse.io`
  via `#grnhse_app`), so a top-frame-only injection saw zero fields and reported "No fields matched" on a
  clearly-fillable form. "Fill this page" now injects into ALL frames (via the existing `<all_urls>` host
  permission) and sums what each filled. When a label translation is active it stays top-frame-only, since
  translated labels are aligned to the top frame's field order.

### Fixed — web autofill: wrong data on real ATS forms (UltiPro/UKG) + fill confidence UI (2026-07-27)
- **Alternate-name fields no longer receive the legal name.** "Preferred Name" / "Former Name" / "Maiden
  Name" / "Nickname" / "Alias" matched the generic full-name concept (the bare word "name") and were
  filled with the wrong value — on a live LinkedIn/UltiPro application this surfaced leftover **"John Doe"**
  test data. They now fill ONLY from a vault key stored for that specific alt-name, else are left blank.
- **Free-text catch-all fields are never auto-filled.** UltiPro/Workday repeat a **Description** textarea
  per Work-Experience / Education block; loose matching dumped vault data into them (a saved **password**,
  the home **address**). Description / Comments / Notes / Remarks / Cover-letter / "additional information"
  are now skipped.
- **Repeated Work-Experience entries no longer get the same job everywhere.** Work history is a repeated
  section (`NewWorkExperience_JobTitle0/1/…`); the single stored occupation was stamped into **every**
  entry ("Job Title" = "Engineer" everywhere). We now fill only the first (most-recent) entry and leave
  earlier ones blank — they are past jobs we hold no data for.
- **Repeated Education blocks route to the right qualification.** The field label word **"degree"**
  (UltiPro "Level of Education / Degree") was misread as a *bachelor's* level, collapsing every block onto
  the bachelor entry ("Bachelors" filled twice). Level is now read from the section heading only; blocks
  with no heading route by ORDER (block 0 → highest qualification, block 1 → next).
- **Never overwrite an already-filled field.** Autofill now fills only the BLANKS — it no longer stamps
  over data an ATS parsed from the résumé (Job Title, City, dates), and a second Fill is idempotent.
  EXCEPTION: a field the extension itself filled earlier (marked `data-ppf-filled`) can be re-filled, so
  a corrected vault value replaces an earlier wrong autofill on the same page when the user clicks Fill again.
- **Screening questions / prompts are left for the user.** A field whose label is a question ("?") or an
  imperative/interrogative prompt ("Please provide an active link to your LinkedIn profile", "How many
  years…", "Are you…") is never auto-filled — scoring a concept against a whole sentence was stamping
  stray values (e.g. "38") into them.
- **"Former Name" no longer picks up unrelated "former…" keys** (was showing "NO" from a "formerly
  employed here?" answer) — alt-name fields require a key naming that alt-name specifically.
- **Year boxes reject non-years.** A From/To Year field (YYYY / labelled "year") only accepts a 4-digit
  year — a street address can no longer land in it — and education values never route into a
  work-experience field.
- **Fill confidence:** the popup now reports the field count **boldly** ("✅ **N** fields filled"), and
  every field the extension fills is **outlined in teal on the page** so the user can verify at a glance.
- **Popup "Keep open" (⤢):** pops the popup out into a standalone window that stays open until the user
  closes it (a toolbar popup is dismissed by the browser the instant focus leaves it); the Add-field row
  moved to the TOP of the vault list so it's always in view. All fill actions resolve the real page tab in
  both popup and detached-window modes. Tests +5 (`pagefill.test.mjs`), full extension suite 315/315.

### Fixed — sign/annotate no longer flattens overlays upside-down on rotated pages (2026-07-25)
- The shared flatten engine (`apps/extension/src/signflatten.js`, used by desktop via @engine and by the extension) ignored the page’s `/Rotate`, so signatures/annotations came out upside-down on 180° scans and sideways on 90°/270°. New `overlayPlacement()` applies the INVERSE page rotation (y → pageHeight−y, w/h swapped for 90/270). Fixed in the shared engine → desktop + extension in parity. Tests +3 (`signflatten.test.mjs`, 6/6). This re-enables the guide’s “sign” segment.

### Added — Lemon Squeezy license issuance (RFC-0010) (2026-07-25)
- A webhook issuer (`scripts/license/webhook.mjs`) mints the existing Ed25519 offline license token on purchase: constant-time HMAC verification of the LS webhook, idempotent minting, refund/subscription handling, seat/subscription tiers. Reuses the on-device verify model (app embeds only the public key). Tests +6 (`webhook.test.mjs`). See `docs/rfc/0010-lemon-squeezy-license-issuance.md` and `docs/business/lemonsqueezy-setup.md`.

### Added — marketing site fully localized in all 26 UI languages (2026-07-25)
- **Every marketing page now renders completely in the visitor's chosen language — no more 3 KB stubs.**
  The site generator (`docs/marketing/build-site.mjs`) was rewritten to render the FULL landing, privacy
  policy, and install page from ONE set of templates plus a per-language string catalogue, once per
  language. Previously only English was full and each `/<lang>/` page was a translated headline + blurb.
- **Single source of truth for site copy:** all visible English marketing/legal/install text was
  extracted into `docs/marketing/i18n/en.json` (188 keys); each of the 25 other UI languages has a
  sibling `<lang>.json` with high-quality human-style translations (hi bn ta te kn ml gu pa mr ur ar he
  fa zh ja ko th vi id ru es fr de pt tr). Shared strings (`app.*`, `privacy.*`, `site.*`) still come
  from the extension catalogue (`apps/extension/src/i18n.js`) — not duplicated.
- **Language switcher on EVERY page** (landing, privacy, install), in every language, with
  **language-preserving navigation**: on `/es/` the nav/footer links point at `/es/privacy/`,
  `/es/install/`, and the switcher swaps only the language segment while keeping the same page type;
  English stays at `/`, `/privacy/`, `/install/`.
- **RTL** (`dir="rtl"`) for ar/he/fa/ur across all three page types; the animated multilingual "Hello"
  background renders on all localized landings; pricing PPP script, install-page version injection
  (extension v1.0.1 / desktop v1.0.0), and SEO meta preserved.
- New validator `docs/marketing/check-i18n.mjs` enforces identical key sets, matching types/array
  lengths, and `{each}` placeholder preservation across all language files (all 25 pass, 188 keys each).
- On-device / privacy invariant unaffected: pure build-time static generation, no user content, no egress.

### Fixed — desktop classifies an OCR'd licence BACK as driver_license_back (extension parity) (2026-07-25)
- `documentImageKey()` now takes the OCR text and mirrors the extension's `docImageKey()` fully: a decoded barcode = BACK, identity fields (name/DOB/address/licence no) = FRONT, class/restriction/endorsement boilerplate = BACK, passport markings = passport. So importing the BACK of a licence (no scannable barcode) still retains its image as a `driver_license_back` vault entry, and an image-only result (no text fields) no longer shows a “couldn’t read” error or hides Save. Unit-tested (`ocr.test.mjs` +1).

### Fixed — passport "Given names" no longer mis-parsed (OCR) (2026-07-25)
- On-device OCR read a passport line `Given names: JOHN QUINCY` into `first_name = "names: JOHN QUINCY"` (the label `given names` was unknown, so the `given` prefix swallowed `names:`). Added `given names`/`forenames` as a full-name label that splits into first (+middle); `apps/app/src/ocr.ts`, unit-tested (`ocr.test.mjs` +1).

### Fixed — desktop ID import now retains the document image (extension parity, shared ontology) (2026-07-25)
- **Desktop "Import a data source" now saves the whole licence/passport IMAGE**, not just the
  extracted text. The extension already did this (`capture.js`, per `docs/specs/document-image-fields.md`);
  the desktop path (`App.tsx onDataSource`) lagged. Now, after OCR/barcode extraction, the source
  image is retained under the **same shared-vault ontology** — `driver_license_front` /
  `driver_license_back` / `passport_image` / `document_image` — via one pure classifier
  `documentImageKey()` in `apps/app/src/ocr.ts`, shown as a thumbnail with a default-on checkbox
  before "Save N to vault". Corrects a single-source-of-truth violation (desktop had briefly used
  divergent `*_scan` keys the extension would not recognise in the shared vault). Unit-tested
  (`ocr.test.mjs`, +1). On-device only; no egress.

### Added — launch strategy: signing/platform decisions, roadmap, rebuilt guide video, landing page (2026-07-25)
- **ADR-0023 — code signing & platform distribution strategy (zero-cost first).** Consolidates the
  ordered Windows trust plan (keep public builds honestly unsigned; publish per-artifact SHA-256;
  "expect this warning" install copy; lead with extension + `winget`; let SmartScreen reputation
  accrue) and adds the **macOS feasibility** picture (Tauri needs a build Mac; a clean "double-click to
  open" needs Apple Developer Program at US$99/yr + notarization) — deferred. Records the paid-signing
  order (Azure Trusted Signing → OV → EV), each with its gating condition. Extends ADR-0020, does not
  supersede it.
- **ADR-0024 — launch distribution & platform roadmap (entity-triggered).** Captures the owner's
  2026-07-25 planning decisions: (1) positioning leads with **all three niches equally** —
  immigration/relocation, cross-border freelancers/SMBs, privacy/crypto; (2) **no per-pair language
  rollout** — translation is on-device NLLB any-to-any and the UI is already in 26 languages, so packs
  are **pre-staged/QA'd by global speaker volume** (Spanish, Chinese, Arabic, Portuguese, French,
  Russian, Bengali, …) rather than gated; (3) **desktop and extension presented equally** (not
  extension-first); (4) paid platform work **deferred and sequenced around registering a business
  entity** — when it exists, in order: EV code-signing cert (instant SmartScreen trust) → re-check
  Azure Trusted Signing org eligibility → macOS desktop (Apple Developer Program + build Mac +
  notarization) → Microsoft Store / MSIX. Triggers are "revenue" and "entity registered" — no dates.
  Extends ADR-0023.
- **Guide video rebuilt** via the ADR-0022 pipeline: **dynamic animated cards**, a **before/after
  hero**, **real in-browser extension + live translation demos**, and **neural narration**. Served at
  the stable `https://polyglotformfill.mooo.com/download/guide.{mp4,en.srt}` (URL unchanged on rebuild).
- **Landing page:** added a **hero section** and dedicated **niche sections** (immigration/relocation,
  cross-border freelancers/SMBs, privacy/crypto), matching the equal-weight three-niche positioning.

### Added — guide video: automated pipeline + self-hosted at a stable URL (2026-07-24)
- **One-command rebuild:** `node scripts/build-guide.mjs` (`make guide`) assembles the narrated video +
  captions from `docs/guide/guide-manifest.json` + per-segment clips/narration. Deterministic; the caption
  splitter keeps URLs (polyglotformfill.mooo.com) intact.
- **Self-hosted at a permanent URL:** `publish-site.ps1 -WithGuide` serves the video + captions at
  `https://polyglotformfill.mooo.com/download/guide.{mp4,en.srt}` (own Object Storage objects, excluded from
  the site tarball like installers; `site.yaml` fetches them best-effort so a missing guide never breaks the
  pod). The link never changes when the content is rebuilt — the fix for YouTube minting a new URL each time.
  **Published and verified live (HTTP 200).** See ADR-0022.
- **Scripted YouTube path** (only where Google requires it — the CWS promo field): `scripts/upload-youtube.mjs`
  + `scripts/youtube-auth.mjs` (`make guide-upload`, `make guide-captions`).
- **Content fix:** the flat-PDF fill segments were re-recorded on the fixed build — the form now fills the
  NAME (composed) + DOB + Nationality, not just Date of birth.
- **UI:** the Forms-to-fill screen repeated "on-device / we never see your data" three times; trimmed to one
  line each so the controls sit higher.

### Fixed — form fill, ID capture, safer delete, and clearer vault (2026-07-23, later)
- **The name now fills.** Filling a form left the name BLANK whenever the vault stored
  `first_name` + `last_name` rather than a single `full_name` (exactly what ID capture produces).
  `makeFillableAndFill` (flat-PDF → fillable path) filled each detected field by an EXACT
  `vault[ontology_key]` lookup, bypassing the semantic resolver — so `date_of_birth` matched but
  `full_name` had no key and stayed empty. It now falls back to the resolver, which composes
  given + family. The resolver also gained a **field-NAME fallback** (a machine-named `full_name`
  box with no tooltip now meaning-matches) — fallback only, so a `Company name` box is never
  hijacked by a field literally named `name`. Desktop + extension share the resolver (`@engine`),
  so both are fixed. (`apps/app/src/pdf.ts`, `apps/extension/src/resolver.js`; +resolver test.)
- **ID capture reads EVERY labelled field, not one.** The on-device data-source import produced a
  single field from a driving-licence image, and it was wrong — the licence number was swept up as
  a phone number. ID cards print `Label value` with a single space and no colon; the parser only
  handled colon/2-space forms. Now single-space `Label value` matching (longest label wins), new
  `license_no`/`id_no`/`expiry_date`/`issue_date` labels, the colon regex no longer swallows a
  hyphen inside a value, and the label-free phone fallback is suppressed when a licence/ID/passport
  number is present. A licence now yields name, DOB, licence no, address, city and expiry in one
  shot. (`apps/app/src/ocr.ts`; +`ocr.test.mjs`, 4 cases.)
- **Deleting a profile requires the vault passphrase.** Erasing a profile removes every detail and
  saved form under it and cannot be undone, so beyond the two-step confirm the confirm panel now
  asks for the passphrase and `delete_profile` verifies it server-side (shared `verify_passphrase`,
  also used by unlock). A wrong/empty passphrase deletes nothing and shows an inline localized
  error. Added `profile.removePassWrong` across all 26 UI languages. (`apps/app/src-tauri/src/lib.rs`,
  `apps/app/src/App.tsx`, `apps/extension/src/i18n.js`.)
- **Review editor opens after Detect-fields**, so a value the vault didn't have (e.g. Nationality)
  can be typed and then auto-registers as a new vault key/value for next time — the detect button
  now calls `loadReview` like the automatic pipeline. (`apps/app/src/App.tsx`.)
- **Vault rows correlate at a glance:** the table was full-width with Edit/Remove floated far from
  their value; now zebra-striped, capped width, actions beside the value. (`apps/app/src/App.tsx`.)

### Added — every script the engine claims is now actually writable (2026-07-23)
- **13 more Noto fonts hosted.** Only Devanagari and Simplified Chinese were on the asset host, so
  Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Gurmukhi, Arabic, Hebrew, Thai, Japanese,
  Korean, Cyrillic and Greek values could not be written into a PDF at all. The script table is now
  data driven by Unicode Script properties, with kana and Hangul tested BEFORE Han so Japanese and
  Korean are never silently drawn with the Chinese font (which would drop every kana/Hangul).
- **Desktop fonts are fetched on demand, not bundled.** New Rust `script_font` command: fetch once
  from the asset host, validate the name and the file signature, cache in app-data — the same
  pattern as the OCR packs (ADR-0019). A user who never fills a Tamil form never downloads the
  Tamil font, and adding a script needs no new release. **Installer: 29.9 MB → 23.7 MB.**
- **Upstream fontkit bug fixed** (`patches/@pdf-lib__fontkit.patch` + the vendored bundle): a NULL
  GPOS anchor is legal and means "no attachment point", but fontkit dereferenced it, so ordinary
  Punjabi and Malayalam names (the vowel sign in ਰਾਜੇ, the virama in രാജേഷ്) threw and could not be
  written. The same file already handles a null CURSIVE anchor this way.

### Fixed — captured data was write-only, in every language (2026-07-23)
Found by the new round-trip test, not by inspection. The resolver matched labels only through its
English concept table, so a key the user captured themselves never filled anything — not even a
field whose label was character-for-character that key (`employee_id` + "Employee ID" → nothing).
And its key normaliser was ASCII-only, so 氏名, 生年月日 and 電話番号 all collapsed to `""` and
overwrote one another in the lookup. The user's own key for a label now wins outright, keyed the
same Unicode-aware way capture keys it, on both engines. Also: repeated-row skipping compared field
NAMES only, so a form naming unrelated boxes `f1`…`f9` lost every field after the first — captions
are compared too now.

`roundtrip.test.mjs` runs the loop a user actually lives in — type → capture → store → refill, web
AND PDF — in 8 languages. `fonts.test.mjs` proves all 16 scripts survive a real save/reload and that
every font in the table is genuinely served by the host.

### Fixed — the four open bugs left by the end-to-end test session (2026-07-23)
All four were recorded as open in `activeContext.md` and are now closed, each verified against the
real forms that exposed them rather than against a fixture alone.

- **A non-Latin value now actually FILLS instead of being dropped.** `fonts.js` could already
  embed a script font but `pdffill.js` never called it, so every CJK/Indic value was skipped and
  reported as unfillable. Appearances are now generated **per field** with the font that field's
  own value needs (`appearances()`), and the document is saved with
  `updateFieldAppearances: false` so pdf-lib does not redo the whole form with the standard font.
  A value no embeddable font can draw is still left blank and reported — but that is now only the
  scripts whose font is not hosted, not every non-Latin script.
  Proven on the real HK GF340 (533 fields): `陳偉明` is written into `ChineseName`; Hindi likewise.
  **The desktop `.exe` had the identical bug in its own `pdf.ts` fill path** — fixing the shared
  engine did not fix the app, so `apps/app/src/fill/appearances.ts` carries the same rule and
  `src/appearances.test.mjs` proves it against the Noto fonts the app actually ships.
- **Derived and office-use boxes are no longer auto-filled.** HK GF340's `HKIDCheckingDigit` was
  getting the surname INITIAL — its caption reads "Last Digit", "last" is an alias for the
  surname, and the box holds one character. Boxes whose caption **or field name** marks them as a
  check digit, checksum, or office/staff-use field are now left for whoever actually owns them.
  Both the caption and the raw field name are checked, because on this form each one alone looks
  innocent.
- **A correspondence address no longer silently mirrors the residential one.** When a form asks
  for both, a qualified address (correspondence/mailing/office/permanent/…) is filled only from a
  vault key carrying that same qualifier; otherwise it is left blank for the user, who usually has
  a "same as above" tick. A qualified address that is the ONLY address on the form still fills.
- **The extension now asks before saving new details, like the desktop does.** The desktop learns
  values typed onto a form and shows them for review; the extension had no equivalent at all, so
  the same product behaved two ways and extension users simply lost what they typed. New
  "Save new details from this page" flow (`pagecapture.js` + popup review list): every proposed
  pair is shown with the value it would replace, and only ticked rows are saved — to the local
  vault only. Passwords, hidden inputs and untouched fields are never read.

`engine-parity.test.mjs` now guards the *safety rules* too, not just the concept tables: a rule
about what NOT to fill must exist on both engines or the build fails. Suite 163 → 222.

### Fixed — nine fill-engine bugs found by end-to-end testing against real government forms
Tested the real shared engine against live-downloaded forms in Chinese, Hindi, Tamil and Telugu
(HK Civil Service GF340 — 533 AcroForm fields, HK Immigration ID995A, Atal Pension Yojana in three
Indian languages) plus generated web forms in all four scripts. Full record: `BUGS.md`.

- **The two fill engines had silently DIVERGED** — `resolver.js` (PDF) had 40 concepts,
  `pagefill.js` (web) only 28. `occupation`, `ssn`, `taxid`, `birthplace`, `passport_type`, `age`
  and others filled in PDFs and did **nothing** on web forms. Each file's own tests passed, so
  nothing caught it. Concepts added, plus `engine-parity.test.mjs`, which now **fails the build
  whenever a concept is added to one engine and not the other**.
- **New key/value capture could never work in a non-Latin language.** `keyFromLabel` was a
  private, untested helper in `App.tsx` doing `replace(/[^a-z0-9]+/g, "_")`, so `पूरा नाम` became
  an empty key and the captured pair was silently discarded. Extracted to shared, Unicode-aware
  `vaultkey.js`. The tests caught a further trap before it shipped: Devanagari/Tamil/Telugu vowel
  signs and Arabic diacritics are Unicode **Marks**, not Letters, so `\p{L}` alone mangles
  the word; the class must include `\p{M}`.
- **A script-qualified name field got the wrong script** — `ChineseName` was filled with the Latin
  given name while the vault held the Chinese one. Such fields now resolve only against a matching
  vault key and fill **nothing** rather than falling back to the Latin name.
- **One CJK value aborted the entire PDF fill.** Appearance generation happens at save time, so a
  `WinAnsi cannot encode` error destroyed the whole output — a Chinese form produced no file at
  all. Unencodable values are now skipped and **reported** in `result.unencodable`; the rest of
  the form still fills. (Embedding a Noto CJK/Indic font remains the real fix.)
- **Repeated table rows all received the same value** — nine `NameOfFirm1..9` got the same
  employer, so a submitted GF340 would claim nine identical jobs. Siblings differing only by a
  trailing number are now recognised as rows; only the lowest-numbered is auto-filled, scoped per
  parent so separate tables stay separate.
- **readOnly web inputs were filled**, e.g. a server-issued reference number receiving the street
  address. Not a blanket skip — date pickers are routinely readOnly — so readOnly now fills only
  where the field looks like a picker.
- **An explicitly stored `full_name` is now preferred** over one composed from leftover atoms
  (a Full Name field used to get just the given name). The composite logic had been inlined at
  three call sites in `pagefill.js` and drifted; now a single `compositeValue()`.

Suite: 129 -> **163** engine tests. Two further reported issues were traced to faults in the test
harness rather than the product, and are recorded as such rather than "fixed".

### Changed — GA is no longer blocked on buying a code-signing certificate (ADR-0020, REQ-05.2)
- **Public releases now ship deliberately unsigned**, and self-signing is confirmed **dev-only**.
  A self-signed certificate's chain does not validate on anyone else's machine, so SmartScreen
  behaves exactly as it does for an unsigned binary — and *"signature present, chain invalid"* is
  treated more harshly than *"no signature"* under some enterprise/AV policy. It bought nothing.
- **Install channels reordered by friction:** browser extension first, then **winget**
  (`winget install PolyglotFormFill` — the community repo accepts unsigned `.exe`/`.msi`, and the
  install is not a browser download so it skips the Mark-of-the-Web reputation prompt), and direct
  download last. **MSIX deliberately not adopted** — it *would* require a purchased certificate.
- **The install page now predicts the SmartScreen warning before the user clicks download**, shows
  what the box says, explains the cause in one sentence, and gives the exact click path
  (**More info → Run anyway**). An anticipated warning reads as competence; the same warning
  unannounced reads as danger. Binding copy rules (no "certified"/"safe" claims, no alarm words,
  no apologising, disclosure stays until a real certificate is in use) are in the spec.

### Added — Release integrity manifest (`scripts/release-manifest.mjs`)
- `generate` / `verify` SHA-256 for every published artifact. Deterministic (sorted, byte-stable),
  **refuses to write an empty manifest** rather than silently advertising "nothing to verify", and
  the verifier reports **every** MISMATCH/MISSING in one pass instead of stopping at the first.
- `signed: false` is structural — it must never be flipped true for a self-signed build.
- The install page reads `release-manifest.json` at runtime, so the published hashes and version
  badge cannot drift from what was actually shipped. Degrades to a static link if unreachable.
- 12 unit tests, wired into `scripts/test-all.mjs` (which now also discovers `scripts/*.test.mjs`).
  Full suite green: 129 + 8 + 12, typecheck, vite build.

### Fixed — the download page was serving 0.1.0 binaries under a 1.0.0 banner
- The 1.0.0 version bump touched the six version sites but never reached the published binaries,
  which still reported **ProductVersion 0.1.0**.
- **Rebuilt at 1.0.0:** `PolyglotFormFill_1.0.0_x64-setup.exe` (29.9 MB) and
  `PolyglotFormFill_1.0.0_x64_en-US.msi` (31.9 MB), plus the extension zip (9.0 MB), all staged in
  `docs/marketing/site/download/` with `release-manifest.json` regenerated and verified (3/3 OK).
- Versions were **verified rather than assumed**: the `.exe` PE ProductVersion reads `1.0.0`, and
  because an MSI carries no PE VersionInfo, its `ProductVersion` was read from the MSI Property
  table (`1.0.0`).
- `Get-AuthenticodeSignature` reports **NotSigned** for both, matching `signed: false` in the
  manifest — the signCommand hook correctly no-op'd with no certificate configured (ADR-0020).
- Not yet published to the live site; that step is left as an explicit action.

### Changed — installers moved out of the site tarball; MSI no longer hosted
- **Publish payload 86 MB → 15.4 MB.** The site tarball carried ~62 MB of installers, so every
  HTML-only publish re-uploaded them (~5.5 min on a 2 Mbps upstream). Installers are now separate
  Object Storage objects, fetched into `/web/download/` by the init container, so the public
  `/download/...` URLs are unchanged. Re-upload them only with `publish-site.ps1 -WithBinaries`.
- `publish-site.ps1` **fails if an `.exe`/`.msi` leaks into the tarball**, so the slow-publish
  problem cannot silently return; the init container uses `curl -f` so a missing or expired PAR
  fails the pod loudly instead of serving a site whose download links 404.
- **The MSI is no longer published** (it duplicated the `.exe` for ~32 MB). It is still built by
  `tauri build`. Consequence: winget cannot offer it either, because winget validation downloads
  `InstallerUrl` — so the NSIS `.exe` is now the single published installer, and the winget tests
  enforce hosting/manifest agreement in **both** directions (nothing published is missing from
  winget; nothing in winget is unhosted).
- **Requires one-time infra:** a bucket-level read PAR, and `DOWNLOAD_BASE` set in `site.yaml`
  (currently the placeholder `REPLACE_WITH_BUCKET_PAR_URL`). The exact `oci` command is in the file.

### Fixed — `publish-site.ps1` failed to parse (non-ASCII in a string literal)
- An em dash inside a `throw` string broke the whole script. **Cause:** PowerShell 5.1 reads `.ps1`
  as ANSI unless the file has a BOM, so UTF-8 `—` (E2 80 94) decodes to three CP1252 characters
  ending in `0x94` — a curly closing double-quote, which terminates the string early. The reported
  errors pointed at lines nowhere near the real fault. In *comments* the same bytes are harmless,
  which is why several other scripts carry em dashes and work fine.
- Fixed the file and added `scripts/ps1-ascii.test.mjs` (3 tests): non-ASCII is rejected on
  executable lines (tolerated in comments), and **every tracked `.ps1` is parsed by PowerShell's
  own parser**, which catches any syntax error rather than just encoding damage. Both guards were
  proven to fail on the reintroduced bug. All 8 scripts parse cleanly.

### Fixed — `site.yaml` carried an applyable placeholder
- `kubectl apply` with `DOWNLOAD_BASE` still set to `REPLACE_WITH_BUCKET_PAR_URL` put new pods into
  `Init:Error`. **The site stayed up** — Kubernetes keeps old pods until a new one is Ready, and the
  `curl -f` guard made the failure loud instead of serving a site with 404ing download links.
  Recovered with `kubectl rollout undo`. The file now leads with an explicit do-not-apply warning
  and the correct order of operations.

### Verified — 1.0.0 downloaded from the live site, scanned, installed and run
- Downloaded from `polyglotformfill.mooo.com` as a user would; SHA-256 matched the published
  manifest. One attempt arrived truncated (17.7 MB of 29.9 MB, connection reset) and **the hash
  check caught it** — the integrity story doing exactly its job.
- Windows Defender scan: **no threats** (exit 0). Authenticode: `NotSigned`, as designed.
- Silent install (exit 0) registered `PolyglotFormFill 1.0.0`; the app launched, showed the unlock
  screen, and recognised the existing vault (no data disturbed).

### Added — winget package manifests (`deploy/winget/`)
- Version, locale and installer manifests for `SubramanyaMysore.PolyglotFormFill` 1.0.0, offering
  both the NSIS `.exe` and the `.msi`. **`winget validate --manifest deploy/winget` passes** against
  the real winget CLI.
- `scripts/winget-manifest.test.mjs` (5 tests) guards them against drift: `InstallerSha256` must
  equal the published hash, both installers must be offered, and version/identifier must agree
  across all three files. A stale hash there would break `winget install` for every user, so the
  guard was **proven to fail** on a deliberately corrupted hash, not merely assumed to work.
- The install page now states plainly that winget is **not live yet** (the manifest PR cannot be
  opened until the installer URLs are reachable, since winget validation downloads them) and points
  users to the direct download meanwhile — presenting it as working would be the same class of false
  claim the spec already forbids.

### Added — `-NoPublish` for `deploy/publish-extension.ps1`
- Rebuilds the downloadable extension zip locally and stops, so a release can be staged without
  touching the public site. Publishing stays a deliberate, separate step.

### Docs
- ADR-0020 (distribution trust without a paid certificate), `docs/specs/release-integrity.md`,
  `features/release-integrity.feature`, BRD REQ-05.2, and a release-step section in
  `docs/reference/code-signing.md` (build → generate manifest → verify → publish).

## [0.2.0] — 2026-07-21
### Packaging — Chrome Web Store update build
- Bumped extension to **0.2.0** for a Web Store package update (0.1.0 was published Jul 18).
- `deploy/build-extension-zip.ps1`: builds ONLY the store `.zip` (no website publish) into
  `dist/`, with a manifest sanity check and a guard that no `*.test.*` files leak in.
- **Fixed a packaging bug:** `vendor/zxing.bundle.mjs` (the PDF417 barcode scanner) was imported
  by `capture.js` but omitted from both build scripts — the published build would have had broken
  barcode scanning. Now included in `build-extension-zip.ps1` and `publish-extension.ps1`.
- `docs/launch/chrome-web-store-listing.md`: copy-paste store listing, per-permission
  justifications, data-use declarations, and the manifest-`key`/extension-ID note.

## [1.0.0] — 2026-07-23
### Changed — GA version
- Bumped to **1.0.0** across all six version sites: workspace `Cargo.toml`, root and app
  `package.json`, `tauri.conf.json`, app `Cargo.toml`, and the extension manifest (from 0.2.16).

### Fixed — OCR language packs were never uploaded (not a dead host)
- Earlier diagnosis was **wrong** and is corrected here: the Object Storage PAR was never dead —
  `eng.traineddata.gz` served `200` throughout. The other **14 packs had simply never been uploaded**,
  so every non-English OCR request 404'd and OCR silently degraded to English.
- Uploaded `kan, kor, chi_sim, chi_tra, spa, hin, jpn, ara, fra, deu, rus, tam, tel, por`; all 15 are
  verified reachable over the existing PAR. The extension uses **our own host** again, so the public
  mirror added earlier is now a genuine fallback rather than the primary path.

### Added — First-use model provisioning (desktop)
- A fresh install has no packs in app-data, so the worker prefers the on-device copy and reaches the
  asset host **only the first time a language is used**, after which it stays local. Closes the
  outstanding "models fetched/cached, not bundled" item.

## [Unreleased]
### Added — Language-aware OCR on both platforms (2026-07-23)
- Desktop OCR was hardcoded to `eng`, so **any non-English scan was unreadable** — a parity gap with
  the extension, which was already language-aware. New shared `apps/app/src/tessworker.ts` resolves an
  ISO code to its Tesseract pack via `@engine/langcodes`, serves the engine from the app origin and
  the language models from the app-data `models/tesseract/` dir through the `ppfmodel` scheme
  (**not embedded in the binary** — that is what ballooned the build). Workers are cached and reused,
  so re-scanning no longer re-initialises the model.
- `detectFields()` and `extractFromImage()` take a language; `App` threads the user's selected
  language into every OCR call site. Packs installed on this device: kan, kor, chi_sim, chi_tra, spa,
  hin, jpn, ara, fra, deu, rus, tam, tel, por, eng.
- **Production bug fixed:** the extension's asset host now returns **404**, so multi-language packs
  never arrived and OCR silently degraded to English for every user. Added a public-mirror fallback
  with an honest status message so the feature works while the host is down.
- Privacy: assets flow **down only** (engine + public OCR model). The image and the recognised text
  never leave the device; no user content, form data, or identifier is sent.

### Added — Edit the form in place, with the full toolbar (2026-07-23)
- The desktop now renders the **actual form** with real inputs laid over each field, instead of a
  key/value list beside it. Pages are fitted to the panel and re-fit on resize; the app shell went
  from a fixed 820px column to `min(1600px, 96vw)`.
- Persistent **pen / text / signature / image** toolbar sits on the form, matching the extension.
- Translation covers **labels and values**, so the whole form reads in the user's language. The
  translated view is a reading aid: the saved file always keeps the form's original language.
- **Fixed:** the form rendered twice — widget appearances were painted by the PDF *and* by the
  overlay inputs, and a legacy preview canvas drew a second full copy below.
- **Added:** anything typed onto a form that the vault does not already hold is surfaced for review —
  the exact label, key, value, and the prior value it would replace — and saved only on confirmation,
  to the local vault only.

### Added — Automatic two-way vault sync (extension ⇄ desktop, last-write-wins) (2026-07-23)
- The extension and desktop vaults now **auto-reconcile on every popup open**, in both directions,
  with **per-field last-write-wins**: a field on only one side is copied over; when both hold it, the
  newer `updated_at` wins. Nothing is ever deleted, so no field can be lost. No buttons, no prompts.
- Both vaults gained per-field timestamps: `core-store.data_points.updated_at` (+ migration for
  existing installs, `put_data_point_at`, `data_points_meta`); the extension worker keeps `vtimes`
  beside its sealed blob and stamps every write. New messages: host `getVaultMeta`, worker
  `getVaultMeta` / `companionVaultMeta`; `upsertData`/`set` accept the winning `updatedAt`.
- `reconcileVaults()` is pure + unit-tested (9 companion tests: no-loss, newer-wins both ways,
  tie-break, missing timestamps).
- The single unavoidable touch: this browser's pre-existing vault is encrypted, so it must be
  unlocked once (normal passphrase) before it can be read and synced; the popup asks only when local
  data actually exists. After that it is fully automatic.

### Fixed — Stale native-host binary broke the bridge (2026-07-23)
- "Error when communicating with the native messaging host": the registered manifest pointed at a
  3-day-old `target/release/projectpdfs-host.exe` predating the unlock gate and sync messages.
  Rebuilt; verified ping / listProfiles / getVaultMeta over the real stdio protocol.

### Added — Desktop: filled/signed PDFs saved straight to your Desktop (2026-07-22)
- Filled, signed, OCR-detected, re-downloaded, and Office-exported PDFs now save to the user's actual
  **Desktop** (unique names, never clobbering), not the browser Downloads folder. New Tauri
  `save_to_desktop` (`desktop_dir()` → Documents → home → app-data fallback); all `App.tsx` export
  points route through a `saveOut` helper that shows the exact path and falls back to a browser
  download if the Desktop write fails.

### Fixed — Extension: sign tool stuck on "Flattening…"; Kannada viewer TDZ crash (2026-07-22)
- Sign tool never saved: the Download `<a>` re-fired its own onclick (preventDefault + re-flatten) in
  an infinite loop — now downloads via a separate anchor inside try/catch.
- "View in my language" crashed on Kannada/scanned forms ("Cannot access 'go' before initialization")
  — the bad-text-layer branch used `go` before its `const`; hoisted the lookups.

### Known issue — Translation/OCR models are not hosted (2026-07-22)
- `translateText` (both apps) and OCR language packs fetch models from a host that now returns **404**
  (old Oracle pre-authenticated URL expired; current host doesn't serve `/models`). Until the ~500 MB
  NLLB + Tesseract packs are re-hosted at a reachable URL and the model-base constants are updated,
  translation cannot run. Desktop translation is also not yet wired into the UI. Models exist locally
  in `apps/app/models-staging/`.

### Fixed — Desktop release build now produces installers (2026-07-22)
- Root-caused a reproducible `E0786` "corrupt `app_lib` metadata" that blocked every desktop release
  build. It was **not** path/Defender/leftovers: the on-device **translation models (~1.3 GB) sitting
  in `apps/app/public/`** were copied by vite into `dist/` and **embedded into the Tauri binary**,
  bloating the `app_lib` rlib to ~6.8 GB until it corrupted. Moving the models out of the embed path
  yields normal-size, clean builds — **`PolyglotFormFill_0.1.0` MSI (31 MB) + NSIS setup (29 MB)**.
- Also set `[profile.release] lto = false` (the lib+bin Tauri crate + LTO is a separate `E0786`
  trigger on rustc 1.97).
- **GA follow-up (design):** the translation models — like the guide video (ADR-0019) — must be
  **runtime-provisioned, not bundled**. Staged the local models to `apps/app/models-staging/`
  (gitignored); wiring on-device model fetch/caching is the remaining task for shipped-app translation.

### Added — Desktop: review & edit the filled form before finalizing (2026-07-22)
- After a form is filled, the desktop now shows an **editable review** of every AcroForm field
  (text / radio / checkbox / dropdown) with its current value. The user can **correct anything**
  (e.g. a mis-detected marital-status option, a wrong passport number) and **Apply changes** to
  re-export `filled.pdf` and update the saved version — nothing is committed silently, and empty
  fields are shown as empty, never fabricated. New `pdf.ts` `listReviewFields` / `applyReviewEdits`;
  acceptance `features/review-before-finalize.feature`. (Closes the desktop gap vs the extension's
  editable viewer.)

### Added — Shared vault gated on desktop unlock (2026-07-22)
- The extension can use the shared vault only while the **desktop app is unlocked**. The app writes a
  heartbeat unlock sentinel (`app-session.flag`, refreshed every 30 s, cleared on lock/startup); the
  `native-host` refuses all vault ops except `ping` unless the sentinel is fresh (≤120 s) —
  `dispatch_gated`/`session_fresh`/`is_fresh`, +3 host unit tests (now 6). Resolves the open
  locked-vault decision (privacy-first).

### Changed — Single vault is now AUTOMATIC (extension ⇄ desktop, no toggle) (2026-07-22)
- The extension and desktop app now share **one vault automatically**: whenever the desktop app's
  companion bridge is reachable, the desktop's encrypted vault is the single source of truth and the
  extension reads/writes it (same profiles, on-device local bridge, no network). When the desktop
  isn't present, the extension transparently uses its own local vault. **No "companion mode" toggle,
  no setup** — the old manual checkbox is gone.
- **Order-independent unification:** start with either app first. On first connect the extension
  seeds the shared vault with any data it already had — a **safe union** that never overwrites a
  value the desktop vault already holds (`migrationPlan`, one-time, deferred until the local vault is
  unlocked). If the desktop has no profile yet, one is created so the shared vault has a home.
- The popup now shows the **active profile name** ("One vault · shared with the desktop app ·
  profile: …") so the profile is readable in either flavor. Options page shows automatic status +
  a shared-profile picker instead of a toggle.
- New tested pure helpers `apps/extension/src/companion.js` (`shouldUseDesktopVault`, `migrationPlan`)
  — +5 unit tests (extension-first seeding, safe-union no-clobber, empty-field fill, deferral guards).

### Added — Desktop: License tab, Docs & Video tab, app-only hosted guide video (2026-07-22)
- **License is now its own first tab** (`1 · License`) — the app’s foundation: license status +
  this device’s identity, verified offline. Tabs are now: License → Profile & Vault → Forms to fill
  → Past forms → Docs & Video.
- **New `5 · Docs & Video` tab** — a narrated guided-tour video plus written, tab-by-tab
  documentation and the privacy promise. Written docs are bundled (always offline).
- **Guide video is NOT bundled (RFC-0009 / ADR-0019).** It’s hosted on the OKE asset host and served
  **downward**, fetched once by the app, **integrity-checked against a pinned SHA-256**, and cached
  on-device for offline playback. The fetch carries an **app-level** capability (same for every
  install of a release) + Origin — it authenticates *a genuine app build*, never a user, so there is
  **no tracking / no identifier** (privacy invariant preserved). Honest limitation recorded: a
  downloadable client’s token is extractable, so this is a strong deterrent, not DRM.
- Video is produced fully on-device: `scripts/build-guide-video.ps1` (Windows SAPI narration + real
  app screenshots in `docs/guide/slides/` + ffmpeg). New `core-fetch::fetch_app_asset` (app-gated
  downward fetch) and Tauri `guide_video` command (cache → verify → fetch). Edge gate documented in
  `docs/deploy/app-asset-gate.md`.

### Added — Desktop: real on-device history for brought forms (2026-07-22)
- Every form you fill (from device / network / URL / web search) is now **saved to the Past forms
  tab automatically** as an encrypted, versioned copy — entirely on-device. Re-filling the same
  form appends a new version.
- New `core-store` `form_blobs` table stores the sealed filled-PDF bytes per version, plus
  `add_version_blob` / `version_blob` / `list_instances` (unit-tested: blob round-trips, sealed at
  rest, instance listing scoped + newest-first).
- New Tauri commands: `save_brought_form` (append version + blob + save event), `list_saved_forms`
  (summaries: name, version, saves, fields filled/total, timestamp, signed), `saved_form_pdf`
  (re-download the filled PDF), `sign_saved_form` (device Ed25519 provenance over the latest version).
- Past forms tab lists real saved forms with **Re-download PDF** and **Sign (device key)**. Verified
  live end-to-end (filled the Japan MOFA visa form from a local file → 12/60 fields → saved v1 →
  signed on-device Ed25519).

### Changed — Desktop app: SPA → step-by-step tabs, catalog removed (2026-07-22)
- The desktop app (`apps/app`) is no longer a single long scroll. It is now a **tabbed, step-by-step
  workflow**: **1 · Profile & Vault → 2 · Forms to fill → 3 · Past forms**. Non-setup tabs stay
  disabled until a profile is selected, with an inline "start here" hint. The tab bar is **sticky**
  so it stays reachable while scrolling.
- **Profile and Vault are one tab:** top = profile management (add / choose / edit / remove) and a
  **License & device** card; below = the chosen profile's encrypted vault + backup/transfer.
- **Built-in catalog removed.** The app ships/maintains no form mappings — it adapts to *any* form
  the user brings. The Forms tab is simply: bring a form from **this device**, a **network location**
  (`\\server\share` / mapped drive), a **web URL** (downloaded on-device, SSRF-guarded), or **search
  the web** (DuckDuckGo, the one labelled egress) — then it's read and filled on-device
  (AcroForm fill, else on-device OCR detect→create→fill). Removed the catalog picker, the catalog
  autofill/save/sign table, and the "Make fillable (catalog coords)" tool and their dead code.
- **Privacy vocabulary corrected:** the invariant is that *we* never receive the form or data — the
  user still sends the finished form wherever they choose (e.g. submitting to its recipient). Dropped
  the inaccurate "nothing is ever uploaded" phrasing.
- New **Past forms** tab is an honest placeholder (a versioned on-device history of filled forms is
  pending, now that fill is decoupled from the catalog entryId flow).

### Added — Viewer OCR-translate path for scanned / legacy-font forms (2026-07-21) — RFC-0008
- The language panel now has a **"scanned / non-standard font (read with OCR)"** toggle and a
  **source-language picker**. When on, the viewer renders each page, OCRs it in the chosen
  script's Tesseract pack, translates every line via NLLB, and shows **source ↔ translation** —
  the path for forms whose text layer is garbage (e.g. Karnataka govt Kannada forms). Engine
  (`translateScannedPdf`, source-pack-aware) is fully wired to the UI.
- Panel now opens even when a form has no usable text layer (so OCR is reachable).
- NOTE: in-browser end-to-end needs the hosted NLLB + Tesseract packs (see
  `docs/launch/universal-language-hosting.md`); validation on the Kannada form is the last gate.

### Added — Universal language support: foundation + honest UX (2026-07-21) — RFC-0008 / ADR-0018
- **The product must be language-AGNOSTIC** (polyglot), not a fixed 8-language list. First step:
  `src/langcodes.js` — a registry mapping ISO → FLORES-200 (NLLB) → Tesseract pack, with
  Unicode-range script detection covering all major scripts (Kannada, Tamil, Telugu, Malayalam,
  Bengali, Gujarati, Punjabi, Odia, Sinhala, Devanagari, Arabic, CJK, Kana, Hangul, Thai, Hebrew,
  Greek, Cyrillic…). Adding a language = one data row. Tested (`langcodes.test.mjs`).
- **Honest viewer UX:** the language view no longer claims "Viewing this form in your language"
  when nothing was translated; a form whose text can't be read (scanned / legacy non-Unicode font,
  e.g. Karnataka govt Kannada forms) is reported as such instead of "already in English".
- Design recorded: **RFC-0008** (universal support: NLLB-200 translation + dynamic Tesseract OCR
  packs + render→OCR fallback for garbage text layers) and **ADR-0018** (language-agnostic engine).
- PENDING (proof-gated, per RFC-0008): host NLLB + priority OCR packs on object storage; wire the
  universal any→any translate + render→OCR fallback; validate in-browser on Kannada/CJK/RTL before
  marking the capability done. Confirmed in this session: the Kannada form renders correctly in the
  browser (so render→OCR is viable), and its text layer is legacy-font garbage (so OCR is required).

### Fixed — proximity result reached the viewer + passport issue date (2026-07-21)
- **popup.js:** proximity-filled PDFs were flagged `xfa:true`, so the viewer fast-path rejected them
  and the OCR fallback re-filled from scratch — DISCARDING the proximity fill. Marital status, dates,
  and dropdowns silently vanished. Proximity results now route to the viewer.
- **resolver.js:** the bare vault key `passport_issue` matched no alias (only `passport_expiry` did),
  so "Date of issue" stayed blank while "Date of expiry" filled. Added `passport issue` aliases.

### Added — Proximity form-filling for opaque XFA / OCR'd PDFs (2026-07-21)
- New reusable `src/pdfproximity.js`: fills PDFs whose AcroForm field names are meaningless
  (LiveCycle/XFA exports like `T2`, `RB3`, `emp_adr`) by matching each box to its nearest PRINTED
  caption + section header — **purely geometric, no per-form rules**. Resolves caption→value with
  the shared semantic resolver. Handles: long labels that overrun the box edge, radio groups with
  opaque export values (via per-option printed labels), dropdown/list boxes, day-first date
  reformat from a `(Day)/(Month)/(Year)` hint, and a whole-word/stem **entity guard** that leaves
  employer/ship/hotel/guarantor/inviter/partner boxes blank (never the applicant's own identity).
- `src/pdffill.js`: new `fillPdfByProximity(bytes, vault, texts)`; `popup.js` extracts the pdf.js
  text layer and uses it whenever a form is detected as XFA/opaque and it beats the name-based pass.
- Resolver gained `occupation`, `birthplace`, `passport_type` concepts and a `given+middle` composite.
- **Proven on the real Japan MOFA visa form (000124525.pdf):** 16 applicant fields filled correctly
  (name, DOB day-first, place of birth, sex, marital, nationality dropdown, passport type/no/expiry,
  address, phone, email, occupation) with all other-entity blocks correctly left blank.
- Tests: `pdfproximity.test.mjs`, `pdffill.proximity.test.mjs` (104 total passing).

### Added — Pro gating (Translation & image fields) + Lemon Squeezy setup guide (2026-07-21)
- Gating matrix decided (owner): **Free** = autofill (web+PDF) + ID/passport scanning + 1 profile;
  **Pro** = on-device translation + photo/signature fields; **Family** = profiles + sync.
- Enforced on-device: `license.js` gains `tierAtLeast`/`isPro`; the popup gates "View in my
  language", the translate tool, and image-field upload behind Pro; the viewer's language panel
  shows a Pro upsell instead of translating when unlicensed. All verified locally (no phone-home).
- `docs/launch/lemonsqueezy-setup.md`: step-by-step owner guide (products, variant IDs, webhook
  secret, device-binding choice, deployment, PPP, and the store "in-app purchases" switch).

### Added — Extension offline licensing (Lemon Squeezy → on-device verify) (2026-07-21)
- `apps/extension/src/license.js`: the JS counterpart of the Rust `core-license` crate — verifies
  a signed `PPDF1.…` token **on-device** with Web Crypto Ed25519 against the embedded vendor
  PUBLIC key (matches the desktop `VENDOR_PUBLIC`). Checks expiry + per-install device binding
  (ADR-0015, ADR-0011). No activation server, no phone-home — privacy invariant intact.
  `getEntitlement()`/`hasFeature()` expose the tier + feature flags; `license.test.mjs` locks it
  (genuine token accepted, wrong-device/tamper/garbage rejected). 58 extension tests green.
- Popup **License** section: shows this device's ID (for checkout), paste-to-activate, status
  badge, and remove — all offline. Storefront pipeline (`scripts/license/*`, Lemon Squeezy
  `webhook.mjs`) already existed; this connects the extension to it.

### Added — "✕ Close" in the viewer returns to the original form (2026-07-21)
- The generated filled/view page now has an explicit **✕ Close** button in the bar that leaves
  the view and goes **back to the original form** (its source URL; falls back to browser-back,
  then closing the tab).

### Fixed — Fill no longer pops open the translation panel (2026-07-21)
- On "Fill this page" the bilingual panel opened automatically, showing the translated view
  the user didn't ask for. The panel now opens **only** in View mode ("View this page in my
  language"). On Fill it stays closed; the "🌐 Language panel" toggle remains available if the
  user does want to read it translated. Translation never runs unprompted on Fill.

### Added — One-command dev loop: auto-load + hot-reload the extension (2026-07-21)
- `deploy/dev-launch-chrome.ps1` launches a DEDICATED Chrome (separate persistent profile,
  main browser untouched) that auto-loads the extension straight from `apps/extension` — no
  zip, no website, no manual "Load unpacked". Opens the remote-debugging port.
- `deploy/dev-reload.mjs` hot-reloads that extension via CDP (`chrome.runtime.reload()`),
  which re-reads the source from disk — so applying the latest code is one command, zero clicks.
- Fixed the real blocker: the user folder has a SPACE ("Subramanya Mysore"), which split
  Chrome's `--user-data-dir`/`--load-extension` flags and silently merged into the default
  profile with no extension. The launcher now passes **8.3 short paths** (no spaces).

### Changed — "View in my language" is a split view: original left, translation right (2026-07-21)
- View mode now shows the **untouched original form on the left** (editable) and its
  **native-language representation on the right**, and **auto-runs the translation** so the
  right is populated immediately (no extra "Translate" click). Closing the right panel (✕)
  leaves the left form full-width and fully workable **without reloading it**; the bar's
  "🌐 Language panel" re-opens it. (A form opened in Chrome's OWN PDF viewer can't host our
  panel — extensions can't inject into Chrome's PDF plugin — so there is one transition into
  this split page; after that, opening/closing the panel never reloads the form.)

### Fixed — Panel header words ("Label"/"Value") shown in the reader's language (2026-07-21)
- The bilingual panel's column headers were always English ("LABEL · हिन्दी"). Each header word
  is now written in that column's own language (e.g. लेबल · हिन्दी, मान · हिन्दी) via a small
  fixed `UI_TERMS` dictionary for the 8 supported languages — no MT needed for two words.

### Fixed — Warn before a fill discards edits made in Chrome's PDF viewer (2026-07-21)
- Filling re-fetches the ORIGINAL PDF from its URL (extensions cannot read the edited state
  of Chrome's built-in PDF plugin — no API exists), so selections a user made in that viewer
  were silently replaced. Filling a PDF now shows a **confirm** first, explaining the edits
  can't be merged and recommending the order that works (fill first, then complete the rest in
  the extension's own viewer). Our own viewer is exempt from the prompt. Also added a Download
  tooltip: to keep fields completed on screen, use the PDF's own Save (the extension's Download
  link saves the pre-edit filled bytes).

### Changed — Language panel UX + user-selectable fill language (ADR-0017) (2026-07-20)
- **"View this page in my language" is now READ-ONLY** — it shows the form and the would-be
  values in your language and no longer FILLS the document (view-only path via `runPdfFlow(view)`;
  the viewer shows the original PDF and the bar says "Viewing… NOT filled").
- **The side panel is closable and re-openable** — an ✕ on the panel and a "🌐 Language panel"
  toggle in the bar.
- **Language dropdown in the panel** — read/work with the form in any language, ordered
  **your language → the form's language → the rest alphabetically**; a language's model
  **downloads only when you pick it** (lazy).
- **ADR-0017 (governance):** recorded the owner's decision that **fill language is
  user-selectable** and the exported form reflects the chosen language — formally **superseding**
  the previously etched "output always in the form's original language" invariant. Spec/memory
  updated. Default fill language stays the form's own language; choosing another is explicit.
  (Implementation of writing translated/transliterated values INTO the exported PDF is the next phase.)

### Fixed — "Value · <your language>" column is now actually in that language (transliteration) (2026-07-20)
- The your-language value column showed names/numbers in Latin under a e.g. "हिन्दी" header.
  A name is not *translated* (that hallucinated "Mexico") — it is **transliterated**: its sound
  written in the reader's script. New on-device `translit.toScript`: "Pranav Subramanya" → प्रणव
  सुब्रमन्य, "12" → १२ (Hindi/Arabic digits localised), Russian → Cyrillic, Arabic → Arabic script.
  **Latin-script targets (es/fr/de) correctly keep the original spelling**; Chinese passes through
  (no phonetic letter script). Genuine word-phrases are still translated. Phonetic → approximate;
  `translit.test.mjs` locks the invariants (53 extension tests green).

### Fixed — Language-panel resize now sticks (iframe-drag bug) (2026-07-20)
- Dragging the panel's resize handle "stuck" / kept resizing after release because the PDF
  `<iframe>` swallowed the mouse events, so the parent page never saw `mousemove`/`mouseup`.
  The drag now disables the iframe's pointer events for its duration (and suppresses text
  selection), and ends on `mouseup`/`blur`. Panel is `flex: 0 0 auto` so the set width holds.

### Changed — Filling no longer auto-downloads the PDF (2026-07-20)
- The viewer used to auto-save the filled PDF to Downloads on every fill, piling up
  `…-filled (2).pdf`, `(3)`, … The result is now just **shown** in the interactive viewer;
  the **Download PDF** link in the bar is armed so the user saves it only when they choose to.

### Changed — "View this page in my language" now works on PDFs (shows translated labels+values) (2026-07-20)
- Previously the in-page translate button dead-ended on a PDF with a message (a PDF renders in
  Chrome's plugin, whose text an extension can't rewrite in place). Now, on a PDF, the button runs
  the **same pipeline as Fill** and opens the viewer with the **bilingual side panel** — every
  label AND value shown in the user's language, exactly the post-fill translated view they asked
  for. The PDF fill pipeline was extracted into a shared `runPdfFlow` used by both buttons.

### Changed — "Show original form" now returns to the form's real location (2026-07-20)
- The viewer records the form's source URL (`ppf_url`) when filling a web/local PDF. The bar
  button now reads **"Go to original form ↗"** and **navigates the tab back to that URL** — the
  browser returns to the original form exactly where it lived (the filled PDF was already
  auto-downloaded, so nothing is lost). When there is no source URL (a scanned image / OCR of
  local bytes), it falls back to the previous in-place blank⇄filled toggle.

### Fixed — Bilingual panel: show original labels + stop mangling name/number values (2026-07-20)
- **Original-language labels now shown alongside your language.** The side panel is now four
  columns: **Label · <form lang> | Label · <your lang> | Value · <form lang> | Value · <your lang>**.
- **Values are no longer machine-translated when they're names/numbers/IDs/emails/dates.** A field
  value is the user's own data and is the same in every language; running proper nouns through the
  MT model produced garbage (a dependent's name "Pranav Subramanya" was hallucinated into "Mexico";
  a name was truncated to nonsense). New pure, unit-tested gate `valuefmt.isTranslatableValue`
  translates only genuine word-phrases (e.g. "married", "self employed") and shows everything else
  verbatim. `valuefmt.test.mjs` locks the behaviour (now 47 extension tests green).

### Fixed — Clean up benign camera console warning (2026-07-20)
- **Removed the `autoplay` attribute from the scan `<video>`** so the @zxing barcode reader
  owns `play()`. With `autoplay`, the browser started playback first and zxing's
  `canplay → tryPlayVideo` then logged a harmless "Trying to play video that is already
  playing." warning that surfaced in the extension's Errors panel. Behaviour is unchanged
  (zxing still starts the stream); the console is now clean. (The other Errors-panel line —
  "Connecting to 'data:application/octet-stream;base64,…'" — is Chrome noting a bundled WASM
  runtime loaded as an inline `data:` URI; expected and required by the offline-only design.)

### Added — Viewer original/filled toggle, bilingual values & a real test suite (2026-07-20)
- **"Show original form" toggle in the filled-PDF viewer:** the result view now keeps both
  the original (blank) and filled bytes and switches between them (bar label + download link
  follow), instead of only offering the filled download. Original comes from the pre-OCR
  source (OCR path) or the stashed unfilled bytes (`ppf_orig`, AcroForm path).
- **Bilingual side panel now shows VALUES, not just labels:** each row renders the field's
  label AND the value that will fill it, both translated into the user's language (on-device);
  per-string translation cache; the filled form itself still stays in the form's own language.
  `fillPdfBytes` now returns label+value `pairs`. Panel is **resizable width-wise** (drag handle).
- **Automated regression suite for the extension's pure-logic modules** — the scenarios
  previously verified by hand are now `node --test` unit tests (`pnpm -r test` runs them):
  `parse.test.mjs` (AAMVA US/CA, MRZ TD1/TD2/TD3, phone-vs-DLN, passport-authoritative),
  `resolver.test.mjs` (semantic aliases, age-from-DOB, dependent DOB, SSN split, composites),
  `profileMatch.test.mjs` (identity match by name+DOB), `forms.test.mjs` (W-2/W-4/W-9/I-9
  recognition), `lang.test.mjs` (8-language detection). Added the missing `test` script to the
  extension package so these run in CI. **42 tests green.** Corrected one stale vault test
  (keys are intentionally extractable now — required for the session cache that survives MV3
  service-worker eviction).

### Added — Extension capture, intelligent fill & desktop parity (2026-07-20)
- **On-device ID/document capture (extension):** camera or image file → Tesseract OCR
  (shared worker, `tess.js`) → `parseFields` heuristics → review-and-save to vault.
  Grayscale + contrast-stretch + upscale preprocessing for glossy IDs, plus
  **over-exposure/glare correction** (gamma-darkening when the image is washed out).
- **MRZ parsing — international (ICAO 9303, `parseMrz`):** the machine-readable zone is a
  worldwide standard; parse ALL three formats — TD3 (passports), TD1 & TD2 (national ID
  cards) — surname/given/doc-no/nationality/DOB/sex, treated as authoritative. Driver's-
  licence heuristics no longer run on passports. Verified against ICAO specimen strings
  (TD1/TD2/TD3) and a real USA passport OCR.
- **Inline unlock on the scan page**; **glassy Retake button**; profile identity-matching
  helper (`profileMatch.js`, name+DOB) toward create/overwrite-a-profile-from-scan (RFC-0007).
- **Driver's-licence OCR robustness:** recover surname from the line above the given-names
  line when the AAMVA "1" marker is garbled; match the address anywhere in a line; recover
  city from "City, ST ZIP" even when the state OCRs wrong; reject junk city tokens (leave a
  field empty rather than emit wrong data).
- **Document-image fields:** the whole captured picture is saved keyed by type AND side —
  `driver_license_back` (decoded PDF417 barcode = back), `driver_license_front` (printed/OCR
  side), `passport_image`, `document_image` — shown as a thumbnail; resolver `drivers_license`
  (front; also the generic "attach a DL copy" target), `drivers_license_back`, and `passport_copy`
  concepts place the image into a form field that asks to ATTACH a copy (drawn fitted+centred;
  OCR-draw path skips image values). See `docs/specs/document-image-fields.md`.
- **PDF417 back-of-licence barcode scanner:** `@zxing` (vendored, self-contained ESM) +
  `parseAamva()` → exact structured data (name/address/city/state/ZIP+4/DOB/sex/licence#).
  Tried first on any capture; OCR is the fallback. Verified end-to-end in a loaded extension.
- **Driver's-licence / ID OCR parsing:** unlabelled + AAMVA-field-number heuristics (surname/
  given/address/city/state/ZIP/DOB); phone no longer grabs a long ID number.
- **On-device OCR fill for XFA/LiveCycle & scanned PDFs (W-2):** render→red-dropout→OCR→
  segment→resolve→draw; runs in the persistent viewer tab.
- **Form templates:** IRS W-2 (OCR), W-4/W-9 (deterministic AcroForm field-NAME templates),
  I-9 (AcroForm) — form recognition + per-form field maps (`pdfforms.js`).
- **Image-valued fields:** store a photo/signature as a field value; drawn fitted+centred into
  matching PDF photo/signature boxes.
- **Interactive filled-PDF viewer:** Chrome's native PDF viewer via `<iframe>` (blob) so
  unfilled AcroForm fields stay editable.
- **Semantic value derivation:** compute **age from a date of birth** (`age`, `dependent_age`);
  numbered dependent keys (`dependent_1`) map to the dependent concept.
- **Language-aware filling (extension + desktop):** `native_language` as a vault profile field;
  form-language auto-detect (`lang.js`, 8 languages); any-to-any translation via English pivot;
  bilingual side panel; Devanagari/CJK output fonts (fontkit + hosted Noto). See
  `docs/specs/language-aware-filling.md`.
- **Desktop parity:** resolver + form templates + language detection + fonts ported to the Tauri
  app's TS fill pipeline (`apps/app/src/fill/`); `tsc` + `vite build` verified.
- **One-command redeploy:** `deploy/publish-extension.ps1` (rebuild zip → publish site).

### Fixed (2026-07-20)
- **Translation runtime was entirely broken** (every language feature): the vendored
  `transformers.web.min.js` had an unresolved bare import (`onnxruntime-common`) that fails
  in an unbundled extension. Re-bundled `@huggingface/transformers` v3 self-contained via
  esbuild (`transformers.bundle.mjs`) + matching ONNX WASM. **Validated end-to-end in a loaded
  extension: "Name" → "Nombre".** Now that the engine works, "Fill this page" is LANGUAGE-AWARE (detects a foreign form, translates its labels to English so the resolver matches, fills; values placed as-is so the submitted form stays in its own language). Also adds MRZ passport `expiry_date` (+ best-effort issue date)
  and a capture-page processing spinner.
- Extension failed to load — `blob:` is invalid in MV3 `object-src`; reverted, use `<iframe>`.
- OCR modules dead — vendored Tesseract exports only a default; `import { createWorker }` threw
  and killed capture + PDF-OCR. Import the default namespace.
- Vault re-locked mid-use — MV3 evicts the service worker; mirror the unlocked session into
  `chrome.storage.session` (memory-only) and restore on respawn.

### Added
- Initial SDD + Memory Bank + governance scaffold.
- Product vision & full requirements (projectBrief pillars #1–#14): privacy-first on-device PDF/form
  autofill, translated-fill, Form Catalog, data-source extraction, profiles/subscriptions,
  non-delegable + in-person biometric signing, multi-party documents, authority-scoped provenance,
  registered roles & verifiable workflows.
- Feasibility trials (`docs/feasibility/`): worst-case OCR/field-detection (conditional GO) +
  market/tech reassessment.
- **RFC-0001 accepted**; **ADR-0002…0010 recorded** (native stack, encrypted sharing, non-delegable
  signing, Form Catalog, signing hand-off, biometric signing, multi-party, provenance, roles).
- UML model (use-case, component, domain class, sequences, lifecycle) published.

- **Persistent vault + CRUD:** `core-store` gains `list_profiles`/`data_points`/`delete_data_point`
  (+ tests); app manages a persistent SQLite store under the OS app-data dir with commands
  `create_profile`/`list_profiles`/`list_data_points`/`upsert_data_point`/`delete_data_point`/`autofill_for`.
- **Vault manager UI:** create profiles, add/edit/delete data points, and catalog-first autofill per
  selected profile (`apps/app/src/App.tsx`).
- **Phase-1 vertical slice (catalog-first autofill):** `core-store` (SQLite on-device vault + tests),
  `core-catalog` (field-maps + `autofill` join + tests), app command `demo_autofill`, UI table.

- **Catalog search + matching:** `core-catalog` gains tags, on-device `search` (name+tags, ranked),
  `match_by_fingerprint`, and a 3-form demo catalog (+ tests). App: `catalog_search` command and a
  "Find a form" search UI; `autofill_for` now targets the chosen form.
- **On-device OCR data-source extraction (REQ-10):** app imports a passport/licence image, runs Tesseract.js OCR in the webview (image never leaves the device), extracts key-values via patterns, and saves to the vault after review. Build-verified; runtime needs the live app.
- **On-device translation (REQ-03):** app translates field labels English↔Hindi via transformers.js (ONNX/onnxruntime-web WASM), fully SELF-HOSTED — models + ort WASM load from the app origin (connect-src stays self), text never leaves the device. Lazy dynamic import; models provisioned by scripts/fetch-translation-assets.mjs (not committed).
- **Submit online (REQ-07):** `open_submit_url` opens the vendor/gov submission page in the default browser (user submits there directly — never proxied); warns on insecure HTTP. Filled PDF exports locally. + URL input UI.
- **PDF render + fill/export (REQ-02):** app opens a PDF, renders page 1 with pdf.js, fills AcroForm text fields from the vault via pdf-lib (matched by field name), and exports the filled PDF — all on-device (bundled worker, no egress).
- **Device signing (REQ-09 Tier-1 functional):** app `sign_form` — a device Ed25519 key (OS keystore) signs the latest saved versions hash inside a provenance manifest; signature stored (signatures table) + UI Sign button. Non-delegable (device+profile key). `form_signatures` lists them.
- **Web features (REQ-11):** `core-fetch` validates form URLs (http/https only, blocks private/loopback/link-local/metadata hosts) and `core-webform` builds a DOM fill-plan from the vault. Native download + webview injection wire to these. 6 tests.
- **OIDC identity broker (signing Tier 1 foundation):** `services/account` OIDC service — PKCE,
  SSRF-guarded discovery, and JWKS ID-token verification returning an identity assertion only
  (never content). **Adapted/reused from the Hospital Nexus SSO** and re-scoped to our local-first,
  content-free model; bound to on-device Ed25519 for non-delegable signing. 5 unit tests.
- **Registered roles:** `core-identity` Role/Capability model + Registry (role asserted on sign-in,
  scopes capabilities). Encodes the **non-delegable-signing rule structurally** — no role, not even
  InstitutionAdmin, holds a delegated `Sign` capability. 4 tests. (REQ-14; REQ-06 search bar marked.)
- **Save filled form:** app `save_filled_form` command + UI Save button — autofills, appends an immutable encrypted version, and records a save event (shows version + count). REQ-07 (save).
- **Form versioning & history:** `core-store` gains `FormInstance`, an **immutable encrypted version chain** (`add_version`/`list_versions`/`version_values`), and save/submit/print history counters. 6 tests. (REQ-08; annotation layers pending.)
- **Multi-party workflow:** `core-txn` state machine (Draft→Gathering→Assembled→Circulating→PartiallySigned→FullyExecuted, with Withdrawn + ChangesRequested), per-party consent + signatures, and the re-sign-on-edit invariant (editing clears signatures). 6 tests.
- **Verifiable provenance:** `core-crypto` `ProvenanceManifest` (SHA-256 doc hash + Ed25519 sign/verify, tamper-detecting) — the public/verifiable part of ADR-0009. 10 tests total.
- **Signing + E2E sealed bundles:** `core-crypto` adds **Ed25519** sign/verify (signatures +
  provenance foundation) and **X25519 ECIES sealed bundles** (`seal_to`/`open_from`, the basis for
  user-directed E2E export/import per ADR-0003). 8 tests total.
- **Encryption at rest:** `core-crypto` AES-256-GCM seal/open (random nonce, tamper-detecting).
  `core-store` now **seals DataPoint values before they touch disk** (DB holds only
  ciphertext; verified by `values_are_encrypted_at_rest`). App loads/creates a per-install key
  (OS keystore in production).

- **Versioned 0.1.0** (app, extension, workspace).
- **Offline licensing (core-license, RFC-0005 / ADR-0015, REQ-17):** Ed25519-signed license tokens (tier/features/expiry) verified fully on-device against an embedded vendor public key — freemium monetization with no activation server and zero telemetry. 5 unit tests.
- **Go-to-market docs:** store-listing copy (Chrome/Edge/Firefox + ASO keywords) and a privacy policy (docs/marketing/).
- **Companion auto-registration + passphrase→passkey migration:** the native app bundles the host binary (beforeBundleCommand builds it; Tauri resources ship it) and exposes a user-initiated register_companion command (writes the native-messaging manifest + Chrome/Edge registry via winreg) with a Browser-companion UI (section 6). The extension can migrate an existing passphrase vault to a passkey (re-seals the unlocked vault under a WebAuthn-PRF key). Migration crypto unit-tested.
- **Extension companion bridge + passkey enrolment (RFC-0004 / ADR-0014):** new native-messaging host crate (native-host, projectpdfs-host bin) reads the app's on-device encrypted vault (same OS-keystore key + SQLite) and serves it to the extension over the browser native-messaging protocol — so the vault/keys stay in the trusted native binary, not store-served code (closes the served-code gap). Windows register script + manifest template. Extension: companion connect + "Fill from native app" button; WebAuthn passkey enrolment options page. Host stdio framing unit-tested (2); vault crypto 5; JS syntax-checked.
- **Images against keys (profile photo, signature):** the vault can now hold images per key, stored as a sealed base64 data-URI (encrypted at rest like any value, on-device). Vault UI adds an image picker and renders image values as thumbnails. (Placing them onto PDFs is a follow-up.)
- **Native app sign-in gate (passphrase lock):** the desktop app now requires a passphrase to open — a lock screen on launch (set on first run), and every data command is gated server-side (refuses until unlocked). Salted, 100k-iterated verifier stored on-device; at-rest encryption unchanged. Closes the gap where the app auto-opened from the OS keystore. A Lock button re-locks on demand.
- **Base language + bidirectional translated fill (REQ-03):** users pick their base (comfort) language; a form can be shown translated into it for VIEWING only, and data entered in the base language is converted BACK to the form's original language before it fills/submits — so the form stays in its authored language while the user works in theirs. On-device NMT (en↔hi), zero egress.
- **Browser-extension client, secure (RFC-0004 / ADR-0014, REQ-16):** MV3 extension scaffold (apps/extension) with a built-in encrypted vault — AES-256-GCM whose key is derived on unlock from a passphrase (PBKDF2) or a passkey (WebAuthn PRF, hardware-backed) and never stored (memory-only, non-extractable). Background service worker + popup (passphrase/passkey unlock, fill/lock) + page autofill; least-privilege, no remote code. Served-code trust gap shrunk via WebAuthn-PRF unlock + companion native-app trust anchor + reproducible builds. Vault crypto unit-tested (5).
- **Web search to locate forms (ADR-0013, opt-in egress exception):** search the web for a form by name; results feed the on-device download→fill pipeline. The query goes device → DuckDuckGo directly (privacy-respecting, no tracking), never via our servers, carrying ONLY the typed terms — a user-directed egress in the same category as Submit-online, prominently labelled. core-fetch web_search + DDG result parser (unit-tested, validated vs live HTML) + web_search command + UI with warning.
- **Office to PDF export, on-device (RFC-0003 / ADR-0012, Phase C Tier-1):** an `Export as PDF` action turns a filled Word/Excel form into a readable, signable PDF using pdf-lib (no new dependency, no sidecar, cross-platform). Content export (text in reading order), not pixel-faithful; non-Latin glyphs degrade until a Unicode font/Tier-2 ships. Flows into the existing render/sign/submit path.
- **Word/Excel flat-form fill (RFC-0002 Phase B):** for `.docx`/`.xlsx` with **no** named regions, values are placed by detecting flat labels — Word table label→next cell and “Label:” paragraphs; Excel label cell→right/below neighbour (reads shared strings). Runs as a fallback after the named-region pass; on-device.
- **Fill Word/Excel forms (.docx/.xlsx), on-device (RFC-0002 Phase A):** named fillable regions are filled from the vault — Word **content controls** (w:sdt tag/alias → ontology key) and Excel **named ranges** (definedName → cell). OOXML is unzipped (fflate), edited (fast-xml-parser, order-preserving), re-zipped, and downloaded as a filled file. No Office runtime, no server, no upload. Unit-tested; verified end-to-end in the UI.
- **Fill a form from the web (URL):** paste a form URL; the app downloads it **on-device** (new `core-fetch::fetch_form` via reqwest/rustls + `download_form` command) and runs the same auto-detect → fill pipeline. SSRF-guarded (http/https only, private/loopback/link-local blocked, every redirect hop re-validated), 30s timeout, 25 MB cap. Inbound-only download — no user content goes up. PDF or image; Word/Excel from URL not yet.
- **Windows code signing (Authenticode):** opt-in, secret-free signing hook (`sign-windows.ps1`) wired via `bundle.windows.signCommand`. Signs the app exe, MSI, and NSIS setup + RFC-3161 timestamps them when a cert is provided via env (`WINDOWS_CERT_THUMBPRINT` or `WINDOWS_CERT_PFX`); skips gracefully (unsigned) with none set, so dev builds still work. Self-signed dev-cert generator + docs (`docs/reference/code-signing.md`). Verified end-to-end: signed build produces signed MSI + setup.exe.
- **Image of a form → editable PDF (REQ-02):** a PNG/JPG photo or scan is wrapped into a PDF page on-device (`imageToPdf`, pdf-lib embedPng/embedJpg), then the OCR-detect → make-fillable → fill pipeline turns it into an editable, filled form. Section-5 file picker now accepts images; nothing is uploaded.
- **OCR/CV field detection for UNCATALOGUED PDFs (REQ-02 fallback):** `detect.ts` renders the page (pdf.js), OCRs it on-device (self-hosted Tesseract, with bounding boxes), maps label-like lines to ontology keys, converts canvas px → PDF points, and feeds the create-fields code — so a scanned/flat PDF we have no catalog map for gets fields auto-placed + filled. "Detect fields (OCR) & fill" UI.
- **Make a non-editable PDF fillable (REQ-02, the core gap):** catalog field-maps now carry per-field **coordinates + kind**; the app CREATES AcroForm widgets on a FLAT PDF (no form fields) at those coordinates via pdf-lib, fills them from the vault, and exports a new fillable+filled PDF. Verified end-to-end (flat PDF 0 fields -> 3 created + filled + persisted). "Generate flat sample PDF" + "Make fillable & fill" UI.

### Fixed
- Windows `LNK1201` (.pdb write/lock contention under AV/Drive) on test builds — `[profile.test] debug = 0`.
- Repo bloat: gitignored + removed Google Drive sync artifacts; `git gc` reclaimed accidental blob bloat.
- `services/catalog` (Node) public catalog API stub + `packages/shared` TS domain types (both typecheck).
- Requirements: 14 pillars written as `REQ-01.1…REQ-14.1` (BRD + traceability matrix; check green).
- **Tauri v2 desktop app** (`apps/app`): React/TS UI + Rust `src-tauri` wired to the core crates —
  `cargo build` links and produces `app.exe`; frontend builds; icon set generated.
- Rust workspace (`Cargo.toml` + 11 `crates/core-*` stubs) — builds + tests green.
- Dev-environment setup + toolchain install (`docs/reference/dev-setup.md`): Rust 1.97 (MSVC) +
  Android targets, VS 2022 C++ Build Tools, JDK 17, WebView2 verified.
- Modular repo skeleton (`apps/app`, `crates/`, `services/`, `packages/shared`) + `repo-structure.md`.

### Changed
- Architecture direction finalized: **native (Tauri v2 + Rust + React/TS)**.

### Removed
- Old server-centric scaffold `apps/api` (Express) + `packages/db` (Drizzle/Postgres) — superseded by
  the native, local-first architecture (RFC-0001 / ADR-0002).

<!--
Release template:

## [1.0.0] - YYYY-MM-DD
### Added / Changed / Deprecated / Removed / Fixed / Security
- ...
A release tag MUST correspond to a reproducible build/commit (tag == deployed image).
-->
