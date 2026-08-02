// Re-record v2-02-id: drive the REAL app — import the synthetic DL front (on-device OCR → fields +
// the card image saved), a brief back-of-card beat (shown, never a fake decode), then the passport
// (OCR → fields + image saved). Page-only screencast (PII-safe). Target ~31s to cover narration.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const PORT = process.env.CDP_PORT || 9224;
const OUT = "docs/guide/output/raw/v2-02-id.mp4";
const FF = "C:/Users/Subramanya Mysore/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";
const TMP = resolve(process.env.TEMP || ".", "ppf-cast02-" + Date.now());
mkdirSync(TMP, { recursive: true });

const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let frame = 0; let casting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Page.screencastFrame") {
    if (casting) writeFileSync(resolve(TMP, `f${String(frame++).padStart(5, "0")}.jpg`), Buffer.from(d.params.data, "base64"));
    send("Page.screencastFrameAck", { sessionId: d.params.sessionId });
  }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: `(function(){ ${expr} })()`, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setFile(selector, filePath) {
  const doc = await send("DOM.getDocument", { depth: -1 });
  const node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector });
  if (node.result.nodeId) await send("DOM.setFileInputFiles", { files: [filePath], nodeId: node.result.nodeId });
}
await send("Page.enable"); await send("Runtime.enable"); await send("DOM.enable");
const clickText = (t) => ev(`const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); if(b){b.scrollIntoView({block:'center'});b.click();} return !!b;`);
const clickSave = () => ev(`const b=[...document.querySelectorAll('button')].find(x=>/^Save \\d+ to vault/.test(x.textContent.trim())); if(b){b.scrollIntoView({block:'center'});b.click();} return b?b.textContent.trim():null;`);
const waitFields = async () => { for (let i=0;i<12;i++){ const n=await ev(`return document.querySelectorAll('section li').length`); if(n>0) return n; await sleep(1000);} return 0; };

// 1) back to the APP + unlock
await send("Page.navigate", { url: "http://localhost:5173/" });
await sleep(3500);
if (await ev(`return !!document.querySelector('input[type=password]')`)) {
  await ev(`const p=document.querySelector('input[type=password]'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(p,'demo1234'); p.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(300);
  await ev(`[...document.querySelectorAll('button')].find(b=>/Unlock|continue/i.test(b.textContent))?.click();`);
  await sleep(2500);
}
// 2) Profile tab + John Doe, scroll to the import control
await clickText("2 · Profile & Vault"); await sleep(700);
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='John Doe')?.click();`); await sleep(700);
await ev(`const el=[...document.querySelectorAll('*')].find(e=>/Import a data source/.test(e.textContent||'')&&e.children.length<3); if(el)el.scrollIntoView({block:'center'});`); await sleep(500);

// 3) capture
await send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
casting = true;
await sleep(1600);

// --- DL FRONT: OCR -> fields + the card image saved ---
await setFile('input[accept="image/*"]', "C:/ppfdemo/dl-front.png");
await waitFields();
await sleep(3200);                       // let the fields + the saved-image thumbnail read
const s1 = await clickSave();
await sleep(2600);

// --- BACK-OF-CARD beat: show the back, honest (no fake decode) ---
await ev(`
  const o=document.createElement('div'); o.id='__backbeat';
  o.style.cssText='position:fixed;inset:0;z-index:99999;background:#0b1416;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vh;';
  o.innerHTML='<div style="color:#eafbf8;font:600 2vw Segoe UI,sans-serif">Back of the licence — the barcode is read on-device too</div>'+
    '<img src="http://localhost:5173/docs/dl-back.png" style="width:60vw;border-radius:1.2vh;box-shadow:0 3vh 7vh rgba(0,0,0,.5)">';
  document.body.appendChild(o);
`);
await sleep(4200);
await ev(`document.getElementById('__backbeat')?.remove();`);
await sleep(600);
await ev(`const el=[...document.querySelectorAll('*')].find(e=>/Import a data source/.test(e.textContent||'')&&e.children.length<3); if(el)el.scrollIntoView({block:'center'});`);
await sleep(700);

// --- PASSPORT: OCR -> fields + the passport image saved ---
await setFile('input[accept="image/*"]', "C:/ppfdemo/passport.png");
await waitFields();
await sleep(3200);
const s2 = await clickSave();
await sleep(2800);

casting = false;
await send("Page.stopScreencast");
ws.close();
console.log("front save:", s1, "| passport save:", s2);

const n = readdirSync(TMP).filter((f) => f.endsWith(".jpg")).length;
console.log(`captured ${n} frames -> assembling`);
spawnSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-framerate", "24", "-i", resolve(TMP, "f%05d.jpg"),
  "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", OUT], { stdio: "inherit" });
rmSync(TMP, { recursive: true, force: true });
console.log("wrote", OUT);
