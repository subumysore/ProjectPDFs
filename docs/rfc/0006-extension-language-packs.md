# RFC-0006: On-device language packs for the browser extension

- **Status:** Draft
- **Author(s):** Subramanya Mysore
- **Created:** 2026-07-18
- **Related:** ADR-0013 (privacy-respecting web search), REQ (multilingual fill), RFC-0004 (extension client)

## Summary
Bring multilingual form-filling to the **browser extension** (today it exists only in the
desktop app). Add **independently downloadable, independently removable on-device language
packs**: the user installs one language pair at a time (e.g. English↔Hindi), can install several
one after another, and can unload any pack at any time to reclaim disk. All translation runs
**locally in the browser**; only model *weights* are downloaded (assets DOWN to the device) —
never any user content. This upholds the privacy invariant.

## Motivation
- Users hold their data in one language; forms are published in another. The desktop app bridges
  this; extension users get nothing today (see prior UX gap).
- Bundling every language into the extension would bloat it for everyone. Independent packs keep
  the base extension small and let each user pay (in MB) only for the languages they use.
- Doing nothing pushes multilingual users to the desktop app even for simple web forms.

## Detailed design

### Components
1. **Pack registry (hosted manifest)** — a static JSON on our asset host listing available pairs:
   `{ id: "en-hi", from: "en", to: "hi", size_mb, sha256, url_forward, url_reverse, engine: "bergamot" }`.
   Served DOWN only; contains no user data. Anti-tamper via `sha256` verified after download.
2. **Inference engine (bundled, not fetched)** — the WASM translator ships **inside** the
   extension package (MV3 forbids remote *code*; bundled WASM + locally stored *data weights* is
   compliant). Candidate: Bergamot/Marian tiny quantized models (the Firefox Translations stack,
   ~15–40 MB/pair) via `bergamot-translator` WASM. Alternative: `transformers.js` MarianMT.
3. **Download manager** — fetch weights → verify `sha256` → store in **IndexedDB** (not
   `chrome.storage`, which is too small). Records installed packs + byte sizes.
4. **Pack manager UI (options page)** — list available vs installed packs; **Install** (with a
   progress bar + size), **Remove** (deletes weights from IndexedDB, frees space), and a running
   total of disk used. Satisfies "download independently / unload any language at any time."
5. **Fill-time integration** —
   - **Language detection:** detect the form's language from `<html lang>`, script/Unicode range
     of labels, and page text (on-device heuristic; no network).
   - **Read (view):** optionally translate labels into the user's base language for comprehension.
   - **Write (fill):** translate the user's stored value **into the form's language** before
     writing (the core ask). If no pack for that pair is installed, fall back to writing the value
     as-is and flag "install the X pack to translate."
   - Integrates with the existing on-device semantic resolver (RFC-0006 sits on top of the
     ontology fill): resolve concept → derive value → translate value → write.

### Data model (IndexedDB, `ppf-langpacks`)
- `packs` store: `{ id, from, to, engine, size, sha256, installedAt, blobKeys[] }`
- `weights` store: `{ key, bytes }` (the model shards; deletable per pack)

### APIs (extension messaging)
- `langpacks.list` → available (from manifest) + installed (from IDB)
- `langpacks.install(id)` → download+verify+store, streaming progress events
- `langpacks.remove(id)` → delete weights, update registry
- `translate({text, from, to})` → local inference; throws `pack-missing` if not installed

## Alternatives considered
- **Bundle all languages in the extension** — rejected: bloats every install; store size limits.
- **Cloud translation API** — rejected outright: violates the privacy invariant (user content
  would leave the device).
- **Desktop-only (status quo)** — rejected per this RFC's motivation; the user explicitly wants it
  in the extension flow they use.
- **transformers.js NLLB-600M** — one model, many languages, but too large (~1 GB+) for a browser
  extension; per-pair Bergamot models are far smaller and independently removable.

## Risks & trade-offs
- **MV3 execution model:** heavy WASM shouldn't run in the ephemeral service worker. Run inference
  in an **offscreen document** (or the popup/content context) with a keep-alive during a fill.
- **Model size / quota:** 15–40 MB/pair; must show sizes and handle IndexedDB quota errors
  gracefully. Removal must actually reclaim space (verified by test).
- **Remote-code policy:** we fetch **weights (data)** only; the engine is bundled. Document this in
  the store submission ("no remote code") and in the privacy policy §6.
- **Integrity:** verify `sha256` before use; refuse mismatches (anti-exfiltration/anti-tamper).
- **Translation quality:** tiny models are imperfect; keep the raw value recoverable and never
  block filling if a pack is missing.
- **Reversibility:** fully additive; removing all packs returns the extension to today's behavior.

## Rollout & migration
1. Phase 1 — pack manager UI + download/verify/store/remove in IndexedDB, with a **stub** engine
   behind a flag (proves independent install/unload + quota accounting) and acceptance tests.
2. Phase 2 — bundle the Bergamot WASM engine; wire `translate()`; ship the first pair (en↔hi).
3. Phase 3 — fill-time detection + translate-on-write + translate-for-view; add more pairs to the
   manifest (each independently installable). No migration needed (new, additive stores).

## Open questions
- Engine choice: `bergamot-translator` WASM vs `transformers.js` MarianMT (size, licence, MV3 fit).
- Where to host pack weights (same Oracle Object Storage PAR pattern as installers?).
- Should the desktop app and extension **share** the same pack format so weights download once?

> When accepted, record the outcome as an ADR (engine + storage + privacy posture) and link it here.
