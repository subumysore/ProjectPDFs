// Education parsing: comma-list vault keys (masters/bachelors) → structured entries, classified by
// pattern (order-independent), and routed to the right form block by section context.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyToken, levelOf, parseEducation, entryForContext } from "./education.js";

test("classifyToken recognises degree / field / school / year / GPA regardless of order", () => {
  assert.equal(classifyToken("MS").kind, "degree");
  assert.equal(classifyToken("Master's").kind, "degree");
  assert.equal(classifyToken("Computer Science").kind, "field");
  assert.equal(classifyToken("Stanford University").kind, "school");
  assert.equal(classifyToken("BMS College of Engineering").kind, "school");
  assert.equal(classifyToken("2015").kind, "year");
  assert.equal(classifyToken("2011-2015").kind, "year");
  assert.equal(classifyToken("2011-2015").value, "2015"); // graduation (end) year
  assert.equal(classifyToken("3.8").kind, "gpa");
  assert.equal(classifyToken("3.8/4.0").kind, "gpa");
  assert.equal(classifyToken("85%").kind, "gpa");
  assert.equal(classifyToken("First Class").kind, "gpa");
});

test("levelOf maps vault keys and headings to a canonical level", () => {
  assert.equal(levelOf("masters"), "master");
  assert.equal(levelOf("Master's Degree"), "master");
  assert.equal(levelOf("bachelors"), "bachelor");
  assert.equal(levelOf("Post Graduate"), "master");
  assert.equal(levelOf("PhD"), "doctorate");
  assert.equal(levelOf("random text"), null);
});

test("parseEducation builds structured entries from comma lists, highest level first", () => {
  const entries = parseEducation({
    masters: "MS, Computer Science, Stanford University, 2015, 3.8",
    bachelors: "BS, Electronics, BMS College, 2013, 3.7",
    email_address: "x@y.com",
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, "master"); // highest first
  assert.deepEqual(
    { degree: entries[0].degree, field: entries[0].field, school: entries[0].school, year: entries[0].year, gpa: entries[0].gpa },
    { degree: "MS", field: "Computer Science", school: "Stanford University", year: "2015", gpa: "3.8" },
  );
  assert.equal(entries[1].level, "bachelor");
  assert.equal(entries[1].school, "BMS College");
});

test("order does not matter — same result when parts are shuffled", () => {
  const a = parseEducation({ masters: "MS, Computer Science, Stanford University, 2015" })[0];
  const b = parseEducation({ masters: "2015, Stanford University, MS, Computer Science" })[0];
  assert.equal(a.degree, b.degree);
  assert.equal(a.school, b.school);
  assert.equal(a.year, b.year);
  assert.equal(a.field, b.field);
});

test("entryForContext routes a field to the block that matches its section heading", () => {
  const entries = parseEducation({
    masters: "MS, Computer Science, Stanford University, 2015",
    bachelors: "BS, Electronics, BMS College, 2013",
  });
  assert.equal(entryForContext(entries, "Master's Degree — Institution").level, "master");
  assert.equal(entryForContext(entries, "Undergraduate university").level, "bachelor");
  assert.equal(entryForContext(entries, "no hint here").level, "master"); // highest by default
});
