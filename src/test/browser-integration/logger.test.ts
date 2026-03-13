import { expect, test } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer, type StaticServer } from "./static-server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

test.describe("ブラウザ統合テスト", () => {
  let server: StaticServer;

  test.beforeAll(async () => {
    server = await startStaticServer(repoRoot);
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("出力したモジュールとIIFEの動作確認", async ({ page, browserName }) => {
    await page.addInitScript(() => {
      const logs: { method: string; text: string }[] = [];
      const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;

      for (const method of methods) {
        if (typeof console[method] !== "function") continue;

        console[method] = (...args: unknown[]) => {
          logs.push({ method, text: args.map(String).join(" ") });
        };
      }

      (globalThis as typeof globalThis & { __PLAYWRIGHT_LOGS__?: typeof logs }).__PLAYWRIGHT_LOGS__ = logs;
    });

    await page.goto(`${server.url}/demo`);

    const browserVersion = page.context().browser()?.version() ?? "unknown";
    console.log(`ブラウザ情報: ${browserName} ${browserVersion}`);

    await page.getByRole("button", { name: "Run module logs" }).click();
    await page.getByRole("button", { name: "Run IIFE logs" }).click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (globalThis as typeof globalThis & { __PLAYWRIGHT_LOGS__?: unknown[] }).__PLAYWRIGHT_LOGS__?.length ?? 0
        )
      )
      .toBeGreaterThanOrEqual(10);

    const logs = await page.evaluate(
      () => (globalThis as typeof globalThis & { __PLAYWRIGHT_LOGS__?: { text: string }[] }).__PLAYWRIGHT_LOGS__ ?? []
    );

    console.log("ブラウザログ:", logs.map((entry) => entry.text));

    expect(logs.some((entry) => entry.text.includes("[module][browser-app][module-demo] TRACE: [module-"))).toBeTruthy();
    expect(logs.some((entry) => entry.text.includes("[module][browser-app][module-network] WARN: [module-"))).toBeTruthy();
    expect(logs.some((entry) => entry.text.includes("[iife][browser-iife][iife-demo] INFO: [iife-"))).toBeTruthy();
    expect(logs.some((entry) => entry.text.includes("[iife][browser-iife][iife-demo] WARN: [iife-"))).toBeTruthy();
    expect(logs.some((entry) => entry.text.includes("[iife][browser-iife][iife-ui] ERROR: [iife-"))).toBeTruthy();
  });
});
