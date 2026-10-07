import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The firmware's browser build, from the CMake build folder.
    alias: { "@firmware": `${repo}/build` },
  },
  server: { fs: { allow: [repo] } },
  worker: { format: "es" },
  // Emscripten's loader finds its wasm with new URL(…, import.meta.url), which pre-bundling would break.
  optimizeDeps: { exclude: ["@firmware/webluge_web.mjs"] },
});
