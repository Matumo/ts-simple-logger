import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type DistModule = Awaited<typeof import("../../../dist/index.js")>;

function createConsoleSpies() {
  const outputs: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    trace: console.trace
  };

  const capture =
    (label: string) =>
      (...args: unknown[]) => {
        outputs.push([label, ...args.map(String)].join(" ").trim());
      };

  console.log = capture("log");
  console.info = capture("info");
  console.warn = capture("warn");
  console.error = capture("error");
  console.debug = capture("debug");
  console.trace = capture("trace");

  return {
    outputs,
    restore: () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
      console.trace = original.trace;
    }
  };
}

describe("Node統合テスト", () => {
  let outputs: string[];
  let restoreConsole: () => void;

  beforeEach(() => {
    const spies = createConsoleSpies();
    outputs = spies.outputs;
    restoreConsole = spies.restore;
  });

  afterEach(() => {
    restoreConsole?.();
  });

  const runBundleTest = async (loadModule: () => Promise<DistModule>) => {
    const mod: DistModule = await loadModule();
    const { getLogger, setDefaultConfig, setLoggerLevel } = mod;

    let tick = 0;
    const format = "[node %%][%app][%loggerName][%logLevel][%tick]";

    setDefaultConfig({
      level: "debug",
      prefixEnabled: true,
      prefixFormat: format,
      placeholders: { "%app": "demo-app", "%tick": () => `tick-${++tick}` }
    });

    const logger = getLogger("node-test");
    logger.debug("debug line"); // tick-1
    logger.info("info line");   // tick-2
    logger.warn("warn line");   // tick-3

    // 1: 関数プレースホルダーが毎回動的に評価されること
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][DEBUG][tick-1]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][INFO][tick-2]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][WARN][tick-3]"))).toBeTruthy();

    // 2: プレフィックスの無効化
    const noPrefixLogger = getLogger("node-no-prefix");
    setDefaultConfig({ prefixEnabled: false });

    noPrefixLogger.info("raw line");
    expect(outputs.some((line) => line === "info raw line")).toBeTruthy();

    // 3: グローバルレベル vs 個別ロガーの上書き
    setDefaultConfig({ level: "error", prefixEnabled: true });

    const overrideLogger = getLogger("override-test");
    setLoggerLevel("override-test", "debug");

    // グローバルがerror指定のため、warnは出力されないこと
    const globalLogger = getLogger("global-test");
    globalLogger.warn("should be filtered");
    expect(outputs.some((line) => line.includes("should be filtered"))).toBeFalsy();

    // 先に個別でerrorにしたノードテスト用ロガーも、同様にwarnが弾かれerrorのみが出力されること
    logger.warn("should be filtered 2");
    logger.error("boom");
    expect(outputs.some((line) => line.includes("should be filtered 2"))).toBeFalsy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][ERROR][") && line.includes("boom"))).toBeTruthy();

    // 個別レベルをdebugにしたロガーは、debugやinfoは出力され、traceは弾かれること
    overrideLogger.debug("override debug");
    overrideLogger.trace("override trace"); // traceはdebugにより弾かれる
    expect(outputs.some((line) => line.includes("[override-test][DEBUG]") && line.includes("override debug"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("override trace"))).toBeFalsy();

    // 4: バリデーションエラー処理
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setDefaultConfig({ level: "invalid_level_from_js" })).toThrow("invalid log level: \"invalid_level_from_js\"");
    // @ts-expect-error 個別設定でも同様
    expect(() => setLoggerLevel("invalid-test", "invalid")).toThrow("invalid log level: \"invalid\"");

    console.log("Nodeログ:", outputs);
  };

  it("出力したESMバンドルの動作確認", async () => {
    await runBundleTest(async () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const distUrl = pathToFileURL(path.resolve(__dirname, "../../../dist/index.js")).href;
      return import(distUrl);
    });
  });

  it("出力したCJSバンドルの動作確認", async () => {
    await runBundleTest(async () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const distPath = path.resolve(__dirname, "../../../dist/index.cjs");
      const require = createRequire(import.meta.url);
      return require(distPath);
    });
  });
});
