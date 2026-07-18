import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { fillDocx, fillXlsx } from "./office.ts";

const vault = { full_name: "Asha Rao", date_of_birth: "1990-01-15" };

function docxFixture() {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:sdt><w:sdtPr><w:alias w:val="Full name"/><w:tag w:val="full_name"/><w:text/></w:sdtPr>
<w:sdtContent><w:r><w:t>Click to enter name</w:t></w:r></w:sdtContent></w:sdt></w:p>
<w:p><w:sdt><w:sdtPr><w:alias w:val="Date of birth"/><w:tag w:val="date_of_birth"/><w:text/></w:sdtPr>
<w:sdtContent><w:r><w:t>dd-mm-yyyy</w:t></w:r></w:sdtContent></w:sdt></w:p>
</w:body></w:document>`;
  return zipSync({ "word/document.xml": strToU8(doc) }).buffer;
}

function xlsxFixture() {
  const wb = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="full_name">Sheet1!$B$2</definedName></definedNames></workbook>`;
  const rels = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="2"><c r="A2" t="inlineStr"><is><t>Full name</t></is></c></row></sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(wb),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  }).buffer;
}

test("fillDocx fills content controls from the vault", () => {
  const r = fillDocx(docxFixture(), vault);
  assert.equal(r.created, 2);
  assert.equal(r.filled, 2);
  const xml = strFromU8(unzipSync(r.data)["word/document.xml"]);
  assert.match(xml, /Asha Rao/);
  assert.match(xml, /1990-01-15/);
  assert.doesNotMatch(xml, /Click to enter name/); // placeholder replaced
});

test("fillDocx leaves unknown-key controls untouched and reports them", () => {
  const r = fillDocx(docxFixture(), { full_name: "Asha Rao" }); // no DOB in vault
  assert.equal(r.created, 2);
  assert.equal(r.filled, 1);
  const dob = r.fields.find((f) => f.ontology_key === "date_of_birth");
  assert.equal(dob.value, null);
});

test("fillXlsx writes a named-range cell as an inline string", () => {
  const r = fillXlsx(xlsxFixture(), vault);
  assert.equal(r.created, 1);
  assert.equal(r.filled, 1);
  const xml = strFromU8(unzipSync(r.data)["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /r="B2"/);
  assert.match(xml, /Asha Rao/);
});

// ---- Phase B: flat documents (no named regions) ----

function flatDocxFixture() {
  // A table: label cell "Full name" | empty cell; and a "Nationality:" paragraph.
  const doc = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:tbl><w:tr>
<w:tc><w:p><w:r><w:t>Full name</w:t></w:r></w:p></w:tc>
<w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>
</w:tr></w:tbl>
<w:p><w:r><w:t>Nationality: ____</w:t></w:r></w:p>
</w:body></w:document>`;
  return zipSync({ "word/document.xml": strToU8(doc) }).buffer;
}

function flatXlsxFixture() {
  const wb = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  // A1 = shared string "Full name" (index 0); B1 empty.
  const sst = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Full name</t></si></sst>`;
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`;
  return zipSync({
    "xl/workbook.xml": strToU8(wb),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
    "xl/sharedStrings.xml": strToU8(sst),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  }).buffer;
}

test("fillDocx flat: table label→next cell + Label: paragraph", () => {
  const r = fillDocx(flatDocxFixture(), { full_name: "Asha Rao", nationality: "Indian" });
  assert.equal(r.filled, 2);
  const xml = strFromU8(unzipSync(r.data)["word/document.xml"]);
  assert.match(xml, /Asha Rao/);
  assert.match(xml, /Indian/);
});

test("fillXlsx flat: label cell fills right neighbour", () => {
  const r = fillXlsx(flatXlsxFixture(), { full_name: "Asha Rao" });
  assert.equal(r.filled, 1);
  const xml = strFromU8(unzipSync(r.data)["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /r="B1"/);
  assert.match(xml, /Asha Rao/);
});
