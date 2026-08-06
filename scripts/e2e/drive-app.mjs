// E2E-2: drive the REAL desktop app over CDP: ensure unlocked -> Forms tab -> LOAD A FORM via the picker
// (new bytes => fresh scanFilledPages) -> assert auto-fill + amber highlight + scroll-to-data +
// "Your data on: <pages>" indicator. Works from a cold OR warm (session-restored) app.
//   CDP_PORT=9222 node scripts/e2e/drive-app.mjs "<abs path to a form.pdf>"
import { connect } from "../cdp.mjs";
const FORM = process.argv[2];
const PASS = process.env.PPF_PASS || "omganesha";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const A = (name, cond, detail = "") => { R.push({ name, ok: !!cond }); console.log((cond ? "PASS \u2705 " : "FAIL \u274c ") + name + (detail ? "  \u2014 " + detail : "")); };
const app = await connect();

// 0. Wait for React mount (lock screen OR already-warm app).
for (let i = 0; i < 40; i++) {
  const st = await app.ev(`const b=document.body.innerText||''; return JSON.stringify({pass:!!document.querySelector('input[type=password]'), warm:b.indexOf('Forms to fill')>=0});`);
  const { pass, warm } = JSON.parse(st);
  if (pass || warm) { A("app mounted", true, pass ? "lock screen" : "warm (session restored)"); break; }
  await sleep(750);
}
// 1. Unlock if locked.
if (await app.ev(`return !!document.querySelector('input[type=password]');`)) {
  await app.ev(`
    const el=document.querySelector('input[type=password]');
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(el, ${JSON.stringify(PASS)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    const f=el.closest('form'); if(f){ f.requestSubmit?f.requestSubmit():f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); }
    return true;`);
  await sleep(3500);
}
A("unlocked", !(await app.ev(`return !!document.querySelector('input[type=password]');`)));
// 2. Forms tab.
await app.ev(`const t=[...document.querySelectorAll('button,[role=tab]')].find(e=>(e.textContent||'').indexOf('Forms to fill')>=0); if(t)t.click(); return !!t;`);
await sleep(700);
// 3. Reveal the file picker if a form is already loaded (button "Choose a different form").
await app.ev(`const t=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').indexOf('Choose a different form')>=0); if(t)t.click(); return !!t;`);
await sleep(500);
const hasInput = await app.ev(`return !!document.querySelector('input[type=file]');`);
A("form file-input available", hasInput);
// 4. Load the form => fresh bytes => triggers scanFilledPages + auto-scroll.
await app.setFile("input[type=file]", FORM);
// 5. Wait for the fill banner.
let banner = "";
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  banner = await app.ev(`const b=document.body.innerText||""; const i=b.indexOf("Filled "); return i>=0 ? b.slice(i, i+55).split(String.fromCharCode(10))[0] : "";`);
  if (banner) break;
}
await sleep(1500); // let the scan + scroll settle
// 6. Assert rendered result.
const s = JSON.parse(await app.ev(`
  const b=document.body.innerText||"";
  const idx=b.indexOf("Your data on:");
  const scroller=document.querySelector('div[style*="overflow: auto"]');
  const amber=[...document.querySelectorAll('input')].filter(el=>getComputedStyle(el).backgroundColor.indexOf('255, 236, 179')>=0);
  let pageBtns=0; if(idx>=0){ const span=[...document.querySelectorAll('span')].find(s=>(s.textContent||'').indexOf('Your data on:')>=0); if(span) pageBtns=span.querySelectorAll('button').length; }
  return JSON.stringify({ indicator: idx>=0, pageBtns, scrollTop: scroller?Math.round(scroller.scrollTop):-1, amberCount: amber.length, amberSample: amber.slice(0,4).map(el=>el.value.slice(0,22)) });
`));
console.log("  banner:", banner);
console.log("  state :", JSON.stringify(s));
A("auto-fill ran (banner)", /Filled \d+ of \d+/.test(banner), banner);
A("filled fields highlighted amber", s.amberCount > 0, s.amberCount + " inputs; e.g. " + (s.amberSample[0]||""));
A('"Your data on:" indicator rendered', s.indicator, s.pageBtns + " page buttons");
A("indicator lists multiple pages", s.pageBtns >= 2, s.pageBtns + " pages");
A("auto-scrolled to first filled field (not blank top)", s.scrollTop > 40, "scrollTop=" + s.scrollTop);
app.close();
const fail = R.filter(r=>!r.ok);
console.log("\n" + (fail.length? ("E2E FAIL \u2014 "+fail.length+"/"+R.length+" failed") : "E2E PASS \u2014 all "+R.length+" assertions green"));
process.exit(fail.length?1:0);
