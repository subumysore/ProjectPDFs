import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import fs from 'node:fs';

// Register a Japanese-capable font so the render isn't tofu.
for (const p of ['C:/Windows/Fonts/YuGothM.ttc', 'C:/Windows/Fonts/YuGothR.ttc', 'C:/Windows/Fonts/msgothic.ttc', 'C:/Windows/Fonts/meiryo.ttc']) {
  if (fs.existsSync(p)) { try { GlobalFonts.registerFromPath(p, 'JP'); break; } catch {} }
}
GlobalFonts.loadSystemFonts?.();

// ---- Ground truth: bilingual form. Each row = a label + a blank region to detect. ----
const ROWS = [
  { jp: '氏名',       en: 'Name',        key: 'name' },
  { jp: '生年月日',    en: 'Date of Birth', key: 'birth' },
  { jp: '国籍',       en: 'Nationality', key: 'nationality' },
  { jp: '住所',       en: 'Address',     key: 'address' },
  { jp: '電話番号',    en: 'Phone',       key: 'phone' },
  { jp: 'パスポート番号', en: 'Passport No', key: 'passport' },
];
const W = 900, H = 1100;
const labelX = 70, blankX = 430, blankW = 380, rowH = 120, top = 200;

function renderClean() {
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#111';
  x.font = '34px JP'; x.fillText('入国申請フォーム  Entry Application', labelX, 110);
  x.font = '26px JP';
  const truth = [];
  ROWS.forEach((r, i) => {
    const y = top + i * rowH;
    x.fillStyle = '#111';
    x.fillText(`${r.jp} / ${r.en}:`, labelX, y);
    x.strokeStyle = '#444'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(blankX, y + 6); x.lineTo(blankX + blankW, y + 6); x.stroke();
    // ground-truth blank region (where an input should be created), in clean coords
    truth.push({ key: r.key, en: r.en, x: blankX, y: y - 24, w: blankW, h: 34 });
  });
  return { canvas: c, truth };
}

// ---- Degrade to a worst-case scan: skew + downscale (low DPI) + noise + JPEG ----
function degrade(clean, { rotDeg, scale, noise, jpeg }) {
  // 1. skew
  const rc = createCanvas(W, H);
  const rx = rc.getContext('2d');
  rx.fillStyle = '#fff'; rx.fillRect(0, 0, W, H);
  rx.translate(W / 2, H / 2); rx.rotate((rotDeg * Math.PI) / 180); rx.translate(-W / 2, -H / 2);
  rx.drawImage(clean, 0, 0);
  // 2. downscale then upscale (simulate low DPI blur)
  const sw = Math.round(W * scale), sh = Math.round(H * scale);
  const small = createCanvas(sw, sh); small.getContext('2d').drawImage(rc, 0, 0, sw, sh);
  const up = createCanvas(W, H); const ux = up.getContext('2d'); ux.drawImage(small, 0, 0, W, H);
  // 3. gaussian-ish noise
  const img = ux.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * noise;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ux.putImageData(img, 0, 0);
  // 4. JPEG compression artifacts
  const buf = up.toBuffer('image/jpeg', jpeg);
  return buf;
}

// ---- Field detector (same heuristic family as the spike) ----
function looksLikeLabel(t) {
  t = t.trim();
  if (!t || t.length > 40) return false;
  if (/[:：]\s*$/.test(t) || /[_＿]{2,}/.test(t)) return true;
  return t.split(/\s+/).length <= 8 && !/[。.]\s*$/.test(t);
}
function detectFields(lines) {
  const out = [];
  for (const L of lines) {
    if (L.confidence < 30) continue;
    if (!looksLikeLabel(L.text)) continue;
    out.push({ text: L.text, x: L.x1 + 8, y: L.y0, w: Math.max(60, W - L.x1 - 20), h: Math.max(20, L.y1 - L.y0) });
  }
  return out;
}

async function ocr(buf) {
  const worker = await createWorker('eng+jpn');
  const { data } = await worker.recognize(buf, {}, { blocks: true });
  const lines = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? []) {
        const t = l.text.replace(/\s+/g, ' ').trim();
        if (t) lines.push({ text: t, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, confidence: l.confidence });
      }
  await worker.terminate();
  return lines;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9぀-ヿ一-龯]/g, '');
function scoreLabels(lines, truth) {
  let en = 0, jp = 0;
  for (const t of truth) {
    const joined = lines.map((l) => norm(l.text)).join(' ');
    if (joined.includes(norm(t.en))) en++;
    const row = ROWS.find((r) => r.key === t.key);
    if (row && norm(joined).includes(norm(row.jp))) jp++;
  }
  return { en, jp, total: truth.length };
}
function scoreDetection(fields, truth) {
  let hit = 0;
  for (const t of truth) {
    // a detected field "locates" a blank if some field's y-band overlaps and it starts left of the blank's right edge
    const ok = fields.some((f) => {
      const yov = Math.min(f.y + f.h, t.y + t.h) - Math.max(f.y, t.y);
      return yov > 8 && f.x < t.x + t.w && f.x + f.w > t.x;
    });
    if (ok) hit++;
  }
  return { hit, total: truth.length };
}

async function run(name, opts) {
  const { canvas, truth } = renderClean();
  if (opts) {
    const buf = degrade(canvas, opts);
    fs.writeFileSync(`${name}.jpg`, buf);
    const lines = await ocr(buf);
    return { name, lines: lines.length, labels: scoreLabels(lines, truth), detect: scoreDetection(detectFields(lines), truth), sample: lines.slice(0, 12).map((l) => `${Math.round(l.confidence)}%|${l.text}`) };
  } else {
    const buf = canvas.toBuffer('image/png'); fs.writeFileSync(`${name}.png`, buf);
    const lines = await ocr(buf);
    return { name, lines: lines.length, labels: scoreLabels(lines, truth), detect: scoreDetection(detectFields(lines), truth), sample: lines.slice(0, 12).map((l) => `${Math.round(l.confidence)}%|${l.text}`) };
  }
}

const results = [];
results.push(await run('clean', null));
results.push(await run('moderate', { rotDeg: 0.8, scale: 0.6, noise: 18, jpeg: 0.6 }));
results.push(await run('nasty', { rotDeg: 2.0, scale: 0.42, noise: 34, jpeg: 0.4 }));
console.log(JSON.stringify(results, null, 2));
