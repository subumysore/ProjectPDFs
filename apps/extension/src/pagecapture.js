// Reading back what the user TYPED onto a web form, so it can be offered for capture into the
// vault — the extension half of the desktop's "new information" review (apps/app/src/App.tsx).
//
// Why this exists: the desktop learns new values and ASKS before saving them; the extension had
// no equivalent at all, so anything a user typed onto a page that their vault did not already
// hold was simply lost, and the same product behaved two different ways for the same action.
// The desktop's posture is the right one — nothing is saved without being shown and ticked.
//
// PRIVACY: this reads values that are already on the user's own screen, in their own browser, and
// hands them to the popup, which writes ONLY to the local vault. Nothing leaves the device.
// Passwords, hidden inputs and file pickers are never read.

/**
 * INJECTED into the page via chrome.scripting.executeScript, so it must be fully SELF-CONTAINED
 * (no imports, no outer references) — its source is serialized.
 * @returns {Array<{label: string, value: string}>}
 */
export function collectTypedValues() {
  // Pierce OPEN shadow roots so web-component forms (ADP careers, some Workday/iCIMS) are read too —
  // the same reach the filler has. Light-DOM matches come first, in document order, so existing
  // behaviour is unchanged when there are no shadow roots.
  const deepQSA = (sel, root = document) => {
    const res = [];
    const walk = (r) => {
      try { r.querySelectorAll(sel).forEach((e) => res.push(e)); } catch (_) { /* ignore */ }
      let hosts = [];
      try { hosts = r.querySelectorAll("*"); } catch (_) { hosts = []; }
      for (const e of hosts) if (e.shadowRoot) walk(e.shadowRoot);
    };
    walk(root);
    return res;
  };
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
  // An INTERNAL machine name that must never become a vault key/label — ATS field ids like
  // "metadata-form-0__group__vets100ADisabilitySelect". Real human labels have spaces or aren't code.
  const junkLabel = (s) => {
    const t = String(s || "");
    if (!t) return true;
    if (/__|\bmetadata[-_]|form-?\d|subform|pdf417|\[|\]/i.test(t)) return true;   // ATS/PDF internal ids
    if (!/\s/.test(t) && /[A-Z][a-z].*[A-Z]|[a-z]\d|_/.test(t) && t.length > 18) return true; // long camel/snake code
    return false;
  };
  // A placeholder or an INSTRUCTION ("Please check one of the boxes below", "Select one") — never an
  // answer the user actually gave.
  const instructionText = (s) => /^(please\s+(check|select|choose|answer|pick|complete)|select\s+(one|an option|a value|your)|check one of|choose one|answer the|--+|—)\b/i.test(String(s || "").trim());
  const labelOf = (el) => {
    const own = [
      (el.labels && el.labels[0] && el.labels[0].textContent) || "",
      el.getAttribute("aria-label") || "",
      (el.closest("label") && el.closest("label").textContent) || "",
      el.placeholder || "",
      el.name || "",
      el.id || "",
    ].map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean);
    return own[0] || "";
  };
  const out = [];
  for (const el of deepQSA("input, textarea, select")) {
    const type = (el.type || "").toLowerCase();
    if (["password", "hidden", "file", "submit", "button", "image", "reset", "checkbox", "radio"].includes(type)) continue;
    if (el.disabled) continue;
    const value = String(el.value == null ? "" : el.value).trim();
    if (!value) continue;
    // A <select> left on its placeholder ("Select…") is not an answer.
    if (el.tagName === "SELECT" && el.selectedIndex <= 0) continue;
    if (instructionText(value)) continue;                 // a placeholder/instruction is not an answer
    const label = labelOf(el);
    if (!label || junkLabel(label)) continue;             // no usable HUMAN label → don't invent a junk key
    out.push({ label, value });
  }

  // CUSTOM dropdowns (Workday "Select One", ARIA combobox, ng/mat/react-select …). The chosen
  // option lives in the widget's VISIBLE TEXT, not a <select>.value — so a Yes/No answer picked on
  // the form was never captured. Read the selection (skipping the unset placeholder) and pair it
  // with the question label, so answering once teaches the vault. (Everything here is REVIEWED
  // before it is saved, so a stray read never lands silently.)
  const PLACEHOLDER = /^(select(\s+(one|an option|a value|your \w+))?|choose(\s+one)?|please select|pick one|--+|—|-)\s*(\.{3}|…)?$/i;
  // The question text for a widget: aria-labelledby → aria-label/own label → a nearby label/legend
  // or a question-like line (ends in "?") among its ancestors.
  const widgetLabel = (el) => {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ""; })
        .join(" ").replace(/\s+/g, " ").trim();
      if (t) return t;
    }
    const own = labelOf(el);
    if (own && !PLACEHOLDER.test(own)) return own;
    let node = el;
    for (let i = 0; i < 5 && node; i++) {
      node = node.parentElement; if (!node) break;
      const lab = node.querySelector("label, legend, [class*='label'], [class*='question'], [class*='prompt']");
      const t = lab && lab.textContent ? lab.textContent.replace(/\s+/g, " ").trim() : "";
      if (t && t.length <= 200 && !PLACEHOLDER.test(t)) return t;
    }
    return "";
  };
  const seenW = [];
  for (const el of deepQSA(
    '[role="combobox"], [aria-haspopup="listbox"], ng-select, mat-select, [class*="ng-select"], [class*="mat-select"], ' +
    '[class*="react-select"], [class*="ant-select"], [class*="p-dropdown"], [class*="combobox"], [class*="Combobox"], [class*="Select"], [class*="dropdown"]',
  )) {
    if (el.tagName === "SELECT" || el.closest("select")) continue;
    if (seenW.some((s) => s.contains(el) || el.contains(s))) continue; // one row per nested widget
    // The selected value is the widget's visible text; require a short, single-value, non-placeholder.
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!txt || txt.length > 60 || PLACEHOLDER.test(txt) || instructionText(txt)) continue;
    const label = widgetLabel(el);
    if (!label || label.length > 200 || PLACEHOLDER.test(label) || junkLabel(label)) continue;
    seenW.push(el);
    out.push({ label, value: txt });
  }

  // RADIO groups + CHECKBOX groups (Yes/No screening, EEO self-ID like "Are you Hispanic or Latino?"
  // and "Ethnicity"). The desktop already offers a ticked box for capture; the extension skipped them,
  // so answering an EEO/eligibility question on a page never taught the vault. We record the QUESTION
  // and the CHOSEN option(s); the fill side maps a stored answer back onto any phrasing. Reviewed
  // before saving, like everything else — nothing lands silently.
  const isChecked = (el) => (el.tagName === "INPUT" ? !!el.checked : el.getAttribute("aria-checked") === "true");
  // A concise option label: prefer a short title element (bold/·title) over a long legal description
  // ("Asian" — not "Asian  Not Hispanic or Latino. A person having origins…"). The fill only needs the
  // keyword present, but a tidy value keeps the vault readable.
  const shortText = (node) => {
    if (!node) return "";
    const pref = node.querySelector && node.querySelector("strong,b,[class*='title'],[class*='Title'],[class*='name'],[class*='Name']");
    let t = pref && pref.textContent ? pref.textContent : "";
    if (!t) { for (const n of node.childNodes || []) { if (n.nodeType === 3) { const s = (n.textContent || "").trim(); if (s) { t = s; break; } } } }
    if (!t) t = node.textContent || "";
    return String(t).replace(/\s+/g, " ").trim();
  };
  const optLabel = (el) => {
    let t = el.getAttribute("aria-label") || "";
    if (!t) { const lab = (el.labels && el.labels[0]) || el.closest("label") || (el.parentElement && el.parentElement.querySelector && el.parentElement.querySelector("label")); t = shortText(lab); }
    if (!t) t = el.value || "";
    t = String(t).replace(/\s+/g, " ").trim();
    return t.length > 90 ? t.slice(0, 90) : t;
  };
  const byId = (el, id) => { const r = el.getRootNode && el.getRootNode(); return (r && r.getElementById && r.getElementById(id)) || document.getElementById(id); };
  // The QUESTION a radio/checkbox belongs to: fieldset legend → aria-labelledby / role=group aria-label
  // → a heading/[class*=question] descendant → a NON-control previous sibling (ADP renders the question
  // as a <div> just before the options container). Option rows (they contain a control) are skipped so
  // an option caption is never mistaken for the question.
  const groupQuestion = (el) => {
    const fs = el.closest("fieldset");
    if (fs) { const lg = fs.querySelector("legend"); const t = lg && lg.textContent ? lg.textContent.replace(/\s+/g, " ").trim() : ""; if (t && !PLACEHOLDER.test(t)) return t; }
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement; if (!node) break;
      const lb = node.getAttribute && node.getAttribute("aria-labelledby");
      if (lb) { const t = lb.split(/\s+/).map((id) => { const n = byId(el, id); return n ? n.textContent : ""; }).join(" ").replace(/\s+/g, " ").trim(); if (t && !PLACEHOLDER.test(t)) return t; }
      const role = node.getAttribute && node.getAttribute("role");
      const al = node.getAttribute && node.getAttribute("aria-label");
      if ((role === "radiogroup" || role === "group") && al) return al.replace(/\s+/g, " ").trim();
      const cand = node.querySelector && node.querySelector("legend,[class*='question'],[class*='Question'],[class*='prompt'],[class*='Prompt'],h1,h2,h3,h4,h5,h6");
      if (cand && !(cand.querySelector && cand.querySelector("input,select,textarea,[role='radio'],[role='checkbox']"))) {
        const t = cand.textContent ? cand.textContent.replace(/\s+/g, " ").trim() : "";
        if (t && t.length <= 200 && !PLACEHOLDER.test(t)) return t;
      }
      let ps = node.previousElementSibling;
      for (let j = 0; j < 3 && ps; j++) {
        if (!(ps.querySelector && ps.querySelector("input,select,textarea,[role='radio'],[role='checkbox']"))) {
          const t = ps.textContent ? ps.textContent.replace(/\s+/g, " ").trim() : "";
          if (t && t.length <= 200 && !PLACEHOLDER.test(t)) return t;
        }
        ps = ps.previousElementSibling;
      }
    }
    return "";
  };
  const have = new Set(out.map((o) => norm(o.label)));
  const pushChoice = (label, value) => {
    if (!label || !value) return;
    if (PLACEHOLDER.test(label) || norm(label) === norm(value)) return; // a lone consent box (label == option) is not a Q/A
    if (junkLabel(label) || instructionText(label)) return;            // internal id / instruction is not a question
    if (instructionText(value)) return;                                // "Please check one of the boxes" is not an answer
    const k = norm(label);
    if (have.has(k)) return;                                            // already captured via the text/select pass
    have.add(k);
    out.push({ label, value });
  };
  // Group radios/checkboxes by name (native grouping) or, when unnamed (custom widgets), by the nearest
  // fieldset / group container.
  const groupKey = (el) => (el.name ? "n:" + el.name.replace(/\[\]$/, "") : (el.closest("fieldset") || el.getAttribute("aria-labelledby") || el.parentElement));
  const radios = new Map(); const checks = new Map();
  for (const el of deepQSA('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')) {
    if (el.disabled) continue;
    const isCheckbox = el.type === "checkbox" || el.getAttribute("role") === "checkbox";
    const map = isCheckbox ? checks : radios;
    const gk = groupKey(el);
    let arr = map.get(gk); if (!arr) { arr = []; map.set(gk, arr); }
    arr.push(el);
  }
  for (const [, arr] of radios) {
    const chosen = arr.find(isChecked); if (!chosen) continue;
    pushChoice(groupQuestion(chosen), optLabel(chosen));
  }
  for (const [, arr] of checks) {
    const chosen = arr.filter(isChecked); if (!chosen.length) continue;
    const q = groupQuestion(chosen[0]);
    const vals = chosen.map(optLabel).filter(Boolean);
    if (q && vals.length) pushChoice(q, [...new Set(vals)].join(", "));
  }
  return out;
}

/**
 * Turn what was typed into the list to REVIEW: only pairs the vault does not already hold with
 * the same value, de-duplicated by key, each carrying the prior value so the user can see what
 * they would be changing. Pure — unit-tested in pagecapture.test.mjs.
 *
 * @param {Array<{label:string,value:string}>} typed
 * @param {Record<string,string>} vault
 * @param {(label:string)=>string} keyFromLabel
 * @param {(label:string)=>boolean} isCapturableLabel
 */
export function newInformation(typed, vault, keyFromLabel, isCapturableLabel) {
  const out = [];
  const seen = new Set();
  for (const { label, value } of typed || []) {
    if (!value || value.startsWith("data:")) continue;
    if (!isCapturableLabel(label)) continue;
    const key = keyFromLabel(label);
    if (seen.has(key)) continue;
    const existing = vault ? vault[key] : undefined;
    if (existing === value) continue; // already known, unchanged
    seen.add(key);
    out.push({ key, label, value, existing });
  }
  return out;
}
