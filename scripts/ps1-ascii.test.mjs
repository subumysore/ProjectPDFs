// Guards every .ps1 in the repo against a real bug that broke `publish-site.ps1` on 2026-07-23.
//
// PowerShell 5.1 reads .ps1 files as ANSI (the system codepage) unless the file carries a BOM.
// A UTF-8 em dash (E2 80 94) therefore decodes as three CP1252 characters ending in 0x94 - a
// curly closing double-quote. Inside a COMMENT that is harmless noise; inside a STRING LITERAL
// it terminates the string early and the whole script fails to parse, with errors pointing at
// lines far from the real cause.
//
// So: non-ASCII is tolerated in comments (several pre-existing scripts have it and work), but
// forbidden on executable lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ps1Files = execFileSync("git", ["ls-files", "*.ps1"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** A line is "executable" if it has content before any `#`. Crude but right for this purpose:
 *  it errs toward flagging, and a false positive is fixed by writing ASCII, which is free. */
const isExecutable = (line) => {
  const beforeComment = line.split("#")[0];
  return beforeComment.trim().length > 0;
};

test("git tracks at least one .ps1 (guard is actually looking at something)", () => {
  assert.ok(ps1Files.length > 0, "no .ps1 files found - has the guard silently stopped working?");
});

// Stronger than the ASCII heuristic: ask PowerShell's own parser. Catches every syntax error,
// not just encoding damage. Windows-only, since it needs powershell.exe.
test("every .ps1 parses cleanly under PowerShell", { skip: process.platform !== "win32" }, () => {
  const script = `
    $bad = @()
    foreach ($f in @(${ps1Files.map((f) => `'${f}'`).join(",")})) {
      $errors = $null; $tokens = $null
      [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path $f).Path, [ref]$tokens, [ref]$errors) | Out-Null
      if ($errors.Count -gt 0) {
        $bad += "$f line $($errors[0].Extent.StartLineNumber): $($errors[0].Message)"
      }
    }
    $bad -join "\`n"
  `;
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(out, "", `PowerShell parse errors:\n${out}`);
});

test("no .ps1 has non-ASCII on an executable line", () => {
  const offenders = [];
  for (const file of ps1Files) {
    const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      // eslint-disable-next-line no-control-regex
      if (isExecutable(line) && /[^\x00-\x7F]/.test(line)) {
        offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "non-ASCII on an executable PowerShell line breaks parsing under PowerShell 5.1:\n" +
      offenders.join("\n"),
  );
});
