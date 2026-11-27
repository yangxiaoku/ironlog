import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";
import { createDemoAiTransport } from "./ai-demo.js";
import { mountWebAssets } from "./web-assets.js";
import { seedWebDemo } from "./web-demo.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const demo = process.env.IRONLOG_WEB_DEMO === "true";
const dbPath = process.env.DATABASE_PATH ?? (demo ? "data/demo.db" : "data/gym.db");
const db = openDatabase(dbPath === ":memory:" ? ":memory:" : resolve(root, dbPath));
const hasLiveAi = Boolean(process.env.AI_BASE_URL && process.env.AI_MODEL && process.env.AI_API_KEY);
const { app, auth, store } = createApp(
  db,
  {
    allowDevLogin: !demo && process.env.ALLOW_DEV_LOGIN === "true",
    allowPrivateWebhooks: process.env.ALLOW_PRIVATE_WEBHOOKS === "true",
    healthDataExportWebhookUrl: process.env.HEALTH_DATA_EXPORT_WEBHOOK_URL,
    ai: demo && !hasLiveAi
      ? { baseUrl: "https://demo.invalid/v1", apiKey: "demo-session", model: "ironlog-demo-coach", mode: "demo" }
      : {
          baseUrl: process.env.AI_BASE_URL,
          apiKey: process.env.AI_API_KEY,
          model: process.env.AI_MODEL,
          timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90000),
          mode: "live",
        },
  },
  demo && !hasLiveAi ? createDemoAiTransport() : fetch,
);
if (demo) {
  const token = seedWebDemo(store, auth);
  app.get("/auth/web-demo", (c) => {
    const rawHost = (c.req.header("host") ?? "").trim().toLowerCase();
    const host = rawHost.startsWith("[") ? rawHost.replace(/\]:\d+$/, "]") : rawHost.replace(/:\d+$/, "");
    if (host && !["127.0.0.1", "localhost", "[::1]", "::1"].includes(host) && process.env.ALLOW_LAN_DEMO !== "true") {
      return c.json({ error: "演示入口仅限本机访问" }, 403);
    }
    c.header("Cache-Control", "no-store");
    return c.json({ token });
  });
}
mountWebAssets(app);
const hostname = process.env.HOST ?? "127.0.0.1";
const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 8080),
    hostname,
  },
  (info) => {
    const displayHost = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
    console.log(
      `铁记网页${demo ? "演示" : ""} http://${displayHost}:${info.port}/app/${hostname === "0.0.0.0" ? ` (listening on 0.0.0.0:${info.port})` : ""}`,
    );
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
