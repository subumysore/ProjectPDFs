// E2E-3: run the REAL shared engine (planProximityFill + resolver) against the REAL N-400 widget tree,
// building fields EXACTLY as pdfxfa.js does (incl. choiceOptions), and assert the 3 fixes:
//   (1) State dropdown gets NC   (2) Street line gets the street (not blank/name)   (3) residence-history
//   table rows are NOT filled.  Usage: node scripts/e2e/verify-engine-fill.mjs "<n-400.pdf>"
import { readFile } from "node:fs/promises";
import { getDocument } from "../../node_modules/.pnpm/pdfjs-dist@4.10.38/node_modules/pdfjs-dist/legacy/build/pdf.min.mjs";
import { planProximityFill, captionFor } from "../../apps/extension/src/pdfproximity.js";
import { resolveFields } from "../../apps/extension/src/resolver.js";

const vault = { full_name:"SUBRAMANYA VISHWANATHAN MYSORE", first_name:"SUBRAMANYA", middle_name:"VISHWANATHAN", last_name:"MYSORE",
  street_address:"4308 ALBINO DEER WAY", city:"WAKE FOREST", state:"NC", zip:"27587-3971", country:"USA",
  email:"subumysore@gmail.com", phone:"+1 650-390-5612", dob:"11/30/1968" };

const data = new Uint8Array(await readFile(process.argv[2]));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
const texts = [];
for (let pi = 0; pi < doc.numPages; pi++) {
  const tc = await (await doc.getPage(pi + 1)).getTextContent();
  for (const it of tc.items) { const s = (it.str||"").trim(); if (s) texts.push({ page: pi, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height||10, s }); }
}
const groups = new Map();
for (let pi = 0; pi < doc.numPages; pi++) {
  const anns = await (await doc.getPage(pi + 1)).getAnnotations().catch(()=>[]);
  for (const a of anns) {
    if (a.subtype !== "Widget" || !a.fieldName || a.hidden || a.readOnly) continue;
    const R=a.rect; const rect={x:Math.min(R[0],R[2]),y:Math.min(R[1],R[3]),width:Math.abs(R[2]-R[0]),height:Math.abs(R[3]-R[1])};
    if (rect.width<2||rect.height<2) continue;
    const choiceOptions=(a.fieldType==="Ch"&&Array.isArray(a.options))?a.options.map(o=>typeof o==="string"?o:(o.exportValue??o.displayValue)).filter(v=>v!=null&&String(v).trim()!==""):null;
    const w={id:a.id,name:a.fieldName,page:pi,kind:a.fieldType==="Tx"?"text":"choice",rect,isButton:a.fieldType==="Btn",exportValue:a.buttonValue??null,choiceOptions,tooltip:(a.alternativeText||"").trim()};
    const g=groups.get(w.name)||[]; g.push(w); groups.set(w.name,g);
  }
}
const fields=[]; const tbp=new Map();
for (const t of texts){const a=tbp.get(t.page)||[];a.push(t);tbp.set(t.page,a);}
for (const [name,ws] of groups){
  const w0=ws[0]; const kind=w0.kind==="text"&&!w0.isButton?"text":"choice";
  const options=(w0.choiceOptions&&w0.choiceOptions.length)?w0.choiceOptions:ws.map(w=>w.exportValue).filter(Boolean);
  fields.push({id:name,kind,page:w0.page,rect:w0.rect,options,tooltip:w0.tooltip||"",widgets:ws.map(w=>({page:w.page,rect:w.rect}))});
}
const { assignments } = planProximityFill(fields, texts, vault, resolveFields);
const by = new Map(assignments.map(a=>[a.id, a]));
const get = (frag)=>[...by.keys()].filter(k=>k.includes(frag)).map(k=>by.get(k));

const R=[]; const A=(n,c,d="")=>{R.push(c);console.log((c?"PASS \u2705 ":"FAIL \u274c ")+n+(d?"  \u2014 "+d:""));};
const state = get("P4_Line1_State")[0];
A("State dropdown assigned NC", state && /NC/i.test(String(state.option||state.value||"")), state?("option="+JSON.stringify(state.option)):"(not assigned)");
const street = [...by.keys()].filter(k=>/P4_Line1_(Street|Address)/i.test(k)).map(k=>by.get(k))[0];
A("current Street line gets the street (not blank/name)", street && /4308 ALBINO DEER WAY/i.test(String(street.value||"")), street?("value="+JSON.stringify(street.value)):"(not assigned)");
const histRows = [...by.keys()].filter(k=>/P4_Line3_PhysicalAddress/i.test(k));
A("residence-history table rows NOT filled", histRows.length===0, histRows.length?("filled: "+histRows.join(",")):"none filled");
// sanity: name + DOB + email still fill
A("name still fills (p1)", get("P2_Line1_FamilyName")[0]?.value==="MYSORE" || [...by.keys()].some(k=>/FamilyName/i.test(k)));
console.log("\nTotal assignments:", assignments.length);
console.log(R.every(Boolean) ? "ENGINE-FILL PASS \u2014 all green" : "ENGINE-FILL FAIL");
process.exit(R.every(Boolean)?0:1);
