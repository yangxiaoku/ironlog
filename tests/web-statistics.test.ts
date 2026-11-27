import { test } from "node:test";
import assert from "node:assert/strict";
import { localDate } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";

function fixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("web-test-account");
  const other = auth.login("web-test-other");
  const call = (url: string, options: { token?: string; method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: { Authorization: "Bearer " + (options.token ?? owner.token), "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  let seq = 0;
  const save = (kind: "workout" | "diet" | "weight", id: string, data: unknown, baseVersion = 0) =>
    store.mutate(owner.userId, { id, kind, opId: "save-" + seq++, data, baseVersion, deleted: false });
  return { db, app, call, save, owner, other };
}

test("网页统计区分工作组、Apple 上传、未知时长和估算力量", async () => {
  const { db, app, call, save, owner, other } = fixture();
  try {
    const end = shiftDay(localDate(), -1);
    const makeWorkout = (date: string, extras = {}) => ({
      date, title: "卧推", status: "completed", feeling: "balanced",
      startedAt: date + "T06:00:00Z", endedAt: date + "T07:00:00Z",
      exercises: [{ id: "row", exerciseId: "bench-press", restSeconds: 90, sets: [
        { id: "warm", type: "warmup", completed: true, weight: 20, reps: 10 },
        { id: "work", type: "normal", completed: true, weight: 50, reps: 8 },
        { id: "rep-high", type: "normal", completed: true, weight: 55, reps: 18 },
        { id: "blank", type: "normal", completed: true, weight: 60, reps: 0 },
        { id: "todo", type: "normal", completed: false, weight: 90, reps: 4 },
      ] }], ...extras,
    });
    save("workout", "current", makeWorkout(end, { durationUnknown: true }));
    save("workout", "previous", makeWorkout(shiftDay(end, -7)));
    save("workout", "canceled", makeWorkout(end, { status: "cancelled" }));
    save("workout", "future", makeWorkout(shiftDay(end, 1)));
    const device = await (await call("/api/integrations/apple-health/tokens", { method: "POST", body: { label: "Watch" } })).json() as { token: string };
    const upload = await call("/api/integrations/apple-health/workouts", { method: "POST", token: device.token, body: {
      schemaVersion: 1, captureMethod: "workout", activityType: "traditionalStrengthTraining",
      startedAt: end + "T06:00:00Z", endedAt: end + "T07:00:00Z",
      durationSeconds: 3000, durationKind: "workout_active", activeEnergyKcal: 260,
      energyKind: "workout", heartRate: { avgBpm: 133 },
    } });
    assert.equal(upload.status, 201);
    const url = `/api/web/statistics?days=7&through=${end}`;
    const response = await call(url);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const result = await response.json() as any;
    assert.equal(result.daily.length, 7);
    assert.equal(result.totals.workouts, 1);
    assert.equal(result.totals.sets, 2);
    assert.equal(result.totals.volume, 1390);
    assert.equal(result.totals.timedWorkouts, 0);
    assert.equal(result.feelings.balanced, 1);
    assert.equal(result.previous.workouts, 1);
    assert.deepEqual(result.muscles, [{ key: "chest", name: "胸", sets: 2 }]);
    assert.deepEqual(result.strength.points, [{ date: end, weight: 55, estimated1rm: 63.33 }]);
    assert.equal(result.apple[0].heartRate.avgBpm, 133);
    assert.equal((await call(url, { token: other.token }).then((r) => r.json()) as any).totals.workouts, 0);
    assert.equal((await app.request(url)).status, 401);
    assert.equal(owner.token !== device.token, true);
  } finally { db.close(); }
});

test("统计后台按账号保存布局和口径，旧版本无法覆盖新设置", async () => {
  const { db, call, other } = fixture();
  try {
    const route = "/api/web/preferences";
    const input = { revision: 0, days: 90, includeWarmups: true, panels: ["weight", "load"] };
    const response = await call(route, { method: "PUT", body: input });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...input, revision: 1 });
    assert.equal((await call(route, { method: "PUT", body: input })).status, 409);
    assert.equal((await call(route, { method: "PUT", body: { ...input, revision: 1, panels: ["load", "load"] } })).status, 400);
    const preferences = await (await call(route, { token: other.token })).json() as { revision: number; days: number };
    assert.equal(preferences.revision, 0);
    assert.equal(preferences.days, 30);
  } finally { db.close(); }
});

test("饮食记录被编辑时，已确认的完整日自动失效", async () => {
  const { db, call, save } = fixture();
  try {
    const date = localDate();
    const food = { date, meal: "lunch", name: "米饭", calories: 300, protein: 4, carbs: 65, fat: 0 };
    save("diet", "lunch", food);
    const get = async () => (await (await call(`/api/web/statistics?days=7&through=${date}`)).json() as any).nutrition[0];
    assert.equal((await get()).complete, false);
    assert.equal((await call("/api/web/nutrition-day", { method: "PUT", body: { date, opId: "confirm" } })).status, 200);
    assert.equal((await get()).complete, true);
    save("diet", "lunch", { ...food, calories: 340 }, 1);
    assert.equal((await get()).complete, false);
  } finally { db.close(); }
});

test("网页目标保存回执丢失后可重试，旧请求也不会覆盖后来的目标", async () => {
  const { db, call } = fixture();
  try {
    const path = "/api/web/profile";
    const input = { version: 0, opId: "profile-first", calories: 2300, protein: 160, carbs: 240, fat: 70,
      daysPerWeek: 4, restSeconds: 75, targetWeight: null, energyProfile: null };
    const put = (body: unknown) => call(path, { method: "PUT", body });
    const first = await put(input);
    assert.equal(first.status, 200);
    const saved: unknown = await first.json();
    assert.equal((await put({ ...input, version: 1, opId: "profile-second", calories: 2450 })).status, 200);
    const replay = await put(input);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), saved);
    assert.equal((await put({ ...input, calories: 3100 })).status, 409);
    const latest = await (await call(path)).json() as any;
    assert.equal(latest.version, 2);
    assert.equal(latest.profile.calories, 2450);
  } finally { db.close(); }
});

test("同步删除目标配置后，统计接口、AI 上下文与网页读取同一套默认值", async () => {
  const { db, call } = fixture();
  try {
    const input = { kind: "profile", id: "settings", opId: "custom-targets", baseVersion: 0, deleted: false,
      data: { calories: 3000, restSeconds: 45 } };
    assert.equal((await call("/api/records", { method: "POST", body: input })).status, 200);
    assert.equal((await call("/api/records", { method: "POST", body: { ...input, opId: "removed-targets",
      baseVersion: 1, deleted: true } })).status, 200);
    const read = async (path: string) => (await call(path)).json() as Promise<any>;
    const web = await read("/api/web/profile");
    const stats = await read("/api/stats");
    const context = await read("/api/context");
    assert.equal(stats.remaining, web.profile.calories);
    assert.deepEqual(stats.profile, web.profile);
    assert.deepEqual(context.profile, web.profile);
  } finally { db.close(); }
});

test("今日工作台读取账号当天记录，并按历史为计划准备训练目标", async () => {
  const { db, call, save, other } = fixture();
  try {
    const today = localDate();
    const yesterday = shiftDay(today, -1);
    const routine = { id: "press", name: "卧推训练", exercises: [{ exerciseId: "bench-press",
      sets: 1, repsMin: 6, repsMax: 8, weight: null, restSeconds: 90, progression: "double" }] };
    const draft = await call("/api/plans/drafts", { method: "POST", body: {
      name: "卧推训练计划", weeks: 4, schedule: "rotation", routines: [routine], rationale: "每周练卧推",
    } });
    assert.equal(draft.status, 201);
    const { record } = await draft.json() as { record: { id: string; version: number } };
    assert.equal((await call("/api/plans/apply", { method: "POST",
      body: { ...record, expectedRevision: 0 } })).status, 200);
    const todayPanel = async () => await (await call("/api/web/today")).json() as any;
    assert.equal((await todayPanel()).planned.id, routine.id);
    save("workout", "done", { date: yesterday, title: "卧推",
      startedAt: yesterday + "T06:00:00Z", endedAt: yesterday + "T07:00:00Z", status: "completed",
      planId: record.id, planVersion: record.version, routineId: routine.id, targetSnapshot: routine,
      exercises: [{ id: "exercise", exerciseId: "bench-press", restSeconds: 90, targetIndex: 0,
        sets: [{ id: "work", weight: 50, reps: 8, type: "normal", completed: true, rir: 2 }] }],
    });
    const prepared = await (await call("/api/web/routine?source=plan&id=press")).json() as any;
    assert.equal(prepared.exercises[0].weight, 52.5);
    assert.equal(prepared.exercises[0].reps, 6);
    save("workout", "draft", { date: today, title: "自由训练", startedAt: today + "T00:00:00Z",
      endedAt: null, status: "active", exercises: [] });
    save("weight", "weight_" + today, { date: today, weight: 77.4 });
    save("diet", "breakfast", { date: today, meal: "breakfast", name: "燕麦", calories: 330, protein: 10, carbs: 51, fat: 7 });
    const snapshot = await todayPanel();
    assert.equal(snapshot.active.id, "draft");
    assert.equal(snapshot.completed, 0);
    assert.equal(snapshot.nutrition.calories, 330);
    assert.equal(snapshot.weight, 77.4);
    assert.equal((await call("/api/web/records/workout/draft")).status, 200);
    assert.equal((await call("/api/web/records/workout/draft", { token: other.token })).status, 404);
  } finally { db.close(); }
});

test("上次组数参考使用真实历史，排除未来、进行中、热身和不同训练模式", async () => {
  const { db, call, save, other } = fixture();
  try {
    const date = shiftDay(localDate(), -1);
    const make = (label: string, day: string, time: string, weight: number) => ({
      title: label, date: day, startedAt: day + "T" + time + ":00Z", endedAt: day + "T" + time + ":05Z", status: "completed",
      exercises: [{ id: "row", exerciseId: "bench-press", restSeconds: 90, sets: [
        { id: "warm", type: "warmup", weight: 20, reps: 10, completed: true },
        { id: "work", type: "normal", weight, reps: 8, completed: true },
        { id: "remain", type: "normal", weight: 100, reps: 8, completed: false },
      ] }],
    });
    save("workout", "history", make("上次", date, "06:00", 52.5));
    save("workout", "late", make("之后", date, "20:00", 80));
    save("workout", "active", { ...make("进行中", date, "07:00", 65), endedAt: null, status: "active" });
    const route = "/api/web/exercise-references";
    const body = { date, startedAt: date + "T12:00:00Z", exercises: [{ id: "bench-press", mode: "reps" }] };
    const method = "POST";
    assert.deepEqual(await (await call(route, { method, body })).json(), [
      { id: "bench-press", date, sets: [null, { weight: 52.5, reps: 8, seconds: 0 }, null] },
    ]);
    assert.deepEqual(await (await call(route, { method, body: { ...body, exercises: [{ id: "bench-press", mode: "assisted" }] } })).json(), []);
    assert.deepEqual(await (await call(route, { method, body, token: other.token })).json(), []);
  } finally { db.close(); }
});

test("训练复盘从历史重算个人纪录，并区分计时、辅助和负重组", async () => {
  const { db, call, save, other } = fixture();
  try {
    const date = shiftDay(localDate(), -1);
    const row = (id: string, exerciseId: string, mode: string, sets: { weight: number; reps: number; seconds?: number; type?: string; completed?: boolean }[]) => ({
      id, exerciseId, restSeconds: 60,
      snapshot: { name: exerciseId, muscle: "chest", equipment: "barbell", mode, volumeMultiplier: 1 },
      sets: sets.map((set, i) => ({ id: id + "_" + i, type: "normal", completed: true, ...set })),
    });
    const workout = (day: string, exercises: ReturnType<typeof row>[]) => ({
      date: day, title: "复盘测试", startedAt: day + "T05:00:00Z", endedAt: day + "T05:43:00Z",
      status: "completed", feeling: "balanced", exercises,
    });
    const original = workout(shiftDay(date, -1), [
      row("bench", "bench-press", "reps", [{ weight: 60, reps: 8 },
        { weight: 150, reps: 8, type: "warmup" }]),
      row("plank", "plank", "timed", [{ weight: 0, reps: 0, seconds: 30 }]),
      row("pull", "pull-up", "assisted", [{ weight: 20, reps: 8 }]),
    ]);
    save("workout", "previous_report", original);
    save("workout", "future_report", workout(shiftDay(date, 1), [
      row("bench", "bench-press", "reps", [{ weight: 100, reps: 9 }]),
    ]));
    save("workout", "selected_report", workout(date, [
      row("bench", "bench-press", "reps", [{ weight: 60, reps: 9 }, { weight: 200, reps: 4, completed: false }]),
      row("bench_extra", "bench-press", "reps", [{ weight: 62.5, reps: 4 }]),
      row("plank", "plank", "timed", [{ weight: 0, reps: 0, seconds: 45 }]),
      row("pull", "pull-up", "assisted", [{ weight: 10, reps: 6 }]),
    ]));
    const url = "/api/web/workout-report/selected_report";
    const response = await call(url);
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.sets, 4);
    assert.equal(result.duration, 2580);
    assert.equal(result.volume, 790);
    assert.equal(result.exercises[0].completed.length, 1);
    assert.deepEqual(result.records.map(({ improvements }: { improvements: unknown }) => improvements), [
      [{ metric: "weight", previous: 60, current: 62.5 }, { metric: "oneRepMax", previous: 76, current: 78 }],
      [{ metric: "hold", previous: 30, current: 45 }],
      [{ metric: "assistance", previous: 20, current: 10 }],
    ]);
    assert.equal((await call(url, { token: other.token })).status, 404);
    save("workout", "previous_report", workout(shiftDay(date, -1), [
      row("bench", "bench-press", "reps", [{ weight: 65, reps: 8 }]),
    ]), 1);
    assert.ok(!(await (await call(url)).json() as any).records.some(({ name }: { name: string }) => name === "bench-press"));
  } finally { db.close(); }
});
