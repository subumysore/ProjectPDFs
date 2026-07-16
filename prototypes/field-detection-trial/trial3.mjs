import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';

const W = 900, H = 1100, blankX = 430, blankW = 380, rowH = 120, top = 200;
const expected = Array.from({ length: 6 }, (_, i) => top + i * rowH + 6);
const x0 = blankX - 30, x1 = blankX + blankW + 30, span = x1 - x0;

function rowDarkProfile(ctx) {
  const d = ctx.getImageData(0, 0, W, H).data;
  const prof = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2] < 120) c++;
    }
    prof[y] = c;
  }
  return prof;
}

function drawRotated(img, deg) {
  const c = createCanvas(W, H); const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.translate(W / 2, H / 2); x.rotate((deg * Math.PI) / 180); x.translate(-W / 2, -H / 2);
  x.drawImage(img, 0, 0, W, H);
  return c;
}

// Deskew: sweep small angles, pick the one whose row-profile has the sharpest peaks
// (aligned horizontal rules concentrate darkness into few rows → high peak).
function deskew(img) {
  let best = { deg: 0, score: -1 };
  for (let deg = -3; deg <= 3; deg += 0.25) {
    const ctx = drawRotated(img, deg).getContext('2d');
    const prof = rowDarkProfile(ctx);
    const peak = Math.max(...prof);
    if (peak > best.score) best = { deg, score: peak };
  }
  return best;
}

function detectUnderlines(ctx) {
  const prof = rowDarkProfile(ctx);
  const bands = [];
  let inB = false, start = 0;
  for (let y = 0; y < H; y++) {
    const isLine = prof[y] > span * 0.30;
    if (isLine && !inB) { inB = true; start = y; }
    else if (!isLine && inB) { inB = false; bands.push((start + y - 1) / 2); }
  }
  return bands;
}

async function run(file) {
  const img = await loadImage(fs.readFileSync(file));
  const sk = deskew(img);
  const corrected = drawRotated(img, -sk.deg); // rotate back by found skew
  const bands = detectUnderlines(corrected.getContext('2d'));
  const tol = rowH * 0.45;
  let hit = 0;
  for (const ey of expected) if (bands.some((b) => Math.abs(b - ey) < tol)) hit++;
  return { file, estSkewDeg: sk.deg, bands: bands.length, underlinesFound: hit, of: expected.length };
}

const out = [];
for (const f of ['moderate.jpg', 'nasty.jpg']) if (fs.existsSync(f)) out.push(await run(f));
console.log(JSON.stringify(out, null, 2));
