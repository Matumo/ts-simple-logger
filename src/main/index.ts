// 方針:
// - setDefaultConfig / setLoggerConfig で設定する。
//  - prefixFormat のプレースホルダ
//    - %loggerName: ロガー名
//    - %logLevel: ログレベル
//    - 任意のプレースホルダー（例: %appName）を placeholders 経由で指定
//    - %%: %
// - getLogger でロガーを取得する。

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";
export type PlaceholderValue = string | (() => string);
export type Placeholders = Record<string, PlaceholderValue>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_ORDER));
const PLACEHOLDER_KEY_PATTERN = /^%\w+$/;
const RESERVED_PLACEHOLDER_KEYS = new Set<string>(["%%", "%loggerName", "%logLevel"]);

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  // 別realmのObject.prototypeも終端はnullになるため、通常オブジェクトとして受け入れる。
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function formatInvalidValue(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && !isPlainObject(value)) {
    return Object.prototype.toString.call(value);
  }

  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // JSON化できない値は文字列表現へフォールバックする。
  }

  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  return String(value);
}

function validateLevel(level: unknown): void {
  if (typeof level !== "string") {
    throw new TypeError(`invalid log level: ${formatInvalidValue(level)}`);
  }

  if (!VALID_LEVELS.has(level)) {
    throw new Error(`invalid log level: ${formatInvalidValue(level)}`);
  }
}

function validatePrefixEnabled(prefixEnabled: unknown): void {
  if (typeof prefixEnabled !== "boolean") {
    throw new TypeError(`invalid prefixEnabled: ${formatInvalidValue(prefixEnabled)}`);
  }
}

function validatePrefixFormat(prefixFormat: unknown): void {
  if (typeof prefixFormat !== "string") {
    throw new TypeError(`invalid prefixFormat: ${formatInvalidValue(prefixFormat)}`);
  }
}

function validatePlaceholderKey(key: PropertyKey): void {
  if (typeof key !== "string") {
    throw new TypeError(`invalid placeholder key: ${formatInvalidValue(key)}`);
  }

  if (RESERVED_PLACEHOLDER_KEYS.has(key)) {
    throw new Error(`reserved placeholder key: ${formatInvalidValue(key)}`);
  }

  if (!PLACEHOLDER_KEY_PATTERN.test(key)) {
    throw new Error(`invalid placeholder key: ${formatInvalidValue(key)}`);
  }
}

function validatePlaceholders(placeholders: unknown): void {
  if (!isPlainObject(placeholders)) {
    throw new TypeError(`invalid placeholders: ${formatInvalidValue(placeholders)}`);
  }

  for (const key of Reflect.ownKeys(placeholders)) {
    if (!Object.prototype.propertyIsEnumerable.call(placeholders, key)) {
      continue;
    }

    validatePlaceholderKey(key);

    const value = placeholders[key];
    if (typeof value !== "string" && typeof value !== "function") {
      throw new TypeError(`invalid placeholder value for ${JSON.stringify(key)}: ${formatInvalidValue(value)}`);
    }
  }
}

function validateConfigObject(partial: unknown): void {
  if (!isPlainObject(partial)) {
    throw new TypeError(`invalid config: ${formatInvalidValue(partial)}`);
  }
}

type LoggerConfigFields = {
  level: LogLevel;
  prefixEnabled: boolean;
  prefixFormat: string;
  placeholders: Placeholders;
};

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
  libraryDefaults: LoggerConfigFields;
  defaults: LoggerConfigFields;
  perLogger: Record<string, PerLoggerConfig>;
  loggers: Map<string, Logger>;
};

function noop(): void { }

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

function createLibraryDefaults(): LoggerConfigFields {
  return {
    level: "info",
    prefixEnabled: true,
    prefixFormat: "(%loggerName) %logLevel:",
    placeholders: {},
  };
}

function createState(): State {
  const libraryDefaults = createLibraryDefaults();
  return {
    libraryDefaults,
    defaults: { ...libraryDefaults, placeholders: { ...libraryDefaults.placeholders } },
    perLogger: {},
    loggers: new Map(),
  };
}

const state: State = createState();

function getState(): State {
  return state;
}

function formatPrefix(
  template: string,
  loggerName: string,
  level: LogLevel,
  placeholders: Placeholders,
): string {
  const lvl = level.toUpperCase();
  return template.replaceAll(/%%|%\w+/g, (token) => {
    if (token === "%%") return "%";
    if (token === "%loggerName") return loggerName;
    if (token === "%logLevel") return lvl;
    if (Object.hasOwn(placeholders, token)) {
      const value = placeholders[token];
      return typeof value === "function" ? String(value()) : String(value);
    }
    return token;
  });
}

type EffectiveConfig = {
  level: LogLevel;
  prefixEnabled: boolean;
  prefixFormat: string;
  placeholders: Placeholders;
};

function resolveEffectiveConfig(loggerName: string): EffectiveConfig {
  const state = getState();
  const d = state.defaults;
  const p = state.perLogger[loggerName] ?? {};

  return {
    level: p.level ?? d.level,
    prefixEnabled: p.prefixEnabled ?? d.prefixEnabled,
    prefixFormat: p.prefixFormat ?? d.prefixFormat,
    placeholders: { ...d.placeholders, ...p.placeholders },
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

  const buildMethod = (level: LogLevel, fn: (...a: unknown[]) => void) => {
    if (!enabled(level)) return noop;
    if (!cfg.prefixEnabled) return fn;
    if (!cfg.prefixFormat) return fn;

    return fn.bind(null, "%s", {
      toString: () => formatPrefix(cfg.prefixFormat, name, level, cfg.placeholders),
    });
  };

  logger.trace = buildMethod("trace", cTrace);
  logger.debug = buildMethod("debug", cDebug);
  logger.info = buildMethod("info", cInfo);
  logger.warn = buildMethod("warn", cWarn);
  logger.error = buildMethod("error", cError);
}

function reapplyAllLoggers(): void {
  const state = getState();
  for (const logger of state.loggers.values()) {
    applyConfigToLogger(logger);
  }
}

function validateConfigPartial(partial: Partial<LoggerConfigFields>): void {
  validateConfigObject(partial);

  if (Object.hasOwn(partial, "level")) {
    validateLevel(partial.level);
  }
  if (Object.hasOwn(partial, "prefixEnabled")) {
    validatePrefixEnabled(partial.prefixEnabled);
  }
  if (Object.hasOwn(partial, "prefixFormat")) {
    validatePrefixFormat(partial.prefixFormat);
  }
  if (Object.hasOwn(partial, "placeholders")) {
    validatePlaceholders(partial.placeholders);
  }
}

/**
 * デフォルト設定関数
 */
export function setDefaultConfig(partial: Partial<LoggerConfigFields>): void {
  const state = getState();
  validateConfigPartial(partial);

  if (Object.hasOwn(partial, "level")) {
    state.defaults.level = partial.level as LogLevel;
  }

  if (Object.hasOwn(partial, "prefixEnabled")) {
    state.defaults.prefixEnabled = partial.prefixEnabled as boolean;
  }

  if (Object.hasOwn(partial, "prefixFormat")) {
    state.defaults.prefixFormat = partial.prefixFormat as string;
  }

  if (Object.hasOwn(partial, "placeholders")) {
    state.defaults.placeholders = { ...(partial.placeholders as Placeholders) };
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

  validateConfigPartial(partial);

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
export function getDefaultConfig(): Readonly<LoggerConfigFields> {
  return getState().defaults;
}
export function getLoggerOverrides(name: string): Readonly<PerLoggerConfig> {
  const state = getState();
  const key = name?.trim();
  if (!key) {
    throw new Error("logger name must be a non-empty string");
  }
  return state.perLogger[key] ?? {};
}
export function getEffectiveLoggerConfig(name: string): Readonly<LoggerConfigFields> {
  const key = name?.trim();
  if (!key) {
    throw new Error("logger name must be a non-empty string");
  }
  return resolveEffectiveConfig(key);
}
export function getLibraryDefaults(): Readonly<LoggerConfigFields> {
  return getState().libraryDefaults;
}
