import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeWorkoutToFit,
  localDate,
  nutritionDayComplete,
  nutritionFingerprint,
  type Workout,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import { buildWebCsv, getExerciseHistory } from "../packages/server/src/web-extras.js";
import { commitWorkoutCsvImport, previewWorkoutCsvImport } from "../packages/server/src/web-import.js";
import { getWebWorkoutReport } from "../packages/server/src/web-workout-report.js";
import {
  clearFailedMutationsByIds,
  enqueueMutation,
  readQueue,
} from "../packages/web/src/lib/offline-queue.js";
import { buildWorkoutSeedFromRoutine } from "../packages/web/src/lib/routine-launch.js";

function makeMemoryStorage(opts: { throwOnWrite?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    getItem(k: string) {
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k: string, v: string) {
      if (opts.throwOnWrite) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem(k: string) {
      if (opts.throwOnWrite) throw new Error("SecurityError");
      map.delete(k);
    },
  };
}

function decodeFitSessionSummary(bytes: Uint8Array) {
  const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataSize = view.getUint32(4, true);
  let pos = 14;
  const end = 14 + dataSize;
  const defs = new Map<
    number,
    { globalMsg: number; fields: Array<{ num: number; size: number }>; devFields: Array<{ num: number; size: number }> }
  >();
  let session: {
    endMs?: number;
    startMs?: number;
    elapsedSec?: number;
    timerSec?: number;
    sport?: number;
    subSport?: number;
    distanceMeters?: number;
    devVolumeKg?: number;
  } | null = null;

  while (pos < end) {
    const hdr = bytes[pos++]!;
    const isDef = (hdr & 0x40) !== 0;
    const hasDev = (hdr & 0x20) !== 0;
    const localNum = hdr & 0x0f;
    if (isDef) {
      pos += 2; // reserved + arch
      const globalMsg = view.getUint16(pos, true);
      pos += 2;
      const fieldCount = bytes[pos++]!;
      const fields: Array<{ num: number; size: number }> = [];
      for (let i = 0; i < fieldCount; i++) {
        fields.push({ num: bytes[pos]!, size: bytes[pos + 1]! });
        pos += 3;
      }
      const devFields: Array<{ num: number; size: number }> = [];
      if (hasDev) {
        const devCount = bytes[pos++]!;
        for (let i = 0; i < devCount; i++) {
          devFields.push({ num: bytes[pos]!, size: bytes[pos + 1]! });
          pos += 3;
        }
      }
      defs.set(localNum, { globalMsg, fields, devFields });
    } else {
      const def = defs.get(localNum);
      assert.ok(def, `unknown local msg ${localNum}`);
      const isSession = def.globalMsg === 18;
      const out: NonNullable<typeof session> = {};
      for (const f of def.fields) {
        if (isSession) {
          if (f.num === 253 && f.size === 4) out.endMs = FIT_EPOCH_MS + view.getUint32(pos, true) * 1000;
          if (f.num === 2 && f.size === 4) out.startMs = FIT_EPOCH_MS + view.getUint32(pos, true) * 1000;
          if (f.num === 7 && f.size === 4) out.elapsedSec = view.getUint32(pos, true) / 1000;
          if (f.num === 8 && f.size === 4) out.timerSec = view.getUint32(pos, true) / 1000;
          if (f.num === 5 && f.size === 1) out.sport = bytes[pos]!;
          if (f.num === 6 && f.size === 1) out.subSport = bytes[pos]!;
          if (f.num === 9 && f.size === 4) out.distanceMeters = view.getUint32(pos, true) / 100;
        }
        pos += f.size;
      }
      for (const df of def.devFields) {
        if (isSession && df.num === 0 && df.size === 4) {
          out.devVolumeKg = view.getUint32(pos, true) / 10;
        }
        pos += df.size;
      }
      if (isSession) session = out;
    }
  }
  return session;
}

test("R22 (#223-#227): backup replace stateToken guard, activePlan deactivation warning, stats prefs roundtrip, Apple weight timestamp merge & auxiliary counts", async () => {
  const { app, store, auth } = createApp(openDatabase(":memory:"));
  const src = auth.login("r22-src");
  const dst = auth.login("r22-dst");
  const day = "2026-11-26";

  const call = (path: string, token: string, init?: { method?: string; body?: unknown }) =>
    app.request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  // #225: Save custom statistics preferences on src
  const prefRes = await call("/api/web/preferences", src.token, {
    method: "PUT",
    body: {
      revision: 0,
      days: 90,
      includeWarmups: true,
      panels: ["weight", "load", "muscle", "consistency", "strength", "nutrition", "apple", "feeling"],
    },
  });
  assert.equal(prefRes.status, 200);

  // #224: Save plan draft, export BEFORE activation, then activate plan
  const draftRes = await call("/api/plans/drafts", src.token, {
    method: "POST",
    body: {
      name: "上肢下肢甲",
      weeks: 6,
      schedule: "rotation",
      weekdays: [],
      rationale: "test",
      source: "manual",
      routines: [
        {
          id: "r1",
          name: "上肢日",
          exercises: [
            {
              exerciseId: "bench-press",
              sets: 3,
              repsMin: 6,
              repsMax: 10,
              weight: 60,
              seconds: 0,
              restSeconds: 90,
              targetRir: 2,
              progression: "double",
              increment: 2.5,
            },
          ],
        },
      ],
    },
  });
  assert.equal(draftRes.status, 201);
  const draftJson = (await draftRes.json()) as { record: { id: string; version: number } };
  const backupBeforeActivation = store.export(src.userId);
  assert.ok(backupBeforeActivation.statisticsPreferences);
  assert.equal((backupBeforeActivation.statisticsPreferences as { days: number }).days, 90);

  // Now activate the plan on src
  const applyRes = await call("/api/plans/apply", src.token, {
    method: "POST",
    body: { id: draftJson.record.id, version: draftJson.record.version, expectedRevision: 0 },
  });
  assert.equal(applyRes.status, 200);

  // #224: Replace preview using backupBeforeActivation must flag activePlan deactivation
  const prev224 = store.restoreBackup(src.userId, backupBeforeActivation, {
    mode: "preview",
    strategy: "replace",
  }) as {
    activePlanChange?: { action: string };
    diff: { toDelete: number; deletions: { activePlan?: number } };
    stateToken?: string;
  };
  assert.equal(prev224.activePlanChange?.action, "deactivate");
  assert.equal(prev224.diff.deletions.activePlan, 1);
  assert.ok(prev224.diff.toDelete >= 1);

  // #223 (P1): Empty replace preview on dst -> diet created between preview & commit -> commit MUST return 409!
  const emptyBackup = store.export(dst.userId);
  const prev223 = store.restoreBackup(dst.userId, emptyBackup, {
    mode: "preview",
    strategy: "replace",
  }) as { stateToken: string; diff: { toDelete: number } };
  assert.equal(prev223.diff.toDelete, 0);
  assert.ok(prev223.stateToken);

  store.mutate(dst.userId, {
    opId: "diet_after_preview_223",
    id: "diet_223",
    kind: "diet",
    baseVersion: 0,
    deleted: false,
    data: { date: day, meal: "lunch", name: "新记录鸡胸", calories: 420, protein: 45, carbs: 30, fat: 8, source: "manual", rawPrompt: "" },
  });

  assert.throws(
    () =>
      store.restoreBackup(dst.userId, emptyBackup, {
        mode: "commit",
        strategy: "replace",
        opId: "restore_223_commit",
        expectedStateToken: prev223.stateToken,
      }),
    /发生变化/,
  );
  // Diet record was NOT wiped!
  assert.equal(store.list(dst.userId, "diet").length, 1);

  // #225: Merging src backup into dst restores statisticsPreferences (90 days, includeWarmups: true)
  store.restoreBackup(dst.userId, backupBeforeActivation, { mode: "commit", strategy: "merge" });
  const dstPrefRes = await call("/api/web/preferences", dst.token);
  const dstPref = (await dstPrefRes.json()) as { days: number; includeWarmups: boolean; panels: string[] };
  assert.equal(dstPref.days, 90);
  assert.equal(dstPref.includeWarmups, true);
  assert.equal(dstPref.panels[0], "weight");

  // #226: Merge backup with older Apple weight (07:00 72 kg) + later row updatedAt must NOT overwrite target's newer same-day Apple weight (09:00 75 kg)
  const dailyUserA = auth.login("r22-daily-a");
  const dailyUserB = auth.login("r22-daily-b");
  store.db
    .prepare("INSERT INTO apple_health_daily VALUES (?, ?, ?, ?)")
    .run(
      dailyUserA.userId,
      day,
      "2026-11-26T12:00:00Z", // newer row updatedAt due to later resting HR sync
      JSON.stringify({
        date: day,
        weightKg: 72,
        weightDate: day,
        weightMeasuredAt: "2026-11-26T07:00:00+08:00",
        restingHeartRateBpm: 56,
      }),
    );
  store.db
    .prepare("INSERT INTO apple_health_daily VALUES (?, ?, ?, ?)")
    .run(
      dailyUserB.userId,
      day,
      "2026-11-26T09:05:00Z", // older row updatedAt, but NEWER weight measurement!
      JSON.stringify({
        date: day,
        weightKg: 75,
        weightDate: day,
        weightMeasuredAt: "2026-11-26T09:00:00+08:00",
      }),
    );
  const backupA = store.export(dailyUserA.userId);
  store.restoreBackup(dailyUserB.userId, backupA, { mode: "commit", strategy: "merge" });
  const mergedRow = store.db
    .prepare("SELECT data FROM apple_health_daily WHERE user_id = ? AND date = ?")
    .get(dailyUserB.userId, day) as { data: string };
  const mergedData = JSON.parse(mergedRow.data) as { weightKg: number; restingHeartRateBpm?: number };
  assert.equal(mergedData.weightKg, 75, "Newer 09:00 75 kg must NOT be overwritten by older 07:00 72 kg");
  assert.equal(mergedData.restingHeartRateBpm, 56, "Newer resting HR from source should still merge");

  // #227: Auxiliary-only backup (1 measurement + 1 note + 1 Apple daily) reports toImport = 3 and imported = 3
  const auxSrc = auth.login("r22-aux-src");
  const auxDst = auth.login("r22-aux-dst");
  store.db.prepare("INSERT INTO body_measurements VALUES (?, ?, ?, NULL, NULL, NULL, NULL, '', ?)").run(auxSrc.userId, day, 86, "2026-11-26T08:00:00Z");
  store.db.prepare("INSERT INTO exercise_notes VALUES (?, ?, ?, ?)").run(auxSrc.userId, "bench-press", "收紧肩胛", "2026-11-26T08:00:00Z");
  store.db.prepare("INSERT INTO apple_health_daily VALUES (?, ?, ?, ?)").run(auxSrc.userId, day, "2026-11-26T08:00:00Z", JSON.stringify({ date: day, steps: 9000 }));
  const auxBackup = store.export(auxSrc.userId);
  const auxPrev = store.restoreBackup(auxDst.userId, auxBackup, { mode: "preview", strategy: "merge" }) as { diff: { toImport: number } };
  assert.equal(auxPrev.diff.toImport, 3);
  const auxCommit = store.restoreBackup(auxDst.userId, auxBackup, { mode: "commit", strategy: "merge" }) as { imported: number };
  assert.equal(auxCommit.imported, 3);
});

test("R23 & R28 (#230, #231, #236, #237, #269, #270): report comparability, unified 1RM, and FIT accuracy", () => {
  const { store, auth } = createApp(openDatabase(":memory:"));
  const user = auth.login("r23-user");

  // #230: Free workout "自由训练" with squats vs free workout "自由训练" with bench press must NOT compare
  store.mutate(user.userId, {
    opId: "wo_sq_230",
    id: "wo_sq_230",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "自由训练",
      date: "2026-11-20",
      startedAt: "2026-11-20T10:00:00+08:00",
      endedAt: "2026-11-20T10:45:00+08:00",
      status: "completed",
      exercises: [
        {
          id: "ex_sq",
          exerciseId: "squat",
          restSeconds: 120,
          sets: [{ id: "s_sq1", type: "normal", weight: 100, reps: 6, seconds: 0, completed: true, rir: 0 }],
        },
      ],
    },
  });
  store.mutate(user.userId, {
    opId: "wo_bp_base",
    id: "wo_bp_base",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "推举测试",
      date: "2026-11-21",
      startedAt: "2026-11-21T10:00:00+08:00",
      endedAt: "2026-11-21T10:40:00+08:00",
      status: "completed",
      exercises: [
        {
          id: "ex_bp0",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: "s_bp0", type: "normal", weight: 70, reps: 8, seconds: 0, completed: true, rir: 0 }],
        },
      ],
    },
  });
  store.mutate(user.userId, {
    opId: "wo_bp_230",
    id: "wo_bp_230",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "自由训练",
      date: "2026-11-22",
      startedAt: "2026-11-22T10:00:00+08:00",
      endedAt: "2026-11-22T10:45:00+08:00",
      status: "completed",
      exercises: [
        {
          id: "ex_bp1",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: "s_bp1", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 4 }],
        },
      ],
    },
  });

  const report = getWebWorkoutReport(store, user.userId, "wo_bp_230");
  assert.equal(report.previousComparison, null, "Unrelated squat 自由训练 must NOT be selected as previousComparison for bench 自由训练");
  assert.equal(report.startedAt, "2026-11-22T10:00:00+08:00");
  assert.equal(report.endedAt, "2026-11-22T10:45:00+08:00");

  // #231: Report 1RM and exercise history 1RM must match identically (80 kg x 8, RIR 4 -> 101.33 kg)
  const pr1rm = report.records[0]?.improvements.find((i) => i.metric === "oneRepMax")?.current;
  const hist = getExerciseHistory(store, user.userId, "bench-press");
  const hist1rm = hist.sessions.find((s) => s.workoutId === "wo_bp_230")?.estimated1rm;
  assert.equal(pr1rm, 101.33);
  assert.equal(hist1rm, 101.33);

  // #236: FIT refuses missing startedAt instead of fabricating 12:00 UTC
  assert.throws(
    () =>
      encodeWorkoutToFit({
        title: "缺开始时间",
        date: "2026-11-22",
        startedAt: null,
        durationSeconds: 1800,
      }),
    /实际开始时间/,
  );

  // #237: 5 km outdoor running FIT exports running sport (1) + total_distance = 5000 m
  const runFit = encodeWorkoutToFit({
    title: "户外跑步 5 km",
    date: "2026-11-22",
    startedAt: "2026-11-22T07:00:00+08:00",
    endedAt: "2026-11-22T07:30:00+08:00",
    durationSeconds: 1800,
    cardioMeta: { activityType: "running", environment: "outdoor", distanceMeters: 5000 },
    totalVolumeKg: 0,
  });
  const runDecoded = decodeFitSessionSummary(runFit)!;
  assert.equal(runDecoded.sport, 1);
  assert.equal(runDecoded.subSport, 0);
  assert.equal(runDecoded.distanceMeters, 5000);
  assert.equal(runDecoded.devVolumeKg, undefined);

  // #269: Paused 60-min workout (18:00–19:00, 30-min active timer) preserves 19:00 endTs, 3600s elapsed, 1800s timer
  const pausedFit = encodeWorkoutToFit({
    title: "暂停训练",
    date: "2026-11-22",
    startedAt: "2026-11-22T18:00:00+08:00",
    endedAt: "2026-11-22T19:00:00+08:00",
    durationSeconds: 1800,
    totalVolumeKg: 500,
  });
  const pausedDecoded = decodeFitSessionSummary(pausedFit)!;
  assert.equal(pausedDecoded.endMs, Date.parse("2026-11-22T19:00:00+08:00"));
  assert.equal(pausedDecoded.elapsedSec, 3600);
  assert.equal(pausedDecoded.timerSec, 1800);

  // #270: Explicit totalVolumeKg=0 (from catalogue-resolved assisted exercise lacking snapshot) does NOT emit 400 kg volume
  const assistedFit = encodeWorkoutToFit({
    title: "辅助引体",
    date: "2026-11-22",
    startedAt: "2026-11-22T18:00:00+08:00",
    endedAt: "2026-11-22T18:30:00+08:00",
    durationSeconds: 1800,
    totalVolumeKg: 0,
    exercises: [
      {
        id: "ex_assist_legacy",
        exerciseId: "assisted-pullup",
        restSeconds: 90,
        snapshot: null,
        sets: [{ id: "s1", type: "normal", weight: 40, reps: 10, seconds: 0, completed: true, rir: null }],
      },
    ],
  });
  const assistedDecoded = decodeFitSessionSummary(assistedFit)!;
  assert.equal(assistedDecoded.devVolumeKg, undefined);
});

test("R24 (#238-#242): Apple Health mixed warmup matching, cardioMeta matching, non-overlapping live session separation, merged trigger deletion & cross-midnight consistency", async () => {
  const { app, store, auth } = createApp(openDatabase(":memory:"));
  const user = auth.login("r24-user");
  const tokRes = await app.request("http://localhost/api/integrations/apple-health/tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Watch" }),
  });
  assert.equal(tokRes.status, 201);
  const { token: deviceToken } = (await tokRes.json()) as { id: string; token: string };

  const upload = (body: Record<string, unknown>) =>
    app.request("http://localhost/api/integrations/apple-health/workouts", {
      method: "POST",
      headers: { Authorization: `Bearer ${deviceToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, captureMethod: "workout", ...body }),
    });

  // #238: Mixed workout (6-min treadmill warmup + bench press) pairs with Watch strength workout
  store.mutate(user.userId, {
    opId: "wo_238",
    id: "wo_238",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "推举含热身",
      date: "2026-11-18",
      startedAt: "2026-11-18T10:00:00+08:00",
      endedAt: "2026-11-18T11:00:00+08:00",
      status: "completed",
      exercises: [
        {
          id: "ex_run_warm",
          exerciseId: "treadmill-run",
          restSeconds: 60,
          snapshot: { name: "跑步机慢跑", muscle: "cardio", equipment: "machine", mode: "timed", volumeMultiplier: 1 },
          sets: [{ id: "s_warm", type: "normal", weight: 0, reps: 0, seconds: 360, completed: true, rir: null }],
        },
        {
          id: "ex_bp_238",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: "s_bp", type: "normal", weight: 70, reps: 8, seconds: 0, completed: true, rir: 1 }],
        },
      ],
    },
  });
  assert.equal(
    (
      await upload({
        externalWorkoutId: "w_238",
        activityType: "traditionalStrengthTraining",
        environment: "indoor",
        startedAt: "2026-11-18T10:00:00+08:00",
        endedAt: "2026-11-18T11:00:00+08:00",
        durationSeconds: 3600,
        durationKind: "workout_active",
        activeEnergyKcal: 340,
      })
    ).status,
    201,
  );

  // #239: Manual run with structured cardioMeta + generic exercise name pairs with Watch running
  store.mutate(user.userId, {
    opId: "wo_239",
    id: "wo_239",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "有氧间歇甲",
      date: "2026-11-19",
      startedAt: "2026-11-19T07:00:00+08:00",
      endedAt: "2026-11-19T07:25:00+08:00",
      status: "completed",
      cardioMeta: { activityType: "running", environment: "outdoor", distanceMeters: 4200 },
      exercises: [
        {
          id: "ex_cardio_239",
          exerciseId: "custom_interval_a",
          restSeconds: 60,
          snapshot: { name: "有氧间歇甲", muscle: "cardio", equipment: "bodyweight", mode: "timed", volumeMultiplier: 1 },
          sets: [{ id: "s_c239", type: "normal", weight: 0, reps: 0, seconds: 1500, completed: true, rir: null }],
        },
      ],
    },
  });
  assert.equal(
    (
      await upload({
        externalWorkoutId: "w_239",
        activityType: "running",
        environment: "outdoor",
        startedAt: "2026-11-19T07:00:00+08:00",
        endedAt: "2026-11-19T07:25:00+08:00",
        durationSeconds: 1500,
        durationKind: "workout_active",
        distanceMeters: 4200,
      })
    ).status,
    201,
  );

  // #240: Watch 07:30-08:00 + separate live-timed Ironlog workout 08:15-08:45 must NOT auto-merge
  assert.equal(
    (
      await upload({
        externalWorkoutId: "w_240",
        activityType: "traditionalStrengthTraining",
        environment: "indoor",
        startedAt: "2026-11-17T07:30:00+08:00",
        endedAt: "2026-11-17T08:00:00+08:00",
        durationSeconds: 1800,
        durationKind: "workout_active",
      })
    ).status,
    201,
  );
  store.mutate(user.userId, {
    opId: "wo_240",
    id: "wo_240",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "第二场力量",
      date: "2026-11-17",
      startedAt: "2026-11-17T08:15:00+08:00",
      endedAt: "2026-11-17T08:45:00+08:00",
      timing: { elapsedSeconds: 1800, runningSince: null },
      status: "completed",
      exercises: [
        {
          id: "ex_240",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: "s_240", type: "normal", weight: 60, reps: 10, seconds: 0, completed: true, rir: 1 }],
        },
      ],
    },
  });

  // #242: Cross-midnight manual (11-20 23:55–11-21 00:50) + Watch (11-21 00:02–00:49) consistent in 1-day vs 2-day queries
  store.mutate(user.userId, {
    opId: "wo_242",
    id: "wo_242",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "深夜训练",
      date: "2026-11-20",
      startedAt: "2026-11-20T23:55:00+08:00",
      endedAt: "2026-11-21T00:50:00+08:00",
      status: "completed",
      exercises: [
        {
          id: "ex_242",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: "s_242", type: "normal", weight: 80, reps: 6, seconds: 0, completed: true, rir: 1 }],
        },
      ],
    },
  });
  assert.equal(
    (
      await upload({
        externalWorkoutId: "w_242",
        activityType: "traditionalStrengthTraining",
        environment: "indoor",
        startedAt: "2026-11-21T00:02:00+08:00",
        endedAt: "2026-11-21T00:49:00+08:00",
        durationSeconds: 2820,
        durationKind: "workout_active",
      })
    ).status,
    201,
  );

  const agendaAll = (await (
    await app.request("http://localhost/api/integrations/apple-health/agenda?from=2026-11-17&through=2026-11-21", {
      headers: { Authorization: `Bearer ${user.token}` },
    })
  ).json()) as Array<{ id: string; date: string; manualWorkoutId: string | null }>;

  assert.equal(agendaAll.find((i) => i.date === "2026-11-18")?.manualWorkoutId, "wo_238", "#238 mixed warmup must pair");
  assert.equal(agendaAll.find((i) => i.date === "2026-11-19")?.manualWorkoutId, "wo_239", "#239 cardioMeta must pair");
  assert.equal(agendaAll.find((i) => i.date === "2026-11-17")?.manualWorkoutId, null, "#240 separate live session must NOT pair");

  const agendaSingleDay = (await (
    await app.request("http://localhost/api/integrations/apple-health/agenda?from=2026-11-20&through=2026-11-20", {
      headers: { Authorization: `Bearer ${user.token}` },
    })
  ).json()) as Array<{ id: string; date: string; manualWorkoutId: string | null }>;
  assert.equal(agendaSingleDay.length, 1, "#242 single-day query must include cross-midnight Watch workout attributed to 11-20");
  assert.equal(agendaSingleDay[0]!.manualWorkoutId, "wo_242");
  assert.equal(agendaSingleDay[0]!.date, "2026-11-20");

  // #241: Merged Watch + Shortcut trigger -> deleting visible Watch row deletes BOTH so trigger never resurfaces
  assert.equal(
    (
      await upload({
        externalWorkoutId: "w_241",
        activityType: "running",
        environment: "outdoor",
        captureMethod: "workout",
        startedAt: "2026-11-16T09:00:00+08:00",
        endedAt: "2026-11-16T09:30:00+08:00",
        durationSeconds: 1800,
        durationKind: "workout_active",
        heartRate: { avgBpm: 152, maxBpm: 170 },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await upload({
        activityType: "running",
        environment: "outdoor",
        captureMethod: "trigger",
        startedAt: "2026-11-16T09:00:10+08:00",
        endedAt: "2026-11-16T09:30:05+08:00",
        durationSeconds: 1795,
        durationKind: "event_elapsed",
      })
    ).status,
    201,
  );
  const beforeDel = (await (
    await app.request("http://localhost/api/integrations/apple-health/agenda?from=2026-11-16&through=2026-11-16", {
      headers: { Authorization: `Bearer ${user.token}` },
    })
  ).json()) as Array<{ id: string }>;
  assert.equal(beforeDel.length, 1);

  const delRes = await app.request(`http://localhost/api/integrations/apple-health/workouts/${beforeDel[0]!.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${user.token}` },
  });
  assert.equal(delRes.status, 200);
  const afterDel = (await (
    await app.request("http://localhost/api/integrations/apple-health/agenda?from=2026-11-16&through=2026-11-16", {
      headers: { Authorization: `Bearer ${user.token}` },
    })
  ).json()) as Array<{ id: string }>;
  assert.equal(afterDel.length, 0, "#241 hidden trigger copy must NOT reappear after deleting merged Watch workout");
});

test("R25 (#246, #247, #249): offline weight coalescing, frozen-opId conflict clearing & storage write failure reporting", () => {
  const storage = makeMemoryStorage();
  const uid = "u_r25";

  // #246: Consecutive offline weight saves on same date coalesce into 1 mutation keeping baseVersion 0
  enqueueMutation(storage, uid, {
    opId: "op_w1",
    path: "/api/records",
    method: "POST",
    body: { opId: "op_w1", id: "weight_2026-11-28", kind: "weight", baseVersion: 0, deleted: false, data: { date: "2026-11-28", weight: 72, bodyFat: null } },
    label: "体重：72.0 kg",
  });
  enqueueMutation(storage, uid, {
    opId: "op_w2",
    path: "/api/records",
    method: "POST",
    body: { opId: "op_w2", id: "weight_2026-11-28", kind: "weight", baseVersion: 0, deleted: false, data: { date: "2026-11-28", weight: 73, bodyFat: null } },
    label: "体重：73.0 kg",
  });
  const q246 = readQueue(storage, uid);
  assert.equal(q246.length, 1);
  assert.equal((q246[0]!.body as { data: { weight: number }; baseVersion: number }).data.weight, 73);
  assert.equal((q246[0]!.body as { baseVersion: number }).baseVersion, 0);

  // #247 (P1): Freezing confirmed opIds removes ONLY confirmed conflict, preserving newly arrived conflict
  storage.setItem(
    `ironlog-offline-queue:${uid}`,
    JSON.stringify([
      { opId: "fail_old", path: "/api/records", failure: { status: 409, message: "conflict 1" } },
      { opId: "fail_new", path: "/api/records", failure: { status: 409, message: "conflict 2" } },
      { opId: "pending_ok", path: "/api/records" },
    ]),
  );
  const clearRes = clearFailedMutationsByIds(storage, uid, ["fail_old"]);
  assert.equal(clearRes.storageError, false);
  assert.equal(clearRes.removed, 1);
  assert.equal(clearRes.remainingBlocked, 1);
  assert.equal(clearRes.remainingPending, 1);
  assert.deepEqual(
    readQueue(storage, uid).map((i) => i.opId),
    ["fail_new", "pending_ok"],
  );

  // #249: Storage failure returns storageError: true and preserves blocked count
  const readOnlyStorage = makeMemoryStorage();
  readOnlyStorage.setItem(
    `ironlog-offline-queue:${uid}`,
    JSON.stringify([{ opId: "fail_1", path: "/api/records", failure: { status: 409, message: "conflict" } }]),
  );
  const failingStorage = {
    getItem: (k: string) => readOnlyStorage.getItem(k),
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  const failRes = clearFailedMutationsByIds(failingStorage, uid, ["fail_1"]);
  assert.equal(failRes.storageError, true);
  assert.equal(failRes.removed, 0);
  assert.equal(failRes.remainingBlocked, 1);
  assert.equal(failRes.remainingPending, 0);
});

test("R26 (#255, #256): AI plan reads active plan_versions snapshot (not newer unapplied draft) and deduplicates retries by opId", async () => {
  let aiCalls = 0;
  let capturedPrompt = "";
  const mockTransport: typeof fetch = async (_url, init) => {
    aiCalls++;
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    capturedPrompt = (body.messages ?? []).map((m) => m.content ?? "").join("\n");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "迭代力量方案",
                weeks: 6,
                schedule: "rotation",
                weekdays: [],
                rationale: "基于 50kg 渐进",
                routines: [
                  {
                    id: "r1",
                    name: "上肢日",
                    exercises: [
                      {
                        exerciseId: "bench-press",
                        sets: 3,
                        repsMin: 6,
                        repsMax: 10,
                        weight: 52.5,
                        seconds: 0,
                        restSeconds: 90,
                        targetRir: 2,
                        progression: "double",
                        increment: 2.5,
                      },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const { app, store, auth } = createApp(openDatabase(":memory:"));
  const user = auth.login("r26-user");
  const { AiService } = await import("../packages/server/src/ai.js");
  const aiSvc = new AiService(
    store,
    {
      baseUrl: "https://mock-ai.local/v1",
      apiKey: "test-key",
      model: "test-model",
    },
    mockTransport,
  );

  // Create plan v1 (50 kg) and activate it
  const p1Res = await app.request("http://localhost/api/plans/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "甲计划",
      weeks: 6,
      schedule: "rotation",
      weekdays: [],
      rationale: "v1 50kg",
      source: "manual",
      routines: [
        {
          id: "r1",
          name: "推",
          exercises: [
            {
              exerciseId: "bench-press",
              sets: 3,
              repsMin: 8,
              repsMax: 10,
              weight: 50,
              seconds: 0,
              restSeconds: 90,
              targetRir: 2,
              progression: "double",
              increment: 2.5,
            },
          ],
        },
      ],
    }),
  });
  assert.equal(p1Res.status, 201);
  const { record: p1 } = (await p1Res.json()) as { record: { id: string; version: number; data: Record<string, unknown> } };
  store.applyPlan(user.userId, p1.id, p1.version, 0);

  // Update same plan record to v2 (70 kg) WITHOUT activating it!
  store.mutate(user.userId, {
    opId: "update_plan_draft_70kg",
    id: p1.id,
    kind: "plan",
    baseVersion: p1.version,
    deleted: false,
    data: {
      ...(p1.data as Record<string, unknown>),
      rationale: "unapplied draft 70kg",
      routines: [
        {
          id: "r1",
          name: "推",
          exercises: [
            {
              exerciseId: "bench-press",
              sets: 3,
              repsMin: 8,
              repsMax: 10,
              weight: 70,
              seconds: 0,
              restSeconds: 90,
              targetRir: 2,
              progression: "double",
              increment: 2.5,
            },
          ],
        },
      ],
    },
  });

  // #255: AI plan iteration with parentId + parentVersion=1 must receive 50 kg snapshot, NOT 70 kg unapplied draft
  const gen1 = (await aiSvc.plan(user.userId, "基于当前计划微调", p1.id, {
    parentVersion: 1,
    opId: "ai_plan_op_256",
  })) as { record: { id: string } };
  assert.ok(capturedPrompt.includes("50"), "Model prompt must contain active v1 weight 50");
  assert.ok(!capturedPrompt.includes("unapplied draft 70kg"), "Model prompt must NOT read newer unapplied draft");

  // #256: Retrying with the exact same opId returns existing draft without calling LLM a second time
  const gen2 = (await aiSvc.plan(user.userId, "基于当前计划微调", p1.id, {
    parentVersion: 1,
    opId: "ai_plan_op_256",
  })) as { record: { id: string } };
  assert.equal(aiCalls, 1, "Idempotent opId retry must NOT invoke LLM twice");
  assert.equal(gen2.record.id, gen1.record.id);

  // Stale parentVersion rejects with 409
  await assert.rejects(
    () =>
      aiSvc.plan(user.userId, "微调", p1.id, {
        parentVersion: 99,
      }),
    /已变更|已更新|过期|版本/,
  );
  assert.ok(app);
});

test("R28 (#263-#267): Ironlog CSV round-trip preserves endedAt, 2s duration, 62.345kg precision, set completedAt, 0-set workouts & mode change invalidates preview signature", () => {
  const { store, auth } = createApp(openDatabase(":memory:"));
  const src = auth.login("r28-src");
  const dst = auth.login("r28-dst");

  // 1) Paused 18:00-19:00 workout with 1853s timer, 62.345 kg, set1 completed at 18:20, set2 uncompleted
  store.mutate(src.userId, {
    opId: "w_paused",
    id: "w_paused",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "精确往返测试",
      date: "2026-11-24",
      startedAt: "2026-11-24T18:00:00+08:00",
      endedAt: "2026-11-24T19:00:00+08:00",
      timing: { elapsedSeconds: 1853, runningSince: null },
      status: "completed",
      exercises: [
        {
          id: "ex_1",
          exerciseId: "bench-press",
          restSeconds: 90,
          weightUnit: "kg",
          sets: [
            {
              id: "s1",
              type: "normal",
              weight: 62.345,
              reps: 8,
              seconds: 0,
              completed: true,
              completedAt: "2026-11-24T18:20:00+08:00",
              rir: 2,
            },
            {
              id: "s2",
              type: "normal",
              weight: 62.345,
              reps: 8,
              seconds: 0,
              completed: false,
              rir: null,
            },
          ],
        },
      ],
    },
  });

  // 2) 2-second workout
  store.mutate(src.userId, {
    opId: "w_2s",
    id: "w_2s",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "两秒测试",
      date: "2026-11-25",
      startedAt: "2026-11-25T10:00:00+08:00",
      endedAt: "2026-11-25T10:00:02+08:00",
      status: "completed",
      exercises: [
        {
          id: "ex_2s",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: "s_2s", type: "normal", weight: 50, reps: 1, seconds: 0, completed: true, rir: null }],
        },
      ],
    },
  });

  // 3) 0-set completed workout (#266)
  store.mutate(src.userId, {
    opId: "w_empty",
    id: "w_empty",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "无组完成记录",
      date: "2026-11-26",
      startedAt: "2026-11-26T09:00:00+08:00",
      endedAt: "2026-11-26T09:20:00+08:00",
      status: "completed",
      exercises: [],
    },
  });

  const csv = buildWebCsv(store, src.userId, "workouts").content;
  const preview = previewWorkoutCsvImport(store, dst.userId, {
    csv,
    skipDuplicates: true,
    includeSuspectedDuplicates: false,
    decimalFormat: "auto",
    allowPartialImport: false,
  });
  assert.equal(preview.importableWorkouts, 3, "#266 all 3 completed workouts (including 0-set) must be included");

  commitWorkoutCsvImport(store, dst.userId, {
    csv,
    skipDuplicates: true,
    includeSuspectedDuplicates: false,
    decimalFormat: "auto",
    allowPartialImport: false,
    expectedPreviewSignature: preview.previewSignature,
  });

  const imported = store.list(dst.userId, "workout").map((r) => r.data as Workout);
  assert.equal(imported.length, 3);
  const paused = imported.find((w) => w.title === "精确往返测试")!;
  assert.equal(Date.parse(paused.endedAt!), Date.parse("2026-11-24T19:00:00+08:00"), "#263 endedAt preserved");
  assert.equal(paused.timing?.elapsedSeconds, 1853, "#263 paused timing seconds preserved");
  assert.equal(paused.exercises[0]!.sets[0]!.weight, 62.345, "#264 exact kg precision preserved");
  assert.equal(
    Date.parse(paused.exercises[0]!.sets[0]!.completedAt!),
    Date.parse("2026-11-24T18:20:00+08:00"),
    "#265 set1 completedAt preserved",
  );
  assert.equal(paused.exercises[0]!.sets[1]!.completed, false);
  assert.equal(paused.exercises[0]!.sets[1]!.completedAt, undefined, "#265 uncompleted set has no completedAt");

  const twoSec = imported.find((w) => w.title === "两秒测试")!;
  assert.equal(twoSec.durationUnknown, false, "#263 2s workout must NOT become durationUnknown");
  assert.equal(Date.parse(twoSec.endedAt!) - Date.parse(twoSec.startedAt), 2000);

  const zeroSet = imported.find((w) => w.title === "无组完成记录")!;
  assert.equal(zeroSet.exercises.length, 0);

  // #267: Changing custom exercise mode between CSV preview and commit invalidates previewSignature
  const modeUser = auth.login("r28-mode");
  store.mutate(modeUser.userId, {
    opId: "ex_mode_1",
    id: "custom_dip_assist",
    kind: "exercise",
    baseVersion: 0,
    deleted: false,
    data: {
      id: "custom_dip_assist",
      name: "器械辅助双杠",
      englishName: "Assisted Dip Machine",
      aliases: [],
      muscle: "chest",
      secondaryMuscles: [],
      equipment: "machine",
      mode: "reps",
      volumeMultiplier: 1,
      instructions: ["控制下落速度"],
      mistakes: [],
    },
  });
  const strongCsv = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n2026-11-25 18:00:00,推举,45m,器械辅助双杠,1,40,10,0,0,,,\n`;
  const prev1 = previewWorkoutCsvImport(store, modeUser.userId, {
    csv: strongCsv,
    skipDuplicates: true,
    includeSuspectedDuplicates: false,
    decimalFormat: "auto",
    allowPartialImport: false,
  });
  // Mutate custom exercise from reps -> assisted
  store.mutate(modeUser.userId, {
    opId: "ex_mode_2",
    id: "custom_dip_assist",
    kind: "exercise",
    baseVersion: 1,
    deleted: false,
    data: {
      id: "custom_dip_assist",
      name: "器械辅助双杠",
      englishName: "Assisted Dip Machine",
      aliases: [],
      muscle: "chest",
      secondaryMuscles: [],
      equipment: "machine",
      mode: "assisted",
      volumeMultiplier: 1,
      instructions: ["控制下落速度"],
      mistakes: [],
    },
  });
  assert.throws(
    () =>
      commitWorkoutCsvImport(store, modeUser.userId, {
        csv: strongCsv,
        skipDuplicates: true,
        includeSuspectedDuplicates: false,
        decimalFormat: "auto",
        allowPartialImport: false,
        expectedPreviewSignature: prev1.previewSignature,
      }),
    /预览范围不一致|发生变化/,
  );
});

test("R29 & R27 (#259, #272, #273, #278): schedule baseVersion 0/delete conflicts, nutritionDay fingerprint invalidation & lb barbell warmup", async () => {
  const { app, auth } = createApp(openDatabase(":memory:"));
  const user = auth.login("r29-user");
  const date = "2026-12-05";

  const call = (path: string, method: string, body?: unknown) =>
    app.request(`http://localhost${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${user.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  // Another device creates schedule v1 on blank date
  const createRes = await call(`/api/web/schedule/${date}`, "PUT", {
    mode: "workout",
    title: "95kg 排期",
    exercises: [
      {
        exerciseId: "bench-press",
        sets: 3,
        repsMin: 5,
        repsMax: 8,
        weight: 95,
        seconds: 0,
        restSeconds: 90,
        targetRir: 2,
        progression: "double",
        increment: 2.5,
      },
    ],
    baseVersion: 0,
  });
  assert.equal(createRes.status, 200);

  // #272 (P1): Stale editor opened when day was blank sends baseVersion: 0 -> MUST reject with 409!
  const stalePut = await call(`/api/web/schedule/${date}`, "PUT", {
    mode: "workout",
    title: "旧页面排期",
    exercises: [
      {
        exerciseId: "bench-press",
        sets: 3,
        repsMin: 8,
        repsMax: 10,
        weight: 60,
        seconds: 0,
        restSeconds: 90,
        targetRir: 2,
        progression: "double",
        increment: 2.5,
      },
    ],
    baseVersion: 0,
  });
  assert.equal(stalePut.status, 409);

  // Another device updates to v2
  const updateV2 = await call(`/api/web/schedule/${date}`, "PUT", {
    mode: "workout",
    title: "100kg v2",
    exercises: [
      {
        exerciseId: "bench-press",
        sets: 3,
        repsMin: 5,
        repsMax: 8,
        weight: 100,
        seconds: 0,
        restSeconds: 90,
        targetRir: 2,
        progression: "double",
        increment: 2.5,
      },
    ],
    baseVersion: 1,
  });
  assert.equal(updateV2.status, 200);

  // #273 (P1): Stale editor sends DELETE with ?baseVersion=1 -> MUST reject with 409!
  const staleDelete = await call(`/api/web/schedule/${date}?baseVersion=1`, "DELETE");
  assert.equal(staleDelete.status, 409);

  // #278: lb barbell 80 lb warmup never goes below 45 lb empty bar
  const seed = buildWorkoutSeedFromRoutine(
    {
      name: "磅制推举",
      routineId: "r_lb",
      exercises: [
        {
          exerciseId: "bench-press",
          restSeconds: 90,
          weightUnit: "lb",
          autoWarmup: true,
          sets: 3,
          weight: 80,
          reps: 8,
          seconds: 0,
          snapshot: {
            name: "杠铃卧推",
            muscle: "chest",
            equipment: "barbell",
            mode: "reps",
            volumeMultiplier: 1,
          },
        },
      ],
    },
    {
      prefs: {
        soundOn: false,
        hapticsOn: false,
        screenAwake: false,
        notifyRest: false,
        showRir: true,
        autoSyncSubsequent: false,
        autoPrefillLast: true,
        autoStartRestTimer: true,
        autoAdvanceExercise: false,
        warmupRestSeconds: 60,
        restAdjustStep: 15,
        weightStepKg: 2.5,
        barWeight: 20,
        enabledPlates: [20, 15, 10, 5, 2.5, 1.25],
        showPlateMath: true,
        warmupScheme: "standard",
        soundStyle: "chime",
        appleFitnessAutoLaunch: false,
        appleStrengthLaunch: "off",
        appleCardioLaunch: "off",
        appleHubShortcutName: "",
        appleStrengthShortcutName: "",
        appleCardioShortcutName: "",
        appleAutoSyncOnFinish: false,
        deloadMode: false,
        deloadWeightPct: 75,
        deloadSetsPct: 75,
        workoutLayout: "sheet",
        collapseCompletedExercises: false,
        voiceRestCues: false,
        platePairs: {},
        hiddenModules: [],
        demoDisplayMode: "hide",
      },
    },
  );
  const warmups = seed.exercises![0]!.sets.filter((s) => s.type === "warmup").map((s) => s.weight);
  assert.ok(warmups.length > 0);
  assert.ok(warmups.every((w) => w >= 45), `lb barbell warmup must be >= 45 lb, got ${JSON.stringify(warmups)}`);

  // #259: nutritionDayComplete invalidates when meal calories change
  const mealBefore = [{ id: "d1", kind: "diet", version: 1, deleted: false, updatedAt: "2026-11-27T12:00:00Z", data: { date: "2026-11-27", meal: "lunch", name: "鸡胸", calories: 410, protein: 40, carbs: 20, fat: 5 } }];
  const mealAfter = [{ id: "d1", kind: "diet", version: 2, deleted: false, updatedAt: "2026-11-27T12:05:00Z", data: { date: "2026-11-27", meal: "lunch", name: "鸡胸", calories: 640, protein: 40, carbs: 60, fat: 5 } }];
  const fp = nutritionFingerprint("2026-11-27", mealBefore as never);
  assert.equal(
    nutritionDayComplete({ date: "2026-11-27", complete: true, fingerprint: fp }, mealBefore as never),
    true,
  );
  assert.equal(
    nutritionDayComplete({ date: "2026-11-27", complete: true, fingerprint: fp }, mealAfter as never),
    false,
  );
});

test("R30 (#281, #283, #284, #285): manual cardio source separation, >60 workout completeness, exact weekly seconds & explicit 0 kcal nutrition days", () => {
  const { store, auth } = createApp(openDatabase(":memory:"));
  const user = auth.login("r30-user");
  const through = localDate();

  // Create 61 manual running workouts across past 61 days (0 Apple device workouts)
  const baseMs = Date.parse(`${through}T08:00:00+08:00`);
  for (let i = 0; i < 61; i++) {
    const startMs = baseMs - i * 86_400_000;
    const d = localDate(startMs);
    const durSec = i === 0 ? 91 : 1800; // #284: 91-second workout in latest week!
    store.mutate(user.userId, {
      opId: `run_${i}`,
      id: `run_${i}`,
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: `手录跑步 ${i + 1}`,
        date: d,
        startedAt: new Date(startMs).toISOString(),
        endedAt: new Date(startMs + durSec * 1000).toISOString(),
        status: "completed",
        cardioMeta: { activityType: "running", environment: "outdoor", distanceMeters: 3000 },
        exercises: [
          {
            id: `ex_run_${i}`,
            exerciseId: "cardio-running",
            restSeconds: 60,
            snapshot: { name: "户外跑步", muscle: "cardio", equipment: "bodyweight", mode: "timed", volumeMultiplier: 1 },
            sets: [{ id: `s_run_${i}`, type: "normal", weight: 0, reps: 0, seconds: durSec, completed: true, rir: null }],
          },
        ],
      },
    });
  }

  // #285: Log 2 diet days — one 800 kcal, one explicit 0 kcal (white water)
  const day1 = localDate(baseMs - 86_400_000);
  store.mutate(user.userId, {
    opId: "diet_800",
    id: "diet_800",
    kind: "diet",
    baseVersion: 0,
    deleted: false,
    data: { date: day1, meal: "lunch", name: "午餐", calories: 800, protein: 45, carbs: 80, fat: 20, source: "manual", rawPrompt: "" },
  });
  store.mutate(user.userId, {
    opId: "diet_0",
    id: "diet_0",
    kind: "diet",
    baseVersion: 0,
    deleted: false,
    data: { date: through, meal: "breakfast", name: "白水", calories: 0, protein: 0, carbs: 0, fat: 0, source: "manual", rawPrompt: "" },
  });

  const analytics90 = getWebAnalytics(store, user.userId, { through, days: 90 });

  // #281: 61 manual runs must NOT be classified as realDeviceCount
  assert.equal(analytics90.appleWorkouts.totalCount, 61);
  assert.equal(analytics90.appleWorkouts.realDeviceCount, 0);
  assert.equal(analytics90.appleWorkouts.manualCount, 61);
  assert.equal(analytics90.appleWorkouts.realDeviceStats.totalCount, 0);
  assert.ok(analytics90.appleWorkouts.recent.every((r) => r.source === "manual"));

  // #283: All 61 records returned (not truncated at 60)
  assert.equal(analytics90.appleWorkouts.recent.length, 61);
  assert.equal(analytics90.appleWorkouts.truncatedCount, 0);

  // #284: Weekly breakdown preserves exact seconds (91s workout -> not rounded 120s)
  const user284 = auth.login("r30-284");
  store.mutate(user284.userId, {
    opId: "w_91s",
    id: "w_91s",
    kind: "workout",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "91秒测试",
      date: through,
      startedAt: new Date(baseMs).toISOString(),
      endedAt: new Date(baseMs + 91_000).toISOString(),
      status: "completed",
      exercises: [
        {
          id: "ex_91",
          exerciseId: "bench-press",
          restSeconds: 60,
          sets: [{ id: "s_91", type: "normal", weight: 60, reps: 8, seconds: 0, completed: true, rir: 1 }],
        },
      ],
    },
  });
  const analytics7 = getWebAnalytics(store, user284.userId, { through, days: 7 });
  assert.equal(analytics7.weeklyBreakdown[0]!.durationMinutes, 2);
  assert.equal(analytics7.weeklyBreakdown[0]!.durationSeconds, 91);
  assert.equal(analytics7.weeklyBreakdown[0]!.timedSessions, 1);

  // #285: Explicit 0 kcal day has mealsCount === 1
  const loggedDietDays = analytics90.nutrition.dailySeries.filter((d) => d.mealsCount > 0);
  assert.equal(loggedDietDays.length, 2);
  assert.equal(loggedDietDays.find((d) => d.date === through)?.calories, 0);
});
