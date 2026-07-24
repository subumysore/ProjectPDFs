#!/usr/bin/env node
// Automated guide-video build. ONE COMMAND rebuilds the whole narrated video + captions from
// pre-recorded segment clips and Amy narration — no manual editing.
//
//   node scripts/build-guide.mjs
//
// Inputs (data-driven, edit these — not this script):
//   docs/guide/guide-manifest.json         ordered [{id, caption}]; id -> raw/<id>.mp4 + audio/<id>.wav
//   docs/guide/output/raw/<id>.mp4          silent per-segment screen recording
//   docs/guide/output/audio/<id>.wav        Piper "Amy" narration for that segment
// Outputs:
//   docs/guide/output/video/PolyglotFormFill-guide.mp4    final video (H.264 + AAC)
//   docs/guide/output/captions/PolyglotFormFill-guide.en.srt   sentence-level English captions
//
// Each segment: video is scaled to the manifest width, run at the manifest fps, and its LAST FRAME
// is frozen to cover the narration length (so a short clip never cuts the voice off), then trimmed
// to exactly the audio duration. Segments are concatenated losslessly. Captions are split on
// sentence-ending punctuation (a URL like polyglotformfill.mooo.com stays intact) and timed by the
// running total. Deterministic: same inputs -> same output.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "docs/guide/output");
const M = JSON.parse(readFileSync(resolve(ROOT, "docs/guide/guide-manifest.json"), "utf8"));
const W = M.width || 1280, FPS = M.fps || 24;

const ff = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] });
const dur = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const fmt = (t) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

const tmp = resolve(OUT, ".build");
if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
for (const d of ["video", "captions"]) { const p = resolve(OUT, d); if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

const concat = [];
const cues = [];
let start = 0, n = 1, missing = [];

for (const seg of M.segments) {
  const v = resolve(OUT, "raw", `${seg.id}.mp4`);
  const a = resolve(OUT, "audio", `${seg.id}.wav`);
  if (!existsSync(v) || !existsSync(a)) { missing.push(seg.id); continue; }
  const d = dur(a);
  const outf = resolve(tmp, `${seg.id}.mux.mp4`);
  ff(["-i", v, "-i", a,
    "-filter_complex", `[0:v]scale=${W}:-2,fps=${FPS},tpad=stop_mode=clone:stop_duration=600[v]`,
    "-map", "[v]", "-map", "1:a", "-t", String(d),
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-b:a", "128k", outf]);
  concat.push(`file '${outf.replace(/\\/g, "/")}'`);
  // captions: split on sentence-ending punctuation FOLLOWED by whitespace/end (keeps URLs whole)
  const sents = seg.caption.match(/.+?[.!?]+(?=\s|$)/gs) || [seg.caption];
  const totalWords = sents.reduce((x, s) => x + s.trim().split(/\s+/).length, 0);
  let cur = start;
  for (const s of sents) {
    const w = s.trim().split(/\s+/).length;
    const cd = d * (w / totalWords);
    cues.push(`${n++}\n${fmt(cur)} --> ${fmt(cur + cd - 0.05)}\n${s.trim()}\n`);
    cur += cd;
  }
  start += d;
  process.stdout.write(`  ${seg.id}  ${d.toFixed(1)}s\n`);
}

if (missing.length) console.warn(`\n! Skipped (missing raw/audio): ${missing.join(", ")}`);

const listFile = resolve(tmp, "concat.txt");
writeFileSync(listFile, concat.join("\n"));
const video = resolve(OUT, "video/PolyglotFormFill-guide.mp4");
ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", video]);
writeFileSync(resolve(OUT, "captions/PolyglotFormFill-guide.en.srt"), cues.join("\n"));

console.log(`\n✔ ${dur(video).toFixed(1)}s / ${n - 1} cues`);
console.log(`  video    ${video}`);
console.log(`  captions ${resolve(OUT, "captions/PolyglotFormFill-guide.en.srt")}`);
