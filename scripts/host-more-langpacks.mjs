// Download trimmed opus-mt models from Hugging Face and upload them to Object Storage
// under models/Xenova/opus-mt-<pair>/resolve/main/ so the extension's translate.js can
// fetch them. Only the files transformers.js needs (tokenizer + encoder + merged decoder).
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const HF = "https://huggingface.co";
const NS = "idlqdkwlstnb";
const B = "polyglotformfill-dl";
const OCI = process.env.OCI_BIN || "oci";

const NEEDED = [
  "config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "vocab.json", "source.spm", "target.spm",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
];
const PAIRS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["en-es", "es-en", "en-fr", "fr-en", "en-de", "de-en", "en-zh", "zh-en", "en-ar", "ar-en", "en-ru", "ru-en"];

for (const pair of PAIRS) {
  const repo = `Xenova/opus-mt-${pair}`;
  let ok = 0;
  for (const rel of NEEDED) {
    const res = await fetch(`${HF}/${repo}/resolve/main/${rel}`);
    if (!res.ok) { console.log("  skip", pair, rel, res.status); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = `/tmp/mdl_${pair.replace(/\W/g, "")}_${rel.split("/").pop()}`;
    writeFileSync(tmp, buf);
    execFileSync(OCI, ["os", "object", "put", "-ns", NS, "-bn", B, "--name",
      `models/${repo}/resolve/main/${rel}`, "--file", tmp, "--force"], { stdio: "ignore" });
    rmSync(tmp);
    ok++;
  }
  console.log(`uploaded ${repo} (${ok}/${NEEDED.length} files)`);
}
console.log("ALL DONE");
