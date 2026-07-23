// One command to test EVERYTHING that can be tested without a live browser/desktop window:
// the shared engine (covers BOTH apps), desktop-specific units, and that both apps build.
// Real E2E of the browser popup/viewer/sign UI and the Tauri window are NOT covered here
// (they need a live runtime) — those are tracked separately.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "apps", "extension");
const app = join(root, "apps", "app");
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
const testFiles = (cwd, sub = "src") =>
  readdirSync(join(cwd, sub)).filter((f) => f.endsWith(".test.mjs")).map((f) => sub + "/" + f);

const results = [];
function testSuite(name, cwd, sub) {
  const files = testFiles(cwd, sub);
  const r = run("node", ["--test", ...files], cwd); // explicit files — no shell glob needed
  const out = (r.stdout || "") + (r.stderr || "");
  const pass = (out.match(/# pass (\d+)/) || out.match(/pass (\d+)/) || [])[1] || "?";
  const fail = (out.match(/# fail (\d+)/) || out.match(/fail (\d+)/) || [])[1] || "?";
  const ok = fail === "0";
  results.push({ name, ok, detail: `${pass} pass / ${fail} fail` });
}
function step(name, cmd, args, cwd) {
  const r = run(cmd, args, cwd);
  results.push({ name, ok: r.status === 0, detail: r.status === 0 ? "ok" : `exit ${r.status}` });
}

console.log("Running the full automated suite…\n");
testSuite("Shared engine + extension unit/integration tests (covers BOTH apps)", ext);
testSuite("Desktop-specific unit tests", app);
testSuite("Release/build tooling unit tests", root, "scripts");
step("Desktop typecheck (tsc)", "npm", ["run", "typecheck"], app);
step("Desktop production build (vite)", "npx", ["vite", "build"], app);

console.log("\n──────── RESULTS ────────");
let allOk = true;
for (const r of results) { console.log(`${r.ok ? "✅" : "❌"}  ${r.name}  —  ${r.detail}`); allOk = allOk && r.ok; }
console.log("─────────────────────────");
console.log(allOk ? "ALL AUTOMATED CHECKS PASSED." : "SOME CHECKS FAILED.");
console.log("\nNOT covered (need a live runtime — tracked separately):");
console.log("  • Browser E2E: popup / viewer / sign UI in Chrome/Edge/Firefox");
console.log("  • Desktop E2E: the Tauri app window");
process.exit(allOk ? 0 : 1);
