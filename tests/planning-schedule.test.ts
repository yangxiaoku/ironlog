import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSetPr,
  evaluateExerciseProgression,
  exerciseCatalogue,
  exercisePrBaselines,
  localDate,
  prOpportunityForTarget,
  projectScheduleRange,
  resolveRoutineWithTelemetry,
  routineTargets,
  type Plan,
  type Routine,
  type Workout,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";

function fixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("sched-owner");
  const other = auth.login("sched-other");
  const call = (url: string, options: { token?: string; method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: { Authorization: "Bearer " + (options.token ?? owner.token), "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  let seq = 0;
  const save = (kind: "workout" | "scheduledDay", id: string, data: unknown, baseVersion = 0) =>
    store.mutate(owner.userId, { id, kind, opId: "sched-" + seq++, data, baseVersion, deleted: false });
  return { db, app, store, call, save, owner, other };
}

test("渐进评估与 PR 基准、实时破纪录检测与减载建议", () => {
  const today = localDate();
  const prev = shiftDay(today, -3);
  const older = shiftDay(today, -6);

  const mkSet = (id: string, weight: number, reps: number, completed = true, type: "normal" | "warmup" = "normal") => ({
    id, type, weight, reps, seconds: 0, completed, rir: 2,
  });

  const workouts: { id: string; data: Workout }[] = [
    {
      id: "w1",
      data: {
        title: "推日", date: older, startedAt: older + "T10:00:00Z", endedAt: older + "T11:00:00Z",
        status: "completed", notes: "", feeling: "fatigued", source: "manual", rawPrompt: "",
        planId: null, planVersion: null, routineId: null, targetSnapshot: null,
        exercises: [{ id: "r1", exerciseId: "bench-press", restSeconds: 90, snapshot: null, sets: [
          mkSet("s0", 140, 5, true, "warmup"),
          mkSet("s1", 70, 8),
          mkSet("s2", 70, 7),
        ] }],
        restEndsAt: null, adjustments: [],
      },
    },
    {
      id: "w2",
      data: {
        title: "推日", date: prev, startedAt: prev + "T10:00:00Z", endedAt: prev + "T11:00:00Z",
        status: "completed", notes: "", feeling: "fatigued", source: "manual", rawPrompt: "",
        planId: null, planVersion: null, routineId: null, targetSnapshot: null,
        exercises: [{ id: "r2", exerciseId: "bench-press", restSeconds: 90, snapshot: null, sets: [
          mkSet("s3", 72.5, 10),
          mkSet("s4", 72.5, 10),
          mkSet("s5", 72.5, 10),
        ] }],
        restEndsAt: null, adjustments: [],
      },
    },
  ];

  const baselines = exercisePrBaselines(workouts, exerciseCatalogue, { date: today });
  const benchPr = baselines.get("bench-press:reps");
  assert.ok(benchPr);
  assert.equal(benchPr.weight, 72.5);
  assert.equal(benchPr.oneRepMax, 96.67);

  // Beat weight PR at 75 kg -> weight + 1RM PR? (75 * 1.2667 = 95, so weight PR only; 75 x 10 = 100 breaks both)
  const hitWeight = checkSetPr({ type: "normal", weight: 75, reps: 8 }, "reps", benchPr);
  assert.deepEqual(hitWeight.map((h) => h.metric), ["weight"]);
  const hitBoth = checkSetPr({ type: "normal", weight: 75, reps: 10 }, "reps", benchPr);
  assert.deepEqual(hitBoth.map((h) => h.metric), ["weight", "oneRepMax"]);

  // Warmup never counts as PR
  assert.deepEqual(checkSetPr({ type: "warmup", weight: 150, reps: 5 }, "reps", benchPr), []);

  // Nudge opportunity for 72.5kg should compute >=10? Wait 72.5*(1+11/30) already <=10 -> no, 75*(1+9/30)=97.5 > 96.67 -> 9 reps
  const nudge = prOpportunityForTarget({ weight: 75, reps: 8, seconds: 0 }, "reps", benchPr);
  assert.equal(nudge?.kind, "will_break_weight");

  // Double progression hit all 3x10 -> weight increases to 75
  const item = {
    exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 10, weight: 70,
    seconds: 0, restSeconds: 90, targetRir: 2, progression: "double" as const, increment: 2.5, backupExerciseId: "incline-dumbbell",
  };
  const progHit = evaluateExerciseProgression(item, workouts[1]!.data.exercises[0], undefined, [], "reps", false);
  assert.equal(progHit.status, "progress_weight");
  assert.equal(progHit.weight, 75);

  // Consecutive fatigued streak without hitting progression -> plateau deload prompt
  const plateauItem = { ...item, repsMax: 12 };
  const progDeload = evaluateExerciseProgression(
    plateauItem,
    workouts[0]!.data.exercises[0],
    undefined,
    [
      { feeling: "fatigued", row: workouts[1]!.data.exercises[0]! },
      { feeling: "fatigued", row: workouts[0]!.data.exercises[0]! },
    ],
    "reps",
    false,
  );
  assert.equal(progDeload.status, "plateau_deload");
  assert.ok(progDeload.deloadWeight !== null && progDeload.deloadWeight < 70);
});

test("未来排期接口：未来日程投影、指派、顺延、休息、PR 接口与账号隔离", async () => {
  const { db, call, save, other } = fixture();
  try {
    const today = localDate();
    const yesterday = shiftDay(today, -1);
    const tomorrow = shiftDay(today, 1);
    const dayAfter = shiftDay(today, 2);

    // Seed completed bench press history
    save("workout", "hist1", {
      date: yesterday, title: "推力历史",
      startedAt: yesterday + "T09:00:00Z", endedAt: yesterday + "T09:45:00Z", status: "completed",
      exercises: [{ id: "e1", exerciseId: "bench-press", restSeconds: 90, sets: [
        { id: "s1", type: "normal", weight: 60, reps: 10, completed: true, rir: 2 },
        { id: "s2", type: "normal", weight: 60, reps: 10, completed: true, rir: 2 },
        { id: "s3", type: "normal", weight: 60, reps: 10, completed: true, rir: 2 },
      ] }],
    });

    // Create & apply plan with progression & backup exercise
    const draftRes = await call("/api/plans/drafts", {
      method: "POST",
      body: {
        name: "双渐进推拉",
        weeks: 4,
        schedule: "rotation",
        routines: [
          {
            id: "push",
            name: "推 · 上肢",
            exercises: [{
              exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 10, weight: 60,
              restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: "incline-dumbbell",
            }],
          },
          {
            id: "pull",
            name: "拉 · 背部",
            exercises: [{
              exerciseId: "barbell-row", sets: 3, repsMin: 8, repsMax: 12, weight: 50,
              restSeconds: 90, targetRir: 2, progression: "linear", increment: 2.5, backupExerciseId: null,
            }],
          },
        ],
        rationale: "推拉交替 + 自动双渐进",
      },
    });
    assert.equal(draftRes.status, 201);
    const { record: planRec } = await draftRes.json() as any;
    assert.equal((await call("/api/plans/apply", {
      method: "POST",
      body: { id: planRec.id, version: planRec.version, expectedRevision: 0 },
    })).status, 200);

    // Exercise PR endpoint returns baseline 60kg & isolates other user
    const prReq = { date: today, startedAt: today + "T12:00:00Z", exercises: [{ id: "bench-press", mode: "reps" }] };
    const prs = await (await call("/api/web/exercise-prs", { method: "POST", body: prReq })).json() as any[];
    assert.equal(prs[0].weight, 60);
    assert.deepEqual(await (await call("/api/web/exercise-prs", { method: "POST", body: prReq, token: other.token })).json(), []);

    // Schedule PUT for tomorrow (explicit workout with higher target breaking 60kg PR)
    const putRes = await call(`/api/web/schedule/${tomorrow}`, {
      method: "PUT",
      body: {
        mode: "workout",
        title: "明日冲刺卧推",
        planId: planRec.id,
        routineId: "push",
        exercises: [{
          exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 10, weight: 62.5,
          restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: "incline-dumbbell",
        }],
      },
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json() as any;
    assert.equal(putData.detail.day.status, "scheduled");
    assert.equal(putData.detail.telemetry.exercises[0].pr.kind, "will_break_weight");
    assert.equal(putData.detail.telemetry.exercises[0].backup.id, "incline-dumbbell");

    // Optimistic version conflict on stale baseVersion
    const conflictRes = await call(`/api/web/schedule/${tomorrow}`, {
      method: "PUT",
      body: { mode: "rest", title: "冲突", baseVersion: 0 },
    });
    assert.equal(conflictRes.status, 409);

    // Other user cannot read owner's explicit tomorrow schedule
    const otherDay = await (await call(`/api/web/schedule/${tomorrow}`, { token: other.token })).json() as any;
    assert.equal(otherDay.override, null);

    // Shift tomorrow's scheduled workout -> dayAfter
    const shiftRes = await call("/api/web/schedule/shift", {
      method: "POST",
      body: { fromDate: tomorrow, toDate: dayAfter },
    });
    assert.equal(shiftRes.status, 200);
    const shifted = await shiftRes.json() as any;
    assert.equal(shifted.from.day.status, "rest");
    assert.equal(shifted.to.day.status, "scheduled");
    assert.equal(shifted.to.day.title, "明日冲刺卧推");

    // Routine endpoint supports source=scheduled on future date and returns progression + backup + PR
    const routineRes = await call(`/api/web/routine?source=scheduled&id=${dayAfter}&date=${dayAfter}`);
    assert.equal(routineRes.status, 200);
    const routineData = await routineRes.json() as any;
    assert.equal(routineData.exercises[0].backup.id, "incline-dumbbell");
    assert.equal(routineData.exercises[0].pr.kind, "will_break_weight");

    // Mark today as explicit rest -> /api/web/today reflects restToday: true & planned: null
    assert.equal((await call(`/api/web/schedule/${today}`, {
      method: "PUT",
      body: { mode: "rest", title: "今日休息" },
    })).status, 200);
    const todayRes = await (await call("/api/web/today")).json() as any;
    assert.equal(todayRes.restToday, true);
    assert.equal(todayRes.planned, null);

    // Clear today's rest override -> restores automatic plan recommendation
    assert.equal((await call(`/api/web/schedule/${today}`, { method: "DELETE" })).status, 200);
    const todayRestored = await (await call("/api/web/today")).json() as any;
    assert.equal(todayRestored.restToday, false);
    assert.equal(todayRestored.planned.id, "push");

    // Week schedule endpoint returns 14+ day horizon & weekly muscle forecast
    const rangeRes = await (await call(`/api/web/schedule?from=${yesterday}&through=${shiftDay(today, 13)}`)).json() as any;
    assert.ok(rangeRes.days.some((d: any) => d.date === dayAfter && d.status === "scheduled"));
    assert.ok(Array.isArray(rangeRes.weekForecast.muscles));
  } finally { db.close(); }
});

test("resolveRoutineWithTelemetry 与 routineTargets 一致性及无序历史下的轮换投影", () => {
  const today = localDate();
  const d1 = shiftDay(today, -6);
  const d2 = shiftDay(today, -3);
  const d3 = shiftDay(today, -1);

  const mkSet = (id: string, weight: number, reps: number) => ({
    id, type: "normal" as const, weight, reps, seconds: 0, completed: true, rir: 2,
  });

  const routineA: Routine = {
    id: "day-a",
    name: "推日 A",
    exercises: [
      {
        // Case 1: prescribed weight changed vs previous targetSnapshot -> resets to prescribed 80kg
        exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 10, weight: 80, seconds: 0,
        restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null,
      },
      {
        // Case 2: missing from routine history, falls back to another routine's historicalRow + plateau detection
        exerciseId: "barbell-squat", sets: 3, repsMin: 8, repsMax: 10, weight: null, seconds: 0,
        restSeconds: 120, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null,
      },
    ],
  };
  const routineB: Routine = {
    id: "day-b",
    name: "拉日 B",
    exercises: [
      {
        exerciseId: "barbell-row", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0,
        restSeconds: 90, targetRir: 2, progression: "linear", increment: 2.5, backupExerciseId: null,
      },
    ],
  };
  const plan: Plan = {
    name: "推拉轮换", weeks: 4, schedule: "rotation", weekdays: [],
    routines: [routineA, routineB], rationale: "测试一致性",
  };

  // Unsorted workouts (d3 before d1 before d2) + one recent squat miss outside plan for plateau + fallback
  const workouts: Workout[] = [
    {
      title: "拉日 B", date: d3, startedAt: d3 + "T10:00:00Z", endedAt: d3 + "T11:00:00Z",
      status: "completed", notes: "", feeling: "balanced", source: "manual", rawPrompt: "",
      planId: "plan-1", planVersion: 1, routineId: "day-b", targetSnapshot: null,
      exercises: [{ id: "e-row", exerciseId: "barbell-row", restSeconds: 90, snapshot: null, sets: [mkSet("s1", 60, 10)] }],
    },
    {
      title: "推日 A", date: d1, startedAt: d1 + "T10:00:00Z", endedAt: d1 + "T11:00:00Z",
      status: "completed", notes: "", feeling: "balanced", source: "manual", rawPrompt: "",
      planId: "plan-1", planVersion: 1, routineId: "day-a",
      targetSnapshot: {
        routineId: "day-a",
        exercises: [{ exerciseId: "bench-press", weight: 70, reps: 8, seconds: 0 }],
      },
      exercises: [{ id: "e-bp", exerciseId: "bench-press", restSeconds: 90, snapshot: null, sets: [mkSet("s2", 70, 10), mkSet("s3", 70, 10), mkSet("s4", 70, 10)] }],
    },
    {
      title: "自由深蹲", date: d2, startedAt: d2 + "T10:00:00Z", endedAt: d2 + "T11:00:00Z",
      status: "completed", notes: "", feeling: "fatigued", source: "manual", rawPrompt: "",
      planId: null, planVersion: null, routineId: null, targetSnapshot: null,
      exercises: [{ id: "e-sq2", exerciseId: "barbell-squat", restSeconds: 120, snapshot: null, sets: [mkSet("s5", 100, 6)] }],
    },
    {
      title: "早期深蹲", date: shiftDay(today, -8), startedAt: shiftDay(today, -8) + "T10:00:00Z", endedAt: shiftDay(today, -8) + "T11:00:00Z",
      status: "completed", notes: "", feeling: "fatigued", source: "manual", rawPrompt: "",
      planId: null, planVersion: null, routineId: null, targetSnapshot: null,
      exercises: [{ id: "e-sq1", exerciseId: "barbell-squat", restSeconds: 120, snapshot: null, sets: [mkSet("s6", 95, 5)] }],
    },
  ];

  const targets = routineTargets(routineA, workouts, "plan-1", today, exerciseCatalogue);
  const telemetry = resolveRoutineWithTelemetry({
    routine: routineA, planId: "plan-1", date: today, workouts, catalogue: exerciseCatalogue,
  });

  assert.equal(telemetry.exercises.length, 2);
  assert.equal(telemetry.exercises[0]!.weight, targets[0]!.weight);
  assert.equal(telemetry.exercises[0]!.reps, targets[0]!.reps);
  assert.equal(telemetry.exercises[0]!.weight, 80);
  assert.equal(telemetry.exercises[0]!.pr?.kind, "will_break_weight");

  assert.equal(telemetry.exercises[1]!.weight, targets[1]!.weight);
  assert.equal(telemetry.exercises[1]!.reps, targets[1]!.reps);
  assert.equal(telemetry.exercises[1]!.weight, 100);
  assert.equal(telemetry.exercises[1]!.progression.status, "plateau_deload");

  const projected = projectScheduleRange({
    from: today,
    through: shiftDay(today, 6),
    todayDate: today,
    workouts,
    appleActivities: [],
    scheduledDays: new Map(),
    activePlan: { id: "plan-1", version: 1, updatedAt: d1 + "T00:00:00Z", data: plan },
    catalogue: exerciseCatalogue,
    daysPerWeek: 4,
  });
  const firstProjected = projected.find((d) => d.status === "projected");
  assert.ok(firstProjected);
  assert.equal(firstProjected.routineId, "day-a");
});
