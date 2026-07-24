# Guide video v2 — build plan (SHOW must match TELL)

GOVERNING RULE: every segment's VISUAL shows exactly what the AUDIO says. When the voice claims
something, the screen demonstrates that exact thing on a real form. Built from the owner's corrections
(2026-07-24). Nothing recorded until the owner locks this + picks a voice.

## Owner's corrections (all folded in)
1. Opening shows VARIOUS FORMS filling with the SAME data + use-case scenarios — NOT the language flip.
2. Every "one click / fill" line shows THAT form going empty → filled.
3. Drop-downs, radio buttons, tick-boxes are SHOWN being answered (not a plain window).
4. Photo + signature land in a DEDICATED photo box / signature line — never over text boxes.
5. Manual-entry round-trip is SHOWN: type a new field once → app saves it → it appears in the vault (the 2:25 gap).
6. OFFICE/corporate cut STARTS FRESH — clean vault, ONLY corporate profiles on screen, no personal ones.
7. Video at FULL resolution — crisp, no 1280 blur.
8. Audio professional with tone modulation (voice route: A/B/C — pending).

## Segment table (order = final cut)
| # | TELL (narration) | SHOW (visual) |
|---|---|---|
| 1 | Brand + "polyglotformfill.mooo.com" | URL title card |
| 2 | Passport, school, job, medical — the SAME name/address/DOB over and over; one profile fills them all | John Doe's saved data, then it filling a **Passport**, **School**, **Job** form (same data) |
| 3 | Build your profile in seconds — snap an ID | ID capture → 7 fields land in the vault |
| 4 | A dead scan with no boxes becomes a live form | Flat PDF → Detect fields → fillable boxes appear |
| 5a | One click, every field filled | The form's TEXT fields populate from the vault |
| 5b | Not just text — drop-downs, radios, tick-boxes too | Same form: a **dropdown** picks, **radio** selects, **checkbox** ticks — in that one click |
| 6 | Your photo and signature drop exactly where they belong | Form with a **Photo box** + **Signature line** → photo into the box, signature on the line |
| 7 | Type anything new once and it's remembered | Type value on the form → "Save to your vault?" → **new key/value appears in the vault** |
| 8a | At home — a profile for each family member | Personal vault: create Jane / Emma (spouse, child) |
| 8b | At the office — a profile for each purpose | **FRESH start — clean vault, NO personal profiles**: create Acme Inventory / Finance / Vendor only |
| 9 | Sign by hand, in any ink | Draw the signature in blue on the form |
| 10 | Any online form fills in one click too | The browser **extension** filling a web form |
| 11 | Read any form in your language — 26 of them | Website language switch to **Kannada** |
| 12 | Everything on your device; we never see it | The privacy panel |
| 13 | Get it free at polyglotformfill.mooo.com | URL title card |

## Scenario forms to build (AcroForm PDFs, all fill from ONE John Doe profile)
Each includes the controls its narration needs, so nothing is claimed-but-not-shown:
- **Passport renewal** — text (full_name, DOB, nationality), **photo box**, **signature line**.
- **School enrolment** — text + a **dropdown** (e.g. Grade/Country) + **checkbox** (consent).
- **Job application** — text + **radio** (e.g. employment type / gender) + **dropdown** (marital status).
- **Medical intake** — text + **radio** + **checkbox** (declaration) + **signature line**.
(Engine already fills choice controls via optmatch and image fields via the resolver — real, not faked.)

## Quality
- Encode at FULL 2560-wide (or 1920), CRF 18, preset slow → crisp text. Maximized app capture.
- PII-safe: synthetic John Doe only; demo-vault swap; app-region capture (file dialogs are off-frame).

## Voice (the one open decision)
- A = higher-quality free Piper voice (on-device, still synthetic).
- B = paid cloud TTS (professional; conflicts with "no budget until revenue").
- C = owner records the voiceover (best + free; ~10 min). ← recommended.
