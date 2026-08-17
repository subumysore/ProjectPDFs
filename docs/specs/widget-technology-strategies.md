# Spec — Know the technology, then fill it. No poking around.

Every bug this week came from the same habit: the engine touched a widget, looked at what happened,
touched it again. That is dancing. A form is built with a *known* technology, and each technology has a
documented way to be read and set. Detect it once, apply that contract, verify once, move on.

## Detect first — from markup, not from behaviour

| Technology | Detected by | How it commits a choice |
|---|---|---|
| Native `<select>` | tag | set `.value`, fire `input` + `change` |
| react-select (Greenhouse, Lever, many SaaS) | `.select__control`, rows `react-select-<name>-option-N`, input `aria-controls=…-listbox` | type to filter, click the row (measured: any gesture works) |
| Ant Design / rc-select (Dayforce, enterprise) | `.ant-select`, panel via input `aria-controls`, rows `.ant-select-item-option` | click selector to open, type, click row |
| Workday (React, custom) | `data-automation-id`, questions via `aria-labelledby`, ids like `input-24` | button-menus: click, then click the option by text |
| Angular Material / ng-select | `mat-select`, `.ng-select`, panel `.cdk-overlay-pane` | click trigger, options are `mat-option` |
| PrimeNG | `.p-dropdown`, `.p-dropdown-item` | click, then click item |
| Plain ARIA combobox | `role="combobox"` + `aria-controls` | ArrowDown/Enter, or click `[role=option]` |
| intl-tel-input phone | `.iti`, `.iti__country-list` | its own country list — never the form's country field |

Rules that follow from the table, and that today's bugs prove are needed:

1. **Rows are the widget's OWN** — resolved through `aria-controls` / the library's option-id prefix.
   Never "the open panel nearby": that is how a country choice was clicked in the phone widget's list.
2. **Long lists are virtualised.** The wanted row usually does not exist yet. Type the narrowing term
   first — the country NAME for a dialling list, the value for a text list — then match. Never scan.
3. **The term comes from the concept, not from a scan.** Country → canonical name; dialling code →
   country name (+ ISO, + code as fallbacks); yes/no → nothing typed.
4. **Verify once, from the widget's own display**, then stop. No retry except for a list that depends on
   another field (State on Country), and only that one.
5. **A recognised list that lacks our answer is final** — leave the field blank; do not let a second
   pass type into it again.

## Reading the question — the other half of common sense

- Workday attaches the question via `aria-labelledby`; the input carries only an id. Resolve it, or every
  answer is junk (this is why a whole application's answers reached the vault as nothing).
- A field's OWN identity wins over neighbouring text. "Fax", "Phone Extension", "LinkedIn Profile" are
  their own concepts precisely because a neighbour's label bled into them.
- A concept the engine owns is never re-decided by generic fuzzy matching afterwards.

## How this gets built without another week of dancing

- **Fixtures, not live pages.** Save the real option lists and markup of each technology under
  `docs/testing/widget-fixtures/`. Iterate in milliseconds; a live run is for confirmation only.
- **One adapter per technology**, each with: `detect(el)`, `open(el)`, `rows(el)`, `commit(row)`,
  `verify(el)`. Table-driven, so adding a platform is a table entry, not a new branch in a long function.
- **The coverage harness is the gate** (`scripts/e2e/coverage-run.mjs`), before and after every change.
  It has already caught two regressions I would otherwise have shipped.
- **Budget: under 1 second** for a form like Dayforce (currently 8.3 s, was 15.8 s).
