// Shared helpers for the modular tutorial-video system.
// Each scene lives in scenes/<name>.mjs and exports { name, width, height, html, drive }.
// record.mjs runs them (all, or a subset passed on the CLI) into site/tutorials/vid/.
import { renameSync } from "node:fs";
import { join } from "node:path";

// One shared visual language for every clip (teal brand).
export const CSS = `*{box-sizing:border-box;margin:0;font-family:'Segoe UI',system-ui,sans-serif}
  body{background:#eef4f3;height:100vh;display:grid;place-items:center;color:#0e1a1f}
  .card{background:#fff;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.12);padding:22px 26px}
  .badge{position:fixed;top:16px;left:16px;background:#0d8f83;color:#fff;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:700}
  .k{font-family:ui-monospace,monospace;color:#0a6a60}
  .btn{background:#0d8f83;color:#fff;padding:9px 16px;border-radius:8px;font-weight:600;display:inline-block}
  .fade{opacity:0;transition:opacity .5s,transform .5s;transform:translateY(8px)}
  .fade.in{opacity:1;transform:none}
  input{padding:10px 12px;border:1px solid #d6e2e0;border-radius:8px;font-size:15px}
  input.hot{border-color:#0d8f83;box-shadow:0 0 0 3px rgba(13,143,131,.18)}`;

// Small helpers scenes can use via the second arg to drive().
export function helpers(page) {
  return {
    wait: (ms) => page.waitForTimeout(ms),
    badge: (text) => page.evaluate((t) => { const b = document.getElementById("b"); if (b) b.textContent = t; }, text),
    show: (sel) => page.evaluate((s) => document.querySelectorAll(s).forEach((e) => e.classList.add("in")), sel),
    set: (sel, prop, val) => page.evaluate(({ s, p, v }) => document.querySelectorAll(s).forEach((e) => (e.style[p] = v)), { s: sel, p: prop, v: val }),
  };
}

export async function recordScene(browser, scene, outDir) {
  const { name, width, height, html, drive } = scene;
  const ctx = await browser.newContext({ viewport: { width, height }, recordVideo: { dir: outDir, size: { width, height } } });
  const page = await ctx.newPage();
  const video = page.video();
  await page.setContent(`<style>${CSS}</style>${html}`);
  await drive(page, helpers(page));
  await ctx.close();
  renameSync(await video.path(), join(outDir, `${name}.webm`));
  console.log("wrote", `${name}.webm`);
}
