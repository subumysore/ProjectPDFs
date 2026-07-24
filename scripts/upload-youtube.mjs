#!/usr/bin/env node
// Automated YouTube publishing for the guide video. Two modes:
//
//   node scripts/upload-youtube.mjs [video.mp4]
//       Upload a NEW video (resumable). Prints the watch URL AND the youtu.be URL.
//       NOTE: YouTube does NOT let you replace the media of an existing video — a content change
//       always yields a NEW video id/URL. That is Google's rule, not ours. Use --captions (below)
//       when ONLY the captions changed, to update them on the SAME video.
//
//   node scripts/upload-youtube.mjs --captions guide.en.srt --video-id oTBaEK1-mXk
//       Replace the English captions on an EXISTING video IN PLACE — same URL, no re-upload.
//
// Options: --title "…"  --description "…"  --privacy unlisted|public|private  (default unlisted)
// Auth: run `node scripts/youtube-auth.mjs` once. Needs YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN.
import { readFileSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const has = (name) => argv.includes(name);

// Reuse the Chrome Web Store OAuth CLIENT (same Google project) if YT_* aren't set — you only need a
// fresh consent for the YouTube scope, stored as YT_REFRESH_TOKEN by scripts/youtube-auth.mjs.
const CID = process.env.YT_CLIENT_ID || process.env.WEBSTORE_CLIENT_ID;
const SEC = process.env.YT_CLIENT_SECRET || process.env.WEBSTORE_CLIENT_SECRET;
const RT = process.env.YT_REFRESH_TOKEN;
if (!CID || !SEC) { console.error("No OAuth client — set YT_CLIENT_ID/SECRET or WEBSTORE_CLIENT_ID/SECRET."); process.exit(1); }
if (!RT) { console.error("Missing YT_REFRESH_TOKEN — run `node scripts/youtube-auth.mjs` first (one-time browser consent)."); process.exit(1); }

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: CID, client_secret: SEC, refresh_token: RT, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token refresh failed: " + JSON.stringify(j));
  return j.access_token;
}

async function updateCaptions(access, videoId, srtPath) {
  // Find an existing English caption track to update; else insert a new one.
  const list = await (await fetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`,
    { headers: { Authorization: `Bearer ${access}` } })).json();
  const existing = (list.items || []).find((c) => (c.snippet.language || "").startsWith("en"));
  const srt = readFileSync(srtPath);
  const meta = { snippet: { videoId, language: "en", name: "English", isDraft: false } };
  const boundary = "ytcap" + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(existing ? { id: existing.id, snippet: meta.snippet } : meta)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    srt, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const url = existing
    ? "https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart"
    : "https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart";
  const method = existing ? "PUT" : "POST";
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${access}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  console.log(`✔ Captions ${existing ? "updated" : "inserted"} on https://youtu.be/${videoId} (same URL).`);
}

async function uploadVideo(access, file, title, description, privacy) {
  const size = statSync(file).size;
  const meta = { snippet: { title, description, categoryId: "28" }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
  // 1) start a resumable session
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  const location = start.headers.get("location");
  if (!location) throw new Error("no resumable URL: " + (await start.text()));
  // 2) PUT the bytes in chunks (256 KiB multiples) so large files stream without buffering all at once
  const CHUNK = 8 * 1024 * 1024;
  const fd = openSync(file, "r");
  let offset = 0, result = null;
  try {
    while (offset < size) {
      const end = Math.min(offset + CHUNK, size);
      const buf = Buffer.alloc(end - offset);
      readSync(fd, buf, 0, buf.length, offset);
      const r = await fetch(location, {
        method: "PUT",
        headers: { "Content-Length": String(buf.length), "Content-Range": `bytes ${offset}-${end - 1}/${size}` },
        body: buf,
      });
      if (r.status === 308) { offset = end; process.stdout.write(`\r  uploaded ${Math.round((end / size) * 100)}%`); continue; }
      if (r.ok) { result = await r.json(); offset = end; break; }
      throw new Error(`upload failed ${r.status}: ${await r.text()}`);
    }
  } finally { closeSync(fd); }
  process.stdout.write("\n");
  if (!result?.id) throw new Error("no video id returned");
  console.log(`\n✔ Uploaded (${privacy}).`);
  console.log(`  watch:   https://www.youtube.com/watch?v=${result.id}   <- paste THIS into the Chrome Web Store promo field`);
  console.log(`  short:   https://youtu.be/${result.id}`);
  console.log(`\n  Reminder: this is a NEW url (YouTube can't replace an existing video's media).`);
}

const access = await token();
if (has("--captions")) {
  const srt = resolve(opt("--captions"));
  const vid = opt("--video-id");
  if (!vid) { console.error("--captions needs --video-id <id>"); process.exit(1); }
  if (!existsSync(srt)) { console.error("captions file not found: " + srt); process.exit(1); }
  await updateCaptions(access, vid, srt);
} else {
  const file = resolve(argv.find((a) => !a.startsWith("--") && a.endsWith(".mp4")) || "docs/guide/output/video/PolyglotFormFill-guide.mp4");
  if (!existsSync(file)) { console.error("video not found: " + file + " — run `node scripts/build-guide.mjs` first."); process.exit(1); }
  const title = opt("--title", "PolyglotFormFill — read & write any form, in any language, privately");
  const desc = opt("--description", "PolyglotFormFill fills any form — PDF, Word, Excel, or web — from your encrypted on-device vault, in 26 languages. Nothing leaves your device. Free during the beta at polyglotformfill.mooo.com");
  const privacy = opt("--privacy", "unlisted");
  await uploadVideo(access, file, title, desc, privacy);
}
