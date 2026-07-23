// Fetch Piper (free, on-device neural TTS) + the Amy voice, for building the guide-video narration.
//
//   node scripts/fetch-piper.mjs
//
// Piper is what gives the guide video a natural voice WITHOUT a cloud service or any cost - it runs
// entirely on this machine, which is the same on-device principle the product itself is built on.
// The binary and voice model are ~98 MB, so they are fetched here rather than committed
// (tools/piper is gitignored). build-guide-video.ps1 expects them at tools/piper/.
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "tools", "piper");
mkdirSync(dir, { recursive: true });

const PIPER_ZIP = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
const VOICE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx";
const VOICE_CFG = VOICE + ".json";

async function download(url, dest) {
  process.stdout.write(`  ${url.split("/").pop()} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await new Promise((resolve, reject) => {
    const f = createWriteStream(dest);
    Readable.fromWeb(res.body).pipe(f).on("finish", resolve).on("error", reject);
  });
  console.log("done");
}

if (existsSync(join(dir, "bin", "piper.exe"))) {
  console.log("Piper already present at tools/piper/bin/piper.exe");
} else {
  const zip = join(dir, "piper.zip");
  await download(PIPER_ZIP, zip);
  // The zip contains a top-level `piper/` folder; extract in place.
  execFileSync("powershell", [
    "-NoProfile", "-Command",
    `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${dir}'`,
  ], { stdio: "inherit" });
}

if (!existsSync(join(dir, "en_US-amy-medium.onnx"))) {
  await download(VOICE, join(dir, "en_US-amy-medium.onnx"));
  await download(VOICE_CFG, join(dir, "en_US-amy-medium.onnx.json"));
}

console.log("\nPiper ready at tools/piper/. Now run: powershell scripts/build-guide-video.ps1");
