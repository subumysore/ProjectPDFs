// Regression suite for on-device language detection (lang.js) — drives the
// auto-translate-on-fill and "view in my language" features.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLang } from "./lang.js";

const cases = [
  ["hi", "पूरा नाम पता जन्म तिथि"],
  ["es", "Nombre completo Dirección Fecha de nacimiento"],
  ["fr", "Nom complet Adresse Date de naissance"],
  ["de", "Vollständiger Name Adresse Geburtsdatum"],
  ["zh", "全名 地址 出生日期"],
  ["ar", "الاسم الكامل العنوان تاريخ الميلاد"],
  ["ru", "Полное имя Адрес Дата рождения"],
  ["en", "Full name Address Date of birth"],
];

for (const [expected, text] of cases) {
  test(`detectLang: ${expected}`, () => {
    assert.equal(detectLang(text).lang, expected);
  });
}
