#!/usr/bin/env node
// Reliable, repeatable demo-vault setup for the guide video — driven BY SELECTOR over CDP (no pixels,
// no file dialogs, no drift). Launch the app first with a fresh demo vault and the debug port:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'; Start-Process target/release/app.exe
// Then:  node scripts/guide-setup.mjs
// Creates John Doe with: ID import (7 fields) + nationality/email/phone/occupation/gender/marital_status
// + profile_photo + signature images. All from C:/ppfdemo (name-free). Idempotent-ish; safe to re-run
// on a fresh vault.
import { connect } from "./cdp.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = await connect();
const clickExact = (t) => app.ev(`const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); if(!b)throw new Error('no button '+${JSON.stringify(t)}); b.click(); return true;`);

// passphrase (first run) — skip if already unlocked
const locked = await app.eval(`!!document.querySelector('input[type=password]')`);
if (locked) { await app.setInput('input[type=password]', 'demo1234'); await clickExact('Set passphrase & continue'); await sleep(1200); }
await clickExact('2 · Profile & Vault'); await sleep(800);
// create John Doe if missing
const hasJohn = await app.eval(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='John Doe')`);
if (!hasJohn) { await app.setInput('input[placeholder^="New profile name"]', 'John Doe'); await clickExact('Add profile'); await sleep(1500); }
// import ID -> save to vault
await app.setFile('input[accept="image/*"]', 'C:/ppfdemo/sample-id.png'); await sleep(3500);
await app.ev(`const b=[...document.querySelectorAll('button')].find(x=>/Save \d+ to vault/.test(x.textContent)); if(b)b.click();`); await sleep(1200);
// extra fields
for (const [k, v] of [['first_name','John'],['last_name','Doe'],['full_name','John Doe'],['nationality','American'],['email_address','john.doe@example.com'],['cell_phone','+1 555 0142'],['occupation','Engineer'],['gender','Male'],['marital_status','Single']]) {
  await app.setInput('input[placeholder^="key (e.g. full_name)"]', k);
  await app.setInput('input[placeholder="value"]', v);
  await clickExact('Save'); await sleep(500);
}
// images
await app.setInput('input[placeholder^="key (e.g. profile_photo"]', 'profile_photo'); await app.setFile('input[accept="image/png,image/jpeg"]', 'C:/ppfdemo/demo-photo.png'); await sleep(900);
await app.setInput('input[placeholder^="key (e.g. profile_photo"]', 'signature'); await app.setFile('input[accept="image/png,image/jpeg"]', 'C:/ppfdemo/demo-signature.png'); await sleep(900);
console.log("setup done — vault entries:", await app.eval(`document.querySelectorAll('tr').length`));
app.close();
