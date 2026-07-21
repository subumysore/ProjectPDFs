# ADR-0017 — User-selectable fill language (supersedes the "output always original" invariant)

- Status: Accepted
- Date: 2026-07-20
- Deciders: Owner (subumysore@gmail.com), confirmed via product decision on 2026-07-20
- Supersedes: the ETCHED invariant in `docs/specs/language-aware-filling.md` and memory
  `language-aware-filling-spec` — *"the rendered/exported form is ALWAYS in the form's
  original language."*

## Context

The original language-aware-filling spec (2026-07-20) etched an invariant: the exported
form always stays in the form's own language, so the recipient can always read it; the
user's language was for *reading* only (a bilingual side panel), never for output.

In use, the owner asked for more: the ability to **fill a form in any language of their
choice**, to **store their vault key/value pairs in their own language/script**, and to
**continue filling a form in that chosen language**. Presented explicitly with the
conflict against the etched invariant, the owner chose to **override it** and allow
writing values into the form in the chosen language.

## Decision

1. **Fill language is user-selectable.** The user picks the language a form is filled in.
   The language selector is ordered: **(1) the user's native language, (2) the form's own
   detected language, (3) all other supported languages alphabetically.** A language's
   on-device model/font downloads **only when the user selects it** (lazy).
2. **The exported/filled form reflects the chosen fill language.** Labels' free-text
   answers are translated, and names/numbers/IDs are transliterated into the chosen
   script (never machine-translated — that hallucinates). This **replaces** the old
   "output always original" invariant.
3. **Default fill language = the form's own language** (preserves recipient readability
   unless the user deliberately chooses otherwise). Choosing another language is an
   explicit, labelled action.
4. **Vault values may be stored in the user's native language/script.** Identity values
   are transliterated/translated to the chosen fill language on output, so a value stored
   in Devanagari can fill an English form (and vice-versa).
5. **"View this page in my language" is READ-ONLY** — it shows the form and the
   would-be values in the chosen language and does **not** fill or modify the document.
   Filling is a separate, explicit action ("Fill this page" / "Fill in <language>").
6. Unchanged, still binding: **on-device only** (privacy invariant, ADR/CLAUDE.md);
   **pivot via English** for any-to-any; **script fonts** (Devanagari/CJK embedded
   on-demand via fontkit; Arabic/RTL deferred); the bilingual side panel remains for
   reading.

## Consequences

- **Positive:** matches how multilingual users actually work — keep identity in your own
  script, produce a form in whatever language the situation needs.
- **Trade-off:** a form can now be exported in a language the recipient may not read;
  mitigated by defaulting to the form's own language and labelling any override.
- **Quality:** transliteration is phonetic → approximate; storing the value in the target
  script in the vault yields exact output. Machine translation of free-text is best-effort
  on the small on-device models.
- **Work implied:** the fill path must translate/transliterate values before writing and
  embed the target script's font (leverages `translit.js`, `translate.js`, `fonts.js`).
  Tracked as the next implementation phase.
