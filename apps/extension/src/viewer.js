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

function renderAndDownload(data, name) {
  const url = URL.createObjectURL(new Blob([data.slice()], { type: "application/pdf" }));
  const dl = document.getElementById("dl");
  dl.href = url;
  dl.download = name;
  document.title = name;
  // Show it in Chrome's interactive PDF viewer — AcroForm fields remain fillable.
  document.getElementById("pdf").src = url + "#toolbar=1&navpanes=0";
  dl.click(); // also auto-download the completed form
}

function showEmpty(msg) {
  const el = document.getElementById("empty");
  if (msg) el.textContent = msg;
  el.hidden = false;
  document.getElementById("main").style.display = "none"; // hide the empty embed
}

const LANG_NAMES = { en: "English", hi: "हिन्दी (Hindi)", es: "Español", fr: "Français", de: "Deutsch", zh: "中文", ar: "العربية", ru: "Русский" };

// Bilingual side panel (Phase 3): a foreign-language form's labels translated into the
// user's language, on demand (models load only when they click). The original document
// stays untouched; the finished form remains in its own language (spec invariant).
function setupLangPanel(res) {
  if (!res || !res.labels || !res.labels.length) return;
  const from = res.formLang || "en";
  const to = res.nativeLang || "en";
  if (from === to) return; // same language — nothing to translate
  const panel = document.getElementById("langpanel");
  document.getElementById("lpNote").textContent =
    `This form is in ${LANG_NAMES[from] || from}; your language is ${LANG_NAMES[to] || to}. Translate the labels to read it — the filled form itself stays in ${LANG_NAMES[from] || from}.`;
  panel.hidden = false;
  const status = document.getElementById("lpStatus");
  const table = document.getElementById("lpTable");
  const go = document.getElementById("lpGo");
  go.onclick = async () => {
    go.disabled = true;
    status.textContent = "Loading the on-device translation model (first time downloads it)…";
    try {
      const { translateText } = await import("./translate.js");
      table.innerHTML = "";
      for (const label of res.labels) {
        const tr = await translateText(label, from, to, (s) => (status.textContent = s));
        const row = document.createElement("tr");
        const a = document.createElement("td"); a.className = "orig"; a.textContent = label;
        const b = document.createElement("td"); b.className = "tr"; b.textContent = tr;
        row.append(a, b);
        table.appendChild(row);
      }
      status.textContent = `✓ Translated ${res.labels.length} label(s) — on-device.`;
    } catch (e) {
      status.textContent = "Translation failed: " + ((e && e.message) || e);
      go.disabled = false;
    }
  };
}

(async () => {
  const s = await chrome.storage.session.get([
    "ppf_filled", "ppf_name", "ppf_src", "ppf_vault", "ppf_mode", "ppf_xfa",
  ]);
  const name = s.ppf_name || "filled.pdf";

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
      await renderAndDownload(res.bytes, name);
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
    await renderAndDownload(b64ToBytes(s.ppf_filled), name);
  } catch (e) {
    stage.innerHTML = `<p style="color:#fff;padding:24px">Couldn't render the PDF: ${(e && e.message) || e}</p>`;
  }
  chrome.storage.session.remove("ppf_filled");
})();
