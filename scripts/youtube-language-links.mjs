// Append the "watch in your language" block to all 9 guide-video descriptions via the YouTube Data API
// (videos.update, part=snippet). IDEMPOTENT: skips a video whose description already has the block, so
// re-running is safe. Preserves title/categoryId/tags/language. Auth reuses the upload OAuth
// (YT_REFRESH_TOKEN + YT_/WEBSTORE_ client), whose youtube.force-ssl scope permits editing descriptions.
const CID = process.env.YT_CLIENT_ID || process.env.WEBSTORE_CLIENT_ID;
const SEC = process.env.YT_CLIENT_SECRET || process.env.WEBSTORE_CLIENT_SECRET;
const RT = process.env.YT_REFRESH_TOKEN;
if (!CID || !SEC || !RT) { console.error("Missing OAuth (need YT_REFRESH_TOKEN + YT_/WEBSTORE_ client id/secret)."); process.exit(1); }

const VIDEOS = { en: "r3vfEl3P6v4", hi: "awPPwI_WPzI", ta: "FRXkZQ2h7OY", te: "ndoAX4iudeo", kn: "3ivEQVoLCmw", es: "eCQCcVGFVbc", zh: "BFfGnfslEpU", ko: "-EIRtNRzYew", ja: "pmu-zIh-LCg" };
const NAMES = { en: "English", hi: "हिन्दी (Hindi)", ta: "தமிழ் (Tamil)", te: "తెలుగు (Telugu)", kn: "ಕನ್ನಡ (Kannada)", es: "Español (Spanish)", zh: "中文 (Chinese)", ko: "한국어 (Korean)", ja: "日本語 (Japanese)" };
const MARKER = "Watch this guide in your language:";
const BLOCK = "\n\n🌐 " + MARKER + "\n" + Object.keys(VIDEOS).map((k) => `• ${NAMES[k]} — https://www.youtube.com/watch?v=${VIDEOS[k]}`).join("\n");

const tokResp = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: CID, client_secret: SEC, refresh_token: RT, grant_type: "refresh_token" }) })).json();
if (!tokResp.access_token) { console.error("Token refresh failed:", JSON.stringify(tokResp).slice(0, 200), "\n-> re-auth with: node scripts/youtube-auth.mjs"); process.exit(1); }
const access = tokResp.access_token;
const H = { Authorization: `Bearer ${access}` };

let updated = 0, skipped = 0, failed = 0;
for (const [lang, id] of Object.entries(VIDEOS)) {
  const g = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}`, { headers: H })).json();
  const item = g.items && g.items[0];
  if (!item) { console.log(`${lang} ${id}: NOT FOUND or no access — ${JSON.stringify(g.error?.message || g).slice(0, 80)}`); failed++; continue; }
  const sn = item.snippet;
  if ((sn.description || "").includes(MARKER)) { console.log(`${lang} ${id}: already has the block — skip`); skipped++; continue; }
  const body = { id, snippet: { title: sn.title, categoryId: sn.categoryId, description: (sn.description || "") + BLOCK, ...(sn.tags ? { tags: sn.tags } : {}), ...(sn.defaultLanguage ? { defaultLanguage: sn.defaultLanguage } : {}), ...(sn.defaultAudioLanguage ? { defaultAudioLanguage: sn.defaultAudioLanguage } : {}) } };
  const u = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", { method: "PUT", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ur = await u.json();
  if (u.ok) { console.log(`${lang} ${id}: UPDATED ✓  "${sn.title.slice(0, 40)}"`); updated++; }
  else { console.log(`${lang} ${id}: FAIL — ${ur.error?.message || u.status}`); failed++; }
}
console.log(`\nDone: ${updated} updated, ${skipped} already-had-it, ${failed} failed.`);
