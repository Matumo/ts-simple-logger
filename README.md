# ts-simple-logger

Simple console logger for browsers and Node.

- Zero dependencies
- Log levels: `trace`, `debug`, `info`, `warn`, `error`, `silent`
- Multiple named loggers
- Default config and per-logger overrides
- Configurable prefix with placeholders
- Uses native `console.*`, keeping the browser devtools source location where possible


## Published

https://www.npmjs.com/package/@matumo/ts-simple-logger


## Installation

```bash
npm install @matumo/ts-simple-logger
```


## Loading

Choose the loading style for your environment. After loading, the API usage is the same.

ESM:

```ts
import { getLogger, setDefaultConfig, setLoggerConfig } from "@matumo/ts-simple-logger";
```

CommonJS / CJS:

```js
const { getLogger, setDefaultConfig, setLoggerConfig } = require("@matumo/ts-simple-logger");
```

Web (ESM):

```html
<script type="module">
  import { getLogger, setDefaultConfig, setLoggerConfig } from "./dist/index.js";
</script>
```

Web (IIFE):

```html
<script src="./dist/index.iife.js"></script>
<script>
  const { getLogger, setDefaultConfig, setLoggerConfig } = globalThis.TsSimpleLogger;
</script>
```

For browser usage, you can also serve `dist/index.js` or `dist/index.iife.js` from a CDN such as [jsDelivr](https://cdn.jsdelivr.net/npm/@matumo/ts-simple-logger/).

## Usage

```ts
import { getLogger, setDefaultConfig, setLoggerConfig } from "@matumo/ts-simple-logger";

setDefaultConfig({
  level: "info",
  placeholders: {
    "%appName": "myapp",
    "%time": () => new Date().toISOString(),
  },
  prefixFormat: "[%appName] %time (%loggerName) %logLevel:",
  // Built-in placeholders: `%loggerName`, `%logLevel`.
  // Use `%%` in prefixFormat for a literal `%`.
  // Placeholder functions run at log time and must return strings.
});

const app = getLogger("app");
const db = getLogger("db");

setLoggerConfig("db", {
  level: "debug",
  placeholders: { "%appName": "myapp-db" },
});

app.info("started");
// [myapp] 2000-01-01T00:00:00.000Z (app) INFO: started
db.debug("connected", { host: "127.0.0.1" });
// [myapp-db] 2000-01-01T00:00:00.000Z (db) DEBUG: connected { host: "127.0.0.1" }
app.format("value=%s").info("ok", { host: "127.0.0.1" });
// [myapp] 2000-01-01T00:00:00.000Z (app) INFO: value=ok { host: "127.0.0.1" }

setDefaultConfig({
  level: null,
  placeholders: { "%time": null },
});

setLoggerConfig("db", {
  level: null,
  placeholders: null,
});
```


## Configuration

Options for `setDefaultConfig` and `setLoggerConfig`:

- `level`: minimum log level
- `prefixEnabled`: enable/disable prefix
- `prefixFormat`: prefix template with placeholders
- `placeholders`: custom placeholder map

Log levels: `trace`, `debug`, `info`, `warn`, `error`, `silent`

Placeholders:

- Built-in: `%loggerName`, `%logLevel`
- Custom keys must start with `%`
  - After `%`, you can use:
    - ASCII letters: `A-Z`, `a-z`
    - Digits: `0-9`
    - Underscore: `_`
    - Hyphen: `-` between segments
  - Examples: `%appName`, `%app-name`, `%APP_2`
- Reserved placeholders `%loggerName` and `%logLevel` cannot be overridden, and the escape token `%%` is also reserved
- Unknown placeholders remain as-is; use `%%` for a literal `%`
- Placeholder functions are evaluated at log time
- Default and per-logger placeholder updates are merged by key
- Effective per-logger placeholders merge defaults and overrides, with per-logger values taking precedence on key conflicts

`null` semantics in config patches:

- `level`, `prefixEnabled`, `prefixFormat`: reset to the next fallback
  - `setDefaultConfig(...)`: reset to library defaults
  - `setLoggerConfig(...)`: clear that logger's override
- `placeholders: null`
  - `setDefaultConfig(...)`: reset the full default placeholder map to library defaults
  - `setLoggerConfig(...)`: clear the full placeholder override map for that logger
- `placeholders: { "%app": null }`: delete only that placeholder key from the target map
- `getLoggerOverrides()` never returns `null`; it only returns overrides that are still active

Prefix behavior:

- If `prefixEnabled` is `false`, only the original arguments are logged
- If `prefixEnabled` is `true`, the logger always uses the configured prefix path
  - This also applies when `prefixFormat` is an empty string or placeholder expansion resolves the prefix to an empty string
  - If you want to avoid whitespace in that case, set `prefixEnabled` to `false`

Config resolution:

- Unspecified per-logger fields always fall back to defaults
- Changing defaults after a logger is retrieved updates its unspecified fields
- Changing per-logger config re-applies immediately to that logger
- Default changes never override fields set in per-logger config

Defaults at startup:

- `level`: `info`
- `prefixEnabled`: `true`
- `prefixFormat`: `(%loggerName) %logLevel:`
- `placeholders`: `{}`


## API

Argument types:

```ts
// Log level order used for filtering.
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";
// Placeholder value can be static or computed at log time.
type PlaceholderValue = string | (() => string);
// Placeholder map like { "%appName": "myapp" }.
type Placeholders = Record<string, PlaceholderValue>;
// Full config with required fields.
type LoggerConfig = {
  level: LogLevel;
  prefixEnabled: boolean;
  prefixFormat: string;
  placeholders: Placeholders;
};
// Partial update accepted by setters. null means reset/delete.
type LoggerConfigPatch = {
  level?: LogLevel | null;
  prefixEnabled?: boolean | null;
  prefixFormat?: string | null;
  placeholders?: Record<string, PlaceholderValue | null> | null;
};
// Active read-side overrides. Returned values never contain null.
type LoggerConfigOverrides = Partial<LoggerConfig>;
type FormattedLogger = {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
type Logger = FormattedLogger & {
  readonly name: string;
  format(template: string): FormattedLogger;
};
```

API signatures:

```ts
// Get a named logger (see "Logger usage" below).
getLogger(name: string): Logger;

// Update global defaults.
setDefaultConfig(patch: LoggerConfigPatch): void;
// Update per-logger overrides.
setLoggerConfig(name: string, patch: LoggerConfigPatch): void;

// Set global log level shortcut.
setLogLevel(level: LogLevel): void;
// Set per-logger log level shortcut.
setLoggerLevel(name: string, level: LogLevel): void;

// Get current defaults.
getDefaultConfig(): Readonly<LoggerConfig>;
// Get active per-logger overrides for a logger. Returned values never contain null.
getLoggerOverrides(name: string): Readonly<LoggerConfigOverrides>;
// Get resolved config (defaults + overrides) for a logger.
getEffectiveLoggerConfig(name: string): Readonly<LoggerConfig>;
// Get library defaults (initial baseline).
getLibraryDefaults(): Readonly<LoggerConfig>;
```

Logger usage:

```ts
const log: Logger = getLogger("app");
log.info("started");
log.error("details", { code: "E_CONN" });
log.format("user=%s status=%d").error("alice", 500);
```

## Console Notes

- This library logs via `console.*`.
- If a specific `console` method is missing, it falls back to `console.log`
- If `console` is not defined, logging is a no-op
