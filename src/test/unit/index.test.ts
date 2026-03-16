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
  it("プレースホルダーとエスケープを含むプレフィックスを整形する", () => {
    sut.setDefaultConfig({
      prefixFormat: "[%%][%loggerName][%logLevel][%appName][%custom][%missing]",
      placeholders: { "%appName": "root", "%custom": "default" }
    });
    sut.setLoggerConfig("svc", { placeholders: { "%custom": "override" } });

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

  it("プレフィックスが空文字の場合は引数のみ出力する", () => {
    sut.setDefaultConfig({ prefixFormat: "" });
    const infoSpy = vi.spyOn(console, "info");
    const logger = sut.getLogger("empty-prefix");

    logger.info("payload");

    expect(infoSpy).toHaveBeenCalledWith("payload");
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
    expect(() => sut.setDefaultConfig({ level: "verbose" as LogLevel })).toThrow("invalid log level");
    expect(() => sut.setDefaultConfig({ level: "" as LogLevel })).toThrow("invalid log level");
    expect(sut.getDefaultConfig().level).toBe("info");
  });

  it("setLoggerConfigに不正なlevelを渡すと拒否する", () => {
    expect(() => sut.setLoggerConfig("test-invalid", { level: "verbose" as LogLevel })).toThrow("invalid log level");
    expect(sut.getLoggerOverrides("test-invalid")).toEqual({});
  });

  it("不正なlevelでthrowしても既存設定は変更されない", () => {
    sut.setDefaultConfig({ level: "debug" });
    expect(() => sut.setDefaultConfig({ level: "nope" as LogLevel })).toThrow("invalid log level");
    expect(sut.getDefaultConfig().level).toBe("debug");
  });

  it("後からデフォルト値を変更した場合は全ロガーに反映する", () => {
    const logger = sut.getLogger("placeholders");
    const infoSpy = stubConsoleMethod("info");

    sut.setDefaultConfig({
      placeholders: { "%new": "value" },
      prefixFormat: "[%new][%logLevel]"
    });
    logger.info("after replace");

    expectPrefixedConsoleCall(infoSpy, 0, "[value][INFO]", "after replace");
    expect(sut.getDefaultConfig().placeholders).toEqual({ "%new": "value" });
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
});
