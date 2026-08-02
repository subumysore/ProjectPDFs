// Generate localized guide narration for ONE language from docs/guide/narration-i18n.json, using
// the language's edge-tts neural voice. Output WAVs (loudness-normalised) at output/audio-<lang>/.
//   node scripts/build-narration-lang.mjs <lang>
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PY = "C:/Users/Subramanya Mysore/tools/python312/python.exe";
const FF = "C:/Users/Subramanya Mysore/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";

const lang = process.argv[2];
if (!lang) { console.error("usage: node scripts/build-narration-lang.mjs <lang>"); process.exit(1); }
const I = JSON.parse(readFileSync(resolve(ROOT, "docs/guide/narration-i18n.json"), "utf8"));
const voice = I.voices?.[lang];
const segs = I.languages?.[lang]?.segments;
if (!voice || !segs) { console.error(`No voice/segments for '${lang}' in narration-i18n.json`); process.exit(1); }

const OUT = resolve(ROOT, `docs/guide/output/audio-${lang}`);
mkdirSync(OUT, { recursive: true });
for (const s of segs) {
  const stem = s.img.replace(/\.[a-z0-9]+$/i, "");
  const mp3 = resolve(OUT, `${stem}.neural.mp3`);
  execFileSync(PY, ["-m", "edge_tts", "--voice", voice, "--rate=+0%", "--text", s.text, "--write-media", mp3], { stdio: "ignore" });
  execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=70", "-ar", "44100", "-ac", "1",
    resolve(OUT, `${stem}.wav`)], { stdio: "ignore" });
  process.stdout.write(`  ${stem}\n`);
}
console.log(`Done. ${lang} narration (${voice}) in ${OUT}`);
