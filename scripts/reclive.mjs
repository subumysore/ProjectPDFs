// Reusable LIVE app recorder. Drives the real app in the isolated WebView (CDP) and captures a
// fixed-rate screenshot stream with REAL timing (so static UIs record correctly, unlike
// Page.screencast which only emits frames on repaint). Page-pixels only → PII-safe.
//
// A scenario module (passed as argv[2]) default-exports an async fn ({ev, setFile, click, clickText,
//   clickSave, overlay, clearOverlay, sleep, waitLi}) => void, which performs the on-screen actions.
// Output mp4 -> argv[3]. Uses process.hrtime for per-frame durations (accurate real-time playback).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = process.env.CDP_PORT || 9224;
const SCEN = process.argv[2], OUT = process.argv[3];
const FF = "C:/Users/Subramanya Mysore/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";
const TMP = resolve(process.env.TEMP || ".", "ppf-live-" + process.pid);
mkdirSync(TMP, { recursive: true });

const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Network.enable"); await send("Network.clearBrowserCache"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.enable"); await send("Runtime.enable"); await send("DOM.enable");
// Render at a true 16:9 viewport so the assembler never crops the top/bottom edges, at 1.5x for
// crisp screenshots (1600x900 -> 2400x1350 -> scaled to 1920x1080).
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1.5, mobile: false });

const ev = async (expr) => (await send("Runtime.evaluate", { expression: `(async function(){ ${expr} })()`, returnByValue: true, awaitPromise: true })).result?.result?.value;
async function setFile(selector, filePath) {
  const doc = await send("DOM.getDocument", { depth: -1 });
  const node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector });
  if (!node.result.nodeId) throw new Error("no input for " + selector);
  await send("DOM.setFileInputFiles", { files: [filePath], nodeId: node.result.nodeId });
}
// --- visible cursor + highlight ring (so the viewer sees where attention is) ---
const ensureCursor = () => ev(`
  if(!document.getElementById('__cur')){
    const c=document.createElement('div'); c.id='__cur';
    c.style.cssText='position:fixed;left:50%;top:60%;z-index:100000;width:22px;height:22px;pointer-events:none;transition:left .55s cubic-bezier(.4,0,.2,1),top .55s cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))';
    c.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#111" stroke="#fff" stroke-width="1.3" d="M4 2l16 8-7 2-2 7z"/></svg>';
    const r=document.createElement('div'); r.id='__ring';
    r.style.cssText='position:fixed;z-index:99998;width:0;height:0;border-radius:50%;pointer-events:none;box-shadow:0 0 0 0 rgba(63,224,197,.55);transition:box-shadow .01s';
    document.body.appendChild(c); document.body.appendChild(r);
  } return true;`);
// move cursor to an element's centre and pulse a ring there
const point = (sel, matchText) => ev(`
  await ensureVis&&0;
  let el; ${matchText ? `el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim()===${JSON.stringify(matchText)});` : `el=document.querySelector(${JSON.stringify(sel)});`}
  if(!el) return false;
  el.scrollIntoView({block:'center'});
  await new Promise(r=>setTimeout(r,260));
  const b=el.getBoundingClientRect(); const x=b.left+b.width/2, y=b.top+b.height/2;
  const c=document.getElementById('__cur'), ring=document.getElementById('__ring');
  if(c){c.style.left=(x-4)+'px'; c.style.top=(y-2)+'px';}
  if(ring){ring.style.transition='none';ring.style.width=ring.style.height='0px';ring.style.left=x+'px';ring.style.top=y+'px';ring.style.boxShadow='0 0 0 0 rgba(63,224,197,.6)';
    ring.getBoundingClientRect(); ring.style.transition='box-shadow .5s ease-out'; ring.style.boxShadow='0 0 0 26px rgba(63,224,197,0)';}
  return {x,y};`.replace('await ensureVis&&0;',''));
const clickText = async (t) => { await ensureCursor(); await point('button', t); await sleep(500); return ev(`const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); if(b){b.click();} return !!b;`); };
const clickSel = async (s) => { await ensureCursor(); await point(s); await sleep(500); return ev(`const b=document.querySelector(${JSON.stringify(s)}); if(b){b.click();} return !!b;`); };
const clickSave = () => ev(`const b=[...document.querySelectorAll('button')].find(x=>/^Save \\d+ to vault/.test(x.textContent.trim())); if(b){b.scrollIntoView({block:'center'});b.click();} return b?b.textContent.trim():null;`);
const overlay = (html) => ev(`let o=document.getElementById('__ov'); if(!o){o=document.createElement('div');o.id='__ov';o.style.cssText='position:fixed;inset:0;z-index:99999;background:#0b1416;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.4vh;font-family:Segoe UI,sans-serif';document.body.appendChild(o);} o.innerHTML=${JSON.stringify(html)}; return true;`);
const clearOverlay = () => ev(`document.getElementById('__ov')?.remove(); return true;`);
// SPOTLIGHT: dim the whole page except a bright "hole" over the target element — draws the eye to the
// form/image being discussed AND removes the stark blank-white margins the viewer sees on a wide frame.
const spotlight = (sel, pad = 14, pick = "last") => ev(`
  const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${JSON.stringify(pick)}==="last"?els[els.length-1]:els[0]; if(!el) return false;
  el.scrollIntoView({block:'center'});
  await new Promise(r=>setTimeout(r,280));
  const b=el.getBoundingClientRect();
  let s=document.getElementById('__spot');
  if(!s){ s=document.createElement('div'); s.id='__spot';
    s.style.cssText='position:fixed;z-index:99990;border-radius:10px;pointer-events:none;transition:all .45s cubic-bezier(.4,0,.2,1);box-shadow:0 0 0 9999px rgba(9,20,22,.58), 0 0 24px 4px rgba(63,224,197,.5);outline:2px solid rgba(63,224,197,.9);';
    document.body.appendChild(s); }
  s.style.left=(b.left-${pad})+'px'; s.style.top=(b.top-${pad})+'px';
  s.style.width=(b.width+${pad}*2)+'px'; s.style.height=(b.height+${pad}*2)+'px';
  return {x:b.left+b.width/2,y:b.top+b.height/2};`);
const clearSpotlight = () => ev(`document.getElementById('__spot')?.remove(); return true;`);
// Zoom the whole app UI so a narrow section fills more of the wide frame (kills blank space).
const zoom = (z = 1) => ev(`document.body.style.zoom=${z}; return true;`);
const waitLi = async (min = 1, tries = 14) => { for (let i = 0; i < tries; i++) { const n = await ev(`return document.querySelectorAll('section li').length`); if (n >= min) return n; await sleep(900); } return 0; };
const type = async (sel, val) => ev(`const el=document.querySelector(${JSON.stringify(sel)}); if(el){const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set||Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; s.call(el,${JSON.stringify(val)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));} return !!el;`);

// standard entry: get past language chooser + unlock, into the app
async function enter() {
  await send("Page.navigate", { url: "http://localhost:5173/" });
  await sleep(4500);
  // language chooser (first run)
  if (await ev(`return /Choose your language/.test(document.body.innerText)`)) {
    await ev(`[...document.querySelectorAll('button')].find(b=>/^English$/.test(b.textContent.trim()))?.click();`);
    await sleep(1500);
  }
  // unlock
  if (await ev(`return !!document.querySelector('input[type=password]')`)) {
    await type('input[type=password]', 'demo1234');
    await sleep(300);
    await ev(`[...document.querySelectorAll('button')].find(b=>/Unlock|continue|Open/i.test(b.textContent))?.click();`);
    await sleep(2600);
  }
  // Fill the frame: widen the narrow content so a wide 16:9 capture has no big white gutter, and
  // center the main column. Injected as a recording aid only (not shipped).
  await ev(`
    let s=document.getElementById('__fit'); if(!s){s=document.createElement('style');s.id='__fit';document.head.appendChild(s);}
    s.textContent='table{max-width:100%!important;width:100%!important} '+
      'body>div,main{margin-left:auto!important;margin-right:auto!important}';
    return true;`);
}

// ---- fixed-rate capture loop with real timing ----
let capturing = false; const frames = [];
async function captureLoop() {
  while (capturing) {
    const t = process.hrtime.bigint();
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    if (shot.result?.data) {
      const f = `f${String(frames.length).padStart(5, "0")}.jpg`;
      writeFileSync(resolve(TMP, f), Buffer.from(shot.result.data, "base64"));
      frames.push({ f, t });
    }
  }
}

const scenario = (await import(pathToFileURL(resolve(SCEN)).href)).default;
await enter();
await ensureCursor();
capturing = true;
const loop = captureLoop();
await scenario({ ev, setFile, clickText, clickSel, clickSave, overlay, clearOverlay, sleep, waitLi, type, point, ensureCursor, spotlight, clearSpotlight, zoom });
capturing = false;
await loop;
ws.close();

// build an ffconcat with real per-frame durations for accurate real-time playback
let concat = "ffconcat version 1.0\n";
for (let i = 0; i < frames.length; i++) {
  const durNs = i < frames.length - 1 ? Number(frames[i + 1].t - frames[i].t) : 120e6;
  concat += `file '${frames[i].f}'\nduration ${(durNs / 1e9).toFixed(3)}\n`;
}
concat += `file '${frames[frames.length - 1].f}'\n`;
writeFileSync(resolve(TMP, "list.ffconcat"), concat);
console.log(`captured ${frames.length} frames -> assembling ${OUT}`);
spawnSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-i", resolve(TMP, "list.ffconcat"),
  "-vsync", "vfr", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1,fps=24",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", OUT], { stdio: "inherit" });
rmSync(TMP, { recursive: true, force: true });
console.log("wrote", OUT);
