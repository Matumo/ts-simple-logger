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
    (label: string) =>
    (...args: unknown[]) => {
      outputs.push([label, ...args.map(String)].join(" ").trim());
    };

  console.log = capture("log");
  console.info = capture("info");
  console.warn = capture("warn");
  console.error = capture("error");
  console.debug = capture("debug");
  console.trace = capture("trace");

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

    let tick = 0;
    const format = "[node %%][%app][%loggerName][%logLevel][%tick]";

    setDefaultConfig({
      level: "debug",
      prefixEnabled: true,
      prefixFormat: format,
      placeholders: { "%app": "demo-app", "%tick": () => `tick-${++tick}` }
    });

    const logger = getLogger("node-test");
    logger.debug("debug line");
    logger.info("info line");
    logger.warn("warn line");

    setLoggerLevel("node-test", "error");
    logger.warn("should be filtered");
    logger.error("boom");

    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][DEBUG][tick-1]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][INFO][tick-2]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][WARN][tick-3]"))).toBeTruthy();
    expect(outputs.some((line) => line.includes("should be filtered"))).toBeFalsy();
    expect(outputs.some((line) => line.includes("[node %][demo-app][node-test][ERROR][") && line.includes("boom"))).toBeTruthy();

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
      return require(distPath);
    });
  });
});
