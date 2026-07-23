import { createWorker, type Worker } from "tesseract.js";
import { tessPack } from "@engine/langcodes.js";

/**
 * Shared on-device Tesseract worker factory — the desktop counterpart of the extension's
 * `tess.js`, so OCR is language-aware on BOTH platforms rather than English-only here.
 *
 * Engine (worker + WASM core) is served from the app origin (`public/tesseract`).
 * Language models are NOT embedded in the binary — bundling large assets is what
 * previously ballooned the build — they live in the app-data `models/tesseract/` dir and
 * are served through the `ppfmodel` scheme, exactly like the translation models.
 *
 * Privacy: every byte flows DOWNWARD (engine + model onto the device). The image and the
 * recognised text never leave the machine.
 */

const TESS_ENGINE = "/tesseract";
// The `ppfmodel` custom scheme maps to the app-data `models/` dir. On Windows the WebView
// addresses it as http://ppfmodel.localhost/… (see lib.rs).
const TESS_LANG_LOCAL = "http://ppfmodel.localhost/tesseract";
// A FRESH INSTALL has no packs in app-data, so fall back to our own asset host. Assets flow
// DOWN only — a public OCR model is fetched onto the device. No user content, form data, or
// identifier is ever sent, and the image and recognised text never leave the machine.
const TESS_LANG_HOSTED =
  "https://objectstorage.us-ashburn-1.oraclecloud.com/p/Ut3vAQ-YK6VmAdptBynqsp7mnc1T5XBvjyAbMs76c0zsK8u6-A0cZBpQOkCBjdLC/n/idlqdkwlstnb/b/polyglotformfill-dl/o/tesseract";

const workers: Record<string, Promise<Worker>> = {};

/**
 * Get (or create) a cached worker for an ISO language code, e.g. "kn" → Tesseract "kan".
 * Falls back to English when the code is unknown.
 */
export function getTessWorker(iso = "en", onStatus?: (s: string) => void): Promise<Worker> {
  const pack: string = tessPack(iso) || "eng";
  if (!workers[pack]) {
    onStatus?.(`Preparing on-device OCR for '${pack}'…`);
    const build = (langPath: string) =>
      createWorker(pack, 1, {
        workerPath: `${TESS_ENGINE}/worker.min.js`,
        corePath: `${TESS_ENGINE}/`,
        langPath,
        workerBlobURL: false,
        gzip: true,
      });
    // English ships with the app. Any other pack: prefer the copy already on this device,
    // and only reach out to our asset host when it isn't there (first use of a language).
    workers[pack] = (async () => {
      if (pack === "eng") return build(`${TESS_ENGINE}/`);
      try {
        return await build(TESS_LANG_LOCAL);
      } catch {
        onStatus?.(`Downloading the '${pack}' OCR model once — it is then kept on your device…`);
        return build(TESS_LANG_HOSTED);
      }
    })().catch((e) => {
      delete workers[pack]; // don't cache a failure — let the next attempt retry
      throw e;
    });
  }
  return workers[pack];
}
