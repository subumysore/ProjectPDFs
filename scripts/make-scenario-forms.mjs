#!/usr/bin/env node
// Generate the guide-video SCENARIO FORMS: real-looking AcroForm PDFs whose fields all fill from ONE
// John Doe profile, so the video can SHOW what it TELLS (same data across many forms, and every
// control type — text, dropdown, radio, checkbox, photo box, signature line — actually answered).
//   node scripts/make-scenario-forms.mjs
// Output: docs/guide/demo-assets/scenarios/{passport,school,job,medical}.pdf
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// pdf-lib is installed under apps/app; load it from there regardless of cwd.
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../apps/app/package.json"));
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/guide/demo-assets/scenarios");
mkdirSync(OUT, { recursive: true });
const TEAL = rgb(0.06, 0.46, 0.43);
const GREY = rgb(0.45, 0.45, 0.45);

async function base(title, subtitle) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: TEAL });
  page.drawText(title, { x: 40, y: 810, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(subtitle, { x: 40, y: 770, size: 9, font, color: GREY });
  return { pdf, page, font, bold, form: pdf.getForm() };
}
// A labelled text field.
function textField(ctx, name, label, x, y, w = 300) {
  ctx.page.drawText(label, { x, y: y + 16, size: 10, font: ctx.bold, color: rgb(0.1, 0.1, 0.1) });
  const f = ctx.form.createTextField(name);
  f.addToPage(ctx.page, { x, y, width: w, height: 20, borderWidth: 1, borderColor: rgb(0.8, 0.85, 0.85) });
  return f;
}

// 1) PASSPORT RENEWAL — text + a PHOTO box + a SIGNATURE line (image fields fill from the vault).
async function passport() {
  const c = await base("Passport Renewal Application", "Form DS-82 (demo)");
  textField(c, "full_name", "Full name", 40, 730);
  textField(c, "date_of_birth", "Date of birth", 40, 680, 180);
  textField(c, "nationality", "Nationality", 250, 680, 180);
  textField(c, "address", "Address", 40, 630, 390);
  // Photo box (top-right) — labelled so the fill places the profile photo here.
  c.page.drawText("Photo", { x: 470, y: 745, size: 10, font: c.bold });
  c.page.drawRectangle({ x: 470, y: 630, width: 90, height: 110, borderWidth: 1, borderColor: GREY });
  c.form.createTextField("photo").addToPage(c.page, { x: 470, y: 630, width: 90, height: 110 });
  // Signature line (bottom).
  c.page.drawText("Signature", { x: 40, y: 566, size: 10, font: c.bold });
  c.page.drawLine({ start: { x: 110, y: 570 }, end: { x: 360, y: 570 }, thickness: 0.8, color: GREY });
  c.form.createTextField("signature").addToPage(c.page, { x: 110, y: 552, width: 250, height: 34 });
  writeFileSync(resolve(OUT, "passport.pdf"), await c.pdf.save());
}

// 2) JOB APPLICATION — text + a RADIO group (Sex) + a DROPDOWN (Marital status).
async function job() {
  const c = await base("Employment Application", "Human Resources (demo)");
  textField(c, "full_name", "Full name", 40, 730);
  textField(c, "email", "Email", 40, 680, 250);
  textField(c, "cell_phone", "Phone", 310, 680, 200);
  textField(c, "occupation", "Position applied for", 40, 630, 300);
  // RADIO — Sex (fills from gender = Male).
  c.page.drawText("Sex", { x: 40, y: 590, size: 10, font: c.bold });
  const sex = c.form.createRadioGroup("gender");
  sex.addOptionToPage("Male", c.page, { x: 90, y: 588, width: 12, height: 12 });
  c.page.drawText("Male", { x: 106, y: 588, size: 10, font: c.font });
  sex.addOptionToPage("Female", c.page, { x: 160, y: 588, width: 12, height: 12 });
  c.page.drawText("Female", { x: 176, y: 588, size: 10, font: c.font });
  // DROPDOWN — Marital status (fills from marital_status = Single).
  c.page.drawText("Marital status", { x: 40, y: 550, size: 10, font: c.bold });
  const ms = c.form.createDropdown("marital_status");
  ms.addOptions(["Single", "Married", "Divorced", "Widowed"]);
  ms.addToPage(c.page, { x: 130, y: 546, width: 160, height: 20, borderWidth: 1, borderColor: rgb(0.8, 0.85, 0.85) });
  writeFileSync(resolve(OUT, "job.pdf"), await c.pdf.save());
}

// 3) SCHOOL ENROLMENT — text + a CHECKBOX group (Sex) + a DROPDOWN (Nationality).
async function school() {
  const c = await base("School Enrolment Form", "Community School District (demo)");
  textField(c, "full_name", "Student full name", 40, 730);
  textField(c, "date_of_birth", "Date of birth", 40, 680, 180);
  textField(c, "address", "Home address", 250, 680, 260);
  // CHECKBOXES — Sex. The engine ticks a checkbox whose LABEL (= field name) matches a vault option
  // value, so name them "Male"/"Female" (not gender_male) → gender=Male ticks the "Male" box.
  c.page.drawText("Sex", { x: 40, y: 640, size: 10, font: c.bold });
  const male = c.form.createCheckBox("Male");
  male.addToPage(c.page, { x: 90, y: 638, width: 12, height: 12 });
  c.page.drawText("Male", { x: 106, y: 638, size: 10, font: c.font });
  const female = c.form.createCheckBox("Female");
  female.addToPage(c.page, { x: 160, y: 638, width: 12, height: 12 });
  c.page.drawText("Female", { x: 176, y: 638, size: 10, font: c.font });
  // DROPDOWN — Nationality.
  c.page.drawText("Nationality", { x: 40, y: 600, size: 10, font: c.bold });
  const nat = c.form.createDropdown("nationality");
  nat.addOptions(["American", "British", "Canadian", "Indian", "Other"]);
  nat.addToPage(c.page, { x: 120, y: 596, width: 160, height: 20, borderWidth: 1, borderColor: rgb(0.8, 0.85, 0.85) });
  writeFileSync(resolve(OUT, "school.pdf"), await c.pdf.save());
}

// 4) MEDICAL INTAKE — text + RADIO (Sex) + a SIGNATURE line.
async function medical() {
  const c = await base("Patient Intake Form", "Clinic Registration (demo)");
  textField(c, "full_name", "Patient name", 40, 730);
  textField(c, "date_of_birth", "Date of birth", 40, 680, 180);
  textField(c, "cell_phone", "Contact number", 250, 680, 200);
  textField(c, "address", "Address", 40, 630, 390);
  c.page.drawText("Sex", { x: 40, y: 590, size: 10, font: c.bold });
  const sex = c.form.createRadioGroup("gender");
  sex.addOptionToPage("Male", c.page, { x: 90, y: 588, width: 12, height: 12 });
  c.page.drawText("Male", { x: 106, y: 588, size: 10, font: c.font });
  sex.addOptionToPage("Female", c.page, { x: 160, y: 588, width: 12, height: 12 });
  c.page.drawText("Female", { x: 176, y: 588, size: 10, font: c.font });
  c.page.drawText("Signature", { x: 40, y: 545, size: 10, font: c.bold });
  c.page.drawLine({ start: { x: 110, y: 549 }, end: { x: 360, y: 549 }, thickness: 0.8, color: GREY });
  c.form.createTextField("signature").addToPage(c.page, { x: 110, y: 531, width: 250, height: 34 });
  writeFileSync(resolve(OUT, "medical.pdf"), await c.pdf.save());
}

await passport(); await job(); await school(); await medical();
console.log("wrote passport.pdf, job.pdf, school.pdf, medical.pdf to", OUT);
