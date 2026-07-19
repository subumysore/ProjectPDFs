// Generate the vendor's Ed25519 licensing keypair (ONE TIME).
// The PUBLIC key gets embedded in the app/extension; the PRIVATE key stays secret
// (written to vendor-key.json, which is gitignored) and is used only by issue.mjs
// on the storefront side to sign license tokens.
//
// Usage:  node scripts/license/keygen.mjs
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, "vendor-key.json");
if (existsSync(out) && !process.argv.includes("--force")) {
  console.error(`Refusing to overwrite ${out} (pass --force to regenerate — this INVALIDATES all issued licenses).`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubJwk = publicKey.export({ format: "jwk" }); // { kty, crv, x }
const privJwk = privateKey.export({ format: "jwk" }); // { kty, crv, x, d }
const pubRaw = Buffer.from(pubJwk.x, "base64url"); // 32 bytes
const publicHex = pubRaw.toString("hex");

writeFileSync(out, JSON.stringify({ publicHex, jwk: privJwk }, null, 2));
console.log("Vendor keypair generated.");
console.log("Private key (SECRET) written to:", out, "— NEVER commit this.");
console.log("\nEmbed this PUBLIC key in the app/extension VENDOR_PUBLIC:\n");
console.log(publicHex);
