import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync } from "node:fs";

// DEV-ONLY: serve the onnxruntime-web wasm glue from public/ort VERBATIM. onnxruntime dynamically
// import()s `/ort/ort-wasm-*.mjs`; Vite otherwise rewrites that with `?import` and fails to serve it,
// which breaks ALL on-device AI (translation, OCR, Granite) in `tauri dev`. The built app serves /ort
// statically, so this middleware only exists for the dev server.
function serveOrtRaw() {
  return {
    name: "serve-ort-raw",
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b?: unknown) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const m = req.url && req.url.match(/^\/ort\/([^?]+)/);
        if (!m) return next();
        const fp = fileURLToPath(new URL(`./public/ort/${m[1]}`, import.meta.url));
        if (!existsSync(fp)) return next();
        res.setHeader("Content-Type", m[1].endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(fp).pipe(res as unknown as NodeJS.WritableStream);
      });
    },
  };
}

// Tauri expects a fixed dev port and its own dist.
export default defineConfig({
  plugins: [react(), serveOrtRaw()],
  clearScreen: false,
  // SHARED ENGINE: the desktop consumes the extension's pure engine modules (resolver, langcodes,
  // proximity fill, detection, sign-flatten…) directly — one source of truth, no drift. Shared
  // modules that import the extension's VENDORED pdf-lib get the desktop's npm pdf-lib instead.
  resolve: { alias: { "@engine": fileURLToPath(new URL("../extension/src", import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
