# ts-simple-logger

A simple logger for browsers and Node.

## Versions

https://github.com/Matumo/ts-simple-logger/tags

## Installation

```bash
npm install git+https://github.com/Matumo/ts-simple-logger.git#v0.2.2
```

## Usage

```ts
import { setDefaultConfig, setLoggerConfig, getLogger } from "ts-simple-logger";

// Set default configuration
setDefaultConfig({
  level: "info", // log level
  placeholders: { "%appName": "myapp" },
  prefixFormat: "%% [%appName] (%loggerName) %logLevel:",
  // Note: write `%%` in `prefixFormat` when you want a literal `%` in the output.
});
// Set config for a specific logger
setLoggerConfig("http" /* logger name */, { level: "debug" } /* logger config */);

const log = getLogger("http" /* logger name */);
log.info("server started");
// % [myapp] (http) INFO: server started
log.debug("detail...", { foo: "bar" });
// % [myapp] (http) DEBUG: detail... { foo: "bar" }
```
