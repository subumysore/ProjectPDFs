# ADR-0013: Web search to locate forms — a user-directed egress exception

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** PolyglotFormFill team (explicit user authorization on 2026-07-18)
- **Related:** REQ-06.1 (search bar), REQ-11.1 (find forms wherever they live); privacy invariant in
  CLAUDE.md; complements ADR-0011/0012 (Office), the `download_form` URL path.

## Context
Users want to **find** a form by name ("India passport renewal form"), not only paste a known URL.
Doing so requires sending the **search query** to a search provider — i.e. user *intent* leaves the
device. The privacy invariant says the **only** permitted user-data egress is "Submit online". A web
search is a genuinely new egress, so it needs an explicit, documented decision. The user **explicitly
authorized** adding it.

## Options considered
1. **On-device catalog search only.** No egress, but limited to forms we've catalogued — doesn't help
   find arbitrary public forms.
2. **Web search via a privacy-respecting engine (chosen).** Query goes device → **DuckDuckGo**
   directly (no user tracking, no result personalization), never proxied by our servers. Results are
   (title, URL); the chosen URL is downloaded + filled **on-device** via the existing SSRF-guarded
   `download_form`. Clearly labelled as leaving the device; opt-in (user types a query and presses
   Search); no query is logged or retained by us.
3. **Full search API with an account/key (Google/Bing).** More results, but ties us to a tracking
   provider and key management; heavier privacy footprint. Rejected.
4. **Proxy search through our servers.** Rejected — would put us in the path of user intent, exactly
   what the invariant forbids.

## Decision
Adopt **Option 2**. Web search is a **second user-directed egress exception**, in the same category as
"Submit online": user-initiated, explicitly labelled ("your search terms leave the device to
DuckDuckGo"), device → provider **directly** (via `core-fetch::web_search`, never our servers), and
carrying **only the query the user typed** — never form content, vault data, or identifiers. Result
URLs pass the existing SSRF guard before download. The invariant text is updated to name this second
exception. It remains **off by default in spirit**: the user must type a query; pasting a URL or using
on-device catalog search needs no egress.

## Consequences
- **Positive:** users can locate arbitrary public forms; found forms flow into the on-device
  download→fill pipeline; DuckDuckGo choice avoids tracking/personalization.
- **Negative / cost:** the query (user intent) leaves the device — a real, if minimal, disclosure; UI
  must keep the warning prominent. HTML scraping of DDG is **format-fragile** (parser unit-tested and
  validated against live HTML, but may need maintenance).
- **Follow-ups:** consider an in-app setting to disable web search entirely for high-assurance
  deployments; monitor DDG HTML format; never add query logging/telemetry.

> ADRs are immutable once Accepted. To change a decision, write a new ADR that supersedes this one.
