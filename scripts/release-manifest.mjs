// Release integrity manifest — generate and verify SHA-256 for every published artifact.
//
// We ship without a paid Authenticode certificate (ADR-0020), so a published hash IS the
// integrity guarantee we offer. It must therefore be trustworthy: deterministic, complete,
// and loud when anything is wrong. Spec: docs/specs/release-integrity.md
//
//   node scripts/release-manifest.mjs generate --dir <artifacts> --version 1.0.0 [--out <file>]
//   node scripts/release-manifest.mjs verify   --dir <artifacts> [--manifest <file>]
//
// Hashing runs locally over OUR OWN build outputs and sends nothing anywhere — no download
// telemetry is added or permitted (privacy invariant).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const SCHEMA = "ppf.release-manifest/1";
export const MANIFEST_NAME = "release-manifest.json";

/** Installer/bundle shapes we publish. Deliberately excludes .msix — it would require a
 *  commercially obtained certificate, the exact cost ADR-0020 avoids. */
const ARTIFACT_EXTENSIONS = [".exe", ".msi", ".zip"];

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Artifacts in `dir`, sorted by name. The manifest itself is never an artifact. */
export function listArtifacts(dir) {
  return readdirSync(dir)
    .filter((f) => f !== MANIFEST_NAME)
    .filter((f) => ARTIFACT_EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)))
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort();
}

/**
 * Build the manifest for `dir`. Throws on an empty directory rather than emitting a manifest
 * with zero artifacts — an empty manifest would silently advertise "nothing to verify".
 */
export function buildManifest({ dir, version }) {
  if (!version) throw new Error("release-manifest: --version is required (it is never inferred).");
  const names = listArtifacts(dir);
  if (names.length === 0) {
    throw new Error(
      `release-manifest: no artifacts (${ARTIFACT_EXTENSIONS.join(", ")}) found in '${dir}'. ` +
        "Refusing to write an empty manifest — build first.",
    );
  }
  return {
    schema: SCHEMA,
    version,
    // CA-chained Authenticode only. A self-signed build is NOT signed for this purpose and must
    // never flip this to true (ADR-0020).
    signed: false,
    artifacts: names.map((name) => {
      const bytes = readFileSync(join(dir, name));
      return { name, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
}

/** Serialize deterministically: identical inputs must produce byte-identical output. */
export const serializeManifest = (manifest) => JSON.stringify(manifest, null, 2) + "\n";

/**
 * Check `dir` against `manifest`. Reports EVERY problem, not just the first — someone checking
 * a download deserves the whole picture in one run.
 * @returns {{ok: boolean, results: Array<{name: string, status: "ok"|"mismatch"|"missing"}>}}
 */
export function verifyManifest({ dir, manifest }) {
  const results = manifest.artifacts.map(({ name, sha256: expected }) => {
    let actual;
    try {
      actual = sha256(readFileSync(join(dir, name)));
    } catch {
      return { name, status: "missing" };
    }
    return { name, status: actual === expected ? "ok" : "mismatch" };
  });
  return { ok: results.every((r) => r.status === "ok"), results };
}

// ---------------------------------------------------------------- CLI

const arg = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

function main(argv) {
  const cmd = argv[0];
  const dir = arg(argv, "--dir");
  if (!dir) throw new Error("release-manifest: --dir <artifacts directory> is required.");

  if (cmd === "generate") {
    const manifest = buildManifest({ dir, version: arg(argv, "--version") });
    const out = arg(argv, "--out") || join(dir, MANIFEST_NAME);
    writeFileSync(out, serializeManifest(manifest));
    console.log(`release-manifest: wrote ${out} (${manifest.artifacts.length} artifacts)`);
    for (const a of manifest.artifacts) console.log(`  ${a.sha256}  ${a.name}`);
    return 0;
  }

  if (cmd === "verify") {
    const file = arg(argv, "--manifest") || join(dir, MANIFEST_NAME);
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    const { ok, results } = verifyManifest({ dir, manifest });
    for (const r of results) console.log(`  ${r.status.toUpperCase().padEnd(8)} ${r.name}`);
    console.log(ok ? `release-manifest: OK (${basename(file)})` : "release-manifest: FAILED");
    return ok ? 0 : 1;
  }

  throw new Error(`release-manifest: unknown command '${cmd ?? ""}'. Use 'generate' or 'verify'.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
