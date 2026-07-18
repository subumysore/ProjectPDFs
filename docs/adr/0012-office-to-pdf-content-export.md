# ADR-0012: Office → PDF via on-device content export (Tier 1)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** PolyglotFormFill team
- **Related:** RFC-0003, RFC-0002 / ADR-0011, REQ-15.1; ties to REQ-07/08/09.

## Context
A filled `.docx/.xlsx` should be exportable to **PDF** for uniform signing, submission, and printing —
**on-device**, never via cloud. Faithful OOXML→PDF needs a real layout engine (browser or office
suite); no mature JS library reproduces Word/Excel layout. We needed a shippable, verifiable first
step that adds no large binary and works cross-platform.

## Options considered
1. **Content export via pdf-lib (chosen for Tier 1).** Extract the filled document's text in reading
   order (paragraphs, table rows, sheet rows) and lay it into a PDF with pdf-lib (already a dependency).
   Pros: zero new deps, fully on-device, cross-platform, unit-testable. Cons: not pixel-faithful;
   WinAnsi-only glyphs (non-Latin like Devanagari degrade to `?`).
2. **HTML → platform print-to-PDF (webview).** docx-preview/SheetJS → HTML → WebView2/WKWebView print.
   Better layout, but per-platform print APIs and integration/test cost; deferred.
3. **LibreOffice headless sidecar.** Near-perfect fidelity, uniform across platforms, but ~300–400 MB;
   ship later as an **opt-in** high-fidelity pack, not in the base installer.
4. **Cloud/Office-365 conversion.** Forbidden — user content would leave the device.

## Decision
Adopt **Option 1** as **Tier 1**: an on-device, dependency-free content PDF export
(`officeToPdf` in `office.ts`). It yields a readable, signable PDF that flows into the existing
render/sign/submit path unchanged. Fidelity is explicitly "content, not pixel-faithful"; Options 2 and 3
are the future higher-fidelity tiers (RFC-0003 Phases C-2/C-3), and Option 4 stays forbidden.

## Consequences
- **Positive:** Office forms can now become PDFs entirely on-device with no new dependency or binary;
  signing/submit/print work over the result; cross-platform; unit-tested.
- **Negative / cost:** approximate layout (linearised text); non-WinAnsi text degrades to `?` until a
  Unicode font is embedded or a higher-fidelity tier ships.
- **Follow-ups:** Tier-2 LibreOffice opt-in pack; per-platform vector print; embed a Unicode font (with
  on-device font fetch from the down-only assets service) to fix non-Latin export.

> ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes this one.
