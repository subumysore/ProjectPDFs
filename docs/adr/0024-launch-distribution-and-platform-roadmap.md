# ADR-0024 — Launch distribution & platform roadmap (entity-triggered)

- Status: Accepted
- Date: 2026-07-25
- Deciders: Owner (Subramanya Mysore)
- Relates to / builds on: **ADR-0023** (code signing & platform distribution strategy — zero-cost
  first), ADR-0020 (distribution trust without a paid certificate), ADR-0018 (language-agnostic
  engine), ADR-0002 (native cross-platform stack), ADR-0022 (guide-video pipeline & stable hosting).
- Scope: records the OWNER decisions from the 2026-07-25 launch-planning session — go-to-market
  positioning, language-pack prioritisation, install-path presentation, and the **sequenced, paid
  platform work gated on registering a business entity**. **Extends ADR-0023; does not supersede it.**

## Context

A launch-planning session covered how to take the product to market now (zero-cost) and what the
paid, platform-widening work should be — and in what order — once the owner has the standing to
undertake it. The binding constraints are unchanged and stated honestly:

- **"No budget until revenue"** (standing rule): the zero-cost route is designed first; paid work is
  deferred, not scheduled to a calendar date.
- **A second, newly explicit trigger: a registered business entity.** The owner is "planning one
  soon". Several paid platform steps (EV code-signing, Azure Trusted Signing org eligibility, Apple
  Developer Program, Microsoft Store) are materially easier, cheaper, or *only* available to a
  registered organisation with a verifiable identity — so they are sequenced **around the entity
  existing**, not around a date.
- **Translation is on-device NLLB, any-to-any** (ADR-0018): there is no per-language-pair rollout to
  gate a market on — the engine already translates between arbitrary languages locally, and the UI
  ships in 26 languages. "Language rollout" is therefore a *QA / pre-staging* concern (which packs are
  verified and pre-warmed), not a capability gate.

The two triggers are **"revenue"** and **"entity registered"**. This ADR names them as triggers and
deliberately promises **no dates**.

## Options considered

1. **Roll languages out per-pair, extension-first, buy an EV cert now** — rejected: per-pair rollout
   contradicts the any-to-any on-device engine (ADR-0018); extension-first under-sells a capable
   desktop app; buying a cert now violates "no budget until revenue".
2. **Defer everything paid until "later" with no ordering** — rejected: leaves release-time research
   to be redone and gives the owner no clear first move when the entity/revenue triggers fire.
3. **Zero-cost now; a pre-vetted, entity-triggered SEQUENCE for the paid work; positioning and QA
   priorities that match the actual engine** — chosen.

## Decision

### 1. Go-to-market positioning — all three niches, equally

Lead with **all three target niches given equal weight**, not one hero use-case:

- **Immigration / relocation** (newcomers filling government & settlement forms in an unfamiliar
  language).
- **Cross-border freelancers / SMBs** (tax, KYC, vendor onboarding, contracts across jurisdictions).
- **Privacy / crypto** (users who require that form content never leaves the device).

The on-device privacy invariant and any-language capability serve all three; the landing page and
store copy present them side-by-side rather than ranking one first.

### 2. Language packs — prioritise by global speaker volume (QA / pre-staging, not per-pair rollout)

Because translation is on-device NLLB **any-to-any** and the UI is already localised into 26
languages, **there is no per-pair feature rollout**. What we *do* prioritise is the **pre-staging and
QA of packs by GLOBAL SPEAKER VOLUME**, so the most-spoken languages are verified end-to-end and their
assets (fonts / model warm-up) pre-warmed first:

> Spanish, Chinese, Arabic, Portuguese, French, Russian, Bengali, … (continuing down world
> speaker-volume rankings).

This is a testing/asset-staging order only — it never gates or withholds any language from a user who
needs it (the engine remains language-agnostic per ADR-0018).

### 3. Install path — desktop and extension presented EQUALLY

Present the **desktop app and the browser extension as equal, co-primary entry points** on the
website, install page, and store copy. This revises the earlier "extension-first" *presentation*
emphasis (from ADR-0020's channel-ordering, which was about avoiding the SmartScreen warning) — the
desktop app is a first-class front door, not a fallback. (The *trust* rationale for winget/extension
channels in ADR-0020/0023 is unchanged; only the marketing presentation is levelled.)

### 4. Paid platform work — DEFERRED and SEQUENCED around registering a business entity

Paid platform-widening work is deferred until the owner has **registered a business entity** ("planning
one soon"). When the entity exists, do the following **in order** — each step's gate is recorded so no
release-time research is repeated:

1. **EV code-signing certificate** — buy once the entity exists. Grants **instant SmartScreen trust**
   (the only option that clears the first-launch warning on day one). Requires the registered
   organisation identity. This is the highest-leverage post-entity move for Windows trust.
2. **Re-check Azure Trusted Signing (org) eligibility** — ADR-0023 noted individual-developer
   eligibility is region-gated (US/Canada) and likely excludes an India-based *individual*. A
   registered **organisation** may qualify under the org tier; re-assess eligibility and price at that
   point as the cheapest ongoing CA-chained signing.
3. **macOS desktop** — Apple Developer Program (**US$99/year**) **plus a build Mac** (Tauri cannot
   cross-compile macOS from Windows) **plus notarization**. This is the path to a "double-click to
   open" macOS experience (ADR-0023 Part B); undertaken as a funded workstream once the membership and
   a build Mac are available.
4. **Microsoft Store / MSIX listing** — a signed Store listing (the Store signs the package) removes
   the unsigned-download friction on Windows and adds a discovery surface; it carries a Store-account
   cost, so it follows the signing and macOS steps.

**Triggers, not dates:** items in §4 fire on **"entity registered"** (and, for the purchase amounts,
"revenue allows"), never on a calendar date. No timeline is promised.

## Consequences

- **Positive:** the owner has a clear, pre-vetted first move for the moment the entity registers (EV
  cert → Azure org re-check → macOS → Store), so no research is redone at that point. Positioning and
  language-QA priorities now match the actual any-to-any engine rather than implying a per-pair rollout.
  Desktop is no longer under-sold.
- **Negative / cost:** macOS users remain unserved until §4.3 (named honestly, as in ADR-0023). Every
  §4 item is a real, recurring or one-off cost, undertaken only post-entity/post-revenue.
- **Follow-ups / new risks:** re-verify all prices and eligibility at purchase time (they drift);
  confirm Azure Trusted Signing org-tier availability for an India-registered entity when the time
  comes; the "entity soon" trigger is outside our control, so nothing here blocks the zero-cost GA.
- **Unchanged:** the privacy invariant (signing/notarization act on our own binaries, never user
  content) and ADR-0020's honesty obligation (the install page keeps stating the Windows build is
  unsigned until a real CA cert is actually in use).

> ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes this one.
