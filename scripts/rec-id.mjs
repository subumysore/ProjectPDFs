// Record the ID-import segment: fresh profile, import ID photo, OCR populates vault, save.
import { connect } from "./cdp.mjs";
import { spawn } from "node:child_process";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.argv[2];
const SECS = Number(process.argv[3] || 13);
const app = await connect();
const clickExact = (t) => app.ev(`const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); if(b)b.click(); return !!b;`);

// Pre-stage: Profile tab, create a fresh empty profile so OCR fields visibly appear.
await clickExact('2 · Profile & Vault'); await sleep(700);
const exists = await app.eval(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Sam Rivers')`);
if (!exists) { await app.setInput('input[placeholder^="New profile name"]', 'Sam Rivers'); await clickExact('Add profile'); await sleep(1200); }
await app.ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sam Rivers')?.click();`); await sleep(800);
await app.ev(`window.scrollTo({top:0,behavior:'instant'});`); await sleep(300);

// Start recording (background), then perform the import on camera.
const rec = spawn("powershell", ["-NoProfile","-ExecutionPolicy","Bypass","-File","scripts/record-app-region.ps1","-Seconds",String(SECS),"-Out",OUT,"-Fps","24"], {stdio:"inherit"});
await sleep(1800); // app comes to front + a beat on the empty profile
await app.setFile('input[accept="image/*"]', 'C:/ppfdemo/sample-id.png');   // import the ID -> OCR
await sleep(4500); // OCR runs, fields populate on screen
await app.ev(`const b=[...document.querySelectorAll('button')].find(x=>/Save \d+ to vault/.test(x.textContent)); if(b)b.click(); return !!b;`);
await sleep(2500); // saved to vault
await new Promise((res)=>rec.on("exit",res));
app.close();
console.log("recorded", OUT);
