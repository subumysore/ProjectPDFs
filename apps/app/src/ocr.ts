import { createWorker } from "tesseract.js";

// On-device OCR data-source extraction (REQ-10), fully SELF-HOSTED: the worker,
// WASM core, and language model are served from the app origin (public/tesseract),
// so connect-src stays 'self' — zero third-party egress. The image and text never
// leave the device. Recognised text maps to canonical ontology keys with simple,
// explainable patterns; the user reviews before saving to the vault.

export interface ExtractedField {
  ontology_key: string;
  value: string;
}

const TESS = "/tesseract";

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["full_name", /(?:full name|name)\s*[:\-]\s*([A-Z][A-Za-z .'-]{2,40})/i],
  ["date_of_birth", /(?:date of birth|dob|d\.o\.b)\s*[:\-]\s*(\d{1,2}[\/\-. ]\d{1,2}[\/\-. ]\d{2,4})/i],
  ["passport_no", /passport\s*(?:no|number)?\s*[:\-]\s*([A-Z0-9]{6,12})/i],
  ["nationality", /nationality\s*[:\-]\s*([A-Za-z ]{2,30})/i],
  ["address", /address\s*[:\-]\s*(.{4,60})/i],
];

/** OCR an image on-device and pull out recognised data points for user review. */
export async function extractFromImage(
  file: File | Blob,
  onProgress?: (pct: number) => void,
): Promise<{ text: string; fields: ExtractedField[] }> {
  const worker = await createWorker("eng", 1, {
    workerPath: `${TESS}/worker.min.js`,
    corePath: `${TESS}/`, // self-hosted core (tesseract-core-simd-lstm.*)
    langPath: `${TESS}/`, // self-hosted eng.traineddata.gz
    workerBlobURL: false, // load the worker same-origin (no blob: needed)
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) onProgress(Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(file);
    const text = data.text ?? "";
    const fields: ExtractedField[] = [];
    for (const [key, re] of PATTERNS) {
      const m = text.match(re);
      const value = m?.[1]?.trim();
      if (value) fields.push({ ontology_key: key, value });
    }
    return { text, fields };
  } finally {
    await worker.terminate();
  }
}
