process.env.IRONLOG_WEB_DEMO = "true";
process.env.PORT ??= "4177";
await import("../packages/server/dist/index.js");
