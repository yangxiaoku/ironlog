import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { Hono } from "hono";

const mime: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  jpg: "image/jpeg", png: "image/png", webmanifest: "application/manifest+json",
};
const compressible = new Set(["html", "js", "css", "webmanifest"]);
const csp = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

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
    if (!/^[a-z0-9-]+\.(?:html|js|css|jpg|png|webmanifest)$/.test(name)) return c.notFound();
    const fileUrl = new URL(`../../../web/dist/${name}`, import.meta.url);
    const ext = name.split(".").at(-1)!;
    let entry: CachedAsset;
    try {
      const stat = statSync(fileUrl);
      const cached = assetCache.get(name);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        entry = cached;
      } else {
        const raw = readFileSync(fileUrl);
        const bytes = new Uint8Array(raw);
        const gzip = compressible.has(ext) ? new Uint8Array(gzipSync(raw, { level: 6 })) : null;
        const etag = `"${createHash("sha256").update(raw).digest("hex").slice(0, 16)}"`;
        entry = { mtimeMs: stat.mtimeMs, size: stat.size, bytes, gzip, etag };
        assetCache.set(name, entry);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      assetCache.delete(name);
      if (name === "index.html") return c.text("先运行 npm run build:web 生成铁记网页", 503);
      return c.notFound();
    }
    c.header("Content-Type", mime[ext]!);
    c.header("Cache-Control", "no-cache");
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
