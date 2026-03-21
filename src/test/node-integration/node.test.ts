import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as vm from "node:vm";

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
    const {
      getLogger,
      setDefaultConfig,
      setLoggerConfig,
      setLoggerLevel,
      getDefaultConfig,
      getLoggerOverrides,
      getLibraryDefaults
    } = mod;

    let tick = 0;
    const format = "[node %%][%app-name][%loggerName][%logLevel][%tick]";

    setDefaultConfig({
      level: "debug",
      prefixEnabled: true,
      prefixFormat: format,
      placeholders: { "%app-name": "demo-app", "%tick": () => `tick-${++tick}` }
    });

    const logger = getLogger("node-test");
    logger.debug("debug line"); // tick-1
    logger.info("info line");   // tick-2
    logger.warn("warn line");   // tick-3

    // 1: 関数プレースホルダーが毎回動的に評価されること
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][DEBUG][tick-1]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][INFO][tick-2]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][WARN][tick-3]"))).toBeTruthy();

    setDefaultConfig({
      placeholders: { "%app-name": "merged-app", "%phase": "default-merge" },
      prefixFormat: "[default-merge][%app-name][%phase][%tick][%loggerName][%logLevel]"
    });
    const defaultMergeLogger = getLogger("default-merge");
    defaultMergeLogger.info("default placeholder merge works");
    expect(
      outputs.some((line) =>
        line.includes("[default-merge][merged-app][default-merge][tick-") &&
        line.includes("[default-merge][INFO] default placeholder merge works")
      )
    ).toBeTruthy();
    setLoggerConfig("logger-merge", {
      placeholders: { "%service": "api", "%phase": "warmup" },
      prefixFormat: "[logger-merge][%service][%phase][%tick][%loggerName][%logLevel]"
    });
    setLoggerConfig("logger-merge", {
      placeholders: { "%service": "api-v2" }
    });
    const loggerMergeLogger = getLogger("logger-merge");
    loggerMergeLogger.info("logger placeholder merge works");
    expect(
      outputs.some((line) =>
        line.includes("[logger-merge][api-v2][warmup][tick-") &&
        line.includes("[logger-merge][INFO] logger placeholder merge works")
      )
    ).toBeTruthy();
    setDefaultConfig({
      level: "debug",
      prefixEnabled: true,
      prefixFormat: format,
      placeholders: { "%app-name": "demo-app", "%tick": () => `tick-${++tick}` }
    });

    // 2: バリデーションチェック
    const validationLogger = getLogger("node-validation");
    setLoggerConfig("node-validation", {
      prefixFormat: "[node-validation][%app-name][%loggerName][%logLevel]",
      placeholders: { "%app-name": "svc" }
    });

    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setDefaultConfig({ prefixEnabled: "invalid_prefix_enabled_from_js" })).toThrow(
      "invalid prefixEnabled: \"invalid_prefix_enabled_from_js\""
    );
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setDefaultConfig(0)).toThrow("invalid config: 0");
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setLoggerConfig("node-validation", false)).toThrow("invalid config: false");
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setLoggerConfig("node-validation", { prefixFormat: 123 })).toThrow("invalid prefixFormat: 123");
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setDefaultConfig({ placeholders: [] })).toThrow("invalid placeholders: []");
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setDefaultConfig({ placeholders: new Map([["%app", "svc"]]) })).toThrow("invalid placeholders: [object Map]");
    expect(() => setLoggerConfig("node-validation", { placeholders: { "%app.name": "svc" } })).toThrow(
      "invalid placeholder key: \"%app.name\""
    );
    expect(() => setLoggerConfig("node-validation", { placeholders: { "%loggerName": "svc" } })).toThrow(
      "reserved placeholder key: \"%loggerName\""
    );
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setLoggerConfig("node-validation", { placeholders: { "%bad": 123 } })).toThrow(
      "invalid placeholder value for \"%bad\": 123"
    );

    validationLogger.info("validation still works");
    expect(
      outputs.some((line) => line.includes("[node-validation][svc][node-validation][INFO] validation still works"))
    ).toBeTruthy();

    const foreignRealmLogger = getLogger("node-foreign-realm");
    const foreignRealmConfig: Parameters<typeof setLoggerConfig>[1] = vm.runInNewContext(`({
      prefixEnabled: true,
      prefixFormat: "[node-foreign][%app][%loggerName][%logLevel]",
      placeholders: { "%app": "vm" }
    })`);

    expect(() => setLoggerConfig("node-foreign-realm", foreignRealmConfig)).not.toThrow();
    foreignRealmLogger.info("foreign realm still works");
    expect(
      outputs.some((line) => line.includes("[node-foreign][vm][node-foreign-realm][INFO] foreign realm still works"))
    ).toBeTruthy();

    // 3: プレフィックスの無効化
    const noPrefixLogger = getLogger("node-no-prefix");
    setDefaultConfig({ prefixEnabled: false });

    noPrefixLogger.info("raw line");
    expect(outputs.includes("info raw line")).toBeTruthy();

    setDefaultConfig({ prefixEnabled: true });
    const resolvedEmptyPrefixLogger = getLogger("node-resolved-empty-prefix");
    setLoggerConfig("node-resolved-empty-prefix", {
      prefixFormat: "%empty",
      placeholders: { "%empty": "" }
    });

    resolvedEmptyPrefixLogger.info("resolved empty prefix line");
    expect(outputs.includes("info %s  resolved empty prefix line")).toBeTruthy();

    // 4: グローバルレベル vs 個別ロガーの上書き
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

    // 5: バリデーションエラー処理
    // @ts-expect-error 型エラーを無視して不正な値を投入する
    expect(() => setDefaultConfig({ level: "invalid_level_from_js" })).toThrow("invalid log level: \"invalid_level_from_js\"");
    // @ts-expect-error 個別設定でも同様
    expect(() => setLoggerLevel("invalid-test", "invalid")).toThrow("invalid log level: \"invalid\"");

    // 6: getterの戻り値とsetLoggerConfig入力の後続変更が内部stateに漏れないこと
    setDefaultConfig({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "[default-snapshot][%app][%loggerName][%logLevel]",
      placeholders: { "%app": "stable-default" }
    });

    const existingDefaultSnapshotLogger = getLogger("default-snapshot-existing");
    const defaultSnapshot = getDefaultConfig() as {
      level: string;
      prefixEnabled: boolean;
      prefixFormat: string;
      placeholders: Record<string, string>;
    };
    defaultSnapshot.level = "error";
    defaultSnapshot.prefixEnabled = false;
    defaultSnapshot.prefixFormat = "[tampered-default][%app][%loggerName][%logLevel]";
    defaultSnapshot.placeholders["%app"] = "tampered-default";

    existingDefaultSnapshotLogger.info("default snapshot existing");
    const newDefaultSnapshotLogger = getLogger("default-snapshot-new");
    newDefaultSnapshotLogger.info("default snapshot new");

    expect(
      outputs.some((line) =>
        line.includes("[default-snapshot][stable-default][default-snapshot-existing][INFO] default snapshot existing")
      )
    ).toBeTruthy();
    expect(
      outputs.some((line) =>
        line.includes("[default-snapshot][stable-default][default-snapshot-new][INFO] default snapshot new")
      )
    ).toBeTruthy();

    const overrideInputPlaceholders = { "%app": "stable-override" };
    setLoggerConfig("override-snapshot", {
      prefixFormat: "[override-snapshot][%app][%loggerName][%logLevel]",
      placeholders: overrideInputPlaceholders
    });
    overrideInputPlaceholders["%app"] = "tampered-input";

    const overrideSnapshotLogger = getLogger("override-snapshot");
    overrideSnapshotLogger.info("override snapshot input");
    expect(
      outputs.some((line) =>
        line.includes("[override-snapshot][stable-override][override-snapshot][INFO] override snapshot input")
      )
    ).toBeTruthy();

    const overrideSnapshot = getLoggerOverrides("override-snapshot") as {
      prefixFormat?: string;
      placeholders?: Record<string, string>;
    };
    overrideSnapshot.prefixFormat = "[tampered-override][%app][%loggerName][%logLevel]";
    overrideSnapshot.placeholders!["%app"] = "tampered-override";

    setDefaultConfig({ level: "info" });
    overrideSnapshotLogger.info("override snapshot getter");
    expect(
      outputs.some((line) =>
        line.includes("[override-snapshot][stable-override][override-snapshot][INFO] override snapshot getter")
      )
    ).toBeTruthy();

    const libraryDefaults = getLibraryDefaults() as {
      level: string;
      prefixEnabled: boolean;
      prefixFormat: string;
      placeholders: Record<string, string>;
    };
    libraryDefaults.level = "error";
    libraryDefaults.prefixEnabled = false;
    libraryDefaults.prefixFormat = "[tampered-library]";
    libraryDefaults.placeholders["%app"] = "tampered-library";

    expect(getLibraryDefaults()).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "(%loggerName) %logLevel:",
      placeholders: {}
    });

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
