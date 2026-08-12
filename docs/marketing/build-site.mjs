// Build a fully-localised static marketing site from ONE set of templates + a per-language string
// catalogue (docs/marketing/i18n/<lang>.json). Every UI language in the shared catalogue gets a
// COMPLETE landing, privacy, and install page — never a stub, never half-English — each carrying a
// language switcher and language-preserving navigation. English lives at / , /privacy/ , /install/ ;
// every other language at /<lang>/… . No build tools, no external requests at build time.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const site = join(dir, "site");
const i18nDir = join(dir, "i18n");

// The site speaks the same catalogue as the extension and the desktop app. We reuse its language
// labels (each in its own script), RTL set, and the already-translated shared strings (app.*,
// privacy.*, site.*), and layer the marketing-only copy on top from docs/marketing/i18n/.
const { UI_LANGS, AVAILABLE, dirOf, STRINGS: SHARED } = await import(
  new URL("../../apps/extension/src/i18n.js", import.meta.url)
);

// ---- string catalogue -----------------------------------------------------------------------
const EN = JSON.parse(readFileSync(join(i18nDir, "en.json"), "utf8"));
const MARKETING = { en: EN };
for (const f of readdirSync(i18nDir)) {
  if (!f.endsWith(".json") || f === "en.json") continue;
  const lang = f.replace(/\.json$/, "");
  MARKETING[lang] = JSON.parse(readFileSync(join(i18nDir, f), "utf8"));
}

// A translator bound to one language: marketing catalogue first, then the shared extension
// catalogue, then English — a visible English word always beats a blank. `{name}` placeholders are
// substituted; arrays pass through untouched.
function translator(lang) {
  const m = MARKETING[lang] || {};
  const shared = SHARED[lang] || {};
  return (key, vars = null) => {
    let s = m[key];
    if (s === undefined) s = shared[key];
    if (s === undefined) s = EN[key];
    if (s === undefined) s = SHARED.en[key];
    if (s === undefined) return key;
    if (Array.isArray(s)) return s;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(String(v));
    return s;
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Narrated guide video: which languages have a real dub (video + captions). Any other UI language
// falls back to the English guide. English keeps its historical stable names (guide.mp4 / guide.en.srt)
// so the desktop app's pinned /download/guide.mp4 URL never breaks; dubs are guide.<lang>.{mp4,srt}.
// Keep this set in lockstep with the langs built by `node scripts/build-guide.mjs --lang <lang>` and
// uploaded by deploy/k8s/publish-site.ps1 (GUIDE_LANGS there is the single source of truth for upload).
const GUIDE_DUBBED = new Set(["en", "kn", "hi", "ta", "te", "es", "zh", "ko", "ja"]);
function guideAssets(lang) {
  const l = GUIDE_DUBBED.has(lang) ? lang : "en";
  return {
    lang: l,
    mp4: l === "en" ? "/download/guide.mp4" : `/download/guide.${l}.mp4`,
    // HTML <track> needs WebVTT, not SRT — the build/publish step emits a .vtt beside each .srt.
    vtt: `/download/guide.${l}.vtt`,
    // the caption track's human label — UI_LANGS maps a code to its native language name string
    label: UI_LANGS[l] || l,
  };
}

// ---- URLs + switcher (language-preserving navigation) ---------------------------------------
// Each page type has ONE canonical URL per language; the switcher options carry the full localised
// URL for the SAME page type, so choosing a language keeps you on the page you were reading.
function urlFor(lang, page) {
  const base = lang === "en" ? "" : `/${lang}`;
  if (page === "landing") return base === "" ? "/" : `${base}/`;
  if (page === "privacy") return `${base}/privacy/`;
  if (page === "install") return `${base}/install/`;
  return `${base}/`;
}

// Canonical origin + a share image (existing asset). Used for SEO + social cards.
const SITE_ORIGIN = "https://polyglotformfill.com";
// The published Chrome Web Store listing (LIVE — no longer "coming soon").
const STORE_URL = "https://chromewebstore.google.com/detail/goaoopdpnofpamcpmmpbfkahfhfegfke";
const OG_IMAGE = `${SITE_ORIGIN}/download/before-after.jpg`;

// SEO + social <head> block: canonical, Open Graph, Twitter card, and hreflang alternates for
// every language (so Google serves the right localue and 26 pages aren't seen as duplicates).
function headMeta(lang, page, tr) {
  const canonical = `${SITE_ORIGIN}${urlFor(lang, page)}`;
  const title = page === "install" ? tr("install.title")
    : page === "privacy" ? `${tr("app.name")} — ${tr("privP.title")}`
    : `${tr("app.name")} — ${tr("meta.landingTitle")}`;
  const desc = page === "install" ? tr("install.intro") : tr("meta.landingDesc");
  const alts = Object.keys(UI_LANGS)
    .map((code) => `<link rel="alternate" hreflang="${code}" href="${SITE_ORIGIN}${urlFor(code, page)}">`)
    .join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}${urlFor("en", page)}">`;
  return `<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(tr("app.name"))}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:locale" content="${esc(lang)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${OG_IMAGE}">
${alts}`;
}

// A prominent, honest download counter at the very top of the landing page (social proof). Numbers come
// live from the self-hosted counter (/counts); if it's unreachable or still zero, the bar hides itself
// rather than showing "0". Privacy: /counts is two integers — no identities, nothing tracked.
const COUNTER_JS = `
(function(){
  var el=document.getElementById('dlcount'); if(!el) return;
  fetch('/counts',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    var exe=+(d.exe||0), ext=+(d.ext||0), total=exe+ext;
    if(!(total>0)) return;                       // nothing to brag about yet — stay hidden
    var f=function(n){try{return n.toLocaleString()}catch(e){return ''+n}};
    el.querySelector('[data-c=total]').textContent=f(total);
    el.querySelector('[data-c=exe]').textContent=f(exe);
    el.querySelector('[data-c=ext]').textContent=f(ext);
    el.classList.add('on');
  }).catch(function(){});
})();`;
function counterBar(tr) {
  return `<div id="dlcount" class="dlcount" role="status" aria-live="polite">
    <div class="big"><span class="num" data-c="total">—</span> ${esc(tr("counter.tagline"))}</div>
    <div class="brk"><span>🖥️ <b data-c="exe">—</b> ${esc(tr("counter.desktop"))}</span>
      <span>🧩 <b data-c="ext">—</b> ${esc(tr("counter.extension"))}</span></div>
    <div class="tiny">${esc(tr("counter.private"))}</div>
  </div>`;
}
const COUNTER_CSS = `
  .dlcount{display:none;margin:0;padding:14px 24px;text-align:center;background:linear-gradient(180deg,#0d8f83,#0b7a75);color:#fff}
  .dlcount.on{display:block}
  .dlcount .big{font:700 clamp(18px,3vw,26px)/1.15 var(--sans,system-ui)}
  .dlcount .big .num{font-size:1.25em}
  .dlcount .brk{margin-top:4px;font-size:14px;opacity:.95;display:flex;gap:18px;justify-content:center;flex-wrap:wrap}
  .dlcount .tiny{margin-top:4px;font-size:12px;opacity:.8}
`;
function switcher(current, page) {
  // The <option> value is the LANGUAGE CODE (stable, testable, and what analytics/deeplinks expect);
  // the destination URL for the SAME page type rides along in data-url so choosing a language keeps
  // you on the page you were reading.
  const opts = Object.entries(UI_LANGS)
    .map(([code, label]) =>
      `<option value="${code}" data-url="${urlFor(code, page)}"${code === current ? " selected" : ""}>${label}</option>`)
    .join("");
  return `<div class="langbar"><label for="lang">🌐</label>` +
    `<select id="lang" aria-label="Language" onchange="location.href=this.selectedOptions[0].dataset.url">${opts}</select></div>`;
}

// English-page only: SUGGEST (never redirect to) the visitor's own language when we speak it. An
// automatic redirect strands anyone who wanted English, so this only reveals a dismissible hint with
// a link. `location` is never assigned here — navigation is the visitor's click.
function langhint() {
  const known = JSON.stringify(
    Object.fromEntries(AVAILABLE.filter((l) => l !== "en").map((l) => [l, { url: urlFor(l, "landing"), label: UI_LANGS[l] || l }])),
  );
  return `<div id="langhint" class="langhint" hidden></div>
<script>
(function(){
  var KNOWN=${known}, el=document.getElementById("langhint"); if(!el) return;
  var langs=(navigator.languages||[navigator.language||""]);
  for(var i=0;i<langs.length;i++){
    var code=String(langs[i]||"").toLowerCase().split("-")[0];
    if(code==="en") return;              // the visitor already prefers English — say nothing
    if(KNOWN[code]){
      var k=KNOWN[code];
      el.innerHTML='<a href="'+k.url+'">'+k.label+' →</a>';
      el.hidden=false; return;
    }
  }
})();
</script>`;
}

const HELLO_JS = `
(function(){
  // Every greeting EXCEPT Kannada drifts. Kannada (ನಮಸ್ಕಾರ) is pinned on the right, always visible,
  // gently swaying in place (the maker's language).
  var HELLO=["Hello","नमस्ते","Hola","Bonjour","你好","こんにちは","مرحبا","Olá","Ciao",
    "Hallo","Привет","안녕하세요","வணக்கம்","สวัสดี","Xin chào","হ্যালো","Salam","Merhaba",
    "Habari","Shalom","Γεια","Namaste","Sawubona","Aloha"];
  var bg=document.getElementById("hellobg"); if(!bg) return;
  var N=Math.min(30, Math.max(14, Math.round(window.innerWidth/60)));
  for(var i=0;i<N;i++){
    var el=document.createElement("div"); el.className="h"; el.textContent=HELLO[i%HELLO.length];
    el.style.left=(Math.random()*96)+"vw"; el.style.top=(Math.random()*100)+"vh";
    el.style.fontSize=(15+Math.random()*30)+"px";
    var dur=(9+Math.random()*9).toFixed(2);
    el.style.animation="hdrift "+dur+"s ease-in-out "+(-Math.random()*dur).toFixed(2)+"s infinite";
    bg.appendChild(el);
  }
  var k=document.createElement("div"); k.className="kfix"; k.textContent="ನಮಸ್ಕಾರ"; bg.appendChild(k);
})();`;

// Stripe payment config (Payment Link URLs + PPP promo prefix) provisioned into docs/business/
// stripe-config.json. Injected at build time so the Buy buttons point at the right Checkout.
// Absent → buttons stay on the free-trial CTA. Only NON-secret data lives here (public link URLs).
let PAY_CFG = { tiers: {}, pppBands: [10, 20, 30, 40, 50, 60, 65], pppPromoPrefix: "PPP", live: false };
try { PAY_CFG = { ...PAY_CFG, ...JSON.parse(readFileSync(join(dir, "../business/stripe-config.json"), "utf8")) }; } catch { /* not provisioned yet */ }
const PAY_LINKS = Object.fromEntries(Object.entries(PAY_CFG.tiers || {}).map(([k, v]) => [k, v.link]));
const PAY_LIVE = !!PAY_CFG.live;   // false until we flip live → buy buttons fall back to the trial

// A tier's CTA: a real Buy button once payments are LIVE; the free-trial download until then (so we
// never ship a button that leads to a checkout that can't complete).
function payBtn(tr, tier, labelKey) {
  if (PAY_LIVE) return `<a class="btn buy" data-tier="${tier}" style="margin-top:16px" rel="nofollow" href="#">${esc(tr(labelKey))}</a>`;
  return `<a class="btn" style="margin-top:16px" href="#get">${esc(tr("price.startTrial"))}</a>`;
}

const PPP_JS = `
(function(){
  var PPP={US:1,CA:0.95,GB:0.95,AU:0.95,NZ:0.9,IE:0.95,DE:0.9,FR:0.9,NL:0.95,SE:0.95,NO:1,CH:1.1,DK:1,FI:0.95,AT:0.9,BE:0.9,IT:0.8,ES:0.75,PT:0.7,GR:0.65,PL:0.55,CZ:0.6,HU:0.5,RO:0.5,BG:0.45,IN:0.3,PK:0.28,BD:0.28,LK:0.3,NP:0.28,ID:0.4,PH:0.35,VN:0.35,TH:0.45,MY:0.5,CN:0.55,JP:0.8,KR:0.8,TW:0.75,SG:1,HK:0.95,AE:0.9,SA:0.7,QA:0.9,KW:0.8,IL:0.85,TR:0.4,EG:0.3,ZA:0.45,NG:0.3,KE:0.3,GH:0.3,MA:0.4,BR:0.45,MX:0.5,AR:0.4,CO:0.4,CL:0.55,PE:0.4,RU:0.5,UA:0.35,KZ:0.45};
  var NAMES={IN:"India",BR:"Brazil",MX:"Mexico",GB:"the UK",DE:"Germany",FR:"France",ES:"Spain",JP:"Japan",CN:"China",ZA:"South Africa",NG:"Nigeria",PH:"the Philippines",ID:"Indonesia",PK:"Pakistan",BD:"Bangladesh",TR:"Turkey",RU:"Russia",AE:"the UAE",CA:"Canada",AU:"Australia"};
  var PAY_LINKS=${JSON.stringify(PAY_LINKS)}, PROMO=${JSON.stringify(PAY_CFG.pppPromoPrefix || "PPP")}, BANDS=${JSON.stringify(PAY_CFG.pppBands || [10,20,30,40,50,60,65])};
  function nearestBand(off){ if(off<5) return 0; var b=BANDS[0],best=1e9; for(var i=0;i<BANDS.length;i++){var d=Math.abs(BANDS[i]-off); if(d<best){best=d;b=BANDS[i];}} return b; }
  function setBuys(band){ ["pro","duo","business"].forEach(function(t){ var base=PAY_LINKS[t]; if(!base) return;
    var u=base; if(band) u+=(base.indexOf("?")<0?"?":"&")+"prefilled_promo_code="+PROMO+band; // Stripe auto-applies the region discount
    document.querySelectorAll('.buy[data-tier="'+t+'"]').forEach(function(a){a.setAttribute("href",u);}); }); }
  function note(t){var n=document.getElementById("ppp-note");if(n)n.textContent=t;}
  setBuys(0); // full USD by default (works before the region lookup resolves)
  fetch("https://api.country.is/").then(function(r){return r.json();}).then(function(d){
    var cc=(d.country||"").toUpperCase(); var f=PPP[cc];
    if(!f){ note("Prices shown in USD."); return; }
    if(f<0.35)f=0.35;
    if(f>=0.98){ note("Prices shown in USD for your region ("+(NAMES[cc]||cc)+")."); return; }
    var band=nearestBand(Math.round((1-f)*100)); var ef=band?(1-band/100):1; // snap DISPLAY to the band so shown == charged
    document.querySelectorAll(".ppp").forEach(function(el){ var usd=+el.getAttribute("data-usd"); el.textContent="$"+Math.max(1,Math.round(usd*ef)); });
    setBuys(band);
    note("Prices adjusted for "+(NAMES[cc]||cc)+" (\\u2248"+band+"% regional discount, applied automatically at checkout).");
  }).catch(function(){ note("Prices shown in USD."); });
})();`;

// The full landing CSS (kept from the original hand-written landing.html so every localised page
// looks identical to the English one).
const LANDING_CSS = readFileSync(join(dir, "landing.html"), "utf8")
  .match(/<style>([\s\S]*?)<\/style>/)[1];

const LANGBAR_CSS = `
  .langbar{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:10px 24px;
    border-bottom:1px solid var(--line,#dde6e4);font-family:var(--sans,system-ui);font-size:14px}
  .langbar select{font:inherit;padding:4px 8px;border-radius:8px}
  [dir=rtl] .langbar{justify-content:flex-start}
  .langhint{padding:8px 24px;text-align:right;font-family:var(--sans,system-ui);font-size:14px;
    border-bottom:1px solid var(--line,#dde6e4)}
  .langhint a{color:var(--teal,#0b7a75);text-decoration:none;font-weight:600}
  [dir=rtl] .langhint{text-align:left}
`;

// Narrated-guide embed shown in the hero. Language-aware <video> with a caption <track>.
const GUIDEVID_CSS = `
  .guidevid{margin:40px auto 8px;max-width:840px;text-align:center}
  .guidevid h2{margin:0 0 6px;font-size:26px}
  .guidevid .lede{margin:0 0 18px}
  .guidevid video{width:100%;max-width:840px;aspect-ratio:16/9;border-radius:14px;
    box-shadow:0 12px 40px rgba(0,0,0,.18);background:#000}
  .guidevid .cc-note{margin:10px 0 0;font-size:13px;opacity:.65}
`;

// ---- landing template -----------------------------------------------------------------------
function landingPage(lang) {
  const tr = translator(lang);
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  const feats = [1, 2, 3, 4, 5, 6, 7].map((n) =>
    `<div class="card"><div class="ic">${["🔒","🌍","📄","🧠","✍️","🔑","🔗"][n-1]}</div>` +
    `<h3>${esc(tr("feat.c"+n+"t"))}</h3><p>${esc(tr("feat.c"+n+"b"))}</p></div>`).join("\n    ");
  return `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tr("app.name"))} — ${esc(tr("meta.landingTitle"))}</title>
<meta name="description" content="${esc(tr("meta.landingDesc"))}">
${headMeta(lang, "landing", tr)}
<style>${LANDING_CSS}${LANGBAR_CSS}${GUIDEVID_CSS}${COUNTER_CSS}
  .tier.pop::after{content:"${esc(tr("price.mostPopular"))}"}
</style>

${counterBar(tr)}
<div class="hellobg" id="hellobg" aria-hidden="true"></div>
${switcher(lang, "landing")}
${lang === "en" ? langhint() : ""}
<script>${COUNTER_JS}</script>

<div class="wrap">
  <nav>
    <div class="brand"><span class="dot"></span> ${esc(tr("app.name"))}</div>
    <div class="navlinks">
      <a href="#features">${esc(tr("nav.features"))}</a>
      <a href="#who">${esc(tr("nav.who"))}</a>
      <a href="#polyglot">${esc(tr("nav.languages"))}</a>
      <a href="#pricing">${esc(tr("nav.pricing"))}</a>
      <a href="/tutorials/">${esc(tr("nav.tutorials"))}</a>
      <a href="#privacy">${esc(tr("nav.privacy"))}</a>
      <a class="btn" href="#get">${esc(tr("nav.getit"))}</a>
    </div>
  </nav>
</div>

<header class="wrap">
  <span class="badge">◉ ${esc(tr("hero.badge"))}</span>
  <h1>${esc(tr("hero.h1a"))}<br><span class="fade">${esc(tr("hero.h1b"))}</span></h1>
  <p class="tagline">${esc(tr("app.tagline"))}</p>
  <p class="lede">${esc(tr("hero.lede"))}</p>
  <div class="cta">
    <a class="btn" href="#features">${esc(tr("hero.cta1"))}</a>
    <a class="btn ghost" href="/tutorials/">${esc(tr("hero.cta2"))}</a>
    <a class="btn ghost" href="#get">${esc(tr("hero.cta3"))}</a>
  </div>
  <div class="trustline">${esc(tr("hero.trust"))}</div>

  ${(() => { const g = guideAssets(lang); return `<section class="guidevid" aria-label="${esc(tr("guide.title"))}">
    <h2>${esc(tr("guide.title"))}</h2>
    <p class="lede">${esc(tr("guide.sub"))}</p>
    <video controls preload="none" playsinline poster="${OG_IMAGE}" crossorigin="anonymous">
      <source src="${g.mp4}" type="video/mp4">
      <track kind="subtitles" src="${g.vtt}" srclang="${g.lang}" label="${esc(g.label)}" default>
    </video>
    <p class="cc-note">${esc(tr("guide.ccNote"))}</p>
  </section>` })()}

  <div class="flow">
    <div class="device">
      <h3>${esc(tr("flow.deviceTitle"))}</h3>
      <div class="chips">
        <span class="chip">📄 ${esc(tr("flow.chip1"))}</span>
        <span class="chip">🔎 ${esc(tr("flow.chip2"))}</span>
        <span class="chip">🌍 ${esc(tr("flow.chip3"))}</span>
        <span class="chip">🧠 ${esc(tr("flow.chip4"))}</span>
        <span class="chip">🖊 ${esc(tr("flow.chip5"))}</span>
        <span class="chip">✍️ ${esc(tr("flow.chip6"))}</span>
        <span class="chip">🔐 ${esc(tr("flow.chip7"))}</span>
      </div>
    </div>
    <div class="egress">
      <div class="out"><span class="arrow">→</span><div><b>${esc(tr("flow.egressLabel"))}</b>
        ${esc(tr("flow.egressBody"))}</div></div>
    </div>
  </div>
</header>

<section id="features" class="wrap">
  <span class="eyebrow">${esc(tr("feat.eyebrow"))}</span>
  <h2 class="h2">${esc(tr("feat.h2"))}</h2>
  <p class="sub">${esc(tr("feat.sub"))}</p>
  <div class="grid">
    <div class="card feature">
      <div class="ic">🧩</div>
      <div>
        <span class="flag">${esc(tr("feat.flag"))}</span>
        <h3>${esc(tr("feat.mainTitle"))}</h3>
        <p>${esc(tr("feat.mainBody"))}</p>
      </div>
    </div>
    ${feats}
  </div>
</section>

<section id="who" class="wrap">
  <span class="eyebrow">${esc(tr("who.eyebrow"))}</span>
  <h2 class="h2">${esc(tr("who.h2"))}</h2>
  <p class="sub">${esc(tr("who.sub"))}</p>
  <div class="grid">
    <div class="card"><div class="ic">🛂</div><h3>${esc(tr("who.c1t"))}</h3><p>${esc(tr("who.c1b"))}</p></div>
    <div class="card"><div class="ic">💼</div><h3>${esc(tr("who.c2t"))}</h3><p>${esc(tr("who.c2b"))}</p></div>
    <div class="card"><div class="ic">🛡️</div><h3>${esc(tr("who.c3t"))}</h3><p>${esc(tr("who.c3b"))}</p></div>
  </div>
</section>

<section id="polyglot" class="wrap">
  <div class="band">
    <span class="eyebrow" style="color:rgba(255,255,255,.8)">${esc(tr("band.eyebrow"))}</span>
    <h2 class="h2">${esc(tr("band.h2"))}</h2>
    <p class="sub">${esc(tr("band.sub"))}</p>
    <div class="langrow">
      <span class="lang">English ↔ हिन्दी</span>
      <span class="lang">${esc(tr("band.chip2"))}</span>
      <span class="lang">${esc(tr("band.chip3"))}</span>
    </div>
  </div>
</section>

<section id="pricing" class="wrap">
  <span class="eyebrow">${esc(tr("price.eyebrow"))}</span>
  <h2 class="h2">${esc(tr("price.h2"))}</h2>
  <p class="sub">${esc(tr("price.sub"))}</p>
  <div class="tiers">
    <div class="tier">
      <h3>${esc(tr("price.free"))}</h3>
      <div class="price">$0 <span style="font-size:14px;font-weight:500;color:var(--muted)">${esc(tr("price.freeDuration"))}</span></div>
      <ul>${li(tr("price.freeList"))}</ul>
      <a class="btn ghost" style="margin-top:16px" href="#get">${esc(tr("price.startTrial"))}</a>
    </div>
    <div class="tier pop">
      <h3>${esc(tr("price.pro"))}</h3>
      <div class="price"><span class="ppp" data-usd="19">$19</span> <span style="font-size:14px;font-weight:500;color:var(--muted)">${esc(tr("price.oneTimeDevice"))}</span></div>
      <div style="font-size:13px;color:var(--muted);margin:-6px 0 8px">${esc(tr("price.oneDevice"))}</div>
      <ul>${li(tr("price.proList"))}</ul>
      ${payBtn(tr, "pro", "price.buy")}
    </div>
    <div class="tier">
      <h3>${esc(tr("price.family"))}</h3>
      <div class="price"><span class="ppp" data-usd="29">$29</span> <span style="font-size:14px;font-weight:500;color:var(--muted)">${esc(tr("price.oneTime"))}</span></div>
      <div style="font-size:13px;color:var(--muted);margin:-6px 0 8px">${tr("price.familyDevices", { each: '<span class="ppp" data-usd="15">$15</span>' })}</div>
      <ul>${li(tr("price.familyList"))}</ul>
      ${payBtn(tr, "duo", "price.buy")}
    </div>
  </div>
  <div id="ppp-note" style="color:var(--muted);font-size:13px;margin-top:14px"></div>
  <script>${PPP_JS}</script>
  <script>${HELLO_JS}</script>

  <div style="margin-top:40px">
    <span class="eyebrow">${esc(tr("team.eyebrow"))}</span>
    <h2 class="h2" style="font-size:clamp(20px,3vw,26px)">${esc(tr("team.h2"))}</h2>
    <p class="sub">${esc(tr("team.sub"))}</p>
    <div class="tiers">
      <div class="tier">
        <h3>${esc(tr("team.tBiz"))}</h3>
        <div class="price"><span class="ppp" data-usd="29">$29</span> <span style="font-size:14px;font-weight:500;color:var(--muted)">${esc(tr("team.perSeat"))}</span></div>
        <div style="font-size:13px;color:var(--muted);margin:-6px 0 8px">${esc(tr("team.tBizRange"))}</div>
        <ul>${li(tr("team.tBizList"))}</ul>
        ${payBtn(tr, "business", "price.getBusiness")}
        <div style="font-size:12px;color:var(--muted);margin-top:8px">${esc(tr("price.seatsNote"))}</div>
      </div>
      <div class="tier">
        <h3>${esc(tr("team.tEnt"))}</h3>
        <div class="price" style="font-size:22px">${esc(tr("team.tEntPrice"))}</div>
        <div style="font-size:13px;color:var(--muted);margin:-6px 0 8px">${esc(tr("team.tEntRange"))}</div>
        <ul>${li(tr("team.tEntList"))}</ul>
        <a class="btn ghost" style="margin-top:16px" href="mailto:subumysore@gmail.com">${esc(tr("team.tEntPrice"))}</a>
      </div>
    </div>
  </div>

  <p class="note">${esc(tr("price.note"))} <a href="mailto:subumysore@gmail.com">${esc(tr("price.contactUs"))}</a>.</p>
</section>

<section id="get" class="wrap">
  <span class="eyebrow">${esc(tr("get.eyebrow"))}</span>
  <h2 class="h2">${esc(tr("get.h2"))}</h2>
  <p class="sub">${esc(tr("get.sub"))}</p>
  <div class="cta">
    <a class="btn" href="${urlFor(lang, "install")}#extension">${esc(tr("get.extPrimary"))}</a>
    <a class="btn ghost" href="/dl/exe" aria-label="${esc(tr("site.download"))}">${esc(tr("get.win"))}</a>
    <a class="btn ghost" href="${STORE_URL}" target="_blank" rel="noopener">${esc(tr("get.store"))}</a>
  </div>
  <p class="note">${esc(tr("get.note"))}</p>
</section>

<section id="privacy" class="wrap">
  <span class="eyebrow">${esc(tr("privS.eyebrow"))}</span>
  <h2 class="h2">${esc(tr("privS.h2"))}</h2>
  <p class="sub" style="font-weight:600">${esc(tr("privacy.headline"))}</p>
  <p class="sub">${esc(tr("privS.sub"))}</p>
  <p style="margin-top:16px"><a class="btn ghost" href="${urlFor(lang, "privacy")}">${esc(tr("privS.readFull"))}</a></p>
</section>

<footer class="wrap">
  <div>${esc(tr("foot.left"))}</div>
  <div>${esc(tr("foot.right"))}</div>
</footer>
</body>
</html>
`;
}

// ---- privacy template -----------------------------------------------------------------------
const PRIVACY_CSS = readFileSync(join(dir, "privacy.html"), "utf8")
  .match(/<style>([\s\S]*?)<\/style>/)[1];

function privacyPage(lang) {
  const tr = translator(lang);
  const isEn = lang === "en";
  const authNote = isEn ? "" :
    `<div class="disclaimer" style="background:var(--teal-soft);border-color:var(--line)">${esc(tr("privP.authNote"))} <a href="/privacy/">English</a></div>`;
  return `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tr("app.name"))} — ${esc(tr("privP.title"))}</title>
${headMeta(lang, "privacy", tr)}
<style>${PRIVACY_CSS}${LANGBAR_CSS}</style>
</head>
<body>
${switcher(lang, "privacy")}
<div class="wrap">
  <div class="brand"><span class="dot"></span> ${esc(tr("app.name"))}</div>
  <h1>${esc(tr("privP.title"))}</h1>
  <div class="meta">${esc(tr("privP.effective"))} 18 July 2026 · ${esc(tr("privP.version"))}</div>
  ${authNote}
  <div class="disclaimer"><b>${esc(tr("privP.disclaimer"))}</b></div>
  <div class="tldr">${esc(tr("privP.tldr"))}</div>

  <ul class="commitments">
    <li>${esc(tr("privacy.noCollect"))}</li>
    <li>${esc(tr("privacy.onDevice"))}</li>
    <li>${esc(tr("privacy.egress"))}</li>
    <li>${esc(tr("privacy.assets"))}</li>
  </ul>
  <p class="muted">${esc(tr("privacy.legalNote"))}</p>

  <h2><span class="n">1.</span>${esc(tr("privP.h1"))}</h2>
  <p>${esc(tr("privP.b1"))}</p>

  <h2><span class="n">2.</span>${esc(tr("privP.h2"))}</h2>
  <ul>
    <li>${esc(tr("privP.def1"))}</li>
    <li>${esc(tr("privP.def2"))}</li>
    <li>${esc(tr("privP.def3"))}</li>
  </ul>

  <h2><span class="n">3.</span>${esc(tr("privP.h3"))}</h2>
  <p>${esc(tr("privP.b3"))}</p>
  <ol>
    <li>${esc(tr("privP.p3a"))}</li>
    <li>${esc(tr("privP.p3b"))}</li>
    <li>${esc(tr("privP.p3c"))}
      <div class="egress">${esc(tr("privP.egressA"))}</div>
      <div class="egress">${esc(tr("privP.egressB"))}</div>
      ${esc(tr("privP.p3end"))}</li>
  </ol>

  <h2><span class="n">4.</span>${esc(tr("privP.h4"))}</h2>
  <ul>
    <li>${esc(tr("privP.li4a"))}</li>
    <li>${esc(tr("privP.li4b"))}</li>
    <li>${esc(tr("privP.li4c"))}</li>
  </ul>
  <p class="muted">${esc(tr("privP.b4end"))}</p>

  <h2><span class="n">5.</span>${esc(tr("privP.h5"))}</h2>
  <p>${esc(tr("privP.b5"))}</p>

  <h2><span class="n">6.</span>${esc(tr("privP.h6"))}</h2>
  <ul>
    <li>${esc(tr("privP.li6a"))}</li>
    <li>${esc(tr("privP.li6b"))}</li>
    <li>${esc(tr("privP.li6c"))}</li>
  </ul>

  <h2><span class="n">7.</span>${esc(tr("privP.h7"))}</h2>
  <p>${esc(tr("privP.b7"))}</p>

  <h2><span class="n">8.</span>${esc(tr("privP.h8"))}</h2>
  <p>${esc(tr("privP.b8"))}</p>

  <h2><span class="n">9.</span>${esc(tr("privP.h9"))}</h2>
  <p>${esc(tr("privP.b9"))}</p>

  <h2><span class="n">10.</span>${esc(tr("privP.h10"))}</h2>
  <p>${esc(tr("privP.b10"))}</p>

  <h2><span class="n">11.</span>${esc(tr("privP.h11"))}</h2>
  <p>${esc(tr("privP.b11"))}</p>

  <hr>
  <footer>${esc(tr("privP.footer"))}</footer>
  <p style="margin-top:20px"><a href="${urlFor(lang, "landing")}">${esc(tr("privP.backHome"))}</a></p>
</div>
</body>
</html>
`;
}

// ---- install template -----------------------------------------------------------------------
// NOTE: INSTALL_CSS is read back from the previously-built install page, then LANGBAR_CSS is
// re-appended below (`<style>${INSTALL_CSS}${LANGBAR_CSS}</style>`). Strip any LANGBAR_CSS already
// present so repeated builds don't accumulate duplicate copies (they did — up to 14 stale blocks).
const INSTALL_CSS = readFileSync(join(site, "install", "index.html"), "utf8")
  .match(/<style>([\s\S]*?)<\/style>/)[1]
  .split(LANGBAR_CSS).join("");
// version badges from the ACTUAL builds (no manual drift per release)
let EXT_VER = "1.0.1", APP_VER = "1.0.0";
try {
  const root = join(dir, "..", "..");
  EXT_VER = JSON.parse(readFileSync(join(root, "apps", "extension", "manifest.json"), "utf8")).version || EXT_VER;
  const tauri = JSON.parse(readFileSync(join(root, "apps", "app", "src-tauri", "tauri.conf.json"), "utf8"));
  APP_VER = tauri.version || (tauri.package && tauri.package.version) || APP_VER;
} catch (e) { console.warn("install version read skipped:", e.message); }

// Is the published Windows installer CA-signed? Driven off the release manifest's `signed` field
// (set by `release-manifest.mjs --signed` only when actually signed — ADR-0026). When true the
// install page drops the "expect a SmartScreen warning" heads-up for a "digitally signed" note.
let SIGNED = false;
try { SIGNED = !!JSON.parse(readFileSync(join(site, "download", "release-manifest.json"), "utf8")).signed; } catch { /* no manifest yet */ }

const INSTALL_SCRIPT = readFileSync(join(site, "install", "index.html"), "utf8")
  .match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

function installPage(lang) {
  const tr = translator(lang);
  return `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tr("install.title"))}</title>
${headMeta(lang, "install", tr)}
<style>${INSTALL_CSS}${LANGBAR_CSS}</style>
</head>
<body>
${switcher(lang, "install")}
<div class="wrap">
  <p><a href="${urlFor(lang, "landing")}">${esc(tr("install.back"))}</a></p>
  <h1>${esc(tr("install.h1"))}</h1>
  <p class="muted">${esc(tr("install.intro"))}</p>

  <div class="card" id="extension">
    <span class="tag">${esc(tr("install.extTag"))}</span>
    <h2 style="margin-top:0">${esc(tr("install.extH2"))} <span class="ver" data-ver="ext">v${EXT_VER}</span></h2>
    <a class="btn" href="${STORE_URL}" target="_blank" rel="noopener">${esc(tr("get.store"))}</a>
    <a class="btn ghost" href="/dl/ext">${esc(tr("install.extDownload"))}</a>
    <p>${esc(tr("install.extLoad"))}</p>
    <ol>
      <li>${esc(tr("install.extStep1"))}</li>
      <li>${esc(tr("install.extStep2"))}</li>
      <li>${esc(tr("install.extStep3"))}</li>
      <li>${esc(tr("install.extStep4"))}</li>
      <li>${esc(tr("install.extStep5"))}</li>
      <li>${esc(tr("install.extStep6"))}</li>
      <li>${esc(tr("install.extStep7"))}</li>
    </ol>
    <p class="muted">${esc(tr("install.extNote"))}</p>
  </div>

  <div class="card" id="android">
    <span class="tag">📱 ${esc(tr("install.androidTag"))}</span>
    <h2 style="margin-top:0">${esc(tr("install.androidH2"))}</h2>
    <p class="muted">${esc(tr("install.androidIntro"))}</p>
    <ol>
      <li>${esc(tr("install.androidStep1"))}</li>
      <li>${esc(tr("install.androidStep2"))}</li>
      <li>${esc(tr("install.androidStep3"))}</li>
      <li>${esc(tr("install.androidStep4"))}</li>
    </ol>
    <a class="btn" href="/dl/ext">${esc(tr("install.androidDownload"))}</a>
    <p class="muted">${esc(tr("install.androidStoreNote"))}</p>
    <p class="muted">${esc(tr("install.androidDeskNote"))}</p>
  </div>

  <div class="card">
    <span class="tag">${esc(tr("install.wingetTag"))}</span>
    <h2 style="margin-top:0">${esc(tr("install.wingetH2"))}</h2>
    <p>${esc(tr("install.wingetBody"))}</p>
    <pre>winget install SubramanyaMysore.PolyglotFormFill</pre>
    <p class="muted">${esc(tr("install.wingetNote"))}</p>
  </div>

  <div class="card">
    <h2 style="margin-top:0">${esc(tr("install.deskH2"))}
      <span class="ver" data-ver="app">v${APP_VER}</span></h2>

    ${SIGNED ? `<div class="heads">
      <b>${esc(tr("install.signedTitle"))}</b> ${esc(tr("install.signedBody"))}
      <div style="margin-top:8px">${esc(tr("install.smartscreenTip"))}</div>
    </div>` : `<div class="heads">
      <b>${esc(tr("install.headsTitle"))}</b> ${esc(tr("install.headsBody"))}
      <div class="screen">
        <span class="t">${esc(tr("install.screenTitle"))}</span>
        ${esc(tr("install.screenBody"))}
      </div>
      ${esc(tr("install.headsMeans"))}
      <ol>
        <li>${esc(tr("install.headsStep1"))}</li>
        <li>${esc(tr("install.headsStep2"))}</li>
      </ol>
      ${esc(tr("install.headsAfter"))}
    </div>`}

    <a class="btn" href="/dl/exe">${esc(tr("install.deskDownload"))}</a>
    <p class="muted">${esc(tr("install.deskNote"))}</p>

    <details>
      <summary>${esc(tr("install.verifySummary"))}</summary>
      <p class="muted" style="margin-top:10px">${esc(tr("install.verifyBody"))}</p>
      <pre>Get-FileHash .\\PolyglotFormFill-Setup.exe -Algorithm SHA256</pre>
      <p class="muted" style="margin-bottom:4px">${esc(tr("install.verifyHashes"))}
        <span data-manifest="version">${esc(tr("install.verifyThisRelease"))}</span>:</p>
      <div data-manifest="artifacts" class="hash">
        <a href="/download/release-manifest.json">release-manifest.json</a>
      </div>
    </details>
  </div>

  <p class="muted">${esc(tr("install.privacyNote"))}
    <a href="${urlFor(lang, "privacy")}">${esc(tr("install.privacyLink"))}</a>.</p>
</div>
<script>${INSTALL_SCRIPT}</script>
</body>
</html>
`;
}

// ---- write everything -----------------------------------------------------------------------
function out(lang, page, html) {
  const path = lang === "en"
    ? (page === "landing" ? join(site, "index.html")
      : join(site, page, "index.html"))
    : (page === "landing" ? join(site, lang, "index.html")
      : join(site, lang, page, "index.html"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

for (const lang of AVAILABLE) {
  out(lang, "landing", landingPage(lang));
  out(lang, "privacy", privacyPage(lang));
  out(lang, "install", installPage(lang));
}

// A tiny localised-aware 404 that sends visitors home.
writeFileSync(
  join(site, "404.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — PolyglotFormFill</title></head>
<body style="font-family:system-ui;padding:40px"><h1>404</h1>
<p><a href="/">Back to PolyglotFormFill</a></p></body></html>`,
);

// SEO: sitemap.xml (every page × every language, with hreflang alternates) + robots.txt.
const SITEMAP_PAGES = ["landing", "install", "privacy"];
const sitemapUrls = AVAILABLE.flatMap((lang) =>
  SITEMAP_PAGES.map((page) => {
    const loc = `${SITE_ORIGIN}${urlFor(lang, page)}`;
    const alts = AVAILABLE
      .map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${SITE_ORIGIN}${urlFor(code, page)}"/>`)
      .join("\n");
    return `  <url>\n    <loc>${loc}</loc>\n${alts}\n    <changefreq>weekly</changefreq>\n  </url>`;
  }),
).join("\n");
writeFileSync(
  join(site, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sitemapUrls}\n</urlset>\n`,
);
writeFileSync(
  join(site, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
);

// Static root passthrough: anything under docs/marketing/well-known/ is copied verbatim to the site
// root (preserving subdirs like .well-known/). This is how we host ownership-proof and trust files
// REPRODUCIBLY, so they survive every rebuild: Google Search Console's googleXXeXX.html verification
// file (needed to see + appeal the Chrome "Virus detected" Safe Browsing verdict), .well-known/
// security.txt, Bing's BingSiteAuth.xml, etc. Drop the file in, publish, done.
const wellKnown = join(dir, "well-known");
let staticCount = 0;
if (existsSync(wellKnown)) {
  for (const f of readdirSync(wellKnown)) {
    cpSync(join(wellKnown, f), join(site, f), { recursive: true });
    staticCount++;
  }
}

console.log(`install page versions: extension v${EXT_VER}, desktop v${APP_VER}`);
console.log(`wrote ${AVAILABLE.length} languages × {landing, privacy, install} + 404 + sitemap.xml + robots.txt + ${staticCount} static-root entries`);
