// @ts-nocheck
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".aif" || ext === ".aiff") return "audio/aiff";
  return "application/octet-stream";
}

function realDrumPlugin(): Plugin {
  const realDrumDir = path.resolve(__dirname, "real_drum");
  let outDir = "";

  return {
    name: "real-drum-static",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const reqUrl = req.url ?? "";
        const pathname = reqUrl.split("?")[0] ?? "";
        const prefix = "/real-drum/";
        if (!pathname.startsWith(prefix)) {
          next();
          return;
        }

        const relativePath = pathname.slice(prefix.length);
        if (!relativePath) {
          next();
          return;
        }

        const targetPath = path.resolve(realDrumDir, relativePath);
        const relativeFromRoot = path.relative(realDrumDir, targetPath);
        if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        try {
          const stat = await fs.stat(targetPath);
          if (!stat.isFile()) {
            next();
            return;
          }
          res.setHeader("Content-Type", contentTypeFor(targetPath));
          createReadStream(targetPath).pipe(res);
          return;
        } catch {
          next();
          return;
        }
      });
    },
    async closeBundle() {
      const outputDir = path.join(outDir, "real-drum");
      await fs.mkdir(outDir, { recursive: true });
      await fs.cp(realDrumDir, outputDir, { recursive: true, force: true });
    }
  };
}

export default defineConfig({
  plugins: [react(), realDrumPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
