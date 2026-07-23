// Unit tests for the release integrity manifest (docs/specs/release-integrity.md, ADR-0020).
// Run standalone (`node --test scripts/release-manifest.test.mjs`) or via scripts/test-all.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SCHEMA,
  MANIFEST_NAME,
  sha256,
  listArtifacts,
  buildManifest,
  serializeManifest,
  verifyManifest,
} from "./release-manifest.mjs";

const dirs = [];
function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ppf-relman-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
process.on("exit", () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("sha256 matches the known vector for the empty input", () => {
  assert.equal(sha256(Buffer.alloc(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("artifacts are listed sorted, filtered by extension, excluding the manifest itself", () => {
  const dir = fixture({
    "z.msi": "z",
    "a.exe": "a",
    "m.zip": "m",
    "notes.txt": "ignored",
    [MANIFEST_NAME]: "{}",
  });
  assert.deepEqual(listArtifacts(dir), ["a.exe", "m.zip", "z.msi"]);
});

test("subdirectories are not treated as artifacts", () => {
  const dir = fixture({ "a.exe": "a" });
  mkdirSync(join(dir, "nested.zip"));
  assert.deepEqual(listArtifacts(dir), ["a.exe"]);
});

test("the manifest records schema, version, sizes and hashes, and is never marked signed", () => {
  const dir = fixture({ "Setup.exe": "hello" });
  const m = buildManifest({ dir, version: "1.0.0" });
  assert.equal(m.schema, SCHEMA);
  assert.equal(m.version, "1.0.0");
  // Never true without a CA-chained certificate — a self-signed build must not flip this.
  assert.equal(m.signed, false);
  assert.deepEqual(m.artifacts, [
    { name: "Setup.exe", bytes: 5, sha256: sha256(Buffer.from("hello")) },
  ]);
  assert.match(m.artifacts[0].sha256, /^[0-9a-f]{64}$/);
});

test("entries are sorted by name regardless of creation order", () => {
  const dir = fixture({ "z.msi": "z", "a.exe": "a" });
  assert.deepEqual(
    buildManifest({ dir, version: "1.0.0" }).artifacts.map((a) => a.name),
    ["a.exe", "z.msi"],
  );
});

test("serialization is byte-stable across runs on identical inputs", () => {
  const dir = fixture({ "a.exe": "a", "b.msi": "b" });
  const first = serializeManifest(buildManifest({ dir, version: "1.0.0" }));
  const second = serializeManifest(buildManifest({ dir, version: "1.0.0" }));
  assert.equal(first, second);
  assert.ok(first.endsWith("\n"));
});

test("an empty directory throws instead of publishing an empty manifest", () => {
  const dir = fixture({ "readme.txt": "no artifacts here" });
  assert.throws(() => buildManifest({ dir, version: "1.0.0" }), /no artifacts/i);
});

test("a missing version throws — it is never inferred", () => {
  const dir = fixture({ "a.exe": "a" });
  assert.throws(() => buildManifest({ dir, version: undefined }), /version is required/i);
});

test("verify reports OK for artifacts exactly as published", () => {
  const dir = fixture({ "a.exe": "a", "b.msi": "b" });
  const manifest = buildManifest({ dir, version: "1.0.0" });
  const { ok, results } = verifyManifest({ dir, manifest });
  assert.equal(ok, true);
  assert.deepEqual(results.map((r) => r.status), ["ok", "ok"]);
});

test("verify catches altered bytes as MISMATCH", () => {
  const dir = fixture({ "a.exe": "a" });
  const manifest = buildManifest({ dir, version: "1.0.0" });
  writeFileSync(join(dir, "a.exe"), "tampered");
  const { ok, results } = verifyManifest({ dir, manifest });
  assert.equal(ok, false);
  assert.deepEqual(results, [{ name: "a.exe", status: "mismatch" }]);
});

test("verify catches an absent artifact as MISSING", () => {
  const dir = fixture({ "a.exe": "a" });
  const manifest = buildManifest({ dir, version: "1.0.0" });
  rmSync(join(dir, "a.exe"));
  const { ok, results } = verifyManifest({ dir, manifest });
  assert.equal(ok, false);
  assert.deepEqual(results, [{ name: "a.exe", status: "missing" }]);
});

test("every problem is reported in a single pass, not just the first", () => {
  const dir = fixture({ "a.exe": "a", "b.msi": "b", "c.zip": "c" });
  const manifest = buildManifest({ dir, version: "1.0.0" });
  writeFileSync(join(dir, "b.msi"), "tampered");
  rmSync(join(dir, "c.zip"));
  const { ok, results } = verifyManifest({ dir, manifest });
  assert.equal(ok, false);
  assert.deepEqual(results, [
    { name: "a.exe", status: "ok" },
    { name: "b.msi", status: "mismatch" },
    { name: "c.zip", status: "missing" },
  ]);
});
