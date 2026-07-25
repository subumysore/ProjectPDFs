# ADR-0023 — Code signing & platform distribution strategy (zero-cost first)

- Status: Accepted
- Date: 2026-07-25
- Relates to / builds on: ADR-0020 (distribution trust without a paid certificate),
  ADR-0002 (native cross-platform stack), ADR-0019 (app-only hosted assets),
  `docs/reference/code-signing.md`.
- Scope: consolidates the **ordered** Windows trust plan and adds the **macOS release feasibility**
  picture (not covered anywhere before). Does not supersede ADR-0020; extends it.

## Context

An industry launch review flagged two connected blockers:

- **(A) Windows unsigned build.** The desktop installer is not Authenticode-signed, so Microsoft
  Defender SmartScreen shows an "unknown publisher" wall on first launch. For a *privacy* product
  aimed at non-technical users, an unexpected security warning is disproportionately damaging.
- **(B) macOS is absent.** The app is Tauri v2 and nominally cross-platform (`bundle.targets: "all"`),
  but no macOS build, signing, or notarization path exists, and macOS Gatekeeper is stricter than
  SmartScreen.

The binding constraint is the standing owner rule **"no budget until revenue"**: design the zero-cost
route first; treat paid signing as *later, when revenue allows*. Nothing here purchases, signs up for,
or configures any paid service.

### What already exists (verified in-repo)

- `apps/app/src-tauri/tauri.conf.json` wires `bundle.windows.signCommand` → `sign-windows.ps1`, which
  **no-ops safely when no certificate env var is set** — public builds ship honestly unsigned.
- `scripts/release-manifest.mjs` generates a deterministic **SHA-256 manifest** per release and
  deliberately excludes `.msix` (`signed:false` is hard-coded; a self-signed build must never flip it).
- `deploy/winget/` holds the three winget manifest files (`SubramanyaMysore.PolyglotFormFill*`).
- `docs/marketing/site/install/index.html` already **predicts the SmartScreen warning**, shows the
  exact click path, recommends `winget` to avoid it, and renders per-file SHA-256 from the manifest.
- `docs/reference/code-signing.md` documents the opt-in signing pipeline (thumbprint / PFX + RFC-3161
  timestamp) that activates with one env var when a cert is eventually bought.

So the Windows *free tier* is substantially built. This ADR records the **decision and priority
order**, fills the two gaps (Azure Trusted Signing assessment; macOS), and states honestly what is
deferred.

### Facts that constrain the decision (current as of 2026-07; verify prices/eligibility at purchase)

- A **self-signed** certificate gives **no** public benefit — its chain fails on every other machine,
  so SmartScreen behaves as for unsigned, and an *invalid* chain is treated *worse* than *no* signature
  under some enterprise/AV policies. (Established in ADR-0020; restated because it keeps being proposed.)
- SmartScreen is driven by **download reputation** accruing to a stable (publisher, binary) identity —
  **OV** signing lets reputation accumulate but does **not** clear the warning on day one; only **EV**
  grants *instant* SmartScreen trust.
- **winget** does not require code signing (unsigned `.exe`/`.msi` accepted; checks are non-blocking),
  and a winget install is not a browser download, so Mark-of-the-Web / SmartScreen does not gate it.
- **MSIX / Microsoft Store** *sidesteps the unsigned warning* only because the package must be signed —
  Store submission signs it for you, but the **Microsoft Store one-time individual developer
  registration is a paid fee** and self-distributed MSIX requires a *commercially obtained* cert.
  So MSIX is **not** a zero-cost route; it trades the certificate cost for a Store-account cost.
- **Azure Trusted Signing (rebranded "Azure Artifact Signing", GA ~April 2026, ~US$9.99/month)** is the
  cheapest *real*, CA-chained signing that builds SmartScreen reputation like an OV cert. **Eligibility
  is region-gated**: organizations in US/Canada/EU/UK; **individual** developers currently limited to
  **US and Canada** only, and the applicant needs a verifiable identity. An **India-based owner is
  therefore most likely NOT currently eligible** — this must be checked before counting on it.
- **macOS Gatekeeper**: an unsigned/un-notarized `.app` or `.dmg` downloaded via a browser is blocked
  with *"cannot be opened because it is from an unidentified developer"* (or, on recent macOS,
  *"is damaged"* for quarantined unsigned apps) — bypassable only by a right-click → Open, or removing
  the quarantine attribute. Removing the block *cleanly* requires an **Apple Developer Program
  membership (US$99/year)** to sign **and notarize**. There is no free equivalent of winget's
  cert-optional channel on macOS. Homebrew Cask can distribute, but Gatekeeper still applies to the
  downloaded binary.

## Decision

**Ship now on the zero-cost tier; defer every paid signing purchase until revenue.** Prioritise as:

### Part A — Windows, ordered

**Tier 1 — Free / do now (all already built or a docs edit; no purchase):**
1. **Keep public builds honestly unsigned** — never self-sign public artifacts (ADR-0020).
2. **Publish SHA-256 prominently** — already generated by `release-manifest.mjs` and rendered on the
   install page with a copy-pasteable `Get-FileHash` verify line. Keep it every release.
3. **Keep the "expect this warning" install copy crisp** — the disclosed-in-advance SmartScreen block
   is the single highest-leverage zero-cost move; a predicted warning reads as competence.
4. **Lead with the channels that avoid the warning entirely:** the **browser extension** (Chrome Web
   Store, no SmartScreen) as the front door, and **`winget install SubramanyaMysore.PolyglotFormFill`**
   for desktop (no cert, no Mark-of-the-Web gate). Submit/maintain the winget manifest each release.
5. **Let SmartScreen reputation accrue passively** — with a stable publisher/binary identity and
   growing download volume the warning softens over weeks–months even while unsigned; do not promise a
   fixed date (it is volume-driven, not time-driven).

**Tier 2 — Low-cost, "when revenue allows":**
6. **Azure Trusted / Artifact Signing (~US$9.99/mo)** — cheapest real signing; reputation accrues like
   OV. **Gate: confirm region eligibility first** (individual devs US/Canada only today — likely
   excludes an India-based owner). If ineligible, this tier is unavailable and we skip to Tier 3.

**Tier 3 — Higher-cost, later:**
7. **OV certificate** (~US$150–400/yr via resellers; reputation accrues over time, no instant trust),
   then **EV** (~US$300–700+/yr, hardware token / cloud HSM; **instant** SmartScreen trust) once
   revenue and volume justify it. Preferred first purchase remains **OV** (ADR-0020).

**Explicitly rejected as a "free" Windows fix:** MSIX / Microsoft Store packaging — it removes the
warning only by requiring a *paid* Store account / signing, i.e. the exact cost being avoided. Revisit
only if a Store presence is independently wanted.

### Part B — macOS: honest feasibility, deferred

macOS is **feasible but not zero-cost to do well**, and is **deferred**:

- **Hard requirement: a Mac to build on.** Tauri cannot cross-compile a macOS app from Windows; a
  macOS build needs macOS + Xcode command-line tools (an owned Mac, or a paid cloud-Mac/CI runner).
  This alone blocks a build today regardless of signing.
- **To avoid Gatekeeper blocks: Apple Developer Program, US$99/year** — required to obtain a Developer
  ID certificate, sign the `.app`, and **notarize** (Apple's automated malware scan + stapled ticket).
  This is the only path to a "just double-click to open" experience. It is a *yearly* cost, unlike a
  one-off Windows cert.
- **Zero-cost / interim path (documented, not shipped):** an **unsigned or ad-hoc-signed** `.dmg`/`.app`
  with explicit **right-click → Open** (or `xattr -dr com.apple.quarantine`) instructions. UX downsides
  are real and worse than Windows: newer macOS increasingly presents unsigned quarantined apps as
  *"damaged / move to Trash"* with no obvious bypass, ad-hoc signing does **not** satisfy notarization,
  and each major macOS release tightens this. This path is acceptable only for a technical early-adopter
  build, never as a mainstream front door.
- **Decision:** **do not ship a macOS build now.** Keep `bundle.targets` cross-platform-capable, record
  this path, and revisit macOS as a funded workstream once revenue covers the US$99/yr membership **and**
  a build Mac is available. No fake timeline is promised.

### Cross-cutting

- Everything in Tier 1 is **not thrown away** when a cert is bought: signing is a one-env-var change
  (`WINDOWS_CERT_THUMBPRINT`), the hash manifest stays valuable, winget stays the preferred channel,
  and only the install page's "expect the warning" block is removed — and only once a real CA cert is
  actually in use (the honesty obligation from ADR-0020 stands).
- **Privacy invariant untouched:** signing/notarization are build-time operations on our own binaries
  (a hash to a timestamp/notary authority), never user content.

## Consequences

- **GA stays unblocked on Windows** at zero cost; desktop friction is one disclosed extra click, and
  the extension + winget paths avoid it entirely.
- **macOS users are unserved for now** — stated honestly rather than promised. A real limitation, named.
- We carry ADR-0020's standing honesty obligation: the install page must keep stating the Windows build
  is unsigned until a real CA cert is in use.
- A future purchase decision has a clear, pre-vetted order (Azure Trusted Signing → OV → EV), each with
  its gating condition recorded, so no research is repeated at release time.

## Alternatives considered

- **Buy an EV cert now for instant trust** — rejected: highest cost, violates "no budget until revenue".
- **Self-sign / MSIX / Microsoft Store as a "free" Windows fix** — rejected: self-sign gives nothing;
  MSIX/Store just relocates the cost to a paid account/cert.
- **Ship an unsigned macOS build as a mainstream download** — rejected: Gatekeeper UX on recent macOS is
  too hostile (increasingly "damaged" with no easy bypass) to put in front of non-technical users.
- **SignPath.io free OSS signing** — genuinely free but conditional on an OSS license; left open exactly
  as in ADR-0020, not assumed here.
```
Sources consulted for eligibility/pricing (verify at purchase time):
- Microsoft Learn — Code signing options for Windows app developers
- Azure — Trusted / Artifact Signing pricing (~US$9.99/mo)
- Microsoft Community Hub — Trusted Signing individual-developer sign-up (region-limited)
- Apple Developer Program — US$99/year (signing + notarization)
```
