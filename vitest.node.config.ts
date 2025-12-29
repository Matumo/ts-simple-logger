import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), ".");

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      "@main": resolve(projectRoot, "src/main"),
      "@test": resolve(projectRoot, "src/test")
    }
  },
  test: {
    environment: "node",
    include: ["src/test/node-integration/**/*.test.ts"],
    coverage: {
      enabled: false
    }
  }
});
