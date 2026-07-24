// Record ONE demo segment: drive app state via CDP, scroll the form to fill the frame, capture the window.
import { connect } from "./cdp.mjs";
import { spawn } from "node:child_process";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const OUT = process.argv[2] || "seg.mp4";
const SECS = Number(process.argv[3] || 11);

const app = await connect();
// Ensure form loaded & scrolled so the canvas top is near the top of the viewport.
await app.ev(`
  const c=document.querySelector('canvas');
  if(c){ const y=c.getBoundingClientRect().top+window.scrollY; window.scrollTo({top:Math.max(0,y-60),behavior:'instant'}); }
`);
await sleep(400);
const top = await app.eval(`(()=>{const c=document.querySelector('canvas');return c?Math.round(c.getBoundingClientRect().top):null;})()`);
console.log("canvas top in viewport after scroll:", top);

// start recording the app window region
const rec = spawn("powershell", ["-NoProfile","-ExecutionPolicy","Bypass","-File",
  "scripts/record-app-region.ps1","-Seconds",String(SECS),"-Out",OUT,"-Fps","24"], {stdio:"inherit"});
await new Promise((res)=>rec.on("exit",res));
app.close();
console.log("recorded", OUT);
