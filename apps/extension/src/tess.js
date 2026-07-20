// Shared on-device Tesseract OCR worker. Engine (worker + WASM core) is vendored in
// the extension; the ~11 MB English model is fetched once from our asset host, then
// cached (assets-DOWN only — no user content leaves the device). Used by both the PDF
// OCR fill and the camera/image key-value capture.
// The vendored build exposes ONLY a default export (the Tesseract namespace); there is
// no named `createWorker`. Importing it as a named binding throws a module-load error
// that silently kills every module in the import chain (capture page, PDF OCR).
import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
const createWorker = Tesseract.createWorker;

const TESS_BASE = chrome.runtime.getURL("vendor/tesseract/");
// Self-hosted English model (prefix PAR). Tesseract fetches `${langPath}/eng.traineddata.gz`.
const TESS_LANG =
  "https://objectstorage.us-ashburn-1.oraclecloud.com/p/Ut3vAQ-YK6VmAdptBynqsp7mnc1T5XBvjyAbMs76c0zsK8u6-A0cZBpQOkCBjdLC/n/idlqdkwlstnb/b/polyglotformfill-dl/o/tesseract";

let _worker = null;
export async function getTessWorker(onStatus) {
  if (_worker) return _worker;
  onStatus?.("preparing OCR engine (first run downloads the language model, then cached)…");
  _worker = await createWorker("eng", 1, {
    workerPath: `${TESS_BASE}worker.min.js`,
    corePath: TESS_BASE,
    langPath: TESS_LANG,
    workerBlobURL: false,
    gzip: true,
  });
  return _worker;
}
