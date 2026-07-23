// Guards the winget manifests against drift from what we actually published (ADR-0020).
//
// winget verifies a download against InstallerSha256, so a stale hash there does not just look
// untidy — it makes `winget install` fail for every user. These hashes MUST equal the ones in
// release-manifest.json, which is generated from the real artifact bytes.
//
// Parsed with regex rather than a YAML dependency: the fields checked are flat scalars, and the
// manifests are additionally validated for real by `winget validate --manifest deploy/winget`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wingetDir = join(root, "deploy", "winget");
const ID = "SubramanyaMysore.PolyglotFormFill";

const read = (f) => readFileSync(join(wingetDir, f), "utf8");
const manifest = JSON.parse(
  readFileSync(join(root, "docs", "marketing", "site", "download", "release-manifest.json"), "utf8"),
);
const hashOf = (name) => manifest.artifacts.find((a) => a.name === name)?.sha256;

const FILES = [
  `${ID}.yaml`,
  `${ID}.locale.en-US.yaml`,
  `${ID}.installer.yaml`,
];

test("every winget manifest declares the same PackageVersion as the release manifest", () => {
  for (const f of FILES) {
    const v = read(f).match(/^PackageVersion:\s*(\S+)/m)?.[1];
    assert.equal(v, manifest.version, `${f} PackageVersion`);
  }
});

test("every winget manifest uses the same PackageIdentifier", () => {
  for (const f of FILES) {
    assert.equal(read(f).match(/^PackageIdentifier:\s*(\S+)/m)?.[1], ID, `${f} PackageIdentifier`);
  }
});

test("installer hashes match the published artifacts exactly", () => {
  const text = read(`${ID}.installer.yaml`);
  const entries = [...text.matchAll(/InstallerUrl:\s*(\S+)[\s\S]*?InstallerSha256:\s*(\S+)/g)];
  // The MSI is built but no longer hosted, so it cannot be offered here — winget validation
  // downloads InstallerUrl. Only the NSIS installer is published.
  assert.equal(entries.length, 1, "expected exactly the NSIS .exe");

  for (const [, url, sha] of entries) {
    const name = url.split("/").pop();
    const expected = hashOf(name);
    assert.ok(expected, `${name} is referenced by winget but absent from release-manifest.json`);
    // winget conventionally uppercases; compare case-insensitively.
    assert.equal(sha.toLowerCase(), expected, `SHA-256 drift for ${name}`);
  }
});

test("every published Windows installer is offered through winget", () => {
  const text = read(`${ID}.installer.yaml`);
  // Derived from the release manifest rather than hardcoded, so hosting a new installer without
  // adding it to winget fails here instead of being silently unavailable to winget users.
  const published = manifest.artifacts.map((a) => a.name).filter((n) => /\.(exe|msi)$/.test(n));
  assert.ok(published.length > 0, "no Windows installer is published at all");
  for (const name of published) {
    assert.ok(text.includes(name), `${name} is published but not offered via winget`);
  }
});

test("winget never references an installer we do not host", () => {
  const hosted = new Set(manifest.artifacts.map((a) => a.name));
  for (const [, url] of read(`${ID}.installer.yaml`).matchAll(/InstallerUrl:\s*(\S+)/g)) {
    const name = url.split("/").pop();
    assert.ok(hosted.has(name), `winget offers '${name}' but it is not in release-manifest.json`);
  }
});

test("installer URLs point at the public download host over HTTPS", () => {
  for (const [, url] of read(`${ID}.installer.yaml`).matchAll(/InstallerUrl:\s*(\S+)/g)) {
    assert.match(url, /^https:\/\/polyglotformfill\.mooo\.com\/download\//, url);
  }
});
