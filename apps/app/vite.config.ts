import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Tauri expects a fixed dev port and its own dist.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // SHARED ENGINE: the desktop consumes the extension's pure engine modules (resolver, langcodes,
  // proximity fill, detection…) directly — one source of truth, so the two apps can never drift.
  resolve: { alias: { "@engine": fileURLToPath(new URL("../extension/src", import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
