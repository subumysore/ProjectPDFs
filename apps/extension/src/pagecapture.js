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
  for (const el of document.querySelectorAll("input, textarea, select")) {
    const type = (el.type || "").toLowerCase();
    if (["password", "hidden", "file", "submit", "button", "image", "reset", "checkbox", "radio"].includes(type)) continue;
    if (el.disabled) continue;
    const value = String(el.value == null ? "" : el.value).trim();
    if (!value) continue;
    // A <select> left on its placeholder ("Select…") is not an answer.
    if (el.tagName === "SELECT" && el.selectedIndex <= 0) continue;
    const label = labelOf(el);
    if (!label) continue;
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
  for (const el of document.querySelectorAll(
    '[role="combobox"], [aria-haspopup="listbox"], ng-select, mat-select, [class*="ng-select"], [class*="mat-select"], ' +
    '[class*="react-select"], [class*="ant-select"], [class*="p-dropdown"], [class*="combobox"], [class*="Combobox"], [class*="Select"], [class*="dropdown"]',
  )) {
    if (el.tagName === "SELECT" || el.closest("select")) continue;
    if (seenW.some((s) => s.contains(el) || el.contains(s))) continue; // one row per nested widget
    // The selected value is the widget's visible text; require a short, single-value, non-placeholder.
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!txt || txt.length > 60 || PLACEHOLDER.test(txt)) continue;
    const label = widgetLabel(el);
    if (!label || label.length > 200 || PLACEHOLDER.test(label)) continue;
    seenW.push(el);
    out.push({ label, value: txt });
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
