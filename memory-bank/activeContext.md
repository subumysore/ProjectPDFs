# Active Context

## XFA/LiveCycle form fill + DL surname OCR — 2026-08-02 (ADR-0030)
- **Hybrid-XFA forms (USCIS N-400, I-130) now fill & stay editable.** pdf-lib can't parse them (0 fields,
  `getPages()` throws) → fall back to pdf.js widgets + `annotationStorage` + `saveDocument()`, boxes labelled
  by printed caption (shared proximity planner). New `apps/app/src/pdf.ts::fillXfaByWidgets`. Wired into
  auto-fill + the (now prominent) "Fill from my vault" button. Proof: `docs/testing/pdf-fill-battery-2026-08.md`.
- **DL surname "MYSORE" now read.** Sparse-text PSM 11 OCR pass + AAMVA field-1 authoritative in desktop
  `ocr.ts` AND extension `parse.js` (parity). Tests: desktop 8/8, extension 12/12.
- **Built desktop 1.0.6 (unsigned local test)** — NOT published, version NOT bumped (per owner's standing hold).
- **Session 2 (2026-08-03) — made it actually work in the app + polish, all proven by driving the REAL app.**
  Root causes only visible in the webview (not Node): encrypted-PDF load threw (→ `ignoreEncryption` on every
  load); `fillAndExport` threw on the N-400 page tree (→ early-return 0 + callers catch→route to widget fill);
  preview render race (→ dropped `renderFirstPage` when FormView renders). Added: auto-select lone/last profile
  (persisted, `ppf.lastProfile`); prompt-to-save answers to vault keyed by printed caption (`fieldCaptions`);
  larger form + zoom; glass tabs/buttons; teal checkbox outlines. **Extension parity:** new `pdfxfa.js`
  (mirrors desktop) wired into `popup.js`; ext already had `ignoreEncryption`; ext PDF tests 37/37.
- **Automated real-app testing harness (NEW, reusable):** launch `app.exe` with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, connect puppeteer-core to Edge/WebView2,
  drive unlock (passphrase)→profile→load→fill, screenshot. Proved N-400 86/391 + I-130 170/405 fill & render.
  (puppeteer-core added as devDependency.) Temp test PDFs `_*_test.pdf` gitignored.
- **CLAUDE.md rules added:** §8b dual-surface testing (EXE **and** extension), §4b parallelism.
- **Session 3 (2026-08-03 cont.) — "fix everything + build unbuilt features":**
  - **i18n suite green (343/343):** localised the updater Later/Update-now/Installing buttons (`update.*`
    keys) + added the missing `guide.watch` key, across ALL 26 languages (were 3 pre-existing failures).
  - **Grouped records (cards/addresses) BUILT on desktop** (memory [[grouped-records-cards]]): reuses
    `@engine/groups.js`; records stored as one JSON data point `__records` in the vault (no Rust change);
    `buildVault()` merges the PRIMARY card+address over the flat vault at fill; UI in Profile & Vault
    (add/star-primary/remove, CVV optional + card masked). Was engine+tests only, unwired on both — now
    wired on desktop. TODO parity: extension records UI + per-fill chooser (non-primary pick).
  - Confirmed already-built: signature/photo fill (imagefill) + multi-profile UI.
  - **Extension XFA + web-form autofill LIVE-verified in Edge AND Chrome** (headless): N-400 66/391 editable;
    ATS form 11/11 incl. radio+select. Harness: static server + puppeteer-core + system Edge/Chrome.
  - Bug found via real-app driving: record input onChange read `e.currentTarget.value` inside the setState
    updater (pooled-event null) → crash; fixed by capturing the value first. Lesson reinforces [[automated-app-ui-testing]].
- **OPEN / needs owner:** (1) extension XFA fill needs LIVE in-browser verification (code+unit-tests done);
  (2) IRS W-4/W-9 (no tooltips, labels-above-boxes) fill weakly — documented; (3) live web-form battery
  (Salesforce/ServiceNow/LinkedIn/…) NOT run — needs owner accounts + browser; real submissions violate privacy;
  (4) **publishing BLOCKED** — F: signing key offline (unsigned only); no version bump per owner's standing hold.



## Marketing site fully localized in all 26 UI languages — 2026-07-25
- `docs/marketing/build-site.mjs` rewritten: FULL landing + privacy + install rendered per language from
  ONE template set + a per-language catalogue, replacing the old ~3 KB per-language stubs. English at
  `/`, `/privacy/`, `/install/`; every other language at `/<lang>/…`.
- SSOT: English site copy lives in `docs/marketing/i18n/en.json` (188 keys); 25 sibling `<lang>.json`
  files carry the translations. Shared strings (`app.*`, `privacy.*`, `site.*`) still sourced from
  `apps/extension/src/i18n.js` (not duplicated). Validator: `docs/marketing/check-i18n.mjs` (all pass).
- Language switcher on every page + language-preserving nav/footer/switcher links; RTL for ar/he/fa/ur;
  Hello background on all localized landings; PPP script, install version injection, SEO meta preserved.
- **NOT deployed** — build is local only; owner reviews before `publish-site.ps1`.
- **HEADS-UP (incoming, not done here):** pricing model changing (Free→30-day trial, Family 5→2 devices,
  drop annual). Owner will update English `price.*` keys and re-translate just those separately. The
  structure/switcher/links/RTL are complete for all 25 languages regardless of that copy change.

## Desktop ID import → retains the document image (extension parity, SSOT) — 2026-07-25
- Desktop "Import a data source" (`App.tsx onDataSource`) now saves the whole licence/passport IMAGE
  alongside the extracted text, under the SAME shared-vault ontology the extension already writes
  (`driver_license_front`/`driver_license_back`/`passport_image`/`document_image`). One pure classifier
  `documentImageKey()` in `apps/app/src/ocr.ts` (unit-tested, `ocr.test.mjs` +1). Thumbnail + default-on
  checkbox before "Save N to vault". Corrected a brief `*_scan` key divergence that would have broken the
  shared vault. Spec `docs/specs/document-image-fields.md` updated with the desktop-capture section.
- **Guide video (in flight):** re-recording flagged segments LIVE (not static shots) via a new reusable
  recorder `scripts/reclive.mjs` (fixed-rate screenshots + real timing + visible cursor/highlight;
  fixes a WebView vite-dep `ERR_CACHE_READ_FAILURE` by clearing cache on load). Done: v2-02-id
  (DL front OCR→fields+saved image · honest back-of-card beat · passport OCR→fields+saved image),
  v2-07-learn (type a new field → saved), v2-13 privacy card English ("Your data never leaves your
  device"). Pending: v2-08 profiles, v2-09 workplace ERP/W2 before-after, v2-11 extension/browser,
  cursor at ~2:22. Synthetic docs in `apps/app/public/docs/` (own artwork, non-photo avatars — NOT
  stock; a watermarked stock DL was rejected). Rebuild LOCAL only, no upload until owner reviews.

## Launch strategy locked + assets refreshed (2026-07-25) — JUST SHIPPED (docs/assets)
Owner's 2026-07-25 launch-planning session produced two ADRs plus refreshed launch assets:
- **ADR-0023** — code signing & platform distribution strategy (zero-cost first): ordered Windows trust
  plan (unsigned public builds + SHA-256 + "expect the warning" copy + extension/winget front doors +
  passive SmartScreen reputation) and the honest **macOS** picture (needs a build Mac + Apple Developer
  Program US$99/yr + notarization; deferred). Paid-signing order Azure Trusted Signing → OV → EV.
- **ADR-0024** — launch distribution & platform roadmap (entity-triggered), EXTENDS 0023:
  - Positioning leads with **all three niches equally** (immigration/relocation · cross-border
    freelancers/SMBs · privacy/crypto).
  - **No per-pair language rollout** — NLLB is on-device any-to-any, UI already in 26 languages; packs
    are **pre-staged/QA'd by global speaker volume** (Spanish, Chinese, Arabic, Portuguese, French,
    Russian, Bengali, …). Priority is testing/asset-warming order, never a capability gate (ADR-0018).
  - **Desktop + extension presented EQUALLY** (revises the earlier extension-first *presentation*).
  - Paid platform work **deferred + sequenced around registering a business entity** ("planning one
    soon"): when it exists → EV cert → re-check Azure Trusted Signing ORG eligibility → macOS desktop →
    Microsoft Store/MSIX. Triggers = "revenue" and "entity registered"; NO dates promised.
- **Guide video rebuilt** (ADR-0022 pipeline): dynamic animated cards, before/after hero, real
  in-browser extension + live-translation demos, neural narration. Stable URL unchanged
  (`…/download/guide.{mp4,en.srt}`).
- **Landing page:** added a hero + three niche sections matching the equal-weight positioning.
- Governance closed per §7: CHANGELOG entry added, traceability REQ-05.2 row updated. DOC/ASSET-only.

## OPEN RELEASE ACTIONS (2026-07-24) — the owner's next-step menu
The website installer serves 1.0.0 and the Chrome Web Store extension are BOTH behind this session's
fixes; the guide video on the site is current. The owner's standing menu (full detail +
commands in `docs/launch/open-release-actions.md`):
- **"release desktop"** (#7) — version bump → tauri build → stage installer → release-manifest →
  `publish-site.ps1 -WithBinaries`. Ships fixes via the stable installer link. ~5-10 min.
- **"release extension"** (#8/#9) — bump → `publish-extension.ps1` → `publish-webstore.ps1` (CWS review).
- **"release both"** — one version bump covering both.
- **"build the runbook"** (#13) — a single `deploy/release.ps1` orchestrator + `docs/runbooks/release.md`.
YouTube captions automation is DONE (verified): `make guide-captions VID=<id>` (run only against a
video whose content matches the current .srt). CWS promo field left blank on purpose.

## Guide video: automated pipeline + self-hosted at a STABLE url (2026-07-24, LIVE)
The guide/sales video is now a repeatable pipeline, and it is PUBLISHED (owner said "run the publish").
- **Build:** `node scripts/build-guide.mjs` (`make guide`) — data-driven from `docs/guide/guide-manifest.json`,
  muxes `output/raw/<id>.mp4` + `output/audio/<id>.wav`, concatenates, writes video + `.srt`. Amy (Piper) voice.
- **Hosted (LIVE, verified 200):** `https://polyglotformfill.com/download/guide.mp4` +
  `/download/guide.en.srt` — via `publish-site.ps1 -WithGuide` (own Object Storage objects, excluded from
  the tarball like installers; `site.yaml` fetches them best-effort). URL never changes on rebuild.
  See ADR-0022 and [[guide-video-pipeline]].
- **YouTube** only for the Chrome Web Store promo field (`scripts/upload-youtube.mjs`, long `watch?v=` form).
- **Content fix:** the flat-PDF fill segments were re-recorded on the FIXED build — the form now fills the
  NAME (JOHN DOE) + DOB + Nationality, not just DOB. Forms-tab copy that repeated "on-device" 3x was trimmed.
- **PII-safe:** app-region capture + demo-vault swap (real vault restored after each recording).
- Run publish from NATIVE PowerShell (bsdtar); git-bash GNU tar fails on `C:\` paths.

## Fill/OCR/delete fixes + guide video recorded (2026-07-23, later) — LOCAL ONLY, NOT PUSHED
End-to-end testing of the desktop app (driven live via a PII-safe app-window recorder) surfaced and
fixed real bugs; all committed locally, **nothing pushed to the server or store**.
- **Name-fill bug (found on camera):** a form's "Full name" stayed blank because `makeFillableAndFill`
  looked up the exact `vault["full_name"]` and bypassed the resolver — the vault only had
  `first_name`/`last_name` (as ID capture produces). Fixed to fall back to the semantic resolver,
  which composes the name; resolver also now falls back to the field NAME when the label is unhelpful
  (guarded so `Company name` ≠ person). Shared engine → extension fixed too. Unit-tested.
- **ID capture** now extracts all labelled fields from a licence (single-space `Label value`), not
  one mislabelled phone number. `ocr.test.mjs` added.
- **Profile delete now requires the vault passphrase** (verified server-side), with an inline
  localized error in all 26 languages (`profile.removePassWrong`).
- **Detect-fields opens the review editor** → typing a new value (Nationality) auto-registers it as
  a vault key. **Vault rows** zebra-striped + tightened for readability.
- **Guide/sales video recorded** (`docs/guide/output/`): 13 of 14 segments, driven as live
  interactions, Amy (Piper) narration, English `.srt`, all synthetic John-Doe data, app-window-only
  capture. **Gap:** segment 11 (extension *in the browser*) still needs a clean-browser capture.
- Recording harness committed: `scripts/record-app-region.ps1` (captures only the app's client
  rect — the fix for a capture that twice caught the owner's Chrome/YouTube).
- **Housekeeping:** a throwaway demo vault was swapped in for recording and the owner's real
  `vault.db`/`app-lock.json` restored byte-for-byte afterward.

## Chrome Web Store: LIVE AND AUTOMATED (2026-07-23)
Credentials are in place and the first automated submission is done.
- Item `goaoopdpnofpamcpmmpbfkahfhfegfke` went from crxVersion **0.2.0 -> 1.0.0**; submitted for
  review (Google reviews before it reaches users - hours to days).
- The four WEBSTORE_* variables are set in the USER environment on this machine. They are NOT in
  the repo and must never be. `publish-webstore.ps1 -Check` re-verifies them any time.
- Every future `publish-extension.ps1` run submits automatically. The store refuses a republished
  version, so the NEXT release must bump: `node scripts/set-version.mjs patch`.
- Two bugs found while doing this, both fixed and guarded: the consent URL was truncated at the
  first `&` by `cmd /c start` (Google then blamed a missing response_type), and
  `Invoke-RestMethod -ContentLength` does not exist in PowerShell 5.1 - it failed AFTER a
  successful upload, leaving a draft uploaded but nothing submitted.
- The helper now writes the credentials itself and reads back the stored length: a hand-copied
  refresh token had truncated to 3 characters, which surfaced only as an opaque
  `invalid_grant / Bad Request` much later.



## UI LANGUAGE EVERYWHERE — DONE AND LIVE (2026-07-23)
One catalogue, `apps/extension/src/i18n.js`, 26 languages, shared by the site, the extension and
the executable. Checked in, not translated at runtime (deterministic, reviewable, works offline).
- Desktop: picker on the UNLOCK screen (the first screen, before any settings are reachable) plus
  header, tabs, tab hint, License card title/body/beta note. Remembered per device; first run
  pre-selected from the OS/WebView languages. Verified live in Tamil AND Japanese on a build
  downloaded from the site.
- Extension: picker in the popup, every action + the vault/learn/translate panels localised,
  remembered per browser, first run from chrome.i18n.getAcceptLanguages.
- Site: /<lang>/ for all 25 non-English languages (verified 25/25 live, RTL correct); English page
  gained the switcher plus a hint (never a redirect) to the visitor own language.
- Guards: a missing key is a BUILD FAILURE (i18n.test.mjs), a translation still equal to English
  fails, popup-i18n.test.mjs ties popup.html to the catalogue, site-i18n.test.mjs proves each
  localised page is really in that language and leaks no English.
- STILL ENGLISH (named honestly): the long-form English landing copy, the privacy POLICY page
  (localised pages carry a translated summary + a note that the full legal text is English), and
  a few extension helper lines (passkey unlock, reset vault, signature pad, backup panel).
- Adding a language is one entry in UI_LANGS + STRINGS. No code change on any surface.


## DEPLOYED AND VERIFIED LIVE (2026-07-23, later session)
Fill now works in every script the engine lists (16), on both apps, and it is live.
- **Published** via `publish-site.ps1 -WithBinaries`; downloaded back from
  polyglotformfill.com as a user would: both artifacts **hash-match the manifest**,
  installer runs silent (exit 0), registers **1.0.0**, app launches, unlocks the real vault,
  all five tabs render. Screenshots in `%TMP%\ppf-live\`.
- **Installer 29.9 MB → 23.7 MB** — desktop fonts are no longer bundled; `script_font` (Rust)
  fetches ONE font on first use of a script and caches it in app-data. Verified on the installed
  build: no `fonts/` dir ships, app-data font cache starts empty.
- **Version stays 1.0.0 everywhere** — user's instruction: consolidate, no version tracking yet.
- **Vendored fontkit + npm `@pdf-lib/fontkit` both patched** for the NULL-GPOS-anchor crash
  (`patches/@pdf-lib__fontkit.patch`). If a dependency bump drops that patch,
  `appearances.test.mjs` (Punjabi + Malayalam) fails and names the scripts that broke.

### NEXT, requested by the user (2026-07-23): UI LANGUAGE, not just fill language
"The website as well as the application should give the user the option to choose his language to
begin with, which should render the web page, the extension as well as the executable in their
native language." Today the app's "Your language" selector only sets the FILL language — every
label, button and instruction is English on all three surfaces. This is a real requirement
(REQ + spec + ADR needed): one shared string catalogue for extension + desktop (they already share
an engine), a language chooser on first run, and a language switch on the marketing/install pages.

### Process note (user feedback, 2026-07-23)
"Your planning is weak — you are struggling on the same issues for the past 3 days." Correct. Every
language bug so far was found one at a time, by hand, on a real form, because each piece was
unit-tested in isolation and nothing exercised the LOOP. `roundtrip.test.mjs` is the answer to that:
capture → store → refill, per language, web and PDF. It found the write-only-vault bug on its first
run. New languages/scripts go in its table, not in a bug report.

_What is in flight RIGHT NOW. Update at the start and end of every work session. Convert relative dates
to absolute._

## Production-readiness pass (2026-07-22)
- **Verdict: NOT production-ready yet** — feature-rich beta. Per the traceability matrix, **0/17
  requirements are Prod-Ready ✅** (all ⚠️: coded + unit-tested, live E2E is the open gate).
- **Done this pass (committed):** acceptance specs `features/{single-shared-vault,past-forms-history,
  sign-annotate-desktop}.feature`; `docs/testing/e2e-harness.md` (the live sign-off checklist +
  WebView2 driving technique + infra/release steps + open locked-vault decision); traceability rows
  REQ-01/07/08/09 updated honestly. CI gates run locally green (typecheck, secret-scan proxy clean,
  test-all 125+8). Extension store zip builds clean (v0.2.16, dev key stripped).
- **Real blockers to GA (need user/infra, can't verify from here):** (1) live E2E — shared-vault
  native-messaging round-trip, Sign tool, Docs video fetch, in a real Chrome+host+desktop binary;
  (2) deploy OKE asset gate + upload guide.mp4 + rotate APP_ASSET_TOKEN off placeholder (ADR-0019);
  (3) release builds — desktop still Tauri **0.1.0**, rebuild .exe/.msi + bump; (4) decide
  locked-vault access (host reads vault.db without the passphrase gate); (5) full DoD + CI on branch.

## End-to-end fill testing against REAL forms (2026-07-23) — 9 bugs found and fixed
Tested the real shared engine against live-downloaded government forms in Chinese, Hindi, Tamil,
Telugu (HK GF340 533-field AcroForm, HK ID995A, Atal Pension Yojana x3) + web forms in 4 scripts.
Artefacts on the user's Desktop: `PPF-Test-2026-07-23/` (before/after PDFs, BUGS.md, FORM-ANALYSIS.md).

- **THE TWO FILL ENGINES HAD DIVERGED — the systemic one.** `resolver.js` (PDF) had 40 concepts,
  `pagefill.js` (web) 28. `occupation`/`ssn`/`taxid`/`birthplace`/`age`… filled in PDFs and did
  nothing on web. Each file's own tests passed. **`engine-parity.test.mjs` now fails the build on
  any future drift** — this guard matters more than the individual fixes.
- **KV capture could never work in a non-Latin language.** `keyFromLabel` (private + untested in
  `App.tsx`) did `[^a-z0-9]` so `पूरा नाम` -> `""` and the pair was silently dropped. Now shared
  `vaultkey.js`, Unicode-aware. **Trap the tests caught: Indic vowel signs / Arabic diacritics are
  Unicode MARKS not Letters — `\p{L}` alone mangles the word; must include `\p{M}`.**
- **Script-qualified name fields** ("Chinese name") got the Latin name; now resolve only against a
  matching vault key and fill NOTHING rather than the wrong script.
- **One CJK value aborted the WHOLE PDF fill** (`WinAnsi cannot encode`, thrown at save time after
  all fields are set). **CLOSED 2026-07-23:** appearances are now generated PER FIELD with the font
  that value needs (`appearances()` in `pdffill.js`, saved with `updateFieldAppearances:false`), so
  the value FILLS rather than being skipped. Only scripts with no hosted font are left blank +
  reported. Verified on the real GF340 (`陳偉明` written) and on Hindi. The desktop had the SAME bug
  in its own `pdf.ts`; `apps/app/src/fill/appearances.ts` + `appearances.test.mjs` cover the .exe.
  Only Devanagari + CJK-SC fonts are hosted today — the other 8 scripts 404 (upload = one step).
- **Repeated table rows** (NameOfFirm1..9) all got the same value -> a form claiming nine identical
  employers. `repeatedRowIndexes()` keeps only the lowest-numbered row, scoped per parent.
- **readOnly web inputs were filled** (a reference-number field got the street address). Cannot be
  a blanket skip — date pickers are routinely readOnly — so it is picker-shaped only.
- Explicit `full_name` now beats a composed one; `pagefill.js` composite logic was inlined at three
  sites and had drifted, now one `compositeValue()`.
- Suite 129 -> **163** engine tests.
- **Two reported issues were MY TEST HARNESS, not the product** (labels that neither wrapped their
  input nor used `for=`). Lesson: build jsdom fixtures the way `pagefill.test.mjs` does.
- **Still untested:** Telugu OCR end-to-end (that PDF has no scan AND no text layer — vector glyphs
  with no Unicode mapping, so it needs render->raster->OCR in the real app), translation, review,
  save/versioning, Past forms, signing, radio groups, and the installed GUI.
- **Open bugs — ALL CLOSED 2026-07-23** (suite 163 → 222, all green; both artifacts rebuilt):
  - *Checksum fields auto-filled.* `HKIDCheckingDigit` was getting the surname INITIAL: its caption
    is "Last Digit", "last" is a surname alias, and the box is 1 char. Office-use/derived boxes are
    now blocked by caption **or field name** — the real field needed both, each alone looks
    innocent. `resolveFields` descriptors now carry `name` alongside `label`.
  - *Correspondence address mirroring residential.* A qualified address fills only from a vault key
    with that qualifier when the form also asks for the plain one; else it is left for the user.
    A lone qualified address still fills.
  - *Two consent postures.* The extension had NO learn flow at all (values typed on a page were
    lost). Ported the desktop's posture: `pagecapture.js` + a popup review list, nothing saved
    without being shown and ticked, local vault only.
  - `engine-parity.test.mjs` now also guards the SAFETY RULES (what not to fill) across both
    engines, not just the concept tables.

## Current focus (2026-07-22) — Desktop UX: tabs, catalog removal, privacy vocabulary
- **Just shipped (2026-07-22):** **License is its own first tab**; new **Docs & Video tab** with a
  narrated guided-tour video + written docs. Video is **NOT bundled** — hosted on OKE, served
  downward, fetched once, **pinned-SHA-256 verified**, cached on-device (RFC-0009 / ADR-0019). App
  sends an **app-level** capability (no user identifier → no tracking). Video built on-device via
  `scripts/build-guide-video.ps1` (SAPI narration + `docs/guide/slides/` + ffmpeg). New
  `core-fetch::fetch_app_asset` + Tauri `guide_video`. Edge gate: `docs/deploy/app-asset-gate.md`.
  Tabs now: License → Profile & Vault → Forms → Past forms → Docs & Video. cargo + test-all green.
  Pending infra (can't verify here): deploy the OKE gate + upload guide.mp4 via publish-site.

- **Just shipped (2026-07-22, verified LIVE end-to-end):** REAL on-device **Past forms history**.
  Every filled brought form is auto-saved as an encrypted, versioned copy (filled-PDF bytes sealed in
  new `core-store` `form_blobs` table). New Tauri cmds `save_brought_form` / `list_saved_forms` /
  `saved_form_pdf` / `sign_saved_form`. Past forms tab lists them with Re-download + Sign (device
  Ed25519). Proven: opened the Japan MOFA visa PDF from a local file → filled 12/60 → saved v1 →
  signed (doc 13c213f6f270…). Note: URL fetch of mofa.go.jp now 403s (Akamai bot-block) — env, not code.

- **Earlier 2026-07-22, verified LIVE** (drove the running Tauri app myself, captured every tab):
  - Desktop app (`apps/app/src/App.tsx`) is a **3-tab, step-by-step workflow**: **1 · Profile & Vault
    → 2 · Forms to fill → 3 · Past forms**. Profile + Vault MERGED into one tab (profiles + a
    **License & device** card on top, chosen profile's vault below). Sticky tab bar. Non-setup tabs
    gated on a selected profile.
  - **Built-in catalog REMOVED** (user: "we are not going to keep any catalog"). The app maintains no
    form mappings; it adapts to any brought form. Forms tab = device / network location
    (`\\server\share`) / web URL / web search → on-device fill (AcroForm else OCR). Removed the
    catalog picker, catalog autofill/save/sign table, `makeFillable` (catalog coords), and all
    orphaned state/functions/interfaces (noUnusedLocals-clean).
  - **Privacy vocabulary corrected** (user: "what do you mean nothing is uploaded? User may
    definitely upload the filled form!"): invariant is *we* never receive it; the user sends the
    finished form where they choose (submit to recipient). Dropped "nothing is ever uploaded".
- **WebView2 automation SOLVED (reusable):** synthetic keystrokes/`SendKeys ^v` are ignored by
  WebView2, but **`SendInput` with `KEYEVENTF_UNICODE`** types into it fine (used to enter the vault
  passphrase). Clicks need **`SetProcessDPIAware()`** in the PS process or `SetCursorPos` lands
  off-target; first click must ACTIVATE the window (foreground) or WebView2 ignores it. Scripts in
  scratchpad `proof/` (unlock3, drivetabs2, tabshot). Note the vault passphrase is `omganesha`.
- `node scripts/test-all.mjs` green (120 + 8 + typecheck + vite build). See [[desktop-parity-shared-engine]].

## Prior focus (2026-07-20) — Extension capture + intelligent fill + desktop parity
- **Just shipped (2026-07-20 late):** viewer **"Show original form" toggle** (both blank +
  filled bytes retained; `ppf_orig`); bilingual side panel now shows **translated VALUES**
  alongside labels (`fillPdfBytes` returns `pairs`) and is **width-resizable**; **automated
  test suite** for the extension's pure-logic modules — `parse`/`resolver`/`profileMatch`/
  `forms`/`lang` `.test.mjs` + a `test` script in the extension package (`pnpm -r test`),
  **42 tests green**. Goal: convert the manual per-change testing into fast regression tests.
- **Live product-iteration session against the running extension** (user testing each change;
  published via `deploy/publish-extension.ps1` to polyglotformfill.com; local dev = Load
  unpacked `apps/extension`, then Reload). Everything on `master`, committed locally, **not pushed**
  (20-day hold).
- **Shipped this session:** on-device ID capture (camera/image OCR + **PDF417 back-of-licence
  barcode → exact AAMVA data**), driver's-licence OCR parsing, OCR fill for XFA/scanned PDFs (W-2),
  form templates (W-2/W-4/W-9/I-9), image-valued fields (photo/signature drawn into PDF boxes),
  interactive filled-PDF viewer (`<iframe>`), age-from-DOB derivation, language-aware filling
  (native_language vault field, form-lang detect, English-pivot translate, side panel, Devanagari/
  CJK fonts), and **desktop parity** (fill+language logic ported to `apps/app/src/fill/`).
- **Fixed:** MV3 `object-src blob:` load failure (use iframe); Tesseract default-export import
  (had killed capture + PDF-OCR); vault re-lock on SW eviction (session-cache restore).
- **DONE (2026-07-20, after the new-camera test — DEPLOYED):**
  - **Front-OCR licence parsing improved + made conservative** (`parse.js` `idHeuristics`): recover
    surname from the line above the given-names line (garbled AAMVA "1"); match address anywhere in
    a line; recover city from "City, ST ZIP" even when the state OCRs wrong; reject junk city tokens
    (the earlier `city=INS/state=IN` case). New camera now yields name+address+city+zip+dob.
  - **Over-exposure/glare filter** in `preprocessForOcr` (gamma-darken washed-out images).
  - **Doc-image feature COMPLETE:** capture saves the whole picture as `drivers_license_image` /
    `passport_image` / `document_image` (thumbnail in review); `resolver.js` `drivers_license` +
    `passport_copy` concepts; `pdffill.js` draws image values into field rects; `pdfocr.js` skips
    image values in the OCR-draw path; desktop `resolver.ts` re-synced (tsc green). Spec
    `docs/specs/document-image-fields.md`, ADR-0016.
  - Reliable licence path remains the BACK PDF417 barcode (exact) via LIVE continuous scan.
  - Everything on `master`, committed locally, NOT pushed (20-day hold). Local dev: Load unpacked
    `apps/extension`, then Reload.
- **Verification:** pure logic unit-tested; capture/barcode/fill validated end-to-end in a loaded
  Chromium extension + rendered-PDF proofs. Translate RUNTIME (transformers.js model load) still
  needs a real-browser smoke test; non-en/hi desktop models need provisioning into `public/models`.

## (prior) Current focus
- **BUILD-EVERYTHING pass complete (overnight, autonomous).** All 14 requirements in progress;
  full app loop plumbed + build/test-verified. Self-hosted OCR + English↔Hindi translation
  (execution-only CSP, zero third-party egress), OS keystore, device signing + provenance, PDF
  render/fill/export, save/versions/history, submit, web-form logic, OIDC broker (reused). 25 Rust
  tests + Node tests green, all builds green, traceability green. Ready for ONE full test pass:
  `node scripts/fetch-translation-assets.mjs` then `cd apps/app && pnpm tauri dev`.

## (earlier) Current focus
- **RFC-0001 ACCEPTED. Go-ahead executed (2026-07-16).** ADR-0002…0010 recorded; governance synced.
- **Toolchain INSTALLED + verified on this machine:** Rust 1.97 (MSVC) + Android targets, VS 2022
  C++ Build Tools, JDK 17, Node 24/pnpm 9, WebView2 150. cargo on User PATH. See
  `docs/reference/dev-setup.md`. **Desktop Tauri build path is ready.**
- **Rust workspace scaffolded + BUILDS:** root `Cargo.toml` + all 11 `crates/core-*` stubs;
  `cargo build` + `cargo test` green (smoke tests pass).
- **Old scaffold removed:** `apps/api` + `packages/db` deleted (authorized); root package.json + pnpm
  lockfile refreshed; traceability green.
- **Tauri v2 desktop app BUILDS (`apps/app`):** React/TS UI ↔ Rust core bridge (commands `greet`,
  `core_modules`) wired to core-store/crypto/catalog; `cargo build` → `target/debug/app.exe` (12.4MB);
  frontend builds; icons generated. Live window = `pnpm tauri dev` (needs desktop session, not run here).
- **Phase-1 vertical slice LANDED (catalog-first autofill):** `core-store` (SQLite vault + tests) +
  `core-catalog` (field-maps + autofill + tests) → app `demo_autofill` → UI table. `services/catalog`
  (Node stub, serving verified) + `packages/shared` types (typecheck). 14 pillars → REQ-01.1..14.1
  (traceability green). All green: cargo test 25 ok / 0 fail, frontend build, traceability.
- **Remaining:** SQLCipher encryption-at-rest + Profiles UI; `core-mt` translation + `core-ocr`
  fallback; `pnpm tauri dev` visual check; Android SDK/NDK (dev-setup.md); iOS on a Mac. Everything
  on `master`, uncommitted (user: no branching).
- **(prior) GO/NO-GO gate: passed with CONDITIONAL GO** (see `docs/feasibility/`). Worst-case trial run
  2026-07-15 empirically confirmed auto field-detection is unreliable on bad scans (esp. CJK OCR
  → 0/6 under moderate degradation), but the guaranteed floor (digital-text path + template
  memoization + human-in-the-loop, all on-device) holds, so the app is viable. Do NOT architect
  around zero-touch detection of arbitrary scans.
- **Architecture RFC drafted:** `docs/rfc/0001-architecture-and-stack.md`. FINAL direction (2026-07-16):
  **NATIVE cross-platform app** — Tauri v2 + React/TS UI + Rust core; all data + processing on-device;
  SQLite+SQLCipher + OS keystore. Web/PWA rejected (served-code trust). Validate Tauri v2 mobile
  bindings early.
- **Public Form Catalog added (user's idea, 2026-07-16):** a server of PUBLIC form knowledge only
  (metadata, tags, blank templates, curated **field-maps**, fingerprints), served DOWN. Catalogued
  forms **skip OCR/detection** (download the field-map) → this turns the feasibility risk into a
  strength; OCR/detection is now the FALLBACK. Catalog **search runs on-device** (index synced) so
  form-interest doesn't leak. Contributions are structure-only + consented. → ADR-0005.
- **OCR stays ON-DEVICE.** Server OCR was floated 2026-07-15, flagged as breaking the invariant
  (reads the uploaded doc → content up, incl. passports); ruling = on-device, better engine
  (ONNX/PaddleOCR), now only a fallback behind the catalog.
- **Web-form autofill added (#11, 2026-07-16):** in-app webview. Web-hosted downloadable file →
  native download (no CORS) → normal pipeline. Live HTML form → autofill DOM fields from vault
  locally (password-manager style), submit device→site. Catalog covers WebForm entries (URL + DOM
  selectors). Locked view-only docs → OCR/manual fallback only.
- **Signing is NON-DELEGABLE (2026-07-16):** the signer/signee must SSO-authenticate themselves
  (OIDC/passkey) and the signature is produced by **their own authenticator** — nobody signs on
  behalf of another. On-behalf-of (admin) covers fill/translate/save/submit/share but **NOT sign**;
  when a signature is needed the Signee signs on the same device (ceremony) or on their own device.
  Self-fillers are SSO'd from the start. No delegable offline-key fallback.
- **Signing hand-off (how the signee sees it):** signee ALWAYS reviews the full rendered form before
  signing (WYSIWYS). Delivery = same-device ceremony (signee auths with their own phone via
  cross-device WebAuthn) OR a consented E2E-encrypted **signing request** routed to the signee's
  device (reuses the sharing bundle); signee reviews/approves/rejects, signs, signed result sealed
  back. No server touches content. New sequence diagram added to the UML artifact.
- **Device-less signee → Tier-2 in-person signing (2026-07-16):** signee reviews on the operator's
  device, draws a signature + gives a live fingerprint/thumbprint, placed on the form; SSO'd operator
  cryptographically attests the capture (WitnessAttestation) over the doc hash. Non-delegable via
  live biometric + accountable witness, but LOWER assurance than Tier-1 passkey self-sign — label as
  such. Biometric = special-category, on-device only + encrypted + consented + legal review.
  Hardware: built-in sensors are auth-only (no image) → need external scanner SDK or inked-thumbprint
  photo. → ADR-0007. Sequence diagram s10 added.
- Cross-person sharing = user-directed E2E-encrypted export/import only (no relay). **RFC awaiting accept.**

## Locked decisions (binding — see CLAUDE.md §1 privacy invariant)
- **Privacy invariant is non-negotiable:** no user content goes UP; all AI on user values runs
  on-device; servers serve assets DOWN only; sole egress is user-initiated "Submit online" direct to
  recipient; no content telemetry; PDFs rendered with scripting/external resources blocked.
- **Fonts & models are on-device** (bundle default + lazy-cache per script/language; subset-embed
  into each PDF). Font/model hosting may be a stateless asset server. Encryption = at-rest only.
- **Accepted tradeoff:** language/script coverage + AI quality are bounded by on-device model+font
  availability — deliberate price of the invariant.
- `apps/api` to be **re-scoped from data store → stateless asset server**.

## Stack freedom (2026-07-15)
- User explicitly freed stack/architecture choice at ALL layers — **not obligated to keep the
  current scaffold** (Express `apps/api`, Drizzle/Postgres, pnpm workspace, folder structure).
  The RFC should pick the best local-first cross-platform stack from scratch (e.g. Tauri+Capacitor
  vs Flutter vs …), then we restructure the repo accordingly.

## Recent changes (most recent first)
- 2026-07-16 — **Market + tech reassessment** written (`docs/feasibility/03-...`). Verdict: architecture
  holds, risk shifted from feasibility→scope; phase hard; Tauri-mobile spike is #1 gate. Market:
  ~$40-70B TAM by 2030, ~30-40% e-sign CAGR (APAC fastest ~40%); strong India fit (900M users, 22
  languages, Aadhaar eSign/DigiLocker, ~500k CSC channel, DPDP compliance); comparable airSlate $120M ARR.
- 2026-07-16 — **Printable QR OK** (provenance is disclosed, not covert). **Registered roles +
  verifiable workflows (#14):** Authority/Institution Registry (org metadata, invariant-safe); on SSO
  sign-in a party's RegisteredRole is asserted (Registrar/Notary/KYC-officer/etc.), scoping a
  role-defined workflow; every step attributed + bound into provenance/audit → verifiable by an
  authority. New entities AuthorityRegistry/RegisteredRole. → ADR-0010.
- 2026-07-16 — **Provenance/traceability request REFRAMED (#13).** User asked for a hidden,
  vendor-decryptable QR logging creators/signers/IP addresses. FLAGGED as breaking the invariant on
  3 counts (vendor backdoor, IP surveillance, covert beacon) + an ethics/legal line; declined that
  form. User chose **authority-scoped verifiable provenance**: a DISCLOSED signed manifest (doc hash,
  signer identities, attestations, trusted timestamps) with a sensitive block **encrypted to a NAMED
  governing authority's key — never ours**. No vendor key, no IP surveillance, no covert beacon; TSA
  gets only a one-way hash. Added no-vendor-backdoor rule to the invariant. → ADR-0009. UML gained a
  provenance sequence + class entities (ProvenanceManifest, GoverningAuthority).
- 2026-07-16 — **Multi-party document process added (#12):** one document assembled from several
  Profiles (Seller/Buyer, Plaintiff/Defendant, +witnesses), coordinated by an admin. Roles 1..*,
  per-party consented E2E data share scoped to this doc + counterparties, one non-delegable signature
  per party (parallel/sequential), execute + distribute encrypted copies — no server holds joint
  content. Cross-party visibility is inherent + consented; editing after a signature invalidates
  prior signatures (re-sign). New crate `core-txn`; entities MultiPartyDocument/PartyRole/Party;
  UML gained a multi-party sequence + a lifecycle state diagram. → ADR-0008.
- 2026-07-16 — Translation footprint clarified: small bundled engine + per-language-direction models
  (~15-50 MB) lazy-downloaded/cached (not the whole library; pivot via English for non-English pairs).
  Added **evictable asset-cache policy** for ALL lazy assets (models, fonts, catalog templates):
  auto-evict on >~30 days unused OR storage pressure, EXCEPT user-pinned offline assets; lossless
  re-download; first use of an evicted/new asset needs network; usage tracked on-device only.
- 2026-07-15 — Added features **#9 authenticated signing (federated/public identity: OIDC,
  passkeys/WebAuthn, eID)** and **#10 data-source documents → on-device auto-extracted KV pairs,
  saved per Profile**. Introduced **Profiles + Subscriptions/Tenants** (family = many profiles;
  institution = 1-to-many / many-to-many mapping). Domain model, non-goals, glossary, and open
  decisions updated in the brief. **Blocking decision:** institutional cross-person/cross-device
  data movement — recommend user-directed E2E-encrypted export (option a); zero-knowledge relay
  (option c) needs explicit user ruling vs the privacy invariant.
- 2026-07-15 — Ran worst-case feasibility trial (`prototypes/field-detection-trial/`, docs in
  `docs/feasibility/`). Verdict: **conditional GO**. Documented optimistic approach + trial results.
- 2026-07-15 — Built spike `prototypes/translated-fill/` (isolated from the pnpm workspace):
  scanned PDF → `pdfjs` render → `tesseract.js` OCR → heuristic field detection → cloud translation
  (MyMemory default, Google via key) → fill → `pdf-lib` export in original-or-chosen language.
  Typechecks, builds, and dev server serves. **Runtime behaviour (OCR/translation quality) not yet
  verified in-browser — needs a human click-through** (see its README).
- 2026-07-15 — Wrote `memory-bank/projectBrief.md` (full vision + 8 pillars + domain model).
- 2026-07-15 — Wired scaffold plumbing: installed deps, fixed `@types/node`/`drizzle-orm` gaps,
  added vitest smoke test, pg pool connect timeout, real CI gates. typecheck/test/build/traceability
  all green.

## Next steps
- [ ] **You:** run the spike (`cd prototypes/translated-fill && pnpm dev`), click through, and judge
      OCR + field-detection quality on a REAL scanned form. Record verdict here.
- [ ] Draft the **architecture RFC** (local-first + cross-platform; re-scope `apps/api`/Postgres to
      optional stateless services). Blocked on the spike verdict.
- [ ] Draft the **search/vectorization ADR** (recommend: vectorize tags + AI summary, local index).
- [ ] Decide Word/XLS fill model (now recorded as V-next scope in the brief) — needs its own ADR.

## Open questions / blockers
- **Privacy vs. cloud AI:** spike uses cloud OCR/translation, which violates the local-first rule.
  Production needs on-device models — feasibility unproven. Biggest open risk.
- **Field detection on real layouts** is the hardest unsolved piece (heuristic today).
- Stack not yet chosen: Tauri+Capacitor (reuse TS) vs Flutter. Awaiting your lean.

## Decisions pending (ADRs to record on RFC accept)
- **ADR-0002** native stack (Tauri v2) · **ADR-0003** encrypted export/import bundle ·
  **ADR-0004** federated signing · **ADR-0005** Form Catalog ·
  **ADR-0006** signing-request/response bundle (distinct from ADR-0003: review+sign+return intent,
  preparer provenance, bound canonical doc hash, consent/authorization + revocation) ·
  **ADR-0007** in-person biometric/witnessed signing (scanner vs thumbprint-photo, biometric storage,
  liveness, legal validity, assurance labelling) ·
  **ADR-0008** multi-party document workflow (roles/cardinality, per-party consent + scope, parallel
  vs sequential signing, re-sign-on-edit invalidation, executed-copy distribution) ·
  **ADR-0009** authority-scoped verifiable provenance (manifest schema, TSA/transparency, authority
  key registry, disclosure+consent UX, QR payload — no vendor key) ·
  **ADR-0010** registered roles + verifiable workflows (registry model, role taxonomy, role-scoped
  workflow defs, audit+provenance binding, authority verification).

## Recently shipped (2026-07-23) — desktop/extension parity push
- **Language-aware OCR on both platforms.** Desktop was hardcoded to `eng` (non-English scans were
  unreadable); new shared `apps/app/src/tessworker.ts` mirrors the extension's `tess.js`. Models live
  in app-data `models/tesseract/` and are served via the `ppfmodel` scheme — never embedded in the
  binary (embedding assets is what caused the E0786 build failure). 15 packs installed on the dev box.
- **Extension asset host is returning 404** — multi-language OCR packs never arrived, so extension OCR
  had silently degraded to English in production. Public-mirror fallback added; the host itself is
  still a GA blocker (see below).
- **Edit the form in place**: real inputs overlaid on the rendered page, fitted to the panel, with a
  persistent pen/text/signature/image toolbar. Fixed a double-render (widget appearances + overlay,
  plus a legacy preview canvas).
- **Translation covers labels AND values.** Etched rule reaffirmed in code: the translated view is a
  reading aid only — the saved file always keeps the form's ORIGINAL language.
- **New-data capture**: values typed onto a form that the vault lacks are surfaced for explicit
  review (label, key, value, prior value) and saved only on confirmation, to the local vault only.

### GA blockers — status (2026-07-23)
1. **Asset host — RESOLVED.** The PAR was never dead (that diagnosis was wrong); `eng` served 200
   all along and the other 14 packs had simply never been uploaded. All 15 are now uploaded and
   verified over the existing PAR, and desktop fetches a pack on first use of a language.
2. **Version — RESOLVED.** 1.0.0 across all six version sites.
3. **Code signing — DESCOPED as a blocker (2026-07-23, ADR-0020).** Budget rules out an OV/EV
   certificate for now (revenue first), so GA no longer waits on it. Decisions:
   - **Public releases ship deliberately UNSIGNED.** Self-signing is dev-only — an invalid chain
     gives zero SmartScreen benefit and is *worse* under some enterprise/AV policy. Distributing
     unsigned software is entirely legal; Authenticode is reputation, not permission.
   - Trust is carried instead by: **extension-first** ordering, **winget** (accepts unsigned
     `.exe`/`.msi`; **avoid MSIX** — it requires a paid cert), a **published SHA-256** per artifact
     (`scripts/release-manifest.mjs`, 12 tests in `test-all`), and an install page that **predicts
     the SmartScreen warning before the download button** with the exact click path.
   - **Upgrade path unchanged and one-line:** set `WINDOWS_CERT_THUMBPRINT` and rebuild. Prefer
     **OV** first. `docs/reference/code-signing.md` now carries the shipping policy + release steps.
   - Open, not assumed: **SignPath.io's free OSS tier** would give real certificate-backed signing at
     zero cost, but only if the project goes open source — a licensing call, not a technical one.

4. **Stale published artifacts — FOUND AND FIXED (2026-07-23).** The installers on the download page
   reported **ProductVersion 0.1.0**: the 1.0.0 bump touched the six version sites but the binaries
   were never rebuilt. Now rebuilt and staged:
   - `cargo tauri build` → `PolyglotFormFill_1.0.0_x64-setup.exe` (29.9 MB) +
     `PolyglotFormFill_1.0.0_x64_en-US.msi` (31.9 MB), copied to
     `docs/marketing/site/download/` under the published names. Extension zip rebuilt at 1.0.0 (9 MB).
   - **Versions verified, not assumed:** `.exe` PE ProductVersion = `1.0.0`; the MSI has no PE
     VersionInfo, so its `ProductVersion` property was read from the MSI Property table = `1.0.0`.
   - **Unsigned status verified:** `Get-AuthenticodeSignature` → `NotSigned` for both, consistent
     with `signed: false` in the manifest (ADR-0020). The signCommand hook correctly no-op'd.
   - `release-manifest.json` regenerated at 1.0.0 and verified (3/3 OK).
   - `deploy/publish-extension.ps1` gained **`-NoPublish`** so artifacts can be staged locally
     without touching the live site.
   - **winget manifests written** (`deploy/winget/`, 3 files for `SubramanyaMysore.PolyglotFormFill`
     1.0.0, offering both the .exe and the .msi). `winget validate --manifest deploy\winget` passes
     against the real CLI. `scripts/winget-manifest.test.mjs` (5 tests) guards `InstallerSha256`
     against drift from `release-manifest.json` — proven to fail on a corrupted hash.
   - **PUBLISHED AND VERIFIED LIVE (2026-07-23 09:15 UTC).** The user ran
     `deploy/k8s/publish-site.ps1` (the classifier denied it to the agent twice). Verified:
     both installers **downloaded from the live host hash-match the published manifest**;
     `/download/release-manifest.json` serves 1.0.0; the install page shows the winget section
     (labelled not-live), the hash-verification block, and the v1.0.0 badges.
   - **Publish is SLOW, not broken.** The run looked hung; diagnosis: the site tarball is now
     **86 MB** (it carries the 62 MB of installers) and the upstream was **2.1 Mbps over
     ProtonVPN** → ~5.5 min. Confirmed live by an Established TLS socket to 134.70.24.1:443 plus
     adapter throughput. `WriteTransferCount` reads 0 for socket sends — use
     `Get-NetAdapterStatistics`, not process I/O counters, to judge upload progress.
   - **WebFetch caches 15 min per URL** — it served a stale pre-publish copy of `/install/` and
     made the deploy look like it had failed. Always cache-bust (`?cb=<random>`) when verifying a
     just-published page.
   - **UAT PASSED (2026-07-23).** Downloaded 1.0.0 from the live site as a user would: hash matched
     the manifest; one attempt arrived **truncated** (17.7/29.9 MB, connection reset) and the hash
     check **caught it** — integrity story proven in anger. Defender scan clean (exit 0);
     Authenticode `NotSigned` as designed; silent install exit 0 registering `PolyglotFormFill
     1.0.0`; app launched, unlock screen rendered, existing vault intact.
   - **Publish slimmed 86 MB → 15.4 MB (2026-07-23).** Installers are no longer in the site
     tarball — they are separate Object Storage objects fetched into `/web/download/` by the init
     container, so public URLs are unchanged. Use `publish-site.ps1 -WithBinaries` only when a
     binary changed. The script now **fails if an .exe/.msi leaks into the tarball**.
   - **MSI is no longer hosted** (duplicated the .exe for ~32 MB). Still built by `tauri build`.
     Because winget validation downloads `InstallerUrl`, winget now offers **only** the NSIS .exe;
     `scripts/winget-manifest.test.mjs` enforces hosting/manifest agreement in both directions.
   - **Two self-inflicted bugs, both fixed and now guarded (2026-07-23):**
     1. **Never put non-ASCII on an executable line of a `.ps1`.** PowerShell 5.1 reads `.ps1` as
        ANSI without a BOM, so a UTF-8 em dash decodes to CP1252 bytes ending in `0x94` — a curly
        closing quote — which terminates a string literal and breaks the parse, with errors far
        from the real line. Harmless in comments (other scripts have them). Guard:
        `scripts/ps1-ascii.test.mjs`, which also runs **PowerShell's own parser** over every
        tracked `.ps1`. Both guards proven to fail on the reintroduced bug.
     2. **`kubectl apply` of `site.yaml` with the placeholder `DOWNLOAD_BASE`** put new pods into
        `Init:Error`. **No outage** — K8s keeps old pods until a new one is Ready, and `curl -f`
        made it fail loudly rather than serve 404ing links. Recovery: `rollout undo`. The file now
        opens with a do-not-apply banner and the correct order of operations.
     Note: the IDE's YAML schema errors on `site.yaml` are the editor validating a multi-document
     file against a single-resource schema — `kubectl apply --dry-run=client` exits 0.
   - **BLOCKS the next publish — one-time infra needed:** create a bucket-level read PAR and set
     `DOWNLOAD_BASE` in `deploy/k8s/site.yaml` (currently `REPLACE_WITH_BUCKET_PAR_URL`); the exact
     `oci os preauth-request create` command is in that file. Then
     `publish-site.ps1 -WithBinaries` once, and `kubectl apply -f deploy/k8s/site.yaml`.
     **Until that is done the current live site is fine** (it still serves the old layout) — but a
     new publish with the new site.yaml would 404 the downloads.
   - **Still open:** the winget PR to `microsoft/winget-pkgs` (user decision — it is a public PR
     under their name), and one real first-run install *from a browser download* to see the actual
     SmartScreen box (the UAT install was PowerShell-downloaded, so it carried no Mark-of-the-Web
     and SmartScreen did not trigger).

### Shared-vault bridge — verified end-to-end against the real host (2026-07-23)
Driven directly over native messaging (4-byte LE length + JSON), against the real
`projectpdfs-host.exe`, with the desktop app running:
- **Protocol round-trip:** `ping` -> `{ok:true,pong:true}`.
- **Privacy gate, locked:** `getVaultMeta` / `listProfiles` -> `{ok:false, locked:true,
  "the desktop app is locked — unlock it to use the shared vault"}`. Only `ping` is ungated.
- **Privacy gate, unlocked:** `listProfiles` -> profile `Subu`; `getVaultMeta` returns real rows.
- **Last-write-wins:** rewriting `email` with its EXACT existing value and an explicit
  `updatedAt` moved `updated_at` from `0` to precisely the supplied stamp, value unchanged. The
  LWW write path is therefore proven, not assumed.
- Note: the 5 pre-existing desktop rows all carry `updated_at = 0` (legacy migration default), so
  on a first sync the extension's richer, stamped data wins — union semantics mean no loss either way.

**Browser half is BLOCKED by Chrome itself, not by our code.** Chrome 150 ignores
`--load-extension`: the browser starts, but `chrome://extensions-internals` lists only the built-in
PDF viewer and the toolbar shows "Action required". `--disable-extensions-except` and
`--enable-unsafe-extension-debugging` do not restore it. `deploy/dev-launch-chrome.ps1` now detects
this and prints the manual "Load unpacked" steps instead of failing silently. Popup auto-sync
therefore still needs one manual extension load in the dev profile before it can be exercised.

### Known gap worth naming
Most real-world non-English government forms are **flat scans or XFA/LiveCycle**, not AcroForms
(verified: Korean visa form = 0 fields; USCIS I-9 Spanish and HK ID91 = XFA). They therefore depend
on the OCR path, which is why the language-aware OCR work above was the true blocker for
multilingual filling — not the translation engine.

## Recently shipped (2026-07-18)
- **Fill-a-Form flow reworked:** opening a form (PDF/image) now **auto-detects & fills** (existing
  AcroForm → fill; else OCR-create + fill); "Fill a PDF" renamed "Fill a Form"; demo sample tucked away.
- **Image-of-a-form → editable PDF** (`imageToPdf`), then the same pipeline.
- **From the web (URL):** `core-fetch::fetch_form` (reqwest/rustls, SSRF-guarded, redirect-revalidated,
  size-capped) + `download_form` command + UI.
- **Word/Excel (REQ-15.1 / RFC-0002 / ADR-0011) Phase A:** fill named regions (Word content controls,
  Excel named ranges) on-device via OOXML edit (`office.ts`, fflate + fast-xml-parser). Unit-tested.
- **Windows code signing:** opt-in `signCommand` hook (`sign-windows.ps1`), env-driven, dev-cert script,
  docs — verified end-to-end (signed MSI + NSIS setup).

## Decisions pending (older)
- Architecture RFC (local-first, cross-platform) — not yet opened.
- Vectorization/search ADR — recommendation drafted in the brief, not yet formalized.
- **Word/Excel fill:** Phase A **done** (named fields). Phase B (flat-doc detection) + Phase C
  (Office→PDF) pending — see RFC-0002.
- **Web *search* to locate a form (REQ-11):** parked — user scoped web sourcing to URL/download only
  (a search query would leave the device; needs explicit opt-in).

## 1.0.10 — smarter web-form autofill + turnkey release — 2026-08-11
- **Extension web-form filling upgraded (shared @engine, both surfaces):**
  - `pagefill.js` `deepQSA()` pierces OPEN shadow roots → ADP careers / web-component forms now fillable.
  - `expandCands()` US state full-name ⇄ abbreviation (NC ⇄ North Carolina) for selects, custom dropdowns, radios.
  - EEO self-ID concepts (race/ethnicity/hispanic-latino/veteran/disability) added to resolver + pagefill
    (parity) and seeded (empty) into new desktop profiles.
  - `resolver.js`: plain phone/mobile/landline fields no longer get a prepended country code (dedicated
    country-code field still fills).
- **Released both surfaces at 1.0.10.** Desktop: signed NSIS built (Authenticode + updater sig), staged to
  stable `/download`, `latest.json` (no-BOM) + `release-manifest.json` regenerated, winget synced (hash
  4dc798a1…, InstallerUrl on mooo.com host). Site published `-WithBinaries`; **live-verified**: latest.json
  = 1.0.10 and live installer sha256 == manifest. Extension zip rebuilt (9.1 MB), **store review-state gate
  checked (not pending)**, submitted to Chrome Web Store (Upload SUCCESS, in review).
- **Tests:** extension/shared-engine 359 ✓, desktop 33 ✓, winget/release-manifest/store-package ✓, tsc clean.
  Known pre-existing ⚠️: `scripts/site-i18n.test.mjs` 4 fails = marketing-translation content gaps (Hindi
  tagline + privacy.noCollect, picker `en`, English auto-detect) — untouched by 1.0.10, flagged for follow-up.
- **Housekeeping:** removed 3 stale `.claude/worktrees/agent-*` git worktrees + untracked guide build logs;
  kept tracked demo PDFs (used by build/tests). Clean source snapshot archived to
  `F:\PolyglotFormFill-1.0.10-source.zip` (git archive HEAD — no node_modules/target/.git/caches).
