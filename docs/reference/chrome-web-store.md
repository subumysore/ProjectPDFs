# Publishing the extension to the Chrome Web Store

Every deploy that rebuilds the extension also submits it to the store — `deploy/publish-extension.ps1`
calls `deploy/publish-webstore.ps1` as its third step. Until the four credentials below exist, that
step prints what is missing and exits 0, so a publish never fails on a machine without them (same
posture as the Windows code-signing hook, ADR-0020).

## What it does not do, and why

- **It cannot create a store item.** The API only updates an item that already exists. Ours does, so
  this is already behind us — but it is why the item ID has to be read from the console once.
- **It cannot make a release go live.** Uploads enter **review**. "Updated on every deploy" means
  *submitted* on every deploy; publication takes hours to a few days and is Google's decision.
- **It cannot reuse a version.** The store rejects a package whose version equals the published one.
  1.0.0 is the baseline; every release after it bumps — use `node scripts/set-version.mjs patch`,
  which moves all five version sites together (see `docs/reference/releasing.md`).

## One-time setup

### 1. Developer account

Already registered — the item is live. (For the record: registration is a one-time US$5 fee, and it
is the only paid item in the whole pipeline.)

### 2. The item already exists

The store item is live, so this step is done. What you need from it is the **item ID**: open
<https://chrome.google.com/webstore/devconsole>, click the item, and copy the 32-character id from
the URL (`.../devconsole/detail/<ITEM_ID>`).

**It cannot be computed from our manifest.** `apps/extension/manifest.json` pins a `key`, but that
is the *local dev* key which fixes the unpacked extension ID during development. The published item
has its own Google-assigned key, which is why `build-extension-zip.ps1` strips `key` from the
package — uploading a package whose key differs from the item is rejected outright.

<details><summary>Creating an item from scratch (for reference)</summary>

Build the package and upload it manually:

```powershell
.\deploy\publish-extension.ps1 -NoPublish   # writes docs/marketing/site/download/polyglotformfill-extension.zip
```

Developer console → **Add new item** → upload that zip → fill in the listing (description,
screenshots, category, privacy declarations) → save. The **item ID** is the 32-character string in
the console URL: `.../devconsole/detail/<ITEM_ID>`.

The store keeps the item ID stable across uploads, so an installed copy keeps its vault when it updates.

</details>

### 3. OAuth client + refresh token

The API authenticates as *you*, with a refresh token, not with an API key.

1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Create an OAuth client of type **Desktop app**. Note the client ID and secret.
3. Get a refresh token: open the consent URL below in a browser, approve, copy the `code`, then
   exchange it.

```
https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=<CLIENT_ID>&redirect_uri=urn:ietf:wg:oauth:2.0:oob&access_type=offline
```

```powershell
$body = @{ client_id="<CLIENT_ID>"; client_secret="<CLIENT_SECRET>"; code="<CODE>";
           grant_type="authorization_code"; redirect_uri="urn:ietf:wg:oauth:2.0:oob" }
(Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body $body).refresh_token
```

### 4. Set the environment variables

These are **secrets**. Set them for your user account; never commit them, and never paste them into
a file in this repository.

```powershell
setx WEBSTORE_ITEM_ID        "<32-char item id>"
setx WEBSTORE_CLIENT_ID      "<client id>"
setx WEBSTORE_CLIENT_SECRET  "<client secret>"
setx WEBSTORE_REFRESH_TOKEN  "<refresh token>"
```

Open a new terminal afterwards — `setx` only affects new processes.

## Everyday use

```powershell
.\deploy\publish-webstore.ps1 -DryRun      # show what would be sent; contacts nobody
.\deploy\publish-webstore.ps1 -DraftOnly   # upload, leave as a draft, do not submit
.\deploy\publish-webstore.ps1              # upload and submit for review
.\deploy\publish-webstore.ps1 -BumpPatch   # bump manifest 1.0.0 -> 1.0.1, then rebuild and rerun
```

A normal release needs no separate command — `publish-extension.ps1` runs it.

### Resubmitting

`-BumpPatch` edits `apps/extension/manifest.json` and stops, because the **zip must be rebuilt** to
contain the new manifest:

```powershell
.\deploy\publish-webstore.ps1 -BumpPatch
.\deploy\publish-extension.ps1 -NoPublish
.\deploy\publish-webstore.ps1
```

Bumping the extension makes its version differ from the desktop app's. That is fine — they are
separate artifacts on separate review cycles — but the install page shows both, so keep them in step
when it matters.

## Privacy

The upload sends **our own build artifact** to Google: the identical public zip served from the
download page. No user content, vault data, or identifier is involved. The store listing's privacy
declarations should say what the product actually does — everything on-device, the only egress being
the user submitting their own form and the opt-in DuckDuckGo form search (ADR-0013).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Skipping the Chrome Web Store step` | One of the four variables is unset; the script names which. |
| Upload rejected mentioning *version* | The version is already published. Use `-BumpPatch`, rebuild, resubmit. |
| `Could not obtain an access token` | The refresh token was revoked, or the client id/secret do not match it. Redo step 3. |
| `ITEM_NOT_FOUND` | Wrong item ID, or the account does not own that item. |
| Submitted but never appears | Check the developer console — a review can be rejected, and Google emails the reason. |
