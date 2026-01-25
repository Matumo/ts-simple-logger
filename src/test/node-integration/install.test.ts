import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runNode = (args: string[], cwd: string) => {
  const exec = promisify(execFile);
  const nodeCmd = process.execPath;
  return exec(nodeCmd, args, { cwd });
};
const runNpm = (args: string[], cwd: string) => {
  // Windowsではシェル経由で呼ぶことでspawn EINVALを回避する。
  const exec = promisify(execFile);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return exec(npmCmd, args, { cwd, shell: process.platform === "win32" });
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

describe("npm install 動作確認", () => {
  let tarballPath: string;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = await mkdtemp(path.join(tmpdir(), "ts-simple-logger-work-"));
    const packDir = path.resolve(repoRoot, "dist-pack");
    const entries = await readdir(packDir).catch(() => {
      throw new Error("dist-packが見つかりません。先にビルドしてください。");
    });
    const tarballs = entries.filter((name) => name.endsWith(".tgz"));
    if (tarballs.length === 0) {
      throw new Error("dist-packにテスト対象がありません。先にビルドしてください。");
    }
    if (tarballs.length !== 1) {
      throw new Error("dist-packにテスト対象が複数あります。1つのみ配置してください。");
    }
    const tarballName = tarballs[0];
    const tarballSrc = path.join(packDir, tarballName);
    tarballPath = path.join(workRoot, tarballName);
    await copyFile(tarballSrc, tarballPath);
  });

  afterAll(async () => {
    if (workRoot) {
      await rm(workRoot, { recursive: true, force: true });
    }
  });

  it("npm packしたtarballでインストール（CJS）", async () => {
    const projectDir = await mkdtemp(path.join(workRoot, "install-cjs-"));
    try {
      await runNpm(["init", "-y"], projectDir);
      await runNpm(["install", tarballPath], projectDir);
      const cjsScriptPath = path.join(projectDir, "smoke.cjs");
      await writeFile(
        cjsScriptPath,
        [
          'const { getLogger, setDefaultConfig } = require("@matumo/ts-simple-logger");',
          "setDefaultConfig({",
          '  level: "debug",',
          '  prefixEnabled: true,',
          '  prefixFormat: "[install-cjs][%loggerName][%logLevel]"',
          "});",
          'const logger = getLogger("install-test");',
          'logger.debug("ok-debug");',
          'logger.info("ok-info");'
        ].join("\n")
      );
      const { stdout: cjsOut } = await runNode([cjsScriptPath], projectDir);
      expect(cjsOut).toContain("[install-cjs][install-test][DEBUG] ok-debug");
      expect(cjsOut).toContain("[install-cjs][install-test][INFO] ok-info");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("npm packしたtarballでインストール（ESM）", async () => {
    const projectDir = await mkdtemp(path.join(workRoot, "install-esm-"));
    try {
      await runNpm(["init", "-y"], projectDir);
      await runNpm(["install", tarballPath], projectDir);
      const esmScriptPath = path.join(projectDir, "smoke.mjs");
      await writeFile(
        esmScriptPath,
        [
          'import { getLogger, setDefaultConfig } from "@matumo/ts-simple-logger";',
          "setDefaultConfig({",
          '  level: "debug",',
          '  prefixEnabled: true,',
          '  prefixFormat: "[install-esm][%loggerName][%logLevel]"',
          "});",
          'const logger = getLogger("install-test");',
          'logger.debug("ok-debug");',
          'logger.info("ok-info");'
        ].join("\n")
      );
      const { stdout: esmOut } = await runNode([esmScriptPath], projectDir);
      expect(esmOut).toContain("[install-esm][install-test][DEBUG] ok-debug");
      expect(esmOut).toContain("[install-esm][install-test][INFO] ok-info");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  }, 60_000);
});
