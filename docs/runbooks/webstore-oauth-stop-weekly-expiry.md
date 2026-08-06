# Runbook — stop the weekly Chrome Web Store publish-token expiry

**Problem this fixes:** every ~7 days `deploy/publish-webstore.ps1 -Check` fails with *"the refresh token
was rejected"* and you have to re-run `node scripts/webstore-auth.mjs …` and log in again. That is **not**
about your app or your users — it is a setting on the Google Cloud OAuth client that our publish tool uses.

**Why it happens:** the OAuth consent screen is in **Testing** mode. Google expires refresh tokens for
Testing-mode apps after 7 days. Moving it to **In production** makes the refresh token long-lived, so the
publish tool keeps working without re-auth. This is a **one-time ~1-minute change** and has **zero effect on
what users receive** (that's the Oracle/OKE site + the Web Store listing, which are separate).

## Your specifics
- **Google Cloud project number:** `883212668664`
- **OAuth client:** `883212668664-jcqraerplhsh9nua2bf83murdcsf5asc.apps.googleusercontent.com`
- **User type:** must be **External** (a personal @gmail account can't use "Internal" — that needs Google
  Workspace). External + Published is the correct, supported setup for a single-owner publishing tool.

## Steps (do this once, signed in as subumysore@gmail.com)

1. Open the OAuth screen for THIS project directly (newer "Google Auth Platform" UI):
   **https://console.cloud.google.com/auth/audience?project=883212668664**
   - If that redirects/looks different, use the classic path:
     **https://console.cloud.google.com/apis/credentials/consent?project=883212668664**
   - Make sure the project selector at the top reads project **883212668664** (name may be your PPF project).

2. Find **Publishing status: Testing**.

3. Click **PUBLISH APP** (newer UI) / **PUBLISH APP → Confirm** (classic). Status becomes **In production**.

4. You may see a note that the app is **unverified** and/or an offer to "Prepare for verification."
   **You do NOT need verification.** For an app whose only user is you, unverified + In production is fine:
   - Tokens stop expiring (the whole point).
   - The only side effect is a one-time "Google hasn't verified this app" screen the next time you auth —
     click **Advanced → Go to PolyglotFormFill (unsafe)** to proceed. That's expected for a personal tool.
   - Do NOT click "Back to testing."

5. (Optional, recommended) Re-mint a fresh token now so it's a production-issued (long-lived) one:
   ```
   node scripts/webstore-auth.mjs <WEBSTORE_CLIENT_ID> <WEBSTORE_CLIENT_SECRET>
   ```
   Then verify: `deploy/publish-webstore.ps1 -Check` → "Access token: OK … reachable".

## What this does NOT change
- Users still get updates the same way (site auto-updater + Web Store review).
- No new Google review of your *app*; this is the *credential tool's* consent screen only.
- The Chrome Web Store item review (after each version submit) is unrelated and still happens.

## If a scope-verification wall appears anyway
The scope in use is `https://www.googleapis.com/auth/chromewebstore` (publishing). If Google insists on
verification to publish to production, the unverified path in step 4 still issues working long-lived tokens
for the owner account (100-user cap, irrelevant here). Only pursue full verification if you ever hit a hard
block — you won't for single-owner publishing.
