import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as vm from "node:vm";

type DistModule = Awaited<typeof import("../../../dist/index.js")>;
type CapturedConsoleEntry = {
  method: string;
  args: string[];
  text: string;
};

function createConsoleSpies() {
  const outputs: string[] = [];
  const entries: CapturedConsoleEntry[] = [];
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
        const stringArgs = args.map(String);
        const text = stringArgs.join(" ").trim();

        outputs.push([label, ...stringArgs].join(" ").trim());
        entries.push({ method: label, args: stringArgs, text });
      };

  console.log = capture("log");
  console.info = capture("info");
  console.warn = capture("warn");
  console.error = capture("error");
  console.debug = capture("debug");
  console.trace = capture("trace");

  return {
    outputs,
    entries,
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
  let entries: CapturedConsoleEntry[];
  let restoreConsole: () => void;

  beforeEach(() => {
    const spies = createConsoleSpies();
    outputs = spies.outputs;
    entries = spies.entries;
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
    const retainedDefaultLevelLogger = getLogger("node-retained-default-level");
    const retainedDefaultLevelFormatted = retainedDefaultLevelLogger.format("retained=%d");
    const retainedOverrideLevelLogger = getLogger("node-retained-override-level");
    const retainedOverrideLevelFormatted = retainedOverrideLevelLogger.format("retained=%d");
    const retainedDefaultPrefixLogger = getLogger("node-retained-default-prefix");
    const retainedDefaultPrefixFormatted = retainedDefaultPrefixLogger.format("retained=%s");
    const retainedOverridePrefixLogger = getLogger("node-retained-override-prefix");
    const retainedOverridePrefixFormatted = retainedOverridePrefixLogger.format("retained=%s");
    const retainedOverrideFormatLogger = getLogger("node-retained-override-format");
    const retainedOverrideFormatFormatted = retainedOverrideFormatLogger.format("retained-format=%s");
    const staleFormatLogger = getLogger("node-stale-format");
    const oldFormat = staleFormatLogger.format;

    logger.debug("debug line"); // tick-1
    logger.info("info line");   // tick-2
    logger.warn("warn line");   // tick-3
    logger.format("value=%s").info("ok", { formatted: true }); // tick-4
    setDefaultConfig({ level: "error" });
    retainedDefaultLevelFormatted.warn(10);
    retainedDefaultLevelFormatted.error(20); // tick-5
    setDefaultConfig({ level: "debug" });
    setLoggerLevel("node-retained-override-level", "error");
    retainedOverrideLevelFormatted.warn(30);
    retainedOverrideLevelFormatted.error(40); // tick-6
    setDefaultConfig({ prefixEnabled: false });
    retainedDefaultPrefixFormatted.info("default");
    oldFormat("stale=%d").info(1);
    staleFormatLogger.format("stale=%d").info(2);
    setDefaultConfig({ prefixEnabled: true });
    setLoggerConfig("node-retained-override-prefix", { prefixEnabled: false });
    retainedOverridePrefixFormatted.info("local");
    setLoggerConfig("node-retained-override-format", {
      prefixFormat: "[retained-format][%app-name][%loggerName][%logLevel]",
      placeholders: { "%app-name": "format-app" }
    });
    retainedOverrideFormatFormatted.info("updated");

    // 1: 関数プレースホルダーが毎回動的に評価されること
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][DEBUG][tick-1]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][INFO][tick-2]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][WARN][tick-3]"))).toBeTruthy();
    const formattedEntry = entries.find((entry) => entry.method === "info" && entry.args[0] === "%s value=%s" && entry.args[2] === "ok");
    expect(formattedEntry).toBeDefined();
    expect(formattedEntry!.args[1]).toContain("[node %][demo-app][node-test][INFO][tick-4]");
    expect(formattedEntry!.args[3]).toBe("[object Object]");
    expect(
      entries.some((entry) => entry.method === "warn" && entry.args[0] === "%s retained=%d" && entry.args[2] === "10")
    ).toBeFalsy();
    const retainedDefaultLevelEntry = entries.find(
      (entry) => entry.method === "error" && entry.args[0] === "%s retained=%d" && entry.args[2] === "20"
    );
    expect(retainedDefaultLevelEntry).toBeDefined();
    expect(retainedDefaultLevelEntry!.args[1]).toContain("[node %][demo-app][node-retained-default-level][ERROR][tick-5]");
    expect(
      entries.some((entry) => entry.method === "warn" && entry.args[0] === "%s retained=%d" && entry.args[2] === "30")
    ).toBeFalsy();
    const retainedOverrideLevelEntry = entries.find(
      (entry) =>
        entry.method === "error" &&
        entry.args[0] === "%s retained=%d" &&
        entry.args[1].includes("[node %][demo-app][node-retained-override-level][ERROR][tick-6]") &&
        entry.args[2] === "40"
    );
    expect(retainedOverrideLevelEntry).toBeDefined();
    expect(entries.some((entry) => entry.method === "info" && entry.args[0] === "retained=%s" && entry.args[1] === "default")).toBeTruthy();
    expect(entries.some((entry) => entry.method === "info" && entry.args[0] === "stale=%d" && entry.args[1] === "1")).toBeTruthy();
    expect(entries.some((entry) => entry.method === "info" && entry.args[0] === "stale=%d" && entry.args[1] === "2")).toBeTruthy();
    expect(
      entries.some((entry) => entry.method === "info" && entry.args[0] === "%s stale=%d" && (entry.args[2] === "1" || entry.args[2] === "2"))
    ).toBeFalsy();
    expect(entries.some((entry) => entry.method === "info" && entry.args[0] === "retained=%s" && entry.args[1] === "local")).toBeTruthy();
    const retainedOverrideFormatEntry = entries.find(
      (entry) => entry.method === "info" && entry.args[0] === "%s retained-format=%s" && entry.args[2] === "updated"
    );
    expect(retainedOverrideFormatEntry).toBeDefined();
    expect(retainedOverrideFormatEntry!.args[1]).toBe("[retained-format][format-app][node-retained-override-format][INFO]");

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
    setDefaultConfig({
      placeholders: { "%phase": null }
    });
    defaultMergeLogger.info("default placeholder delete works");
    expect(
      outputs.some((line) =>
        line.includes("[default-merge][merged-app][%phase][tick-") &&
        line.includes("[default-merge][INFO] default placeholder delete works")
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
    setLoggerConfig("logger-merge", {
      placeholders: { "%service": null }
    });
    loggerMergeLogger.info("logger placeholder delete works");
    expect(
      outputs.some((line) =>
        line.includes("[logger-merge][%service][warmup][tick-") &&
        line.includes("[logger-merge][INFO] logger placeholder delete works")
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

    setDefaultConfig({
      level: "error",
      prefixEnabled: false,
      prefixFormat: "[node-default-reset][%app-name][%loggerName][%logLevel]",
      placeholders: { "%app-name": "node-reset" }
    });
    setDefaultConfig({
      level: null,
      prefixEnabled: null,
      prefixFormat: null,
      placeholders: null
    });
    expect(getDefaultConfig()).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "(%loggerName) %logLevel:",
      placeholders: {}
    });
    const defaultResetLogger = getLogger("node-default-reset");
    defaultResetLogger.info("default reset works");
    expect(outputs.some((line) => line.includes("(node-default-reset) INFO: default reset works"))).toBeTruthy();

    setDefaultConfig({
      level: "debug",
      prefixEnabled: true,
      prefixFormat: format,
      placeholders: { "%app-name": "demo-app", "%tick": () => `tick-${++tick}` }
    });
    setLoggerConfig("node-validation", {
      level: "error",
      prefixEnabled: false,
      prefixFormat: "[node-validation-override][%app-name][%loggerName][%logLevel]",
      placeholders: { "%app-name": "svc-override", "%phase": "logger-reset" }
    });
    setLoggerConfig("node-validation", {
      level: null,
      prefixEnabled: null,
      prefixFormat: null,
      placeholders: null
    });
    expect(getLoggerOverrides("node-validation")).toEqual({});
    validationLogger.info("logger reset works");
    expect(
      outputs.some((line) =>
        line.includes("[node %][demo-app][node-validation][INFO][tick-") &&
        line.includes("logger reset works")
      )
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
