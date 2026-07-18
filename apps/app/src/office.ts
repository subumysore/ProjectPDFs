import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

// RFC-0002 Phase A: fill NAMED fillable regions in Office forms, on-device.
//   .docx → Word content controls (w:sdt): match tag/alias → ontology key → set text.
//   .xlsx → Excel named ranges (definedName): resolve to a cell → set its value.
// OOXML is a ZIP of XML, so we unzip (fflate), edit the XML (fast-xml-parser,
// order-preserving round-trip), and re-zip. No Office runtime, no server, no upload.
// This is the clean, high-fidelity path; flat-document detection is Phase B.

export type OfficeKind = "docx" | "xlsx";

export interface OfficeFillResult {
  created: number; // named regions found + mapped to an ontology key
  filled: number; // of those, how many had a vault value written
  data: Uint8Array; // the filled .docx/.xlsx
  fields: Array<{ name: string; ontology_key: string; value: string | null }>;
}

// Map a content-control tag/alias or named-range name to an ontology key.
// If it already IS a vault key, use it; else match common labels.
const HINTS: Array<[RegExp, string]> = [
  [/full[\s_]*name|^name$/i, "full_name"],
  [/date[\s_]*of[\s_]*birth|dob|birth/i, "date_of_birth"],
  [/nationalit/i, "nationality"],
  [/passport/i, "passport_no"],
  [/phone|mobile|contact/i, "phone"],
  [/address/i, "address"],
];

function nameToKey(raw: string, vault: Record<string, string>): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  const norm = t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (norm in vault) return norm;
  for (const [re, key] of HINTS) if (re.test(t)) return key;
  return null;
}

const XML_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  allowBooleanAttributes: true,
  processEntities: true,
  trimValues: false,
  suppressEmptyNode: false,
} as const;

const parser = new XMLParser(XML_OPTS);
const builder = new XMLBuilder(XML_OPTS);

// preserveOrder nodes look like { "tag": [children], ":@": { "@_attr": val } }.
// Text nodes look like { "#text": "…" }.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = Record<string, any>;

function tagOf(node: Node): string | null {
  for (const k of Object.keys(node)) if (k !== ":@" && k !== "#text") return k;
  return null;
}
function attr(node: Node, name: string): string | undefined {
  return node[":@"]?.[`@_${name}`];
}

// Depth-first: collect every node whose tag === name.
function findAll(nodes: Node[], name: string, out: Node[] = []): Node[] {
  for (const n of nodes) {
    const t = tagOf(n);
    if (t === name) out.push(n);
    if (t && Array.isArray(n[t])) findAll(n[t], name, out);
  }
  return out;
}
function firstChildTag(node: Node, name: string): Node | undefined {
  const t = tagOf(node);
  if (!t || !Array.isArray(node[t])) return undefined;
  return node[t].find((c: Node) => tagOf(c) === name);
}
// Recursively concatenate all text under a node.
function textOf(node: Node): string {
  let s = node["#text"] !== undefined ? String(node["#text"]) : "";
  const t = tagOf(node);
  if (t && Array.isArray(node[t])) for (const c of node[t]) s += textOf(c);
  return s;
}
// Direct children nodes with the given tag (non-recursive).
function childrenTag(node: Node, name: string): Node[] {
  const t = tagOf(node);
  if (!t || !Array.isArray(node[t])) return [];
  return node[t].filter((c: Node) => tagOf(c) === name);
}

// ---------------- DOCX: Word content controls (w:sdt) ----------------
export function fillDocx(bytes: ArrayBuffer, vault: Record<string, string>): OfficeFillResult {
  const zip = unzipSync(new Uint8Array(bytes));
  const path = "word/document.xml";
  if (!zip[path]) throw new Error("Not a Word document (no word/document.xml).");
  const tree: Node[] = parser.parse(strFromU8(zip[path]));

  const fields: OfficeFillResult["fields"] = [];
  let created = 0;
  let filled = 0;

  for (const sdt of findAll(tree, "w:sdt")) {
    const pr = firstChildTag(sdt, "w:sdtPr");
    if (!pr) continue;
    const tagNode = firstChildTag(pr, "w:tag");
    const aliasNode = firstChildTag(pr, "w:alias");
    const rawName = attr(tagNode ?? {}, "w:val") ?? attr(aliasNode ?? {}, "w:val") ?? "";
    const key = nameToKey(rawName, vault);
    if (!key) continue;
    created++;
    const value = vault[key];
    fields.push({ name: rawName || key, ontology_key: key, value: value ?? null });
    if (value === undefined) continue;

    const content = firstChildTag(sdt, "w:sdtContent");
    if (!content) continue;
    const tNodes = findAll([content], "w:t");
    const first = tNodes[0];
    if (!first) continue;
    // Write into the first w:t, clear any others so no placeholder remains.
    first["w:t"] = [{ "#text": value }];
    for (let i = 1; i < tNodes.length; i++) {
      const t = tNodes[i];
      if (t) t["w:t"] = [{ "#text": "" }];
    }
    filled++;
  }

  // Phase B fallback: no named content controls → detect flat labels.
  if (created === 0) {
    const flat = fillDocxFlat(tree, vault);
    created += flat.created;
    filled += flat.filled;
    fields.push(...flat.fields);
  }

  zip[path] = strToU8(builder.build(tree));
  return { created, filled, data: zipSync(zip), fields };
}

// Write a value into a table cell (w:tc): reuse its first w:t, else append a run.
function setCellTextDocx(tc: Node, value: string): void {
  const tNodes = findAll([tc], "w:t");
  const first = tNodes[0];
  if (first) {
    first["w:t"] = [{ "#text": value }];
    for (let i = 1; i < tNodes.length; i++) {
      const t = tNodes[i];
      if (t) t["w:t"] = [{ "#text": "" }];
    }
    return;
  }
  const p = firstChildTag(tc, "w:p");
  const run: Node = { "w:r": [{ "w:t": [{ "#text": value }], ":@": { "@_xml:space": "preserve" } }] };
  if (p && Array.isArray(p["w:p"])) p["w:p"].push(run);
  else if (Array.isArray(tc["w:tc"])) tc["w:tc"].push({ "w:p": [run] });
}

// Flat DOCX detection (Phase B): table label→next cell, and "Label:" paragraphs.
function fillDocxFlat(tree: Node[], vault: Record<string, string>) {
  const fields: OfficeFillResult["fields"] = [];
  let created = 0;
  let filled = 0;
  const used = new Set<string>();

  // 1) Tables: a label cell fills the NEXT cell in its row.
  for (const tbl of findAll(tree, "w:tbl")) {
    for (const tr of findAll([tbl], "w:tr")) {
      const cells = childrenTag(tr, "w:tc");
      for (let i = 0; i < cells.length - 1; i++) {
        const cell = cells[i];
        if (!cell) continue;
        const label = textOf(cell).trim();
        const key = nameToKey(label, vault);
        if (!key || used.has(key)) continue;
        const value = vault[key];
        if (value === undefined) continue;
        const target = cells[i + 1];
        if (!target) continue;
        setCellTextDocx(target, value);
        used.add(key);
        created++;
        filled++;
        fields.push({ name: label, ontology_key: key, value });
      }
    }
  }

  // 2) Paragraphs shaped like "Full name: ____" → append the value inline.
  for (const p of findAll(tree, "w:p")) {
    const text = textOf(p).trim();
    const m = /^(.{1,40}?)[:：]\s*_*\s*$/.exec(text);
    if (!m || !m[1]) continue;
    const key = nameToKey(m[1], vault);
    if (!key || used.has(key)) continue;
    const value = vault[key];
    if (value === undefined) continue;
    if (Array.isArray(p["w:p"])) {
      p["w:p"].push({ "w:r": [{ "w:t": [{ "#text": ` ${value}` }], ":@": { "@_xml:space": "preserve" } }] });
      used.add(key);
      created++;
      filled++;
      fields.push({ name: m[1].trim(), ontology_key: key, value });
    }
  }

  return { created, filled, fields };
}

// ---------------- XLSX: Excel named ranges (definedName) ----------------
function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n; // 1-based
}

export function fillXlsx(bytes: ArrayBuffer, vault: Record<string, string>): OfficeFillResult {
  const zip = unzipSync(new Uint8Array(bytes));
  if (!zip["xl/workbook.xml"]) throw new Error("Not an Excel workbook (no xl/workbook.xml).");
  const wb: Node[] = parser.parse(strFromU8(zip["xl/workbook.xml"]));
  const rels: Node[] = zip["xl/_rels/workbook.xml.rels"]
    ? parser.parse(strFromU8(zip["xl/_rels/workbook.xml.rels"]))
    : [];

  // sheet name -> r:id, and r:id -> target path.
  const sheetRid: Record<string, string> = {};
  for (const s of findAll(wb, "sheet")) {
    const nm = attr(s, "name");
    const rid = attr(s, "r:id");
    if (nm && rid) sheetRid[nm] = rid;
  }
  const ridTarget: Record<string, string> = {};
  for (const r of findAll(rels, "Relationship")) {
    const id = attr(r, "Id");
    const tgt = attr(r, "Target");
    if (id && tgt) ridTarget[id] = tgt.replace(/^\/?xl\//, "").replace(/^\//, "");
  }

  // Collect named ranges we can fill.
  const fields: OfficeFillResult["fields"] = [];
  let created = 0;
  let filled = 0;
  const edits: Record<string, Array<{ ref: string; value: string }>> = {}; // sheetPath -> cells

  for (const dn of findAll(wb, "definedName")) {
    const nm = attr(dn, "name") ?? "";
    const key = nameToKey(nm, vault);
    if (!key) continue;
    // definedName text is like "Sheet1!$B$2"
    const text = (dn["definedName"] ?? []).map((c: Node) => c["#text"] ?? "").join("");
    const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/.exec(text.trim());
    if (!m) continue;
    const sheetName = m[1];
    const col = m[2];
    const row = m[3];
    if (!sheetName || !col || !row) continue;
    const rid = sheetRid[sheetName];
    const rel = rid && ridTarget[rid];
    if (!rel) continue;
    const sheetPath = rel.startsWith("worksheets/") ? `xl/${rel}` : `xl/${rel}`;
    created++;
    const value = vault[key];
    fields.push({ name: nm, ontology_key: key, value: value ?? null });
    if (value === undefined) continue;
    (edits[sheetPath] ??= []).push({ ref: `${col}${row}`, value });
    filled++;
  }

  // Apply edits per sheet: set each target cell as an inline string.
  for (const [sheetPath, cells] of Object.entries(edits)) {
    if (!zip[sheetPath]) continue;
    const sheet: Node[] = parser.parse(strFromU8(zip[sheetPath]));
    const sheetData = findAll(sheet, "sheetData")[0];
    if (!sheetData) continue;
    for (const { ref, value } of cells) setCell(sheetData, ref, value);
    zip[sheetPath] = strToU8(builder.build(sheet));
  }

  // Phase B fallback: no named ranges filled → detect flat label cells.
  if (created === 0) {
    const flat = fillXlsxFlat(zip, sheetRid, ridTarget, vault);
    created += flat.created;
    filled += flat.filled;
    fields.push(...flat.fields);
  }

  return { created, filled, data: zipSync(zip), fields };
}

function parseRef(ref: string): { col: string; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m && m[1] && m[2] ? { col: m[1], row: parseInt(m[2], 10) } : null;
}
function indexToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Read shared strings (labels are usually stored there).
function readSharedStrings(zip: Record<string, Uint8Array>): string[] {
  if (!zip["xl/sharedStrings.xml"]) return [];
  const sst: Node[] = parser.parse(strFromU8(zip["xl/sharedStrings.xml"]));
  return findAll(sst, "si").map((si) => textOf(si));
}
function cellTextXlsx(cell: Node, shared: string[]): string {
  const t = attr(cell, "t");
  if (t === "s") {
    const v = firstChildTag(cell, "v");
    const idx = v ? parseInt(textOf(v), 10) : NaN;
    return Number.isFinite(idx) ? shared[idx] ?? "" : "";
  }
  if (t === "inlineStr") {
    const is = firstChildTag(cell, "is");
    return is ? textOf(is) : "";
  }
  const v = firstChildTag(cell, "v");
  return v ? textOf(v) : "";
}

// Flat XLSX detection (Phase B): a label cell fills its RIGHT neighbour (else BELOW).
function fillXlsxFlat(
  zip: Record<string, Uint8Array>,
  sheetRid: Record<string, string>,
  ridTarget: Record<string, string>,
  vault: Record<string, string>,
) {
  const shared = readSharedStrings(zip);
  const fields: OfficeFillResult["fields"] = [];
  let created = 0;
  let filled = 0;
  const used = new Set<string>();

  for (const rid of Object.values(sheetRid)) {
    const rel = ridTarget[rid];
    if (!rel) continue;
    const sheetPath = `xl/${rel}`;
    if (!zip[sheetPath]) continue;
    const sheet: Node[] = parser.parse(strFromU8(zip[sheetPath]));
    const sheetData = findAll(sheet, "sheetData")[0];
    if (!sheetData) continue;

    // Map ref -> text for emptiness checks + label scan.
    const textAt: Record<string, string> = {};
    for (const row of childrenTag(sheetData, "row")) {
      for (const c of childrenTag(row, "c")) {
        const ref = attr(c, "r");
        if (ref) textAt[ref] = cellTextXlsx(c, shared).trim();
      }
    }

    let changed = false;
    for (const [ref, label] of Object.entries(textAt)) {
      if (!label) continue;
      const key = nameToKey(label, vault);
      if (!key || used.has(key)) continue;
      const value = vault[key];
      if (value === undefined) continue;
      const pos = parseRef(ref);
      if (!pos) continue;
      const right = `${indexToCol(colToIndex(pos.col) + 1)}${pos.row}`;
      const below = `${pos.col}${pos.row + 1}`;
      const target = !textAt[right] ? right : !textAt[below] ? below : null;
      if (!target) continue;
      setCell(sheetData, target, value);
      textAt[target] = value;
      used.add(key);
      created++;
      filled++;
      changed = true;
      fields.push({ name: label, ontology_key: key, value });
    }
    if (changed) zip[sheetPath] = strToU8(builder.build(sheet));
  }

  return { created, filled, fields };
}

// Set a cell to an inline string, creating the row/cell in order if needed.
function setCell(sheetData: Node, ref: string, value: string): void {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return;
  const col = m[1];
  const rowStr = m[2];
  if (!col || !rowStr) return;
  const rowNum = parseInt(rowStr, 10);
  const rows: Node[] = sheetData["sheetData"];

  let row = rows.find((r) => tagOf(r) === "row" && attr(r, "r") === rowStr);
  if (!row) {
    row = { row: [], ":@": { "@_r": rowStr } };
    let idx = rows.findIndex((r) => tagOf(r) === "row" && parseInt(attr(r, "r") ?? "0", 10) > rowNum);
    if (idx < 0) idx = rows.length;
    rows.splice(idx, 0, row);
  }
  const cells: Node[] = row["row"];
  const cellNode: Node = {
    c: [{ is: [{ t: [{ "#text": value }] }] }],
    ":@": { "@_r": ref, "@_t": "inlineStr" },
  };
  const existing = cells.findIndex((c) => tagOf(c) === "c" && attr(c, "r") === ref);
  if (existing >= 0) {
    cells[existing] = cellNode;
  } else {
    const target = colToIndex(col);
    let idx = cells.findIndex((c) => {
      const cr = attr(c, "r");
      const cm = cr ? /^([A-Z]+)\d+$/.exec(cr) : null;
      return cm && cm[1] ? colToIndex(cm[1]) > target : false;
    });
    if (idx < 0) idx = cells.length;
    cells.splice(idx, 0, cellNode);
  }
}

export function fillOfficeForm(
  bytes: ArrayBuffer,
  kind: OfficeKind,
  vault: Record<string, string>,
): OfficeFillResult {
  return kind === "docx" ? fillDocx(bytes, vault) : fillXlsx(bytes, vault);
}
