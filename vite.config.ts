import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), ".");

export default defineConfig({
  resolve: {
    alias: {
      "@main": resolve(projectRoot, "src/main"),
      "@test": resolve(projectRoot, "src/test"),
    },
  },
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    minify: true,
    sourcemap: true,
    lib: {
      entry: resolve(projectRoot, "src/main/index.ts"),
      name: "TsSimpleLogger",
      fileName: (format) => format === "es" ? "index.js" : `index.${format}.js`,
      formats: ["es", "iife"],
    },
  }
});
