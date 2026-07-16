import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { ocrCanvas } from './ocr';
import { detectFields, slug, type DetectedField } from './fields';
import { translate, translateBatch } from './translate';
import { exportFilledPdf, type FilledField } from './exportPdf';
import { generateSampleJapanesePdf } from './sampleForm';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = 2; // canvas px per PDF point

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const log = (m: string) => {
  logEl.textContent += m + '\n';
  logEl.scrollTop = logEl.scrollHeight;
};

interface FieldUi extends DetectedField {
  input: HTMLInputElement;
}

const state: {
  bytes: ArrayBuffer | null;
  fields: FieldUi[];
} = { bytes: null, fields: [] };

function srcLangs(): { tess: string; iso: string } {
  const [tess, iso] = ($('srcLang') as HTMLSelectElement).value.split('|');
  return { tess: tess!, iso: iso! };
}
const userIso = () => ($('userLang') as HTMLSelectElement).value;
const apiKey = () => ($('apiKey') as HTMLInputElement).value.trim() || undefined;

async function loadBytes(bytes: ArrayBuffer) {
  state.bytes = bytes;
  state.fields = [];
  await renderFirstPage(bytes);
  ($('processBtn') as HTMLButtonElement).disabled = false;
  ($('exportBtn') as HTMLButtonElement).disabled = true;
  log('PDF loaded. Ready to OCR.');
}

async function renderFirstPage(bytes: ArrayBuffer): Promise<HTMLCanvasElement> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const wrap = $('canvasWrap');
  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  wrap.appendChild(canvas);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return canvas;
}

async function process() {
  if (!state.bytes) return;
  const { tess, iso } = srcLangs();
  const to = userIso();
  const canvas = $('canvasWrap').querySelector('canvas') as HTMLCanvasElement;

  log(`Running OCR (${tess})… first run downloads language data.`);
  const lines = await ocrCanvas(canvas, tess, (p) => {
    logEl.textContent = logEl.textContent!.replace(/OCR \d+%\n?$/, '');
    log(`OCR ${Math.round(p * 100)}%`);
  });
  log(`OCR found ${lines.length} lines.`);

  const detected = detectFields(lines, canvas.width);
  log(`Detected ${detected.length} field candidates.`);

  log(`Translating labels ${iso}→${to}…`);
  const map = await translateBatch(detected.map((f) => f.labelSource), iso, to, apiKey());

  const wrap = $('canvasWrap');
  wrap.querySelectorAll('.field').forEach((e) => e.remove());
  state.fields = detected.map((f) => {
    const translated = map.get(f.labelSource.trim()) ?? f.labelSource;
    const div = document.createElement('div');
    div.className = 'field';
    div.style.left = `${f.x}px`;
    div.style.top = `${f.y}px`;
    div.style.width = `${f.w}px`;
    div.style.height = `${f.h}px`;
    const label = document.createElement('label');
    label.textContent = translated;
    const input = document.createElement('input');
    input.placeholder = translated;
    div.append(label, input);
    wrap.appendChild(div);
    return { ...f, name: slug(translated), input };
  });

  ($('exportBtn') as HTMLButtonElement).disabled = false;
  log('Fields overlaid. Fill them, then export.');
}

async function exportPdf() {
  if (!state.bytes) return;
  const outMode = ($('outLang') as HTMLSelectElement).value; // 'user' | 'source'
  const { iso } = srcLangs();
  const to = userIso();
  const needsCjk = outMode === 'source' && iso === 'ja';

  log(`Preparing values (${outMode === 'source' ? `translate back ${to}→${iso}` : 'as typed'})…`);
  const filled: FilledField[] = [];
  for (const f of state.fields) {
    let value = f.input.value;
    if (value && outMode === 'source') value = await translate(value, to, iso, apiKey());
    filled.push({ ...f, value });
  }

  const bytes = await exportFilledPdf(state.bytes.slice(0), filled, RENDER_SCALE, needsCjk);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'filled.pdf';
  a.click();
  log('Exported filled.pdf ✓');
}

// --- wire up UI ---
$('file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) await loadBytes(await file.arrayBuffer());
});
$('sampleBtn').addEventListener('click', async () => {
  log('Generating sample Japanese form…');
  const bytes = await generateSampleJapanesePdf();
  await loadBytes(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
});
$('processBtn').addEventListener('click', () => process().catch((err) => log('ERROR: ' + err.message)));
$('exportBtn').addEventListener('click', () => exportPdf().catch((err) => log('ERROR: ' + err.message)));

log('Ready. Load a PDF or generate the sample.');
