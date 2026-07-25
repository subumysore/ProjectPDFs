// Flatten annotation OVERLAYS (freehand ink + placed signature/photo images, captured as a
// transparent PNG per page) onto a PDF via pdf-lib. The overlay for page N is drawn to cover
// that page exactly, so whatever the user drew/placed lands where they put it. On-device.
import { PDFDocument, degrees } from "../vendor/pdf-lib.esm.min.js";

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Compute the pdf-lib `drawImage` placement that makes a viewport-captured overlay land
 * upright and aligned on a page that carries a `/Rotate` entry.
 *
 * The overlay PNG is captured in the VIEWER's coordinate space — pdf.js has already applied
 * the page's `/Rotate`, so what the user draws on is the upright page (with width/height
 * swapped for 90°/270°). `drawImage`, however, bakes the pixels into the page's UNROTATED
 * user space; those baked pixels then become page content and are themselves rotated by
 * `/Rotate` at display time. Drawing the overlay naively at `{x:0,y:0,w,h}` therefore leaves
 * it rotated (upside-down for 180°, sideways + stretched for 90°/270°) relative to where the
 * user drew it. We pre-rotate/translate the image by the inverse of `/Rotate` so the two
 * rotations cancel. (Coordinate note: PDF user space is bottom-left origin, y-up; the viewer
 * is top-left, y-down — this is the y-axis conversion the naive version was missing.)
 *
 * @param {number} rot   page rotation in degrees (0 | 90 | 180 | 270), clockwise (/Rotate)
 * @param {number} w     unrotated MediaBox width
 * @param {number} h     unrotated MediaBox height
 * @returns {{x:number,y:number,width:number,height:number,rotate:number}}
 */
export function overlayPlacement(rot, w, h) {
  const r = ((Math.round(rot / 90) * 90) % 360 + 360) % 360;
  if (r === 90) return { x: w, y: 0, width: h, height: w, rotate: 90 };
  if (r === 180) return { x: w, y: h, width: w, height: h, rotate: 180 };
  if (r === 270) return { x: 0, y: h, width: h, height: w, rotate: 270 };
  return { x: 0, y: 0, width: w, height: h, rotate: 0 };
}

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
    const { width, height } = pages[i].getSize(); // UNROTATED MediaBox
    const rot = pages[i].getRotation().angle || 0; // /Rotate, applied by the viewer
    const p = overlayPlacement(rot, width, height);
    // Overlay maps 1:1 to the page AS THE USER SAW IT, honouring the page's /Rotate.
    pages[i].drawImage(png, { x: p.x, y: p.y, width: p.width, height: p.height, rotate: degrees(p.rotate) });
  }
  return doc.save();
}
