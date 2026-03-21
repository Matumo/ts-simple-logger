import * as vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { LogLevel } from "@main/index";

const originalConsole = globalThis.console;
let sut: typeof import("@main/index");

type DeferredPrefixArg = {
  toString: () => string;
};

type CallSpy = {
  mock: {
    calls: unknown[][];
  };
};

function alwaysTrue() {
  return true;
}

function restoreConsole(): void {
  globalThis.console = originalConsole;
  console.trace = originalConsole.trace;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
}

function stubConsoleMethod(method: "trace" | "debug" | "info" | "warn" | "error"): MockInstance {
  return vi.spyOn(console, method).mockImplementation(() => {});
}

function getDeferredPrefixArg(spy: CallSpy, callIndex: number, ...expectedArgs: unknown[]): DeferredPrefixArg {
  const call = spy.mock.calls[callIndex];
  if (!call) {
    throw new Error(`expected console call #${callIndex + 1}`);
  }

  expect(call[0]).toBe("%s");
  expect(call.slice(2)).toEqual(expectedArgs);

  const prefixArg = call[1];
  if (typeof prefixArg !== "object" || prefixArg === null) {
    throw new Error("expected deferred prefix object");
  }

  expect(Object.hasOwn(prefixArg, "toString")).toBe(true);
  expect(typeof (prefixArg as DeferredPrefixArg).toString).toBe("function");

  return prefixArg as DeferredPrefixArg;
}

function expectPrefixedConsoleCall(
  spy: CallSpy,
  callIndex: number,
  expectedPrefix: string,
  ...expectedArgs: unknown[]
): void {
  expect(getDeferredPrefixArg(spy, callIndex, ...expectedArgs).toString()).toBe(expectedPrefix);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  restoreConsole();
  vi.resetModules();
  sut = await import("@main/index");
});

describe("設定参照系", () => {
  it("ライブラリデフォルトがランタイムデフォルトとして複製される", () => {
    const library = sut.getLibraryDefaults();
    const defaults = sut.getDefaultConfig();

    expect(library).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "(%loggerName) %logLevel:",
      placeholders: {},
    });
    expect(defaults).toEqual(library);
    expect(defaults).not.toBe(library);
    expect(sut.getLoggerOverrides("no-overrides-logger")).toEqual({});
    expect(sut.getEffectiveLoggerConfig("no-overrides-logger")).toEqual(library);
  });

  it("デフォルトと個別設定をマージした内容を返す", () => {
    sut.setDefaultConfig({
      level: "warn",
      prefixFormat: "[%loggerName] %logLevel",
      placeholders: { "%app": "root", "%shared": "base" },
    });
    sut.setLoggerConfig("api", {
      level: "debug",
      prefixEnabled: false,
      placeholders: { "%app": "svc", "%local": "x" },
    });

    expect(sut.getEffectiveLoggerConfig("api")).toEqual({
      level: "debug",
      prefixEnabled: false,
      prefixFormat: "[%loggerName] %logLevel",
      placeholders: { "%app": "svc", "%shared": "base", "%local": "x" },
    });
  });
});

describe("モジュール再インポート", () => {
  it("複数回インポートしても状態が維持される", async () => {
    sut.setDefaultConfig({ level: "debug" });
    const logger = sut.getLogger("multi");

    const reimported = await import("@main/index");

    expect(reimported.getDefaultConfig().level).toBe("debug");
    expect(reimported.getLogger("multi")).toBe(logger);
  });
});

describe("ロガー生成とバリデーション", () => {
  it("無効なロガー名は拒否する", () => {
    expect(() => sut.getLogger("")).toThrow("logger name must be a non-empty string");
  });
  it("ロガーをキャッシュする", () => {
    const first = sut.getLogger("core");
    const second = sut.getLogger("core");
    expect(second).toBe(first);
  });
});

describe("ログ出力の挙動", () => {
  it("ハイフンを含むプレースホルダーとエスケープを含むプレフィックスを整形する", () => {
    sut.setDefaultConfig({
      prefixFormat: "[%%][%loggerName][%logLevel][%app-name][%custom-value][%missing]",
      placeholders: { "%app-name": "root", "%custom-value": "default" }
    });
    sut.setLoggerConfig("svc", { placeholders: { "%custom-value": "override" } });

    const infoSpy = stubConsoleMethod("info");
    const logger = sut.getLogger("svc");
    logger.info("payload");

    expectPrefixedConsoleCall(infoSpy, 0, "[%][svc][INFO][root][override][%missing]", "payload");
  });

  it("プレースホルダー関数は遅延評価用の引数として渡され、評価結果も正しい", () => {
    let counter = 0;
    const counterFn = vi.fn(() => `tick-${++counter}`);

    sut.setDefaultConfig({
      prefixFormat: "[%counter]",
      placeholders: { "%counter": counterFn }
    });

    const infoSpy = stubConsoleMethod("info");
    const logger = sut.getLogger("dynamic");

    logger.info("a");
    logger.info("b");

    expect(counterFn).not.toHaveBeenCalled();
    const firstPrefixArg = getDeferredPrefixArg(infoSpy, 0, "a");
    const secondPrefixArg = getDeferredPrefixArg(infoSpy, 1, "b");

    expect(firstPrefixArg.toString()).toBe("[tick-1]");
    expect(secondPrefixArg.toString()).toBe("[tick-2]");
    expect(counterFn).toHaveBeenCalledTimes(2);
  });

  it("プレフィックス無効時はラベルを付けずメッセージのみ出力する", () => {
    const infoSpy = vi.spyOn(console, "info");
    const logger = sut.getLogger("api");

    sut.setDefaultConfig({ prefixEnabled: false });
    logger.info("no prefix");

    expect(infoSpy).toHaveBeenCalledWith("no prefix");
  });

  it("プレフィックスが空文字でもprefixEnabledがtrueならプレフィックス経由で出力する", () => {
    sut.setDefaultConfig({ prefixFormat: "" });
    const infoSpy = stubConsoleMethod("info");
    const logger = sut.getLogger("empty-prefix");

    logger.info("payload");

    expectPrefixedConsoleCall(infoSpy, 0, "", "payload");
  });

  it("プレースホルダー展開後にプレフィックスが空文字でもプレフィックス経由で出力する", () => {
    const prefixFn = vi.fn<() => string>()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("[shown]");
    sut.setDefaultConfig({
      prefixFormat: "%dynamic",
      placeholders: { "%dynamic": prefixFn }
    });

    const infoSpy = stubConsoleMethod("info");
    const logger = sut.getLogger("resolved-empty-prefix");

    logger.info("first");
    logger.info("second");

    expectPrefixedConsoleCall(infoSpy, 0, "", "first");
    expectPrefixedConsoleCall(infoSpy, 1, "[shown]", "second");
    expect(prefixFn).toHaveBeenCalledTimes(2);
  });

  it("ログレベルの動作確認", () => {
    const LEVEL_ORDER: Record<LogLevel, number> = {
      trace: 10,
      debug: 20,
      info: 30,
      warn: 40,
      error: 50,
      silent: 100,
    };

    const expectCall = (spy: MockInstance, logLevel: LogLevel, baseLevel: LogLevel, ...args: unknown[]): void => {
      if (LEVEL_ORDER[baseLevel] <= LEVEL_ORDER[logLevel]) {
        expectPrefixedConsoleCall(spy, 0, String(args[0]), ...args.slice(1));
      }
      else expect(spy).not.toHaveBeenCalled();
    };

    const levels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "silent"];

    for (const baseLevel of levels) {
      const traceSpy = stubConsoleMethod("trace");
      const debugSpy = stubConsoleMethod("debug");
      const infoSpy = stubConsoleMethod("info");
      const warnSpy = stubConsoleMethod("warn");
      const errorSpy = stubConsoleMethod("error");

      sut.setLogLevel(baseLevel);
      const logger = sut.getLogger(`LogLevel-${baseLevel}`);
      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expectCall(traceSpy, "trace", baseLevel, `(LogLevel-${baseLevel}) TRACE:`, "t");
      expectCall(debugSpy, "debug", baseLevel, `(LogLevel-${baseLevel}) DEBUG:`, "d");
      expectCall(infoSpy, "info", baseLevel, `(LogLevel-${baseLevel}) INFO:`, "i");
      expectCall(warnSpy, "warn", baseLevel, `(LogLevel-${baseLevel}) WARN:`, "w");
      expectCall(errorSpy, "error", baseLevel, `(LogLevel-${baseLevel}) ERROR:`, "e");

      traceSpy.mockRestore();
      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("ロガー個別設定の更新を再適用する", () => {
    const infoSpy = stubConsoleMethod("info");
    const logger = sut.getLogger("custom");

    sut.setLoggerConfig("custom", { prefixFormat: "<%loggerName|%logLevel>" });
    logger.info("configured");

    expectPrefixedConsoleCall(infoSpy, 0, "<custom|INFO>", "configured");
    expect(sut.getLoggerOverrides("custom").prefixFormat).toBe("<%loggerName|%logLevel>");
  });

  it("setLoggerLevelでデフォルトよりも緩いレベルに個別上書きできる", () => {
    sut.setLogLevel("error");
    sut.setLoggerLevel("override-level", "debug");

    const debugSpy = stubConsoleMethod("debug");
    const warnSpy = stubConsoleMethod("warn");
    const logger = sut.getLogger("override-level");

    logger.debug("allowed");
    logger.warn("also allowed");

    expectPrefixedConsoleCall(debugSpy, 0, "(override-level) DEBUG:", "allowed");
    expectPrefixedConsoleCall(warnSpy, 0, "(override-level) WARN:", "also allowed");
  });

  it("エラーレベル時はwarnを無効化しerrorは通す", () => {
    sut.setLogLevel("error");
    const warnSpy = stubConsoleMethod("warn");
    const errorSpy = stubConsoleMethod("error");

    const logger = sut.getLogger("errors-only");
    logger.warn("skip");
    logger.error("recorded");

    expect(warnSpy).not.toHaveBeenCalled();
    expectPrefixedConsoleCall(errorSpy, 0, "(errors-only) ERROR:", "recorded");
  });

  it("特定のconsoleメソッド未定義時はconsole.logにフォールバックする", () => {
    const logSpy = vi.fn();
    // @ts-expect-error override console for test
    console.trace = undefined;
    console.log = logSpy;

    sut.setLogLevel("trace");
    const logger = sut.getLogger("fallback");
    logger.trace("using log");

    expectPrefixedConsoleCall(logSpy, 0, "(fallback) TRACE:", "using log");
  });

  it("console未定義時はnoopで落とさず動作する", () => {
    const captured: unknown[] = [];
    globalThis.console = {} as Console;

    const logger = sut.getLogger("silent");
    expect(() => logger.error("no-op", captured)).not.toThrow();
    expect(captured).toEqual([]);
  });
});

describe("設定のバリデーション", () => {
  it("無効な名前の個別設定更新は拒否する", () => {
    expect(() => sut.setLoggerConfig("", { level: "error" })).toThrow("logger name must be a non-empty string");
  });
  it("無効な名前の参照は拒否する", () => {
    expect(() => sut.getLoggerOverrides("")).toThrow("logger name must be a non-empty string");
    expect(() => sut.getEffectiveLoggerConfig(" ")).toThrow("logger name must be a non-empty string");
  });

  it("setDefaultConfigに不正なlevelを渡すと拒否する", () => {
    expect(() => sut.setDefaultConfig({ level: 123 as unknown as LogLevel })).toThrow(TypeError);
    expect(() => sut.setDefaultConfig({ level: 123 as unknown as LogLevel })).toThrow("invalid log level: 123");
    expect(() => sut.setDefaultConfig({ level: "verbose" as LogLevel })).toThrow("invalid log level");
    expect(() => sut.setDefaultConfig({ level: "" as LogLevel })).toThrow("invalid log level");
    expect(sut.getDefaultConfig().level).toBe("info");
  });

  it("setLoggerConfigに不正なlevelを渡すと拒否する", () => {
    expect(() => sut.setLoggerConfig("test-invalid", { level: "verbose" as LogLevel })).toThrow("invalid log level");
    expect(sut.getLoggerOverrides("test-invalid")).toEqual({});
  });

  it("setDefaultConfigにobject以外のpartialを渡すと拒否する", () => {
    expect(() => sut.setDefaultConfig(null as unknown as Parameters<typeof sut.setDefaultConfig>[0])).toThrow(TypeError);
    expect(() => sut.setDefaultConfig(null as unknown as Parameters<typeof sut.setDefaultConfig>[0])).toThrow("invalid config: null");
    expect(() => sut.setDefaultConfig(0 as unknown as Parameters<typeof sut.setDefaultConfig>[0])).toThrow(TypeError);
    expect(() => sut.setDefaultConfig(0 as unknown as Parameters<typeof sut.setDefaultConfig>[0])).toThrow("invalid config: 0");
    expect(sut.getDefaultConfig()).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "(%loggerName) %logLevel:",
      placeholders: {}
    });
  });

  it("setLoggerConfigにobject以外のpartialを渡すと拒否する", () => {
    expect(() => sut.setLoggerConfig("test-invalid", false as unknown as Parameters<typeof sut.setLoggerConfig>[1])).toThrow(
      TypeError
    );
    expect(() => sut.setLoggerConfig("test-invalid", false as unknown as Parameters<typeof sut.setLoggerConfig>[1])).toThrow(
      "invalid config: false"
    );
    expect(sut.getLoggerOverrides("test-invalid")).toEqual({});
  });

  it("setDefaultConfigに不正なprefixEnabledを渡すと拒否する", () => {
    expect(() => sut.setDefaultConfig({ prefixEnabled: "yes" as unknown as boolean })).toThrow(TypeError);
    expect(() => sut.setDefaultConfig({ prefixEnabled: "yes" as unknown as boolean })).toThrow(
      "invalid prefixEnabled: \"yes\""
    );
    expect(sut.getDefaultConfig().prefixEnabled).toBe(true);
  });

  it("setLoggerConfigに不正なprefixFormatを渡すと拒否する", () => {
    expect(() => sut.setLoggerConfig("test-invalid", { prefixFormat: 123 as unknown as string })).toThrow(TypeError);
    expect(() => sut.setLoggerConfig("test-invalid", { prefixFormat: 123 as unknown as string })).toThrow(
      "invalid prefixFormat: 123"
    );
    expect(sut.getLoggerOverrides("test-invalid")).toEqual({});
  });

  it("setDefaultConfigに不正なplaceholdersを渡すと拒否する", () => {
    expect(() => sut.setDefaultConfig({ placeholders: [] as unknown as Record<string, string> })).toThrow(TypeError);
    expect(() => sut.setDefaultConfig({ placeholders: [] as unknown as Record<string, string> })).toThrow(
      "invalid placeholders: []"
    );
    expect(sut.getDefaultConfig().placeholders).toEqual({});
  });

  it("setDefaultConfigにnon-plain-objectのplaceholdersを渡すと拒否する", () => {
    expect(() => sut.setDefaultConfig({ placeholders: new Map([["%app", "svc"]]) as unknown as Record<string, string> })).toThrow(
      "invalid placeholders: [object Map]"
    );
    expect(sut.getDefaultConfig().placeholders).toEqual({});
  });

  it("別realmで作られたdefault configとplaceholdersを受け入れる", () => {
    const foreignConfig = vm.runInNewContext(`({
      prefixEnabled: false,
      prefixFormat: "[%app]",
      placeholders: { "%app": "svc" }
    })`) as Parameters<typeof sut.setDefaultConfig>[0];

    expect(() => sut.setDefaultConfig(foreignConfig)).not.toThrow();
    expect(sut.getDefaultConfig()).toEqual({
      level: "info",
      prefixEnabled: false,
      prefixFormat: "[%app]",
      placeholders: { "%app": "svc" }
    });
  });

  it("別realmで作られたlogger configとplaceholdersを受け入れる", () => {
    const foreignConfig = vm.runInNewContext(`({
      prefixEnabled: false,
      prefixFormat: "[%app][%loggerName]",
      placeholders: { "%app": "svc" }
    })`) as Parameters<typeof sut.setLoggerConfig>[1];

    expect(() => sut.setLoggerConfig("foreign-realm", foreignConfig)).not.toThrow();
    expect(sut.getLoggerOverrides("foreign-realm")).toEqual({
      prefixEnabled: false,
      prefixFormat: "[%app][%loggerName]",
      placeholders: { "%app": "svc" }
    });
  });

  it("setLoggerConfigに不正なplaceholderキーを渡すと拒否する", () => {
    expect(() =>
      sut.setLoggerConfig("test-invalid", {
        placeholders: { "%app.name": "svc" } as unknown as Record<string, string>
      })
    ).toThrow("invalid placeholder key: \"%app.name\"");
    expect(sut.getLoggerOverrides("test-invalid")).toEqual({});
  });

  it("setDefaultConfigに予約済みplaceholderキーを渡すと拒否する", () => {
    expect(() =>
      sut.setDefaultConfig({
        placeholders: { "%loggerName": "svc" } as unknown as Record<string, string>
      })
    ).toThrow("reserved placeholder key: \"%loggerName\"");
    expect(sut.getDefaultConfig().placeholders).toEqual({});
  });

  it("setDefaultConfigにsymbolのplaceholderキーを渡すと拒否する", () => {
    const invalidKey = Symbol("placeholder-key");

    expect(() =>
      sut.setDefaultConfig({
        placeholders: { [invalidKey]: "svc" } as unknown as Record<string, string>
      })
    ).toThrow("invalid placeholder key: Symbol(placeholder-key)");
    expect(sut.getDefaultConfig().placeholders).toEqual({});
  });

  it("non-enumerableなplaceholderキーは無視する", () => {
    const placeholders = {};
    Object.defineProperty(placeholders, "%hidden", {
      value: "secret",
      enumerable: false
    });

    expect(() =>
      sut.setDefaultConfig({
        placeholders: placeholders as unknown as Record<string, string>
      })
    ).not.toThrow();
    expect(sut.getDefaultConfig().placeholders).toEqual({});
  });

  it("setLoggerConfigに不正なplaceholder値を渡すと拒否する", () => {
    expect(() =>
      sut.setLoggerConfig("test-invalid", {
        placeholders: { "%bad": 123 as unknown as string }
      })
    ).toThrow(TypeError);
    expect(() =>
      sut.setLoggerConfig("test-invalid", {
        placeholders: { "%bad": 123 as unknown as string }
      })
    ).toThrow("invalid placeholder value for \"%bad\": 123");
    expect(sut.getLoggerOverrides("test-invalid")).toEqual({});
  });

  it("不正値メッセージでnamed functionを表示できる", () => {
    expect(() => sut.setDefaultConfig({ prefixEnabled: alwaysTrue as unknown as boolean })).toThrow(
      "invalid prefixEnabled: [function alwaysTrue]"
    );
  });

  it("不正値メッセージでanonymous functionを表示できる", () => {
    const anonymousInvalidFlag = alwaysTrue.bind(undefined);
    Object.defineProperty(anonymousInvalidFlag, "name", { value: "" });

    expect(() => sut.setDefaultConfig({ prefixEnabled: anonymousInvalidFlag as unknown as boolean })).toThrow(
      "invalid prefixEnabled: [function anonymous]"
    );
  });

  it("不正値メッセージでJSON化できない値を文字列化できる", () => {
    expect(() => sut.setDefaultConfig({ prefixEnabled: Symbol("bad-flag") as unknown as boolean })).toThrow(
      "invalid prefixEnabled: Symbol(bad-flag)"
    );
  });

  it("不正なlevelでthrowしても既存設定は変更されない", () => {
    sut.setDefaultConfig({ level: "debug" });
    expect(() => sut.setDefaultConfig({ level: "nope" as LogLevel })).toThrow("invalid log level");
    expect(sut.getDefaultConfig().level).toBe("debug");
  });

  it("不正なデフォルト設定でthrowしても既存設定は変更されない", () => {
    sut.setDefaultConfig({
      prefixEnabled: false,
      prefixFormat: "[%loggerName]",
      placeholders: { "%app": "base" }
    });

    expect(() => sut.setDefaultConfig({ prefixFormat: null as unknown as string })).toThrow("invalid prefixFormat: null");
    expect(sut.getDefaultConfig()).toEqual({
      level: "info",
      prefixEnabled: false,
      prefixFormat: "[%loggerName]",
      placeholders: { "%app": "base" }
    });
  });

  it("不正な個別設定でthrowしても既存設定は変更されない", () => {
    sut.setLoggerConfig("sticky-invalid", {
      level: "debug",
      prefixFormat: "<ok>",
      placeholders: { "%app": "svc" }
    });

    expect(() =>
      sut.setLoggerConfig("sticky-invalid", {
        prefixEnabled: "no" as unknown as boolean
      })
    ).toThrow("invalid prefixEnabled: \"no\"");
    expect(sut.getLoggerOverrides("sticky-invalid")).toEqual({
      level: "debug",
      prefixFormat: "<ok>",
      placeholders: { "%app": "svc" }
    });
  });

  it("後からデフォルト値を変更した場合はdefault placeholdersをマージして全ロガーに反映する", () => {
    sut.setDefaultConfig({
      placeholders: { "%base": "root" }
    });

    const logger = sut.getLogger("placeholders");
    const infoSpy = stubConsoleMethod("info");

    sut.setDefaultConfig({
      placeholders: { "%new": "value" },
      prefixFormat: "[%base][%new][%logLevel]"
    });
    logger.info("after merge");

    expectPrefixedConsoleCall(infoSpy, 0, "[root][value][INFO]", "after merge");
    expect(sut.getDefaultConfig().placeholders).toEqual({ "%base": "root", "%new": "value" });
  });

  it("setDefaultConfigのdefault placeholders更新は同名キーだけを上書きし未指定キーを保持する", () => {
    sut.setDefaultConfig({
      placeholders: { "%app": "base", "%keep": "shared" }
    });

    sut.setDefaultConfig({
      placeholders: { "%app": "override" }
    });

    expect(sut.getDefaultConfig().placeholders).toEqual({ "%app": "override", "%keep": "shared" });
  });

  it("setLoggerConfigのplaceholders更新は同名キーだけを上書きし未指定キーを保持する", () => {
    const infoSpy = stubConsoleMethod("info");

    sut.setLoggerConfig("placeholder-override-merge", {
      prefixFormat: "[%app][%keep][%loggerName][%logLevel]",
      placeholders: { "%app": "base", "%keep": "shared" }
    });

    sut.setLoggerConfig("placeholder-override-merge", {
      placeholders: { "%app": "override" }
    });

    const logger = sut.getLogger("placeholder-override-merge");
    logger.info("after merge");

    expect(sut.getLoggerOverrides("placeholder-override-merge")).toEqual({
      prefixFormat: "[%app][%keep][%loggerName][%logLevel]",
      placeholders: { "%app": "override", "%keep": "shared" }
    });
    expectPrefixedConsoleCall(infoSpy, 0, "[override][shared][placeholder-override-merge][INFO]", "after merge");
  });

  it("後からデフォルト値を変更した場合も個別設定しているものは変更しない", () => {
    const infoSpy = stubConsoleMethod("info");
    const logger = sut.getLogger("sticky");

    sut.setLoggerConfig("sticky", {
      level: "debug",
      prefixFormat: "<stick %loggerName %logLevel>"
    });

    logger.info("before default change");

    sut.setDefaultConfig({
      level: "error",
      prefixFormat: "[global %loggerName %logLevel]",
      placeholders: { "%new": "added" }
    });

    logger.info("after default change");

    expectPrefixedConsoleCall(infoSpy, 0, "<stick sticky INFO>", "before default change");
    expectPrefixedConsoleCall(infoSpy, 1, "<stick sticky INFO>", "after default change");
    expect(sut.getLoggerOverrides("sticky").prefixFormat).toBe("<stick %loggerName %logLevel>");
    expect(sut.getLoggerOverrides("sticky").level).toBe("debug");
  });

  it("getDefaultConfigの戻り値を書き換えても内部stateは変わらない", () => {
    sut.setDefaultConfig({
      level: "info",
      prefixFormat: "[defaults][%app][%loggerName][%logLevel]",
      placeholders: { "%app": "base" }
    });

    const infoSpy = stubConsoleMethod("info");
    const existingLogger = sut.getLogger("defaults-existing");
    const defaults = sut.getDefaultConfig() as {
      level: LogLevel;
      prefixEnabled: boolean;
      prefixFormat: string;
      placeholders: Record<string, string>;
    };

    defaults.level = "error";
    defaults.prefixEnabled = false;
    defaults.prefixFormat = "[tampered-default][%app][%loggerName][%logLevel]";
    defaults.placeholders["%app"] = "tampered-default";

    existingLogger.info("existing");
    const newLogger = sut.getLogger("defaults-new");
    newLogger.info("new");

    expect(sut.getDefaultConfig()).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "[defaults][%app][%loggerName][%logLevel]",
      placeholders: { "%app": "base" }
    });
    expectPrefixedConsoleCall(infoSpy, 0, "[defaults][base][defaults-existing][INFO]", "existing");
    expectPrefixedConsoleCall(infoSpy, 1, "[defaults][base][defaults-new][INFO]", "new");
  });

  it("getLoggerOverridesの戻り値を書き換えても内部stateは変わらない", () => {
    const infoSpy = stubConsoleMethod("info");

    sut.setLoggerConfig("override-snapshot", {
      prefixFormat: "[override][%app][%loggerName][%logLevel]",
      placeholders: { "%app": "svc" }
    });

    const logger = sut.getLogger("override-snapshot");
    const overrides = sut.getLoggerOverrides("override-snapshot") as {
      prefixFormat?: string;
      placeholders?: Record<string, string>;
    };

    overrides.prefixFormat = "[tampered-override][%app][%loggerName][%logLevel]";
    overrides.placeholders!["%app"] = "tampered-override";

    sut.setDefaultConfig({ level: "info" });
    logger.info("payload");

    expect(sut.getLoggerOverrides("override-snapshot")).toEqual({
      prefixFormat: "[override][%app][%loggerName][%logLevel]",
      placeholders: { "%app": "svc" }
    });
    expectPrefixedConsoleCall(infoSpy, 0, "[override][svc][override-snapshot][INFO]", "payload");
  });

  it("getLibraryDefaultsの戻り値を書き換えても内部stateは変わらない", () => {
    const libraryDefaults = sut.getLibraryDefaults() as {
      level: LogLevel;
      prefixEnabled: boolean;
      prefixFormat: string;
      placeholders: Record<string, string>;
    };

    libraryDefaults.level = "error";
    libraryDefaults.prefixEnabled = false;
    libraryDefaults.prefixFormat = "[tampered-library]";
    libraryDefaults.placeholders["%app"] = "tampered-library";

    expect(sut.getLibraryDefaults()).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "(%loggerName) %logLevel:",
      placeholders: {}
    });
    expect(sut.getDefaultConfig()).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "(%loggerName) %logLevel:",
      placeholders: {}
    });
  });

  it("setLoggerConfigの入力placeholdersを後から書き換えても内部stateに漏れない", () => {
    const infoSpy = stubConsoleMethod("info");
    const placeholders = { "%app": "svc" };

    sut.setLoggerConfig("input-clone", {
      prefixFormat: "[input-clone][%app][%loggerName][%logLevel]",
      placeholders
    });

    placeholders["%app"] = "tampered-input";

    const logger = sut.getLogger("input-clone");
    logger.info("payload");

    expect(sut.getLoggerOverrides("input-clone")).toEqual({
      prefixFormat: "[input-clone][%app][%loggerName][%logLevel]",
      placeholders: { "%app": "svc" }
    });
    expectPrefixedConsoleCall(infoSpy, 0, "[input-clone][svc][input-clone][INFO]", "payload");
  });
});
