# Demo assets — for recording the guide video with ZERO real data

Everything here is synthetic. Use it so no real vault, photo, name or document ever appears in a
frame again (see the 2026-07-23 PII incident).

| File | Use |
|---|---|
| `demo-profile.json` | The primary fake identity (Alex Kumar). Fields match the sample forms, so one-click fill visibly completes them. |
| `demo-profile-family.json` | A second profile (spouse) — for the *family members* part of the profiles pitch. |
| `demo-profile-corporate.json` | A corporate profile (Acme Corp Finance) — for the *different form, different profile* office pitch. |
| `demo-photo.png` | Placeholder passport photo — import into the photo field / the form's photo box. |
| `demo-signature.png` | Placeholder signature ("Alex Kumar") — use as the saved-signature image. |
| `sample-flat.pdf` | A **flat** application form: no fillable fields. Use for the flat → fillable → one-click demo. |
| `sample-acroform.pdf` | The **same form with real fields** (incl. a radio group and a checkbox). Use for the existing-form one-click demo. |

## Setup before recording

1. In the app, **add a new profile** called `Demo` and select it. (Do NOT record your real profile.)
2. Add the fields from `demo-profile.json` (type them in — this also demonstrates manual entry).
3. Add `demo-photo.png` via the photo field and `demo-signature.png` via the signature image.
4. Confirm the vault shows only **Alex Kumar / fake data**. Now nothing real can appear.

Follow `../shot-list.md` for the sequence, and read `../narration.json` for each line.
