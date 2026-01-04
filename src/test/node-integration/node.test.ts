import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type DistModule = Awaited<typeof import("../../../dist/index.js")>;

function createConsoleSpies() {
  const outputs: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    trace: console.trace
  };

  const capture =
    (label: string, originalFn: (...args: unknown[]) => unknown = () => undefined) =>
    (...args: unknown[]) => {
      outputs.push([label, ...args.map(String)].join(" ").trim());
      return originalFn(...args);
    };

  console.log = capture("log", original.log);
  console.info = capture("info", original.info);
  console.warn = capture("warn", original.warn);
  console.error = capture("error", original.error);
  console.debug = capture("debug", original.debug);
  console.trace = capture("trace", original.trace ?? (() => undefined));

  return {
    outputs,
    restore: () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
      console.trace = original.trace;
    }
  };
}

describe("Node統合テスト", () => {
  let outputs: string[];
  let restoreConsole: () => void;

  beforeEach(() => {
    globalThis.__MYLOGGER_STATE__ = undefined;
    const spies = createConsoleSpies();
    outputs = spies.outputs;
    restoreConsole = spies.restore;
  });

  afterEach(() => {
    restoreConsole?.();
  });

  const runBundleTest = async (loadModule: () => Promise<DistModule>) => {
    const mod: DistModule = await loadModule();
    const { getLogger, setDefaultConfig, setLoggerLevel } = mod;

    const format = "[node %%][%app][%loggerName][%logLevel]";

    setDefaultConfig({
      level: "debug",
      prefixEnabled: true,
      prefixFormat: format,
      placeholders: { "%app": "demo-app" }
    });

    const logger = getLogger("node-test");
    logger.debug("debug line");
    logger.info("info line");
    logger.warn("warn line");

    setLoggerLevel("node-test", "error");
    logger.warn("should be filtered");
    logger.error("boom");

    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][DEBUG]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][INFO]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][WARN]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("should be filtered"))).toBeFalsy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][ERROR]"))).toBeTruthy();

    console.log("Nodeログ:", outputs);
  };

  it("出力したESMバンドルの動作確認", async () => {
    await runBundleTest(async () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const distUrl = pathToFileURL(path.resolve(__dirname, "../../../dist/index.js")).href;
      return import(distUrl);
    });
  });

  it("出力したCJSバンドルの動作確認", async () => {
    await runBundleTest(async () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const distPath = path.resolve(__dirname, "../../../dist/index.cjs");
      const require = createRequire(import.meta.url);
      return require(distPath) as DistModule;
    });
  });
});
