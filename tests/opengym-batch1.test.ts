import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMuscleRetention,
  kgToUnit,
  LB_TO_KG,
  muscleIntensityMapFromExercises,
  summarizeWorkoutMuscleSets,
  weightToKg,
  workoutMetrics,
  workoutSchema,
  type Exercise,
  type Workout,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import { getWebToday } from "../packages/server/src/web-training.js";
import { getWebWorkoutReport } from "../packages/server/src/web-workout-report.js";
import { appendRoutineExercises, buildCoachQuickAdvice } from "../packages/web/src/lib/coach-quick.js";
import type { WorkoutExercise } from "../packages/web/src/lib/domain.js";

function makeFixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("batch1-owner");
  const call = (url: string, options: { method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: "Bearer " + owner.token,
        "Content-Type": "application/json",
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  return { db, app, store, owner, call };
}

const sampleCatalogue: Exercise[] = [
  {
    id: "bench-press",
    name: "平板杠铃卧推",
    englishName: "Barbell Bench Press",
    aliases: ["卧推"],
    muscle: "chest",
    secondaryMuscles: ["shoulders", "arms"],
    equipment: "barbell",
    mode: "reps",
    volumeMultiplier: 1,
    instructions: ["卧推"],
    mistakes: [],
    custom: false,
  },
  {
    id: "pull-up",
    name: "引体向上",
    englishName: "Pull Up",
    aliases: [],
    muscle: "back",
    secondaryMuscles: ["arms"],
    equipment: "bodyweight",
    mode: "reps",
    volumeMultiplier: 1,
    instructions: ["引体"],
    mistakes: [],
    custom: false,
  },
];

test("1.1 summarizeWorkoutMuscleSets & muscleIntensityMapFromExercises credit primary 1.0 and secondary 0.5", () => {
  const progress = summarizeWorkoutMuscleSets(
    [
      {
        exerciseId: "bench-press",
        sets: [
          { type: "warmup", completed: true, reps: 10 },
          { type: "normal", completed: true, reps: 8 },
          { type: "normal", completed: true, reps: 8 },
          { type: "normal", completed: false, reps: 8 },
        ],
      },
    ],
    sampleCatalogue,
  );
  const chest = progress.find((p) => p.muscle === "chest");
  const shoulders = progress.find((p) => p.muscle === "shoulders");
  assert.ok(chest);
  assert.equal(chest.plannedSets, 3);
  assert.equal(chest.completedSets, 2);
  assert.ok(shoulders);
  assert.equal(shoulders.plannedSets, 1.5);
  assert.equal(shoulders.completedSets, 1);

  const intensities = muscleIntensityMapFromExercises(
    [{ exerciseId: "bench-press", sets: 4 }],
    sampleCatalogue,
  );
  assert.equal(intensities.chest, 1);
  assert.equal(intensities.shoulders, 0.5);
});

test("1.1 computeMuscleRetention decays from 1.00 (fresh <=3d) to 0.50 floor (>=14d / untrained)", () => {
  const wFresh: Pick<Workout, "status" | "date" | "exercises"> = {
    status: "completed",
    date: "2026-11-26",
    exercises: [
      {
        id: "ex1",
        exerciseId: "bench-press",
        restSeconds: 90,
        snapshot: null,
        sets: [
          { id: "s1", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 },
          { id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 },
        ],
      },
    ],
  };
  const wOld: Pick<Workout, "status" | "date" | "exercises"> = {
    status: "completed",
    date: "2026-11-10",
    exercises: [
      {
        id: "ex2",
        exerciseId: "pull-up",
        restSeconds: 90,
        snapshot: null,
        sets: [{ id: "s3", type: "normal", weight: 0, reps: 10, seconds: 0, completed: true, rir: 2 }],
      },
    ],
  };
  const retention = computeMuscleRetention([wFresh, wOld], sampleCatalogue, "2026-11-27");
  const chest = retention.find((r) => r.muscle === "chest")!;
  const back = retention.find((r) => r.muscle === "back")!;
  const legs = retention.find((r) => r.muscle === "legs")!;
  assert.equal(chest.retention, 1);
  assert.equal(chest.status, "fresh");
  assert.equal(chest.daysSinceLast, 1);
  assert.equal(back.retention, 0.5);
  assert.equal(back.status, "due");
  assert.equal(back.daysSinceLast, 17);
  assert.equal(legs.retention, 0.5);
  assert.equal(legs.daysSinceLast, null);
});

test("1.2 per-exercise kg/lb unit override converts cleanly to unified kg volume/1RM & persists set note", async () => {
  assert.equal(weightToKg(100, "kg"), 100);
  assert.equal(weightToKg(100, "lb"), Math.round(100 * LB_TO_KG * 100) / 100);
  assert.ok(Math.abs(kgToUnit(45.36, "lb") - 100) <= 0.1);

  const workout = workoutSchema.parse({
    title: "推举日",
    date: "2026-11-27",
    startedAt: "2026-11-27T10:00:00+08:00",
    endedAt: "2026-11-27T10:45:00+08:00",
    status: "completed",
    exercises: [
      {
        id: "row_lb",
        exerciseId: "bench-press",
        weightUnit: "lb",
        restSeconds: 90,
        snapshot: {
          name: "平板杠铃卧推",
          muscle: "chest",
          equipment: "machine",
          mode: "reps",
          volumeMultiplier: 1,
        },
        sets: [
          {
            id: "set_1",
            type: "normal",
            weight: 100,
            reps: 10,
            seconds: 0,
            completed: true,
            rir: 2,
            note: "器械标磅，左肩略紧",
          },
        ],
      },
    ],
  });

  const metrics = workoutMetrics(workout, sampleCatalogue);
  const expectedVol = Math.round(weightToKg(100, "lb") * 10 * 10) / 10;
  assert.equal(metrics.volume, expectedVol);
  assert.equal(workout.exercises[0]!.sets[0]!.note, "器械标磅，左肩略紧");

  const { store, owner, call } = makeFixture();
  const res = await call("/api/records", {
    method: "POST",
    body: { opId: "op_w1", id: "w_lb_1", kind: "workout", baseVersion: 0, deleted: false, data: workout },
  });
  assert.equal(res.status, 200);
  const report = getWebWorkoutReport(store, owner.userId, "w_lb_1");
  assert.equal(report.volume, expectedVol);
  assert.equal(report.exercises[0]!.weightUnit, "lb");
  assert.equal(report.exercises[0]!.completed[0]!.note, "器械标磅，左肩略紧");

  const analytics = getWebAnalytics(store, owner.userId, { through: "2026-11-27", period: 30 });
  assert.equal(analytics.trainingSummary.tonnageKg, Math.round(expectedVol));
  assert.ok(Array.isArray(analytics.muscles.retention) && analytics.muscles.retention.length === 6);
});

test("1.3 buildCoachQuickAdvice handles all 4 scenarios and appendRoutineExercises preserves existing sets", () => {
  const row: WorkoutExercise = {
    id: "ex_a",
    exerciseId: "bench-press",
    restSeconds: 90,
    weightUnit: "kg",
    backupExerciseId: "incline-dumbbell",
    backupExerciseName: "上斜哑铃卧推",
    snapshot: { name: "平板杠铃卧推", muscle: "chest", equipment: "barbell", mode: "reps", volumeMultiplier: 1 },
    sets: [
      { id: "s1", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 },
      { id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: false, rir: null },
      { id: "s3", type: "normal", weight: 80, reps: 8, seconds: 0, completed: false, rir: null },
      { id: "s4", type: "normal", weight: 80, reps: 8, seconds: 0, completed: false, rir: null },
    ],
  };

  const painWithBackup = buildCoachQuickAdvice("pain", row, 2.5);
  assert.equal(painWithBackup.actionKind, "swap_backup");

  const painNoBackup = buildCoachQuickAdvice("pain", { ...row, backupExerciseId: null }, 2.5);
  assert.equal(painNoBackup.actionKind, "apply_sets");
  const reduced = painNoBackup.apply!({ ...row, backupExerciseId: null }, 2.5);
  assert.equal(reduced.sets[0]!.weight, 80); // completed set untouched
  assert.ok(reduced.sets[1]!.weight < 80); // pending set deloaded ~15%
  assert.equal(reduced.restSeconds, 120);

  const timeAdvice = buildCoachQuickAdvice("time", row, 2.5);
  const compressed = timeAdvice.apply!(row, 2.5);
  assert.equal(compressed.sets.filter((s) => !s.completed).length, 2);
  assert.equal(compressed.restSeconds, 60);

  const greatAdvice = buildCoachQuickAdvice("great", row, 2.5);
  const boosted = greatAdvice.apply!(row, 2.5);
  assert.equal(boosted.sets[0]!.weight, 80);
  assert.equal(boosted.sets[1]!.weight, 82.5);

  let seq = 1;
  const merged = appendRoutineExercises(
    [row],
    [
      {
        exerciseId: "pull-up",
        sets: 3,
        repsMin: 8,
        repsMax: 10,
        weight: 0,
        seconds: 0,
        restSeconds: 90,
        targetRir: 2,
        progression: "double",
        increment: 2.5,
      },
    ],
    () => ({ name: "引体向上", muscle: "back", equipment: "bodyweight", mode: "reps", volumeMultiplier: 1 }),
    () => `new_${seq++}`,
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.sets[0]!.completed, true);
  assert.equal(merged[1]!.sets.length, 3);
  assert.equal(merged[1]!.exerciseId, "pull-up");
});

test("1.4 getWebToday exposes planned muscleScores & rotation scheduleMode and quick schedule override works", async () => {
  const { store, owner, call } = makeFixture();
  const planRes = await call("/api/records", {
    method: "POST",
    body: {
      opId: "op_plan_rot",
      id: "plan_rot_1",
      kind: "plan",
      baseVersion: 0,
      deleted: false,
      data: {
        name: "三分化轮换",
        weeks: 8,
        schedule: "rotation",
        weekdays: [],
        rationale: "推拉腿自由轮换",
        source: "manual",
        parentId: null,
        routines: [
          {
            id: "r_push",
            name: "推日",
            exercises: [
              {
                exerciseId: "bench-press",
                sets: 4,
                repsMin: 8,
                repsMax: 10,
                weight: 60,
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
      },
    },
  });
  assert.equal(planRes.status, 200);
  store.applyPlan(owner.userId, "plan_rot_1", 1, 0, false);

  const todayInfo = getWebToday(store, owner.userId, "2026-11-27");
  assert.ok(todayInfo.planned);
  assert.equal(todayInfo.planned.scheduleMode, "rotation");
  assert.ok((todayInfo.planned.muscleScores?.chest ?? 0) > 0);

  const putRest = await call("/api/web/schedule/2026-11-27", {
    method: "PUT",
    body: {
      baseVersion: 0,
      mode: "rest",
      title: "休息日",
      notes: "",
      planId: null,
      routineId: null,
      templateId: null,
      exercises: [],
    },
  });
  assert.equal(putRest.status, 200);
  const afterRest = getWebToday(store, owner.userId, "2026-11-27");
  assert.equal(afterRest.restToday, true);
  assert.equal(afterRest.planned, null);
});
