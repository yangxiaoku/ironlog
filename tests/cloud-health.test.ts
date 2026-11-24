import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exerciseCatalogue, localDate, type CatalogueExercise, type CatalogueItem } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { mountWebAssets } from "../packages/server/src/web-assets.js";
import { getWebToday } from "../packages/server/src/web-training.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";

const apple = "/api/integrations/apple-health";
const catalogue = "/api/catalogue/exercises";
function fixture() {
  const db = openDatabase(":memory:");
  const { app, auth, store } = createApp(db);
  const owner = auth.login("apple-health-test-owner");
  const other = auth.login("apple-health-test-other");
  const call = (path: string, token?: string, method = "GET", body?: unknown, key?: string) =>
    app.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const issue = async () => {
    const response = await call(apple + "/tokens", owner.token, "POST", { label: "iPhone" });
    assert.equal(response.status, 201);
    return response.json() as Promise<{ id: string; token: string }>;
  };
  return { db, app, owner, other, call, issue, store };
}

test("Health Data Export 文件和 Webhook 共享训练档案，重试不会增加记录", async () => {
  const { db, owner, other, call, issue } = fixture();
  try {
    const device = await issue();
    const upload = apple + "/health-data-export/import";
    const webhook = apple + "/health-data-export/webhook";
    const rows = [{ uuid: "watch-strength", workoutActivityType: 50, startDate: "2026-01-05 18:00:00 +0800",
      endDate: "2026-01-05 18:50:00 +0800", durationSeconds: 2940, activeEnergyBurned: { value: 836.8, unit: "kJ" },
      averageHeartRateBpm: 125, workoutRoute: [{ latitude: 22.2, longitude: 114.2 }] },
    { activityType: "Outdoor Running", start: "2026-01-05T19:00:00+08:00", end: "2026-01-05T19:30:00+08:00",
      distance: { quantity: 5.5, unit: "km" }, heartrate: { average: 153, max: 168, unit: "count/min" } }];
    const payload = { data: { workouts: rows } };
    assert.equal((await call(upload, undefined, "POST", payload)).status, 401);
    assert.equal((await call(upload, device.token, "POST", payload)).status, 401);
    assert.equal((await call(webhook, owner.token, "POST", payload)).status, 401);
    assert.deepEqual(await (await call(webhook, device.token, "POST", { type: "webhook.test" })).json(),
      { ok: true, imported: 0, updated: 0, duplicate: 0 });
    assert.deepEqual(await (await call(upload, owner.token, "POST", payload)).json(),
      { imported: 2, updated: 0, duplicate: 0 });
    assert.deepEqual(await (await call(webhook, device.token, "POST", { workouts: rows })).json(),
      { ok: true, imported: 0, updated: 0, duplicate: 2 });
    const enriched = { ...rows[0], maxHeartRateBpm: 147 };
    assert.deepEqual(await (await call(webhook, device.token, "POST", { workouts: [enriched] })).json(),
      { ok: true, imported: 0, updated: 1, duplicate: 0 });
    const workouts = await (await call(apple + "/workouts", owner.token)).json() as any[];
    assert.equal(workouts.length, 2);
    assert.equal(workouts[0].distanceMeters, 5500);
    assert.equal(workouts[0].environment, "outdoor");
    assert.equal(workouts[1].durationSeconds, 2940);
    assert.equal(workouts[1].activityType, "traditionalStrengthTraining");
    assert.ok(Math.abs(workouts[1].activeEnergyKcal - 200) < 1e-9);
    assert.equal(workouts[1].heartRate.maxBpm, 147);
    assert.ok(!JSON.stringify(workouts).includes("latitude"));
    const agenda = await (await call(apple + "/agenda?from=2026-01-05&through=2026-01-05", owner.token)).json() as any[];
    assert.deepEqual(agenda.map((item) => item.title).sort(), ["传统力量训练", "户外跑步"]);
    assert.deepEqual(await (await call(apple + "/workouts", other.token)).json(), []);
    await call(apple + "/tokens/" + device.id, owner.token, "DELETE");
    assert.equal((await call(webhook, device.token, "POST", payload)).status, 401);
  } finally { db.close(); }
});

test("Health Data Export 拒绝非训练导出和不完整批次，防止部分写入", async () => {
  const { db, owner, call } = fixture();
  try {
    const upload = apple + "/health-data-export/import";
    const good = { activityType: "running", startedAt: "2026-01-06T10:00:00Z", endedAt: "2026-01-06T11:00:00Z" };
    const future = { ...good, startedAt: "2099-01-06T10:00:00Z", endedAt: "2099-01-06T11:00:00Z" };
    const wrongTimezone = { ...good, startedAt: "2026-01-06 10:00:00" };
    const metrics = { data: { metrics: [{ name: "heart_rate", startDate: good.startedAt, endDate: good.endedAt }] } };
    for (const body of [metrics, { workouts: [] }, { workouts: [good, wrongTimezone] }, { workouts: [good, future] }]) {
      assert.equal((await call(upload, owner.token, "POST", body)).status, 400);
      assert.deepEqual(await (await call(apple + "/workouts", owner.token)).json(), []);
    }
  } finally { db.close(); }
});

test("Health Data Export 接收 11.1 MB 混合导出，仅导入训练且保持按端点限制", async () => {
  const { db, owner, call, issue } = fixture();
  try {
    const { token } = await issue();
    const webhook = apple + "/health-data-export/webhook";
    const payload = { data: { metrics: [
      { name: "heart_rate", data: "x".repeat(11_100_000) },
      { name: "workouts", data: [{ activityType: 50, startDate: "2026-01-06T10:00:00Z", endDate: "2026-01-06T11:00:00Z" }] },
    ] } };
    assert.equal((await call(webhook, undefined, "POST", payload)).status, 401);
    assert.deepEqual(await (await call(webhook, token, "POST", payload)).json(),
      { ok: true, imported: 1, updated: 0, duplicate: 0 });
    const upload = apple + "/health-data-export/import";
    assert.deepEqual(await (await call(upload, owner.token, "POST", payload)).json(),
      { imported: 0, updated: 0, duplicate: 1 });
    assert.equal((await call(apple + "/workouts", token, "POST", payload)).status, 413);
    assert.equal((await call(webhook, token, "POST", { extra: "x".repeat(16 * 1024 * 1024) })).status, 413);
    const workouts = await (await call(apple + "/workouts", owner.token)).json() as unknown[];
    assert.equal(workouts.length, 1);
  } finally { db.close(); }
});

test("Apple 健康设备专用令牌只允许上传，撤销和账号隔离生效", async () => {
  const { db, owner, other, call, issue } = fixture();
  try {
    const device = await issue();
    const input = {
      schemaVersion: 1, event: "start", activityType: "traditionalStrengthTraining",
      occurredAt: "2026-01-05T18:00:00+08:00", environment: "indoor",
    };
    assert.equal((await call(apple + "/events", owner.token, "POST", input)).status, 401);
    assert.equal((await call("/api/me", device.token)).status, 401);
    assert.equal((await call(apple + "/workouts", device.token)).status, 401);
    assert.equal((await call(apple + "/events", device.token, "POST", input)).status, 200);
    const end = { ...input, event: "end", occurredAt: "2026-01-05T18:32:00+08:00" };
    const imported = await call(apple + "/events", device.token, "POST", end);
    assert.equal(imported.status, 201);
    const replay = await call(apple + "/events", device.token, "POST", end);
    assert.equal((await replay.json() as { ingestStatus: string }).ingestStatus, "duplicate");
    const saved = await (await call(apple + "/workouts", owner.token)).json() as Record<string, unknown>[];
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.durationSeconds, 1920);
    assert.equal(saved[0]?.durationKind, "event_elapsed");
    assert.equal(saved[0]?.activeEnergyKcal, undefined);
    assert.deepEqual(await (await call(apple + "/workouts", other.token)).json(), []);
    await call(apple + "/tokens/" + device.id, other.token, "DELETE");
    assert.equal((await call(apple + "/events", device.token, "POST", end)).status, 200);
    await call(apple + "/tokens/" + device.id, owner.token, "DELETE");
    assert.equal((await call(apple + "/events", device.token, "POST", end)).status, 401);
    assert.equal(JSON.stringify(await (await call(apple + "/tokens", owner.token)).json()), "[]");
    assert.equal((db.prepare("SELECT token_hash FROM apple_health_devices").get() as { token_hash: string })
      .token_hash.length, 64);
  } finally { db.close(); }
});

test("完整健康训练按记录身份去重，接受迟到统计，同一幂等键禁止内容变更", async () => {
  const { db, owner, call, issue } = fixture();
  try {
    const { token } = await issue();
    const workout = {
      schemaVersion: 1, captureMethod: "workout", activityType: "running",
      externalWorkoutId: "example-health-sample", timeZone: "Asia/Hong_Kong",
      startedAt: "2026-01-01T17:00:00+08:00", endedAt: "2026-01-01T17:30:00+08:00",
      durationSeconds: 1765, durationKind: "workout_active",
    };
    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "end", activityType: "running", occurredAt: workout.endedAt,
    })).status, 409);
    const first = await call(apple + "/workouts", token, "POST", workout, "run-a");
    assert.equal(first.status, 201);
    assert.equal((await call(apple + "/workouts", token, "POST", workout, "run-a")).status, 200);
    const enriched = { ...workout, activeEnergyKcal: 245, heartRate: { avgBpm: 130, minBpm: 80, maxBpm: 160 } };
    assert.equal((await call(apple + "/workouts", token, "POST", enriched, "run-a")).status, 409);
    const updated = await call(apple + "/workouts", token, "POST", enriched, "run-a-enriched");
    assert.equal((await updated.json() as { ingestStatus: string }).ingestStatus, "updated");
    const list = await (await call(apple + "/workouts", owner.token)).json() as Record<string, unknown>[];
    assert.equal(list.length, 1);
    assert.equal(list[0]?.activeEnergyKcal, 245);
    assert.equal((await call(apple + "/workouts", token, "POST", { ...workout, durationSeconds: 9000 })).status, 400);
  } finally { db.close(); }
});

test("先收到触发记录再收到完整样本时，训练时长和能量使用 Apple 实测口径", async () => {
  const { db, owner, call, issue } = fixture();
  try {
    const { token } = await issue();
    const date = shiftDay(localDate(), -1);
    const trigger = { schemaVersion: 1, captureMethod: "trigger", activityType: "running",
      startedAt: date + "T09:00:00+08:00", endedAt: date + "T09:30:00+08:00",
      durationSeconds: 1800, durationKind: "event_elapsed", activeEnergyKcal: 320, energyKind: "window_estimate",
      heartRate: { avgBpm: 140, minBpm: 100, maxBpm: 170, method: "window_samples" } };
    const full = { ...trigger, captureMethod: "workout", environment: "outdoor", durationSeconds: 1650,
      durationKind: "workout_active", activeEnergyKcal: 290, energyKind: "workout",
      heartRate: { avgBpm: 128, method: "workout_statistics" } };
    assert.equal((await call(apple + "/workouts", token, "POST", trigger)).status, 201);
    const updated = await call(apple + "/workouts", token, "POST", full);
    assert.equal((await updated.json() as { ingestStatus: string }).ingestStatus, "updated");
    assert.equal((await call(apple + "/workouts", token, "POST", trigger)).status, 200);
    const agenda = await (await call(apple + "/agenda?from=" + date + "&through=" + date, owner.token)).json() as any[];
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0].title, "户外跑步");
    assert.equal(agenda[0].durationSeconds, 1650);
    assert.equal(agenda[0].durationKind, "workout_active");
    assert.equal(agenda[0].activeEnergyKcal, 290);
    assert.equal(agenda[0].energyKind, "workout");
    assert.deepEqual(agenda[0].heartRate, { avgBpm: 128, method: "workout_statistics" });
  } finally { db.close(); }
});

test("心率补传区间互相矛盾时仍保存有效的距离，并保留原心率", async () => {
  const { db, owner, call, issue } = fixture();
  try {
    const { token } = await issue();
    const date = shiftDay(localDate(), -1);
    const workout = { schemaVersion: 1, captureMethod: "workout", activityType: "cycling",
      externalWorkoutId: "heart-conflict", startedAt: date + "T09:00:00+08:00", endedAt: date + "T09:30:00+08:00" };
    const initial = { minBpm: 122, method: "workout_statistics" };
    assert.equal((await call(apple + "/workouts", token, "POST", { ...workout, heartRate: initial })).status, 201);
    assert.equal((await call(apple + "/workouts", token, "POST", { ...workout, distanceMeters: 6010,
      heartRate: { avgBpm: 105, maxBpm: 114, method: "workout_statistics" } })).status, 200);
    const rows = await (await call(apple + "/workouts", owner.token)).json() as any[];
    assert.equal(rows[0].distanceMeters, 6010);
    assert.deepEqual(rows[0].heartRate, initial);
  } finally { db.close(); }
});

test("独立触发记录可以补充能量，时长不得超过已合并样本的起止区间", async () => {
  const { db, owner, call, issue } = fixture();
  try {
    const { token } = await issue();
    const date = shiftDay(localDate(), -1);
    const activityType = "running";
    const trigger = await call(apple + "/workouts", token, "POST", {
      schemaVersion: 1, captureMethod: "trigger", activityType,
      startedAt: date + "T09:00:00+08:00", endedAt: date + "T09:30:00+08:00",
      durationSeconds: 1800, durationKind: "event_elapsed", activeEnergyKcal: 300, energyKind: "window_estimate",
    });
    assert.equal(trigger.status, 201);
    const full = await call(apple + "/workouts", token, "POST", {
      schemaVersion: 1, captureMethod: "workout", activityType, externalWorkoutId: "shorter-sample",
      startedAt: date + "T09:00:30+08:00", endedAt: date + "T09:29:30+08:00",
    });
    assert.equal(full.status, 201);
    const agenda = await (await call(apple + "/agenda?from=" + date + "&through=" + date, owner.token)).json() as any[];
    assert.equal(agenda.length, 1);
    assert.equal(agenda[0].durationSeconds, null);
    assert.equal(agenda[0].durationKind, null);
    assert.equal(agenda[0].activeEnergyKcal, 300);
    assert.equal(agenda[0].energyKind, "window_estimate");
  } finally { db.close(); }
});

test("动作分页、版本、教学、收藏补全和云端素材无需同步令牌", async () => {
  const { db, app, call } = fixture();
  try {
    const version = await call("/api/catalogue/version");
    assert.equal(version.status, 200);
    assert.equal((await version.json() as { total: number }).total, 5650);
    assert.equal((await app.request("/api/catalogue/version", {
      headers: { "If-None-Match": version.headers.get("ETag")! },
    })).status, 304);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM catalogue_exercises").get() as { n: number }).n, 5650);
    const response = await call(catalogue + "?category=yoga&limit=5");
    const page = await response.json() as { items: Record<string, unknown>[]; nextCursor: string };
    assert.equal(page.items.length, 5);
    assert.ok(page.items.every((item) => item.category === "yoga" && !("instructions" in item) && !("description" in item)));
    assert.equal((await call(catalogue + "?muscle=yoga&cursor=" + page.nextCursor)).status, 400);
    const next = await (await call(catalogue + "?category=yoga&limit=5&cursor=" + page.nextCursor))
      .json() as { items: Record<string, unknown>[] };
    assert.equal(new Set([...page.items, ...next.items].map((item) => item.id)).size, 10);
    const detail = await (await call(catalogue + "/exdb_2612")).json() as { exercise: CatalogueExercise };
    assert.equal(detail.exercise.name, "跳绳");
    assert.ok(detail.exercise.instructions.length);
    assert.ok(/\p{Script=Han}/u.test(detail.exercise.description ?? ""));
    const lookup = await call(catalogue + "/lookup", undefined, "POST", { ids: ["exdb_2612"], q: "跳绳" });
    const { items } = await lookup.json() as { items: CatalogueItem[] };
    assert.equal(items.length, 1);
    const pose = detail.exercise.illustration!;
    assert.equal(items[0]?.thumbnail, pose.frames[0]?.path);
    assert.equal(pose.frames.length, 3);
    assert.ok(pose.gifPath?.startsWith("/media/exercises/anim-exdb_2612.gif?v="));
    assert.equal(pose.license, "CC BY-SA 4.0");
    const gifRes = await call(pose.gifPath!);
    assert.equal(gifRes.status, 200);
    assert.equal(gifRes.headers.get("Content-Type"), "image/gif");
    assert.match(gifRes.headers.get("Cache-Control")!, /immutable/);
    assert.equal(Buffer.from(await gifRes.arrayBuffer()).subarray(0, 6).toString("ascii"), "GIF89a");
    const frame = pose.frames[2]!;
    const third = await call(frame.path);
    assert.equal(third.status, 200);
    assert.match(third.headers.get("Cache-Control")!, /immutable/);
    assert.equal(createHash("sha256").update(Buffer.from(await third.arrayBuffer())).digest("hex"), frame.sha256);
    const image = await call("/media/exercises/bench-press-1.png");
    assert.equal(image.headers.get("Content-Type"), "image/png");
    const details = await (await call(catalogue + "/details", undefined, "POST", { ids: ["bench-press", "exdb_2612"] }))
      .json() as { items: CatalogueExercise[] };
    assert.equal(details.items.length, 2);
    assert.ok(details.items.every((item) => item.illustration?.gifPath && item.description));
    const deadlift = await (await call(catalogue + "/exdb_0300")).json() as { exercise: CatalogueExercise };
    assert.equal(deadlift.exercise.illustration?.license, "CC BY-SA 3.0");
    const photo = await call(deadlift.exercise.illustration!.frames[0]!.path);
    assert.equal(photo.status, 200);
    assert.match(photo.headers.get("Link")!, /by-sa\/3\.0/);
    const deadliftGif = await call(deadlift.exercise.illustration!.gifPath!);
    assert.equal(deadliftGif.status, 200);
    assert.equal(deadliftGif.headers.get("Content-Type"), "image/gif");
    assert.match(deadliftGif.headers.get("Link")!, /by-sa\/3\.0/);
  } finally { db.close(); }
});

test("所有内置基础动作都有可访问的云端姿势图", async () => {
  const { db, call } = fixture();
  try {
    for (const { id, name } of exerciseCatalogue) {
      const { exercise } = await (await call(catalogue + "/" + id)).json() as { exercise: CatalogueExercise };
      const pose = exercise.illustration;
      assert.ok(pose && pose.frames.length >= 2, name);
      assert.ok(pose.gifPath?.startsWith(`/media/exercises/anim-${id}.gif?v=`), name);
      assert.equal((await call(pose.frames[0]!.path)).status, 200, name);
      assert.equal((await call(pose.gifPath)).status, 200, name);
    }
  } finally { db.close(); }
});

test("Apple 力量按当天抗阻计划打卡，有氧另列，轮换按完成情况推进", async () => {
  const { db, owner, other, call, issue, store } = fixture();
  try {
    const { token } = await issue();
    const first = shiftDay(localDate(), -3);
    const second = shiftDay(first, 1);
    const target = (exerciseId: string, seconds = 0) => ({ exerciseId, sets: 3, repsMin: 8, repsMax: 12, weight: null, restSeconds: 90, seconds });
    const plan = await call("/api/plans/drafts", owner.token, "POST", {
      name: "力量 + 有氧", weeks: 4, schedule: "rotation", rationale: "交替安排",
      routines: [{ id: "lift", name: "抗阻训练", exercises: [target("bench-press")] },
        { id: "rope", name: "跳绳有氧", exercises: [target("exdb_2612", 90)] }],
    });
    const { record } = await plan.json() as any;
    assert.equal((await call("/api/plans/apply", owner.token, "POST", { id: record.id, version: record.version, expectedRevision: 0 })).status, 200);
    const activatedAt = shiftDay(first, -2) + "T00:00:00Z";
    db.prepare("UPDATE active_plans SET updated_at=? WHERE user_id=?").run(activatedAt, owner.userId);
    db.prepare("UPDATE plan_activations SET updated_at=? WHERE user_id=?").run(activatedAt, owner.userId);
    const upload = async (externalWorkoutId: string, activityType: string, date: string, hour: string, more: object = {}) => {
      const response = await call(apple + "/workouts", token, "POST", {
        schemaVersion: 1, captureMethod: "workout", externalWorkoutId, activityType,
        startedAt: date + "T" + hour + ":00:00+08:00", endedAt: date + "T" + hour + ":30:00+08:00",
        durationSeconds: 1740, durationKind: "workout_active", ...more,
      });
      assert.equal(response.status, 201);
    };
    await upload("run", "running", first, "09", { environment: "outdoor", distanceMeters: 4400 });
    assert.equal(getWebToday(store, owner.userId, first).planned?.id, "lift");
    const exportResponse = await call(apple + "/health-data-export/webhook", token, "POST", {
      workouts: [{ uuid: "strength", activityType: 50, startDate: first + "T11:00:00+08:00",
        endDate: first + "T11:30:00+08:00", durationSeconds: 1740 }],
    });
    assert.equal(exportResponse.status, 200);
    await upload("strength-trigger", "traditional_strength_training", first, "11", {
      captureMethod: "trigger", durationKind: "event_elapsed", durationSeconds: 1800, activeEnergyKcal: 123,
      energyKind: "window_estimate",
    });
    await upload("yoga", "yoga", first, "15");
    assert.equal(getWebToday(store, owner.userId, first).applePlan?.routineId, "lift");
    assert.equal(getWebToday(store, owner.userId, first).completed, 3);
    assert.equal(getWebToday(store, owner.userId, second).planned?.id, "rope");
    await upload("step", "HKWorkoutActivityTypeStairClimbing", second, "09");
    assert.equal(getWebToday(store, owner.userId, second).planned?.id, "rope");
    await upload("jump", "jumpRope", second, "12");
    assert.equal(getWebToday(store, owner.userId, second).applePlan?.routineId, "rope");
    assert.equal(getWebToday(store, owner.userId, shiftDay(second, 1)).planned?.id, "lift");
    const url = apple + "/agenda?from=" + first + "&through=" + second;
    const activities = async () => await (await call(url, owner.token)).json() as any[];
    assert.deepEqual((await activities()).map(({ title, plan }: any) => [title, plan?.name ?? null]), [
      ["户外跑步", null], ["传统力量训练", "抗阻训练"], ["瑜伽", null], ["踏步机", null], ["跳绳", "跳绳有氧"],
    ]);
    assert.equal((await activities())[1].durationKind, "workout_active");
    assert.equal((await activities())[1].energyKind, "window_estimate");
    assert.deepEqual(await (await call(url, other.token)).json(), []);
    assert.equal((await call(url, token)).status, 401);
    assert.equal(store.list(owner.userId, "workout").length, 0);
    const training = {
      title: "卧推记录", status: "completed", date: first,
      startedAt: first + "T03:00:00Z", endedAt: first + "T03:30:00Z",
      exercises: [{ id: "row", exerciseId: "bench-press", restSeconds: 90,
        sets: [{ id: "set", type: "normal", completed: true, weight: 53, reps: 10 }] }],
    };
    store.mutate(owner.userId, { id: "manual_bench", opId: "bench_entered", kind: "workout", baseVersion: 0, deleted: false, data: training });
    assert.equal((await activities())[1].manualWorkoutId, "manual_bench");
    assert.equal((await activities())[1].plan.name, "抗阻训练");
    assert.equal(getWebToday(store, owner.userId, first).completed, 3);
    const stats = await (await call("/api/web/statistics?days=7&through=" + second, owner.token)).json() as any;
    assert.equal(stats.totals.activities, 5);
    assert.equal(stats.totals.workouts, 1);
    assert.equal(stats.totals.volume, 530);
    assert.equal(stats.totals.sets, 1);
  } finally { db.close(); }
});

test("跨午夜运动按开练日归档，休息日不补签计划，当前手动训练不会被改写", async () => {
  const { db, owner, issue, call, store } = fixture();
  try {
    const from = shiftDay(localDate(), -4);
    const through = shiftDay(from, 1);
    const weekday = new Date(through + "T00:00:00Z").getUTCDay() || 7;
    const plan = await store.createDraft(owner.userId, {
      name: "固定训练日", weeks: 4, schedule: "weekdays", weekdays: [weekday], rationale: "固定一周一次",
      source: "manual", parentId: null, routines: [{ id: "weekly", name: "抗阻",
        exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 6, repsMax: 10, weight: null, restSeconds: 90,
          seconds: 0, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }] }],
    });
    store.applyPlan(owner.userId, plan.record!.id, plan.record!.version, 0);
    const activatedAt = shiftDay(from, -2) + "T00:00:00Z";
    db.prepare("UPDATE active_plans SET updated_at=? WHERE user_id=?").run(activatedAt, owner.userId);
    db.prepare("UPDATE plan_activations SET updated_at=? WHERE user_id=?").run(activatedAt, owner.userId);
    const { token } = await issue();
    const response = await call(apple + "/workouts", token, "POST", {
      schemaVersion: 1, captureMethod: "workout", activityType: "traditionalStrengthTraining",
      startedAt: from + "T23:50:00+08:00", endedAt: through + "T00:25:00+08:00",
      durationSeconds: 2000, durationKind: "workout_active",
    });
    assert.equal(response.status, 201);
    const entry = await (await call(apple + "/agenda?from=" + from + "&through=" + through, owner.token)).json() as any[];
    assert.equal(entry.length, 1);
    assert.equal(entry[0].date, from);
    assert.equal(entry[0].plan, null);
    assert.equal(getWebToday(store, owner.userId, from).planned?.date, through);
    const active = store.mutate(owner.userId, {
      id: "unfinished", kind: "workout", opId: "unfinished_op", baseVersion: 0, deleted: false,
      data: { title: "尚在进行", status: "active", date: from, startedAt: from + "T15:50:00Z", endedAt: null,
        exercises: [{ id: "e1", exerciseId: "bench-press", restSeconds: 90, sets: [{ id: "s1", type: "normal", completed: true, reps: 8, weight: 50 }] }] },
    });
    assert.equal(getWebToday(store, owner.userId, from).active?.id, "unfinished");
    assert.deepEqual(store.get(owner.userId, "workout", "unfinished"), active.record);
  } finally { db.close(); }
});

test("同日启用新计划版本后，旧版本已打卡的同名训练不会挡住新版本", async () => {
  const { db, owner, call, issue, store } = fixture();
  try {
    const date = shiftDay(localDate(), -2);
    const plan = { name: "抗阻计划", weeks: 4, schedule: "rotation", rationale: "版本更新",
      routines: [{ id: "press", name: "推训练", exercises: [
        { exerciseId: "bench-press", sets: 3, repsMin: 6, repsMax: 10, weight: null, restSeconds: 90 },
      ] }] };
    const draft = await call("/api/plans/drafts", owner.token, "POST", plan);
    assert.equal(draft.status, 201);
    const { record } = await draft.json() as any;
    store.applyPlan(owner.userId, record.id, 1, 0);
    const revised = store.mutate(owner.userId, { id: record.id, opId: "edit-plan", kind: "plan",
      baseVersion: 1, deleted: false, data: { ...plan, name: "抗阻计划新版" } });
    assert.equal(revised.record?.version, 2);
    store.applyPlan(owner.userId, record.id, 2, 1);
    const earlier = date + "T00:00:00.000Z", later = date + "T04:00:00.000Z";
    db.prepare("UPDATE plan_activations SET updated_at=? WHERE user_id=? AND revision=1").run(earlier, owner.userId);
    db.prepare("UPDATE plan_activations SET updated_at=? WHERE user_id=? AND revision=2").run(later, owner.userId);
    db.prepare("UPDATE active_plans SET updated_at=? WHERE user_id=?").run(later, owner.userId);
    store.mutate(owner.userId, { id: "old_plan_lift", opId: "old-plan-lift", kind: "workout", baseVersion: 0,
      deleted: false, data: { title: "旧计划的推训练", status: "completed", date, planId: record.id, planVersion: 1,
        routineId: "press", startedAt: date + "T01:00:00Z", endedAt: date + "T01:30:00Z",
        exercises: [{ id: "press-row", exerciseId: "bench-press", restSeconds: 90,
          sets: [{ id: "press-set", type: "normal", completed: true, weight: 50, reps: 8 }] }] } });
    const { token } = await issue();
    for (const hour of ["01", "05"]) {
      const response = await call(apple + "/workouts", token, "POST", {
        schemaVersion: 1, captureMethod: "workout", activityType: "traditionalStrengthTraining",
        startedAt: date + "T" + hour + ":00:00Z", endedAt: date + "T" + hour + ":30:00Z",
      });
      assert.equal(response.status, 201);
    }
    const result = await (await call(apple + "/agenda?from=" + date + "&through=" + date, owner.token)).json() as any[];
    assert.deepEqual(result.map((row) => row.plan?.planVersion), [1, 2]);
    assert.equal(getWebToday(store, owner.userId, date).applePlan?.planVersion, 2);
  } finally { db.close(); }
});


test("events/active 查询开放训练耗时，且直传与结束事件兼容快捷指令容错指标与全运动类型", async () => {
  const { db, owner, call, issue } = fixture();
  try {
    const { token } = await issue();

    const unauth = await call(apple + "/events/active?activityType=stairClimbing", owner.token);
    assert.equal(unauth.status, 401);

    const missingType = await call(apple + "/events/active", token);
    assert.equal(missingType.status, 400);

    const idle = await call(apple + "/events/active?activityType=stairClimbing", token);
    assert.equal(idle.status, 200);
    const idleBody = await idle.json() as any;
    assert.equal(idleBody.found, false);
    assert.equal(idleBody.elapsedMinutes, undefined);

    const startedIso = new Date(Date.now() - 35 * 60_000).toISOString();
    const endedIso = new Date().toISOString();
    const startRes = await call(apple + "/events", token, "POST", {
      schemaVersion: 1,
      event: "start",
      activityType: "stairClimbing",
      environment: "indoor",
      occurredAt: startedIso,
    });
    assert.equal(startRes.status, 200);

    const activeRes = await call(apple + "/events/active?activityType=stairClimbing", token);
    assert.equal(activeRes.status, 200);
    const activeBody = await activeRes.json() as any;
    assert.equal(activeBody.found, true);
    assert.equal(activeBody.activityType, "stairClimbing");
    assert.equal(activeBody.startedAt, startedIso);
    assert.ok(typeof activeBody.elapsedMinutes === "number" && activeBody.elapsedMinutes >= 35);

    const endRes = await call(apple + "/events", token, "POST", {
      schemaVersion: 1,
      event: "end",
      activityType: "stairClimbing",
      occurredAt: endedIso,
      energyKind: "window_estimate",
      heartRateMethod: "window_samples",
      activeEnergyKcal: "320 kcal",
      distanceKm: "",
      avgBpm: "148",
      minBpm: "112",
      maxBpm: "174",
      heartRateSamples: "320",
    });
    assert.equal(endRes.status, 201);
    const endBody = await endRes.json() as any;
    assert.equal(endBody.ingestStatus, "imported");

    const closed = await call(apple + "/events/active?activityType=stairClimbing", token);
    assert.equal((await closed.json() as any).found, false);

    const orphanEnd = await call(apple + "/events", token, "POST", {
      schemaVersion: 1,
      event: "end",
      activityType: "stairClimbing",
      occurredAt: "2026-11-20T11:00:00Z",
    });
    assert.equal(orphanEnd.status, 409);

    const directRun = await call(apple + "/workouts", token, "POST", {
      schemaVersion: 1,
      source: "shortcut",
      captureMethod: "trigger",
      durationKind: "event_elapsed",
      energyKind: "window_estimate",
      heartRateMethod: "window_samples",
      activityType: "running",
      environment: "outdoor",
      startedAt: "2026-11-20T11:30:00Z",
      endedAt: "2026-11-20T12:15:00Z",
      durationMinutes: 45,
      activeEnergyKcal: "485.6 kcal",
      distanceKm: "6.42 公里",
      avgBpm: "156",
      minBpm: "120",
      maxBpm: "181",
      heartRateSamples: "412",
    });
    assert.equal(directRun.status, 201);
    const runBody = await directRun.json() as any;
    assert.equal(runBody.ingestStatus, "imported");

    const list = await (await call(apple + "/workouts", owner.token)).json() as any[];
    assert.equal(list.length, 2);
    const stairWorkout = list.find((row) => row.activityType === "stairClimbing");
    const runWorkout = list.find((row) => row.activityType === "running");
    assert.ok(stairWorkout);
    assert.equal(stairWorkout.durationSeconds, 2100);
    assert.equal(stairWorkout.activeEnergyKcal, 320);
    assert.equal(stairWorkout.distanceMeters ?? null, null);
    assert.deepEqual(stairWorkout.heartRate, {
      avgBpm: 148,
      minBpm: 112,
      maxBpm: 174,
      sampleCount: 320,
      method: "window_samples",
    });

    assert.ok(runWorkout);
    assert.equal(runWorkout.durationSeconds, 2700);
    assert.equal(Math.round(runWorkout.activeEnergyKcal), 486);
    assert.equal(runWorkout.distanceMeters, 6420);
    assert.deepEqual(runWorkout.heartRate, {
      avgBpm: 156,
      minBpm: 120,
      maxBpm: 181,
      sampleCount: 412,
      method: "window_samples",
    });
  } finally {
    db.close();
  }
});


test("events 与 workouts 兼容常见 Apple 快捷指令本地化时间格式并拒绝空值或非法日历日期", async () => {
  const { db, call, issue } = fixture();
  try {
    const { token } = await issue();

    const startCompact = await call(apple + "/events", token, "POST", {
      schemaVersion: 1,
      event: "start",
      activityType: "running",
      environment: "outdoor",
      occurredAt: "2026-11-20T22:00:00+0800",
    });
    assert.equal(startCompact.status, 200);

    const endSlash = await call(apple + "/events", token, "POST", {
      schemaVersion: 1,
      event: "end",
      activityType: "running",
      environment: "outdoor",
      occurredAt: "2026/11/20 22:35:00",
    });
    assert.equal(endSlash.status, 201);

    const cjkWorkout = await call(apple + "/workouts", token, "POST", {
      schemaVersion: 1,
      source: "shortcut",
      captureMethod: "trigger",
      durationKind: "event_elapsed",
      activityType: "stairClimbing",
      environment: "indoor",
      startedAt: "2026年11月20日 星期五 21:00:00",
      endedAt: "2026-11-20T21:30:00GMT+8",
      durationMinutes: 30,
    });
    assert.equal(cjkWorkout.status, 201);

    const enWorkout = await call(apple + "/workouts", token, "POST", {
      schemaVersion: 1,
      source: "shortcut",
      captureMethod: "trigger",
      durationKind: "event_elapsed",
      activityType: "yoga",
      environment: "indoor",
      startedAt: "Nov 20, 2026 at 7:00:00 PM",
      endedAt: "Nov 20, 2026 at 7:40:00 PM",
      durationMinutes: 40,
    });
    assert.equal(enWorkout.status, 201);

    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: "1",
      event: "start",
      activityType: "stairClimbing",
      environment: "",
      occurredAt: "",
    })).status, 200);

    assert.equal((await call(apple + "/workouts", token, "POST", {
      schemaVersion: 1,
      source: "shortcut",
      captureMethod: "trigger",
      durationKind: "event_elapsed",
      activityType: "running",
      environment: "",
      startedAt: "",
      endedAt: "Formatted Date",
      durationMinutes: 25,
    })).status, 201);

    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: 1,
      event: "start",
      activityType: "running",
      occurredAt: "2026-02-30T10:00:00Z",
    })).status, 400);
  } finally {
    db.close();
  }
});


test("训练事件防御机制：拦截短于3分钟的误触、自动过期超6小时未结束事件、跨类型互斥收尾与异常热量熔断", async () => {
  const { db, owner, call, issue } = fixture();
  try {
    const { token } = await issue();

    // 1. Accidental tap (< 3 minutes / 180s) is closed and ignored without saving a workout
    const shortStart = new Date(Date.now() - 45_000).toISOString();
    const shortEnd = new Date().toISOString();
    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "start", activityType: "mixedCardio", occurredAt: shortStart,
    })).status, 200);
    const shortActive = await (await call(apple + "/events/active?activityType=mixedCardio", token)).json() as any;
    assert.equal(shortActive.found, false);
    assert.equal(shortActive.tooShort, true);
    const shortEndRes = await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "end", activityType: "mixedCardio", occurredAt: shortEnd,
    });
    assert.equal(shortEndRes.status, 200);
    const shortEndBody = await shortEndRes.json() as any;
    assert.equal(shortEndBody.ingestStatus, "ignored");
    assert.equal(shortEndBody.reason, "too_short");
    assert.equal((await (await call(apple + "/workouts", owner.token)).json() as any[]).length, 0);

    // 2. Forgotten start (> 6 hours) auto-expires in activeEvent and end without saving a ghost workout
    const staleStart = new Date(Date.now() - 8 * 3600_000).toISOString();
    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "start", activityType: "traditionalStrengthTraining", occurredAt: staleStart,
    })).status, 200);
    const staleActive = await (await call(apple + "/events/active?activityType=traditionalStrengthTraining", token)).json() as any;
    assert.equal(staleActive.found, false);
    assert.equal(staleActive.expired, true);

    const staleStart2 = new Date(Date.now() - 7 * 3600_000).toISOString();
    const staleEnd2 = new Date().toISOString();
    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "start", activityType: "cycling", occurredAt: staleStart2,
    })).status, 200);
    const staleEndRes = await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "end", activityType: "cycling", occurredAt: staleEnd2,
    });
    assert.equal(staleEndRes.status, 200);
    assert.equal((await staleEndRes.json() as any).reason, "expired_start");
    assert.equal((await (await call(apple + "/workouts", owner.token)).json() as any[]).length, 0);

    // 3. Cross-activity mutual exclusion: starting Strength closes an unended Cardio start on the same device
    const t1 = new Date(Date.now() - 40 * 60_000).toISOString();
    const t2 = new Date(Date.now() - 20 * 60_000).toISOString();
    const t3 = new Date().toISOString();
    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "start", activityType: "mixedCardio", occurredAt: t1,
    })).status, 200);
    assert.equal((await call(apple + "/events", token, "POST", {
      schemaVersion: 1, event: "start", activityType: "traditionalStrengthTraining", occurredAt: t2,
    })).status, 200);
    const supersededCardio = await (await call(apple + "/events/active?activityType=mixedCardio", token)).json() as any;
    assert.equal(supersededCardio.found, false);

    // 4. Valid 20-min strength end with implausible whole-day leaked calories (e.g. 1500 kcal in 20m) strips only the bad calorie estimate
    const validEnd = await call(apple + "/events", token, "POST", {
      schemaVersion: 1,
      event: "end",
      activityType: "traditionalStrengthTraining",
      occurredAt: t3,
      energyKind: "window_estimate",
      activeEnergyKcal: 1500,
      heartRateMethod: "window_samples",
      avgBpm: 118,
    });
    assert.equal(validEnd.status, 201);
    const saved = await (await call(apple + "/workouts", owner.token)).json() as any[];
    assert.equal(saved.length, 1);
    assert.equal(saved[0].activityType, "traditionalStrengthTraining");
    assert.equal(saved[0].activeEnergyKcal, undefined);
    assert.equal(saved[0].heartRate.avgBpm, 118);
  } finally {
    db.close();
  }
});


test("演示环境重复启动幂等且持久库上已绑定的 Apple 健康令牌重启后继续有效", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { seedWebDemo } = await import("../packages/server/src/web-demo.js");
  const dir = mkdtempSync(join(tmpdir(), "ironlog-demo-persist-"));
  const dbFile = join(dir, "demo.db");
  try {
    let deviceToken = "";
    {
      const db = openDatabase(dbFile);
      try {
        const { app, auth, store } = createApp(db);
        const ownerToken = seedWebDemo(store, auth);
        const res = await app.request(apple + "/tokens", {
          method: "POST",
          headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ label: "持久 iPhone" }),
        });
        assert.equal(res.status, 201);
        const created = await res.json() as { token: string; expiresAt: string };
        deviceToken = created.token;
        assert.ok(Date.parse(created.expiresAt) - Date.now() > 3000 * 86_400_000);
      } finally {
        db.close();
      }
    }
    {
      const db = openDatabase(dbFile);
      try {
        const { app, auth, store } = createApp(db);
        const ownerToken = seedWebDemo(store, auth);
        const list = await (await app.request(apple + "/tokens", {
          headers: { Authorization: `Bearer ${ownerToken}` },
        })).json() as Array<{ label: string }>;
        assert.equal(list.length, 1);
        assert.equal(list[0]?.label, "持久 iPhone");

        const upload = await app.request(apple + "/events", {
          method: "POST",
          headers: { Authorization: `Bearer ${deviceToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            event: "start",
            activityType: "running",
            occurredAt: new Date().toISOString(),
          }),
        });
        assert.equal(upload.status, 200);
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("静态资源 ETag/Gzip 协商与动作详情 304 缓存验证", async () => {
  const { db, app } = fixture();
  try {
    mountWebAssets(app);

    const indexRes = await app.request("/app/");
    assert.equal(indexRes.status, 200);
    const indexHtml = await indexRes.text();
    const cssPath = indexHtml.match(/\/app\/assets\/[A-Za-z0-9._-]+\.css/)?.[0] ?? "/app/styles.css";

    const rawCss = await app.request(cssPath);
    assert.equal(rawCss.status, 200);
    const etag = rawCss.headers.get("ETag");
    assert.ok(etag);
    const rawSize = (await rawCss.arrayBuffer()).byteLength;

    const notModifiedCss = await app.request(cssPath, {
      headers: { "If-None-Match": etag },
    });
    assert.equal(notModifiedCss.status, 304);

    const gzCss = await app.request(cssPath, {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(gzCss.status, 200);
    assert.equal(gzCss.headers.get("Content-Encoding"), "gzip");
    assert.match(gzCss.headers.get("Vary") ?? "", /Accept-Encoding/i);
    const gzSize = (await gzCss.arrayBuffer()).byteLength;
    assert.ok(gzSize < rawSize * 0.5, `expected gzip styles (${gzSize}) << raw (${rawSize})`);

    const detail = await app.request(`${catalogue}/bench-press`);
    assert.equal(detail.status, 200);
    const detailEtag = detail.headers.get("ETag");
    assert.ok(detailEtag);
    assert.match(detail.headers.get("Cache-Control") ?? "", /max-age=300/);

    const detailNotModified = await app.request(`${catalogue}/bench-press`, {
      headers: { "If-None-Match": detailEtag },
    });
    assert.equal(detailNotModified.status, 304);
  } finally {
    db.close();
  }
});

test("JSON API Gzip 压缩、Cache-Control 保留及内存动作目录复合筛选与翻页", async () => {
  const { gunzipSync } = await import("node:zlib");
  const { db, app, owner, call } = fixture();
  try {
    // 1. /api/exercises?builtin=1 gzip + ETag + no-store
    const builtinGz = await app.request("/api/exercises?builtin=1", {
      headers: { Authorization: `Bearer ${owner.token}`, "Accept-Encoding": "gzip" },
    });
    assert.equal(builtinGz.status, 200);
    assert.equal(builtinGz.headers.get("Content-Encoding"), "gzip");
    assert.match(builtinGz.headers.get("Vary") ?? "", /Accept-Encoding/i);
    assert.equal(builtinGz.headers.get("Cache-Control"), "no-store");
    const builtinEtag = builtinGz.headers.get("ETag");
    assert.ok(builtinEtag);
    const builtinBuf = Buffer.from(await builtinGz.arrayBuffer());
    const builtinJson = JSON.parse(gunzipSync(builtinBuf).toString("utf8")) as { exercises: unknown[] };
    assert.equal(builtinJson.exercises.length, 5650);

    const builtinNotMod = await app.request("/api/exercises?builtin=1", {
      headers: { Authorization: `Bearer ${owner.token}`, "If-None-Match": builtinEtag },
    });
    assert.equal(builtinNotMod.status, 304);

    // 2. /api/web/statistics gzip + Cache-Control: no-store
    const statsGz = await app.request("/api/web/statistics", {
      headers: { Authorization: `Bearer ${owner.token}`, "Accept-Encoding": "gzip" },
    });
    assert.equal(statsGz.status, 200);
    assert.equal(statsGz.headers.get("Content-Encoding"), "gzip");
    assert.equal(statsGz.headers.get("Cache-Control"), "no-store");
    const statsJson = JSON.parse(gunzipSync(Buffer.from(await statsGz.arrayBuffer())).toString("utf8")) as {
      period: number;
      daily: unknown[];
    };
    assert.equal(statsJson.period, 30);
    assert.equal(statsJson.daily.length, 30);

    // 3. /api/catalogue/exercises combined filters + cursor pagination + mismatch 400 + lookup dedup
    const p1Res = await call(`${catalogue}?muscle=chest&equipment=dumbbell&limit=3`);
    assert.equal(p1Res.status, 200);
    const p1 = (await p1Res.json()) as {
      total: number;
      items: { id: string; muscle: string; equipment: string }[];
      nextCursor: string | null;
    };
    assert.ok(p1.total > 3);
    assert.equal(p1.items.length, 3);
    assert.ok(p1.nextCursor);
    for (const item of p1.items) {
      assert.equal(item.muscle, "chest");
      assert.equal(item.equipment, "dumbbell");
    }

    const p2Res = await call(`${catalogue}?muscle=chest&equipment=dumbbell&limit=3&cursor=${encodeURIComponent(p1.nextCursor)}`);
    assert.equal(p2Res.status, 200);
    const p2 = (await p2Res.json()) as typeof p1;
    assert.equal(p2.total, p1.total);
    assert.notDeepEqual(p2.items.map((x) => x.id), p1.items.map((x) => x.id));

    const badCursorRes = await call(`${catalogue}?muscle=back&equipment=dumbbell&limit=3&cursor=${encodeURIComponent(p1.nextCursor)}`);
    assert.equal(badCursorRes.status, 400);

    const searchRes = await call(`${catalogue}?muscle=chest&equipment=dumbbell&q=飞鸟&limit=10`);
    assert.equal(searchRes.status, 200);
    const searchJson = (await searchRes.json()) as typeof p1;
    assert.ok(searchJson.total >= 1 && searchJson.total <= p1.total);

    const lookupRes = await app.request(`${catalogue}/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["exdb_2612", "bench-press", "exdb_2612", "non-existent-id"] }),
    });
    assert.equal(lookupRes.status, 200);
    const lookupJson = (await lookupRes.json()) as { items: { id: string }[] };
    assert.deepEqual(lookupJson.items.map((x) => x.id), ["bench-press", "exdb_2612"]);

    // 4. Bilingual search relevance ranking & ranked cursor pagination without duplicates
    const rankedEnRes = await call(`${catalogue}?q=Barbell+Bench+Press&limit=5`);
    assert.equal(rankedEnRes.status, 200);
    const rankedEn = (await rankedEnRes.json()) as {
      total: number;
      items: { id: string; name: string }[];
      nextCursor: string | null;
    };
    assert.ok(rankedEn.total >= 1);
    assert.equal(rankedEn.items[0]?.id, "bench-press");

    const seenIds: string[] = [];
    let cursor: string | null = null;
    let totalZh = 0;
    do {
      const qs = cursor ? `?q=卧推&limit=25&cursor=${encodeURIComponent(cursor)}` : "?q=卧推&limit=25";
      const pageRes = await call(`${catalogue}${qs}`);
      assert.equal(pageRes.status, 200);
      const pageJson = (await pageRes.json()) as typeof rankedEn;
      totalZh = pageJson.total;
      if (cursor === null) {
        assert.ok(pageJson.items.slice(0, 5).some((x) => x.id === "bench-press" || x.name.includes("卧推")));
      }
      seenIds.push(...pageJson.items.map((x) => x.id));
      cursor = pageJson.nextCursor;
    } while (cursor);
    assert.equal(seenIds.length, totalZh);
    assert.equal(new Set(seenIds).size, totalZh);
  } finally {
    db.close();
  }
});
