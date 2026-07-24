// Professional narration via Microsoft Edge Neural TTS (edge-tts) — free, no API key, and far more
// natural than Piper. Voice: en-US-AndrewNeural ("warm, confident, authentic, honest"), slightly
// slowed for a calm delivery. Only narrates the MARKETING script (never user data). Output WAVs
// (loudness-normalised) replace the Piper ones at docs/guide/output/audio/<img-stem>.wav.
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PY = "C:/Users/Subramanya Mysore/tools/python312/python.exe";
const FF = "C:/Users/Subramanya Mysore/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";
const OUT = resolve(ROOT, "docs/guide/output/audio");
mkdirSync(OUT, { recursive: true });
const nar = JSON.parse(readFileSync(resolve(ROOT, "docs/guide/narration.json"), "utf8"));

const VOICE = "en-US-AndrewNeural";
const RATE = "-6%";   // calm, unhurried
for (const s of nar.segments) {
  const stem = s.img.replace(/\.[a-z0-9]+$/i, "");
  const mp3 = resolve(OUT, `${stem}.neural.mp3`);
  execFileSync(PY, ["-m", "edge_tts", "--voice", VOICE, `--rate=${RATE}`, "--text", s.text, "--write-media", mp3], { stdio: "ignore" });
  // Master to a clean, consistent broadcast level.
  execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=70",
    "-ar", "44100", "-ac", "1", resolve(OUT, `${stem}.wav`)], { stdio: "ignore" });
  process.stdout.write(`  ${stem}\n`);
}
console.log(`Done. Neural narration (${VOICE}) in ${OUT}`);
