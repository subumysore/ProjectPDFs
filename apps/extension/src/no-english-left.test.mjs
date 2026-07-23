// A button in English inside an otherwise-translated screen is the failure the user actually
// notices: the interface looks like theirs until the moment they have to act. This test walks the
// popup markup and the desktop's App.tsx and fails on any BUTTON, LABEL or PLACEHOLDER that is
// hard-coded English rather than coming from the catalogue.
//
// It is deliberately narrow: prose can be added to the catalogue over time, but a CONTROL the user
// must click or type into has to be in their language on the day it ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const popup = readFileSync(join(here, "..", "popup.html"), "utf8");
const app = readFileSync(join(here, "..", "..", "app", "src", "App.tsx"), "utf8");

// Words that are the same in every language, or are proper nouns / units, need no translation.
const UNIVERSAL = /^(polyglotformfill|pdf|ocr|id|windows|chrome|edge|ppdf1|t|×|✕|✓|—|·|\W|\d)+$/i;

test("no button in the extension popup is hard-coded English", () => {
  const offenders = [];
  for (const m of popup.matchAll(/<button([^>]*)>([^<]+)<\/button>/g)) {
    const [, attrs, text] = m;
    const label = text.trim();
    if (!label || UNIVERSAL.test(label)) continue;
    if (/data-i18n/.test(attrs)) continue;
    offenders.push(label);
  }
  assert.deepEqual(offenders, [], `these popup buttons are still English: ${offenders.join(" | ")}`);
});

test("no input placeholder in the popup is hard-coded English", () => {
  const offenders = [];
  for (const m of popup.matchAll(/<input([^>]*)>/g)) {
    const attrs = m[1];
    const ph = /placeholder="([^"]+)"/.exec(attrs);
    if (!ph) continue;
    if (/data-i18n-placeholder/.test(attrs)) continue;
    if (UNIVERSAL.test(ph[1].trim())) continue;
    offenders.push(ph[1]);
  }
  assert.deepEqual(offenders, [], `these popup placeholders are still English: ${offenders.join(" | ")}`);
});

test("no button in the desktop app is hard-coded English", () => {
  const offenders = [];
  for (const m of app.matchAll(/>([A-Za-z][A-Za-z ',&/-]{2,40})<\/button>/g)) {
    const label = m[1].trim();
    if (!label || UNIVERSAL.test(label)) continue;
    offenders.push(label);
  }
  assert.deepEqual(offenders, [], `these desktop buttons are still English: ${offenders.join(" | ")}`);
});
