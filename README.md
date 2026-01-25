# ts-simple-logger

A simple logger for browsers and Node.

## Versions

https://github.com/Matumo/ts-simple-logger/tags

## Installation

```bash
pnpm add git+https://github.com/Matumo/ts-simple-logger.git#v0.3.0
```

## Usage

```ts
import { setDefaultConfig, setLoggerConfig, getLogger } from "ts-simple-logger";

// Set default configuration
setDefaultConfig({
  level: "info", // log level
  placeholders: {
    "%appName": "myapp",
    "%time": () => new Date().toISOString(),
  },
  prefixFormat: "%% [%appName] [%time] (%loggerName) %logLevel:",
  // Note: write `%%` in `prefixFormat` when you want a literal `%` in the output.
  // Note: placeholder functions run at log time and must return strings.
});
// Set config for a specific logger
setLoggerConfig("http" /* logger name */, { level: "debug" } /* logger config */);

const log = getLogger("http" /* logger name */);
log.info("server started");
// % [myapp] (http) INFO: server started
log.debug("detail...", { foo: "bar" });
// % [myapp] (http) DEBUG: detail... { foo: "bar" }
```
