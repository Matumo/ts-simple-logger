import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { LogLevel } from "@main/index";
import {
  getDefaultConfig,
  getLibraryDefaults,
  getLogger,
  getPerLoggerConfig,
  setDefaultConfig,
  setLogLevel,
  setLoggerConfig,
  setLoggerLevel,
} from "@main/index";

const originalConsole = globalThis.console;

function restoreConsole(): void {
  globalThis.console = originalConsole;
  console.trace = originalConsole.trace;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
}

beforeEach(() => {
  globalThis.__MYLOGGER_STATE__ = undefined;
  vi.restoreAllMocks();
  restoreConsole();
});

describe("設定参照系", () => {
  it("ライブラリデフォルトがランタイムデフォルトとして複製される", () => {
    const library = getLibraryDefaults();
    const defaults = getDefaultConfig();

    expect(library).toEqual({
      level: "info",
      prefixEnabled: true,
      prefixFormat: "(%loggerName) %logLevel:",
      placeholders: {},
    });
    expect(defaults).toEqual(library);
    expect(defaults).not.toBe(library);
    expect(getPerLoggerConfig()).toEqual({});
  });
});

describe("ロガー生成とバリデーション", () => {
  it("無効なロガー名は拒否する", () => {
    expect(() => getLogger("")).toThrow("logger name must be a non-empty string");
  });
  it("ロガーをキャッシュする", () => {
    const first = getLogger("core");
    const second = getLogger("core");
    expect(second).toBe(first);
  });
});

describe("ログ出力の挙動", () => {
  it("プレースホルダーとエスケープを含むプレフィックスを整形する", () => {
    setDefaultConfig({
      prefixFormat: "[%%][%loggerName][%logLevel][%appName][%custom][%missing]",
      placeholders: { "%appName": "root", "%custom": "default" },
    });
    setLoggerConfig("svc", { placeholders: { "%custom": "override" } });

    const infoSpy = vi.spyOn(console, "info");
    const logger = getLogger("svc");
    logger.info("payload");

    expect(infoSpy).toHaveBeenCalledWith("[%][svc][INFO][root][override][%missing]", "payload");
  });

  it("プレフィックス無効時はラベルを付けずメッセージのみ出力する", () => {
    const infoSpy = vi.spyOn(console, "info");
    const logger = getLogger("api");

    setDefaultConfig({ prefixEnabled: false });
    logger.info("no prefix");

    expect(infoSpy).toHaveBeenCalledWith("no prefix");
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

      setLogLevel(baseLevel);
      const logger = getLogger(`LogLevel-${baseLevel}`);
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
    const logger = getLogger("custom");

    setLoggerConfig("custom", { prefixFormat: "<%loggerName|%logLevel>" });
    logger.info("configured");

    expect(infoSpy).toHaveBeenCalledWith("<custom|INFO>", "configured");
    expect(getPerLoggerConfig().custom?.prefixFormat).toBe("<%loggerName|%logLevel>");
  });

  it("setLoggerLevel でデフォルトよりも緩いレベルに個別上書きできる", () => {
    setLogLevel("error");
    setLoggerLevel("override-level", "debug");

    const debugSpy = vi.spyOn(console, "debug");
    const warnSpy = vi.spyOn(console, "warn");
    const logger = getLogger("override-level");

    logger.debug("allowed");
    logger.warn("also allowed");

    expect(debugSpy).toHaveBeenCalledWith("(override-level) DEBUG:", "allowed");
    expect(warnSpy).toHaveBeenCalledWith("(override-level) WARN:", "also allowed");
  });

  it("エラーレベル時は warn を無効化し error は通す", () => {
    setLogLevel("error");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");

    const logger = getLogger("errors-only");
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

    setLogLevel("trace");
    const logger = getLogger("fallback");
    logger.trace("using log");

    expect(logSpy).toHaveBeenCalledWith("(fallback) TRACE:", "using log");
  });

  it("console 未定義時は noop で落とさず動作する", () => {
    const captured: unknown[] = [];
    globalThis.console = {} as Console;

    const logger = getLogger("silent");
    expect(() => logger.error("no-op", captured)).not.toThrow();
    expect(captured).toEqual([]);
  });
});

describe("設定のバリデーション", () => {
  it("無効な名前の個別設定更新は拒否する", () => {
    expect(() => setLoggerConfig("", { level: "error" })).toThrow("logger name must be a non-empty string");
  });

  it("後からデフォルト値を変更した場合は全ロガーに反映する", () => {
    const logger = getLogger("placeholders");
    const infoSpy = vi.spyOn(console, "info");

    setDefaultConfig({ placeholders: { "%new": "value" }, prefixFormat: "[%new][%logLevel]" });
    logger.info("after replace");

    expect(infoSpy).toHaveBeenCalledWith("[value][INFO]", "after replace");
    expect(getDefaultConfig().placeholders).toEqual({ "%new": "value" });
  });

  it("後からデフォルト値を変更した場合も個別設定しているものは変更しない", () => {
    const infoSpy = vi.spyOn(console, "info");
    const logger = getLogger("sticky");

    setLoggerConfig("sticky", { level: "debug", prefixFormat: "<stick %loggerName %logLevel>" });

    logger.info("before default change");

    setDefaultConfig({
      level: "error",
      prefixFormat: "[global %loggerName %logLevel]",
      placeholders: { "%new": "added" },
    });

    logger.info("after default change");

    expect(infoSpy).toHaveBeenNthCalledWith(1, "<stick sticky INFO>", "before default change");
    expect(infoSpy).toHaveBeenNthCalledWith(2, "<stick sticky INFO>", "after default change");
    expect(getPerLoggerConfig().sticky?.prefixFormat).toBe("<stick %loggerName %logLevel>");
    expect(getPerLoggerConfig().sticky?.level).toBe("debug");
  });
});
