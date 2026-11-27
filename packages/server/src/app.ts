import { gzipSync } from "node:zlib";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import {
  BACKUP_JSON_LIMIT_LABEL,
  BACKUP_JSON_MAX_BYTES,
  appleWorkoutAnnotationInput,
  applyWorkoutAdaptation,
  catalogueDataVersion,
  entityKindSchema,
  getExerciseCategory,
  energyProfileSchema,
  localDate,
  mutationSchema,
  nutritionFingerprint,
  nutritionDayComplete,
  profileSchema,
  planSchema,
  quickFoodSchema,
  matchesExercise,
  muscleNames,
  starterPlans,
  trackGoals,
  workoutAdaptationSchema,
  workoutPrefsPatchSchema,
  workoutPrefsSchema,
  workoutSchema,
  type Diet,
  type Mutation,
  type MutationResult,
  type NutritionDay,
} from "@ironlog/shared";
import { Auth } from "./auth.js";
import { AiService, type AiConfig } from "./ai.js";
import { serverCatalogue } from "./catalogue.js";
import { AppleHealth, appleEventInput, appleWebSessionStartInput, appleWorkoutInput } from "./apple-health.js";
import { isEnabledHealthFlag, listDailyHealth, upsertDailyHealth } from "./apple-health-daily.js";
import { readHealthDataExport } from "./health-data-export.js";
import { catalogueETag, catalogueLookup, catalogueQuery, CloudCatalogue, exerciseFrame } from "./cloud-catalogue.js";
import { DomainError, Store } from "./store.js";
import { getStats, getTrainingContext } from "./stats.js";
import { getWebStatistics, saveWebPreferences, shiftDay, webPreferences, webPreferencesInput, webStatsQuery } from "./web-statistics.js";
import { getWebAnalytics, webAnalyticsQuery } from "./web-analytics.js";
import { getWebBadges } from "./web-badges.js";
import {
  clearWebScheduleDay,
  getWebExercisePrs,
  getWebExerciseReferences,
  getWebRoutine,
  getWebSchedule,
  getWebScheduleDay,
  getWebToday,
  referenceInput,
  routineQuery,
  saveWebScheduleDay,
  scheduleDayPutInput,
  scheduleRangeQuery,
  scheduleShiftInput,
  shiftWebScheduleDay,
  syncPlanRoutineInput,
  syncWorkoutRoutineToActivePlan,
} from "./web-training.js";
import { getWebWorkoutReport } from "./web-workout-report.js";
import {
  buildWebCsv,
  csvExportKind,
  deleteMeasurement,
  exerciseNoteInput,
  getExerciseHistory,
  getTrainedExercisesSummary,
  listExerciseNotes,
  listMeasurements,
  measurementInput,
  saveExerciseNote,
  saveMeasurement,
  updateDailyWater,
  waterUpdateInput,
} from "./web-extras.js";
import {
  commitWorkoutCsvImport,
  csvImportInput,
  importPlanJson,
  planJsonImportInput,
  previewWorkoutCsvImport,
} from "./web-import.js";
import { agendaQuery, describeAppleActivity, listAppleTraining } from "./apple-training-agenda.js";
import { WebAuth, webCredentialsInput, webLoginInput, webPasswordChangeInput, webSessionSeconds } from "./web-auth.js";
import type { Db } from "./db.js";

export interface AppConfig {
  allowDevLogin?: boolean;
  trustProxy?: boolean;
  ai?: AiConfig;
  healthDataExportWebhookUrl?: string;
}
const webProfileFields = profileSchema.pick({
  calories: true, protein: true, carbs: true, fat: true,
  targetWeight: true, daysPerWeek: true, restSeconds: true,
}).required().extend({
  energyProfile: energyProfileSchema.nullable(),
  equipment: z.array(z.string().max(100)).max(30).optional(),
});
const webProfileInput = webProfileFields.extend({
  version: z.number().int().nonnegative(), opId: mutationSchema.shape.opId,
});
const cookieName = "ironlog_session";
let builtinCatalogueCache: { raw: Uint8Array<ArrayBuffer>; gzip: Uint8Array<ArrayBuffer> } | null = null;
function getBuiltinCataloguePayload() {
  if (!builtinCatalogueCache) {
    const raw = new Uint8Array(
      Buffer.from(JSON.stringify({ version: catalogueDataVersion, exercises: serverCatalogue }), "utf8"),
    );
    const gzip = new Uint8Array(gzipSync(raw, { level: 6 }));
    builtinCatalogueCache = { raw, gzip };
  }
  return builtinCatalogueCache;
}
const apple = "/api/integrations/apple-health";
const healthExport = `${apple}/health-data-export`;
const healthExportImport = `${healthExport}/import`;
const healthExportWebhook = `${healthExport}/webhook`;
const httpLoopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const readOnlyMethods = new Set(["GET", "HEAD", "OPTIONS"]);
function browserOrigin(c: Context, trustProxy: boolean) {
  const url = new URL(c.req.url);
  const forwarded = trustProxy ? c.req.header("X-Forwarded-Proto")?.trim().toLowerCase() : undefined;
  const secure = url.protocol === "https:" || forwarded === "https";
  return { origin: (secure ? "https://" : "http://") + url.host, secure, local: httpLoopback.has(url.hostname) };
}
function checkBrowserWrite(c: Context, trustProxy: boolean) {
  const { origin, secure, local } = browserOrigin(c, trustProxy);
  const source = c.req.header("Origin"), site = c.req.header("Sec-Fetch-Site");
  if ((source && source !== origin) || (site && site !== "same-origin" && site !== "none"))
    throw new DomainError("请从铁记网页操作", 403);
  if (!secure && !local && process.env.ALLOW_INSECURE_HTTP !== "true")
    throw new DomainError("请使用 HTTPS 打开铁记", 403);
}
function cookieOptions(c: Context, trustProxy: boolean) {
  const { secure } = browserOrigin(c, trustProxy);
  return { prefix: secure ? "host" as const : undefined, httpOnly: true, secure, sameSite: "Strict" as const, path: "/" };
}
function requestPeer(c: Context, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try { return getConnInfo(c).remote.address ?? "local"; }
  catch { return "local"; }
}

export function createApp(
  db: Db,
  config: AppConfig = {},
  transport: typeof fetch = fetch,
) {
  const store = new Store(db);
  const trustProxy = config.trustProxy ?? (process.env.TRUST_PROXY === "true");
  const auth = new Auth(db);
  const browser = new WebAuth(db);
  const ai = new AiService(store, config.ai ?? {}, transport);
  const health = new AppleHealth(db);
  const catalogue = new CloudCatalogue(db);
  const stmtPlanHistory = db.prepare(
    "SELECT id,version,data,created_at AS createdAt FROM plan_versions WHERE user_id=? ORDER BY created_at DESC",
  );
  const app = new Hono<{ Variables: { userId: string } }>();
  const defaultBody = bodyLimit({ maxSize: 2 * 1024 * 1024 });
  const healthExportBody = bodyLimit({
    maxSize: 16 * 1024 * 1024,
    onError: (c) => c.json({ error: "训练导出超过 16 MB，请缩短日期范围或只导出 Workouts（体能训练）" }, 413),
  });
  const csvImportBody = bodyLimit({
    maxSize: 4 * 1024 * 1024,
    onError: (c) => c.json({ error: "CSV 导入内容过大，请控制在 2 MB 以内或分批导入" }, 413),
  });
  const backupImportBody = bodyLimit({
    maxSize: BACKUP_JSON_MAX_BYTES + 4096,
    onError: (c) => c.json({ error: `全量备份 JSON 超过 ${BACKUP_JSON_LIMIT_LABEL}，请通过服务器 SQLite 备份恢复` }, 413),
  });
  app.use("*", secureHeaders());
  app.use("*", (c, next) =>
    c.req.method === "POST" && (c.req.path === healthExportImport || c.req.path === healthExportWebhook)
      ? next()
      : c.req.method === "POST" && c.req.path.startsWith("/api/web/import-csv/")
        ? csvImportBody(c, next)
        : c.req.method === "POST" && c.req.path === "/api/web/restore-backup"
          ? backupImportBody(c, next)
          : defaultBody(c, next));
  app.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) {
      const issuesSummary = error.issues.map((i) => `${i.path.join(".") || "<root>"}:${i.message}`).join("; ");
      console.warn(
        c.req.path.startsWith(apple) ? "Ironlog Apple Health input rejected" : "Ironlog input rejected",
        c.req.method,
        c.req.path,
        issuesSummary,
      );
      return c.json(
        {
          error: "输入格式不正确",
          details: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
        400,
      );
    }
    if (error instanceof DomainError)
      return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError)
      return c.json({ error: "请求需要有效 JSON" }, 400);
    if (error.name === "TimeoutError" || error.name === "AbortError")
      return c.json({ error: "请求超时，输入已保留，可重新尝试" }, 503);
    console.error("Ironlog request failed", error.name, error.message);
    return c.json({ error: "服务处理失败，请稍后重试" }, 500);
  });
  app.get("/health", (c) =>
    c.json({ ok: true, name: "铁记", version: "0.1.0" }),
  );
  app.post("/auth/dev", async (c) => {
    if (!config.allowDevLogin) throw new DomainError("开发登录未启用", 403);
    const input = z
      .object({ identity: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/) })
      .parse(await c.req.json());
    return c.json(auth.login(`dev:${input.identity}`));
  });
  app.use("/auth/web/*", bodyLimit({ maxSize: 4096 }));
  app.use("/auth/web/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    checkBrowserWrite(c, trustProxy);
    await next();
  });
  for (const mode of ["register", "login"] as const) {
    app.post(`/auth/web/${mode}`, async (c) => {
      const registering = mode === "register";
      if (registering && process.env.ALLOW_REGISTRATION === "false")
        throw new DomainError("当前服务器已关闭公开注册", 403);
      const peer = requestPeer(c, trustProxy);
      browser.limit(mode + ":peer:" + peer, registering ? 12 : 60, registering ? 60 * 60_000 : undefined);
      if (c.req.header("Content-Type")?.split(";", 1)[0]?.trim() !== "application/json")
        throw new DomainError("请提交 JSON 格式的账号资料");
      const input = (registering ? webCredentialsInput : webLoginInput).parse(await c.req.json());
      if (!registering) browser.limit("login:username:" + input.username, 12);
      const account = registering ? await browser.register(input) : await browser.login(input);
      const options = cookieOptions(c, trustProxy);
      const session = browser.issueSession(account.userId, getCookie(c, cookieName, options.prefix));
      setCookie(c, cookieName, session, { ...options, maxAge: webSessionSeconds });
      return c.json(account, registering ? 201 : 200);
    });
  }
  app.post("/auth/web/logout", (c) => {
    const options = cookieOptions(c, trustProxy);
    browser.revokeSession(getCookie(c, cookieName, options.prefix));
    deleteCookie(c, cookieName, options);
    return c.json({ ok: true });
  });
  const healthBody = bodyLimit({ maxSize: 16 * 1024 });
  app.post(`${apple}/workouts`, healthBody, async (c) => {
    const device = health.identify(c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1]);
    const key = z.string().trim().min(1).max(128).optional().parse(c.req.header("Idempotency-Key"));
    const result = health.ingest(device, appleWorkoutInput.parse(await c.req.json()), key);
    return c.json(result, result.ingestStatus === "imported" ? 201 : 200);
  });
  app.post(`${apple}/events`, healthBody, async (c) => {
    const device = health.identify(c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1]);
    const result = health.event(device, appleEventInput.parse(await c.req.json()));
    return c.json(result, result.ingestStatus === "imported" ? 201 : 200);
  });
  app.get(`${apple}/events/active`, (c) => {
    c.header("Cache-Control", "no-store");
    const device = health.identify(c.req.header("Authorization")?.match(/^Bearer (.+)$/i)?.[1]);
    return c.json(health.activeEvent(device, c.req.query("activityType"), { closeShort: c.req.query("closeShort") === "1" }));
  });
  app.post(`${apple}/daily`, async (c) => {
    c.header("Cache-Control", "no-store");
    const device = health.identify(c.req.header("Authorization")?.match(/^Bearer (.+)$/i)?.[1]);
    const payload = await c.req.json();
    if (process.env.IRONLOG_CAPTURE_DAILY === "1") {
      const obj = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
      const dailyObj = obj?.daily && typeof obj.daily === "object" && !Array.isArray(obj.daily)
        ? (obj.daily as Record<string, unknown>)
        : obj;
      const samples = dailyObj?.sleepSamples;
      console.info(
        "[apple-daily-capture]",
        JSON.stringify({
          at: new Date().toISOString(),
          hasSleepKey: Boolean(dailyObj && Object.hasOwn(dailyObj, "sleepSamples")),
          sleepSampleCount: Array.isArray(samples) ? samples.length
            : typeof samples === "string" ? samples.split(/\r?\n/).filter((line) => line.trim()).length : 0,
        }),
      );
    }
    const dryRun = isEnabledHealthFlag(c.req.query("dryRun"))
      || isEnabledHealthFlag((payload as Record<string, unknown>)?.dryRun);
    return c.json(upsertDailyHealth(store, device.userId, payload, { dryRun }));
  });
  app.post(healthExportWebhook, async (c, next) => {
    c.header("Cache-Control", "no-store");
    const device = health.identify(c.req.header("Authorization")?.match(/^Bearer (.+)$/i)?.[1]);
    c.set("userId", device.userId);
    await next();
  }, healthExportBody, async (c) => {
    const workouts = readHealthDataExport(await c.req.json(), true);
    return c.json({ ok: true, ...health.importWorkouts(c.get("userId"), workouts) });
  });
  app.use("/api/*", async (c, next) => {
    await next();
    if (!/\bgzip\b/i.test(c.req.header("Accept-Encoding") ?? "")) return;
    const res = c.res;
    if (
      (res.status !== 200 && res.status !== 201) ||
      res.headers.has("Content-Encoding") ||
      !(res.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")
    ) {
      return;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 1024) {
      c.res = new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
      return;
    }
    const compressed = new Uint8Array(gzipSync(buf, { level: 6 }));
    const headers = new Headers(res.headers);
    headers.delete("Content-Length");
    headers.set("Content-Encoding", "gzip");
    const vary = headers.get("Vary");
    if (!vary || !/\baccept-encoding\b/i.test(vary)) headers.append("Vary", "Accept-Encoding");
    c.res = new Response(compressed, { status: res.status, statusText: res.statusText, headers });
  });
  app.get("/api/catalogue/version", (c) => {
    c.header("ETag", catalogueETag);
    c.header("Cache-Control", "public, max-age=60");
    if (c.req.header("If-None-Match") === catalogueETag) return c.body(null, 304);
    return c.json(catalogue.version());
  });
  app.get("/api/catalogue/exercises", (c) =>
    c.json(catalogue.page(catalogueQuery.parse(c.req.query()))));
  app.post("/api/catalogue/exercises/lookup", async (c) =>
    c.json(catalogue.lookup(catalogueLookup.parse(await c.req.json()))));
  app.post("/api/catalogue/exercises/details", async (c) =>
    c.json(catalogue.details(catalogueLookup.pick({ ids: true }).parse(await c.req.json()).ids)));
  app.get("/api/catalogue/exercises/:id", (c) => {
    c.header("ETag", catalogueETag);
    c.header("Cache-Control", "public, max-age=300");
    if (c.req.header("If-None-Match") === catalogueETag) return c.body(null, 304);
    return c.json(catalogue.detail(c.req.param("id")));
  });
  app.get("/media/exercises/:filename", (c) => {
    const image = exerciseFrame(c.req.param("filename"));
    const etag = `"${image.hash}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", c.req.query("v") === image.hash ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
    c.header("Content-Type", image.contentType);
    c.header("Link", `<${image.licenseUrl}>; rel="license"`);
    return c.body(new Uint8Array(image.bytes));
  });
  app.use("/api/*", async (c, next) => {
    const authorization = c.req.header("Authorization");
    c.header("Cache-Control", "no-store");
    if (authorization !== undefined) {
      const token = authorization.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new DomainError("请先登录", 401);
      c.set("userId", auth.identify(token));
    } else {
      const userId = browser.identify(getCookie(c, cookieName, cookieOptions(c, trustProxy).prefix));
      const expected = c.req.header("X-Ironlog-Account");
      if (expected && expected !== userId) throw new DomainError("账号已切换，请重新登录", 401);
      if (!readOnlyMethods.has(c.req.method)) {
        checkBrowserWrite(c, trustProxy);
        if (!expected) throw new DomainError("请从铁记网页操作", 403);
      }
      c.set("userId", userId);
    }
    await next();
  });
  app.get("/api/me", (c) => {
    const userId = c.get("userId");
    const hasAnyRecord =
      store.list(userId, "workout").length > 0 ||
      store.list(userId, "diet").length > 0 ||
      store.list(userId, "weight").length > 0 ||
      store.list(userId, "plan").length > 0;
    return c.json({
      userId,
      username: browser.username(userId),
      aiReady: ai.ready(),
      appleHealthConnected: health.hasConnection(userId),
      isNewUser: !hasAnyRecord,
    });
  });
  app.get("/api/web/statistics", (c) =>
    c.json(getWebStatistics(store, c.get("userId"), webStatsQuery.parse(c.req.query()))));
  app.get("/api/web/analytics", (c) =>
    c.json(getWebAnalytics(store, c.get("userId"), webAnalyticsQuery.parse(c.req.query()))));
  app.get("/api/web/badges", (c) => c.json(getWebBadges(store, c.get("userId"))));
  app.get("/api/web/today", (c) => c.json(getWebToday(store, c.get("userId"))));
  app.get("/api/web/workout-report/:id", (c) =>
    c.json(getWebWorkoutReport(store, c.get("userId"), mutationSchema.shape.id.parse(c.req.param("id")))));
  app.get("/api/web/records/:kind/:id", (c) => {
    const kind = z.enum(["workout", "diet", "weight"]).parse(c.req.param("kind"));
    const id = mutationSchema.shape.id.parse(c.req.param("id"));
    const includeDeleted = kind === "weight" && c.req.query("includeDeleted") === "1";
    const record = store.get(c.get("userId"), kind, id);
    if (!record || (record.deleted && !includeDeleted)) throw new DomainError("找不到这条记录", 404);
    return c.json(record);
  });
  app.get("/api/web/routine", (c) =>
    c.json(getWebRoutine(store, c.get("userId"), routineQuery.parse(c.req.query()))));
  app.post("/api/web/exercise-references", async (c) =>
    c.json(getWebExerciseReferences(store, c.get("userId"), referenceInput.parse(await c.req.json()))));
  app.post("/api/web/exercise-prs", async (c) =>
    c.json(getWebExercisePrs(store, c.get("userId"), referenceInput.parse(await c.req.json()))));
  app.get("/api/web/exercise-notes", (c) =>
    c.json(listExerciseNotes(db, c.get("userId"))));
  app.put("/api/web/exercise-notes/:exerciseId", async (c) =>
    c.json(saveExerciseNote(db, c.get("userId"), mutationSchema.shape.id.parse(c.req.param("exerciseId")),
      exerciseNoteInput.parse(await c.req.json()).note)));
  app.get("/api/web/exercise-history/:exerciseId", (c) =>
    c.json(getExerciseHistory(store, c.get("userId"), mutationSchema.shape.id.parse(c.req.param("exerciseId")))));
  app.get("/api/web/trained-exercises", (c) =>
    c.json(getTrainedExercisesSummary(store, c.get("userId"))));
  app.get("/api/web/measurements", (c) =>
    c.json(listMeasurements(db, c.get("userId"))));
  app.put("/api/web/measurements", async (c) =>
    c.json(saveMeasurement(db, c.get("userId"), measurementInput.parse(await c.req.json()))));
  app.delete("/api/web/measurements/:date", (c) =>
    c.json(deleteMeasurement(db, c.get("userId"), z.iso.date().parse(c.req.param("date")))));
  app.post("/api/web/water", async (c) =>
    c.json(updateDailyWater(db, c.get("userId"), waterUpdateInput.parse(await c.req.json()))));
  app.get("/api/web/export-csv/:kind", (c) => {
    const { filename, content } = buildWebCsv(store, c.get("userId"), csvExportKind.parse(c.req.param("kind")));
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });
  app.post("/api/web/import-csv/preview", async (c) =>
    c.json(previewWorkoutCsvImport(store, c.get("userId"), csvImportInput.parse(await c.req.json()))));
  app.post("/api/web/import-csv/commit", async (c) =>
    c.json(commitWorkoutCsvImport(store, c.get("userId"), csvImportInput.parse(await c.req.json()))));
  app.get("/api/web/starter-plans", (c) => {
    const cat = store.catalogueMap(c.get("userId"), true);
    const trackedMuscles = new Set(["chest", "back", "legs", "shoulders", "arms", "core"]);
    return c.json(starterPlans.map((preset) => {
      const exerciseNames: Record<string, string> = {};
      const muscleMap = new Map<string, number>();
      for (const routine of preset.plan.routines) {
        for (const item of routine.exercises) {
          const ex = cat.get(item.exerciseId);
          if (ex) {
            exerciseNames[item.exerciseId] = ex.name;
            if (trackedMuscles.has(ex.muscle)) {
              muscleMap.set(ex.muscle, (muscleMap.get(ex.muscle) ?? 0) + item.sets);
            }
            for (const sec of ex.secondaryMuscles) {
              if (sec !== ex.muscle && trackedMuscles.has(sec)) {
                muscleMap.set(sec, (muscleMap.get(sec) ?? 0) + item.sets * 0.5);
              }
            }
          }
          if (item.backupExerciseId) {
            const bk = cat.get(item.backupExerciseId);
            if (bk) exerciseNames[item.backupExerciseId] = bk.name;
          }
        }
      }
      const weeklyMuscleSets = [...muscleMap.entries()]
        .map(([key, sets]) => ({
          key,
          name: muscleNames[key as keyof typeof muscleNames] ?? key,
          sets: Math.round(sets * 10) / 10,
        }))
        .sort((a, b) => b.sets - a.sets);
      return { ...preset, exerciseNames, weeklyMuscleSets };
    }));
  });
  app.post("/api/web/starter-plans/:id/adopt", async (c) => {
    const presetId = mutationSchema.shape.id.parse(c.req.param("id"));
    const preset = starterPlans.find((item) => item.id === presetId);
    if (!preset) throw new DomainError("找不到对应的经典方案", 404);
    const input = z.object({
      mode: z.enum(["apply", "draft"]).default("apply"),
      expectedRevision: z.number().int().min(0).optional(),
    }).parse(await c.req.json().catch(() => ({})));
    const userId = c.get("userId");
    const result = db.transaction(() => {
      const draft = store.createDraft(userId, preset.plan);
      if (!draft.record) throw new DomainError("创建计划草稿失败", 409);
      if (input.mode === "draft") {
        return { mode: "draft" as const, draft: draft.record, activePlan: store.planSchedule(userId) };
      }
      const activePlan = store.applyPlan(
        userId,
        draft.record.id,
        draft.record.version,
        input.expectedRevision ?? (store.activePlan(userId)?.revision ?? 0),
        false,
      );
      return { mode: "apply" as const, draft: draft.record, activePlan };
    }).immediate();
    return c.json(result, 201);
  });
  app.post("/api/web/plans/import-json", async (c) => {
    const res = importPlanJson(store, c.get("userId"), planJsonImportInput.parse(await c.req.json()));
    return c.json(res, res.mode === "preview" ? 200 : 201);
  });
  app.post("/api/web/plans/sync-routine", async (c) => {
    return c.json(syncWorkoutRoutineToActivePlan(store, c.get("userId"), syncPlanRoutineInput.parse(await c.req.json())));
  });
  app.get("/api/web/schedule", (c) =>
    c.json(getWebSchedule(store, c.get("userId"), scheduleRangeQuery.parse(c.req.query()))));
  app.get("/api/web/schedule/:date", (c) =>
    c.json(getWebScheduleDay(store, c.get("userId"), z.iso.date().parse(c.req.param("date")))));
  app.put("/api/web/schedule/:date", async (c) =>
    c.json(saveWebScheduleDay(store, c.get("userId"), z.iso.date().parse(c.req.param("date")),
      scheduleDayPutInput.parse(await c.req.json()))));
  app.delete("/api/web/schedule/:date", (c) =>
    c.json(clearWebScheduleDay(store, c.get("userId"), z.iso.date().parse(c.req.param("date")), c.req.query("opId"))));
  app.post("/api/web/schedule/shift", async (c) =>
    c.json(shiftWebScheduleDay(store, c.get("userId"), scheduleShiftInput.parse(await c.req.json()))));
  app.get("/api/web/preferences", (c) => c.json(webPreferences(db, c.get("userId"))));
  app.put("/api/web/preferences", async (c) =>
    c.json(saveWebPreferences(db, c.get("userId"), webPreferencesInput.parse(await c.req.json()))));
  app.get("/api/web/nutrition-day", (c) => {
    const date = z.iso.date().parse(c.req.query("date"));
    const userId = c.get("userId");
    const current = store.get(userId, "nutritionDay", "nutritionDay_" + date);
    return c.json({ complete: !current?.deleted && nutritionDayComplete(current?.data as NutritionDay | undefined,
      store.list(userId, "diet")) });
  });
  app.put("/api/web/nutrition-day", async (c) => {
    const { date, opId } = z.object({ date: z.iso.date(), opId: mutationSchema.shape.opId }).parse(await c.req.json());
    const userId = c.get("userId");
    if (date > localDate()) throw new DomainError("只能标记今天或之前的饮食");
    return c.json(db.transaction(() => {
      const id = "nutritionDay_" + date;
      const meals = store.list(userId, "diet").filter((record) => (record.data as Diet).date === date);
      if (!meals.length) throw new DomainError("这一天还没有饮食记录");
      const record = store.get(userId, "nutritionDay", id);
      if (record && !record.deleted && nutritionDayComplete(record.data as NutritionDay, meals)) return { complete: true };
      store.mutate(userId, { kind: "nutritionDay", id, opId, baseVersion: record?.version ?? 0,
        deleted: false, data: { date, complete: true, fingerprint: nutritionFingerprint(date, meals) } });
      return { complete: true };
    }).immediate());
  });
  app.get("/api/web/profile", (c) => {
    const record = store.get(c.get("userId"), "profile", "settings");
    return c.json({ profile: profileSchema.parse(record?.deleted ? {} : record?.data ?? {}), version: record?.version ?? 0 });
  });
  app.put("/api/web/profile", async (c) => {
    const { version, opId, ...changes } = webProfileInput.parse(await c.req.json());
    const userId = c.get("userId");
    return c.json(db.transaction(() => {
      const receipt = store.operation(userId, opId);
      if (receipt) {
        const request = JSON.parse(receipt.request) as Mutation;
        const { record } = JSON.parse(receipt.result) as MutationResult;
        if (request.kind !== "profile" || request.id !== "settings" || request.deleted || request.baseVersion !== version || !record)
          throw new DomainError("操作 ID 已用于其他请求", 409);
        const profile = profileSchema.parse(record.data);
        const normalizedExisting = webProfileFields.parse({
          ...profile,
          ...(changes.equipment === undefined ? { equipment: undefined } : {}),
        });
        if (JSON.stringify(normalizedExisting) !== JSON.stringify(webProfileFields.parse(changes)))
          throw new DomainError("操作 ID 已用于其他请求", 409);
        return { profile, version: record.version };
      }
      const existing = store.get(userId, "profile", "settings");
      if ((existing?.version ?? 0) !== version) throw new DomainError("目标已在其他设备更新，请重新加载", 409);
      const previous = profileSchema.parse(existing?.deleted ? {} : existing?.data ?? {});
      const date = localDate();
      const profile = trackGoals(previous, {
        ...previous,
        ...changes,
        equipment: changes.equipment ?? previous.equipment,
        calorieEstimate: changes.energyProfile
          ? { method: "mifflin-st-jeor-1990", asOf: date, inputs: changes.energyProfile } : previous.calorieEstimate,
      },
      date, existing && !existing.deleted ? localDate(Date.parse(existing.updatedAt)) : undefined);
      const result = store.mutate(userId, {
        id: "settings", kind: "profile", opId, baseVersion: version, data: profile, deleted: false,
      });
      if (result.status === "conflict") throw new DomainError("目标已在其他设备更新，请重新加载", 409);
      return { profile, version: result.record!.version };
    }).immediate());
  });
  app.put("/api/web/profile/workout-prefs", async (c) => {
    const patch = workoutPrefsPatchSchema.parse(await c.req.json());
    const userId = c.get("userId");
    return c.json(db.transaction(() => {
      const existing = store.get(userId, "profile", "settings");
      const baseVersion = existing?.version ?? 0;
      const previous = profileSchema.parse(existing?.deleted ? {} : existing?.data ?? {});
      const nextWorkoutPrefs = workoutPrefsSchema.parse({
        ...(previous.workoutPrefs ?? {}),
        ...patch,
      });
      const nextProfile = {
        ...previous,
        workoutPrefs: nextWorkoutPrefs,
      };
      const result = store.mutate(userId, {
        id: "settings",
        kind: "profile",
        opId: crypto.randomUUID(),
        baseVersion,
        data: nextProfile,
        deleted: false,
      });
      if (result.status === "conflict") throw new DomainError("目标已在其他设备更新，请重新加载", 409);
      return { workoutPrefs: nextWorkoutPrefs, version: result.record!.version };
    }).immediate());
  });
  app.put("/api/web/profile/quick-foods", async (c) => {
    const input = z.union([
      z.object({ upsert: quickFoodSchema }),
      z.object({ removeId: z.string().trim().min(1).max(100) }),
      z.object({ quickFoods: z.array(quickFoodSchema).max(60) }),
    ]).parse(await c.req.json());
    const userId = c.get("userId");
    return c.json(db.transaction(() => {
      const existing = store.get(userId, "profile", "settings");
      const baseVersion = existing?.version ?? 0;
      const previous = profileSchema.parse(existing?.deleted ? {} : existing?.data ?? {});
      const curList = previous.quickFoods ?? [];
      let nextQuickFoods = curList;
      if ("upsert" in input) {
        nextQuickFoods = [
          input.upsert,
          ...curList.filter((q) => q.id !== input.upsert.id && q.name !== input.upsert.name),
        ].slice(0, 60);
      } else if ("removeId" in input) {
        nextQuickFoods = curList.filter((q) => q.id !== input.removeId);
      } else {
        nextQuickFoods = input.quickFoods;
      }
      const nextProfile = {
        ...previous,
        quickFoods: nextQuickFoods,
      };
      const result = store.mutate(userId, {
        id: "settings",
        kind: "profile",
        opId: crypto.randomUUID(),
        baseVersion,
        data: nextProfile,
        deleted: false,
      });
      if (result.status === "conflict") throw new DomainError("个人食物库已在其他设备更新，请重新加载", 409);
      return { quickFoods: nextQuickFoods, version: result.record!.version };
    }).immediate());
  });
  app.get(`${apple}/tokens`, (c) => c.json(health.devices(c.get("userId"))));
  app.post(`${apple}/tokens`, async (c) => {
    const { label } = z.object({ label: z.string().trim().min(1).max(80) }).parse(await c.req.json());
    return c.json(health.issue(c.get("userId"), label), 201);
  });
  app.delete(`${apple}/tokens/:id`, (c) => {
    health.revoke(c.get("userId"), c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get(`${apple}/workouts`, (c) => c.json(health.workouts(c.get("userId"))));
  app.put(`${apple}/workouts/:id/annotation`, async (c) =>
    c.json(health.saveWorkoutAnnotation(c.get("userId"), mutationSchema.shape.id.parse(c.req.param("id")),
      appleWorkoutAnnotationInput.parse(await c.req.json()))));
  app.delete(`${apple}/workouts/:id`, (c) =>
    c.json(health.deleteWorkout(c.get("userId"), mutationSchema.shape.id.parse(c.req.param("id")))));
  app.delete(`${apple}/active-session`, (c) =>
    c.json(health.clearActiveSessions(c.get("userId"))));
  app.post(`${apple}/session-start`, async (c) =>
    c.json(health.recordWebSessionStart(c.get("userId"), appleWebSessionStartInput.parse(await c.req.json()))));
  app.get(`${healthExport}/config`, (c) =>
    c.json({ webhookUrl: config.healthDataExportWebhookUrl ?? null }));
  app.post(healthExportImport, healthExportBody, async (c) =>
    c.json(health.importWorkouts(c.get("userId"), readHealthDataExport(await c.req.json()))));
  app.get(`${apple}/agenda`, (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(listAppleTraining(store, c.get("userId"), agendaQuery.parse(c.req.query())));
  });
  app.get(`${apple}/status`, (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(health.syncStatus(c.get("userId"), describeAppleActivity));
  });
  app.get(`${apple}/daily`, (c) => {
    c.header("Cache-Control", "no-store");
    const rawFrom = c.req.query("from");
    const rawThrough = c.req.query("through");
    const through = rawThrough ? z.iso.date().parse(rawThrough) : localDate();
    const from = rawFrom ? z.iso.date().parse(rawFrom) : shiftDay(through, -29);
    if (from > through) throw new DomainError("开始日期不能晚于截止日期", 400);
    return c.json({ entries: listDailyHealth(db, c.get("userId"), from, through) });
  });
  app.get("/api/exercises", (c) => {
    const query = z
      .object({
        q: z.string().max(200).optional(),
        muscle: z.string().optional(),
        equipment: z.string().optional(),
        category: z.string().optional(),
        builtin: z.literal("1").optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(2000).default(2000),
      })
      .parse(c.req.query());
    if (query.builtin === "1") {
      c.header("ETag", catalogueETag);
      if (c.req.header("If-None-Match") === catalogueETag) return c.body(null, 304);
      const payload = getBuiltinCataloguePayload();
      c.header("Content-Type", "application/json; charset=UTF-8");
      c.header("Vary", "Accept-Encoding");
      if (/\bgzip\b/i.test(c.req.header("Accept-Encoding") ?? "")) {
        c.header("Content-Encoding", "gzip");
        return c.body(payload.gzip);
      }
      return c.body(payload.raw);
    }
    const text = query.q?.toLowerCase() ?? "";
    const catalogue = [];
    for (const exercise of store.catalogueMap(c.get("userId")).values()) {
      if (
        (!query.muscle || exercise.muscle === query.muscle) &&
        (!query.category || getExerciseCategory(exercise) === query.category) &&
        (!query.equipment || exercise.equipment === query.equipment) &&
        matchesExercise(exercise, text)
      ) {
        catalogue.push(exercise);
      }
    }
    c.header("X-Total-Count", String(catalogue.length));
    return c.json(catalogue.slice(query.offset, query.offset + query.limit));
  });
  app.get("/api/records/:kind", (c) =>
    c.json(
      store.list(c.get("userId"), entityKindSchema.parse(c.req.param("kind"))),
    ),
  );
  app.post("/api/records", async (c) => {
    const result = store.mutate(
      c.get("userId"),
      mutationSchema.parse(await c.req.json()),
    );
    return c.json(result, result.status === "conflict" ? 409 : 200);
  });
  app.post("/api/sync", async (c) => {
    const input = z
      .object({
        cursor: z.number().int().min(0),
        mutations: z.array(mutationSchema).max(100),
      })
      .parse(await c.req.json());
    const results = db.transaction(() =>
      input.mutations.map((mutation) =>
        store.mutate(c.get("userId"), mutation),
      ),
    )();
    return c.json({ results, ...store.pull(c.get("userId"), input.cursor) });
  });
  app.get("/api/stats", (c) =>
    c.json(
      getStats(
        store,
        c.get("userId"),
        z.iso.date().parse(c.req.query("date") ?? localDate()),
      ),
    ),
  );
  app.get("/api/context", (c) =>
    c.json(getTrainingContext(store, c.get("userId"))),
  );
  app.get("/api/plans/active", (c) =>
    c.json(store.planSchedule(c.get("userId"))),
  );
  app.post("/api/plans/drafts", async (c) =>
    c.json(
      store.createDraft(c.get("userId"), planSchema.parse(await c.req.json())),
      201,
    ),
  );
  app.get("/api/plans/history", (c) => {
    const rows = stmtPlanHistory.all(c.get("userId")) as { data: string }[];
    return c.json(rows.map((row) => ({ ...row, data: JSON.parse(row.data) })));
  });
  app.post("/api/plans/apply", async (c) => {
    const input = z
      .object({
        id: z.string(),
        version: z.number().int().positive(),
        expectedRevision: z.number().int().min(0),
        historical: z.boolean().default(false),
      })
      .parse(await c.req.json());
    return c.json(
      store.applyPlan(
        c.get("userId"),
        input.id,
        input.version,
        input.expectedRevision,
        input.historical,
      ),
    );
  });
  const textInput = z.object({ text: z.string().trim().min(1).max(4000) });
  app.get("/api/ai/status", (c) => c.json(ai.status()));
  app.post("/api/ai/parse-diet", async (c) => {
    const input = textInput
      .extend({
        date: z.iso.date().default(localDate()),
        meal: z
          .enum(["breakfast", "lunch", "dinner", "snack"])
          .default("lunch"),
      })
      .parse(await c.req.json());
    return c.json({
      foods: await ai.parseDiet(input.text, input.date, input.meal),
    });
  });
  app.post("/api/ai/parse-workout", async (c) => {
    const input = textInput
      .extend({ date: z.iso.date().default(localDate()) })
      .parse(await c.req.json());
    return c.json({
      workout: await ai.parseWorkout(c.get("userId"), input.text, input.date),
    });
  });
  app.post("/api/ai/plan", async (c) => {
    const input = textInput
      .extend({ parentId: z.string().optional() })
      .parse(await c.req.json());
    return c.json(
      await ai.plan(c.get("userId"), input.text, input.parentId),
      201,
    );
  });
  app.post("/api/ai/review", async (c) => {
    const { text } = textInput.parse(await c.req.json());
    return c.json(await ai.review(c.get("userId"), text));
  });
  app.post("/api/ai/adapt-workout", async (c) => {
    const input = textInput
      .extend({ workoutId: z.string().min(1).max(100) })
      .parse(await c.req.json());
    return c.json(
      await ai.adaptWorkout(c.get("userId"), input.workoutId, input.text),
    );
  });
  app.post("/api/ai/adapt-workout/apply", async (c) => {
    const input = z
      .object({
        workoutId: mutationSchema.shape.id,
        proposal: workoutAdaptationSchema,
        selectedRowIds: z.array(z.string().min(1)).min(1).max(6),
        opId: mutationSchema.shape.opId.optional(),
      })
      .parse(await c.req.json());
    const userId = c.get("userId");
    if (input.proposal.workoutId !== input.workoutId)
      throw new DomainError("调整建议与当前训练不匹配");
    const result = db.transaction(() => {
      const record = store.get(userId, "workout", input.workoutId);
      if (!record || record.deleted)
        throw new DomainError("训练记录不存在或已删除", 404);
      const currentWorkout = workoutSchema.parse(record.data);
      if ((currentWorkout.adjustments ?? []).some((item) => item.id === input.proposal.id))
        return { record };
      if (record.version !== input.proposal.baseVersion)
        throw new DomainError("训练内容已更新，请重新获取 AI 建议", 409);
      let nextWorkout;
      try {
        nextWorkout = applyWorkoutAdaptation(
          currentWorkout,
          input.proposal,
          input.selectedRowIds,
          store.catalogueMap(userId),
          () => crypto.randomUUID(),
        );
      } catch (error) {
        throw new DomainError(
          error instanceof Error ? error.message : "应用训练调整失败",
          409,
        );
      }
      const saved = store.mutate(userId, {
        kind: "workout",
        id: input.workoutId,
        baseVersion: record.version,
        opId: input.opId ?? `adapt:${input.proposal.id}`,
        deleted: false,
        data: nextWorkout,
      });
      if (saved.status === "conflict")
        throw new DomainError("训练内容已更新，请重试", 409);
      return { record: saved.record! };
    }).immediate();
    return c.json(result);
  });
  app.get("/api/tokens", (c) => c.json(auth.list(c.get("userId"))));
  app.post("/api/tokens", async (c) => {
    const { label } = z
      .object({ label: z.string().trim().min(1).max(80) })
      .parse(await c.req.json());
    return c.json({ token: auth.issue(c.get("userId"), label) }, 201);
  });
  app.delete("/api/tokens/:id", (c) => {
    auth.revoke(c.get("userId"), c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/export", (c) => {
    const json = JSON.stringify(store.export(c.get("userId")));
    if (Buffer.byteLength(json) > BACKUP_JSON_MAX_BYTES) {
      return c.json({ error: `全量备份超过网页恢复上限 ${BACKUP_JSON_LIMIT_LABEL}，请使用服务器 SQLite 备份` }, 413);
    }
    c.header(
      "Content-Disposition",
      `attachment; filename="ironlog-${localDate()}.json"`,
    );
    return c.body(json, 200, { "Content-Type": "application/json; charset=UTF-8" });
  });
  app.post("/api/web/restore-backup", async (c) => {
    const input = z.object({
      backup: z.unknown(),
      mode: z.enum(["preview", "commit"]).default("preview"),
      strategy: z.enum(["merge", "replace"]).default("merge"),
    }).parse(await c.req.json());
    return c.json(store.restoreBackup(c.get("userId"), input.backup, {
      mode: input.mode,
      strategy: input.strategy,
    }));
  });
  app.post("/api/web/password", async (c) => {
    const userId = c.get("userId");
    browser.limit("password:user:" + userId, 10);
    const input = webPasswordChangeInput.parse(await c.req.json());
    await browser.changePassword(userId, input);
    const options = cookieOptions(c, trustProxy);
    const session = browser.issueSession(userId);
    setCookie(c, cookieName, session, { ...options, maxAge: webSessionSeconds });
    return c.json({ ok: true });
  });
  return { app, store, auth, ai };
}
