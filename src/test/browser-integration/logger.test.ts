import { expect, test } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer, type StaticServer } from "./static-server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

test.describe("browser integration demo", () => {
  let server: StaticServer;

  test.beforeAll(async () => {
    server = await startStaticServer(repoRoot);
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("module and IIFE bundles log with prefixes", async ({ page }) => {
    await page.addInitScript(() => {
      const logs: { method: string; text: string }[] = [];
      const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;

      for (const method of methods) {
        const original = console[method];
        if (typeof original !== "function") continue;

        const boundOriginal = original.bind(console);
        console[method] = (...args: Parameters<typeof boundOriginal>) => {
          logs.push({ method, text: args.map(String).join(" ") });
          return boundOriginal(...args);
        };
      }

      (globalThis as typeof globalThis & { __PLAYWRIGHT_LOGS__?: typeof logs }).__PLAYWRIGHT_LOGS__ = logs;
    });

    await page.goto(`${server.url}/demo`);

    await page.getByRole("button", { name: "Run module logs" }).click();
    await page.getByRole("button", { name: "Run IIFE logs" }).click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (globalThis as typeof globalThis & { __PLAYWRIGHT_LOGS__?: unknown[] }).__PLAYWRIGHT_LOGS__?.length ?? 0
        )
      )
      .toBeGreaterThanOrEqual(8);

    const logs = await page.evaluate(
      () => (globalThis as typeof globalThis & { __PLAYWRIGHT_LOGS__?: { text: string }[] }).__PLAYWRIGHT_LOGS__ ?? []
    );

    expect(logs.some((entry) => entry.text.includes("[module][module-demo] TRACE"))).toBeTruthy();
    expect(logs.some((entry) => entry.text.includes("[module][module-network] WARN"))).toBeTruthy();
    expect(logs.some((entry) => entry.text.includes("[iife][iife-demo] INFO"))).toBeTruthy();
    expect(logs.some((entry) => entry.text.includes("[iife][iife-ui] ERROR"))).toBeTruthy();
  });
});
