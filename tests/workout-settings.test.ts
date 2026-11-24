import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import {
  DEFAULT_WORKOUT_PREFERENCES,
  applyRemoteWorkoutPreferences,
  applySetFieldUpdate,
  buildWarmupSetsPlan,
  configureWorkoutPrefsSync,
  readWorkoutPreferences,
  writeWorkoutPreference,
} from "../packages/web/src/lib/workout-helpers.ts";
import { resolveSetRestSeconds } from "../packages/web/src/lib/haptics-audio.ts";

test("applySetFieldUpdate cascades working set changes to subsequent incomplete working sets by default", () => {
  const sets = [
    { id: "w1", type: "warmup", weight: 40, reps: 8, seconds: 0, completed: false },
    { id: "s1", type: "normal", weight: 60, reps: 8, seconds: 0, completed: false },
    { id: "s2", type: "normal", weight: 60, reps: 8, seconds: 0, completed: true },
    { id: "s3", type: "warmup", weight: 50, reps: 5, seconds: 0, completed: false },
    { id: "s4", type: "normal", weight: 60, reps: 8, seconds: 0, completed: false },
    { id: "s5", type: "failure", weight: 60, reps: 8, seconds: 0, completed: false },
  ];

  // Default behavior (autoSyncSubsequent omitted -> true) editing set index 1
  const afterS1 = applySetFieldUpdate(sets, 1, { weight: 80, reps: 6 });
  assert.equal(afterS1[0]!.weight, 40, "warmup before edited set stays intact");
  assert.equal(afterS1[1]!.weight, 80);
  assert.equal(afterS1[1]!.reps, 6);
  assert.equal(afterS1[2]!.weight, 60, "completed working set is not overwritten");
  assert.equal(afterS1[2]!.reps, 8);
  assert.equal(afterS1[3]!.weight, 50, "subsequent warmup set is not overwritten");
  assert.equal(afterS1[4]!.weight, 80, "subsequent incomplete working set receives weight");
  assert.equal(afterS1[4]!.reps, 6, "subsequent incomplete working set receives reps");
  assert.equal(afterS1[5]!.weight, 80, "subsequent incomplete failure working set receives weight");

  // Editing warmup set does NOT overwrite working sets
  const afterWarmup = applySetFieldUpdate(afterS1, 0, { weight: 45 });
  assert.equal(afterWarmup[0]!.weight, 45);
  assert.equal(afterWarmup[1]!.weight, 80);
  assert.equal(afterWarmup[4]!.weight, 80);

  // Editing set index 4 does NOT backfill earlier incomplete working set index 1
  const afterS4 = applySetFieldUpdate(afterS1, 4, { weight: 85 });
  assert.equal(afterS4[1]!.weight, 80);
  assert.equal(afterS4[4]!.weight, 85);
  assert.equal(afterS4[5]!.weight, 85);

  // Explicit autoSyncSubsequent: false updates only targeted set
  const singleOnly = applySetFieldUpdate(sets, 1, { weight: 90 }, { autoSyncSubsequent: false });
  assert.equal(singleOnly[1]!.weight, 90);
  assert.equal(singleOnly[4]!.weight, 60);
});

test("buildWarmupSetsPlan respects warmup schemes, bar weight, and custom plates", () => {
  const light = buildWarmupSetsPlan(100, true, 20, [25, 20, 15, 10, 5, 2.5, 1.25], "light");
  assert.equal(light.length, 2);
  assert.deepEqual(
    light.map((s) => s.weight),
    [50, 75],
  );

  const standard = buildWarmupSetsPlan(100, true, 20, [20, 10, 5], "standard");
  assert.equal(standard.length, 3);
  // Only 20/10/5 plates -> per-side multiples of 5 -> total bar+plates multiples of 10kg
  assert.deepEqual(
    standard.map((s) => s.weight),
    [50, 70, 80],
  );

  const heavy = buildWarmupSetsPlan(140, true, 20, [25, 20, 15, 10, 5, 2.5], "heavy");
  assert.equal(heavy.length, 4);
  assert.equal(heavy[0]!.reps, 8);
  assert.equal(heavy[3]!.reps, 1);
});

test("resolveSetRestSeconds supports configurable warmup rest and preserves default cap", () => {
  assert.deepEqual(resolveSetRestSeconds({ setType: "warmup", defaultRestSeconds: 90 }), {
    seconds: 45,
    reason: "warmup",
  });
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "warmup", defaultRestSeconds: 90, warmupRestSeconds: 0 }),
    { seconds: 0, reason: "warmup_skip" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "warmup", defaultRestSeconds: 90, warmupRestSeconds: 30 }),
    { seconds: 30, reason: "warmup" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "normal", nextSetType: "drop", defaultRestSeconds: 120, warmupRestSeconds: 60 }),
    { seconds: 0, reason: "drop_chain" },
  );
});

test("readWorkoutPreferences returns OpenGym defaults safely and round-trips through storage", async () => {
  const defaults = readWorkoutPreferences();
  assert.equal(defaults.autoSyncSubsequent, true);
  assert.equal(defaults.autoPrefillLast, true);
  assert.equal(defaults.autoStartRestTimer, true);
  assert.equal(defaults.autoAdvanceExercise, true);
  assert.equal(defaults.warmupRestSeconds, 45);
  assert.equal(defaults.restAdjustStep, 15);
  assert.equal(defaults.weightStepKg, 2.5);
  assert.equal(defaults.warmupScheme, "standard");
  assert.equal(defaults.showPlateMath, true);
  assert.deepEqual(defaults.enabledPlates, DEFAULT_WORKOUT_PREFERENCES.enabledPlates);

  const backing = new Map<string, string>();
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => backing.set(k, v),
      removeItem: (k: string) => backing.delete(k),
    },
  });

  try {
    let pushedCount = 0;
    configureWorkoutPrefsSync(() => {
      pushedCount++;
    });

    const applied = applyRemoteWorkoutPreferences({
      autoAdvanceExercise: false,
      weightStepKg: 1.25,
      enabledPlates: [20, 10],
      warmupScheme: "light",
    });
    assert.equal(applied.autoAdvanceExercise, false);
    assert.equal(applied.weightStepKg, 1.25);
    assert.deepEqual(applied.enabledPlates, [20, 10]);
    assert.equal(applied.warmupScheme, "light");
    assert.equal(pushedCount, 0, "applying remote preferences must not echo back to cloud sync");

    writeWorkoutPreference("autoSyncSubsequent", false);
    writeWorkoutPreference("autoAdvanceExercise", true);
    writeWorkoutPreference("warmupRestSeconds", 0);
    writeWorkoutPreference("restAdjustStep", 30);
    writeWorkoutPreference("weightStepKg", 1.25);
    writeWorkoutPreference("hapticsOn", false);
    writeWorkoutPreference("enabledPlates", [20, 10, 5]);
    writeWorkoutPreference("warmupScheme", "heavy");

    const updated = readWorkoutPreferences();
    assert.equal(updated.autoSyncSubsequent, false);
    assert.equal(updated.autoAdvanceExercise, true);
    assert.equal(updated.warmupRestSeconds, 0);
    assert.equal(updated.restAdjustStep, 30);
    assert.equal(updated.weightStepKg, 1.25);
    assert.equal(updated.hapticsOn, false);
    assert.deepEqual(updated.enabledPlates, [20, 10, 5]);
    assert.equal(updated.warmupScheme, "heavy");

    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(pushedCount, 1, "debounced local preference writes trigger single cloud sync push");
  } finally {
    configureWorkoutPrefsSync(null);
    if (prevStorage) Object.defineProperty(globalThis, "localStorage", prevStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("PUT /api/web/profile/workout-prefs merges partial preferences, preserves goals, and isolates accounts", async () => {
  const db = openDatabase(":memory:");
  try {
    const { app, auth } = createApp(db);
    const owner = auth.login("prefs-owner");
    const other = auth.login("prefs-other");
    const call = (url: string, options: { token?: string; method?: string; body?: unknown } = {}) =>
      app.request(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: "Bearer " + (options.token ?? owner.token),
          "Content-Type": "application/json",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

    // Save initial profile goals via existing endpoint
    const goalRes = await call("/api/web/profile", {
      method: "PUT",
      body: {
        version: 0,
        opId: "op-init-profile",
        calories: 2500,
        protein: 180,
        carbs: 260,
        fat: 70,
        targetWeight: 72,
        daysPerWeek: 4,
        restSeconds: 120,
        energyProfile: null,
        equipment: ["barbell", "dumbbell"],
      },
    });
    assert.equal(goalRes.status, 200);

    // First partial workout-prefs update
    const prefRes1 = await call("/api/web/profile/workout-prefs", {
      method: "PUT",
      body: {
        weightStepKg: 1.25,
        warmupRestSeconds: 0,
        autoAdvanceExercise: false,
        enabledPlates: [20, 10, 5],
      },
    });
    assert.equal(prefRes1.status, 200);
    const body1 = (await prefRes1.json()) as {
      version: number;
      workoutPrefs: Record<string, unknown>;
    };
    assert.equal(body1.version, 2);
    assert.equal(body1.workoutPrefs.weightStepKg, 1.25);
    assert.equal(body1.workoutPrefs.warmupRestSeconds, 0);
    assert.equal(body1.workoutPrefs.autoAdvanceExercise, false);
    assert.deepEqual(body1.workoutPrefs.enabledPlates, [20, 10, 5]);

    // Second partial update preserves earlier fields + nutrition/equipment goals
    const prefRes2 = await call("/api/web/profile/workout-prefs", {
      method: "PUT",
      body: { warmupScheme: "heavy" },
    });
    assert.equal(prefRes2.status, 200);

    const profileRes = await call("/api/web/profile");
    assert.equal(profileRes.status, 200);
    const profBody = (await profileRes.json()) as {
      version: number;
      profile: {
        calories: number;
        equipment: string[];
        workoutPrefs?: Record<string, unknown>;
      };
    };
    assert.equal(profBody.version, 3);
    assert.equal(profBody.profile.calories, 2500);
    assert.deepEqual(profBody.profile.equipment, ["barbell", "dumbbell"]);
    assert.equal(profBody.profile.workoutPrefs?.weightStepKg, 1.25);
    assert.equal(profBody.profile.workoutPrefs?.warmupRestSeconds, 0);
    assert.equal(profBody.profile.workoutPrefs?.autoAdvanceExercise, false);
    assert.equal(profBody.profile.workoutPrefs?.warmupScheme, "heavy");

    // Cross-account isolation
    const otherProfileRes = await call("/api/web/profile", { token: other.token });
    assert.equal(otherProfileRes.status, 200);
    const otherBody = (await otherProfileRes.json()) as {
      profile: { workoutPrefs?: unknown };
    };
    assert.equal(otherBody.profile.workoutPrefs, undefined);
  } finally {
    db.close();
  }
});
