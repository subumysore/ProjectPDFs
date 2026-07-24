#!/usr/bin/env node
// One-time YouTube OAuth. Opens Google consent in your browser, catches the code on a loopback
// port, exchanges it for a REFRESH TOKEN, and stores the three values with setx so every later
// `node scripts/upload-youtube.mjs` run is non-interactive.
//
//   node scripts/youtube-auth.mjs
//
// Prerequisites (one time, in Google Cloud Console — free):
//   1. Create/choose a project; enable "YouTube Data API v3".
//   2. Create an OAuth client of type "Desktop app". Note its Client ID + Client secret.
//   3. Add yourself as a Test user on the OAuth consent screen (or publish it).
//   4. Set the client into this shell before running:
//        setx YT_CLIENT_ID "….apps.googleusercontent.com"
//        setx YT_CLIENT_SECRET "…"
//      then open a NEW terminal (setx only affects new shells) and run this script.
//
// Scope: youtube.upload (upload videos) + youtube.force-ssl (manage captions). Nothing else.
import http from "node:http";
import { execFileSync } from "node:child_process";

// Reuse the Chrome Web Store OAuth client (same Google project) if a YouTube-specific one isn't set.
const CID = process.env.YT_CLIENT_ID || process.env.WEBSTORE_CLIENT_ID;
const SEC = process.env.YT_CLIENT_SECRET || process.env.WEBSTORE_CLIENT_SECRET;
if (!CID || !SEC) { console.error("Set YT_CLIENT_ID/SECRET (or reuse WEBSTORE_CLIENT_ID/SECRET) first — see header."); process.exit(1); }
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl";
let redirect = "";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const code = url.searchParams.get("code");
  if (!code) { res.writeHead(400); res.end("no code"); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<h2>YouTube authorised. You can close this tab and return to the terminal.</h2>");
  server.close();
  try {
    const body = new URLSearchParams({ code, client_id: CID, client_secret: SEC, redirect_uri: redirect, grant_type: "authorization_code" });
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
    const j = await r.json();
    if (!j.refresh_token) { console.error("No refresh token returned:", j); process.exit(1); }
    execFileSync("setx", ["YT_REFRESH_TOKEN", j.refresh_token]);
    console.log(`\n✔ Refresh token stored (length ${j.refresh_token.length}). Open a NEW terminal, then:\n  node scripts/upload-youtube.mjs`);
  } catch (e) { console.error(e); process.exit(1); }
});

server.listen(0, "127.0.0.1", () => {
  redirect = `http://127.0.0.1:${server.address().port}`;
  const auth = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: CID, redirect_uri: redirect, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent",
  });
  console.log("Opening Google consent… if it doesn't open, paste this URL:\n" + auth + "\n");
  try { execFileSync("rundll32", ["url.dll,FileProtocolHandler", auth]); } catch { /* user pastes manually */ }
});
