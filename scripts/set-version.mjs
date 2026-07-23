// Set the release version in ONE command, everywhere it is written.
//
// 1.0.0 is the baseline: it is what is published on the website and what the Chrome Web Store item
// is being brought up to. From here every release moves the number, because the store REFUSES an
// upload that reuses a published version — a release that forgets to bump is a release that cannot
// ship, and it fails late, at the upload, after everything else has already gone out.
//
// The version lives in five files. They drifted before (the installers on the download page
// reported 0.1.0 for a while because a bump touched the sites but the binaries were never rebuilt),
// so this writes all five and prints what changed.
//
//   node scripts/set-version.mjs 1.0.1     set an exact version
//   node scripts/set-version.mjs patch     1.0.0 -> 1.0.1
//   node scripts/set-version.mjs minor     1.0.0 -> 1.1.0
//   node scripts/set-version.mjs major     1.0.0 -> 2.0.0
//   node scripts/set-version.mjs --check   print the current versions and exit non-zero if they differ
//
// After bumping: rebuild BOTH artifacts, regenerate the release manifest, sync the winget hash,
// then publish. `docs/reference/releasing.md` has the order.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every place a version is written, with how to read and how to replace it.
const SITES = [
  { file: "package.json", re: /("version"\s*:\s*")([^"]+)(")/ },
  { file: "apps/app/package.json", re: /("version"\s*:\s*")([^"]+)(")/ },
  { file: "apps/extension/manifest.json", re: /("version"\s*:\s*")([^"]+)(")/ },
  { file: "apps/app/src-tauri/tauri.conf.json", re: /("version"\s*:\s*")([^"]+)(")/ },
  { file: "apps/app/src-tauri/Cargo.toml", re: /(^version\s*=\s*")([^"]+)(")/m },
];

const read = (s) => {
  const raw = readFileSync(join(root, s.file), "utf8");
  const m = s.re.exec(raw);
  if (!m) throw new Error(`no version found in ${s.file}`);
  return { raw, current: m[2] };
};

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/set-version.mjs <x.y.z|patch|minor|major|--check>");
  process.exit(2);
}

const found = SITES.map((s) => ({ ...s, ...read(s) }));

if (arg === "--check") {
  const versions = new Set(found.map((f) => f.current));
  for (const f of found) console.log(`  ${f.current.padEnd(10)} ${f.file}`);
  if (versions.size !== 1) {
    console.error(`\nVERSIONS DISAGREE: ${[...versions].join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll five agree: ${[...versions][0]}`);
  process.exit(0);
}

const base = found[0].current;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(base);
if (!m) throw new Error(`current version "${base}" is not x.y.z`);
let [maj, min, pat] = m.slice(1).map(Number);

let next;
if (arg === "patch") next = `${maj}.${min}.${pat + 1}`;
else if (arg === "minor") next = `${maj}.${min + 1}.0`;
else if (arg === "major") next = `${maj + 1}.0.0`;
else if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else throw new Error(`not a version or bump keyword: ${arg}`);

// Never go backwards: an older version cannot be uploaded to the store, and a downgrade on the
// download page silently strands anyone who already installed the newer one.
const cmp = (a, b) => {
  const A = a.split(".").map(Number), B = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
};
if (cmp(next, base) <= 0) {
  console.error(`refusing to set ${next}: it is not newer than the current ${base}`);
  process.exit(1);
}

for (const f of found) {
  writeFileSync(join(root, f.file), f.raw.replace(f.re, `$1${next}$3`));
  console.log(`  ${f.current} -> ${next}  ${f.file}`);
}

console.log(`\nVersion is now ${next}. Next:`);
console.log("  1. cd apps/app && pnpm exec tauri build");
console.log("  2. .\\deploy\\publish-extension.ps1 -NoPublish");
console.log("  3. copy the installer to docs/marketing/site/download/PolyglotFormFill-Setup.exe");
console.log("  4. node scripts/release-manifest.mjs generate --dir docs/marketing/site/download --version " + next);
console.log("  5. sync deploy/winget InstallerSha256, run node scripts/test-all.mjs");
console.log("  6. .\\deploy\\k8s\\publish-site.ps1 -WithBinaries   (this also submits to the Chrome Web Store)");
