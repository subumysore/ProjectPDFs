import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';

// Expected underline y-positions from trial.mjs layout (clean coords).
const W = 900, H = 1100, blankX = 430, blankW = 380, rowH = 120, top = 200;
const expected = Array.from({ length: 6 }, (_, i) => top + i * rowH + 6);

// CV underline detector: find horizontal dark runs in the blank column band.
// This is script-INDEPENDENT — it does not care what the OCR text says.
function detectUnderlines(imgData) {
  const d = imgData.data;
  const x0 = blankX - 30, x1 = blankX + blankW + 30;
  const rowDark = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = x0; x < x1; x++) {
      const idx = (y * W + x) * 4;
      const lum = 0.3 * d[idx] + 0.59 * d[idx + 1] + 0.11 * d[idx + 2];
      if (lum < 120) c++;
    }
    rowDark[y] = c;
  }
  const span = x1 - x0;
  const bands = [];
  let inBand = false, start = 0;
  for (let y = 0; y < H; y++) {
    const isLine = rowDark[y] > span * 0.35; // >=35% of the band width is dark → a rule
    if (isLine && !inBand) { inBand = true; start = y; }
    else if (!isLine && inBand) { inBand = false; bands.push((start + y - 1) / 2); }
  }
  return bands;
}

async function run(file) {
  const img = await loadImage(fs.readFileSync(file));
  const c = createCanvas(W, H); const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.drawImage(img, 0, 0, W, H);
  const bands = detectUnderlines(x.getImageData(0, 0, W, H));
  // score: each expected underline "found" if a detected band is within tolerance
  const tol = rowH * 0.45;
  let hit = 0;
  for (const ey of expected) if (bands.some((b) => Math.abs(b - ey) < tol)) hit++;
  return { file, detectedBands: bands.length, underlinesFound: hit, of: expected.length };
}

const out = [];
for (const f of ['clean.png', 'moderate.jpg', 'nasty.jpg']) if (fs.existsSync(f)) out.push(await run(f));
console.log(JSON.stringify(out, null, 2));
