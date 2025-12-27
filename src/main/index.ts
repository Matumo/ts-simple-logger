// 方針:
// - setDefaultConfig / setLoggerConfig で設定する。
//  - prefixFormat のプレースホルダ
//    - %loggerName: ロガー名
//    - %logLevel: ログレベル
//    - 任意のプレースホルダー（例: %appName）を placeholders 経由で指定
//    - %%: %
// - getLogger でロガーを取得する。

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

type LoggerConfigFields = {
  level: LogLevel;
  prefixEnabled: boolean;
  prefixFormat: string;
  placeholders: Record<string, string>;
};

export type DefaultLoggerConfig = LoggerConfigFields;

export type PerLoggerConfig = Partial<LoggerConfigFields>;

export type Logger = {
  readonly name: string;
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type State = {
  libraryDefaults: DefaultLoggerConfig;
  defaults: DefaultLoggerConfig;
  perLogger: Record<string, PerLoggerConfig>;
  loggers: Map<string, Logger>;
};

declare global {
  var __MYLOGGER_STATE__: State | undefined;
}

function noop(): void {}

function getConsoleMethod(
  method: "trace" | "debug" | "info" | "warn" | "error",
): (...args: unknown[]) => void {
  const c: Partial<Console> | undefined = globalThis.console;

  const fn = c?.[method];
  if (typeof fn === "function") return fn.bind(console);

  const fallback = c?.log;
  if (typeof fallback === "function") return fallback.bind(console);

  return noop;
}

function createLibraryDefaults(): DefaultLoggerConfig {
  return {
    level: "info",
    prefixEnabled: true,
    prefixFormat: "(%loggerName) %logLevel:",
    placeholders: { },
  };
}

function getState(): State {
  if (!globalThis.__MYLOGGER_STATE__) {
    const libraryDefaults = createLibraryDefaults();
    globalThis.__MYLOGGER_STATE__ = {
      libraryDefaults,
      defaults: { ...libraryDefaults, placeholders: { ...libraryDefaults.placeholders } },
      perLogger: {},
      loggers: new Map(),
    };
  }
  return globalThis.__MYLOGGER_STATE__;
}

function formatPrefix(
  template: string,
  loggerName: string,
  level: LogLevel,
  placeholders: Record<string, string>,
): string {
  const lvl = level.toUpperCase();
  const replacements: Record<string, string> = {
    ...placeholders,
    "%loggerName": loggerName,
    "%logLevel": lvl,
  };

  return template.replaceAll(/%%|%[0-9A-Za-z_]+/g, (token) => {
    if (token === "%%") return "%";
    return replacements[token] ?? token;
  });
}

type EffectiveConfig = {
  level: LogLevel;
  prefixEnabled: boolean;
  prefixFormat: string;
  placeholders: Record<string, string>;
};

function resolveEffectiveConfig(loggerName: string): EffectiveConfig {
  const state = getState();
  const d = state.defaults;
  const p = state.perLogger[loggerName] ?? {};

  return {
    level: p.level ?? d.level,
    prefixEnabled: p.prefixEnabled ?? d.prefixEnabled,
    prefixFormat: p.prefixFormat ?? d.prefixFormat,
    placeholders: { ...d.placeholders, ...(p.placeholders ?? {}) },
  };
}

function applyConfigToLogger(logger: Logger): void {
  const name = logger.name;
  const cfg = resolveEffectiveConfig(name);

  const enabled = (need: LogLevel) => LEVEL_ORDER[cfg.level] <= LEVEL_ORDER[need];

  const cTrace = getConsoleMethod("trace");
  const cDebug = getConsoleMethod("debug");
  const cInfo = getConsoleMethod("info");
  const cWarn = getConsoleMethod("warn");
  const cError = getConsoleMethod("error");

  const prefixTrace = cfg.prefixEnabled ? formatPrefix(cfg.prefixFormat, name, "trace", cfg.placeholders) : "";
  const prefixDebug = cfg.prefixEnabled ? formatPrefix(cfg.prefixFormat, name, "debug", cfg.placeholders) : "";
  const prefixInfo = cfg.prefixEnabled ? formatPrefix(cfg.prefixFormat, name, "info", cfg.placeholders) : "";
  const prefixWarn = cfg.prefixEnabled ? formatPrefix(cfg.prefixFormat, name, "warn", cfg.placeholders) : "";
  const prefixError = cfg.prefixEnabled ? formatPrefix(cfg.prefixFormat, name, "error", cfg.placeholders) : "";

  const bindWithPrefix = (fn: (...a: unknown[]) => void, prefix: string) => {
    return prefix ? fn.bind(null, prefix) : fn;
  };

  logger.trace = enabled("trace") ? bindWithPrefix(cTrace, prefixTrace) : noop;
  logger.debug = enabled("debug") ? bindWithPrefix(cDebug, prefixDebug) : noop;
  logger.info = enabled("info") ? bindWithPrefix(cInfo, prefixInfo) : noop;
  logger.warn = enabled("warn") ? bindWithPrefix(cWarn, prefixWarn) : noop;
  logger.error = enabled("error") ? bindWithPrefix(cError, prefixError) : noop;
}

function reapplyAllLoggers(): void {
  const state = getState();
  for (const logger of state.loggers.values()) {
    applyConfigToLogger(logger);
  }
}

/**
 * デフォルト設定関数
 */
export function setDefaultConfig(partial: Partial<DefaultLoggerConfig>): void {
  const state = getState();

  if (typeof partial.level === "string") state.defaults.level = partial.level;
  if (typeof partial.prefixEnabled === "boolean") state.defaults.prefixEnabled = partial.prefixEnabled;
  if (typeof partial.prefixFormat === "string") state.defaults.prefixFormat = partial.prefixFormat;
  if (partial.placeholders && typeof partial.placeholders === "object") {
    state.defaults.placeholders = { ...partial.placeholders };
  }

  reapplyAllLoggers();
}

/**
 * ロガー設定関数
 */
export function setLoggerConfig(name: string, partial: PerLoggerConfig): void {
  const state = getState();
  const key = name?.trim();
  if (!key) {
    throw new Error("logger name must be a non-empty string");
  }

  const current = state.perLogger[key] ?? {};
  state.perLogger[key] = { ...current, ...partial };

  const logger = state.loggers.get(key);
  if (logger) applyConfigToLogger(logger);
}

/**
 * ユーティリティ関数
 */
export function setLogLevel(level: LogLevel): void {
  setDefaultConfig({ level });
}
export function setLoggerLevel(name: string, level: LogLevel): void {
  setLoggerConfig(name, { level });
}

/**
 * ロガー取得関数
 */
export function getLogger(name: string): Logger {
  const state = getState();
  const key = name?.trim();
  if (!key) {
    throw new Error("logger name must be a non-empty string");
  }

  const cached = state.loggers.get(key);
  if (cached) return cached;

  const logger: Logger = {
    name: key,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };

  state.loggers.set(key, logger);
  applyConfigToLogger(logger);
  return logger;
}

/**
 * 参照用関数
 */
export function getDefaultConfig(): Readonly<DefaultLoggerConfig> {
  return getState().defaults;
}
export function getPerLoggerConfig(): Readonly<Record<string, PerLoggerConfig>> {
  return getState().perLogger;
}
export function getLibraryDefaults(): Readonly<DefaultLoggerConfig> {
  return getState().libraryDefaults;
}
