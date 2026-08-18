// What does the CURRENT step of a multi-step application look like, and how do we leave it?
//
// This runs INSIDE the page (injected with chrome.scripting `func:`), so it must be entirely
// self-contained — no imports, no references to module scope — exactly like pagefill's injected
// function. It answers three questions and, optionally, performs one action:
//
//   * which REQUIRED controls are still empty (the run must pause rather than skip them)
//   * is there an ADVANCE control (Next / Continue / Save and continue …)
//   * is a SUBMIT control present (the end of the wizard — we stop, we never press it)
//   * `opts.click` → click the advance control (and only that: submit wording is rejected first)
//
// `stepKey` fingerprints the step so the caller can tell a real step change from a click that did
// nothing. Without that, a mis-detected button would let the engine fill the same step forever.
export function stepProbe(opts) {
  const o = opts || {};
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  // A control that leaves the step. Matched on VISIBLE TEXT, because these buttons have no stable
  // markup across ATS platforms. Submit wording is checked FIRST and always wins, so "Submit
  // application" can never be treated as an advance control.
  const SUBMIT = /\b(submit|send application|send my application|apply now|finish|complete application)\b/i;
  const ADVANCE = /^(next|continue|save and continue|save & continue|next step|save and next|proceed)\b/i;
  // No trailing \b: page text arrives with the next element's text butted up against it
  // ("Review your applicationNext"), which a word boundary would refuse to match.
  const REVIEW = /\breview (your )?application/i;

  const isVisible = (el) => {
    if (!el) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const btnText = (el) => norm(el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "");

  const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"]')]
    .filter(isVisible);
  const submitBtn = buttons.find((b) => SUBMIT.test(btnText(b))) || null;
  const advanceBtn = buttons.find((b) => {
    const t = btnText(b);
    return ADVANCE.test(t) && !SUBMIT.test(t);
  }) || null;
  const reviewText = REVIEW.test(norm(document.body.innerText || document.body.textContent || "").slice(0, 4000));

  // ---- required controls that are still empty ------------------------------------------------
  const labelOf = (el) => {
    const by = el.getAttribute && el.getAttribute("aria-labelledby");
    let byIds = "";
    if (by) {
      byIds = by.split(/\s+/).map((id) => {
        const n = document.getElementById(id);
        return n ? (n.innerText || n.textContent || "") : "";
      }).join(" ");
    }
    const own = [
      (el.labels && el.labels[0] && el.labels[0].textContent) || "",
      el.getAttribute("aria-label") || "",
      byIds,
      (el.closest("label") && el.closest("label").textContent) || "",
      el.placeholder || "",
      el.name || "",
    ].map(norm).filter(Boolean);
    return (own[0] || "").slice(0, 80);
  };
  const isRequired = (el) => {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    const l = labelOf(el);
    return /[*✱]/.test(l) || /\brequired\b/i.test(l);
  };
  // A custom chooser keeps its <input> empty by design — the chosen value lives in the widget. Read
  // the widget, or a field the user has already answered reads as blank and the run stalls on it.
  const CHOOSER = '.ant-select, [class*="ant-select"], [class*="react-select"], [class*="select__control"], ' +
    '[class*="ng-select"], mat-select, [class*="mat-select"], [class*="p-dropdown"], [role="combobox"], [aria-haspopup="listbox"]';
  const PLACEHOLDER = /^(select(\s+(one|an option|a value))?|choose(\s+one)?|please select|pick one|--+|—|-)\s*(\.{3}|…)?$/i;
  const chooserValue = (el) => {
    let w = (el.closest && el.closest(CHOOSER)) || null;
    // Many widgets keep a HIDDEN MIRROR input BESIDE (not inside) the visible chooser — that input is
    // permanently empty by design, so reading it alone reports an answered question as unanswered and
    // the run would stall on a question the user has already answered. Look for the chooser that
    // belongs to the same small field group.
    if (!w && el.parentElement) {
      let g = el.parentElement, hops = 0;
      while (g && hops++ < 3) {
        const cand = g.querySelector(CHOOSER);
        if (cand && !cand.contains(el)) { w = cand; break; }
        g = g.parentElement;
      }
    }
    if (!w) return null;
    const sel = w.querySelector('[class*="selection-item"], [class*="single-value"], [class*="selected-value"], [class*="value-label"]');
    let t = norm((sel && sel.textContent) || "");
    if (!t) {
      t = norm(w.textContent || "");
      if (t.length % 2 === 0 && t.slice(0, t.length / 2) === t.slice(t.length / 2)) t = norm(t.slice(0, t.length / 2));
    }
    return t && !PLACEHOLDER.test(t) ? t : "";
  };
  const hasValue = (el) => {
    const type = (el.type || el.tagName).toLowerCase();
    if (type === "radio" || type === "checkbox") {
      const group = [...document.querySelectorAll(`input[type="${type}"]`)]
        .filter((x) => (x.name || "") === (el.name || "") && x.name);
      return (group.length ? group : [el]).some((x) => x.checked);
    }
    // The control's OWN value settles it. Only an empty control needs the widget consulted — otherwise
    // a phone box holding "+1 919 555 0123" read as unanswered because the country-code widget beside
    // it (a different control) was showing a placeholder, and the run paused on a filled field.
    const v = norm(el.value);
    if (!v) {
      const chosen = chooserValue(el);
      return chosen === null ? false : !!chosen;
    }
    if (el.tagName === "SELECT") {
      const opt = el.selectedOptions && el.selectedOptions[0];
      if (opt && (opt.disabled || PLACEHOLDER.test(norm(opt.textContent)))) return false;
    }
    if (el.type === "tel" && /^\+\d{1,4}$/.test(v.replace(/\s+/g, ""))) return false;  // dial-code stub only
    return true;
  };

  const controls = [...document.querySelectorAll("input, textarea, select")]
    .filter((el) => !["hidden", "submit", "button", "reset", "image", "file"].includes((el.type || "").toLowerCase()))
    .filter(isVisible);
  const seenGroup = new Set();
  const requiredEmpty = [];
  const labels = [];
  for (const el of controls) {
    const type = (el.type || "").toLowerCase();
    if (type === "radio" || type === "checkbox") {
      const k = type + ":" + (el.name || labelOf(el));
      if (seenGroup.has(k)) continue;
      seenGroup.add(k);
    }
    const lab = labelOf(el);
    labels.push(lab || el.name || el.id || type);
    // A widget's HIDDEN MIRROR input carries no label, no name and no id — it exists only to make the
    // browser enforce "required" on a custom dropdown. Naming it "(unlabelled)" told the user to answer
    // a field they cannot even see, twice, beside the real question it mirrors. The visible widget is
    // reported on its own; the mirror is not a question.
    if (!lab && !el.name && !el.id) continue;
    if (isRequired(el) && !hasValue(el)) requiredEmpty.push(lab || el.name);
  }

  // A fingerprint of THIS step: which questions it asks. A real advance changes it; a click that did
  // nothing (validation error, wrong button) leaves it identical.
  const stepKey = labels.slice(0, 40).join("|").slice(0, 600);

  let clicked = null;
  if (o.click && advanceBtn) {
    clicked = btnText(advanceBtn);
    try { advanceBtn.scrollIntoView({ block: "nearest" }); } catch (_) { /* not essential */ }
    for (const t of ["pointerdown", "mousedown", "mouseup", "click"]) {
      try { advanceBtn.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 })); } catch (_) { /* ignore */ }
    }
  }

  return {
    stepKey,
    controls: controls.length,
    requiredEmpty: requiredEmpty.slice(0, 12),
    advance: advanceBtn ? btnText(advanceBtn) : null,
    submit: submitBtn ? btnText(submitBtn) : null,
    reviewText,
    clicked,
  };
}
