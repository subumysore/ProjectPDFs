// Tests for the pure OCR-translate orchestrator (buildTranslationDoc). The OCR/render glue
// needs a browser; the dedupe + translate + reassemble logic is pure and tested here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranslationDoc } from "./pdftranslate.js";

const echo = (t, from, to) => Promise.resolve(`${t} [${from}->${to}]`);

test("translates each unique line once and reassembles per page", async () => {
  let calls = 0;
  const count = (t, f, to) => { calls++; return echo(t, f, to); };
  const pages = [{ page: 1, lines: ["Full name", "Address", "Full name"] }, { page: 2, lines: ["Address"] }];
  const doc = await buildTranslationDoc(pages, count, "hi", "en");
  assert.equal(calls, 2); // "Full name" + "Address" translated once each (deduped)
  assert.equal(doc.pages[0].lines[0].tr, "Full name [en->hi]");
  assert.equal(doc.pages[0].lines[2].tr, "Full name [en->hi]"); // reused
  assert.equal(doc.pages[1].lines[0].tr, "Address [en->hi]");
});

test("when source==target, lines pass through untranslated", async () => {
  let calls = 0;
  const doc = await buildTranslationDoc([{ page: 1, lines: ["Hello"] }], () => { calls++; return echo("x", "x", "x"); }, "en", "en");
  assert.equal(calls, 0);
  assert.equal(doc.pages[0].lines[0].tr, "Hello");
});

test("blank/1-char lines are ignored for translation but kept in output", async () => {
  const doc = await buildTranslationDoc([{ page: 1, lines: ["Name", "", "x"] }], echo, "es", "en");
  assert.equal(doc.pages[0].lines[0].tr, "Name [en->es]");
  assert.equal(doc.pages[0].lines[1].tr, ""); // blank stays blank
});
