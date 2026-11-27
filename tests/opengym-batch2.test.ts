import { test } from "node:test";
import assert from "node:assert/strict";
import {
  equipmentProfileSchema,
  evaluateExerciseProgression,
  nextTarget,
  profileSchema,
  routineSchema,
  type Routine,
  type Workout,
} from "@ironlog/shared";
import { speakCue } from "../packages/web/src/lib/haptics-audio.js";
import {
  plateBreakdown,
  plateDeltaLabel,
  readWorkoutPreferences,
  resetLocalWorkoutPreferences,
  writeWorkoutPreference,
} from "../packages/web/src/lib/workout-helpers.js";

function installMemoryStorage() {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

test("2.1 workoutLayout, collapseCompletedExercises & voiceRestCues round-trip through storage & profile schema", () => {
  installMemoryStorage();
  resetLocalWorkoutPreferences();
  assert.equal(readWorkoutPreferences().workoutLayout, "card");
  assert.equal(readWorkoutPreferences().collapseCompletedExercises, false);
  assert.equal(readWorkoutPreferences().voiceRestCues, false);

  writeWorkoutPreference("workoutLayout", "focus");
  writeWorkoutPreference("collapseCompletedExercises", true);
  writeWorkoutPreference("voiceRestCues", true);
  writeWorkoutPreference("platePairs", { "20": 1, "10": 2 });

  const prefs = readWorkoutPreferences();
  assert.equal(prefs.workoutLayout, "focus");
  assert.equal(prefs.collapseCompletedExercises, true);
  assert.equal(prefs.voiceRestCues, true);
  assert.deepEqual(prefs.platePairs, { "20": 1, "10": 2 });

  const parsedProfile = profileSchema.parse({ workoutPrefs: prefs });
  assert.equal(parsedProfile.workoutPrefs?.workoutLayout, "focus");
  assert.equal(parsedProfile.workoutPrefs?.collapseCompletedExercises, true);
  assert.equal(parsedProfile.workoutPrefs?.voiceRestCues, true);
});

test("2.2 triple progression advances reps -> sets -> weight reset, and tracks consecutive misses & deload day", () => {
  const item: Routine["exercises"][number] = {
    exerciseId: "bench-press",
    sets: 3,
    setsMax: 5,
    deloadMissThreshold: 3,
    repsMin: 8,
    repsMax: 10,
    weight: 60,
    seconds: 0,
    restSeconds: 90,
    targetRir: 2,
    progression: "triple",
    increment: 2.5,
    backupExerciseId: null,
  };

  // Stage 1: Hit 3x8 -> advance reps to 9
  const prevStage1: Workout["exercises"][number] = {
    id: "r1",
    exerciseId: "bench-press",
    restSeconds: 90,
    snapshot: null,
    sets: [1, 2, 3].map((i) => ({
      id: `s${i}`,
      type: "normal",
      weight: 60,
      reps: 8,
      seconds: 0,
      completed: true,
      rir: 2,
    })),
  };
  const step1 = nextTarget(item, prevStage1, "reps");
  assert.equal(step1.weight, 60);
  assert.equal(step1.reps, 9);
  assert.equal(step1.sets, 3);
  assert.equal(step1.increased, false);

  // Stage 2: Hit 3x10 -> add a 4th set and reset reps to 8
  const prevStage2: Workout["exercises"][number] = {
    ...prevStage1,
    sets: [1, 2, 3].map((i) => ({
      id: `s${i}`,
      type: "normal",
      weight: 60,
      reps: 10,
      seconds: 0,
      completed: true,
      rir: 2,
    })),
  };
  const step2 = nextTarget(item, prevStage2, "reps");
  assert.equal(step2.weight, 60);
  assert.equal(step2.reps, 8);
  assert.equal(step2.sets, 4);
  assert.equal(step2.setsIncreased, true);
  assert.equal(step2.increased, false);

  const report2 = evaluateExerciseProgression(item, prevStage2, undefined, [], "reps");
  assert.equal(report2.status, "progress_sets");
  assert.ok(report2.statusLabel.includes("4 组"));

  // Stage 3: Hit 5x10 (setsMax reached) -> bump weight +2.5kg and reset to base 3 sets x 8 reps
  const prevStage3: Workout["exercises"][number] = {
    ...prevStage1,
    sets: [1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`,
      type: "normal",
      weight: 60,
      reps: 10,
      seconds: 0,
      completed: true,
      rir: 2,
    })),
  };
  const step3 = nextTarget(item, prevStage3, "reps");
  assert.equal(step3.weight, 62.5);
  assert.equal(step3.reps, 8);
  assert.equal(step3.sets, 3);
  assert.equal(step3.increased, true);

  // Consecutive misses detection
  const missRow: Workout["exercises"][number] = {
    ...prevStage1,
    sets: [1, 2, 3].map((i) => ({
      id: `m${i}`,
      type: "normal",
      weight: 60,
      reps: 6,
      seconds: 0,
      completed: true,
      rir: 0,
    })),
  };
  const missReport = evaluateExerciseProgression(
    item,
    missRow,
    undefined,
    [
      { feeling: "balanced", row: missRow },
      { feeling: "balanced", row: missRow },
    ],
    "reps",
  );
  assert.equal(missReport.consecutiveMisses, 2);
  assert.equal(missReport.deloadMissThreshold, 3);
  assert.equal(missReport.status, "plateau_deload");

  // Routine isDeload marker
  const deloadRoutine = routineSchema.parse({
    id: "r_deload",
    name: "减载恢复日",
    isDeload: true,
    exercises: [item],
  });
  assert.equal(deloadRoutine.isDeload, true);
});

test("2.3 speakCue safely degrades to false when speechSynthesis is unavailable or disabled", () => {
  assert.equal(speakCue("还剩 10 秒", { enabled: false }), false);
  assert.equal(speakCue("", { enabled: true }), false);
  // In Node environment without window.speechSynthesis, returns false without throwing
  assert.equal(speakCue("休息结束", { enabled: true }), false);
});

test("2.4 bounded plateBreakdown strictly respects per-plate pair inventory and equipmentProfileSchema validates", () => {
  // 100kg with 20kg bar -> 40kg per side
  // Unlimited 20kg plates -> [20, 20]
  const unlimited = plateBreakdown(100, 20, [20, 15, 10, 5, 2.5]);
  assert.deepEqual(unlimited.plates, [20, 20]);
  assert.equal(unlimited.achievable, true);

  // Only 1 pair of 20kg plates -> cannot use [20, 20], must use [20, 15, 5] or [20, 10, 10]
  const capped = plateBreakdown(100, 20, [20, 15, 10, 5, 2.5], { "20": 1, "15": 1, "10": 2, "5": 2 });
  assert.equal(capped.achievable, true);
  assert.equal(capped.plates.filter((p) => p === 20).length, 1);
  assert.equal(capped.plates.reduce((a, b) => a + b, 0), 40);

  // Verify delta label works with pair inventory too
  const delta = plateDeltaLabel(60, 100, 20, [20, 15, 10, 5, 2.5], { "20": 1, "15": 1, "10": 2, "5": 2 });
  assert.ok(delta.length > 0);

  const gymProfile = equipmentProfileSchema.parse({
    id: "home_gym",
    name: "居家哑铃区",
    equipment: ["dumbbell", "bodyweight", "band"],
    barWeight: 10,
    enabledPlates: [10, 5, 2.5, 1.25],
    platePairs: { "10": 2, "5": 2 },
    dumbbellMinKg: 2,
    dumbbellMaxKg: 24,
    dumbbellStepKg: 2,
  });
  assert.equal(gymProfile.name, "居家哑铃区");
  assert.equal(gymProfile.platePairs?.["10"], 2);
});
