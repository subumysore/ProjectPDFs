import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Tauri expects a fixed dev port and its own dist.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // SHARED ENGINE: the desktop consumes the extension's pure engine modules (resolver, langcodes,
  // proximity fill, detection, sign-flatten…) directly — one source of truth, no drift. Shared
  // modules that import the extension's VENDORED pdf-lib get the desktop's npm pdf-lib instead.
  resolve: { alias: { "@engine": fileURLToPath(new URL("../extension/src", import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
