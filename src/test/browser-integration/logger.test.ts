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
  args: string[];
  text: string;
};

type ScenarioKind = "module" | "iife";

async function installLogCapture(page: Page) {
  await page.addInitScript(() => {
    const logs: { method: string; args: string[]; text: string }[] = [];
    const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;

    for (const method of methods) {
      if (typeof console[method] !== "function") continue;

      console[method] = (...args: unknown[]) => {
        const stringArgs = args.map(String);
        logs.push({ method, args: stringArgs, text: stringArgs.join(" ") });
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
  expect(
    logs.some((entry) =>
      entry.method === "info" &&
      entry.args[0] === "%s value=%s" &&
      entry.args[1].includes(`[${kind}][browser-${kind}][${kind}-demo] INFO: [${kind}-`) &&
      entry.args[2] === "ok" &&
      entry.args[3] === "[object Object]"
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) => entry.method === "warn" && entry.args[0] === "%s retained=%d" && entry.args[2] === "10")
  ).toBeFalsy();
  expect(
    logs.some((entry) =>
      entry.method === "error" &&
      entry.args[0] === "%s retained=%d" &&
      entry.args[1].includes(`[${kind}][browser-${kind}][${kind}-retained-default-level] ERROR: [${kind}-`) &&
      entry.args[2] === "20"
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) => entry.method === "warn" && entry.args[0] === "%s retained=%d" && entry.args[2] === "30")
  ).toBeFalsy();
  expect(
    logs.some((entry) =>
      entry.method === "error" &&
      entry.args[0] === "%s retained=%d" &&
      entry.args[1].includes(`[${kind}][browser-${kind}][${kind}-retained-override-level] ERROR: [${kind}-`) &&
      entry.args[2] === "40"
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) => entry.method === "info" && entry.args[0] === "retained=%s" && entry.args[1] === "default")
  ).toBeTruthy();
  expect(
    logs.some((entry) => entry.method === "info" && entry.args[0] === "stale=%d" && entry.args[1] === "1")
  ).toBeTruthy();
  expect(
    logs.some((entry) => entry.method === "info" && entry.args[0] === "stale=%d" && entry.args[1] === "2")
  ).toBeTruthy();
  expect(
    logs.some((entry) => entry.method === "info" && entry.args[0] === "%s stale=%d" && (entry.args[2] === "1" || entry.args[2] === "2"))
  ).toBeFalsy();
  expect(
    logs.some((entry) => entry.method === "info" && entry.args[0] === "retained=%s" && entry.args[1] === "local")
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.method === "info" &&
      entry.args[0] === "%s retained-format=%s" &&
      entry.args[1] === `[retained-format][format-app][${kind}-retained-override-format][INFO]` &&
      entry.args[2] === "updated"
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(`[${kind}-default-merge][merged-${kind}][default-merge][${kind}-`) &&
      entry.text.includes(`[${kind}-default-merge] INFO: ${kind} default placeholder merge works`)
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(`[${kind}-default-merge][merged-${kind}][%phase][${kind}-`) &&
      entry.text.includes(`[${kind}-default-merge] INFO: ${kind} default placeholder delete works`)
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(`[${kind}-logger-merge][service-${kind}-v2][warmup][${kind}-`) &&
      entry.text.includes(`[${kind}-logger-merge] INFO: ${kind} logger placeholder merge works`)
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(`[${kind}-logger-merge][%service][warmup][${kind}-`) &&
      entry.text.includes(`[${kind}-logger-merge] INFO: ${kind} logger placeholder delete works`)
    )
  ).toBeTruthy();
  expect(logs.some((entry) => entry.text === `${kind} edge no prefix`)).toBeTruthy();
  expect(logs.some((entry) => entry.text === `%s  ${kind} resolved empty prefix`)).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`${kind} edge hidden warn`))).toBeFalsy();
  expect(logs.some((entry) => entry.text.includes(`[${kind}-edge-override] ERROR: [${kind}-`) && entry.text.includes(`${kind} edge error`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`caught invalid prefixEnabled: invalid prefixEnabled: "invalid_${kind}_prefix_enabled"`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid config object: invalid config: 0"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid logger config object: invalid config: false"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid prefixFormat: invalid prefixFormat: 123"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid placeholders: invalid placeholders: []"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught invalid placeholder container: invalid placeholders: [object Map]"))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes('caught invalid placeholder key: invalid placeholder key: "%app.name"'))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes('caught reserved placeholder key: reserved placeholder key: "%loggerName"'))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes('caught invalid placeholder value: invalid placeholder value for "%bad": 123'))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`[${kind}-validation][${kind}][${kind}-validation] INFO: ${kind} validation still works`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`(${kind}-default-reset) INFO: ${kind} default reset works`))).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(`[${kind}][browser-${kind}][${kind}-validation] INFO: [${kind}-`) &&
      entry.text.includes(`${kind} logger reset works`)
    )
  ).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes(`[${kind}-foreign][iframe][${kind}-foreign-realm] INFO: ${kind} foreign realm still works`))).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("caught foreign realm config:"))).toBeFalsy();
  expect(logs.some((entry) => entry.text.includes(`caught invalid config: invalid log level: "invalid_${kind}_level"`))).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(
        `[${kind}-default-snapshot][stable-default-${kind}][${kind}-default-snapshot-existing] INFO: ${kind} default snapshot existing`
      )
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(
        `[${kind}-default-snapshot][stable-default-${kind}][${kind}-default-snapshot-new] INFO: ${kind} default snapshot new`
      )
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(
        `[${kind}-override-snapshot][stable-override-${kind}][${kind}-override-snapshot] INFO: ${kind} override snapshot input`
      )
    )
  ).toBeTruthy();
  expect(
    logs.some((entry) =>
      entry.text.includes(
        `[${kind}-override-snapshot][stable-override-${kind}][${kind}-override-snapshot] INFO: ${kind} override snapshot getter`
      )
    )
  ).toBeTruthy();
  expect(logs.some((entry) => entry.text.includes("library defaults stable: info|true|(%loggerName) %logLevel:|{}"))).toBeTruthy();
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
