import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer, type StaticServer } from "./static-server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const testStateKey = "__TS_SIMPLE_LOGGER_BROWSER_TEST__";

type BrowserLog = {
  method: string;
  text: string;
};

type ScenarioKind = "module" | "iife";

async function installLogCapture(page: Page) {
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
}

async function readLogs(page: Page): Promise<BrowserLog[]> {
  return page.evaluate(
    () => (globalThis as typeof globalThis & { __PLAYWRIGHT_LOGS__?: BrowserLog[] }).__PLAYWRIGHT_LOGS__ ?? []
  );
}

async function readScenarioState(page: Page): Promise<{ kind: string | null; status: string | null; error: string | null } | null> {
  return page.evaluate((key) => {
    const state = (globalThis as typeof globalThis & Record<string, unknown>)[key];
    if (!state || typeof state !== "object") return null;

    const typedState = state as { kind?: string | null; status?: string | null; error?: string | null };
    return {
      kind: typedState.kind ?? null,
      status: typedState.status ?? null,
      error: typedState.error ?? null
    };
  }, testStateKey);
}

function expectScenarioLogs(kind: ScenarioKind, logs: BrowserLog[]) {
  expect(logs.some((entry) => entry.text.includes(`[${kind}][browser-${kind}][${kind}-demo] TRACE: [${kind}-`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`[${kind}][browser-${kind}][${kind}-network] WARN: [${kind}-`))).toBeTruthy();
  expect(logs.some((entry) => entry.text === `${kind} edge no prefix`)).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`${kind} edge hidden warn`))).toBeFalsy();
  expect(logs.some((entry) => entry.text.includes(`[${kind}-edge-override] ERROR: [${kind}-`) && entry.text.includes(`${kind} edge error`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`caught invalid prefixEnabled: invalid prefixEnabled: "invalid_${kind}_prefix_enabled"`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid config object: invalid config: 0"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid logger config object: invalid config: false"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid prefixFormat: invalid prefixFormat: 123"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid placeholders: invalid placeholders: []"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid placeholder container: invalid placeholders: [object Map]"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes('caught invalid placeholder key: invalid placeholder key: "%app-name"'))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes('caught reserved placeholder key: reserved placeholder key: "%loggerName"'))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes('caught invalid placeholder value: invalid placeholder value for "%bad": 123'))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`[${kind}-validation][${kind}-validation] INFO: ${kind} validation still works`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`[${kind}-foreign][iframe][${kind}-foreign-realm] INFO: ${kind} foreign realm still works`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught foreign realm config:"))).toBeFalsy();
  expect(logs.some((entry) => entry.text.includes(`caught invalid config: invalid log level: "invalid_${kind}_level"`))).toBeTruthy();
}

const scenarios = [
  { kind: "module" as const, path: "/test-module", label: "ESM" },
  { kind: "iife" as const, path: "/test-iife", label: "IIFE" }
];

test.describe("ブラウザ統合テスト", () => {
  let server: StaticServer;

  test.beforeAll(async () => {
    server = await startStaticServer(repoRoot);
  });

  test.afterAll(async () => {
    await server.close();
  });

  for (const scenario of scenarios) {
    test(`出力した${scenario.label}バンドルの動作確認`, async ({ page, browserName }) => {
      await installLogCapture(page);
      await page.goto(`${server.url}${scenario.path}`);

      const browserVersion = page.context().browser()?.version() ?? "unknown";
      console.log(`ブラウザ情報(${scenario.kind}): ${browserName} ${browserVersion}`);

      await expect
        .poll(async () => {
          const state = await readScenarioState(page);
          if (!state) return "missing";
          if (state.error) return `error:${state.error}`;
          return state.status ?? "missing";
        })
        .toBe("done");

      const state = await readScenarioState(page);
      expect(state).toMatchObject({
        kind: scenario.kind,
        status: "done",
        error: null
      });

      const logs = await readLogs(page);
      console.log(`ブラウザログ(${scenario.kind}):`, logs.map((entry) => entry.text));

      expectScenarioLogs(scenario.kind, logs);
    });
  }
});
