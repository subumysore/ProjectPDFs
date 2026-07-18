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

  zip[path] = strToU8(builder.build(tree));
  return { created, filled, data: zipSync(zip), fields };
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

  return { created, filled, data: zipSync(zip), fields };
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
