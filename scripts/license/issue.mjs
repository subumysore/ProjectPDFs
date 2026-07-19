// Issue a signed offline license token (manual / CLI). See sign.mjs for the format.
// Usage:
//   node scripts/license/issue.mjs --subject a@b.com --tier pro \
//     --features docx,ocr,translate --device <deviceId> --days 0
//   (--days 0 = perpetual)
import { signLicense } from "./sign.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

console.log(
  signLicense({
    subject: arg("subject", ""),
    tier: arg("tier", "pro"),
    features: arg("features", "docx,ocr,translate,companion,sign").split(",").filter(Boolean),
    device: arg("device", ""),
    issued_at: parseInt(arg("issued", "1000000000"), 10),
    days: parseInt(arg("days", "0"), 10),
  }),
);
