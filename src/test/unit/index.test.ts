import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { LogLevel } from "@main/index";

const originalConsole = globalThis.console;
let sut: typeof import("@main/index");

function restoreConsole(): void {
  globalThis.console = originalConsole;
  console.trace = originalConsole.trace;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
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
      placeholders: { "%appName": "root", "%custom": "default" },
    });
    sut.setLoggerConfig("svc", { placeholders: { "%custom": "override" } });

    const infoSpy = vi.spyOn(console, "info");
    const logger = sut.getLogger("svc");
    logger.info("payload");

    expect(infoSpy).toHaveBeenCalledWith("[%][svc][INFO][root][override][%missing]", "payload");
  });

  it("プレースホルダー関数はログ出力時に評価される", () => {
    let counter = 0;
    const counterFn = vi.fn(() => `tick-${++counter}`);

    sut.setDefaultConfig({
      prefixFormat: "[%counter]",
      placeholders: { "%counter": counterFn },
    });

    const infoSpy = vi.spyOn(console, "info");
    const logger = sut.getLogger("dynamic");

    expect(counterFn).not.toHaveBeenCalled();
    logger.info("a");
    logger.info("b");

    expect(counterFn).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenNthCalledWith(1, "[tick-1]", "a");
    expect(infoSpy).toHaveBeenNthCalledWith(2, "[tick-2]", "b");
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
      if (LEVEL_ORDER[baseLevel] <= LEVEL_ORDER[logLevel]) expect(spy).toHaveBeenCalledWith(...args);
      else expect(spy).not.toHaveBeenCalled();
    };

    const levels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "silent"];

    for (const baseLevel of levels) {
      const traceSpy = vi.spyOn(console, "trace");
      const debugSpy = vi.spyOn(console, "debug");
      const infoSpy = vi.spyOn(console, "info");
      const warnSpy = vi.spyOn(console, "warn");
      const errorSpy = vi.spyOn(console, "error");

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
    const infoSpy = vi.spyOn(console, "info");
    const logger = sut.getLogger("custom");

    sut.setLoggerConfig("custom", { prefixFormat: "<%loggerName|%logLevel>" });
    logger.info("configured");

    expect(infoSpy).toHaveBeenCalledWith("<custom|INFO>", "configured");
    expect(sut.getLoggerOverrides("custom").prefixFormat).toBe("<%loggerName|%logLevel>");
  });

  it("setLoggerLevel でデフォルトよりも緩いレベルに個別上書きできる", () => {
    sut.setLogLevel("error");
    sut.setLoggerLevel("override-level", "debug");

    const debugSpy = vi.spyOn(console, "debug");
    const warnSpy = vi.spyOn(console, "warn");
    const logger = sut.getLogger("override-level");

    logger.debug("allowed");
    logger.warn("also allowed");

    expect(debugSpy).toHaveBeenCalledWith("(override-level) DEBUG:", "allowed");
    expect(warnSpy).toHaveBeenCalledWith("(override-level) WARN:", "also allowed");
  });

  it("エラーレベル時は warn を無効化し error は通す", () => {
    sut.setLogLevel("error");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");

    const logger = sut.getLogger("errors-only");
    logger.warn("skip");
    logger.error("recorded");

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("(errors-only) ERROR:", "recorded");
  });

  it("特定の console メソッド未定義時は console.log にフォールバックする", () => {
    const logSpy = vi.fn();
    // @ts-expect-error override console for test
    console.trace = undefined;
    console.log = logSpy;

    sut.setLogLevel("trace");
    const logger = sut.getLogger("fallback");
    logger.trace("using log");

    expect(logSpy).toHaveBeenCalledWith("(fallback) TRACE:", "using log");
  });

  it("console 未定義時は noop で落とさず動作する", () => {
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

  it("後からデフォルト値を変更した場合は全ロガーに反映する", () => {
    const logger = sut.getLogger("placeholders");
    const infoSpy = vi.spyOn(console, "info");

    sut.setDefaultConfig({ placeholders: { "%new": "value" }, prefixFormat: "[%new][%logLevel]" });
    logger.info("after replace");

    expect(infoSpy).toHaveBeenCalledWith("[value][INFO]", "after replace");
    expect(sut.getDefaultConfig().placeholders).toEqual({ "%new": "value" });
  });

  it("後からデフォルト値を変更した場合も個別設定しているものは変更しない", () => {
    const infoSpy = vi.spyOn(console, "info");
    const logger = sut.getLogger("sticky");

    sut.setLoggerConfig("sticky", { level: "debug", prefixFormat: "<stick %loggerName %logLevel>" });

    logger.info("before default change");

    sut.setDefaultConfig({
      level: "error",
      prefixFormat: "[global %loggerName %logLevel]",
      placeholders: { "%new": "added" },
    });

    logger.info("after default change");

    expect(infoSpy).toHaveBeenNthCalledWith(1, "<stick sticky INFO>", "before default change");
    expect(infoSpy).toHaveBeenNthCalledWith(2, "<stick sticky INFO>", "after default change");
    expect(sut.getLoggerOverrides("sticky").prefixFormat).toBe("<stick %loggerName %logLevel>");
    expect(sut.getLoggerOverrides("sticky").level).toBe("debug");
  });
});
