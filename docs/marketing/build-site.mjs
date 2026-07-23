// Build a deployable static site from the artifact-style marketing pages.
// The landing/privacy files contain a <title> + <style> + body markup (authored for
// the Artifact wrapper). This wraps each into a complete, standalone HTML document
// and writes them to docs/marketing/site/ ready for Cloudflare Pages / Netlify /
// GitHub Pages. No build tools, no external requests.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const site = join(dir, "site");
mkdirSync(join(site, "privacy"), { recursive: true });

function wrap(inner) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${inner.trim()}
</body>
</html>
`;
}
// The source files are "<title>…</title>\n<style>…</style>\n<body markup>".
// We move </head> after the </style> and open <body> before the markup.
function toDoc(src) {
  const styleEnd = src.indexOf("</style>");
  const head = src.slice(0, styleEnd + "</style>".length);
  const body = src.slice(styleEnd + "</style>".length);
  return wrap(`${head}\n</head>\n<body>\n${body}`);
}

const landing = readFileSync(join(dir, "landing.html"), "utf8")
  // point the "full privacy policy" button at the hosted privacy page
  .replace('href="#">Read the full privacy policy', 'href="/privacy/">Read the full privacy policy');
const privacy = readFileSync(join(dir, "privacy.html"), "utf8");

writeFileSync(join(site, "index.html"), toDoc(landing));
writeFileSync(join(site, "privacy", "index.html"), toDoc(privacy));

// Keep the install page's version badges in sync with the ACTUAL builds — read the versions
// from the extension manifest + the Tauri config and inject them (no manual drift per release).
try {
  const root = join(dir, "..", "..");
  const extVer = JSON.parse(readFileSync(join(root, "apps", "extension", "manifest.json"), "utf8")).version;
  const tauri = JSON.parse(readFileSync(join(root, "apps", "app", "src-tauri", "tauri.conf.json"), "utf8"));
  const appVer = tauri.version || (tauri.package && tauri.package.version) || "0.0.0";
  const installPath = join(site, "install", "index.html");
  let html = readFileSync(installPath, "utf8");
  html = html.replace(/(<span class="ver" data-ver="ext">)[^<]*(<\/span>)/, `$1v${extVer}$2`);
  html = html.replace(/(<span class="ver" data-ver="app">)[^<]*(<\/span>)/, `$1v${appVer}$2`);
  writeFileSync(installPath, html);
  console.log(`install page versions injected — extension v${extVer}, desktop v${appVer}`);
} catch (e) { console.warn("install-page version injection skipped:", e.message); }

// ---- Localised pages: /<lang>/ for every language in the shared catalogue -------------------
// The site speaks the same catalogue as the extension and the desktop app, so a visitor reads the
// product in their own language BEFORE they install anything. The rich English landing page keeps
// its long-form copy; each localised page is generated wholly from translated strings, so there
// is never a page that is half in the visitor's language and half in English.
const { UI_LANGS, AVAILABLE, translator, dirOf } = await import(
  new URL("../../apps/extension/src/i18n.js", import.meta.url)
);

function switcher(current) {
  const opts = Object.entries(UI_LANGS)
    .map(([code, label]) =>
      `<option value="${code}"${code === current ? " selected" : ""}>${label}</option>`)
    .join("");
  // Plain navigation, no framework: choosing a language goes to that language's page.
  return `<nav class="langbar"><label for="lang">🌐</label><select id="lang" onchange="location.href=this.value==='en'?'/':'/'+this.value+'/'">${opts}</select></nav>`;
}

const CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font:16px/1.6 system-ui,"Noto Sans","Noto Sans Devanagari","Noto Sans Tamil","Noto Sans Arabic",sans-serif;margin:0;color:#101a20;background:#fff}
.wrap{max-width:720px;margin:0 auto;padding:32px 20px 64px}
.langbar{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:12px 20px;border-bottom:1px solid #e9eeee}
.langbar select{font:inherit;padding:4px 8px}
h1{font-size:30px;line-height:1.25;margin:24px 0 8px}
h2{font-size:20px;margin:32px 0 6px}
p{margin:8px 0}
.lede{font-size:18px;color:#33474f}
.cta{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}
.btn{display:inline-block;padding:12px 18px;border-radius:10px;background:#0d8f83;color:#fff;text-decoration:none;font-weight:600}
.btn.alt{background:#eef6f5;color:#0a6a60}
.note{color:#55666f;font-size:14px}
footer{margin-top:40px;border-top:1px solid #e9eeee;padding-top:16px;font-size:14px}
[dir=rtl] .langbar{justify-content:flex-start}
@media (prefers-color-scheme:dark){body{background:#0f1417;color:#e8eef0}.lede{color:#a8bcc2}.langbar{border-color:#222c31}.btn.alt{background:#16232a;color:#7fd8ce}footer{border-color:#222c31}}
`;

for (const lang of AVAILABLE) {
  if (lang === "en") continue; // English keeps the full hand-written landing page
  const tr = translator(lang);
  const page = `<!doctype html>
<html lang="${lang}" dir="${dirOf(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tr("app.name")} — ${tr("app.tagline")}</title>
<meta name="description" content="${tr("privacy.headline")}">
<style>${CSS}</style>
</head>
<body>
${switcher(lang)}
<div class="wrap">
  <h1>${tr("app.name")}</h1>
  <p class="lede">${tr("app.tagline")}</p>
  <div class="cta">
    <a class="btn" href="/download/PolyglotFormFill-Setup.exe">${tr("site.download")} — ${tr("site.forWindows")}</a>
    <a class="btn alt" href="/install/">${tr("site.install")} — ${tr("site.forChrome")}</a>
  </div>
  <h2>${tr("privacy.headline")}</h2>
  <p>${tr("privacy.body")}</p>
  <p class="note">${tr("lang.hint")}</p>
  <footer>
    <p class="note">${tr("site.langNote")}</p>
    <p><a href="/privacy/">${tr("site.privacyPolicy")}</a> · <a href="/">English</a></p>
    <p class="note">${tr("privacy.legalNote")}</p>
  </footer>
</div>
</body>
</html>
`;
  mkdirSync(join(site, lang), { recursive: true });
  writeFileSync(join(site, lang, "index.html"), page);
}
console.log(`wrote ${AVAILABLE.length - 1} localised landing pages (/<lang>/)`);

// The English landing page gets the same switcher, plus a one-line hint that sends a visitor whose
// browser asks for another language to their own page. It only ever SUGGESTS — it never redirects
// automatically, because a silent redirect strands anyone who wanted the English page.
try {
  const p = join(site, "index.html");
  let html = readFileSync(p, "utf8");
  const bar = `<style>${CSS.split("\n").filter((l) => l.startsWith(".langbar")).join("\n")}</style>${switcher("en")}
<div id="langhint" hidden style="padding:10px 20px;background:#eef6f5;font:15px system-ui"></div>
<script>
(function(){
  var have=${JSON.stringify(AVAILABLE)}, names=${JSON.stringify(UI_LANGS)};
  var prefs=(navigator.languages||[navigator.language||"en"]).map(function(x){return String(x).toLowerCase()});
  for (var i=0;i<prefs.length;i++){
    var tag=prefs[i], base=tag.split("-")[0];
    var hit=have.indexOf(tag)>=0?tag:(have.indexOf(base)>=0?base:null);
    if(hit&&hit!=="en"){
      var el=document.getElementById("langhint");
      el.innerHTML='<a href="/'+hit+'/">'+names[hit]+'</a>';
      el.hidden=false;
      var sel=document.getElementById("lang"); if(sel) sel.value="en";
      break;
    }
  }
})();
</script>`;
  html = html.replace("<body>", "<body>\n" + bar);
  writeFileSync(p, html);
  console.log("English landing page: language switcher + own-language hint added");
} catch (e) { console.warn("landing switcher skipped:", e.message); }

// A tiny 404 that sends visitors home.
writeFileSync(
  join(site, "404.html"),
  wrap('<title>Not found — PolyglotFormFill</title>\n</head>\n<body style="font-family:system-ui;padding:40px"><h1>404</h1><p><a href="/">Back to PolyglotFormFill</a></p>'),
);

console.log("wrote site/index.html, site/privacy/index.html, site/404.html");
