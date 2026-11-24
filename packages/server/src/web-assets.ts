import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Hono } from "hono";

const mime: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff2: "font/woff2",
  webmanifest: "application/manifest+json",
};
const compressible = new Set(["html", "js", "css", "svg", "webmanifest"]);
const csp =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

interface CachedAsset {
  mtimeMs: number;
  size: number;
  bytes: Uint8Array<ArrayBuffer>;
  gzip: Uint8Array<ArrayBuffer> | null;
  etag: string;
}

const assetCache = new Map<string, CachedAsset>();

export function mountWebAssets(app: Hono<{ Variables: { userId: string } }>) {
  app.get("/", (c) => c.redirect("/app/", 302));
  app.get("/app", (c) => c.redirect("/app/", 302));
  app.get("/app/*", (c) => {
    const name = c.req.path.slice("/app/".length) || "index.html";
    if (
      name.includes("..") ||
      !/^(?:assets\/)?[A-Za-z0-9._-]+\.(?:html|js|css|jpg|png|svg|webp|woff2|webmanifest)$/.test(name)
    ) {
      return c.notFound();
    }
    const legacy = process.env.IRONLOG_WEB_LEGACY === "true";
    const distBase = legacy ? "../../../web/dist/" : "../../../packages/web/dist/";
    const cacheKey = `${legacy ? "legacy" : "react"}:${name}`;
    const fileUrl = new URL(`${distBase}${name}`, import.meta.url);
    const ext = name.split(".").at(-1)!;
    let entry: CachedAsset;
    try {
      const stat = statSync(fileUrl);
      const cached = assetCache.get(cacheKey);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        entry = cached;
      } else {
        const raw = readFileSync(fileUrl);
        const bytes = new Uint8Array(raw);
        const gzip = compressible.has(ext) ? new Uint8Array(gzipSync(raw, { level: 6 })) : null;
        const etag = `"${createHash("sha256").update(raw).digest("hex").slice(0, 16)}"`;
        entry = { mtimeMs: stat.mtimeMs, size: stat.size, bytes, gzip, etag };
        assetCache.set(cacheKey, entry);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      assetCache.delete(cacheKey);
      if (name === "index.html") {
        return c.text(legacy ? "先运行 npm run build:web 生成铁记网页" : "先运行 npm run build:web-react 生成铁记网页", 503);
      }
      return c.notFound();
    }
    c.header("Content-Type", mime[ext]!);
    const cacheControl = name.startsWith("assets/")
      ? "public, max-age=31536000, immutable"
      : ext === "jpg" || ext === "png" || ext === "svg" || ext === "webp" || ext === "woff2"
        ? "public, max-age=86400, stale-while-revalidate=604800"
        : "no-cache";
    c.header("Cache-Control", cacheControl);
    c.header("ETag", entry.etag);
    c.header("Content-Security-Policy", csp);
    if (entry.gzip) c.header("Vary", "Accept-Encoding");
    if (c.req.header("If-None-Match") === entry.etag) return c.body(null, 304);
    if (entry.gzip && /\bgzip\b/i.test(c.req.header("Accept-Encoding") ?? "")) {
      c.header("Content-Encoding", "gzip");
      return c.body(entry.gzip);
    }
    return c.body(entry.bytes);
  });
}
