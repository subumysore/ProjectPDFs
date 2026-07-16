# ADR-0005: Public Form Catalog (documents + web forms)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Team
- **Related:** RFC-0001

## Context
Worst-case on-device field detection is unreliable (feasibility trial), but most target forms are
public/standard. We need fast form search and reliable field maps without OCR-on-every-open.

## Options considered
1. **Public Form Catalog** (metadata, tags, blank templates, curated field-maps, fingerprints),
   served DOWN; on-device index for private search; covers **PDF/DOCX/XLSX/WebForm**.
2. Pure on-device detection every time — unreliable on bad scans, no reuse.

## Decision
Ship a **public Form Catalog** of public form knowledge only (no user content). Catalogued forms
**skip OCR/detection** (documents) or autofill via **DOM selectors** (web forms); OCR/detection is the
**fallback**. **Search runs on-device** (index synced). Contributions are **structure-only, consented.**

## Consequences
- Positive: turns the biggest technical risk into a strength; fast search; a moat.
- Negative: ongoing curation/moderation/versioning cost; template-fetch reveals only "which form."
