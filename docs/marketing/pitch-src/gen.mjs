// Generates 5 on-brand 1280x800 pitch scenes (store screenshots + video frames) and a
// narration script. Faithful mini-mocks of the real extension UI with demo data.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const OUT = dirname(fileURLToPath(import.meta.url)) + "\\";
mkdirSync(OUT, { recursive: true });

const BRAND = `
  :root{--ink:#0e1230;--indigo:#141a44;--indigo2:#232c6b;--teal:#12b6a5;--teal-d:#0d8f83;--coral:#ff7a59;--paper:#ffffff;--mut:#8792b8;--line:#e7ebf5}
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif}
  .stage{width:1280px;height:800px;overflow:hidden;position:relative;background:
     radial-gradient(1200px 700px at 82% -10%, #2a3a7a,transparent),
     linear-gradient(135deg,var(--indigo) 0%,#0e1230 60%,#0b0f26 100%);color:#fff;display:flex}
  .stage:before{content:"";position:absolute;inset:0;background:
     radial-gradient(900px 520px at 80% 12%, rgba(18,182,165,.20), transparent 60%);}
  .col-l{width:560px;padding:74px 0 74px 84px;display:flex;flex-direction:column;justify-content:center;position:relative;z-index:2}
  .col-r{flex:1;display:flex;align-items:center;justify-content:center;position:relative;z-index:2}
  .eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:15px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--teal);margin-bottom:22px}
  .eyebrow b{width:9px;height:9px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 5px rgba(18,182,165,.18)}
  h1{font-size:58px;line-height:1.04;font-weight:800;letter-spacing:-.02em;text-wrap:balance;margin-bottom:22px}
  h1 .hl{color:var(--teal)} h1 .co{color:var(--coral)}
  p.sub{font-size:22px;line-height:1.45;color:#c7cdec;max-width:460px;font-weight:400}
  .chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:30px}
  .chip{font-size:14px;font-weight:600;color:#dfe4ff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);padding:8px 13px;border-radius:999px}
  .brandline{position:absolute;left:84px;bottom:52px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:19px;letter-spacing:.01em;z-index:3}
  .logo{width:38px;height:38px;border-radius:10px;background:linear-gradient(150deg,var(--teal),var(--teal-d));display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 8px 24px rgba(18,182,165,.4)}
  .foot{position:absolute;right:56px;bottom:52px;color:#8f98c8;font-size:15px;z-index:3}
  /* device card */
  .card{background:var(--paper);color:#101a20;border-radius:18px;box-shadow:0 40px 90px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.06);overflow:hidden}
  .win{width:560px}
  .titlebar{height:38px;background:#f1f3fa;display:flex;align-items:center;gap:7px;padding:0 14px;border-bottom:1px solid var(--line)}
  .dot{width:11px;height:11px;border-radius:50%} .r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}
  .tbtxt{margin-left:10px;font-size:12px;color:#8a93a6;font-weight:600}
  .pad{padding:20px 22px}
  .h{font-weight:800;font-size:16px;margin-bottom:2px}.muted{color:#5b6b86;font-size:12.5px}
  .field{display:flex;align-items:center;gap:10px;margin-top:11px}
  .k{font:600 12px ui-monospace,monospace;color:var(--teal-d);min-width:104px}
  .v{flex:1;background:#f4f7fb;border:1px solid var(--line);border-radius:7px;padding:8px 11px;font-size:13px}
  .btn{display:inline-block;background:var(--teal-d);color:#fff;font-weight:700;font-size:13px;padding:9px 14px;border-radius:9px}
  .lockrow{display:flex;align-items:center;gap:10px;background:#e9f7f4;border:1px solid #bfe6df;color:#0a6a60;border-radius:10px;padding:11px 13px;font-size:13px;font-weight:600;margin-top:14px}
  table.tp{width:100%;border-collapse:collapse;margin-top:6px}
  table.tp th{font:700 10px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.05em;color:#9aa6be;text-align:left;padding:6px 6px;border-bottom:2px solid var(--line)}
  table.tp td{padding:8px 6px;border-bottom:1px solid #eef2f7;font-size:13px;vertical-align:top}
  td.o{color:#6a7691}td.t{font-weight:700}td.tv{font-weight:700;color:var(--teal-d)}
  .badge{position:absolute;top:26px;right:26px;background:rgba(18,182,165,.15);border:1px solid rgba(18,182,165,.5);color:#8ff0e4;font-size:13px;font-weight:700;padding:7px 13px;border-radius:999px;z-index:3}
`;

const page = (inner, extra="") => `<!doctype html><html><head><meta charset="utf8"><style>${BRAND}${extra}</style></head><body><div class="stage">${inner}<div class="brandline"><span class="logo">🗎</span> PolyglotFormFill</div></div></body></html>`;

const chips = (a)=>`<div class="chips">${a.map(c=>`<span class="chip">${c}</span>`).join("")}</div>`;

// ---- Scene 1: WHAT (hero) ----
const s1 = page(`
  <div class="col-l">
    <span class="eyebrow"><b></b>On-device form autofill</span>
    <h1>Fill <span class="hl">any form</span>,<br>in <span class="hl">any language</span> —<br>100% on <span class="co">your device</span>.</h1>
    <p class="sub">One click completes web forms and PDFs from a private, encrypted profile. Nothing you enter ever leaves your computer.</p>
    ${chips(["Web forms","PDFs","Passports & IDs","7 languages"])}
  </div>
  <div class="col-r">
    <div class="card win" style="width:520px">
      <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tbtxt">PolyglotFormFill Autofill</span></div>
      <div class="pad">
        <div class="h">Your details — encrypted on this device</div>
        <div class="muted">Unlocked by passphrase or passkey</div>
        <div class="field"><span class="k">full_name</span><span class="v">Asha Rao</span></div>
        <div class="field"><span class="k">date_of_birth</span><span class="v">1990-01-15</span></div>
        <div class="field"><span class="k">nationality</span><span class="v">Indian</span></div>
        <div class="field"><span class="k">email</span><span class="v">asha@example.com</span></div>
        <div class="lockrow">🔒 End-to-end encrypted · nothing leaves your device</div>
      </div>
    </div>
  </div>`);

// ---- Scene 2: WHY (privacy) ----
const s2 = page(`
  <div class="col-l">
    <span class="eyebrow"><b></b>Why it's different</span>
    <h1>Your data<br><span class="hl">never leaves</span><br>your device.</h1>
    <p class="sub">Autofill, OCR, translation and PDF filling all run locally. No cloud AI on your content. No tracking. No telemetry. Ever.</p>
    ${chips(["No cloud AI","No tracking","Open, auditable","Encrypted vault"])}
  </div>
  <div class="col-r">
    <div class="card" style="width:430px;text-align:center">
      <div class="pad" style="padding:46px 34px">
        <div style="font-size:74px;line-height:1">🔒</div>
        <div class="h" style="font-size:22px;margin-top:14px">Private by architecture</div>
        <p class="muted" style="font-size:14px;margin-top:8px;line-height:1.5">The only thing our servers ever send you is fonts and language models. They can <b>never</b> receive your form data — it's not wired to.</p>
        <div class="lockrow" style="justify-content:center;margin-top:20px">✓ Device → your chosen recipient. Never us.</div>
      </div>
    </div>
  </div>`);

// ---- Scene 3: HOW (one-click autofill) ----
const s3 = page(`
  <span class="badge">⚡ One click</span>
  <div class="col-l">
    <span class="eyebrow"><b></b>How it works</span>
    <h1>It understands<br>fields by <span class="hl">meaning</span>,<br>not by name.</h1>
    <p class="sub">A "Given name" box gets your first name. A lone "Address" line is composed from its parts. No per-form setup — it just fits.</p>
    ${chips(["Semantic matching","Any field naming","Passport & tax forms"])}
  </div>
  <div class="col-r">
    <div class="card win" style="width:560px">
      <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tbtxt">AUTOFILL · Sample Passport Application</span></div>
      <div class="pad">
        <div class="h">Filled 6 of 6 fields — on-device ✓</div>
        <table class="tp"><tr><th>Form field</th><th>Understood as</th><th>Filled with</th></tr>
        <tr><td class="o">Given name</td><td class="t">first name</td><td class="tv">Asha</td></tr>
        <tr><td class="o">Family name</td><td class="t">last name</td><td class="tv">Rao</td></tr>
        <tr><td class="o">D.O.B.</td><td class="t">date of birth</td><td class="tv">1990-01-15</td></tr>
        <tr><td class="o">Nationality</td><td class="t">nationality</td><td class="tv">Indian</td></tr>
        <tr><td class="o">Residential address</td><td class="t">address (composed)</td><td class="tv">12 MG Rd, Pune 411001</td></tr>
        </table>
      </div>
    </div>
  </div>`);

// ---- Scene 4: WHICH (language superpower) ----
const s4 = page(`
  <span class="badge">🌐 On-device translation</span>
  <div class="col-l">
    <span class="eyebrow"><b></b>The superpower</span>
    <h1>Read & fill a form<br>in <span class="hl">your</span> language.</h1>
    <p class="sub">See every label and value in Hindi, Spanish, Chinese, Arabic and more. Names are written in your script — never mistranslated.</p>
    ${chips(["हिन्दी","中文","العربية","Español","Français","Русский"])}
  </div>
  <div class="col-r">
    <div class="card win" style="width:520px">
      <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tbtxt">Read this form in your language</span></div>
      <div class="pad">
        <div class="h">This form is in English — reading it in हिन्दी</div>
        <table class="tp"><tr><th>Label·EN</th><th>लेबल·हिन्दी</th><th>Value·EN</th><th>मान·हिन्दी</th></tr>
        <tr><td class="o">Full name</td><td class="t">पूरा नाम</td><td class="o">Asha Rao</td><td class="tv">आशा राव</td></tr>
        <tr><td class="o">Nationality</td><td class="t">राष्ट्रीयता</td><td class="o">Indian</td><td class="tv">भारतीय</td></tr>
        <tr><td class="o">Age</td><td class="t">आयु</td><td class="o">34</td><td class="tv">३४</td></tr>
        </table>
        <div class="muted" style="margin-top:12px">Names transliterated · numbers localised · form still submits in English</div>
      </div>
    </div>
  </div>`);

// ---- Scene 5: WHEN / CTA ----
const s5 = page(`
  <div class="col-l" style="width:100%;align-items:flex-start;padding-right:84px">
    <span class="eyebrow"><b></b>Whenever a form stands between you and done</span>
    <h1>Passports. Taxes. Jobs.<br>Healthcare. <span class="hl">Anywhere.</span></h1>
    <p class="sub" style="max-width:640px">Stop retyping the same details. Stop guessing at forms in a language you don't read. PolyglotFormFill does it in one click — privately.</p>
    <div style="display:flex;gap:14px;align-items:center;margin-top:34px">
      <span class="btn" style="font-size:16px;padding:14px 22px">Add to Chrome — Free</span>
      <span class="muted" style="color:#c7cdec;font-size:15px">polyglotformfill.mooo.com</span>
    </div>
    ${chips(["Chrome extension","Desktop app","Encrypted backup & sync"])}
  </div>`);

const scenes = { s1, s2, s3, s4, s5 };
for (const [k,v] of Object.entries(scenes)) writeFileSync(OUT + k + ".html", v);

// narration (professional VO), timed roughly to length
const vo = [
  ["s1","Meet PolyglotFormFill. It fills any form, in any language, entirely on your device. One click completes web forms and P-D-Fs from a private, encrypted profile — and nothing you enter ever leaves your computer."],
  ["s2","Here's why it's different. Autofill, scanning, translation and P-D-F filling all run locally. No cloud A-I touches your content. No tracking. No telemetry. The only thing our servers ever send you is fonts and language models — they can never receive your data."],
  ["s3","And it's smart. It understands form fields by meaning, not by their name. A given-name box gets your first name. A lone address line is composed from its parts. No setup per form — it simply fits, from passports to tax forms."],
  ["s4","Now the superpower. Read and fill a form in your own language. See every label and value in Hindi, Spanish, Chinese, Arabic and more. Your name is written in your script, never mistranslated — and the form still submits correctly in its original language."],
  ["s5","Passports, taxes, job applications, healthcare — anywhere a form stands between you and done. Stop retyping. Stop guessing. Add PolyglotFormFill to Chrome, free, and fill it in one click — privately. PolyglotFormFill dot mooo dot com."],
];
writeFileSync(OUT + "vo.json", JSON.stringify(vo, null, 2));
console.log("wrote 5 scenes + vo.json to", OUT);
