# Chrome Web Store submission checklist — PolyglotFormFill

Everything needed to submit the extension. Copy is in `store-listing.md`; the privacy
page is live. Two items still need YOU (marked 🧑): a paid dev account and a real icon.

## Assets ready ✅
- **Extension package:** `apps/extension/dist/polyglotformfill-extension.zip`
  (rebuild anytime — see "Rebuild the zip" below).
- **Privacy policy URL (required):** https://polyglotformfill.surge.sh/privacy/  ✅ live, HTTPS
- **Homepage URL:** https://polyglotformfill.surge.sh/  ✅ live
- **Listing copy + ASO keywords:** `docs/marketing/store-listing.md`

## Still needed 🧑
- **🧑 Chrome Web Store developer account** — one-time **US$5** at
  https://chrome.google.com/webstore/devconsole (accept the agreement; this is identity-bound, only you can do it).
- **🧑 Real 128×128 icon** — replace the placeholder `apps/extension/icon128.png`
  (currently a 1×1 stand-in) with a proper logo, then rebuild the zip.
- **Screenshots (1280×800):** one ready at `docs/marketing/store-assets/01-vault-images-language.png` (vault + image + language + lock). More can be generated (autofill, make-fillable, translated view).
  (I can generate these from the real UI on request.)
- **Support email** for the listing.

## Rebuild the zip (after changing the icon or code)
```powershell
$ext='apps/extension'; $stage="$env:TEMP\pff-ext"; Remove-Item -Recurse -Force $stage -EA 0
New-Item -Type Directory -Force "$stage\src" | Out-Null
Copy-Item "$ext/manifest.json","$ext/popup.html","$ext/options.html","$ext/icon128.png" $stage
Copy-Item "$ext/src/vault.js","$ext/src/background.js","$ext/src/popup.js","$ext/src/options.js" "$stage\src"
New-Item -Type Directory -Force "$ext/dist" | Out-Null
Compress-Archive -Path "$stage\*" -DestinationPath "$ext/dist/polyglotformfill-extension.zip" -Force
```

## Submit (Chrome)
1. https://chrome.google.com/webstore/devconsole → pay $5, accept terms.
2. **Add new item** → upload `polyglotformfill-extension.zip`.
3. **Listing:** name, short + full description, category (Productivity), language — from `store-listing.md`.
4. **Graphics:** upload the 128 icon + screenshots.
5. **Privacy:**
   - Privacy policy URL → `https://polyglotformfill.surge.sh/privacy/`
   - **Permissions justification** (paste from below).
   - **Data usage:** declare **no data collected** (true — nothing is sent to us). Check the
     "does not sell/transfer data", "not used for unrelated purposes", "not for creditworthiness" boxes.
6. **Submit for review** (usually a few days; `nativeMessaging` may draw extra scrutiny — the justification covers it).

### Permissions justification (paste verbatim)
- **storage** — stores the user's encrypted vault locally on their device.
- **activeTab + scripting** — fills the form on the page the user is viewing, only when they click the toolbar action. No background page access.
- **nativeMessaging** — optional: communicates with the user's own PolyglotFormFill desktop app on their machine so keys/vault can stay there. No external servers.
- **No host permissions**, **no remote code** (Manifest V3), **no analytics/telemetry**. The extension does not collect or transmit user content.

## Edge / Firefox (optional, same zip)
- **Edge:** https://partner.microsoft.com/dashboard/microsoftedge — free; upload the same zip.
- **Firefox:** https://addons.mozilla.org/developers/ — free; Mozilla reviews source (a trust plus).

## Before "public" — one honest gate
Fill the privacy-policy `[…]` placeholders (entity, contact, Grievance Officer, dates) and have
**counsel review** it (the page's banner). You can submit for review meanwhile, but don't flip to
"published/public" until that's done.
