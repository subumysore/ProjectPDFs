// Renders the just-filled PDF (passed from the popup via session storage) to canvases
// with pdf.js, so the result is ALWAYS visible — no dependency on Chrome's PDF plugin.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");

(async () => {
  const stage = document.getElementById("stage");
  const { ppf_filled } = await chrome.storage.session.get("ppf_filled");
  if (!ppf_filled) {
    document.getElementById("empty").hidden = false;
    return;
  }
  const bin = atob(ppf_filled);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  // Download link (copy the bytes first — getDocument may detach the buffer).
  document.getElementById("dl").href = URL.createObjectURL(new Blob([data.slice()], { type: "application/pdf" }));
  try {
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
  } catch (e) {
    stage.innerHTML = `<p style="color:#fff;padding:24px">Couldn't render the PDF: ${(e && e.message) || e}</p>`;
  }
  chrome.storage.session.remove("ppf_filled");
})();
