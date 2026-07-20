// Renders the filled PDF to canvases with pdf.js so the result is ALWAYS visible
// (no dependency on Chrome's PDF plugin), and — for the OCR path — RUNS the OCR fill
// here in this persistent tab. Running OCR in the viewer (not the popup) means a
// closing popup can no longer interrupt a fill that takes several seconds per page.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");

const stage = document.getElementById("stage");
const barText = document.querySelector("#bar span");
const setBar = (t) => { if (barText) barText.textContent = t; };

function b64ToBytes(b64) {
  const bin = atob(b64);
  const d = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
  return d;
}

async function renderAndDownload(data, name) {
  const dl = document.getElementById("dl");
  // Copy the bytes first — getDocument may detach the buffer.
  dl.href = URL.createObjectURL(new Blob([data.slice()], { type: "application/pdf" }));
  dl.download = name;
  document.title = name;
  dl.click(); // auto-download the completed form
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1.5 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    c.className = "pg";
    stage.appendChild(c);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  }
}

function showEmpty(msg) {
  const el = document.getElementById("empty");
  if (msg) el.textContent = msg;
  el.hidden = false;
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
