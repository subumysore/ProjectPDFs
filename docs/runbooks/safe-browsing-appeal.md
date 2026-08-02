# Runbook — clearing the Chrome "Virus detected" (Google Safe Browsing) verdict

**Status:** the installer is CLEAN. The verdict is a Google Safe Browsing false positive driven by a
brand-new domain + newly-signed installer (zero download reputation). This runbook is the professional,
reproducible process to clear it and keep it clear.

## Action log
- **2026-08-02** — Domain `polyglotformfill.com` verified in Google Search Console (DNS/domain
  property). Security Issues panel: **No issues detected** (confirms it is per-download reputation, not
  a site-level flag).
- **2026-08-02** — False-positive report **submitted successfully** to Google Safe Browsing
  (report_error, "This page is safe") for
  `https://polyglotformfill.com/download/PolyglotFormFill-Setup.exe` with the justification below.
- **TODO** — upload the .exe to VirusTotal + Microsoft WDSI; paste the report URLs here.
- **Re-check cadence:** verify the download in a clean Chrome profile ~weekly; expect the warning to age
  out within days-to-2-weeks as the signed cert accrues download history. If it persists past 2 weeks,
  re-submit report_error and add the VirusTotal link.

## Evidence the file is safe (attach/quote in every appeal)
- **Authenticode signature: Valid.** Signer `CN=Subramanya Mysore, O=Subramanya Mysore, L=Wake Forest,
  S=nc, C=US`; issuer `CN=Microsoft ID Verified CS EOC CA 03` (Azure Trusted Signing, a Microsoft-trusted
  CA). A tampered/infected binary would fail this check.
- **Windows Defender full scan: no threats** (MpCmdRun `-Scan -ScanType 3`, exit code 0).
- **SHA-256:** `82F98D8AFA4CBEABEF8C27F3C682B53309A7718ECF9D05B868065D1AC4D14D7C`
- **Distribution:** HTTPS only, from `https://polyglotformfill.com/download/PolyglotFormFill-Setup.exe`.
- **Nature of app:** on-device form-filler (Tauri/WebView2). No network exfiltration; privacy-first.
  (Tauri/NSIS/WebView2 installers are a well-known Safe Browsing false-positive class.)

## The fix (do in order)
### 1. Search Console verification (already pre-staged in the repo)
`docs/marketing/well-known/` is copied to the site root on every build. Drop Google's
`googleXXXX.html` verification file there, publish, and click **Verify** in Search Console. See
`docs/marketing/well-known/README.md`. Domain: `polyglotformfill.com`.

### 2. Request Review (Search Console → Security Issues)
Once verified, if a Safe Browsing issue is listed under **Security & Manual Actions → Security Issues**,
click **Request Review** and paste the justification below.

### 3. Direct false-positive report (parallel channel, no login required)
Submit the download URL + SHA-256 at Google's incorrect-warning report form:
`https://safebrowsing.google.com/safebrowsing/report_error/`

### 4. Build reputation (evidence links that speed reviews)
- Submit the .exe to VirusTotal (`https://www.virustotal.com/gui/home/upload`) → keep the report URL.
- Submit to Microsoft (`https://www.microsoft.com/wdsi/filesubmission`) as a developer, "should not be
  flagged" — reinforces cross-vendor whitelisting.

## Pre-written justification (paste verbatim)
> PolyglotFormFill-Setup.exe is a legitimate, code-signed desktop application (on-device PDF/web form
> filler, built with Tauri/WebView2). It is Authenticode-signed by a Microsoft-trusted CA (Azure Trusted
> Signing; verified publisher: Subramanya Mysore) and passes a full Windows Defender scan with no threats.
> It is distributed only over HTTPS from our official domain https://polyglotformfill.com. SHA-256:
> 82F98D8AFA4CBEABEF8C27F3C682B53309A7718ECF9D05B868065D1AC4D14D7C. The "malware" verdict is a false
> positive stemming from the new domain and newly-signed binary having no download history. Please review
> and remove the warning.

## Keeping it clear (standing)
- Never rename the installer object — a stable URL/hash accrues reputation; churn resets it.
- Re-sign every release with the same cert; keep publishing from the same domain.
- After each new release build, if a verdict reappears, repeat steps 2-3 (verification persists).
