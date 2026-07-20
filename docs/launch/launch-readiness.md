# Commercial Launch Readiness — PolyglotFormFill

Decisions (2026-07-20): ship **Extension + Desktop together**; distribute via **self-hosted
download + Chrome Web Store in parallel**; **Lemon Squeezy** payments (store approved,
products to be created); **full & safe** legal (counsel-reviewed terms) + **signed** desktop.

Status legend: ⛔ blocked · �017 in progress · ✅ done · ⬜ not started. Owner: **E**=engineering (me) · **O**=owner (you).

## Critical path (longest lead time — START THESE NOW)
These gate the launch date more than the code does:
1. **[O] Code-signing certificate** (OV, or EV for instant SmartScreen trust) — purchase +
   business-identity verification. **Can take several days (EV longer).** Needed to sign the
   desktop installer. → provide the cert (or CA account) to E for the signing pipeline.
2. **[O] Legal counsel review** of `docs/legal/EULA.md` + `docs/marketing/site/privacy` —
   returns approved copy. Parallelisable; start immediately.
3. **[O] Lemon Squeezy products** — create from `docs/business/lemonsqueezy-setup.md`; send E
   the **Store ID, per-tier Variant IDs, API key, webhook signing secret**.
4. **[O/E] Chrome Web Store + Edge developer accounts** — O registers ($5 Google one-time; MS
   account); E prepares the listing + package.

## Workstreams

### A. Engineering (E) — I own these
| id | item | status |
|---|---|---|
| A1 | Multi-profile + create/overwrite-from-scan (RFC-0007) | �  in progress |
| A2 | Full QA pass — extension, every feature end-to-end in a loaded browser; fix bugs | ⬜ |
| A3 | Validate the translation RUNTIME in a real browser (gates language features) | ⬜ |
| A4 | Desktop runtime QA (Tauri) — E writes the test script; **O runs it** (needs the app) | ⬜ |
| A5 | Security self-review (CSP, permissions least-privilege, data handling, crypto) + fixes | ⬜ |
| A6 | Payments wiring — Buy buttons + webhook + on-device license activation (needs B3 IDs) | ⬜ |
| A7 | Chrome Web Store / Edge listing: manifest polish, description, screenshots, **privacy & permission justifications** | ⬜ |
| A8 | Definition-of-Done for launch-critical features (unit + acceptance `.feature`) | ⬜ |
| A9 | Desktop installer build + signing pipeline (consumes O's cert) | ⬜ |
| A10 | Provision non-en/hi translation models into `apps/app/public/models` | ⬜ |
| A11 | Edge-case hardening + error UX; consistent copy; tutorial videos (front/back DL + why) | ⬜ |

### B. Owner (O) — only you can do these
| id | item | why it's yours |
|---|---|---|
| B1 | Buy + verify code-signing cert (A9 blocker) | identity/payment; CA verification |
| B2 | Legal counsel review of EULA + privacy | legal sign-off |
| B3 | Create Lemon Squeezy products; send Store/Variant IDs + API key + webhook secret | your merchant account |
| B4 | Register Chrome Web Store + Edge dev accounts | your identity/payment |
| B5 | Confirm business entity (MoR payouts, cert, trademark) | legal/financial |
| B6 | Support email/channel for customers | ops |
| B7 | Run the desktop QA script locally + report results | you have the machine |
| B8 | Final pricing confirmation (tiers/prices) | business |
| B9 | Decide: third-party security audit vs E's self-review for the privacy claims | risk/budget |
| B10 | Provide a few real ID/passport specimens for QA (optional) | test data |

## Honest timeline
Not tomorrow. With the long-lead items (cert verification, legal review, Web Store review)
started **now**, a realistic **full & safe** commercial launch is ~**2–4 weeks**. A polished
**private beta** (self-hosted download + videos, small group) is doable within a day.
