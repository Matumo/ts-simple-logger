import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type StaticServer = {
  url: string;
  close: () => Promise<void>;
};

type StaticAsset = {
  filePath: string;
  contentType: string;
};

function createStaticAssetMap(rootDir: string): Map<string, StaticAsset> {
  const assetMap = new Map<string, StaticAsset>();
  const absoluteRoot = path.resolve(rootDir);
  const browserAsset = (fileName: string, contentType: string): StaticAsset => ({
    filePath: path.join(absoluteRoot, "src/test/browser-integration", fileName),
    contentType
  });
  const demoAsset = browserAsset("demo.html", "text/html; charset=utf-8");
  const demoStylesAsset = browserAsset("demo.css", "text/css; charset=utf-8");
  const testModuleAsset = browserAsset("test-module.html", "text/html; charset=utf-8");
  const testIifeAsset = browserAsset("test-iife.html", "text/html; charset=utf-8");
  const testSharedAsset = browserAsset("test-shared.js", "application/javascript; charset=utf-8");
  const moduleAsset: StaticAsset = {
    filePath: path.join(absoluteRoot, "dist/index.js"),
    contentType: "application/javascript; charset=utf-8"
  };
  const iifeAsset: StaticAsset = {
    filePath: path.join(absoluteRoot, "dist/index.iife.js"),
    contentType: "application/javascript; charset=utf-8"
  };
  const iifeMapAsset: StaticAsset = {
    filePath: path.join(absoluteRoot, "dist/index.iife.js.map"),
    contentType: "application/json; charset=utf-8"
  };
  const moduleMapAsset: StaticAsset = {
    filePath: path.join(absoluteRoot, "dist/index.js.map"),
    contentType: "application/json; charset=utf-8"
  };

  const register = (routes: string[], asset: StaticAsset) => {
    routes.forEach((route) => assetMap.set(route, asset));
  };

  register(["/", "/demo", "/demo.html"], demoAsset);
  register(["/demo.css"], demoStylesAsset);
  register(["/test-module", "/test-module.html"], testModuleAsset);
  register(["/test-iife", "/test-iife.html"], testIifeAsset);
  register(["/test-shared.js"], testSharedAsset);
  register(["/index.js"], moduleAsset);
  register(["/index.iife.js"], iifeAsset);
  register(["/index.iife.js.map"], iifeMapAsset);
  register(["/index.js.map"], moduleMapAsset);

  return assetMap;
}

export async function startStaticServer(rootDir: string): Promise<StaticServer> {
  const staticAssets = createStaticAssetMap(rootDir);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const asset = staticAssets.get(url.pathname);

    if (!asset) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    try {
      const body = await fs.readFile(asset.filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", asset.contentType);
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind static server");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  try {
    const server = await startStaticServer(repoRoot);
    console.log(`Demo server running at ${server.url}`);
    console.log("Press Ctrl+C to stop.");

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start static server.", error);
    process.exit(1);
  }
}
