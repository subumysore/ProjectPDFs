// E2E for ADR-0031: does the REAL host binary serve the shared vault with the desktop app CLOSED?
//
// Speaks the actual native-messaging protocol (4-byte LE length + JSON over stdio) to the built
// projectpdfs-host.exe, against an ISOLATED vault (PPF_DATA_DIR), and checks the gate in every state:
//
//   1. app locked, not opted in            -> refused, with the old "open the desktop app" answer
//   2. app unlocked (fresh app sentinel)   -> served, no prompt (existing behaviour must not change)
//   3. app locked, live Hello window       -> served with the app CLOSED  <- the point of the change
//   4. app locked, Hello window expired    -> refused again
//
// Note on scope: the Windows Hello prompt itself needs a human finger/face, so this drives the states
// AROUND it (opt-in recorded, window fresh, window lapsed). Whether the biometric dialog appears is the
// one step that must be eyeballed once, by hand.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = process.argv[2] || "target/release/projectpdfs-host.exe";
const now = () => Math.floor(Date.now() / 1000);

function ask(dataDir, req) {
  return new Promise((resolve, reject) => {
    const p = spawn(HOST, [], { env: { ...process.env, PPF_DATA_DIR: dataDir }, stdio: ["pipe", "pipe", "pipe"] });
    const body = Buffer.from(JSON.stringify(req));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length);
    p.stdin.write(Buffer.concat([len, body]));
    p.stdin.end();
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("error", reject);
    p.on("close", () => {
      const out = Buffer.concat(chunks);
      if (out.length < 4) return resolve({ __raw: out.toString() });
      try { resolve(JSON.parse(out.subarray(4, 4 + out.readUInt32LE(0)).toString())); }
      catch (e) { resolve({ __parse_error: e.message, __raw: out.toString().slice(0, 200) }); }
    });
  });
}

const dir = mkdtempSync(join(tmpdir(), "ppf-bridge-e2e-"));
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}${detail ? "  — " + detail : ""}`); };

// The host must always answer a ping, so the extension can detect the bridge at all.
const ping = await ask(dir, { type: "ping" });
check("host answers ping", ping && ping.ok !== false, JSON.stringify(ping).slice(0, 80));

// 1. App locked, no opt-in, no window -> refused with the old guidance.
let r = await ask(dir, { type: "listProfiles" });
check("app closed + not opted in -> refused (old behaviour kept)", r && r.ok === false && r.locked === true, JSON.stringify(r).slice(0, 90));

// 2. App unlocked (fresh app sentinel) -> served, no Hello involved.
writeFileSync(join(dir, "app-session.flag"), String(now()));
r = await ask(dir, { type: "listProfiles" });
check("desktop app unlocked -> served with no prompt", r && r.ok === true && Array.isArray(r.profiles), JSON.stringify(r).slice(0, 90));
rmSync(join(dir, "app-session.flag"));

// 3. App CLOSED, but a live Hello-approved bridge window -> served. This is the new capability.
writeFileSync(join(dir, "bridge-session.flag"), String(now()));
r = await ask(dir, { type: "listProfiles" });
check("app CLOSED + live Hello window -> served (real vault read)", r && r.ok === true && Array.isArray(r.profiles), JSON.stringify(r).slice(0, 90));

// 4. The window lapses (16 minutes old) -> refused again, so presence must be re-proven.
writeFileSync(join(dir, "bridge-session.flag"), String(now() - 16 * 60));
r = await ask(dir, { type: "listProfiles" });
check("Hello window expired -> refused again", r && r.ok === false && r.locked === true, JSON.stringify(r).slice(0, 90));

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((x) => !x.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
