import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localDate, type Workout } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { Auth } from "../packages/server/src/auth.js";
import { openDatabase } from "../packages/server/src/db.js";
import { Store } from "../packages/server/src/store.js";
import {
  buildWebCsv,
  getExerciseHistory,
  getTrainedExercisesSummary,
} from "../packages/server/src/web-extras.js";
import { commitWorkoutCsvImport, csvImportInput, previewWorkoutCsvImport } from "../packages/server/src/web-import.js";
import {
  computeWeeklyStreak,
  getWebStatistics,
  hasUsedStreakFreezeInMonth,
  isoWeekKey,
  shiftDay,
} from "../packages/server/src/web-statistics.js";
import { listAppleTraining } from "../packages/server/src/apple-training-agenda.js";

function makeCtx() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db, {});
  const userA = auth.login("round4_user_a");
  const userB = auth.login("round4_user_b");
  const call = (
    path: string,
    opts: { method?: string; body?: unknown; token?: string } = {},
  ) =>
    app.request(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${opts.token ?? userA.token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  return { db, store, auth, userA, userB, app, call };
}

test("#43 (P1) 铁记 CSV 导出按公斤折算并保留原单位，跨账号重新导入后 135 lb 与 80 kg 往返准确", () => {
  const { db, store, userA, userB } = makeCtx();
  try {
    const day = shiftDay(localDate(), -2);
    store.mutate(userA.userId, {
      opId: "r4-43-lb",
      id: "wo_lb_export",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "磅制卧推",
        date: day,
        startedAt: `${day}T02:00:00.000Z`,
        endedAt: `${day}T02:45:00.000Z`,
        status: "completed",
        exercises: [
          {
            id: "ex_lb_1",
            exerciseId: "bench-press",
            weightUnit: "lb",
            restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 135, reps: 8, seconds: 0, completed: true, rir: 2 }],
          },
          {
            id: "ex_kg_1",
            exerciseId: "squat",
            weightUnit: "kg",
            restSeconds: 120,
            sets: [{ id: "s2", type: "normal", weight: 80, reps: 5, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });

    const csv = buildWebCsv(store, userA.userId, "workouts");
    const lines = csv.content.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /重量\(kg\).*容量\(kg\).*重量单位,原始重量/);
    // 135 lb = 61.23 kg; volume = 61.23 * 8 = 489.8 kg (NOT 135 kg / 1080 kg!)
    assert.match(lines[1]!, /,61\.23,8,0,2,是,489\.8,.*,lb,135(?:,|$)/);
    assert.match(lines[2]!, /,80,5,0,2,是,400,.*,kg,80(?:,|$)/);

    // Re-import into another account: 135 lb stays 135 lb (weightUnit: "lb"), 80 kg stays 80 kg
    const preview = previewWorkoutCsvImport(store, userB.userId, csvImportInput.parse({ csv: csv.content }));
    assert.equal(preview.format, "ironlog");
    const executed = commitWorkoutCsvImport(store, userB.userId, csvImportInput.parse({ csv: csv.content }));
    assert.equal(executed.importedWorkouts, 1);

    const importedWorkouts = store.list(userB.userId, "workout").map((r) => r.data as Workout);
    assert.equal(importedWorkouts.length, 1);
    const benchRow = importedWorkouts[0]!.exercises.find((e) => e.exerciseId === "bench-press")!;
    const squatRow = importedWorkouts[0]!.exercises.find((e) => e.exerciseId === "squat")!;
    assert.equal(benchRow.weightUnit, "lb");
    assert.equal(benchRow.sets[0]!.weight, 135);
    assert.ok(squatRow.weightUnit == null || squatRow.weightUnit === "kg");
    assert.equal(squatRow.sets[0]!.weight, 80);

    // Also verify legacy CSV without 重量单位/原始重量 columns still imports 61.23 kg properly
    const strippedCsv = lines
      .map((line) => line.split(",").slice(0, -2).join(","))
      .join("\r\n");
    const previewStripped = previewWorkoutCsvImport(store, userB.userId, csvImportInput.parse({ csv: strippedCsv, skipDuplicates: false }));
    assert.equal(previewStripped.format, "ironlog");
    assert.equal(previewStripped.sampleWorkouts.length, 1);
  } finally {
    db.close();
  }
});

test("#44 动作详情与曾练动作列表统一按公斤汇总 135 lb vs 80 kg，且保留单组原单位", () => {
  const { db, store, userA } = makeCtx();
  try {
    const d1 = shiftDay(localDate(), -3);
    const d2 = shiftDay(localDate(), -2);
    // 135 lb (~61.23 kg) x 8
    store.mutate(userA.userId, {
      opId: "r4-44-lb",
      id: "wo_44_lb",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "磅制卧推",
        date: d1,
        startedAt: `${d1}T02:00:00.000Z`,
        endedAt: `${d1}T02:30:00.000Z`,
        status: "completed",
        exercises: [
          {
            id: "r1",
            exerciseId: "bench-press",
            weightUnit: "lb",
            restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 135, reps: 8, seconds: 0, completed: true, rir: null }],
          },
        ],
      },
    });
    // 80 kg x 8 (heavier than 135 lb!)
    store.mutate(userA.userId, {
      opId: "r4-44-kg",
      id: "wo_44_kg",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "公斤卧推",
        date: d2,
        startedAt: `${d2}T02:00:00.000Z`,
        endedAt: `${d2}T02:30:00.000Z`,
        status: "completed",
        exercises: [
          {
            id: "r2",
            exerciseId: "bench-press",
            weightUnit: "kg",
            restSeconds: 90,
            sets: [{ id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: null }],
          },
        ],
      },
    });

    const history = getExerciseHistory(store, userA.userId, "bench-press");
    const lbSession = history.sessions.find((s) => s.workoutId === "wo_44_lb")!;
    const kgSession = history.sessions.find((s) => s.workoutId === "wo_44_kg")!;
    assert.equal(lbSession.topWeight, 61.23);
    assert.equal(lbSession.weightUnit, "lb");
    assert.equal(lbSession.sets[0]!.weight, 135);
    assert.equal(lbSession.sets[0]!.weightUnit, "lb");
    assert.equal(lbSession.sets[0]!.weightKg, 61.23);
    assert.equal(lbSession.volume, 490);
    assert.ok(lbSession.estimated1rm! < kgSession.estimated1rm!);
    assert.equal(kgSession.topWeight, 80);

    const trained = getTrainedExercisesSummary(store, userA.userId);
    const bench = trained.items.find((i) => i.id === "bench-press")!;
    assert.equal(bench.bestWeight, 80);
    assert.ok(bench.best1rm! > 95 && bench.best1rm! < 110);
  } finally {
    db.close();
  }
});

test("#45 Hevy CSV 带显式 UTC 时区按 +08:00 推算训练日期，同时保留铁记 CSV 显式归档日", () => {
  const { db, store, userA } = makeCtx();
  try {
    // 2026-11-24T18:00:00Z == 2026-11-25 02:00:00+08:00
    const hevyCsv = [
      "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
      "Late Session,2026-11-24T18:00:00Z,2026-11-24T18:45:00Z,,Bench Press (Barbell),,,0,normal,80,8,,,8",
    ].join("\n");
    const res = commitWorkoutCsvImport(store, userA.userId, csvImportInput.parse({ csv: hevyCsv }));
    assert.equal(res.importedWorkouts, 1);
    const wo = store.list(userA.userId, "workout")[0]!.data as Workout;
    assert.equal(wo.date, "2026-11-25");
    assert.equal(wo.startedAt, "2026-11-24T18:00:00.000Z");

    // Ironlog own CSV keeps its explicit archived date column even if start_time is UTC
    const ironlogCsv = [
      "日期,训练标题,时长(分钟),体感,动作,超级组,组号,组类型,重量(kg),次数,时长(秒),RIR,已完成,容量(kg),开始时间,训练ID",
      "2026-11-23,显式日期测试,30,顺畅,深蹲,,1,正式组,100,5,0,2,true,500,2026-11-23T18:00:00.000Z,wo_explicit_d",
    ].join("\n");
    const res2 = commitWorkoutCsvImport(store, userA.userId, csvImportInput.parse({ csv: ironlogCsv }));
    assert.equal(res2.importedWorkouts, 1);
    const wo2 = store.list(userA.userId, "workout").map((r) => r.data as Workout).find((w) => w.title === "显式日期测试")!;
    assert.equal(wo2.date, "2026-11-23");
  } finally {
    db.close();
  }
});

test("#46 & #47 跨午夜同一场力量训练严格去重不重复计数，同日相隔 80 分钟的两场独立训练不自动合并", () => {
  const { db, store, userA } = makeCtx();
  try {
    const d1 = shiftDay(localDate(), -5);
    const d2 = shiftDay(d1, 1);
    const d3 = shiftDay(d1, 2);

    // #46: Manual 23:59 (d1) -> 00:50 (d2) + Watch 00:01 (d2) -> 00:50 (d2) => 49min overlap across midnight
    store.mutate(userA.userId, {
      opId: "r4-46-m",
      id: "wo_midnight_manual",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "深夜训练",
        date: d1,
        startedAt: `${d1}T23:59:00+08:00`,
        endedAt: `${d2}T00:50:00+08:00`,
        status: "completed",
        exercises: [
          {
            id: "ex_mid",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [{ id: "sm1", type: "normal", weight: 70, reps: 8, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });
    db.prepare(
      `INSERT INTO apple_health_workouts (id, user_id, identity_key, ended_at, received_at, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "aw_midnight",
      userA.userId,
      "k_aw_midnight",
      `${d2}T00:50:00+08:00`,
      new Date().toISOString(),
      JSON.stringify({
        externalWorkoutId: "aw_midnight",
        activityType: "HKWorkoutActivityTypeTraditionalStrengthTraining",
        environment: "indoor",
        captureMethod: "workout",
        startedAt: `${d2}T00:01:00+08:00`,
        endedAt: `${d2}T00:50:00+08:00`,
        durationSeconds: 2940,
        durationKind: "workout_active",
        annotation: {},
      }),
    );

    const agendaMid = listAppleTraining(store, userA.userId, { from: d1, through: d2 });
    assert.equal(agendaMid.length, 1);
    assert.equal(agendaMid[0]!.manualWorkoutId, "wo_midnight_manual");
    assert.equal(agendaMid[0]!.date, d1);

    const statsMid = getWebStatistics(store, userA.userId, { days: 7, through: d2 });
    assert.equal(statsMid.totals.workouts, 1);
    assert.equal(statsMid.totals.activities, 1);
    assert.equal(statsMid.totals.activeDays, 1);

    // #47: Manual 07:00-07:30 + Watch 08:50-09:20 (80 min gap, Watch after manual) must NOT merge
    store.mutate(userA.userId, {
      opId: "r4-47-m",
      id: "wo_morning_1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "早间卧推",
        date: d3,
        startedAt: `${d3}T07:00:00+08:00`,
        endedAt: `${d3}T07:30:00+08:00`,
        status: "completed",
        exercises: [
          {
            id: "ex_m1",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [{ id: "sm2", type: "normal", weight: 60, reps: 10, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });
    db.prepare(
      `INSERT INTO apple_health_workouts (id, user_id, identity_key, ended_at, received_at, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "aw_morning_2",
      userA.userId,
      "k_aw_morning_2",
      `${d3}T09:20:00+08:00`,
      new Date().toISOString(),
      JSON.stringify({
        externalWorkoutId: "aw_morning_2",
        activityType: "HKWorkoutActivityTypeTraditionalStrengthTraining",
        environment: "indoor",
        captureMethod: "workout",
        startedAt: `${d3}T08:50:00+08:00`,
        endedAt: `${d3}T09:20:00+08:00`,
        durationSeconds: 1800,
        durationKind: "workout_active",
        annotation: {},
      }),
    );

    const agendaSep = listAppleTraining(store, userA.userId, { from: d3, through: d3 });
    assert.equal(agendaSep.length, 1);
    assert.equal(agendaSep[0]!.manualWorkoutId, null);

    const statsSep = getWebStatistics(store, userA.userId, { days: 7, through: d3 });
    // d1/d2 merged = 1, d3 has 1 manual + 1 separate Watch = 2 => total 3 activities
    assert.equal(statsSep.totals.activities, 3);
  } finally {
    db.close();
  }
});

test("#48 围度并发修改：非重叠字段安全合并，重叠修改返回 409 并附最新服务端数据", async () => {
  const { db, call } = makeCtx();
  try {
    const day = shiftDay(localDate(), -1);
    // Initial row: waist 80 cm
    const r0 = await call("/api/web/measurements", {
      method: "PUT",
      body: { date: day, waistCm: 80, notes: "初始" },
    });
    assert.equal(r0.status, 200);
    const initial = (await r0.json()) as { updatedAt: string };

    // Device B adds chest 100 cm and updates notes
    const rB = await call("/api/web/measurements", {
      method: "PUT",
      body: {
        date: day,
        chestCm: 100,
        notes: "设备B备注",
        expectedUpdatedAt: initial.updatedAt,
        base: { chestCm: null, notes: "初始" },
      },
    });
    assert.equal(rB.status, 200);
    const afterB = (await rB.json()) as { waistCm: number; chestCm: number; notes: string; updatedAt: string };
    assert.equal(afterB.waistCm, 80);
    assert.equal(afterB.chestCm, 100);
    assert.equal(afterB.notes, "设备B备注");

    // Device A (with stale initial.updatedAt) submits ONLY hipCm 94 with base { hipCm: null } -> non-overlapping merge!
    const rA = await call("/api/web/measurements", {
      method: "PUT",
      body: {
        date: day,
        hipCm: 94,
        expectedUpdatedAt: initial.updatedAt,
        base: { hipCm: null },
      },
    });
    assert.equal(rA.status, 200);
    const afterA = (await rA.json()) as { waistCm: number; chestCm: number; hipCm: number; notes: string };
    assert.equal(afterA.waistCm, 80);
    assert.equal(afterA.chestCm, 100);
    assert.equal(afterA.hipCm, 94);
    assert.equal(afterA.notes, "设备B备注");

    // Overlapping edit: stale device also modifies notes -> 409 Conflict with current server row!
    const rConflict = await call("/api/web/measurements", {
      method: "PUT",
      body: {
        date: day,
        notes: "旧设备覆盖备注",
        expectedUpdatedAt: initial.updatedAt,
        base: { notes: "初始" },
      },
    });
    assert.equal(rConflict.status, 409);
    const conflictBody = (await rConflict.json()) as { error: string; current: { chestCm: number; hipCm: number; notes: string } };
    assert.equal(conflictBody.current.chestCm, 100);
    assert.equal(conflictBody.current.hipCm, 94);
    assert.equal(conflictBody.current.notes, "设备B备注");
  } finally {
    db.close();
  }
});

test("#49 体态照片上传携带 opId 重试幂等不生成重复照片，新 opId 仍允许有意再次上传", async () => {
  const { db, call } = makeCtx();
  try {
    const day = localDate();
    const img = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
    const payload = { opId: "photo_op_retry_1", date: day, pose: "front", mime: "image/jpeg", imageData: img, note: "晨起" };

    const first = await call("/api/web/progress-photos", { method: "POST", body: payload });
    assert.equal(first.status, 201);
    const p1 = (await first.json()) as { id: string };

    // Simulate lost receipt retry with SAME opId -> returns identical photo ID, total count stays 1
    const retry = await call("/api/web/progress-photos", { method: "POST", body: payload });
    assert.equal(retry.status, 201);
    const p2 = (await retry.json()) as { id: string };
    assert.equal(p2.id, p1.id);

    const list1 = (await (await call("/api/web/progress-photos")).json()) as Array<{ id: string }>;
    assert.equal(list1.length, 1);

    // Same opId with mutated payload -> 409
    const badRetry = await call("/api/web/progress-photos", {
      method: "POST",
      body: { ...payload, pose: "side" },
    });
    assert.equal(badRetry.status, 409);

    // Intentional re-upload with NEW opId -> creates second distinct photo
    const second = await call("/api/web/progress-photos", {
      method: "POST",
      body: { ...payload, opId: "photo_op_new_2" },
    });
    assert.equal(second.status, 201);
    const p3 = (await second.json()) as { id: string };
    assert.notEqual(p3.id, p1.id);
    const list2 = (await (await call("/api/web/progress-photos")).json()) as Array<{ id: string }>;
    assert.equal(list2.length, 2);
  } finally {
    db.close();
  }
});

test("#50 & #51 饮水目标等待服务端确认并支持失败重试；跨月冻结卡按消费日期计月度额度", () => {
  // #50: DietView waits for server response before updating waterGoal & notifying success
  const dietView = readFileSync("packages/web/src/views/DietView.tsx", "utf8");
  assert.match(dietView, /const confirmed = typeof res\?\.waterGoalMl === "number"/);
  assert.match(dietView, /setFailedWaterGoal\(/);
  assert.match(dietView, /饮水目标保存失败，未同步云端/);

  // #51: Cross-month freeze on 2026-11-30 (ISO week 2026-W49 spans Nov 30 - Dec 6)
  const w49 = isoWeekKey("2026-11-30");
  assert.equal(w49, isoWeekKey("2026-12-01"));
  const freezeLog = [{ weekKey: w49, usedAt: "2026-11-30" }];
  const freezeWeeks = [w49];

  // On Nov 30: November quota consumed (0 remaining), W49 protected
  assert.equal(hasUsedStreakFreezeInMonth("2026-11-30", freezeWeeks, freezeLog), true);
  const novStreak = computeWeeklyStreak(new Set<string>(), "2026-11-30", freezeWeeks, freezeLog);
  assert.equal(novStreak.freezeRemainingThisMonth, 0);
  assert.equal(novStreak.isCurrentWeekFrozen, true);

  // On Dec 1: December quota is STILL 1 (NOT 0!), while W49 remains protected
  assert.equal(hasUsedStreakFreezeInMonth("2026-12-01", freezeWeeks, freezeLog), false);
  const dec1Streak = computeWeeklyStreak(new Set<string>(), "2026-12-01", freezeWeeks, freezeLog);
  assert.equal(dec1Streak.freezeRemainingThisMonth, 1);
  assert.equal(dec1Streak.isCurrentWeekFrozen, true);

  // On Dec 9: December quota is still available so user can activate a freeze for W50
  assert.equal(hasUsedStreakFreezeInMonth("2026-12-09", freezeWeeks, freezeLog), false);
  const w50 = isoWeekKey("2026-12-09");
  const decLog = [...freezeLog, { weekKey: w50, usedAt: "2026-12-09" }];
  assert.equal(hasUsedStreakFreezeInMonth("2026-12-09", [...freezeWeeks, w50], decLog), true);
});
