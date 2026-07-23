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
const TESS_LANG = "http://ppfmodel.localhost/tesseract";

const workers: Record<string, Promise<Worker>> = {};

/**
 * Get (or create) a cached worker for an ISO language code, e.g. "kn" → Tesseract "kan".
 * Falls back to English when the code is unknown.
 */
export function getTessWorker(iso = "en", onStatus?: (s: string) => void): Promise<Worker> {
  const pack: string = tessPack(iso) || "eng";
  if (!workers[pack]) {
    onStatus?.(`Preparing on-device OCR for '${pack}'…`);
    workers[pack] = createWorker(pack, 1, {
      workerPath: `${TESS_ENGINE}/worker.min.js`,
      corePath: `${TESS_ENGINE}/`,
      // English ships with the app; every other pack is read from app-data.
      langPath: pack === "eng" ? `${TESS_ENGINE}/` : TESS_LANG,
      workerBlobURL: false,
      gzip: true,
    }).catch((e) => {
      delete workers[pack]; // don't cache a failure — let the next attempt retry
      throw e;
    });
  }
  return workers[pack];
}
