// Record tutorial videos. Usage:
//   node docs/marketing/videos/record.mjs            # all scenes
//   node docs/marketing/videos/record.mjs camera pdf # only these (easy re-edit)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recordScene } from "./lib.mjs";

import fill from "./scenes/fill.mjs";
import camera from "./scenes/camera.mjs";
import pdf from "./scenes/pdf.mjs";
import vault from "./scenes/vault.mjs";
import backup from "./scenes/backup.mjs";

const ALL = { fill, camera, pdf, vault, backup };
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../site/tutorials/vid");
mkdirSync(OUT, { recursive: true });

const pick = process.argv.slice(2);
const scenes = (pick.length ? pick : Object.keys(ALL)).map((n) => ALL[n]).filter(Boolean);

const browser = await chromium.launch();
for (const scene of scenes) await recordScene(browser, scene, OUT);
await browser.close();
console.log("done ->", OUT);
