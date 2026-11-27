import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plannedExerciseSchema, setSchema, workoutPrefsSchema } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { getWebRoutine } from "../packages/server/src/web-training.js";
import {
  checkSetBeatsPrBaseline,
  compareSetAgainstReference,
  duplicateSetInList,
  insertDropSetAfter,
  insertRestPauseSetAfter,
} from "../packages/web/src/lib/workout-set-ops.js";
import {
  DEFAULT_WORKOUT_PREFERENCES,
  readWorkoutPreferences,
  resetLocalWorkoutPreferences,
  writeWorkoutPreference,
} from "../packages/web/src/lib/workout-helpers.js";
import type { WorkoutSet } from "../packages/web/src/lib/domain.js";

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    key(i: number) {
      return [...store.keys()][i] ?? null;
    },
    removeItem(k: string) {
      store.delete(k);
    },
    setItem(k: string, v: string) {
      store.set(k, String(v));
    },
  };
}

describe("Workout Page Polish (6 items)", () => {
  it("Item 1: demoDisplayMode schema defaults to 'small' and persists cleanly without breaking reset defaults", () => {
    const parsedDefault = workoutPrefsSchema.parse({});
    assert.equal(parsedDefault.demoDisplayMode, "small");
    assert.equal(workoutPrefsSchema.parse({ demoDisplayMode: "large" }).demoDisplayMode, "large");
    assert.equal(workoutPrefsSchema.parse({ demoDisplayMode: "hidden" }).demoDisplayMode, "hidden");

    const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = makeMemoryStorage();
    try {
      resetLocalWorkoutPreferences();
      assert.deepStrictEqual(readWorkoutPreferences(), DEFAULT_WORKOUT_PREFERENCES);

      writeWorkoutPreference("demoDisplayMode", "large");
      assert.equal(readWorkoutPreferences().demoDisplayMode, "large");

      resetLocalWorkoutPreferences();
      assert.deepStrictEqual(readWorkoutPreferences(), DEFAULT_WORKOUT_PREFERENCES);
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = prevLocalStorage;
    }
  });

  it("Item 2: set action ops duplicate, insert drop set (~80% snapped), insert rest-pause set, and validate restAfterSeconds", () => {
    let seq = 0;
    const makeId = () => `s_${++seq}`;
    const base: WorkoutSet[] = [
      { id: "orig_1", type: "normal", weight: 100, reps: 8, seconds: 0, completed: true, rir: 2, restAfterSeconds: 120 },
    ];

    const duped = duplicateSetInList(base, 0, makeId);
    assert.equal(duped.length, 2);
    assert.equal(duped[1]!.weight, 100);
    assert.equal(duped[1]!.reps, 8);
    assert.equal(duped[1]!.completed, false);
    assert.equal(duped[1]!.restAfterSeconds, 120);

    const dropped = insertDropSetAfter(base, 0, 2.5, makeId);
    assert.equal(dropped.length, 2);
    assert.equal(dropped[1]!.type, "drop");
    assert.equal(dropped[1]!.weight, 80);
    assert.equal(dropped[1]!.reps, 8);

    const restPaused = insertRestPauseSetAfter(base, 0, makeId);
    assert.equal(restPaused.length, 2);
    assert.equal(restPaused[1]!.type, "rest_pause");
    assert.equal(restPaused[1]!.weight, 100);
    assert.equal(restPaused[1]!.reps, 4);

    const parsedSet = setSchema.parse({
      id: "set1",
      type: "normal",
      weight: 80,
      reps: 8,
      seconds: 0,
      completed: true,
      rir: 1,
      restAfterSeconds: 150,
    });
    assert.equal(parsedSet.restAfterSeconds, 150);
  });

  it("Item 3: compareSetAgainstReference returns up/same/down across reps, timed, and assisted modes", () => {
    assert.equal(
      compareSetAgainstReference(
        { type: "normal", completed: true, weight: 82.5, reps: 8, seconds: 0 },
        { weight: 80, reps: 8, seconds: 0 },
        "reps",
      ),
      "up",
    );
    assert.equal(
      compareSetAgainstReference(
        { type: "normal", completed: true, weight: 80, reps: 8, seconds: 0 },
        { weight: 80, reps: 8, seconds: 0 },
        "reps",
      ),
      "same",
    );
    assert.equal(
      compareSetAgainstReference(
        { type: "normal", completed: true, weight: 80, reps: 6, seconds: 0 },
        { weight: 80, reps: 8, seconds: 0 },
        "reps",
      ),
      "down",
    );
    // Warmups or incomplete sets never show arrows
    assert.equal(
      compareSetAgainstReference(
        { type: "warmup", completed: true, weight: 40, reps: 10, seconds: 0 },
        { weight: 80, reps: 8, seconds: 0 },
        "reps",
      ),
      null,
    );
    // Timed mode
    assert.equal(
      compareSetAgainstReference(
        { type: "normal", completed: true, weight: 0, reps: 0, seconds: 75 },
        { weight: 0, reps: 0, seconds: 60 },
        "timed",
      ),
      "up",
    );
    // Assisted mode: less assistance = stronger = up
    assert.equal(
      compareSetAgainstReference(
        { type: "normal", completed: true, weight: 15, reps: 8, seconds: 0 },
        { weight: 20, reps: 8, seconds: 0 },
        "assisted",
      ),
      "up",
    );
  });

  it("Item 3: checkSetBeatsPrBaseline detects weight, 1RM (with lb->kg conversion), timed hold, and assisted PRs", () => {
    const baseline = { exerciseId: "bench", mode: "reps" as const, weight: 100, oneRepMax: 120 };
    assert.equal(
      checkSetBeatsPrBaseline(
        { type: "normal", completed: true, weight: 102.5, reps: 5, seconds: 0 },
        "reps",
        "kg",
        baseline,
      ),
      "weight",
    );
    // 225 lb ≈ 102.06 kg > 100 kg
    assert.equal(
      checkSetBeatsPrBaseline(
        { type: "normal", completed: true, weight: 225, reps: 5, seconds: 0 },
        "reps",
        "lb",
        baseline,
      ),
      "weight",
    );
    // 95 kg × 9 -> e1RM = 95 * (1 + 9/30) = 123.5 > 120
    assert.equal(
      checkSetBeatsPrBaseline(
        { type: "normal", completed: true, weight: 95, reps: 9, seconds: 0 },
        "reps",
        "kg",
        baseline,
      ),
      "oneRepMax",
    );
    // Timed hold PR
    assert.equal(
      checkSetBeatsPrBaseline(
        { type: "normal", completed: true, weight: 0, reps: 0, seconds: 95 },
        "timed",
        "kg",
        { exerciseId: "plank", mode: "timed", hold: 90 },
      ),
      "hold",
    );
    // Assisted PR (lower weight = stronger)
    assert.equal(
      checkSetBeatsPrBaseline(
        { type: "normal", completed: true, weight: 10, reps: 8, seconds: 0 },
        "assisted",
        "kg",
        { exerciseId: "assist_pullup", mode: "assisted", assistance: 15 },
      ),
      "assistance",
    );
  });

  it("Item 5: plannedExerciseSchema preserves autoWarmup and getWebRoutine forwards autoWarmup & weightUnit", async () => {
    const parsed = plannedExerciseSchema.parse({
      exerciseId: "barbell_bench_press",
      sets: 4,
      repsMin: 6,
      repsMax: 10,
      weight: 80,
      seconds: 0,
      restSeconds: 90,
      autoWarmup: true,
      weightUnit: "lb",
    });
    assert.equal(parsed.autoWarmup, true);
    assert.equal(parsed.weightUnit, "lb");

    const db = openDatabase(":memory:");
    const { app, store, auth } = createApp(db);
    const { userId, token } = auth.login("u_warmup_test");
    const firstExId = [...store.catalogueMap(userId).keys()][0]!;
    const saveRes = await app.request("/api/records", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        opId: "op_plan_1",
        id: "plan_1",
        kind: "plan",
        baseVersion: 0,
        deleted: false,
        data: {
          name: "上肢分化",
          rationale: "推拉腿渐进超负荷计划",
          active: true,
          schedule: "rotation",
          weeks: 4,
          weekdays: [],
          routines: [
            {
              id: "r_push",
              name: "推日",
              exercises: [
                {
                  exerciseId: firstExId,
                  sets: 4,
                  repsMin: 6,
                  repsMax: 10,
                  weight: 80,
                  seconds: 0,
                  restSeconds: 120,
                  targetRir: 2,
                  progression: "double",
                  increment: 2.5,
                  weightUnit: "lb",
                  autoWarmup: true,
                },
              ],
            },
          ],
        },
      }),
    });
    assert.equal(saveRes.status, 200);
    store.applyPlan(userId, "plan_1", 1, 0);

    const resolved = getWebRoutine(store, userId, { id: "r_push", source: "plan", date: "2026-11-27" });
    assert.equal(resolved.exercises.length, 1);
    assert.equal(resolved.exercises[0]!.autoWarmup, true);
    assert.equal(resolved.exercises[0]!.weightUnit, "lb");
    db.close();
  });
});
