// The site must speak every language the product speaks. A visitor who cannot read the download
// page never gets as far as the app, so this is the first surface, not the last.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AVAILABLE, UI_LANGS, RTL, translator } from "../apps/extension/src/i18n.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "docs", "marketing", "site");

test("every catalogue language has a built landing page", () => {
  for (const lang of AVAILABLE) {
    if (lang === "en") continue;
    const p = join(site, lang, "index.html");
    assert.ok(existsSync(p), `/${lang}/ was not generated — run docs/marketing/build-site.mjs`);
  }
});

test("each localised page is actually in that language, and declares it", () => {
  for (const lang of AVAILABLE) {
    if (lang === "en") continue;
    const html = readFileSync(join(site, lang, "index.html"), "utf8");
    const tr = translator(lang);
    assert.ok(html.includes(`lang="${lang}"`), `/${lang}/ does not declare lang="${lang}"`);
    assert.ok(html.includes(tr("app.tagline")), `/${lang}/ is missing the translated tagline`);
    assert.ok(html.includes(tr("privacy.headline")), `/${lang}/ is missing the translated privacy headline`);
    assert.ok(html.includes(tr("site.download")), `/${lang}/ is missing the translated download label`);
    // The English tagline must NOT appear — that would mean a half-translated page.
    assert.ok(!html.includes("Fill any form, in any language, privately on your device."),
      `/${lang}/ still shows the English tagline`);
  }
});

test("every language also gets a privacy page it can actually read", () => {
  for (const lang of AVAILABLE) {
    if (lang === "en") continue;
    const p = join(site, lang, "privacy", "index.html");
    assert.ok(existsSync(p), `/${lang}/privacy/ was not generated`);
    const html = readFileSync(p, "utf8");
    const tr = translator(lang);
    // The four commitments, in their language.
    for (const k of ["privacy.noCollect", "privacy.onDevice", "privacy.egress", "privacy.assets"]) {
      assert.ok(html.includes(tr(k)), `/${lang}/privacy/ is missing ${k}`);
    }
    // And it must SAY that the binding legal text is English rather than implying otherwise.
    assert.ok(html.includes(tr("privacy.legalNote")), `/${lang}/privacy/ does not say the legal text is English`);
    assert.ok(html.includes('href="/privacy/"'), `/${lang}/privacy/ does not link to the English text`);
  }
});

test("a localised landing page links to the privacy page in the SAME language", () => {
  const html = readFileSync(join(site, "ja", "index.html"), "utf8");
  assert.ok(html.includes('href="/ja/privacy/"'), "the Japanese page sends readers to the English privacy page");
});

test("right-to-left languages render right-to-left", () => {
  for (const lang of RTL) {
    if (!AVAILABLE.includes(lang)) continue;
    const html = readFileSync(join(site, lang, "index.html"), "utf8");
    assert.ok(html.includes('dir="rtl"'), `/${lang}/ must set dir="rtl"`);
  }
});

test("every localised page offers every other language", () => {
  const html = readFileSync(join(site, "ta", "index.html"), "utf8");
  for (const [code, label] of Object.entries(UI_LANGS)) {
    assert.ok(html.includes(`value="${code}"`), `the picker is missing ${code}`);
    assert.ok(html.includes(label), `the picker does not label ${code} in its own language`);
  }
});

test("the English page offers the switcher and suggests the visitor's own language", () => {
  const html = readFileSync(join(site, "index.html"), "utf8");
  assert.ok(html.includes('id="lang"'), "the English page has no language picker");
  assert.ok(html.includes("navigator.languages"), "the English page does not detect the visitor's language");
  assert.ok(html.includes('id="langhint"'), "the English page has no own-language hint");
  // It must SUGGEST, never redirect: an automatic redirect strands anyone who wanted English.
  assert.ok(!/location\.(replace|href)\s*=\s*["']\/(?!'\+)/.test(html.replace(/onchange="[^"]*"/g, "")),
    "the English page must not auto-redirect");
});

test("download links on a localised page reach the installer (directly or via the counted /dl route)", () => {
  const html = readFileSync(join(site, "hi", "index.html"), "utf8");
  // The primary download button now goes through /dl/exe (self-hosted counter → 302 to the installer)
  // so downloads are tallied; the direct /download/… link is still valid where hashing is shown.
  assert.ok(html.includes("/dl/exe") || html.includes("/download/PolyglotFormFill-Setup.exe"), "installer link missing");
  assert.ok(html.includes("/install/"), "extension install link missing");
});
