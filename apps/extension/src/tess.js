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

// One cached worker PER language pack (e.g. eng, kan, tam, hin, ara, chi_sim…). Packs are
// fetched on demand from our asset host (assets-DOWN only). This is what makes OCR universal:
// the caller passes the Tesseract pack for the detected/selected script (langcodes.tessPack).
// Fallback model source. Our own asset host is preferred, but when it is unreachable the
// multi-language packs simply never arrive and OCR silently stays English-only — which is
// exactly what happened in production. Falling back keeps the feature working.
// Privacy: this is an assets-DOWN fetch of a public OCR model. No user content, no form
// data, and no identifier is ever sent — the image and recognised text stay on-device.
const TESS_LANG_FALLBACK = "https://tessdata.projectnaptha.com/4.0.0";

const _workers = {};
export async function getTessWorker(lang = "eng", onStatus) {
  if (typeof lang === "function") { onStatus = lang; lang = "eng"; } // back-compat: (onStatus)
  lang = lang || "eng";
  if (_workers[lang]) return _workers[lang];
  onStatus?.(`preparing OCR for '${lang}' (first run downloads the language model, then cached)…`);
  const build = (langPath) => createWorker(lang, 1, {
    workerPath: `${TESS_BASE}worker.min.js`,
    corePath: TESS_BASE,
    langPath,
    workerBlobURL: false,
    gzip: true,
  });
  try {
    _workers[lang] = await build(TESS_LANG);
  } catch (e) {
    onStatus?.(`our model host is unreachable — fetching the '${lang}' OCR model from the public mirror…`);
    try {
      _workers[lang] = await build(TESS_LANG_FALLBACK);
    } catch (e2) {
      delete _workers[lang]; // never cache a failure
      throw e2;
    }
  }
  return _workers[lang];
}
