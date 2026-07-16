# Market & Technical Re-assessment (pre-go-ahead)

_Date: 2026-07-16. Reassesses stack + design now that scope is known (13 pillars, ADR-0002…0009),
and sizes the market. Market figures are anchored to cited third-party reports; TAM/SAM/SOM and
adoption scenarios are **reasoned estimates**, labelled as such._

---

## Part A — Technical & design re-assessment

### Verdict: architecture holds; the risk has shifted from *feasibility* to *scope*.
The privacy-first, on-device, native architecture survives the expanded scope with **no internal
contradictions** — and it is the product's moat. But the feature set is now a **multi-year platform**,
not an MVP. The dominant risk is no longer "can it be built" but "can it be built *in the right
order without drowning*."

### What still holds
- **Privacy invariant + on-device model** — unchanged and validated across all 13 pillars. It is the
  differentiator and also lowers COGS (few servers) and breach liability (we hold no user data).
- **Rust core** — correct given the crypto/PKI/signature/biometric surface and performance needs.
- **Catalog-first field maps** — turns the worst technical risk (field detection) into a strength.
- **Minimal server footprint** (catalog + assets + account) — low cloud cost, strong privacy, low
  regulatory exposure. A genuine business advantage, not just an ethics stance.

### The top risks now (ranked)
1. **Tauri v2 mobile maturity — the #1 gating item.** We now depend on many native mobile bindings:
   pdfium, ONNX runtime, **external biometric-scanner SDKs**, platform **WebAuthn/passkeys**, OS
   **secure keystore**, camera. Tauri v2 mobile is newer than desktop. **Must spike before commit;**
   if it can't host these reliably, fallback is **Flutter** or native-per-platform — a real pivot.
2. **Scope / sequencing.** 13 pillars + 9 ADRs cannot ship at once. Without hard phasing this stalls.
3. **Security + legal are now first-class workstreams, not afterthoughts:** e-signature legal
   validity per jurisdiction (eIDAS / US ESIGN / **India IT Act + Aadhaar eSign**), **biometric law**
   (special-category), data-protection (GDPR / **India DPDP Act 2023** — our on-device model is a
   strong compliance fit), and PKI/authority key trust for provenance.
4. **Team breadth.** Rust + TS + mobile + on-device ML + cryptography + PKI + i18n at scale is a
   broad, senior skill set. A small team can only do this phased.
5. **Catalog curation** is an ongoing operational cost (and the moat) — needs moderation/versioning.

### Recommended phasing (de-risks scope)
- **Phase 0 — spikes:** Tauri v2 mobile bindings; translated-fill quality; catalog match. Go/no-go.
- **Phase 1 — MVP:** single-user; catalog-first fill + vault autofill + translated view + Tier-1
  signing + encrypted local store; 2–3 languages (e.g. Hindi/English + one test script).
- **Phase 2:** data-source extraction; web-form autofill; OCR fallback; more languages.
- **Phase 3:** institutions/admin; multi-party documents; encrypted sharing.
- **Phase 4:** in-person biometric signing; authority-scoped provenance.

### Design go-ahead recommendation
**Proceed to Phase 0 + Phase 1** — the architecture and stack are sound enough. Gate the full commit
on (a) the Tauri-mobile spike and (b) a legal/compliance scoping pass. **Do not build all 13 pillars
at once.**

---

## Part B — Market survey

### Adjacent markets (anchors, third-party)
| Market | 2025 size | 2030 outlook | CAGR | Source |
|---|---|---|---|---|
| Digital/e-signature | ~$13.4B | ~$70B | ~39% | MarketsandMarkets |
| e-signature platform (narrower) | ~$7.0B | ~$24.5B | ~28% | Mordor Intelligence |
| PDF editor software | ~$3.1B | — | ~10% | 360iResearch / others |
| **APAC e-signature (fastest region)** | ~$3.0B | ~$16.1B | **~40%** | Mordor Intelligence |

Comparable company: **airSlate/pdfFiller** — form-filling + workflow, **100M users, ~$120M ARR,
900k customers, $1.25B valuation.** Proof that form-filling monetises. **DocuSign** — $2.76B FY24
revenue (97% subscription), the e-sign leader (cloud, enterprise, not multilingual-fill, not private).

### TAM / SAM / SOM (reasoned estimate)
- **TAM** — global digital-document + e-signature + form-automation, 2030: **~$40–70B.**
- **SAM** — the slice we can serve: privacy-first + multilingual form-filling for individuals, SMBs,
  and institutions in initial geographies (India + global immigration/expat + privacy-sensitive EU):
  **~$3–6B by 2030.**
- **SOM** — realistic 3–5 yr capture with good execution: **~$20–100M ARR** (airSlate reached $120M;
  we start smaller, differentiated).

### Why this product has real whitespace
No incumbent combines: **on-device privacy + any-language translated-fill + a public form catalog +
multi-party + device-less biometric signing.** DocuSign/Adobe/airSlate are cloud, English-centric,
and not privacy-first. Our defensible position is strongest in **privacy-sensitive markets (EU)**,
**multilingual emerging markets (India, SE Asia, Africa, LATAM)**, and the **immigration/expat niche**
globally (foreign-language forms).

### India deep-dive (standout fit)
- **Reach:** ~**900M+ internet users**, ~**622M+ smartphone owners**, **94% mobile-first**, only
  ~55% penetration (headroom). (DataReportal / Nielsen 2025.)
- **Language:** **22 scheduled languages** + Hindi/English; ~78% Indo-Aryan, ~20% Dravidian; low
  functional English literacy. → **translated-fill is a killer feature** — citizens routinely fill
  English/Hindi government forms they cannot fully read.
- **Form burden:** welfare schemes, KYC, bank/insurance onboarding, exam & job applications, land
  records, court filings — enormous, largely Aadhaar-linked.
- **Digital Public Infrastructure tailwinds:** **Aadhaar eSign** (legally valid → Tier-1 signing),
  **DigiLocker** (data-source docs), UPI. Integratable rails, not competitors.
- **Distribution channel that fits us perfectly:** **~500k+ Common Service Centres (CSCs)** —
  village kiosks that fill forms *for* citizens. This is exactly our **institution/admin + in-person
  biometric (device-less signee)** model: operator fills, citizen signs with a **thumbprint**. It
  validates the biometric-signing pillar as a real India use case, not a hypothetical.
- **Compliance:** **DPDP Act 2023** favours our on-device model; less exposure than cloud rivals.

### Monetisation & unit economics
- **Freemium consumer** (free basic fill; paid translation/storage/advanced) — low direct WTP in
  India, so lean on channels.
- **B2B / institution subscriptions** (per-seat admin, per-org) — banks, insurers, legal, govt, CSCs.
- **B2B2C** via those channels is the primary India engine.
- **Low COGS** (on-device, minimal servers) → **high gross margin**; **privacy = low breach
  liability**. Attractive economics vs cloud-heavy incumbents.

### Illustrative adoption scenarios (bottom-up, not forecasts)
| Scenario | Users | Paid mix | Institutions | ~ARR |
|---|---|---|---|---|
| Conservative | 2M | 3% @ $30/yr | 500 @ $5k | ~$4M |
| Base | 20M | 4% @ $30/yr | 5,000 @ $8k | ~$64M |
| India CSC channel alone | — | — | 50k CSCs @ $200/yr (10% of 500k) | ~$10M |

### Market risks (honest)
- **Consumer willingness-to-pay is low**, especially India → success depends on **B2B2C channels**.
- **Incumbents could copy features** — moat is the *combination* + emerging-market fit + on-device.
- **Regulatory complexity** (e-sign validity, biometric, cross-border) raises go-to-market cost.
- **Trust must be earned** — privacy claims need audits / open components to be credible.
- **Distribution is the hard part**, not the product need.

### Bottom line
Large, fast-growing market (**~$40–70B TAM by 2030; ~30–40% CAGR in e-sign; APAC fastest**), a real
**differentiated whitespace**, and a **standout India fit** (language + DPI + CSC channel + DPDP). A
close comparable (airSlate, $120M ARR) proves form-filling monetises. The binding constraints are
**execution/scope and monetisation model (B2B2C)** — not market size or user need. **Recommendation:
proceed, phase hard, and target India B2B2C + global privacy/immigration niches first.**

_Sources: MarketsandMarkets & Mordor Intelligence (e-signature); 360iResearch (PDF editor);
DataReportal / Nielsen India 2025 (users); Wikipedia/Census (languages); DocuSign FY24 filings;
airSlate/pdfFiller (Gaps/G2). Market sizes vary by methodology; ranges reflect that._
