import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../packages/server/src/db.js";
import { createApp } from "../packages/server/src/app.js";
import { copyDietBatch } from "../packages/web/src/lib/diet-copy.ts";
import {
  planSchema,
  classicStrength,
  localDate,
  workoutSchema,
  estimatedOneRepMax,
  weightTrend,
  workoutMetrics,
  exerciseCatalogue,
  exerciseSnapshotSchema,
  type MealTemplate,
} from "@ironlog/shared";

function fixture() {
  const db = openDatabase(":memory:");
  const application = createApp(db, { allowDevLogin: true });
  async function login(identity: string) {
    const result = await application.app.request("/auth/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity }),
    });
    return (await result.json()) as { token: string; userId: string };
  }
  async function request(token: string, path: string, body?: unknown) {
    return application.app.request(path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  return { ...application, db, login, request };
}
const diet = {
  date: "2026-11-14",
  meal: "lunch",
  name: "鸡胸肉",
  calories: 200,
  protein: 40,
  carbs: 0,
  fat: 4,
};

test("复刻饮食在回执丢失后重用整批编号，收到回执后允许再次复制", async () => {
  const f = fixture();
  try {
    const account = await f.login("diet-copy-retry");
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
      removeItem: (key: string) => { saved.delete(key); },
    };
    let first = true;
    const submit = (calories: number) => copyDietBatch({
      userId: account.userId, date: diet.date, intent: "yesterday", storage,
      foods: [{ ...diet, calories, meal: "lunch" }],
      send: async (body) => {
        const response = await f.request(account.token, "/api/sync", body);
        assert.equal(response.status, 200);
        if (first) {
          first = false;
          throw Object.assign(new Error("回执丢失"), { status: 503 });
        }
        return response.json() as any;
      },
    });
    await assert.rejects(submit(200), /回执丢失/);
    assert.equal(saved.size, 1);
    assert.equal(await submit(999), 1);
    const rows = () => f.store.list(account.userId, "diet");
    assert.equal(rows().length, 1);
    assert.equal((rows()[0]!.data as { calories: number }).calories, 200);
    assert.equal(saved.size, 0);
    assert.equal(await submit(300), 1);
    assert.equal(rows().length, 2);
  } finally { f.db.close(); }
});

test("网页全量 JSON 可往返恢复超过旧上限的备份", async () => {
  const f = fixture();
  try {
    const sender = await f.login("large-backup-export");
    const reader = await f.login("large-backup-import");
    const stamp = new Date().toISOString();
    const data = {
      title: "往返样本", date: localDate(), startedAt: stamp, endedAt: stamp, status: "completed",
      notes: "x".repeat(3990), exercises: [],
    };
    f.db.transaction(() => {
      for (let i = 0; i < 4000; i++) {
        f.store.mutate(sender.userId, {
          opId: `large-op-${i}`, id: `large-record-${i}`, kind: "workout",
          baseVersion: 0, deleted: false, data,
        });
      }
    })();
    const exported = await f.request(sender.token, "/api/export");
    assert.equal(exported.status, 200);
    const text = await exported.text();
    assert.ok(Buffer.byteLength(text) > 16 * 1024 * 1024);
    const backup = JSON.parse(text);
    const preview = await f.request(reader.token, "/api/web/restore-backup", { backup, mode: "preview", strategy: "replace" });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json() as any).counts.workouts, 4000);
    const restored = await f.request(reader.token, "/api/web/restore-backup", { backup, mode: "commit", strategy: "replace" });
    assert.equal(restored.status, 200);
    assert.equal(f.store.list(reader.userId, "workout").length, 4000);
  } finally { f.db.close(); }
});

test("三大项只汇总标准动作并接受目录别名", () => {
  const lifts: Record<string, number> = { "squat": 100, "bench-press": 80, "romanian-deadlift": 110 };
  assert.deepEqual(classicStrength((id) => lifts[id]), { bench: 80, squat: 100, deadlift: 0, total: null });
  lifts.exdb_0117 = 120;
  lifts.exdb_3593 = 102.5;
  assert.deepEqual(classicStrength((id) => lifts[id]), { bench: 80, squat: 102.5, deadlift: 120, total: 302.5 });
});

test("常用餐单通过同步保存、隔离、备份与删除，非法组合整批回滚", async () => {
  const f = fixture();
  try {
    const owner = await f.login("meal-owner");
    const other = await f.login("meal-other");
    const mutation = {
      opId: "meal-create",
      id: "usual-lunch",
      kind: "mealTemplate",
      baseVersion: 0,
      deleted: false,
      data: { name: "工作日午餐", foods: [diet] },
    };
    const sync = { cursor: 0, mutations: [mutation] };
    assert.equal((await f.request(owner.token, "/api/sync", sync)).status, 200);
    assert.equal((await f.request(owner.token, "/api/sync", sync)).status, 200);
    const records = f.store.list(owner.userId, "mealTemplate");
    assert.equal(records.length, 1);
    assert.equal("date" in (records[0]!.data as MealTemplate).foods[0]!, false);
    assert.equal(f.store.list(owner.userId, "diet").length, 0);
    assert.equal(f.store.list(other.userId, "mealTemplate").length, 0);
    assert.equal(f.store.export(owner.userId).records[0]?.kind, "mealTemplate");
    const invalid = await f.request(owner.token, "/api/sync", {
      cursor: 0,
      mutations: [
        { ...mutation, opId: "second", id: "second" },
        { ...mutation, opId: "invalid", id: "invalid", data: { name: "空餐单", foods: [] } },
      ],
    });
    assert.equal(invalid.status, 400);
    assert.equal(f.store.list(owner.userId, "mealTemplate").length, 1);
    assert.equal((await f.request(owner.token, "/api/records", {
      ...mutation, opId: "delete", baseVersion: 1, deleted: true,
    })).status, 200);
    assert.equal(f.store.list(owner.userId, "mealTemplate").length, 0);
    assert.equal(f.store.list(owner.userId, "mealTemplate", true)[0]?.deleted, true);
  } finally {
    f.db.close();
  }
});

test("登录鉴权、隔离、重复同步和删除标记", async () => {
  const f = fixture();
  try {
    assert.equal((await f.app.request("/api/me")).status, 401);
    const a = await f.login("alice");
    const b = await f.login("bob");
    const mutation = {
      opId: "op_1",
      id: "food_1",
      kind: "diet",
      baseVersion: 0,
      deleted: false,
      data: diet,
    };
    assert.equal(
      (await f.request(a.token, "/api/records", mutation)).status,
      200,
    );
    assert.equal(
      (await f.request(a.token, "/api/records", mutation)).status,
      200,
    );
    assert.equal(f.store.list(a.userId, "diet").length, 1);
    assert.equal(f.store.list(b.userId, "diet").length, 0);
    const conflicts = await f.request(a.token, "/api/records", {
      ...mutation,
      opId: "op_2",
    });
    assert.equal(conflicts.status, 409);
    assert.equal(
      (
        await f.request(a.token, "/api/records", {
          ...mutation,
          data: { ...diet, calories: 300 },
        })
      ).status,
      409,
    );
    const pulled = (await (
      await f.request(a.token, "/api/sync", { cursor: 0, mutations: [] })
    ).json()) as { cursor: number; records: unknown[] };
    assert.equal(pulled.records.length, 1);
    const empty = (await (
      await f.request(b.token, "/api/sync", { cursor: 0, mutations: [] })
    ).json()) as { records: unknown[] };
    assert.equal(empty.records.length, 0);
    assert.equal(
      (
        await f.request(a.token, "/api/records", {
          ...mutation,
          opId: "delete_1",
          baseVersion: 1,
          deleted: true,
        })
      ).status,
      200,
    );
    const deleted = (await (
      await f.request(a.token, "/api/sync", {
        cursor: pulled.cursor,
        mutations: [],
      })
    ).json()) as { records: { deleted: boolean }[] };
    assert.equal(deleted.records[0]?.deleted, true);
  } finally {
    f.db.close();
  }
});

test("同步批次校验失败整体回滚", async () => {
  const f = fixture();
  try {
    const user = await f.login("rollback");
    const response = await f.request(user.token, "/api/sync", {
      cursor: 0,
      mutations: [
        {
          opId: "valid",
          id: "valid",
          kind: "diet",
          baseVersion: 0,
          data: diet,
        },
        {
          opId: "invalid",
          id: "invalid",
          kind: "weight",
          baseVersion: 0,
          data: { date: "2026-11-14", weight: 72 },
        },
      ],
    });
    assert.equal(response.status, 400);
    assert.equal(f.store.list(user.userId, "diet").length, 0);
  } finally {
    f.db.close();
  }
});

test("计划应用保留快照并检查版本", async () => {
  const f = fixture();
  try {
    const user = await f.login("planner");
    const plan = planSchema.parse({
      name: "三日计划",
      weeks: 4,
      schedule: "rotation",
      rationale: "根据每周三天安排",
      routines: [
        {
          id: "a",
          name: "推",
          exercises: [
            {
              exerciseId: "bench-press",
              sets: 3,
              repsMin: 8,
              repsMax: 12,
              weight: 40,
              restSeconds: 90,
            },
          ],
        },
      ],
    });
    const draft = f.store.createDraft(user.userId, plan).record!;
    f.store.applyPlan(user.userId, draft.id, draft.version, 0);
    const changed = f.store.mutate(user.userId, {
      opId: randomUUID(),
      kind: "plan",
      id: draft.id,
      baseVersion: 1,
      deleted: false,
      data: { ...plan, name: "新版本" },
    });
    assert.equal(changed.record?.version, 2);
    assert.equal(f.store.activePlan(user.userId)?.data.name, "三日计划");
    assert.throws(
      () => f.store.applyPlan(user.userId, draft.id, 2, 0),
      /已变化/,
    );
    f.store.applyPlan(user.userId, draft.id, 2, 1);
    assert.equal(f.store.activePlan(user.userId)?.data.name, "新版本");
    f.store.applyPlan(user.userId, draft.id, 1, 2, true);
    assert.equal(f.store.activePlan(user.userId)?.data.name, "三日计划");
    assert.deepEqual(f.store.planSchedule(user.userId)?.history.map((entry) => entry.version), [1, 2, 1]);
    assert.equal(f.store.export(user.userId).activePlan?.history.length, 3);
  } finally {
    f.db.close();
  }
});

test("历史修改后力量统计重算，热身排除", async () => {
  const f = fixture();
  try {
    const user = await f.login("stats");
    const workout = workoutSchema.parse({
      title: "训练",
      date: "2026-11-14",
      startedAt: "2026-11-14T01:00:00Z",
      endedAt: "2026-11-14T02:00:00Z",
      status: "completed",
      feeling: "balanced",
      exercises: [
        {
          id: "ex",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [
            {
              id: "warmup",
              type: "warmup",
              weight: 100,
              reps: 12,
              completed: true,
            },
            {
              id: "work",
              type: "normal",
              weight: 80,
              reps: 8,
              completed: true,
            },
          ],
        },
      ],
    });
    const first = f.store.mutate(user.userId, {
      id: "workout",
      opId: "workout1",
      baseVersion: 0,
      kind: "workout",
      deleted: false,
      data: workout,
    });
    const saved = await (await f.request(user.token, "/api/records/workout")).json() as { data: { feeling: string } }[];
    assert.equal(saved[0]!.data.feeling, "balanced");
    let stats = (await (
      await f.request(user.token, "/api/stats?date=2026-11-14")
    ).json()) as { series: Record<string, { weight: number }[]> };
    assert.equal(stats.series["bench-press"]?.[0]?.weight, 80);
    workout.exercises[0]!.sets[1]!.weight = 60;
    f.store.mutate(user.userId, {
      id: "workout",
      opId: "workout2",
      baseVersion: first.record!.version,
      kind: "workout",
      deleted: false,
      data: workout,
    });
    stats = (await (
      await f.request(user.token, "/api/stats")
    ).json()) as typeof stats;
    assert.equal(stats.series["bench-press"]?.[0]?.weight, 60);
  } finally {
    f.db.close();
  }
});

test("单次1RM和缺测日期的七日均线", () => {
  assert.equal(estimatedOneRepMax(80, 1), 80);
  assert.equal(estimatedOneRepMax(80, 0), 0);
  const trend = weightTrend([
    { date: "2026-11-01", weight: 90, bodyFat: null },
    { date: "2026-11-08", weight: 70, bodyFat: null },
    { date: "2026-11-14", weight: 72, bodyFat: null },
  ]);
  assert.equal(trend[2]?.average, 71);
  assert.equal(trend[2]?.count, 2);
});

test("体重趋势按日期窗口复用计算，重复日期、缺测与小数沿用原始求和顺序", () => {
  const logs = Array.from({ length: 600 }, (_, index) => ({
    date: new Date(Date.UTC(2024, 0, 1 + Math.floor(index / 3) * 2)).toISOString().slice(0, 10),
    weight: 60 + ((index * 137) % 10000) / 1000,
    bodyFat: index % 3 ? null : 17.5,
  })).reverse();
  const before = structuredClone(logs);
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const expected = sorted.map((log) => {
    const earliest = Date.parse(`${log.date}T00:00:00+08:00`) - 6 * 86400000;
    const window = sorted.filter((item) => item.date <= log.date && Date.parse(`${item.date}T00:00:00+08:00`) >= earliest);
    return {
      ...log,
      average: Math.round(window.reduce((sum, item) => sum + item.weight, 0) / window.length * 10) / 10,
      count: window.length,
    };
  });
  assert.deepEqual(weightTrend(logs), expected);
  assert.deepEqual(logs, before);
  assert.deepEqual(weightTrend([]), []);
});

test("训练指标复用动作索引时优先使用训练快照，并沿用热身、计时及容量规则", () => {
  const bench = exerciseCatalogue.find((exercise) => exercise.id === "bench-press")!;
  const snapshot = exerciseSnapshotSchema.parse({ ...bench, equipment: "dumbbell", volumeMultiplier: 2 });
  const workout = workoutSchema.parse({
    title: "复用动作索引", date: "2026-11-15", status: "completed",
    startedAt: "2026-11-15T08:00:00Z", endedAt: "2026-11-15T09:00:00Z",
    exercises: [
      { id: "pair", exerciseId: "bench-press", snapshot, restSeconds: 90, sets: [
        { id: "pair-warmup", type: "warmup", weight: 300, reps: 10, completed: true },
        { id: "pair-normal", type: "normal", weight: 40, reps: 8, completed: true },
      ] },
      { id: "squat-row", exerciseId: "squat", restSeconds: 90,
        sets: [{ id: "squat-normal", type: "normal", weight: 50, reps: 10, completed: true }] },
      { id: "plank-row", exerciseId: "plank", restSeconds: 90,
        sets: [{ id: "plank-timed", type: "normal", weight: 0, reps: 0, seconds: 30, completed: true }] },
    ],
  });
  const index = new Map(exerciseCatalogue.map((exercise) => [exercise.id, exercise]));
  const actual = workoutMetrics(workout, index);
  assert.deepEqual(actual, workoutMetrics(workout, exerciseCatalogue));
  assert.equal(actual.volume, 1140);
  assert.equal(actual.completedSets, 3);
  assert.equal(Object.hasOwn(actual.best, "plank"), false);
});

test("开发登录默认关闭，未配置AI返回明确状态", async () => {
  const db = openDatabase(":memory:");
  try {
    const production = createApp(db);
    assert.equal(
      (
        await production.app.request("/auth/dev", {
          method: "POST",
          body: "{}",
        })
      ).status,
      403,
    );
    const session = production.auth.login("test");
    const response = await production.app.request("/api/ai/plan", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "每周练三天" }),
    });
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as { error: string }).error, /配置/);
  } finally {
    db.close();
  }
});

test("尚未上传的离线记录可直接同步删除，重试保持同一墓碑", async () => {
  const f = fixture();
  try {
    const user = await f.login("offline-delete");
    const mutation = {
      opId: "offline-delete",
      id: "food-offline",
      kind: "diet",
      baseVersion: 0,
      deleted: true,
      data: diet,
    };
    const first = await f.request(user.token, "/api/records", mutation);
    assert.equal(first.status, 200);
    assert.equal(
      (await f.request(user.token, "/api/records", mutation)).status,
      200,
    );
    assert.equal(f.store.list(user.userId, "diet").length, 0);
    assert.equal(f.store.get(user.userId, "diet", "food-offline")?.version, 1);
  } finally {
    f.db.close();
  }
});

test("自定义动作身份由服务端确定并保留训练时动作口径", async () => {
  const f = fixture();
  try {
    const user = await f.login("custom");
    const exercise = {
      ...f.store.catalogue(user.userId)[0]!,
      id: "custom-exercise",
      name: "自定义卧推",
      custom: false,
    };
    f.store.mutate(user.userId, {
      id: exercise.id,
      opId: "custom-create",
      kind: "exercise",
      baseVersion: 0,
      deleted: false,
      data: exercise,
    });
    assert.equal(
      (
        f.store.get(user.userId, "exercise", exercise.id)
          ?.data as typeof exercise
      ).custom,
      true,
    );
    const workout = workoutSchema.parse({
      title: "自定义训练",
      date: "2026-11-14",
      startedAt: "2026-11-14T01:00:00Z",
      endedAt: "2026-11-14T02:00:00Z",
      status: "completed",
      exercises: [
        {
          id: "row",
          exerciseId: exercise.id,
          restSeconds: 90,
          sets: [
            { id: "set", type: "normal", weight: 40, reps: 8, completed: true },
          ],
        },
      ],
    });
    f.store.mutate(user.userId, {
      id: "custom-workout",
      opId: "custom-workout",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: workout,
    });
    f.store.mutate(user.userId, {
      id: exercise.id,
      opId: "custom-delete",
      kind: "exercise",
      baseVersion: 1,
      deleted: true,
      data: exercise,
    });
    const stats = (await (
      await f.request(user.token, "/api/stats?date=2026-11-14")
    ).json()) as { workouts: { metrics: { volume: number } }[] };
    assert.equal(stats.workouts[0]?.metrics.volume, 320);
  } finally {
    f.db.close();
  }
});

test("训练计时元数据与饮食完整标记经同步和备份保留，标记日期身份强制匹配", async () => {
  const f = fixture();
  try {
    const owner = await f.login("progress-owner");
    const other = await f.login("progress-other");
    const restStartedAt = Date.parse("2026-11-18T07:12:30Z");
    const workout = workoutSchema.parse({
      title: "已暂停", date: "2026-11-18", startedAt: "2026-11-18T07:00:00Z",
      endedAt: null, status: "active", exercises: [], timing: { elapsedSeconds: 750, runningSince: null },
      restStartedAt, restEndsAt: restStartedAt + 90000,
    });
    const mutations = [
      { opId: "timing", kind: "workout", id: "workout", baseVersion: 0, deleted: false, data: workout },
      { opId: "nutrition", kind: "nutritionDay", id: "nutritionDay_2026-11-18", baseVersion: 0, deleted: false, data: { date: "2026-11-18", complete: true, fingerprint: "[]" } },
    ];
    assert.equal((await f.request(owner.token, "/api/sync", { cursor: 0, mutations })).status, 200);
    const stored = workoutSchema.parse(f.store.list(owner.userId, "workout")[0]!.data);
    assert.deepEqual(stored.timing, { elapsedSeconds: 750, runningSince: null });
    assert.equal(stored.restStartedAt, restStartedAt);
    assert.equal(stored.restEndsAt, restStartedAt + 90000);
    assert.equal(f.store.list(owner.userId, "nutritionDay").length, 1);
    assert.equal(f.store.list(other.userId, "nutritionDay").length, 0);
    const backup = f.store.export(owner.userId);
    assert.equal(backup.records.length, 2);
    assert.equal(workoutSchema.parse(backup.records.find((record) => record.kind === "workout")!.data).restStartedAt, restStartedAt);
    const invalid = await f.request(owner.token, "/api/records", { ...mutations[1], opId: "invalid", id: "nutritionDay_2026-11-19" });
    assert.equal(invalid.status, 400);
    assert.equal(f.store.list(owner.userId, "nutritionDay").length, 1);
  } finally { f.db.close(); }
});

test("Store.list 读缓存在外部数组修改、同库跨实例写入与逻辑删除后保持一致", async () => {
  const f = fixture();
  try {
    const owner = await f.login("cache-owner");
    const other = await f.login("cache-other");

    f.store.mutate(owner.userId, {
      id: "d1", kind: "diet", opId: "c-op-1", baseVersion: 0, deleted: false,
      data: { ...diet, name: "鸡胸肉" },
    });

    const first = f.store.list(owner.userId, "diet");
    assert.equal(first.length, 1);
    assert.equal(f.store.list(other.userId, "diet").length, 0);

    // Mutating returned array does not corrupt cached records
    first.pop();
    const second = f.store.list(owner.userId, "diet");
    assert.equal(second.length, 1);

    // Writing via another Store instance sharing the same db invalidates via changes.seq
    const { Store } = await import("../packages/server/src/store.js");
    const writer = new Store(f.db);
    writer.mutate(owner.userId, {
      id: "d2", kind: "diet", opId: "c-op-2", baseVersion: 0, deleted: false,
      data: { ...diet, name: "全麦面包" },
    });
    assert.equal(f.store.list(owner.userId, "diet").length, 2);

    // Logical delete separates includeDeleted=false vs includeDeleted=true
    writer.mutate(owner.userId, {
      id: "d1", kind: "diet", opId: "c-op-3", baseVersion: 1, deleted: true,
      data: { ...diet, name: "鸡胸肉" },
    });
    assert.equal(f.store.list(owner.userId, "diet", false).length, 1);
    assert.equal(f.store.list(owner.userId, "diet", true).length, 2);
  } finally {
    f.db.close();
  }
});

test("训练记录兼容历史 source='plan'/null 字段并保留详情级 Zod 报错信息", async () => {
  const f = fixture();
  try {
    const owner = await f.login("workout-compat-user");

    // Schema compatibility: legacy source, null rawPrompt/adjustments/timing/completedAt, offset ISO timestamps
    const normalized = workoutSchema.parse({
      title: "推胸日",
      date: "2026-11-24",
      startedAt: "2026-11-24T10:00:00+08:00",
      endedAt: "2026-11-24T10:45:00+08:00",
      timing: null,
      status: "completed",
      notes: "",
      feeling: "balanced",
      source: "plan",
      rawPrompt: null,
      adjustments: null,
      targetSnapshot: null,
      exercises: [
        {
          id: "ex-row-1",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [
            {
              id: "set-row-1",
              type: "normal",
              weight: 80,
              reps: 8,
              seconds: 0,
              completed: true,
              completedAt: null,
              rir: null,
            },
          ],
        },
      ],
    });
    assert.equal(normalized.source, "manual");
    assert.equal(normalized.rawPrompt, "");
    assert.deepEqual(normalized.adjustments, []);
    assert.equal(normalized.timing, undefined);

    // End-to-end POST /api/records from plan preview payload
    const planRes = await f.request(owner.token, "/api/web/starter-plans/ppl-3/adopt", { mode: "apply" });
    assert.equal(planRes.status, 201);
    const adopted = (await planRes.json()) as {
      draft: { id: string; version: number; data: { routines: Array<{ id: string }> } };
    };
    const routineId = adopted.draft.data.routines[0]!.id;
    const routineRes = await f.request(
      owner.token,
      `/api/web/routine?id=${encodeURIComponent(routineId)}&source=plan&date=2026-11-24`,
    );
    assert.equal(routineRes.status, 200);
    const routinePayload = (await routineRes.json()) as {
      name: string;
      routineId: string;
      planId: string | null;
      planVersion: number | null;
      targetSnapshot: unknown;
      exercises: Array<{
        exerciseId: string;
        targetIndex: number;
        restSeconds: number;
        supersetGroup: string | null;
        snapshot: unknown;
        sets: number;
        weight: number;
        reps: number;
        seconds: number;
      }>;
    };

    const saveRes = await f.request(owner.token, "/api/records", {
      opId: "save-from-routine-1",
      id: "wk-routine-1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: routinePayload.name,
        date: "2026-11-24",
        startedAt: "2026-11-24T09:00:00.000Z",
        endedAt: "2026-11-24T09:50:00.000Z",
        status: "completed",
        notes: "",
        feeling: "balanced",
        source: "plan",
        rawPrompt: null,
        planId: routinePayload.planId,
        planVersion: routinePayload.planVersion,
        routineId: routinePayload.routineId,
        targetSnapshot: routinePayload.targetSnapshot,
        adjustments: null,
        exercises: routinePayload.exercises.map((ex, i) => ({
          id: `ex-${i}`,
          exerciseId: ex.exerciseId,
          targetIndex: ex.targetIndex,
          restSeconds: ex.restSeconds,
          supersetGroup: ex.supersetGroup,
          snapshot: ex.snapshot,
          sets: Array.from({ length: ex.sets }, (_, j) => ({
            id: `set-${i}-${j}`,
            type: "normal",
            weight: ex.weight,
            reps: ex.reps,
            seconds: ex.seconds,
            completed: true,
            completedAt: "2026-11-24T09:30:00.000Z",
            rir: null,
          })),
        })),
      },
    });
    assert.equal(saveRes.status, 200);

    // Invalid workout payload returns 400 with field-level details
    const badRes = await f.request(owner.token, "/api/records", {
      opId: "save-bad-1",
      id: "wk-bad-1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "错位时间训练",
        date: "2026-11-24",
        startedAt: "2026-11-24T10:00:00.000Z",
        endedAt: "2026-11-24T09:00:00.000Z",
        status: "completed",
        exercises: [],
      },
    });
    assert.equal(badRes.status, 400);
    const badJson = (await badRes.json()) as { error: string; details?: Array<{ message: string }> };
    assert.equal(badJson.error, "输入格式不正确");
    assert.ok(Array.isArray(badJson.details) && badJson.details.length > 0);
  } finally {
    f.db.close();
  }
});
