import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";

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
  const htmlAsset: StaticAsset = {
    filePath: path.join(absoluteRoot, "src/test/browser-integration/demo.html"),
    contentType: "text/html; charset=utf-8"
  };
  const moduleAsset: StaticAsset = {
    filePath: path.join(absoluteRoot, "dist/index.js"),
    contentType: "application/javascript; charset=utf-8"
  };
  const iifeAsset: StaticAsset = {
    filePath: path.join(absoluteRoot, "dist/index.iife.js"),
    contentType: "application/javascript; charset=utf-8"
  };

  const register = (routes: string[], asset: StaticAsset) => {
    routes.forEach((route) => assetMap.set(route, asset));
  };

  register(["/", "/demo", "/demo.html"], htmlAsset);
  register(["/index.js"], moduleAsset);
  register(["/index.iife.js"], iifeAsset);

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
