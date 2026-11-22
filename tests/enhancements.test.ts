import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWorkoutAdaptation, exerciseCatalogue, localDate, type Workout } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { mountWebAssets } from "../packages/server/src/web-assets.js";
import { upsertDailyHealth } from "../packages/server/src/apple-health-daily.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";
import { getWebToday } from "../packages/server/src/web-training.js";

function fixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("enh-owner");
  const other = auth.login("enh-other");
  const call = (url: string, options: { token?: string; method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: "Bearer " + (options.token ?? owner.token),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  return { db, app, store, call, owner, other };
}

test("新接口未鉴权均返回 401", async () => {
  const { db, app } = fixture();
  try {
    const endpoints: Array<[string, string]> = [
      ["GET", "/api/web/exercise-notes"],
      ["PUT", "/api/web/exercise-notes/bench-press"],
      ["GET", "/api/web/exercise-history/bench-press"],
      ["GET", "/api/web/measurements"],
      ["PUT", "/api/web/measurements"],
      ["DELETE", "/api/web/measurements/2026-01-01"],
      ["POST", "/api/web/water"],
      ["GET", "/api/web/export-csv/workouts"],
    ];
    for (const [method, url] of endpoints) {
      assert.equal((await app.request(url, { method })).status, 401, `${method} ${url}`);
    }
  } finally {
    db.close();
  }
});

test("递减组 (drop) 与超级组 (supersetGroup) 可保存并在复盘接口正确统计", async () => {
  const { db, call } = fixture();
  try {
    const date = shiftDay(localDate(), -1);
    const saveRes = await call("/api/records", {
      method: "POST",
      body: {
        opId: "drop-ss-op-1",
        id: "w-drop-ss",
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: {
          title: "推拉超级组",
          date,
          startedAt: `${date}T09:00:00Z`,
          endedAt: `${date}T09:50:00Z`,
          status: "completed",
          exercises: [
            {
              id: "ex-row-1",
              exerciseId: "bench-press",
              supersetGroup: "A",
              restSeconds: 90,
              sets: [
                { id: "s1", type: "warmup", weight: 40, reps: 10, seconds: 0, completed: true, rir: null },
                { id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 },
                { id: "s3", type: "drop", weight: 60, reps: 10, seconds: 0, completed: true, rir: 0 },
              ],
            },
            {
              id: "ex-row-2",
              exerciseId: "barbell-row",
              supersetGroup: "A",
              restSeconds: 90,
              sets: [
                { id: "s4", type: "normal", weight: 70, reps: 10, seconds: 0, completed: true, rir: 2 },
              ],
            },
          ],
        },
      },
    });
    assert.equal(saveRes.status, 200);

    const reportRes = await call("/api/web/workout-report/w-drop-ss");
    assert.equal(reportRes.status, 200);
    const report = (await reportRes.json()) as {
      sets: number;
      volume: number;
      exercises: Array<{ exerciseId: string; supersetGroup: string | null }>;
    };
    // 80*8 (640) + 60*10 drop (600) + 70*10 (700) = 1940 kg, 3 valid work sets (warmup excluded)
    assert.equal(report.sets, 3);
    assert.equal(report.volume, 1940);
    assert.deepEqual(
      report.exercises.map((e) => [e.exerciseId, e.supersetGroup]),
      [["bench-press", "A"], ["barbell-row", "A"]],
    );
  } finally {
    db.close();
  }
});

test("动作技术备忘录 CRUD、清空删除、动作历史统计与账号隔离", async () => {
  const { db, call, store, owner, other } = fixture();
  try {
    // Save note
    const put1 = await call("/api/web/exercise-notes/bench-press", {
      method: "PUT",
      body: { note: "肩胛下沉收紧，落杠至下胸线" },
    });
    assert.equal(put1.status, 200);
    const put1Data = (await put1.json()) as { exerciseId: string; note: string };
    assert.equal(put1Data.note, "肩胛下沉收紧，落杠至下胸线");

    // List notes (owner vs other)
    const ownerNotes = (await (await call("/api/web/exercise-notes")).json()) as Record<string, { note: string }>;
    assert.equal(ownerNotes["bench-press"]?.note, "肩胛下沉收紧，落杠至下胸线");
    const otherNotes = (await (await call("/api/web/exercise-notes", { token: other.token })).json()) as Record<string, unknown>;
    assert.deepEqual(otherNotes, {});

    // Populate two completed sessions to check exercise history order and metrics
    const d1 = shiftDay(localDate(), -7);
    const d2 = shiftDay(localDate(), -2);
    store.mutate(owner.userId, {
      opId: "hist-1",
      id: "w-hist-1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "胸日 1",
        date: d1,
        startedAt: `${d1}T08:00:00Z`,
        endedAt: `${d1}T08:50:00Z`,
        status: "completed",
        exercises: [
          {
            id: "r1",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [{ id: "r1s1", type: "normal", weight: 80, reps: 5, seconds: 0, completed: true, rir: 1 }],
          },
        ],
      },
    });
    store.mutate(owner.userId, {
      opId: "hist-2",
      id: "w-hist-2",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "胸日 2",
        date: d2,
        startedAt: `${d2}T08:00:00Z`,
        endedAt: `${d2}T08:50:00Z`,
        status: "completed",
        exercises: [
          {
            id: "r2",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [
              { id: "r2s1", type: "warmup", weight: 40, reps: 10, seconds: 0, completed: true, rir: null },
              { id: "r2s2", type: "normal", weight: 90, reps: 5, seconds: 0, completed: true, rir: null },
            ],
          },
        ],
      },
    });

    const histRes = await call("/api/web/exercise-history/bench-press");
    assert.equal(histRes.status, 200);
    const hist = (await histRes.json()) as {
      exerciseId: string;
      note: string;
      sessions: Array<{ date: string; topWeight: number; topReps: number; estimated1rm: number; volume: number }>;
    };
    assert.equal(hist.note, "肩胛下沉收紧，落杠至下胸线");
    assert.equal(hist.sessions.length, 2);
    assert.equal(hist.sessions[0]!.date, d2);
    assert.equal(hist.sessions[0]!.topWeight, 90);
    assert.equal(hist.sessions[0]!.volume, 450);
    assert.equal(hist.sessions[0]!.estimated1rm, 105);

    const otherHist = (await (await call("/api/web/exercise-history/bench-press", { token: other.token })).json()) as {
      sessions: unknown[];
      note: string;
    };
    assert.equal(otherHist.sessions.length, 0);
    assert.equal(otherHist.note, "");

    // Clear note removes row cleanly
    const clearRes = await call("/api/web/exercise-notes/bench-press", {
      method: "PUT",
      body: { note: "   " },
    });
    assert.equal(clearRes.status, 200);
    assert.deepEqual(await (await call("/api/web/exercise-notes")).json(), {});
  } finally {
    db.close();
  }
});

test("身体围度档案校验、增删改查与账号隔离", async () => {
  const { db, call, other } = fixture();
  try {
    // Reject empty measurement record
    const invalid = await call("/api/web/measurements", {
      method: "PUT",
      body: { date: "2026-10-01", notes: "仅备注不行" },
    });
    assert.equal(invalid.status, 400);

    const m1 = await call("/api/web/measurements", {
      method: "PUT",
      body: { date: "2026-10-01", waistCm: 80.54, chestCm: 102.3, armCm: 36.2, notes: "晨起空腹" },
    });
    assert.equal(m1.status, 200);
    const m2 = await call("/api/web/measurements", {
      method: "PUT",
      body: { date: "2026-10-15", waistCm: 79.1, chestCm: 103.0 },
    });
    assert.equal(m2.status, 200);

    const listRes = await call("/api/web/measurements");
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as Array<{ date: string; waistCm: number | null }>;
    assert.equal(list.length, 2);
    assert.equal(list[0]!.date, "2026-10-15");
    assert.equal(list[1]!.waistCm, 80.5);

    const otherList = (await (await call("/api/web/measurements", { token: other.token })).json()) as unknown[];
    assert.equal(otherList.length, 0);

    const del = await call("/api/web/measurements/2026-10-01", { method: "DELETE" });
    assert.equal(del.status, 200);
    const afterDel = (await (await call("/api/web/measurements")).json()) as Array<{ date: string }>;
    assert.deepEqual(afterDel.map((r) => r.date), ["2026-10-15"]);
  } finally {
    db.close();
  }
});

test("快捷饮水打卡累加、保留同日 Apple 健康指标、范围钳制与隔离", async () => {
  const { db, store, call, owner, other } = fixture();
  try {
    const date = localDate();
    upsertDailyHealth(store, owner.userId, {
      date,
      source: "shortcut",
      steps: 8500,
      sleepMinutes: 430,
    });

    const add1 = await call("/api/web/water", {
      method: "POST",
      body: { date, deltaMl: 250 },
    });
    assert.equal(add1.status, 200);
    assert.equal(((await add1.json()) as { waterMl: number }).waterMl, 250);

    const add2 = await call("/api/web/water", {
      method: "POST",
      body: { date, deltaMl: 500 },
    });
    assert.equal(add2.status, 200);
    assert.equal(((await add2.json()) as { waterMl: number }).waterMl, 750);

    // Check today's snapshot preserves steps and sleepMinutes
    const todayData = getWebToday(store, owner.userId, date);
    assert.equal(todayData.waterMl, 750);
    assert.equal(todayData.appleDaily?.steps, 8500);
    assert.equal(todayData.appleDaily?.sleepMinutes, 430);

    // Clamps to [0, 15000]
    const over = await call("/api/web/water", {
      method: "POST",
      body: { date, deltaMl: 20000 },
    });
    assert.equal(over.status, 400);

    const reset = await call("/api/web/water", {
      method: "POST",
      body: { date, setMl: 0 },
    });
    assert.equal(reset.status, 200);
    assert.equal(((await reset.json()) as { waterMl: number }).waterMl, 0);

    // Other user remains isolated
    assert.equal(getWebToday(store, other.userId, date).waterMl, 0);
  } finally {
    db.close();
  }
});

test("UTF-8 BOM CSV 导出包含正确表头、内容转义与数据", async () => {
  const { db, store, call, owner } = fixture();
  try {
    const date = shiftDay(localDate(), -1);
    store.mutate(owner.userId, {
      opId: "csv-w1",
      id: "w-csv-1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "推力日, 重训",
        date,
        startedAt: `${date}T08:00:00Z`,
        endedAt: `${date}T09:00:00Z`,
        status: "completed",
        feeling: "balanced",
        exercises: [
          {
            id: "ex-1",
            exerciseId: "bench-press",
            supersetGroup: "B",
            restSeconds: 90,
            sets: [{ id: "s-1", type: "drop", weight: 80, reps: 6, seconds: 0, completed: true, rir: 1 }],
          },
        ],
      },
    });
    store.mutate(owner.userId, {
      opId: "csv-d1",
      id: "d-csv-1",
      kind: "diet",
      baseVersion: 0,
      deleted: false,
      data: {
        date,
        meal: "lunch",
        name: "鸡胸肉 \"特制\"",
        calories: 320,
        protein: 42,
        carbs: 10,
        fat: 6,
      },
    });
    store.mutate(owner.userId, {
      opId: "csv-wt1",
      id: `weight_${date}`,
      kind: "weight",
      baseVersion: 0,
      deleted: false,
      data: { date, weight: 74.2, bodyFat: 15.8 },
    });
    await call("/api/web/measurements", {
      method: "PUT",
      body: { date, waistCm: 78.4, armCm: 37.2, notes: "=SUM(A1:A2)" },
    });

    const wRes = await call("/api/web/export-csv/workouts");
    assert.equal(wRes.status, 200);
    assert.match(wRes.headers.get("Content-Type") ?? "", /text\/csv/);
    const wBuf = new Uint8Array(await wRes.arrayBuffer());
    assert.deepEqual([...wBuf.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const wText = new TextDecoder("utf-8", { ignoreBOM: true }).decode(wBuf);
    assert.equal(wText.startsWith("\uFEFF"), true);
    assert.match(wText, /日期,训练标题,时长\(分钟\),体感,动作,超级组/);
    assert.match(wText, /"推力日, 重训".*,B,1,递减,80,6/);

    const dBuf = new Uint8Array(await (await call("/api/web/export-csv/diet")).arrayBuffer());
    assert.deepEqual([...dBuf.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const dText = Buffer.from(dBuf).toString("utf8");
    assert.match(dText, /"鸡胸肉 ""特制"""/);

    const wtText = await (await call("/api/web/export-csv/weight")).text();
    assert.match(wtText, /74\.2,15\.8/);

    const mText = await (await call("/api/web/export-csv/measurements")).text();
    assert.match(mText, /78\.4,,37\.2/);
    assert.match(mText, /'=SUM\(A1:A2\)/);
  } finally {
    db.close();
  }
});

test("训前状态提醒 (readinessHint) 在睡眠不足或短期负荷骤升时准确触发", async () => {
  const { db, store, owner } = fixture();
  try {
    const today = localDate();
    // Baseline: normal healthy state -> null
    assert.equal(getWebToday(store, owner.userId, today).readinessHint, null);

    // Recent short sleep (< 5.5h) triggers warn readinessHint
    upsertDailyHealth(store, owner.userId, {
      date: today,
      source: "shortcut",
      sleepMinutes: 300,
    });
    const lowSleepToday = getWebToday(store, owner.userId, today);
    assert.ok(lowSleepToday.readinessHint);
    assert.equal(lowSleepToday.readinessHint.tone, "warn");
    assert.equal(lowSleepToday.readinessHint.suggestedScale, 0.9);
    assert.match(lowSleepToday.readinessHint.detail, /最近睡眠仅 5小时/);

    // Healthy sleep + high 7d vs 28d ACWR (>1.55)
    upsertDailyHealth(store, owner.userId, {
      date: today,
      source: "shortcut",
      sleepMinutes: 460,
    });
    // Seed 3 small workouts in weeks 2-4, plus 2 heavy workouts this week
    for (const [idx, offset, wt] of [
      [1, -24, 50],
      [2, -18, 50],
      [3, -12, 50],
      [4, -3, 180],
      [5, -1, 180],
    ] as const) {
      const d = shiftDay(today, offset);
      store.mutate(owner.userId, {
        opId: `acwr-${idx}`,
        id: `w-acwr-${idx}`,
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: {
          title: `负荷 ${idx}`,
          date: d,
          startedAt: `${d}T09:00:00Z`,
          endedAt: `${d}T09:40:00Z`,
          status: "completed",
          exercises: [
            {
              id: `e-${idx}`,
              exerciseId: "bench-press",
              restSeconds: 90,
              sets: [{ id: `s-${idx}`, type: "normal", weight: wt, reps: 10, seconds: 0, completed: true, rir: null }],
            },
          ],
        },
      });
    }
    const spikeToday = getWebToday(store, owner.userId, today);
    assert.ok(spikeToday.readinessHint);
    assert.equal(spikeToday.readinessHint.tone, "warn");
    assert.match(spikeToday.readinessHint.detail, /近7日容量较4周均值/);
  } finally {
    db.close();
  }
});

test("网页资源 CSP 允许生成战报图的 data/blob 图片预览", async () => {
  const { db, app } = fixture();
  try {
    mountWebAssets(app);
    const res = await app.request("/app/");
    assert.equal(res.status, 200);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    assert.match(csp, /img-src[^;]*'self'/);
    assert.match(csp, /img-src[^;]*blob:/);
    assert.match(csp, /img-src[^;]*data:/);
  } finally {
    db.close();
  }
});

test("饮水更新保留 Apple 健康内部回填指纹且拒绝未来日期", async () => {
  const { db, store, call, owner } = fixture();
  try {
    const today = localDate();
    const tomorrow = shiftDay(today, 1);

    // Seed daily health with weightKg so syncedWeightValue is recorded internally
    upsertDailyHealth(store, owner.userId, {
      date: today,
      source: "shortcut",
      weightKg: 75.2,
      bodyFatPct: 16.4,
    });
    const rawBefore = db
      .prepare("SELECT data FROM apple_health_daily WHERE user_id=? AND date=?")
      .get(owner.userId, today) as { data: string };
    const beforeParsed = JSON.parse(rawBefore.data) as { syncedWeightValue?: number; syncedBodyFatValue?: number };
    assert.equal(beforeParsed.syncedWeightValue, 75.2);
    assert.equal(beforeParsed.syncedBodyFatValue, 16.4);

    // Log +250ml water -> internal metadata MUST remain intact
    const waterRes = await call("/api/web/water", {
      method: "POST",
      body: { date: today, deltaMl: 250 },
    });
    assert.equal(waterRes.status, 200);

    const rawAfter = db
      .prepare("SELECT data FROM apple_health_daily WHERE user_id=? AND date=?")
      .get(owner.userId, today) as { data: string };
    const afterParsed = JSON.parse(rawAfter.data) as {
      waterMl?: number;
      syncedWeightValue?: number;
      syncedBodyFatValue?: number;
    };
    assert.equal(afterParsed.waterMl, 250);
    assert.equal(afterParsed.syncedWeightValue, 75.2);
    assert.equal(afterParsed.syncedBodyFatValue, 16.4);

    // Future dates rejected cleanly
    assert.equal(
      (await call("/api/web/water", { method: "POST", body: { date: tomorrow, deltaMl: 250 } })).status,
      400,
    );
    assert.equal(
      (await call("/api/web/measurements", { method: "PUT", body: { date: tomorrow, waistCm: 79 } })).status,
      400,
    );
  } finally {
    db.close();
  }
});

test("全量导出 /api/export 包含技术备忘、围度与去敏 Apple 每日数据并隔离账号", async () => {
  const { db, store, call, owner, other } = fixture();
  try {
    const today = localDate();
    await call("/api/web/exercise-notes/bench-press", { method: "PUT", body: { note: "稳住肩胛" } });
    await call("/api/web/measurements", { method: "PUT", body: { date: today, waistCm: 77.5, armCm: 36.8 } });
    upsertDailyHealth(store, owner.userId, { date: today, source: "shortcut", weightKg: 74.1, steps: 6000 });

    const expRes = await call("/api/export");
    assert.equal(expRes.status, 200);
    const exp = (await expRes.json()) as {
      exerciseNotes: Array<{ exerciseId: string; note: string }>;
      bodyMeasurements: Array<{ date: string; waistCm: number | null; armCm: number | null }>;
      appleHealthDaily: Array<Record<string, unknown>>;
    };
    assert.equal(exp.exerciseNotes.length, 1);
    assert.equal(exp.exerciseNotes[0]!.note, "稳住肩胛");
    assert.equal(exp.bodyMeasurements.length, 1);
    assert.equal(exp.bodyMeasurements[0]!.waistCm, 77.5);
    assert.equal(exp.appleHealthDaily.length, 1);
    assert.equal(exp.appleHealthDaily[0]!.steps, 6000);
    assert.equal("syncedWeightValue" in exp.appleHealthDaily[0]!, false);

    // Cross-user isolation on export
    const otherExp = (await (await call("/api/export", { token: other.token })).json()) as typeof exp;
    assert.equal(otherExp.exerciseNotes.length, 0);
    assert.equal(otherExp.bodyMeasurements.length, 0);
    assert.equal(otherExp.appleHealthDaily.length, 0);
  } finally {
    db.close();
  }
});

test("超过两天的陈旧低睡眠不误触发今日减载提醒，前导空白公式注水被拦截", async () => {
  const { db, store, call, owner } = fixture();
  try {
    const today = localDate();
    const staleDate = shiftDay(today, -6);

    // 6-day-old poor sleep -> should NOT trigger readinessHint today
    upsertDailyHealth(store, owner.userId, {
      date: staleDate,
      source: "shortcut",
      sleepMinutes: 240,
      restingHeartRateBpm: 95,
      hrvMs: 14,
    });
    assert.equal(getWebToday(store, owner.userId, today).readinessHint, null);

    // CSV formula neutralization with leading spaces (bypassing schema trim via raw DB row)
    await call("/api/web/measurements", {
      method: "PUT",
      body: { date: today, waistCm: 80, notes: "=HYPERLINK(\"http://bad\")" },
    });
    db.prepare("UPDATE body_measurements SET notes=? WHERE user_id=? AND date=?").run(
      "  =HYPERLINK(\"http://bad\")",
      owner.userId,
      today,
    );
    const mCsv = await (await call("/api/web/export-csv/measurements")).text();
    assert.match(mCsv, /'  =HYPERLINK/);
  } finally {
    db.close();
  }
});

test("AI 训中替换部分完成动作时保留超级组标记 (supersetGroup)", () => {
  const today = localDate();
  const replacement = exerciseCatalogue.find((e) => e.mode === "reps" && e.id !== "bench-press")!;
  const workout: Workout = {
    title: "超级组测试",
    date: today,
    startedAt: `${today}T08:00:00Z`,
    endedAt: null,
    status: "active",
    notes: "",
    feeling: null,
    source: "manual",
    rawPrompt: "",
    planId: null,
    planVersion: null,
    routineId: null,
    targetSnapshot: null,
    restEndsAt: null,
    adjustments: [],
    exercises: [
      {
        id: "row-1",
        exerciseId: "bench-press",
        supersetGroup: "A",
        restSeconds: 90,
        snapshot: null,
        sets: [
          { id: "s1", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: null },
          { id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: false, rir: null },
        ],
      },
    ],
  };
  let seq = 0;
  const adapted = applyWorkoutAdaptation(
    workout,
    {
      id: "adapt-1",
      workoutId: "w-1",
      baseVersion: 1,
      createdAt: `${today}T08:10:00Z`,
      summary: "换为替代动作",
      source: "ai",
      changes: [
        {
          exerciseRowId: "row-1",
          reason: "右肩微紧",
          patch: { exerciseId: replacement.id, weight: 30, reps: 10 },
          before: {
            exerciseId: "bench-press",
            restSeconds: 90,
            openSets: [{ id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: false, rir: null }],
          },
        },
      ],
    },
    ["row-1"],
    exerciseCatalogue,
    () => `gen-${++seq}`,
  );
  assert.equal(adapted.exercises.length, 2);
  assert.equal(adapted.exercises[0]!.supersetGroup, "A");
  assert.equal(adapted.exercises[1]!.exerciseId, replacement.id);
  assert.equal(adapted.exercises[1]!.supersetGroup, "A");
});

test("训练复盘接口返回肌群有效组数分布 (1.0+0.5) 与同日/同计划历史容量对比", async () => {
  const { db, store, call, owner } = fixture();
  try {
    const today = localDate();
    const d1 = shiftDay(today, -5);
    const d2 = shiftDay(today, -1);

    // Older matching workout: bench-press (3 sets * 80 * 10 = 2400 kg)
    store.mutate(owner.userId, {
      opId: "rep-prev",
      id: "w-rep-prev",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "上肢推力",
        date: d1,
        startedAt: `${d1}T08:00:00Z`,
        endedAt: `${d1}T08:45:00Z`,
        status: "completed",
        exercises: [
          {
            id: "rp-1",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [
              { id: "rps1", type: "normal", weight: 80, reps: 10, seconds: 0, completed: true, rir: null },
              { id: "rps2", type: "normal", weight: 80, reps: 10, seconds: 0, completed: true, rir: null },
              { id: "rps3", type: "normal", weight: 80, reps: 10, seconds: 0, completed: true, rir: null },
            ],
          },
        ],
      },
    });

    // Current workout: 1 warmup (excluded from work sets & muscleSets) + 4 work sets * 90 * 10 = 3600 kg
    store.mutate(owner.userId, {
      opId: "rep-now",
      id: "w-rep-now",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "上肢推力",
        date: d2,
        startedAt: `${d2}T08:00:00Z`,
        endedAt: `${d2}T08:50:00Z`,
        status: "completed",
        exercises: [
          {
            id: "rn-1",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [
              { id: "rns0", type: "warmup", weight: 40, reps: 10, seconds: 0, completed: true, rir: null },
              { id: "rns1", type: "normal", weight: 90, reps: 10, seconds: 0, completed: true, rir: null },
              { id: "rns2", type: "normal", weight: 90, reps: 10, seconds: 0, completed: true, rir: null },
              { id: "rns3", type: "normal", weight: 90, reps: 10, seconds: 0, completed: true, rir: null },
              { id: "rns4", type: "drop", weight: 90, reps: 10, seconds: 0, completed: true, rir: null },
            ],
          },
        ],
      },
    });

    const firstRep = (await (await call("/api/web/workout-report/w-rep-prev")).json()) as {
      previousComparison: unknown;
      muscleSets: Array<{ key: string; sets: number }>;
    };
    assert.equal(firstRep.previousComparison, null);
    assert.equal(firstRep.muscleSets.find((m) => m.key === "chest")?.sets, 3);

    const benchMeta = exerciseCatalogue.find((e) => e.id === "bench-press")!;
    const secondRep = (await (await call("/api/web/workout-report/w-rep-now")).json()) as {
      previousComparison: { workoutId: string; date: string; volumeDelta: number; volumePct: number; setsDelta: number } | null;
      muscleSets: Array<{ key: string; sets: number }>;
    };
    assert.ok(secondRep.previousComparison);
    assert.equal(secondRep.previousComparison.workoutId, "w-rep-prev");
    assert.equal(secondRep.previousComparison.date, d1);
    assert.equal(secondRep.previousComparison.volumeDelta, 1200);
    assert.equal(secondRep.previousComparison.volumePct, 50);
    assert.equal(secondRep.previousComparison.setsDelta, 1);
    assert.equal(secondRep.muscleSets.find((m) => m.key === "chest")?.sets, 4);
    for (const sec of benchMeta.secondaryMuscles ?? []) {
      if (sec !== "chest") {
        assert.equal(secondRep.muscleSets.find((m) => m.key === sec)?.sets, 2);
      }
    }
  } finally {
    db.close();
  }
});
