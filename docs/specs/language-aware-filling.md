# Spec: Language-aware form filling (ETCHED — do not weaken without an RFC)

Status: **Accepted** (owner-confirmed 2026-07-20). Supersedes the ad-hoc "translate a
text box" tool, which is NOT the intended model.

## Invariants (non-negotiable)
1. **On-device only.** All translation runs on-device (transformers.js / opus-mt).
   Only model + font assets download (assets-down). No user content egress. (Honors the
   CLAUDE.md privacy invariant.)
2. **Output is always in the form's ORIGINAL language.** Whatever the user reads or
   types in their own language, the *rendered/exported* form is in the language the
   form was authored in. This is the load-bearing rule.

## Native language
- The user's **native language is a PROFILE FIELD in the vault** (`native_language`),
  not a device setting — it syncs across devices and through the desktop companion.
- Everything below keys off this profile value.

## Form language
- The form's language is **auto-detected** from its extracted text.
- The user can **override** the detected language.

## Behaviour

### Case A — form language == native language
- Fill directly; values placed as stored.
- The user MAY optionally choose to fill in a *different* language → those values are
  translated to the chosen language for output (output still in that chosen language,
  i.e. what the user explicitly selected for this form).

### Case B — form language != native language
- **View:** show the form's text (labels, questions, instructions) translated into the
  native language via a **bilingual SIDE PANEL synced with the form** — the original
  document stays pixel-perfect (chosen over full re-render for fidelity). Web forms may
  additionally translate in place.
- **Fill:** the user enters free-text answers in their native language.
- **Output (invariant #2):** free-text answers are translated **back into the form's
  original language**; the final form renders in the form's original language.

### What translates vs passes through
- **Translate both ways (meaning):** form labels/questions/instructions, and **free-text
  answer values**.
- **Pass through untouched (identity data):** names, numbers, SSN/TIN, dates, emails,
  phone. These are data, never translated.

## Translation coverage
- opus-mt models are pairwise with English. Any-to-any is achieved by **pivoting via
  English** (e.g. hi→en→fr). Both pairs download on demand.

## Output fonts (for drawing values into PDFs)
- Latin (English/Spanish/French/German): built-in PDF fonts.
- **Devanagari (Hindi)** and **CJK (Chinese)**: embed on-demand hosted Noto fonts via
  fontkit — the built-in fonts cannot draw these scripts. (Arabic/RTL deferred.)

## Phasing (implementation)
1. `native_language` profile field (vault + UI + companion sync). Any-to-any pivot in
   translate.js.
2. Form-language auto-detect (+ override) wired into the fill flow.
3. Bilingual side-panel view (PDF viewer tab; web-form in-place option).
4. Answer translation on output + script-font embedding (Devanagari, CJK) for PDF draw.

## Out of scope (for now)
- Full translated re-typesetting of a PDF (rejected in favour of the side panel).
- Arabic / RTL output rendering.
