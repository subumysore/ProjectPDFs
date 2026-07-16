# Feasibility — Optimistic Approach (the "happy path")

_How ProjectPDFs works when everything goes right. This is the target we build toward; the
worst-case trial (`02-worst-case-trial.md`) stress-tests the risky links in it._

## The optimistic end-to-end flow

1. **Ingest.** User uploads a PDF or points to a URL. The app fetches it (inbound only).
2. **Classify the document:**
   - **Editable (AcroForm/XFA)** → read declared fields, names, types. *No detection needed.*
   - **Digital non-editable** (has a vector text layer) → read text + positions from the content
     stream (`getTextContent` + line/rect operators). *No OCR needed — high accuracy.*
   - **Scanned image** → on-device OCR (text + boxes).
3. **Detect fields** (only when not already editable): find writable regions from visual structure
   (underlines, boxes, comb cells, checkboxes) + associate each with its label.
4. **Name & type fields** with an on-device model, aligned to the ask; map labels → a canonical
   multilingual ontology (`date_of_birth`, `address_city`, …).
5. **Autofill** matched fields from the on-device **Vault**; generate a new KV pair (prompting the
   user) for anything the vault lacks.
6. **Translated working view.** Render the form; show labels in the user's chosen language via an
   **on-device** translation model. User fills in their language.
7. **Annotate.** Signatures / images / free-hand writing captured as a **separate layer** linked to
   the untouched original; watermark optional.
8. **Export.** Stamp values (choice: original form language or user's language), subset-embed the
   required font on-device, produce the filled PDF.
9. **Save / Submit.** Save locally (encrypted at rest) and/or submit to the vendor's endpoint
   directly (user-initiated; HTTP warned). Every change is a new immutable Version; History records
   Save/Submit/Print counts.
10. **Index for search.** Auto-tag + embed (tags + summary) into a **local vector index** so the AI
    search bar can retrieve the form later, with name + tags + thumbnail.

**Privacy holds throughout:** every step touching user values runs on-device; only fonts/models
flow down; the only user-data egress is the user-initiated submit.

## Why the optimistic path is credible (evidence)

- **Editable + digital PDFs** are a large share of real-world forms — those skip OCR/detection
  entirely and hit near-100% accuracy.
- **On good-quality scans, OCR + detection work well.** Measured in the trial: clean bilingual
  (JA+EN) form → OCR labels **6/6**, auto field-detection **5/6**, underline detection **6/6**.
- **On-device translation is proven at scale** (Firefox ships Bergamot/quantized NMT to hundreds of
  millions of users, fully local).
- **Font subset-embedding is a solved engineering step** (pdf-lib + fontkit; demonstrated in the
  `translated-fill` spike build).

## Force-multipliers that make it robust (not just optimistic)

- **Template memoization:** fingerprint each unique blank form; derive its field map once, reuse
  forever. Turns detection from a per-open problem into a per-form-once problem. (Templates are
  structure, not user values → shareable without breaking privacy.)
- **Human-in-the-loop editor:** confidence-scored fields; user can add/resize/retype/confirm. The
  guaranteed floor: rendering + manual placement never fail, so a form is *always* completable.

## Staging
- **V1:** editable + digital-text path, CV/heuristic detection on scans, ontology autofill, template
  memoization, on-device translation, annotation layers, local search, great manual editor.
- **V-next:** on-device ML layout detector + semantic naming to shrink manual correction; Word/XLS.
