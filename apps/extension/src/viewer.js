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

// Every language the engine supports (the registry), with native display names — so a reader
// can view a form in ANY language, and pick ANY source language for a scanned/legacy-font form.
const LANG_NAMES = {
  en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano",
  nl: "Nederlands", vi: "Tiếng Việt", id: "Bahasa Indonesia", tr: "Türkçe",
  hi: "हिन्दी (Hindi)", mr: "मराठी (Marathi)", ne: "नेपाली (Nepali)", kn: "ಕನ್ನಡ (Kannada)",
  ta: "தமிழ் (Tamil)", te: "తెలుగు (Telugu)", ml: "മലയാളം (Malayalam)", bn: "বাংলা (Bengali)",
  gu: "ગુજરાતી (Gujarati)", pa: "ਪੰਜਾਬੀ (Punjabi)", or: "ଓଡ଼ିଆ (Odia)", si: "සිංහල (Sinhala)",
  ur: "اردو (Urdu)", ar: "العربية (Arabic)", fa: "فارسی (Persian)", ru: "Русский", uk: "Українська",
  zh: "中文", ja: "日本語", ko: "한국어", th: "ไทย", he: "עברית", el: "Ελληνικά",
};
const LANG_SHORT = {
  en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano",
  nl: "Nederlands", vi: "Tiếng Việt", id: "Indonesia", tr: "Türkçe", hi: "हिन्दी", mr: "मराठी",
  ne: "नेपाली", kn: "ಕನ್ನಡ", ta: "தமிழ்", te: "తెలుగు", ml: "മലയാളം", bn: "বাংলা", gu: "ગુજરાતી",
  pa: "ਪੰਜਾਬੀ", or: "ଓଡ଼ିଆ", si: "සිංහල", ur: "اردو", ar: "العربية", fa: "فارسی", ru: "Русский",
  uk: "Українська", zh: "中文", ja: "日本語", ko: "한국어", th: "ไทย", he: "עברית", el: "Ελληνικά",
};
// The panel's own column words ("Label"/"Value") in each supported language, so the
// header reads in the reader's language too — not just the data.
const UI_TERMS = {
  en: { label: "Label", value: "Value" },
  hi: { label: "लेबल", value: "मान" },
  es: { label: "Etiqueta", value: "Valor" },
  fr: { label: "Étiquette", value: "Valeur" },
  de: { label: "Bezeichnung", value: "Wert" },
  zh: { label: "标签", value: "值" },
  ar: { label: "التسمية", value: "القيمة" },
  ru: { label: "Метка", value: "Значение" },
};
const uiTerm = (lang, key) => (UI_TERMS[lang] || UI_TERMS.en)[key];

// Bilingual side panel: read a form's labels AND the values that will fill it, in ANY
// language you choose. The language dropdown is ordered your-language first, then the
// form's own language, then the rest alphabetically; a language's on-device model
// downloads only when you pick it. The panel is closable (and re-openable from the bar).
function setupLangPanel(res) {
  const items = (res && res.pairs && res.pairs.length)
    ? res.pairs
    : ((res && res.labels) ? res.labels.map((l) => ({ label: l, value: "" })) : []);
  const panel = document.getElementById("langpanel");
  const panelToggle = document.getElementById("panelToggle");
  // Show the panel if there are text-layer items OR we have the PDF bytes to OCR (scanned /
  // legacy-font forms have no usable text layer but can still be read via OCR).
  if (!items.length && !res.bytes) { if (panelToggle) panelToggle.hidden = true; return; }
  const from = res.formLang || "en";
  const native = res.nativeLang || "en";

  // Close ⇄ re-open wiring (available whether or not there's anything to translate yet).
  const showPanel = (show) => {
    panel.hidden = !show;
    panelToggle.hidden = false;
    panelToggle.textContent = show ? "🌐 Hide language panel" : "🌐 Language panel";
  };
  document.getElementById("lpClose").onclick = () => showPanel(false);
  panelToggle.onclick = () => showPanel(panel.hidden);

  // Language dropdown: native first, the form's language second, then the rest A→Z.
  const sel = document.getElementById("lpLang");
  const rest = Object.keys(LANG_NAMES)
    .filter((l) => l !== native && l !== from)
    .sort((a, b) => (LANG_NAMES[a] || a).localeCompare(LANG_NAMES[b] || b));
  const ordered = [native, ...(from !== native ? [from] : []), ...rest];
  sel.innerHTML = ordered
    .map((l) => `<option value="${l}">${LANG_NAMES[l] || l}${l === native ? " — your language" : l === from ? " — form's language" : ""}</option>`)
    .join("");
  sel.value = native;

  // Source-language picker + OCR toggle — for scanned / legacy-font forms whose text layer is
  // unusable (e.g. Karnataka govt Kannada forms). The user names the form's language; we render
  // the pages, OCR in that script's pack, then translate. Only shown when we have the bytes.
  const ocr = document.getElementById("lpOcr");
  const fromRow = document.getElementById("lpFromRow");
  const fromSel = document.getElementById("lpFrom");
  const ocrRow = document.getElementById("lpOcrRow");
  if (ocrRow) ocrRow.hidden = !res.bytes;
  if (fromSel) {
    const srcOrder = [from, ...Object.keys(LANG_NAMES).filter((l) => l !== from).sort((a, b) => (LANG_NAMES[a] || a).localeCompare(LANG_NAMES[b] || b))];
    fromSel.innerHTML = srcOrder.map((l) => `<option value="${l}">${LANG_NAMES[l] || l}</option>`).join("");
    fromSel.value = from;
  }
  if (ocr) ocr.onchange = () => { if (fromRow) fromRow.hidden = !ocr.checked; go.textContent = ocr.checked ? "Read with OCR & translate" : "Translate the form's labels & values"; };
  // Auto-suggest OCR when the text layer is empty or garbage (scanned / legacy non-Unicode font).
  // We can't know the real source language from garbage text, so we prompt the user to pick it.
  const badLayer = res.bytes && textLayerLooksBad(items.map((i) => i.label).join(" "));
  if (badLayer && ocr) {
    ocr.checked = true;
    if (fromRow) fromRow.hidden = false;
    go.textContent = "Read with OCR & translate";
    const note = document.getElementById("lpNote");
    if (note) note.textContent = "This form's text can't be read directly (it's scanned or uses a non-standard font). Pick the form's language below and I'll read it with on-device OCR.";
  }

  const status = document.getElementById("lpStatus");
  const table = document.getElementById("lpTable");
  const go = document.getElementById("lpGo");

  const render = async (to) => {
    go.disabled = true; sel.disabled = true;
    // Translation = Pro (gating matrix). Verify the license on-device before translating.
    try {
      const { isPro } = await import("./license.js");
      if (!(await isPro())) {
        document.getElementById("lpNote").textContent =
          "🔒 Reading a form in your language is a Pro feature.";
        table.innerHTML = "";
        status.innerHTML = 'Activate your license in the extension popup, or <a href="https://polyglotformfill.mooo.com/#pricing" target="_blank" style="color:#0a6a60">Get Pro →</a>';
        go.disabled = false; sel.disabled = false;
        return;
      }
    } catch (_) { /* if the check fails, fall through (fail-open is fine for a read-only view) */ }

    // OCR PATH — scanned / legacy non-Unicode font form: render pages, OCR in the chosen source
    // script's pack, then translate each line. This is how a Kannada (or any) form whose text
    // layer is garbage becomes readable in your language. Fully on-device.
    if (ocr && ocr.checked && res.bytes) {
      const src = fromSel.value;
      document.getElementById("lpNote").textContent = `Reading this ${LANG_NAMES[src] || src} form with on-device OCR, then translating to ${LANG_NAMES[to] || to}.`;
      table.innerHTML = "";
      try {
        const { translateScannedPdf } = await import("./pdftranslate.js");
        const doc = await translateScannedPdf(res.bytes, { to, from: src, onStatus: (m) => (status.textContent = m) });
        table.innerHTML = `<tr><th>${LANG_SHORT[src] || src}</th><th>${LANG_SHORT[to] || to}</th></tr>`;
        let n = 0;
        for (const pg of doc.pages) for (const ln of pg.lines) {
          if (!(ln.src || "").trim()) continue;
          const row = document.createElement("tr");
          const a = document.createElement("td"); a.className = "orig"; a.textContent = ln.src;
          const b = document.createElement("td"); b.className = "tr"; b.textContent = ln.tr;
          row.append(a, b); table.appendChild(row); n++;
        }
        status.textContent = n ? `✓ ${n} line(s) read & translated to ${LANG_NAMES[to] || to} — on-device.` : "OCR found no text on this form.";
      } catch (e) {
        status.textContent = "OCR translation failed: " + ((e && e.message) || e);
      }
      go.disabled = false; sel.disabled = false;
      return;
    }

    document.getElementById("lpNote").textContent =
      `This form is in ${LANG_NAMES[from] || from}. Reading it in ${LANG_NAMES[to] || to}: each label AND the value that fills it.`;
    if (to === from) {
      // Same language as the form — nothing to translate; show the form's own text.
      table.innerHTML = `<tr><th>${uiTerm(from, "label")} · ${LANG_SHORT[from] || from}</th><th>${uiTerm(from, "value")} · ${LANG_SHORT[from] || from}</th></tr>`;
      for (const it of items) {
        const row = document.createElement("tr");
        const a = document.createElement("td"); a.className = "tr"; a.textContent = it.label;
        const b = document.createElement("td"); b.className = "val"; b.textContent = it.value || "";
        row.append(a, b); table.appendChild(row);
      }
      // Honest: from===to means we didn't detect a different language in the EXTRACTED text.
      // That can mean it's genuinely your language OR its text couldn't be read (scanned / a
      // legacy non-Unicode font like many Indian govt forms) — which needs OCR, not text MT.
      status.textContent = `No translatable text was detected here — this form is already in ${LANG_NAMES[from] || from}, OR its text couldn't be read (scanned / non-standard font). On-device OCR translation for such forms is in progress.`;
      go.disabled = false; sel.disabled = false;
      return;
    }
    status.textContent = `Loading the ${LANG_NAMES[to] || to} model on-device (first use downloads it)…`;
    try {
      const { translateText } = await import("./translate.js");
      const cache = {};
      const tr = async (t) => { if (!t) return ""; if (cache[t] === undefined) cache[t] = await translateText(t, from, to, (s) => (status.textContent = s)); return cache[t]; };
      const oShort = LANG_SHORT[from] || from, tShort = LANG_SHORT[to] || to;
      // Each header word is written in that column's OWN language (source vs chosen).
      table.innerHTML =
        `<tr><th>${uiTerm(from, "label")} · ${oShort}</th><th>${uiTerm(to, "label")} · ${tShort}</th>` +
        `<th>${uiTerm(from, "value")} · ${oShort}</th><th>${uiTerm(to, "value")} · ${tShort}</th></tr>`;
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
      status.textContent = `✓ ${n} field(s) in ${LANG_NAMES[to] || to} — on-device. Phrases translated; names & numbers written in that script.`;
    } catch (e) {
      status.textContent = "Translation failed: " + ((e && e.message) || e);
    }
    go.disabled = false; sel.disabled = false;
  };

  go.onclick = () => render(sel.value);
  sel.onchange = () => render(sel.value); // choosing a language downloads it + re-renders
  // Only OPEN the panel when the user explicitly asked to read the form in their language
  // (View mode). On a plain Fill, keep it closed — just expose the "🌐 Language panel"
  // toggle so it's there if they want it. Translation never runs unprompted on Fill.
  showPanel(!!res.autoTranslate);
  if (res.autoTranslate) render(sel.value);
}

(async () => {
  const s = await chrome.storage.session.get([
    "ppf_filled", "ppf_orig", "ppf_url", "ppf_name", "ppf_src", "ppf_vault", "ppf_mode", "ppf_xfa",
    "ppf_pairs", "ppf_formLang", "ppf_nativeLang", "ppf_view",
  ]);
  const name = s.ppf_name || "filled.pdf";
  setupPanelResize();
  // ✍️ Sign / handwrite — open the CURRENTLY shown PDF in the annotate tool (works right
  // from the viewer; no need for a .pdf tab URL).
  let signB64 = s.ppf_filled || s.ppf_orig || null;
  const persistSign = () => { if (signB64) chrome.storage.session.set({ ppf_sign_src: signB64, ppf_sign_name: (name || "form").replace(/\.pdf$/i, "") }); };
  persistSign(); // so the POPUP Sign button works too (the viewer clears ppf_filled below)
  const signBtn = document.getElementById("signViewer");
  if (signBtn) signBtn.onclick = async () => {
    if (!signB64) return;
    persistSign();
    await chrome.tabs.create({ url: chrome.runtime.getURL("sign.html") });
  };

  // ✕ Close — leave this generated view and return to the original form. Prefer the real
  // source URL (back to where the form lives); else step back in history; else close the tab.
  document.getElementById("closeViewer").onclick = () => {
    if (s.ppf_url && /^(https?|file):/i.test(s.ppf_url)) window.location.href = s.ppf_url;
    else if (history.length > 1) history.back();
    else window.close();
  };
  if (s.ppf_view) document.getElementById("barLabel").textContent = "🌐 Language view (read-only) — the form is NOT filled";
  // Manual edits made on screen live in Chrome's PDF plugin, which "Download PDF" (a blob
  // of the pre-edit bytes) can't see. Tell the user to use the PDF's own Save for those.
  const dlLink = document.getElementById("dl");
  if (dlLink) dlLink.title = "Downloads the filled PDF. To keep fields you complete on screen, use the PDF viewer's own Save (💾) instead.";

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
      { let bin = ""; for (let i = 0; i < res.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, res.bytes.subarray(i, i + 0x8000)); signB64 = btoa(bin); } // enable ✍️ Sign for the OCR result
      persistSign();
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
    // Offer the translated label+value panel for a standard (AcroForm) PDF too. In VIEW
    // mode (left = original form), auto-translate so the right shows it in your language.
    setupLangPanel({ pairs: s.ppf_pairs, formLang: s.ppf_formLang, nativeLang: s.ppf_nativeLang, autoTranslate: !!s.ppf_view, bytes: s.ppf_orig ? b64ToBytes(s.ppf_orig) : filled });
  } catch (e) {
    stage.innerHTML = `<p style="color:#fff;padding:24px">Couldn't render the PDF: ${(e && e.message) || e}</p>`;
  }
  chrome.storage.session.remove(["ppf_filled", "ppf_orig"]);
})();
