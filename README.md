# ts-simple-logger

A simple logger for browsers and Node.

## Published

https://www.npmjs.com/package/@matumo/ts-simple-logger

## Installation

```bash
npm install @matumo/ts-simple-logger
```

## Usage

```ts
import { setDefaultConfig, setLoggerConfig, getLogger } from "@matumo/ts-simple-logger";

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
setLoggerConfig("logger-name", { level: "debug" });

const log = getLogger("logger-name");
log.info("server started");
// % [myapp] (logger-name) INFO: server started
log.debug("detail...", { foo: "bar" });
// % [myapp] (logger-name) DEBUG: detail... { foo: "bar" }
```
