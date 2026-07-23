# Spec: Release integrity & unsigned-build trust UX (REQ-05.1)

_Behavioral specification for how releases prove their own integrity, and how the install page sets
expectations, while the project ships without a paid code-signing certificate. Decision context:
[ADR-0020](../adr/0020-distribution-trust-without-paid-certificate.md)._

## Intent

Ship 1.0.0 GA without a purchased Authenticode certificate, without deceiving users, and without
frightening them. Two halves:

1. **Verifiable integrity** — every published artifact has a published SHA-256 that a user (or
   winget, or a mirror) can check independently. This is the integrity guarantee we *can* offer for
   free, and it is the one signing would otherwise provide.
2. **Expectation-setting UX** — the SmartScreen warning is disclosed *before* download, in calm,
   factual language, with the exact click path. An anticipated warning reads as competence; the same
   warning unannounced reads as danger.

## Scope & non-goals

- **In scope:** the release manifest generator/verifier; the published hash surface; the install
  page's channel ordering and expectation-setting copy; the copy rules that keep it honest.
- **Non-goals:** Authenticode signing itself (already built — `sign-windows.ps1`, opt-in via
  `WINDOWS_CERT_THUMBPRINT`, unchanged by this spec); macOS notarisation; the winget manifest PR
  (a release-process step, not code); any telemetry on downloads (forbidden by the invariant).

## Data contracts

`scripts/release-manifest.mjs` emits `release-manifest.json` alongside the artifacts:

```json
{
  "schema": "ppf.release-manifest/1",
  "version": "1.0.0",
  "signed": false,
  "artifacts": [
    {
      "name": "PolyglotFormFill-Setup.exe",
      "bytes": 30412288,
      "sha256": "9f2c…64 lowercase hex chars…a1"
    }
  ]
}
```

Field rules:

- `schema` — constant; bump on any breaking shape change.
- `version` — the release version string; supplied by the caller, not inferred.
- `signed` — whether these artifacts carry a **CA-chained** Authenticode signature. Under ADR-0020
  this is `false`. It MUST NOT be set true for a self-signed build.
- `artifacts[].sha256` — lowercase hex, 64 chars, over the exact published bytes.
- `artifacts` — sorted by `name` so the manifest is byte-stable for identical inputs (reproducibility;
  a diff between two builds should reflect real change, not iteration order).

## Behavior

**Manifest generation**

- GIVEN a directory of built artifacts and a version string, WHEN the generator runs, THEN it emits
  one entry per artifact with its SHA-256 and byte length, sorted by name, with `signed: false`.
- GIVEN the same inputs twice, WHEN the generator runs twice, THEN the two manifests are byte-identical.
- GIVEN a directory containing no matching artifacts, WHEN the generator runs, THEN it exits non-zero
  with a clear message rather than publishing an empty manifest (an empty manifest would silently
  advertise "nothing to verify").

**Verification**

- GIVEN a manifest and a directory whose files match it, WHEN verification runs, THEN it reports OK
  and exits zero.
- GIVEN a file whose bytes differ from the manifest, WHEN verification runs, THEN it names that file
  as MISMATCH and exits non-zero.
- GIVEN a manifest entry with no corresponding file, WHEN verification runs, THEN it names that file
  as MISSING and exits non-zero.
- Verification reports **every** problem found, not just the first — a user checking a download
  deserves the full picture in one run.

**Install-page behaviour (binding copy rules)**

- The page MUST order channels: browser extension first, then winget, then direct download last.
- A channel that is not yet live MUST be labelled as such. Presenting `winget install` as working
  before the manifest PR is accepted is a false claim of the same kind as "certified", and is
  forbidden by the rule below.
- winget manifests live in `deploy/winget/` and their `InstallerSha256` values MUST equal the ones
  in `release-manifest.json` — winget verifies downloads against them, so a stale hash breaks every
  install. Guarded by `scripts/winget-manifest.test.mjs`.
- The direct-download block MUST disclose, *above* the download button, that the build is unsigned,
  what Windows will show, and the exact click path (**More info → Run anyway**).
- The page MUST publish each artifact's SHA-256 and a copy-pasteable verification command.
- The page MUST NOT claim the download is "verified by Windows", "certified", or "safe" — none of
  which we can substantiate.
- The page MUST NOT use alarm vocabulary ("danger", "risk", "virus", "malware") or apologise. The
  register is matter-of-fact: cause, proof offered, what to click.
- The unsigned disclosure MUST NOT be removed until a CA-issued certificate is genuinely in use.

## Publishing layout (added 2026-07-23)

Installers are **not** carried in the site tarball. The tarball had grown to 86 MB because it
contained ~62 MB of installers, so every HTML-only publish re-uploaded them — about 5.5 minutes on a
2 Mbps upstream. Layout now:

- `ppf-site.tar.gz` — site content only, **15.4 MB**. Uploaded on every publish.
- `PolyglotFormFill-Setup.exe`, `polyglotformfill-extension.zip` — separate Object Storage objects,
  uploaded only with `publish-site.ps1 -WithBinaries`, and pulled into `/web/download/` by the init
  container so the public `/download/...` URLs are unchanged.
- `release-manifest.json` stays **in the tarball**: it is tiny and must track the site content it is
  displayed on.

Rules:

- The publish script MUST fail if an `.exe`/`.msi` appears inside the tarball — a leak silently
  restores the slow-publish problem.
- The init container MUST fail loudly (`curl -f`) if a binary cannot be fetched, rather than letting
  nginx serve a site whose download links 404.
- `$BINARIES` in `publish-site.ps1` and `BINARIES` in `site.yaml` MUST list the same files.
- **Only the NSIS `.exe` is published.** The MSI is still produced by `tauri build` but is no longer
  hosted (it duplicated the `.exe` for ~32 MB). Since winget validation downloads `InstallerUrl`, an
  unhosted MSI cannot be offered through winget either — hosting and the winget manifest must agree,
  which `scripts/winget-manifest.test.mjs` enforces in both directions.

## Boundaries & dependencies

- Touches: `scripts/release-manifest.mjs`, `scripts/test-all.mjs` (adds a test step),
  `docs/marketing/site/install/index.html`.
- MUST NOT change: `sign-windows.ps1` behaviour, `tauri.conf.json` bundling, the app runtime. This is
  build-and-publish tooling plus static site copy — no product code path is affected.
- **Privacy invariant:** hashing runs locally over our own build outputs. Nothing is sent anywhere;
  no download telemetry is added. Verification by the user is a local command over a local file.

## Observability

None added, deliberately — download counting would be user-facing telemetry. Integrity failures
surface as a non-zero exit from the verifier at release time, and as a visible hash mismatch for a
user who chooses to check.

## Test plan

- **Unit** (`scripts/release-manifest.test.mjs`, run by `scripts/test-all.mjs`): known-vector SHA-256;
  name sorting; determinism across two runs; empty-directory failure; verify OK / MISMATCH / MISSING;
  multiple problems reported in one pass; `signed` is false.
- **Unit** (`scripts/winget-manifest.test.mjs`): winget `PackageVersion`/`PackageIdentifier`
  consistency; `InstallerSha256` equals the published hash; both Windows installers are offered;
  HTTPS URLs on the public host. The guard was proven to fail on a deliberately corrupted hash.
- **Tooling:** `winget validate --manifest deploy/winget` (passes against the real winget CLI).
- **Integration:** generate against a real `tauri build` output directory, then verify it — covered
  by the release checklist in `docs/testing/e2e-harness.md`.
- **Acceptance:** [`features/release-integrity.feature`](../../features/release-integrity.feature).

## Open questions

- The winget manifests are written and validate cleanly, but the submission PR to
  `microsoft/winget-pkgs` cannot be opened until the installer URLs are live (winget validation
  downloads them). Automating the per-release PR is deferred until the first one is accepted.
- SignPath.io's free OSS tier would give certificate-backed signing at zero cost, but requires the
  project to be open source — a licensing decision, not a technical one. Left open.
