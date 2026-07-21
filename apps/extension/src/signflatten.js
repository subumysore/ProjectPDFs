// Flatten annotation OVERLAYS (freehand ink + placed signature/photo images, captured as a
// transparent PNG per page) onto a PDF via pdf-lib. The overlay for page N is drawn to cover
// that page exactly, so whatever the user drew/placed lands where they put it. On-device.
import { PDFDocument } from "../vendor/pdf-lib.esm.min.js";

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * @param {Uint8Array} pdfBytes  original PDF
 * @param {Record<number,string>} overlays  pageIndex -> PNG data-URL (transparent annotation layer)
 * @returns {Promise<Uint8Array>} the annotated PDF
 */
export async function flattenOverlays(pdfBytes, overlays) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const [idx, dataUrl] of Object.entries(overlays || {})) {
    const i = +idx;
    if (!pages[i] || !dataUrl || !/^data:image\/png/i.test(dataUrl)) continue;
    const png = await doc.embedPng(b64ToBytes(dataUrl.split(",")[1] || ""));
    const { width, height } = pages[i].getSize();
    pages[i].drawImage(png, { x: 0, y: 0, width, height }); // overlay maps 1:1 to the page
  }
  return doc.save();
}
