// Professional narration via the ElevenLabs API. The API key is read from ELEVENLABS_API_KEY in the
// environment — NEVER hard-coded here or committed. Only the MARKETING script is sent (never user
// data). Output: loudness-normalised WAVs at docs/guide/output/audio/<img-stem>.wav.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error("Set ELEVENLABS_API_KEY in the environment."); process.exit(1); }
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FF = "C:/Users/Subramanya Mysore/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";
const OUT = resolve(ROOT, "docs/guide/output/audio");
mkdirSync(OUT, { recursive: true });
const nar = JSON.parse(readFileSync(resolve(ROOT, "docs/guide/narration.json"), "utf8"));

const VOICE = "nPczCjzI2devNBz1zQrb"; // Brian — Deep, Resonant and Comforting
const MODEL = "eleven_multilingual_v2";
for (const s of nar.segments) {
  const stem = s.img.replace(/\.[a-z0-9]+$/i, "");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: s.text,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) { console.error(`  ${stem}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`); process.exit(1); }
  const mp3 = resolve(OUT, `${stem}.11.mp3`);
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "1", resolve(OUT, `${stem}.wav`)], { stdio: "ignore" });
  process.stdout.write(`  ${stem}\n`);
}
console.log(`Done. ElevenLabs narration (Brian) in ${OUT}`);
