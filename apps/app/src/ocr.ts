import Tesseract from "tesseract.js";

// On-device OCR data-source extraction (REQ-10). Tesseract runs entirely in the
// webview (WASM); the image and text never leave the device. Recognised text is
// mapped to canonical ontology keys with simple, explainable patterns — the user
// reviews before saving to the vault. (Real extraction upgrades to a stronger
// on-device engine + layout model; this is the honest first cut.)

export interface ExtractedField {
  ontology_key: string;
  value: string;
}

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["full_name", /(?:full name|name)\s*[:\-]\s*([A-Z][A-Za-z .'-]{2,40})/i],
  ["date_of_birth", /(?:date of birth|dob|d\.o\.b)\s*[:\-]\s*(\d{1,2}[\/\-. ]\d{1,2}[\/\-. ]\d{2,4})/i],
  ["passport_no", /passport\s*(?:no|number)?\s*[:\-]\s*([A-Z0-9]{6,12})/i],
  ["nationality", /nationality\s*[:\-]\s*([A-Za-z ]{2,30})/i],
  ["address", /address\s*[:\-]\s*(.{4,60})/i],
];

/** OCR an image and pull out recognised data points (for user review before saving). */
export async function extractFromImage(
  file: File | Blob,
  onProgress?: (pct: number) => void,
): Promise<{ text: string; fields: ExtractedField[] }> {
  const { data } = await Tesseract.recognize(file, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) onProgress(Math.round(m.progress * 100));
    },
  });
  const text = data.text ?? "";
  const fields: ExtractedField[] = [];
  for (const [key, re] of PATTERNS) {
    const m = text.match(re);
    const value = m?.[1]?.trim();
    if (value) fields.push({ ontology_key: key, value });
  }
  return { text, fields };
}
