// Record a card page as video via CDP Page.screencast — captures ONLY the page's own pixels (never
// the desktop or other windows), so it is PII-safe on a shared machine. Assembles the frames to mp4.
// Usage: node scripts/screencast-card.mjs <cardUrl> <outMp4> <seconds>
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const PORT = process.env.CDP_PORT || 9224;
const URL = process.argv[2], OUT = process.argv[3], SECS = Number(process.argv[4] || 16);
const FF = "C:/Users/Subramanya Mysore/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";
const TMP = resolve(process.env.TEMP || ".", "ppf-cast-" + Date.now());
mkdirSync(TMP, { recursive: true });

const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("tauri")) || list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Page.screencastFrame") {
    writeFileSync(resolve(TMP, `f${String(frame++).padStart(5, "0")}.jpg`), Buffer.from(d.params.data, "base64"));
    send("Page.screencastFrameAck", { sessionId: d.params.sessionId });
  }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
let frame = 0;

await send("Page.enable");
await send("Runtime.enable");
// navigate + settle, then reload so the animation starts exactly when the screencast begins
await send("Page.navigate", { url: URL });
await new Promise((r) => setTimeout(r, 2200));
await send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await send("Runtime.evaluate", { expression: "location.reload()" });
await new Promise((r) => setTimeout(r, SECS * 1000));
await send("Page.stopScreencast");
ws.close();

const n = readdirSync(TMP).filter((f) => f.endsWith(".jpg")).length;
console.log(`captured ${n} frames -> assembling`);
// assemble at a fixed 30 fps (frames are roughly evenly spaced from the render loop)
spawnSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-framerate", "30", "-i", resolve(TMP, "f%05d.jpg"),
  "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", OUT], { stdio: "inherit" });
rmSync(TMP, { recursive: true, force: true });
console.log("wrote", OUT);
