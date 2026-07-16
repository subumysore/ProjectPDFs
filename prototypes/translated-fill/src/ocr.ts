import Tesseract from 'tesseract.js';

export interface OcrLine {
  text: string;
  /** Bounding box in canvas pixels. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

/**
 * OCR a rendered page (canvas) and return recognized text LINES with pixel bboxes.
 * Tesseract downloads the language traineddata from its CDN on first run.
 */
export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  tessLang: string,
  onProgress?: (p: number) => void,
): Promise<OcrLine[]> {
  const worker = await Tesseract.createWorker(tessLang, undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const lines: OcrLine[] = [];
    // tesseract.js v5 exposes lines via data.blocks[].paragraphs[].lines[]
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          const t = line.text.replace(/\s+/g, ' ').trim();
          if (!t) continue;
          const b = line.bbox;
          lines.push({ text: t, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, confidence: line.confidence });
        }
      }
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}
