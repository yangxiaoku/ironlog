import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyWorkoutAdaptation,
  localDate,
  planCycle,
  recommendInCycle,
  validateWorkoutAdjustment,
  type Workout,
  type WorkoutAdaptation,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { upsertDailyHealth } from "../packages/server/src/apple-health-daily.js";
import { buildSleepReport } from "../packages/server/src/sleep-report.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import {
  clearWebScheduleDay,
  saveWebScheduleDay,
  syncWorkoutRoutineToActivePlan,
} from "../packages/server/src/web-training.js";
import { matchesCardioAppleWorkout, type LiveCardioSession } from "../packages/web/src/lib/cardio-session.js";
import { safeUuid } from "../packages/web/src/lib/domain.js";

function shiftDay(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function makeCtx(transport?: typeof fetch, ai?: { baseUrl: string; apiKey: string; model: string }) {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db, ai ? { ai } : {}, transport);
  const user = auth.login("round3-user");
  const call = (url: string, options: { method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${user.token}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  return { db, app, store, user, call };
}

test("#29 (P1) 训练回写跨单位转换原计划目标重量（50 kg -> ~110.2 lb，而非 50 lb）并支持双向换算", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const p = store.mutate(user.userId, {
      opId: "p29-1",
      id: "plan_29",
      kind: "plan",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "plan_29",
        name: "卧推换算计划",
        weeks: 4,
        rationale: "验证跨单位回写",
        schedule: "rotation",
        weekdays: [],
        routines: [
          {
            id: "rt_29",
            name: "推日",
            exercises: [
              {
                exerciseId: "bench-press",
                sets: 3,
                repsMin: 8,
                repsMax: 12,
                weight: 50,
                weightUnit: "kg",
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
    store.applyPlan(user.userId, "plan_29", p.record!.version, 0, false);

    // Log workout in lb (110 lb) and sync back
    store.mutate(user.userId, {
      opId: "w29-lb",
      id: "wo_29_lb",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "推日",
        date: today,
        startedAt: `${today}T09:00:00Z`,
        endedAt: `${today}T09:40:00Z`,
        status: "completed",
        planId: "plan_29",
        planVersion: 1,
        routineId: "rt_29",
        exercises: [
          {
            id: "r1",
            exerciseId: "bench-press",
            targetIndex: 0,
            weightUnit: "lb",
            restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 110, reps: 10, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });
    syncWorkoutRoutineToActivePlan(store, user.userId, { workoutId: "wo_29_lb" });
    const afterLb = store.activePlan(user.userId)!.data.routines[0]!.exercises[0]!;
    assert.equal(afterLb.weightUnit, "lb");
    assert.ok(afterLb.weight! > 109 && afterLb.weight! < 112, `50 kg should convert to ~110.2 lb, got ${afterLb.weight}`);

    // Now log in kg and sync back -> converts ~110.2 lb back to ~50 kg
    store.mutate(user.userId, {
      opId: "w29-kg",
      id: "wo_29_kg",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "推日",
        date: today,
        startedAt: `${today}T10:00:00Z`,
        endedAt: `${today}T10:40:00Z`,
        status: "completed",
        planId: "plan_29",
        planVersion: 2,
        routineId: "rt_29",
        exercises: [
          {
            id: "r2",
            exerciseId: "bench-press",
            targetIndex: 0,
            weightUnit: "kg",
            restSeconds: 90,
            sets: [{ id: "s2", type: "normal", weight: 50, reps: 10, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });
    syncWorkoutRoutineToActivePlan(store, user.userId, { workoutId: "wo_29_kg" });
    const afterKg = store.activePlan(user.userId)!.data.routines[0]!.exercises[0]!;
    assert.equal(afterKg.weightUnit, "kg");
    assert.ok(afterKg.weight! > 49.5 && afterKg.weight! < 50.5, `~110.2 lb should convert back to ~50 kg, got ${afterKg.weight}`);
  } finally {
    db.close();
  }
});

test("#30 (P1) 回写同一生效计划保留原周期起点与轮换进度（第2周仍推 B，不重置为第1周与 A）", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const start10DaysAgo = shiftDay(today, -10);
    const startIso = `${start10DaysAgo}T08:00:00.000Z`;

    const p = store.mutate(user.userId, {
      opId: "p30-1",
      id: "plan_30",
      kind: "plan",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "plan_30",
        name: "四周 AB 轮换",
        weeks: 4,
        rationale: "周期锚点测试",
        schedule: "rotation",
        weekdays: [],
        routines: [
          {
            id: "rt_a",
            name: "训练 A",
            exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5 }],
          },
          {
            id: "rt_b",
            name: "训练 B",
            exercises: [{ exerciseId: "barbell-row", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5 }],
          },
        ],
      },
    });
    store.applyPlan(user.userId, "plan_30", p.record!.version, 0, false);

    // Backdate original activation to 10 days ago
    db.prepare("UPDATE active_plans SET updated_at=?, cycle_started_at=? WHERE user_id=?").run(startIso, startIso, user.userId);
    db.prepare("UPDATE plan_activations SET updated_at=?, cycle_started_at=? WHERE user_id=?").run(startIso, startIso, user.userId);

    const workoutDate = shiftDay(today, -2);
    store.mutate(user.userId, {
      opId: "wo30-a",
      id: "wo_30_a",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "训练 A",
        date: workoutDate,
        startedAt: `${workoutDate}T09:00:00Z`,
        endedAt: `${workoutDate}T09:45:00Z`,
        status: "completed",
        planId: "plan_30",
        planVersion: 1,
        routineId: "rt_a",
        exercises: [
          {
            id: "ra1",
            exerciseId: "bench-press",
            targetIndex: 0,
            restSeconds: 120,
            sets: Array.from({ length: 4 }, (_, i) => ({
              id: `s${i}`, type: "normal", weight: 60, reps: 10, seconds: 0, completed: true, rir: 2,
            })),
          },
        ],
      },
    });

    const beforeActive = store.activePlan(user.userId)!;
    const beforeCycle = planCycle(beforeActive, today)!;
    assert.equal(beforeCycle.week, 2);
    assert.equal(beforeCycle.start, start10DaysAgo);

    // Sync workout A back to plan_30
    syncWorkoutRoutineToActivePlan(store, user.userId, { workoutId: "wo_30_a" });

    const afterActive = store.activePlan(user.userId)!;
    const afterCycle = planCycle(afterActive, today)!;
    assert.equal(afterCycle.start, beforeCycle.start);
    assert.equal(afterCycle.end, beforeCycle.end);
    assert.equal(afterCycle.week, 2);

    const rec = recommendInCycle(
      afterActive,
      [{ date: workoutDate, planId: "plan_30", routineId: "rt_a", status: "completed" }],
      today,
    );
    assert.equal(rec?.routine.id, "rt_b");
  } finally {
    db.close();
  }
});

test("#31 AI 计划严格拒绝超出可用器械范围的主项或备选动作", async () => {
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "非法杠铃计划",
                weeks: 4,
                schedule: "rotation",
                weekdays: [],
                rationale: "测试越界器械",
                routines: [
                  {
                    id: "day_a",
                    name: "胸",
                    exercises: [
                      {
                        exerciseId: "bench-press", // barbell exercise while user only has bodyweight!
                        sets: 3,
                        repsMin: 8,
                        repsMax: 12,
                        weight: null,
                        seconds: 0,
                        restSeconds: 90,
                        targetRir: 2,
                        progression: "double",
                        increment: 2.5,
                        backupExerciseId: null,
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
    )) as typeof fetch;

  const { db, store, user, call } = makeCtx(fakeFetch, {
    baseUrl: "https://mock-ai.example/v1",
    apiKey: "test-key",
    model: "test-model",
  });
  try {
    // Configure profile equipment to bodyweight only
    store.mutate(user.userId, {
      opId: "prof-bw",
      id: "settings",
      kind: "profile",
      baseVersion: 0,
      deleted: false,
      data: {
        calories: 2200,
        protein: 150,
        carbs: 220,
        fat: 65,
        daysPerWeek: 3,
        restSeconds: 90,
        equipment: ["bodyweight"],
      },
    });
    const res = await call("/api/ai/plan", { method: "POST", body: { text: "帮我做一个徒手计划" } });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /器械/);
    assert.equal(store.list(user.userId, "plan").length, 0);
  } finally {
    db.close();
  }
});

test("#32 & #40 AI 训中调整向模型显式传递 weightUnit(lb) 且应用补丁时保留未完成组的 note 和 restAfterSeconds", async () => {
  let capturedPromptBody: unknown = null;
  const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
    capturedPromptBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "将剩余组次数调为 6 次以控疲劳",
                changes: [
                  {
                    exerciseRowId: "row_lb_1",
                    reason: "保留技术稳定",
                    patch: { reps: 6 },
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const { db, store, user, call } = makeCtx(fakeFetch, {
    baseUrl: "https://mock-ai.example/v1",
    apiKey: "test-key",
    model: "test-model",
  });
  try {
    const today = localDate();
    store.mutate(user.userId, {
      opId: "w32-active",
      id: "wo_active_lb",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "磅数卧推",
        date: today,
        startedAt: `${today}T10:00:00Z`,
        endedAt: null,
        status: "active",
        exercises: [
          {
            id: "row_lb_1",
            exerciseId: "bench-press",
            weightUnit: "lb",
            restSeconds: 90,
            sets: [
              { id: "s_done", type: "normal", weight: 135, reps: 8, seconds: 0, completed: true, rir: 2, note: "热身顺畅" },
              { id: "s_open", type: "normal", weight: 135, reps: 8, seconds: 0, completed: false, rir: null, note: "暂停1秒", restAfterSeconds: 150 },
            ],
          },
        ],
      },
    });

    const res = await call("/api/ai/adapt-workout", {
      method: "POST",
      body: { workoutId: "wo_active_lb", text: "有点累，减少次数" },
    });
    assert.equal(res.status, 200);
    const proposal = (await res.json()) as WorkoutAdaptation;

    // #32: Model payload MUST include weightUnit: "lb"
    const promptUserMsg = (capturedPromptBody as { messages: { role: string; content: string }[] }).messages[1]!.content;
    const promptPayload = JSON.parse(promptUserMsg) as { workout: { exercises: { weightUnit: string }[] } };
    assert.equal(promptPayload.workout.exercises[0]!.weightUnit, "lb");
    assert.equal(proposal.changes[0]!.before.weightUnit, "lb");

    // #40: Applying adaptation preserves note & restAfterSeconds on incomplete set
    const currentWorkout = store.get(user.userId, "workout", "wo_active_lb")!.data as Workout;
    const adapted = applyWorkoutAdaptation(
      currentWorkout,
      proposal,
      ["row_lb_1"],
      store.catalogueMap(user.userId),
      () => "new_set_id",
    );
    const openSet = adapted.exercises[0]!.sets.find((s) => s.id === "s_open")!;
    assert.equal(openSet.reps, 6);
    assert.equal(openSet.weight, 135);
    assert.equal(openSet.note, "暂停1秒");
    assert.equal(openSet.restAfterSeconds, 150);

    // Concurrent edit to note / restAfterSeconds triggers validation rejection
    const concurrentlyEdited: Workout = JSON.parse(JSON.stringify(currentWorkout));
    concurrentlyEdited.exercises[0]!.sets[1]!.restAfterSeconds = 180;
    assert.throws(() => validateWorkoutAdjustment(concurrentlyEdited, proposal.changes[0]!, store.catalogueMap(user.userId)));
  } finally {
    db.close();
  }
});

test("#33 混合睡眠样本（60分有时间戳核心 + 45分仅时长深睡）报表完整显示 105 分钟并标记无时间戳分期", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const res = upsertDailyHealth(store, user.userId, {
      date: today,
      sleepSamples: [
        { stage: "core", startedAt: `${today}T01:00:00+08:00`, endedAt: `${today}T02:00:00+08:00` },
        { stage: "deep", durationMinutes: 45 },
      ],
    });
    assert.equal(res.daily.sleepMinutes, 105);
    assert.equal(res.daily.sleepCoreMinutes, 60);
    assert.equal(res.daily.sleepDeepMinutes, 45);

    const rawRow = db.prepare("SELECT data FROM apple_health_daily WHERE user_id=? AND date=?").get(user.userId, today) as { data: string };
    const report = buildSleepReport([JSON.parse(rawRow.data)], today, today, 1);
    const day = report.series[0]!;
    assert.equal(day.minutes, 105);
    assert.equal(day.source, "mixed");
    assert.equal(day.stages?.core, 60);
    assert.equal(day.stages?.deep, 45);
    assert.deepEqual(day.untimedStages, ["deep"]);
  } finally {
    db.close();
  }
});

test("#34, #35, #36 & #39 有氧目标不计力量训练、Apple训练日归为训练日、历史负荷按当日体重、配速按项目拆分", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const d1 = shiftDay(today, -3);
    const d2 = shiftDay(today, -2);
    const d3 = shiftDay(today, -1);

    // Profile with birthDate for HRmax calculation
    store.mutate(user.userId, {
      opId: "p-prof",
      id: "settings",
      kind: "profile",
      baseVersion: 0,
      deleted: false,
      data: {
        calories: 2200, protein: 150, carbs: 220, fat: 65, daysPerWeek: 4, restSeconds: 90,
        energyProfile: {
          heightCm: 175, weightKg: 75, weightDate: d1, birthDate: "1995-01-01", sex: "male", activityFactor: 1.55, context: "general",
        },
      },
    });

    // Weight 75kg on d1, later 90kg on today
    store.mutate(user.userId, {
      opId: "wt-d1", id: `weight_${d1}`, kind: "weight", baseVersion: 0, deleted: false,
      data: { date: d1, weight: 75, bodyFat: null },
    });
    store.mutate(user.userId, {
      opId: "wt-today", id: `weight_${today}`, kind: "weight", baseVersion: 0, deleted: false,
      data: { date: today, weight: 90, bodyFat: null },
    });

    // Assisted exercise on d1 with 25 kg assistance x 10 reps
    const assistedEx = [...store.catalogueMap(user.userId).values()].find((e) => e.mode === "assisted")!;
    store.mutate(user.userId, {
      opId: "wo-d1", id: "wo_d1_assist", kind: "workout", baseVersion: 0, deleted: false,
      data: {
        title: "辅助拉",
        date: d1,
        startedAt: `${d1}T09:00:00Z`,
        endedAt: `${d1}T09:30:00Z`,
        status: "completed",
        exercises: [
          {
            id: "ex1", exerciseId: assistedEx.id, restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 25, reps: 10, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });

    // Diet: d2 has ONLY an Apple Watch strength workout (2300 kcal), d3 is rest (1700 kcal)
    store.mutate(user.userId, {
      opId: "diet-d2", id: "diet_d2", kind: "diet", baseVersion: 0, deleted: false,
      data: { date: d2, meal: "lunch", name: "训练餐", calories: 2300, protein: 160, carbs: 250, fat: 65 },
    });
    store.mutate(user.userId, {
      opId: "diet-d3", id: "diet_d3", kind: "diet", baseVersion: 0, deleted: false,
      data: { date: d3, meal: "lunch", name: "休息餐", calories: 1700, protein: 140, carbs: 160, fat: 55 },
    });

    // Insert Apple Watch 75min TraditionalStrengthTraining with high HR (165 bpm) on d2
    const insertAw = (id: string, day: string, type: string, dur: number, dist: number | null, hr: number | null) => {
      db.prepare(
        `INSERT INTO apple_health_workouts (id, user_id, identity_key, ended_at, received_at, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.userId, `k_${id}`, `${day}T11:15:00+08:00`, new Date().toISOString(),
        JSON.stringify({
          externalWorkoutId: id,
          activityType: type,
          environment: "outdoor",
          captureMethod: "workout",
          startedAt: `${day}T10:00:00+08:00`,
          endedAt: `${day}T11:15:00+08:00`,
          durationSeconds: dur,
          durationKind: "workout_active",
          distanceMeters: dist,
          heartRate: hr ? { avgBpm: hr, maxBpm: hr + 12 } : undefined,
          annotation: {},
        }),
      );
    };
    insertAw("aw_str_d2", d2, "HKWorkoutActivityTypeTraditionalStrengthTraining", 4500, null, 165);

    const aWithStrengthOnly = getWebAnalytics(store, user.userId, { period: 14, through: today });
    // #34: Strength workout with high HR must NOT count toward WHO weekly aerobic target
    assert.equal(aWithStrengthOnly.appleWorkouts.whoCardio.equivalentMinutes, 0);
    assert.equal(aWithStrengthOnly.appleWorkouts.whoCardio.completionPct, 0);

    // #35: d2 (Apple Watch workout only) is classified as a training day, d3 as rest day
    assert.equal(aWithStrengthOnly.nutrition.energy.trainingDaysLogged, 1);
    assert.equal(aWithStrengthOnly.nutrition.energy.restDaysLogged, 1);
    assert.equal(aWithStrengthOnly.nutrition.energy.trainingDayAvgKcal, 2300);
    assert.equal(aWithStrengthOnly.nutrition.energy.restDayAvgKcal, 1700);

    // #36: Historical load on d1 stays anchored to 75 kg (500) even when through=today has a 90 kg weigh-in
    const aPast = getWebAnalytics(store, user.userId, { period: 14, through: d1 });
    const d1LoadPast = aPast.acwr.series.find((s) => s.date === d1)!.load;
    const d1LoadToday = aWithStrengthOnly.acwr.series.find((s) => s.date === d1)!.load;
    const expectedD1Load = Math.round((75 - 25) * 10 * assistedEx.volumeMultiplier);
    assert.equal(d1LoadPast, expectedD1Load);
    assert.equal(d1LoadToday, expectedD1Load);

    // #39: Running (5km/30min = 6 min/km) & Cycling (10km/30min = 20 km/h) separated by sportCategory
    insertAw("aw_run_1", d1, "HKWorkoutActivityTypeRunning", 1800, 5000, 150);
    insertAw("aw_cyc_1", d3, "HKWorkoutActivityTypeCycling", 1800, 10000, 140);
    const aSports = getWebAnalytics(store, user.userId, { period: 14, through: today });
    assert.equal(aSports.appleWorkouts.paceTrendsBySport.run.length, 1);
    assert.equal(aSports.appleWorkouts.paceTrendsBySport.run[0]!.paceMinPerKm, 6);
    assert.equal(aSports.appleWorkouts.paceTrendsBySport.cycle.length, 1);
    assert.equal(aSports.appleWorkouts.paceTrendsBySport.cycle[0]!.speedKmh, 20);
  } finally {
    db.close();
  }
});

test("#37 后到的部分小时步数按小时合并，不覆盖前一天已有整日总量", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const yest = shiftDay(today, -1);

    const readSteps = () =>
      (JSON.parse(
        (db.prepare("SELECT data FROM apple_health_daily WHERE user_id=? AND date=?").get(user.userId, yest) as { data: string }).data,
      ) as { steps?: number }).steps;

    // Upload 3 hours for yesterday: 1000 + 800 + 800 = 2600
    upsertDailyHealth(store, user.userId, {
      date: today,
      shortcutGenVersion: "3",
      occurredAt: `${today}T09:00:00+08:00`,
      stepsSamples: [
        `${yest} 08:00|1000`,
        `${yest} 09:00|800`,
        `${yest} 10:00|800`,
      ],
    });
    assert.equal(readSteps(), 2600);

    // Later partial upload sends ONLY hour 09 with corrected 900 -> total merges to 2700 (not 900!)
    upsertDailyHealth(store, user.userId, {
      date: today,
      shortcutGenVersion: "4",
      occurredAt: `${today}T12:00:00+08:00`,
      stepsSamples: [`${yest} 09:00|900`],
    });
    assert.equal(readSteps(), 2700);

    // Empty samples upload preserves existing 2700
    upsertDailyHealth(store, user.userId, {
      date: today,
      shortcutGenVersion: "4",
      occurredAt: `${today}T14:00:00+08:00`,
      stepsSamples: [],
    });
    assert.equal(readSteps(), 2700);
  } finally {
    db.close();
  }
});

test("#38 户外跑步 outdoorRunning 与网页跑步预设正确匹配，且仍严格区分室内/室外环境", () => {
  const session: LiveCardioSession = {
    id: "cs_1",
    presetId: "run_outdoor",
    label: "户外跑步",
    activityType: "running",
    environment: "outdoor",
    startedAt: "2026-11-27T08:00:00.000Z",
    finishedAt: "2026-11-27T08:30:00.000Z",
    appleSyncRequestedAt: "2026-11-27T08:30:10.000Z",
    timing: { elapsedSeconds: 1800, runningSince: null },
    distanceKm: "5",
    notes: "",
    feeling: null,
    laps: [],
  };

  assert.equal(
    matchesCardioAppleWorkout(session, {
      activityType: "outdoorRunning",
      environment: "outdoor",
      startedAt: "2026-11-27T08:00:10.000Z",
      endedAt: "2026-11-27T08:30:05.000Z",
    }),
    true,
  );
  assert.equal(
    matchesCardioAppleWorkout(session, {
      activityType: "running",
      environment: "outdoor",
      startedAt: "2026-11-27T08:00:10.000Z",
      endedAt: "2026-11-27T08:30:05.000Z",
    }),
    true,
  );
  // Indoor running must NOT falsely match an outdoor running session
  assert.equal(
    matchesCardioAppleWorkout(session, {
      activityType: "indoorRunning",
      environment: "unknown",
      startedAt: "2026-11-27T08:00:10.000Z",
      endedAt: "2026-11-27T08:30:05.000Z",
    }),
    false,
  );
});

test("R1-R3 & #41-#42 排期墓碑重试幂等、safeUuid、登录自动同步离线队列与 AI 饮食冲突校验", () => {
  const { db, store, user } = makeCtx();
  try {
    // R3: Tombstone rebuild with baseVersion=0 and identical opId is idempotent on retry
    const d = shiftDay(localDate(), 4);
    saveWebScheduleDay(store, user.userId, d, {
      mode: "rest", title: "初设休息", planId: null, routineId: null, templateId: null, notes: "", exercises: [],
    });
    clearWebScheduleDay(store, user.userId, d);
    const rebuildInput = {
      mode: "rest" as const, title: "重建休息", planId: null, routineId: null, templateId: null, notes: "", exercises: [],
      opId: "tombstone-rebuild-op-1", baseVersion: 0,
    };
    const r1 = saveWebScheduleDay(store, user.userId, d, rebuildInput);
    const r2 = saveWebScheduleDay(store, user.userId, d, rebuildInput);
    assert.equal(r1.record?.version, r2.record?.version);
  } finally {
    db.close();
  }

  // R1: safeUuid works cleanly
  const u1 = safeUuid();
  const u2 = safeUuid();
  assert.ok(u1.length >= 16 && u1 !== u2);

  // #41 & #42 source guards
  const root = process.cwd();
  const appTsx = fs.readFileSync(path.join(root, "packages/web/src/App.tsx"), "utf8");
  assert.match(appTsx, /syncOfflineQueue\(userId,\s*\{\s*silent:\s*true\s*\}\)/);

  const aiModals = fs.readFileSync(path.join(root, "packages/web/src/components/ai/AiModals.tsx"), "utf8");
  assert.match(aiModals, /resultsByOp/);
  assert.match(aiModals, /outcome\?\.status === "applied"/);
  assert.match(aiModals, /conflictCount > 0/);
  assert.doesNotMatch(aiModals, /crypto\.randomUUID\(\)/);
});
