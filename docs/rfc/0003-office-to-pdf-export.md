# RFC-0003: On-device Office → PDF export (RFC-0002 Phase C)

- **Status:** Accepted — **Tier-1 (content export) implemented** (2026-07-18); Tier-2 (LibreOffice
  high-fidelity pack) and per-platform vector print pending
- **Author(s):** PolyglotFormFill team
- **Created:** 2026-07-18
- **Related:** RFC-0002 / ADR-0011 (DOCX/XLSX fill), REQ-15.1; ties to REQ-07.1 (submit),
  REQ-08.1 (print/versions), REQ-09.1 (signing). Produces an ADR on acceptance.

## Summary
Let a user turn a filled Word/Excel form into a **PDF**, entirely on-device, for uniform
**signing, submission, and printing**. This is Phase C of RFC-0002. The hard part is that faithful
Office→PDF rendering needs a real layout engine; no mature JS library does it well. This RFC proposes a
**two-tier** approach: a lightweight **HTML → print-to-PDF** default for common forms, and an optional,
**opt-in LibreOffice sidecar** for pixel-faithful conversion — shipped as a separate download so the
base installer stays small. No cloud conversion, ever.

## Motivation
Today a filled `.docx/.xlsx` downloads as a native Office file. That's ideal for editing, but several
core flows assume a PDF:
- **Signing** binds a canonical document hash (REQ-09) — a PDF is the stable, portable artifact.
- **Submit online** and **print** (REQ-07/08) expect a PDF in most real vendor/gov processes.
- Recipients without Word/Excel still need to read the result.

Without Phase C, Office forms are a second-class citizen in sign/submit/print. Doing nothing leaves that
gap; a cloud converter is **forbidden** (sends user content up).

## Detailed design

### Constraint
Faithful OOXML rendering = reproducing Word/Excel's layout engine (pagination, fonts, tables, wrapping).
That capability lives in either a browser engine (via HTML) or an office suite (LibreOffice). We must do
it **on-device**.

### Proposed two-tier design
**Tier 1 — HTML → print-to-PDF (default, lightweight).**
- Convert on-device: `.docx` → HTML via **docx-preview**; `.xlsx` → HTML table via **SheetJS**.
- Render the HTML in a hidden webview and export via the platform's **print-to-PDF**:
  - Windows (WebView2): `CoreWebView2.PrintToPdfAsync`.
  - macOS (WKWebView) / Linux (webkitgtk): platform print/PDF APIs.
- Pros: small (reuses the webview + libs already added for preview), no large binary, fully on-device.
- Cons: **fidelity is approximate** — docx-preview/SheetJS don't reproduce every Word/Excel layout; the
  print API differs per platform (integration cost). Best for typical single-page forms.

**Tier 2 — LibreOffice headless sidecar (opt-in, high-fidelity).**
- Bundle `soffice --headless --convert-to pdf` as a **Tauri sidecar**, run fully offline.
- Pros: near-perfect OOXML fidelity, uniform across platforms, no per-platform print code.
- Cons: **large** (~300–400 MB), heavier install, process/packaging management. So ship it as an
  **optional download** ("Enable high-fidelity export"), not in the base installer, via the down-only
  assets service.

### Flow
```
filled .docx/.xlsx ─► [Export as PDF]
     ├─ Tier 1 (default): docx-preview/SheetJS → HTML → webview print-to-PDF ─► filled.pdf
     └─ Tier 2 (opt-in):  soffice --headless --convert-to pdf (offline sidecar) ─► filled.pdf
then: existing render / sign_form (hash+Ed25519) / submit / print — unchanged.
```

### Integration
- UI: an **"Export as PDF"** action appears after an Office fill; a setting toggles Tier-2 when the
  high-fidelity pack is installed (else Tier 1).
- Signing/submit/print are **unchanged** — they already operate on PDF bytes.
- Fonts: faithful render needs the document's fonts; reuse the **assets service (down-only)** to fetch
  missing fonts on-device — never sending the document out.

## Alternatives considered
- **Pure-JS OOXML→PDF (no engine).** Rejected — no mature library; reimplementing Word/Excel layout is
  infeasible and low-fidelity.
- **Rebuild values into a fresh pdf-lib PDF from a template.** Works only for simple/known forms and
  discards the original layout — not a general solution (possible niche path for catalogued forms).
- **Cloud/Office-365 conversion.** **Forbidden** — user content would leave the device.
- **LibreOffice bundled in the base installer.** Rejected as default — bloats every install ~300–400 MB
  even for users who never export Office→PDF; hence opt-in download.

## Risks & trade-offs
- **Fidelity vs. size:** Tier 1 is small but approximate; Tier 2 is faithful but large. The two-tier
  split lets users choose; be explicit in the UI about which is active.
- **Per-platform print APIs (Tier 1):** WebView2/WKWebView/webkitgtk differ — real integration cost and
  test surface. Mitigate by starting Windows-first (matches current desktop target).
- **Sidecar packaging/security (Tier 2):** large binary, must run **offline** (disable LibreOffice
  network/update/macros), verify the downloaded pack's hash, sandbox the process.
- **Fonts:** missing fonts degrade fidelity; fetch on-device from the down-only assets service.
- **Reversibility:** additive; native Office output stays the default. Either tier can ship alone.

## Rollout & migration
- **Phase C-1:** Tier 1 on Windows (WebView2 PrintToPdf) behind "Export as PDF". No new large deps.
- **Phase C-2:** optional LibreOffice high-fidelity pack (down-only download), opt-in setting.
- **Phase C-3:** extend Tier 1 print integration to macOS/Linux.
- Acceptance specs: a filled `.docx`/`.xlsx` → a valid, openable PDF whose text matches the filled
  values; signing over the produced PDF verifies. Update the matrix (REQ-15 note) on ship.

## Open questions
- Tauri v2 has no built-in print-to-PDF — confirm the cleanest per-platform hook (WebView2
  `PrintToPdfAsync` via a small Rust command vs. a community plugin).
- Default tier when the high-fidelity pack is absent: Tier 1 silently, or prompt to install Tier 2 for
  complex documents?
- Is Tier-2 worth it for v1, or defer to a later release and ship only Tier 1?
- Should catalogued Office forms use a **template-remap to PDF** path (highest fidelity for known forms)
  instead of rendering?

Produced **ADR-0012** (Tier-1 content export). Tier-2/vector print remain future work.
