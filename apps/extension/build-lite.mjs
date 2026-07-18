// Build a "lite" extension variant WITHOUT nativeMessaging / the companion bridge.
// Use this if Chrome review flags nativeMessaging — it's a standalone-only extension
// (passphrase/passkey vault + web-form autofill), no desktop companion.
// Output: a staging folder `dist-lite/` ready to zip (or already zipped if PowerShell
// Compress-Archive is available via the wrapper command).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ext = dirname(fileURLToPath(import.meta.url));
const out = join(ext, "dist-lite");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "src"), { recursive: true });

// 1) manifest: drop nativeMessaging + rename
const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
manifest.permissions = manifest.permissions.filter((p) => p !== "nativeMessaging");
manifest.name = "PolyglotFormFill Autofill";
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

// 2) copy static assets unchanged
for (const f of ["popup.html", "options.html", "icon16.png", "icon48.png", "icon128.png", "src/vault.js", "src/options.js"]) {
  copyFileSync(join(ext, f), join(out, f));
}

// 3) popup.html: remove the "Fill from native app" companion block
let popupHtml = readFileSync(join(out, "popup.html"), "utf8");
popupHtml = popupHtml.replace(
  /\s*<div style="border-top: 1px solid #e5e5e5;[\s\S]*?Uses the native app's vault[\s\S]*?<\/div>\s*<\/div>/,
  "",
);
writeFileSync(join(out, "popup.html"), popupHtml);

// 4) popup.js: strip the companion click handler
let popupJs = readFileSync(join(ext, "src/popup.js"), "utf8");
popupJs = popupJs.replace(
  /\n\/\/ Companion: fetch the vault[\s\S]*?setMsg\(`Filled \$\{await fillActivePage\(r\.vault\)\} field\(s\) from the native app\.`\);\n\};\n/,
  "\n",
);
writeFileSync(join(out, "src/popup.js"), popupJs);

// 5) background.js: strip the companion (native-messaging) code
let bg = readFileSync(join(ext, "src/background.js"), "utf8");
bg = bg.replace(/\n\/\/ Companion mode:[\s\S]*?^}\n/m, "\n"); // hostRequest + HOST const block
bg = bg.replace(/\s*case "companionPing":[\s\S]*?break;\n\s*}\n(?=\s*case "lock":|\s*default:)/, "\n");
bg = bg.replace(/\s*case "companionPing":[\s\S]*?sendResponse\(await hostRequest\([\s\S]*?break;\n/g, "\n");
writeFileSync(join(out, "src/background.js"), bg);

// sanity: no residual nativeMessaging references
const residual = ["connectNative", "companionVault", "nativeMessaging"].filter((s) =>
  [manifest, popupJs, bg].some((x) => JSON.stringify(x).includes(s)),
);
console.log("lite build written to", out);
console.log(residual.length ? `⚠ residual refs: ${residual.join(", ")}` : "✓ no nativeMessaging/companion refs remain");
