// Shared license signer (storefront side). Produces a token byte-compatible with the
// Rust core-license verifier. Reused by issue.mjs (manual) and webhook.mjs (automated).
import { createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
let _key;
// The private key file. Defaults to the gitignored vendor-key.json next to this script;
// override with LS_VENDOR_KEY_FILE (e.g. a secret mounted at deploy time, or a throwaway
// key in tests). The private key is NEVER committed and NEVER shipped in the app.
function vendorKeyFile() {
  return process.env.LS_VENDOR_KEY_FILE || join(dir, "vendor-key.json");
}
function vendorKey() {
  if (!_key) {
    const { jwk } = JSON.parse(readFileSync(vendorKeyFile(), "utf8"));
    _key = createPrivateKey({ key: jwk, format: "jwk" });
  }
  return _key;
}
// Test/DI hook: reset the memoized key (used after pointing LS_VENDOR_KEY_FILE elsewhere).
export function _resetVendorKey() {
  _key = undefined;
}

// EXACT field order must match the Rust License struct.
export function signLicense({
  subject,
  tier = "pro",
  features = ["docx", "ocr", "translate", "companion", "sign"],
  device = "",
  issued_at = 1_000_000_000,
  days = 0,
}) {
  const expires_at = days > 0 ? issued_at + days * 86400 : 0;
  const license = { subject, tier, features, issued_at, expires_at, device_id: device };
  const json = Buffer.from(JSON.stringify(license), "utf8");
  const sig = edSign(null, json, vendorKey());
  return `PPDF1.${json.toString("base64url")}.${Buffer.from(sig).toString("base64url")}`;
}
