// The package we publish must be the package the Chrome Web Store will accept. Two ways that broke
// before this test existed:
//   1. Two different assemblers. deploy/publish-extension.ps1 kept its own copy of the file list,
//      which drifted from build-extension-zip.ps1 and did NOT strip the dev `key`. The store rejects
//      a package whose key differs from the item's own, so the zip served from the download page
//      would have failed on upload the moment store publishing was switched on.
//   2. A version the store has already published. Uploads are rejected outright.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publish = readFileSync(join(root, "deploy", "publish-extension.ps1"), "utf8");
const builder = readFileSync(join(root, "deploy", "build-extension-zip.ps1"), "utf8");
const store = readFileSync(join(root, "deploy", "publish-webstore.ps1"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "apps", "extension", "manifest.json"), "utf8"));

test("there is ONE assembler: the publish flow delegates to build-extension-zip.ps1", () => {
  assert.match(publish, /build-extension-zip\.ps1[\s\S]{0,12}-OutFile/,
    "publish-extension.ps1 must call build-extension-zip.ps1 rather than assembling its own zip");
  assert.ok(!/Compress-Archive/.test(publish),
    "publish-extension.ps1 is building its own archive again - the two file lists will drift");
});

test("the store package strips the dev key", () => {
  assert.match(builder, /Properties\.Remove\("key"\)/,
    "build-extension-zip.ps1 no longer strips the dev key; the store will reject the upload");
});

test("the published zip on disk, if present, has no key and no test files", () => {
  const zip = join(root, "docs", "marketing", "site", "download", "polyglotformfill-extension.zip");
  if (!existsSync(zip)) return; // nothing built yet on this machine - not a failure
  const listing = execFileSync("powershell", [
    "-NoProfile", "-Command",
    `Add-Type -A System.IO.Compression.FileSystem; ` +
    `$z=[IO.Compression.ZipFile]::OpenRead('${zip.replace(/'/g, "''")}'); ` +
    `$m=$z.GetEntry('manifest.json'); $r=New-Object IO.StreamReader($m.Open()); ` +
    `$json=$r.ReadToEnd(); $r.Close(); ` +
    `$names=($z.Entries | ForEach-Object { $_.FullName }) -join '|'; $z.Dispose(); ` +
    `Write-Output $json; Write-Output '---NAMES---'; Write-Output $names`,
  ], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });

  const [jsonPart, namesPart] = listing.split("---NAMES---");
  const zipManifest = JSON.parse(jsonPart);
  assert.ok(!("key" in zipManifest), "the published zip still contains the dev key - the store would reject it");
  assert.equal(zipManifest.version, manifest.version, "the zip's version does not match the source manifest");
  assert.ok(!/\.test\./.test(namesPart), "test files were packaged into the store zip");
});

test("the extension version is valid semver and at or above the 1.0.0 baseline", () => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
  assert.ok(m, `manifest version "${manifest.version}" is not x.y.z`);
  const [maj, min, pat] = m.slice(1).map(Number);
  assert.ok(maj > 1 || (maj === 1 && (min > 0 || pat >= 0)), "version fell below the 1.0.0 baseline");
});

test("the store publisher refuses to run without credentials, and never hard-codes them", () => {
  assert.match(store, /WEBSTORE_ITEM_ID/, "the item id must come from the environment");
  assert.match(store, /exit 0/, "a machine without credentials must not fail the publish");
  // A secret accidentally pasted into the script would look like one of these.
  assert.ok(!/[0-9a-f]{32}\b(?!.*ITEM_ID)/i.test(store.replace(/WEBSTORE_\w+/g, "")),
    "something that looks like a credential is hard-coded in publish-webstore.ps1");
  assert.ok(!/GOCSPX-|1\/\/0[\w-]{20,}/.test(store), "a Google client secret or refresh token is hard-coded");
});

test("all five version sites agree - a drifted version ships a wrong-version artifact", () => {
  const out = execFileSync("node", [join(root, "scripts", "set-version.mjs"), "--check"], { encoding: "utf8" });
  assert.match(out, /All five agree/, out);
});

test("the auth helper uses the loopback flow, not the dead out-of-band one", () => {
  const auth = readFileSync(join(root, "scripts", "webstore-auth.mjs"), "utf8");
  // Strip comments: the file explains the dead OOB flow, and the explanation must not be
  // mistaken for the flow itself.
  const code = auth
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(!code.includes("oauth:2.0:oob"),
    "the out-of-band redirect is rejected by Google for new OAuth clients");
  assert.ok(code.includes("127.0.0.1"), "a Desktop-app client must redirect to loopback");
  assert.ok(code.includes("access_type") && code.includes("offline"),
    "without access_type=offline Google returns no refresh token");
  assert.ok(code.includes("prompt") && code.includes("consent"),
    "a re-authorisation returns no refresh token without prompt=consent");
});

test("the consent URL is opened without a shell that would truncate it", () => {
  const auth = readFileSync(join(root, "scripts", "webstore-auth.mjs"), "utf8");
  const code = auth
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  // cmd.exe treats & as a command separator, so `cmd /c start <url>` delivers only the first
  // query parameter and Google answers "Required parameter is missing: response_type".
  assert.ok(!/spawn\(\s*"cmd"/.test(code), "opening the consent URL via cmd truncates it at the first &");
  assert.ok(code.includes("FileProtocolHandler"), "Windows must open the URL without shell parsing");
});

test("-Check verifies credentials without changing anything", () => {
  assert.ok(store.includes("[switch] $Check"), "publish-webstore.ps1 has no -Check mode");
  const checkBlock = store.slice(store.indexOf("if ($Check)"), store.indexOf("# --- 1."));
  assert.ok(checkBlock.length > 100, "the -Check block was not found");
  // It may GET. It must never PUT or POST to an items endpoint — that would upload or publish.
  assert.ok(!/Invoke-RestMethod\s+-Method\s+(Put|Post)[^\n]*items/i.test(checkBlock),
    "-Check must not upload or publish anything");
});

test("uploads go to the right Chrome Web Store endpoints", () => {
  assert.match(store, /upload\/chromewebstore\/v1\.1\/items\//, "wrong upload endpoint");
  assert.match(store, /chromewebstore\/v1\.1\/items\/\$itemId\/publish/, "wrong publish endpoint");
  assert.match(store, /oauth2\.googleapis\.com\/token/, "wrong token endpoint");
});
