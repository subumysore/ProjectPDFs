// Shows the filled PDF in Chrome's NATIVE PDF viewer via <embed> (a blob URL), so
// AcroForm fields we couldn't auto-fill stay EDITABLE on screen — the user completes
// the rest and re-downloads. For the OCR path, the fill runs HERE in this persistent
// tab (a closing popup can't interrupt it) before the result is shown.
const stage = document.getElementById("stage");
const barText = document.querySelector("#bar span");
const setBar = (t) => { if (barText) barText.textContent = t; };

function b64ToBytes(b64) {
  const bin = atob(b64);
  const d = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
  return d;
}

function pdfUrl(data) {
  return URL.createObjectURL(new Blob([data.slice()], { type: "application/pdf" }));
}

// Show a set of PDF bytes in the interactive viewer and point the Download link at it.
function showPdf(data, name) {
  const url = pdfUrl(data);
  const dl = document.getElementById("dl");
  dl.href = url;
  dl.download = name;
  document.title = name;
  document.getElementById("pdf").src = url + "#toolbar=1&navpanes=0";
  return url;
}

// Show the filled PDF WITHOUT auto-downloading it. The "Download PDF" link in the bar
// is armed (via showPdf) so the user saves it only when THEY choose to — no more silent
// files piling up in the Downloads folder on every fill.
function renderFilled(data, name) {
  return showPdf(data, name);
}

// Wire the "Show original form" button.
//   - If we know WHERE the form came from (`origUrl`, e.g. a web/local PDF the user
//     opened), the button NAVIGATES the tab back to that real location — the browser
//     returns to the original form exactly where it lived. (Use "Download PDF" first if
//     you want to keep the filled copy — it is no longer saved automatically.)
//   - Otherwise (no URL: a scanned image / OCR path) it falls back to a blank⇄filled
//     toggle rendered in place from the stashed original bytes.
function setupOrigToggle(filled, orig, name, origUrl) {
  const btn = document.getElementById("toggleOrig");
  const label = document.getElementById("barLabel");
  const canNavigate = !!origUrl && /^(https?|file|blob|chrome-extension):/i.test(origUrl);
  if (!canNavigate && (!orig || !orig.length)) return; // nothing to show
  btn.hidden = false;

  if (canNavigate) {
    btn.textContent = "Go to original form ↗";
    btn.title = origUrl;
    btn.onclick = () => { window.location.href = origUrl; }; // back to where the form lives
    return;
  }

  // Fallback: in-place blank⇄filled toggle (no source URL, e.g. a scanned image).
  let showingOrig = false;
  const base = name.replace(/-filled\.pdf$/i, "").replace(/\.pdf$/i, "");
  btn.onclick = () => {
    showingOrig = !showingOrig;
    if (showingOrig) {
      showPdf(orig, `${base}-original.pdf`);
      btn.textContent = "Show filled form";
      label.textContent = "○ Original (blank) form — PolyglotFormFill";
    } else {
      showPdf(filled, name);
      btn.textContent = "Show original form";
      label.textContent = "✓ Your filled form — PolyglotFormFill (on-device)";
    }
  };
}

// Drag-to-resize the language side panel (width only). The PDF is in an <iframe>: while
// the pointer is over it, the iframe swallows mouse events so the parent never sees
// mousemove/mouseup and the drag would "stick". We disable pointer events on the iframe
// for the duration of the drag so every move/up reaches us, then restore them.
function setupPanelResize() {
  const panel = document.getElementById("langpanel");
  const grip = document.getElementById("lpGrip");
  const pdf = document.getElementById("pdf");
  if (!panel || !grip) return;
  let startX = 0, startW = 0, dragging = false;
  const move = (e) => {
    if (!dragging) return;
    const w = Math.min(820, Math.max(260, startW + (startX - e.clientX)));
    panel.style.width = w + "px";
    e.preventDefault();
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove("drag");
    if (pdf) pdf.style.pointerEvents = "";       // give the PDF its clicks back
    document.body.style.userSelect = "";
  };
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    grip.classList.add("drag");
    if (pdf) pdf.style.pointerEvents = "none";    // let move/up reach the parent page
    document.body.style.userSelect = "none";      // no text selection while dragging
  });
  // Listen for the whole document's lifetime (not add/removed per drag) so a mouseup
  // that lands anywhere — including after the pointer briefly left the window — ends it.
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  window.addEventListener("blur", up);            // window lost focus mid-drag → stop
}

function showEmpty(msg) {
  const el = document.getElementById("empty");
  if (msg) el.textContent = msg;
  el.hidden = false;
  document.getElementById("main").style.display = "none"; // hide the empty embed
}

import { isTranslatableValue } from "./valuefmt.js";
import { toScript } from "./translit.js";

const LANG_NAMES = { en: "English", hi: "हिन्दी (Hindi)", es: "Español", fr: "Français", de: "Deutsch", zh: "中文", ar: "العربية", ru: "Русский" };
const LANG_SHORT = { en: "English", hi: "हिन्दी", es: "Español", fr: "Français", de: "Deutsch", zh: "中文", ar: "العربية", ru: "Русский" };

// Bilingual side panel (Phase 3): a foreign-language form's labels translated into the
// user's language, on demand (models load only when they click). The original document
// stays untouched; the finished form remains in its own language (spec invariant).
function setupLangPanel(res) {
  const items = (res && res.pairs && res.pairs.length)
    ? res.pairs
    : ((res && res.labels) ? res.labels.map((l) => ({ label: l, value: "" })) : []);
  if (!items.length) return;
  const from = res.formLang || "en";
  const to = res.nativeLang || "en";
  if (from === to) return; // same language — nothing to translate
  const panel = document.getElementById("langpanel");
  document.getElementById("lpNote").textContent =
    `This form is in ${LANG_NAMES[from] || from}; your language is ${LANG_NAMES[to] || to}. Read each label AND the value that will fill it in your language — the filled form itself stays in ${LANG_NAMES[from] || from}.`;
  panel.hidden = false;
  const status = document.getElementById("lpStatus");
  const table = document.getElementById("lpTable");
  const go = document.getElementById("lpGo");
  go.onclick = async () => {
    go.disabled = true;
    status.textContent = "Loading the on-device translation model (first time downloads it)…";
    try {
      const { translateText } = await import("./translate.js");
      const cache = {};
      const tr = async (t) => { if (!t) return ""; if (cache[t] === undefined) cache[t] = await translateText(t, from, to, (s) => (status.textContent = s)); return cache[t]; };
      const oShort = LANG_SHORT[from] || from, tShort = LANG_SHORT[to] || to;
      // Four columns: the original label + your-language label, then the actual value +
      // its your-language rendering (verbatim for names/numbers, translated for phrases).
      table.innerHTML =
        `<tr><th>Label · ${oShort}</th><th>Label · ${tShort}</th><th>Value · ${oShort}</th><th>Value · ${tShort}</th></tr>`;
      let n = 0;
      for (const it of items) {
        const tl = await tr(it.label);
        const ov = it.value || "";
        // A genuine word-phrase is TRANSLATED; a name/number/ID is TRANSLITERATED into the
        // target's script (same sound, reader's letters) — never machine-translated.
        const tv = ov ? (isTranslatableValue(ov) ? await tr(ov) : toScript(ov, to)) : "";
        const row = document.createElement("tr");
        const a = document.createElement("td"); a.className = "orig"; a.textContent = it.label;
        const b = document.createElement("td"); b.className = "tr"; b.textContent = tl;
        const c = document.createElement("td"); c.className = "origval"; c.textContent = ov;
        const d = document.createElement("td"); d.className = "val"; d.textContent = tv;
        row.append(a, b, c, d);
        table.appendChild(row);
        n++;
      }
      status.textContent = `✓ ${n} field(s) — on-device. Phrases are translated; names & numbers are written in your script (transliterated), not translated. The form itself stays in ${LANG_NAMES[from] || from}.`;
    } catch (e) {
      status.textContent = "Translation failed: " + ((e && e.message) || e);
      go.disabled = false;
    }
  };
}

(async () => {
  const s = await chrome.storage.session.get([
    "ppf_filled", "ppf_orig", "ppf_url", "ppf_name", "ppf_src", "ppf_vault", "ppf_mode", "ppf_xfa",
    "ppf_pairs", "ppf_formLang", "ppf_nativeLang",
  ]);
  const name = s.ppf_name || "filled.pdf";
  setupPanelResize();

  // OCR path — run the on-device OCR fill right here, streaming progress to the bar.
  if (s.ppf_mode === "ocr" && s.ppf_src) {
    setBar(s.ppf_xfa
      ? "XFA / LiveCycle form — reading the printed labels with OCR (on-device)…"
      : "Reading the form with OCR (on-device)…");
    try {
      const bytes = b64ToBytes(s.ppf_src);
      const vault = s.ppf_vault || {};
      const { fillPdfByOcr } = await import("./pdfocr.js");
      const res = await fillPdfByOcr(bytes, vault, setBar);
      // Drop the decrypted vault + source from session as soon as we're done with them.
      chrome.storage.session.remove(["ppf_src", "ppf_vault", "ppf_mode", "ppf_xfa"]);
      if (!res.filled || !res.bytes) {
        if (res.form) {
          setBar(`Recognised ${res.form} — not auto-fillable yet.`);
          showEmpty(`This is a ${res.form}. It's recognised, but this particular form isn't auto-fillable yet (it needs a precise coordinate template — on the roadmap). Nothing was changed.`);
        } else {
          setBar("Read the form, but found nothing matching your saved details.");
          showEmpty("I read this form but couldn't find fields matching your saved details. Add more details in the popup, then try again.");
        }
        return;
      }
      setBar(`✓ Filled ${res.filled} field(s)${res.form ? " · " + res.form : ""} on-device — downloading…`);
      await renderFilled(res.bytes, name);
      setupOrigToggle(res.bytes, bytes, name, s.ppf_url); // original = the pre-OCR source / its URL
      setupLangPanel(res);
    } catch (e) {
      chrome.storage.session.remove(["ppf_src", "ppf_vault", "ppf_mode", "ppf_xfa"]);
      setBar("OCR failed: " + ((e && e.message) || e));
      stage.innerHTML = `<p style="color:#fff;padding:24px">OCR failed: ${(e && e.message) || e}</p>`;
    }
    return;
  }

  // Render path — a PDF already filled by the popup (AcroForm).
  if (!s.ppf_filled) { showEmpty(); return; }
  try {
    const filled = b64ToBytes(s.ppf_filled);
    await renderFilled(filled, name);
    setupOrigToggle(filled, s.ppf_orig ? b64ToBytes(s.ppf_orig) : null, name, s.ppf_url);
    // Offer the translated label+value panel for a standard (AcroForm) PDF too.
    setupLangPanel({ pairs: s.ppf_pairs, formLang: s.ppf_formLang, nativeLang: s.ppf_nativeLang });
  } catch (e) {
    stage.innerHTML = `<p style="color:#fff;padding:24px">Couldn't render the PDF: ${(e && e.message) || e}</p>`;
  }
  chrome.storage.session.remove(["ppf_filled", "ppf_orig"]);
})();
