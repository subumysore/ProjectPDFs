// Screenshot a fixed-size doc page to PNG via CDP (page pixels only, PII-safe).
// Usage: node scripts/_shotdoc.mjs <url> <outPng> <w> <h>
import { writeFileSync } from "node:fs";
const PORT = process.env.CDP_PORT || 9224;
const [, , URL, OUT, W, H, WAIT] = process.argv;
const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: URL });
await new Promise((r) => setTimeout(r, WAIT ? +WAIT : 1500));
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: +W, height: +H, scale: 2 } });
writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
await send("Emulation.clearDeviceMetricsOverride");
ws.close();
console.log("wrote", OUT);
