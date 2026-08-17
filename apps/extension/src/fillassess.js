// SELF-ASSESSMENT / FILL VERIFICATION (additive — does NOT modify the filler).
//
// After a fill runs, this inspects the page and reports, for EVERY control the form asks for and
// across EVERY control type (text/tel/email/number/textarea, select, radio group, checkbox), whether
// it ended up populated. It is deliberately independent of pagefill.js so it is an honest, external
// check of the outcome — "the form asked for N things; here is exactly which ones we filled and which
// we did not" — rather than a restatement of what the filler THOUGHT it did.
//
// Returns: { total, filled, missed, required, requiredFilled, items: [ {label, kind, required, filled, value} ] }
// `items` covers what the form asks for; `missed` is the required-but-empty subset (what a human must finish).

// Pierce OPEN shadow roots the same way the filler reaches web-component forms.
function deepQSA(sel, root = document) {
  const out = [];
  const walk = (r) => {
    let nodes = [];
    try { nodes = r.querySelectorAll(sel); } catch (_) { /* detached */ }
    for (const n of nodes) out.push(n);
    const hosts = (r.querySelectorAll ? r.querySelectorAll("*") : []);
    for (const h of hosts) if (h.shadowRoot) walk(h.shadowRoot);
  };
  walk(root);
  return out;
}

// Is the control actually shown to the user? (Skip hidden/offscreen scaffolding.)
function visible(el) {
  if (!el) return false;
  if (el.type === "hidden") return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// The human question a control is asking for: explicit label → aria-label → aria-labelledby →
// placeholder → nearby text → name. Kept simple on purpose (this REPORTS; it does not resolve concepts).
function askLabel(el) {
  const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  const wrap = el.closest && el.closest("label");
  const albl = el.getAttribute && el.getAttribute("aria-label");
  const lbldby = el.getAttribute && el.getAttribute("aria-labelledby");
  let byIds = "";
  if (lbldby) byIds = lbldby.split(/\s+/).map((id) => (document.getElementById(id) || {}).innerText || "").join(" ").trim();
  const t = (byFor && byFor.innerText) || (wrap && wrap.innerText) || albl || byIds
    || (el.placeholder || "") || (el.name || "") || "";
  return t.replace(/\s+/g, " ").trim().slice(0, 80);
}

function isRequired(el) {
  if (el.required || el.getAttribute("aria-required") === "true") return true;
  const l = askLabel(el);
  return /[*✱]/.test(l) || /\brequired\b/i.test(l);
}

// A tel field showing only a dialing-code stub ("+1", "+91") is NOT filled — mirror the filler's rule
// so the assessment agrees with reality rather than counting the widget's empty state as a value.
function hasValue(el) {
  const v = (el.value || "").trim();
  if (v === "") return false;
  if (el.type === "tel" && /^\+\d{1,4}$/.test(v.replace(/\s+/g, ""))) return false;
  // A custom chooser (Ant/react-select/ng-select/ARIA combobox) keeps its INPUT empty by design — the
  // chosen value lives in the widget's selection node. Reading only the input reported every such field
  // as "not filled", which made the whole assessment untrustworthy: Country, State and the dialling
  // codes were all shown as empty while visibly holding the right answer.
  const CHOOSER_SEL = '.ant-select, [class*="ant-select"], [class*="react-select"], [class*="ng-select"], ' +
    'mat-select, [class*="mat-select"], [class*="p-dropdown"], [role="combobox"], [aria-haspopup="listbox"]';
  // The element may BE inside the widget, or it may be the framework's hidden mirror input that lives
  // beside it (Dayforce keeps "…CountryCode" outside the widget and holds the code there). So also look
  // for a chooser inside this field's own group — and only when the group holds exactly one, so a value
  // can never be attributed to the wrong control.
  let chooser = el.closest && el.closest(CHOOSER_SEL);
  if (!chooser && el.closest) {
    const group = el.closest('[class*="form-item"], [class*="form-group"], [class*="field"], label');
    const near = group ? group.querySelectorAll(CHOOSER_SEL) : [];
    if (near.length === 1) chooser = near[0];
  }
  if (chooser) {
    const sel = chooser.querySelector('[class*="selection-item"], [class*="single-value"], [class*="selected-value"], [class*="value-label"]');
    let t = ((sel && sel.textContent) || "").replace(/\s+/g, " ").trim();
    if (!t) {
      t = (chooser.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length % 2 === 0 && t.slice(0, t.length / 2) === t.slice(t.length / 2)) t = t.slice(0, t.length / 2).trim();
    }
    if (t && !/^(select|choose|please select|pick|--+|—|-)\s*(\.{3}|…)?$/i.test(t)) return true;
    if (!v) return false;
  }
  if (el.tagName === "SELECT") {
    // an unchosen select sits on its placeholder/first empty option
    if (v === "" ) return false;
    const opt = el.selectedOptions && el.selectedOptions[0];
    if (opt && (opt.disabled || /^(select|choose|please|--)/i.test((opt.textContent || "").trim()))) return false;
  }
  return true;
}

/**
 * Assess the page's form coverage. Pure DOM read — safe to call any time after a fill.
 * @param {object} opts { includeOptional?: boolean }  — when false (default) `missed` lists only
 *   REQUIRED empties; `items` still enumerates everything the form asks for.
 */
export function assessForm(opts = {}) {
  const items = [];
  const seenRadioGroups = new Set();

  for (const el of deepQSA("input, textarea, select")) {
    const type = (el.type || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) continue;
    if (!visible(el) || el.disabled) continue;

    // Radio / checkbox GROUPS: assess once per group (by name), filled == any option chosen.
    if (type === "radio" || type === "checkbox") {
      const key = (el.name || askLabel(el) || Math.random()).toString();
      if (seenRadioGroups.has(type + ":" + key)) continue;
      seenRadioGroups.add(type + ":" + key);
      const group = deepQSA(`input[type="${type}"]`).filter((x) => (x.name || "") === (el.name || "") && x.name);
      const members = group.length ? group : [el];
      const chosen = members.find((x) => x.checked);
      const groupLabel = (el.closest && el.closest("fieldset") && el.closest("fieldset").querySelector("legend")
        && el.closest("fieldset").querySelector("legend").innerText) || askLabel(el);
      const required = members.some(isRequired) || type === "radio"; // a radio set usually wants an answer
      items.push({
        label: (groupLabel || "").replace(/\s+/g, " ").trim().slice(0, 80),
        kind: type === "radio" ? "choice" : "checkbox",
        required: type === "radio" ? required : false,
        filled: !!chosen,
        value: chosen ? (askLabel(chosen) || chosen.value || "✓") : "",
      });
      continue;
    }

    const kind = el.tagName === "SELECT" ? "select" : (el.tagName === "TEXTAREA" ? "textarea" : (type || "text"));
    items.push({
      label: askLabel(el) || "(unlabelled)",
      kind,
      required: isRequired(el),
      filled: hasValue(el),
      value: hasValue(el) ? String(el.value).slice(0, 60) : "",
    });
  }

  // CUSTOM CHOOSERS are controls too, and their chosen value lives in the widget — not in any <input>.
  // Frameworks also keep a hidden mirror input beside the widget (Dayforce's "…CountryCode"), so the
  // loop above can log a field as empty while the widget visibly holds the answer: Country, State and
  // both dialling codes were reported unfilled on a form where all four were correct. Read the widget
  // itself and let it correct (or add) the item for that label.
  const CHOOSER_SEL = '.ant-select, [class*="ant-select"], [class*="react-select"], [class*="ng-select"], ' +
    'mat-select, [class*="mat-select"], [class*="p-dropdown"], [role="combobox"], [aria-haspopup="listbox"]';
  const PLACEHOLDER = /^(select(\s+(one|an option|a value))?|choose(\s+one)?|please select|pick one|--+|—|-)\s*(\.{3}|…)?$/i;
  const seenChooser = [];
  for (const w of deepQSA(CHOOSER_SEL)) {
    if (w.tagName === "SELECT" || w.closest("select") || !visible(w)) continue;
    if (w.closest("nav, header, [role=menubar], [role=navigation]")) continue;   // page chrome, not a field
    if (seenChooser.some((s) => s.contains(w) || w.contains(s))) continue;       // one row per nested widget
    seenChooser.push(w);
    const selNode = w.querySelector('[class*="selection-item"], [class*="single-value"], [class*="selected-value"], [class*="value-label"]');
    let val = ((selNode && selNode.textContent) || "").replace(/\s+/g, " ").trim();
    if (!val) {
      val = (w.textContent || "").replace(/\s+/g, " ").trim();
      if (val.length % 2 === 0 && val.slice(0, val.length / 2) === val.slice(val.length / 2)) val = val.slice(0, val.length / 2).trim();
    }
    if (PLACEHOLDER.test(val)) val = "";
    const group = w.closest('[class*="form-item"], [class*="form-group"], [class*="field"], label') || w.parentElement;
    const inner = group ? group.querySelector("input, textarea, select") : null;
    const label = (inner && askLabel(inner)) || askLabel(w) || "(unlabelled)";
    // Repeated labels are normal ("Country dialing code" beside both the home and the mobile number),
    // so claim the first item with this label that is still unfilled — otherwise the second widget's
    // answer is dropped onto the first, already-filled row and the second reads as empty.
    const existing = items.find((i) => i.label === label && !i.filled) || items.find((i) => i.label === label);
    if (existing) { if (val && !existing.filled) { existing.filled = true; existing.value = val.slice(0, 60); } }
    else items.push({ label, kind: "chooser", required: !!(inner && isRequired(inner)), filled: !!val, value: val.slice(0, 60) });
  }

  const total = items.length;
  const filled = items.filter((i) => i.filled).length;
  const required = items.filter((i) => i.required).length;
  const requiredFilled = items.filter((i) => i.required && i.filled).length;
  const missed = items.filter((i) => (opts.includeOptional ? !i.filled : (i.required && !i.filled)))
    .map((i) => ({ label: i.label, kind: i.kind }));

  return { total, filled, required, requiredFilled, missed, items };
}
