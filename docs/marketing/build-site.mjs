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

// A tiny 404 that sends visitors home.
writeFileSync(
  join(site, "404.html"),
  wrap('<title>Not found — PolyglotFormFill</title>\n</head>\n<body style="font-family:system-ui;padding:40px"><h1>404</h1><p><a href="/">Back to PolyglotFormFill</a></p>'),
);

console.log("wrote site/index.html, site/privacy/index.html, site/404.html");
