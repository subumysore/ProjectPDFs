# Releasing

**1.0.0 is the baseline.** It is what the website serves today and what the Chrome Web Store item is
being brought up to. Every release after it moves the number — the store refuses an upload that
reuses a published version, and a download page that serves a "new" build with an old version number
is indistinguishable from a failed deploy.

## The version lives in five files

`package.json`, `apps/app/package.json`, `apps/extension/manifest.json`,
`apps/app/src-tauri/tauri.conf.json`, `apps/app/src-tauri/Cargo.toml`.

Never edit them by hand — they have drifted before, and the failure is quiet (the installers on the
download page reported ProductVersion 0.1.0 for a while because a bump touched the version files but
the binaries were never rebuilt).

```powershell
node scripts/set-version.mjs --check    # what is set now; non-zero exit if they disagree
node scripts/set-version.mjs patch      # 1.0.0 -> 1.0.1
node scripts/set-version.mjs minor      # 1.0.0 -> 1.1.0
node scripts/set-version.mjs 1.2.3      # exact
```

`scripts/store-package.test.mjs` fails the build if the five ever disagree.

## Which bump

| Change | Bump |
|---|---|
| A fix, a new language, a new script/font | **patch** |
| A new capability a user would notice (a new tab, a new fill mode) | **minor** |
| A change that breaks an existing vault, or drops a platform | **major** |

## The order that works

Getting this wrong is how a release ships mismatched hashes or an unbuildable version.

```powershell
node scripts/set-version.mjs patch

cd apps\app; pnpm exec tauri build; cd ..\..          # 1. desktop installer
.\deploy\publish-extension.ps1 -NoPublish              # 2. extension zip (dev key stripped)

copy target\release\bundle\nsis\PolyglotFormFill_<ver>_x64-setup.exe `
     docs\marketing\site\download\PolyglotFormFill-Setup.exe        # 3. stage the installer

node scripts/release-manifest.mjs generate `
     --dir docs/marketing/site/download --version <ver>             # 4. hashes

# 5. sync deploy/winget InstallerSha256 to the new hash
node scripts/test-all.mjs                                           # 6. everything green

.\deploy\k8s\publish-site.ps1 -WithBinaries                         # 7. publish site + binaries
.\deploy\publish-webstore.ps1                                       # 8. submit to the store
```

Steps 7 and 8 both run from `deploy\publish-extension.ps1` when you use it without `-NoPublish`.

## After publishing — verify as a user, not as the builder

The only check that counts is downloading what the public downloads:

```powershell
# hashes must match the manifest the site serves
Invoke-WebRequest https://polyglotformfill.mooo.com/download/release-manifest.json -OutFile m.json
Invoke-WebRequest https://polyglotformfill.mooo.com/download/PolyglotFormFill-Setup.exe -OutFile s.exe
(Get-FileHash s.exe -Algorithm SHA256).Hash
```

Then install that file and open the app. Every time this has been skipped, something was wrong that
the local build did not show — stale binaries, a truncated download, an untranslated screen.

## Notes

- Releases ship **unsigned** by design (ADR-0020). `signed: false` in the manifest is expected.
- The Chrome Web Store submission enters **review**; it is submitted on deploy, not live on deploy.
- The desktop and the extension can legitimately sit on different versions for a while, since the
  store review lags the website. The install page shows both.
