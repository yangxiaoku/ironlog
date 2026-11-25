import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { workoutPrefsSchema } from "../packages/shared/src/index.js";
import {
  DEFAULT_APPLE_CARDIO_SHORTCUT,
  DEFAULT_APPLE_HUB_SHORTCUT,
  DEFAULT_APPLE_STRENGTH_SHORTCUT,
  DEFAULT_WORKOUT_PREFERENCES,
  applyDeloadToTarget,
  applyRemoteWorkoutPreferences,
  applySetFieldUpdate,
  buildWarmupSetsPlan,
  configureWorkoutPrefsSync,
  readWorkoutPreferences,
  resetLocalWorkoutPreferences,
  writeWorkoutPreference,
} from "../packages/web/src/lib/workout-helpers.ts";
import {
  APPLE_FITNESS_APP_URL,
  buildAppleFitnessLaunchUrl,
  buildAppleHubActionUrl,
  inferAppleFitnessKind,
  isAppleMobileDevice,
  triggerAppleFitnessLaunch,
  triggerAppleHubAction,
} from "../packages/web/src/lib/apple-fitness.ts";
import {
  cachedQuery,
  invalidateQueryCache,
  peekQuery,
  writeQueryCache,
} from "../packages/web/src/lib/query-cache.ts";
import { createRestAudio, resolveSetRestSeconds, type RestSoundStyle } from "../packages/web/src/lib/haptics-audio.ts";

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
  assert.equal(defaults.soundStyle, "chime");
  assert.equal(defaults.appleFitnessAutoLaunch, true);
  assert.equal(defaults.appleStrengthLaunch, "hub");
  assert.equal(defaults.appleCardioLaunch, "fitness_app");
  assert.equal(defaults.appleHubShortcutName, DEFAULT_APPLE_HUB_SHORTCUT);
  assert.equal(defaults.appleStrengthShortcutName, DEFAULT_APPLE_STRENGTH_SHORTCUT);
  assert.equal(defaults.appleCardioShortcutName, DEFAULT_APPLE_CARDIO_SHORTCUT);
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
      soundStyle: "bell",
      appleFitnessAutoLaunch: true,
      appleStrengthLaunch: "fitness_app",
      appleCardioLaunch: "hub",
      appleHubShortcutName: "铁记全能自定义",
      appleStrengthShortcutName: "推拉力量",
      appleCardioShortcutName: "户外慢跑",
    });
    assert.equal(applied.autoAdvanceExercise, false);
    assert.equal(applied.weightStepKg, 1.25);
    assert.deepEqual(applied.enabledPlates, [20, 10]);
    assert.equal(applied.warmupScheme, "light");
    assert.equal(applied.soundStyle, "bell");
    assert.equal(applied.appleFitnessAutoLaunch, true);
    assert.equal(applied.appleStrengthLaunch, "fitness_app");
    assert.equal(applied.appleCardioLaunch, "hub");
    assert.equal(applied.appleHubShortcutName, "铁记全能自定义");
    assert.equal(applied.appleStrengthShortcutName, "推拉力量");
    assert.equal(applied.appleCardioShortcutName, "户外慢跑");
    assert.equal(pushedCount, 0, "applying remote preferences must not echo back to cloud sync");

    writeWorkoutPreference("autoSyncSubsequent", false);
    writeWorkoutPreference("autoAdvanceExercise", true);
    writeWorkoutPreference("warmupRestSeconds", 0);
    writeWorkoutPreference("restAdjustStep", 30);
    writeWorkoutPreference("weightStepKg", 1.25);
    writeWorkoutPreference("hapticsOn", false);
    writeWorkoutPreference("enabledPlates", [20, 10, 5]);
    writeWorkoutPreference("warmupScheme", "heavy");
    writeWorkoutPreference("soundStyle", "marimba");
    writeWorkoutPreference("appleFitnessAutoLaunch", false);
    writeWorkoutPreference("appleStrengthLaunch", "hub");
    writeWorkoutPreference("appleCardioLaunch", "off");
    writeWorkoutPreference("appleHubShortcutName", "全能联动Pro");
    writeWorkoutPreference("appleStrengthShortcutName", "力量开练");
    writeWorkoutPreference("appleCardioShortcutName", "单车有氧");

    const updated = readWorkoutPreferences();
    assert.equal(updated.autoSyncSubsequent, false);
    assert.equal(updated.autoAdvanceExercise, true);
    assert.equal(updated.warmupRestSeconds, 0);
    assert.equal(updated.restAdjustStep, 30);
    assert.equal(updated.weightStepKg, 1.25);
    assert.equal(updated.hapticsOn, false);
    assert.deepEqual(updated.enabledPlates, [20, 10, 5]);
    assert.equal(updated.warmupScheme, "heavy");
    assert.equal(updated.soundStyle, "marimba");
    assert.equal(updated.appleFitnessAutoLaunch, false);
    assert.equal(updated.appleStrengthLaunch, "hub");
    assert.equal(updated.appleCardioLaunch, "off");
    assert.equal(updated.appleHubShortcutName, "全能联动Pro");
    assert.equal(updated.appleStrengthShortcutName, "力量开练");
    assert.equal(updated.appleCardioShortcutName, "单车有氧");

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
      body: {
        warmupScheme: "heavy",
        soundStyle: "marimba",
        appleFitnessAutoLaunch: true,
        appleStrengthLaunch: "hub",
        appleCardioLaunch: "fitness_app",
        appleHubShortcutName: "铁记全能Hub",
        appleStrengthShortcutName: "传统力量开练",
      },
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
    assert.equal(profBody.profile.workoutPrefs?.soundStyle, "marimba");
    assert.equal(profBody.profile.workoutPrefs?.appleFitnessAutoLaunch, true);
    assert.equal(profBody.profile.workoutPrefs?.appleStrengthLaunch, "hub");
    assert.equal(profBody.profile.workoutPrefs?.appleCardioLaunch, "fitness_app");
    assert.equal(profBody.profile.workoutPrefs?.appleHubShortcutName, "铁记全能Hub");
    assert.equal(profBody.profile.workoutPrefs?.appleStrengthShortcutName, "传统力量开练");

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

test("query-cache blocks older-epoch overwrites and skips caching responses invalidated while in flight", async () => {
  invalidateQueryCache();
  try {
    writeQueryCache("k", { v: 2 }, { userId: "u1", epoch: 2 });
    const rejected = writeQueryCache("k", { v: 1 }, { userId: "u1", epoch: 1 });
    assert.deepEqual(rejected.data, { v: 2 });
    assert.deepEqual(peekQuery<{ v: number }>("k", "u1")?.data, { v: 2 });

    let resolveFetch!: (val: { fresh: boolean }) => void;
    const inflight = cachedQuery(
      "k2",
      () =>
        new Promise<{ fresh: boolean }>((resolve) => {
          resolveFetch = resolve;
        }),
      { userId: "u1", epoch: 1 },
    );

    invalidateQueryCache();
    resolveFetch({ fresh: true });
    const result = await inflight;
    assert.deepEqual(result, { fresh: true });
    assert.equal(peekQuery("k2", "u1"), undefined, "response invalidated mid-flight must not repopulate cache");
  } finally {
    invalidateQueryCache();
  }
});

test("resetLocalWorkoutPreferences clears saved keys, resets defaults, and cancels pending cloud sync", async () => {
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

    writeWorkoutPreference("autoSyncSubsequent", false);
    writeWorkoutPreference("weightStepKg", 1.25);
    writeWorkoutPreference("enabledPlates", [20, 10]);
    writeWorkoutPreference("warmupScheme", "heavy");
    writeWorkoutPreference("soundStyle", "bell");
    writeWorkoutPreference("appleFitnessAutoLaunch", true);
    writeWorkoutPreference("appleStrengthLaunch", "fitness_app");
    writeWorkoutPreference("appleCardioLaunch", "shortcut");
    writeWorkoutPreference("appleHubShortcutName", "自定义全能");
    writeWorkoutPreference("appleStrengthShortcutName", "自定义力量");
    writeWorkoutPreference("appleCardioShortcutName", "自定义有氧");
    assert.ok(backing.size > 0);

    resetLocalWorkoutPreferences();
    assert.equal(backing.size, 0, "all saved workout preference keys removed");
    assert.deepEqual(readWorkoutPreferences(), DEFAULT_WORKOUT_PREFERENCES);

    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(pushedCount, 0, "resetting preferences cancels pending debounced cloud sync");
  } finally {
    configureWorkoutPrefsSync(null);
    if (prevStorage) Object.defineProperty(globalThis, "localStorage", prevStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("PUT/DELETE /api/web/schedule/:date allows recreating deleted tombstones while rejecting genuine stale conflicts", async () => {
  const db = openDatabase(":memory:");
  try {
    const { app, auth } = createApp(db);
    const owner = auth.login("sched-owner");
    const call = (url: string, options: { method?: string; body?: unknown } = {}) =>
      app.request(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: "Bearer " + owner.token,
          "Content-Type": "application/json",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

    // Initial schedule creation
    const createRes = await call("/api/web/schedule/2026-06-15", {
      method: "PUT",
      body: { mode: "workout", title: "推胸日", exercises: [], opId: "sched-op-1", baseVersion: 0 },
    });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { record: { version: number } };
    assert.equal(created.record.version, 1);

    // Genuine stale baseVersion against active version-1 override returns 409
    const staleRes = await call("/api/web/schedule/2026-06-15", {
      method: "PUT",
      body: { mode: "rest", title: "休息", exercises: [], opId: "sched-op-stale", baseVersion: 0 },
    });
    assert.equal(staleRes.status, 409);

    // Delete override -> version 2 tombstone
    const delRes1 = await call("/api/web/schedule/2026-06-15?opId=sched-del-1", { method: "DELETE" });
    assert.equal(delRes1.status, 200);

    // Recreate with baseVersion: 0 succeeds on tombstone -> version 3
    const recreateWithZero = await call("/api/web/schedule/2026-06-15", {
      method: "PUT",
      body: { mode: "workout", title: "拉背日", exercises: [], opId: "sched-op-2", baseVersion: 0 },
    });
    assert.equal(recreateWithZero.status, 200);
    const recreated1 = (await recreateWithZero.json()) as { record: { version: number } };
    assert.equal(recreated1.record.version, 3);

    // Delete again -> version 4 tombstone, then recreate with omitted baseVersion -> version 5
    const delRes2 = await call("/api/web/schedule/2026-06-15?opId=sched-del-2", { method: "DELETE" });
    assert.equal(delRes2.status, 200);

    const recreateOmitted = await call("/api/web/schedule/2026-06-15", {
      method: "PUT",
      body: { mode: "workout", title: "练腿日", exercises: [], opId: "sched-op-3" },
    });
    assert.equal(recreateOmitted.status, 200);
    const recreated2 = (await recreateOmitted.json()) as { record: { version: number; data: { title: string } } };
    assert.equal(recreated2.record.version, 5);
    assert.equal(recreated2.record.data.title, "练腿日");
  } finally {
    db.close();
  }
});

test("createRestAudio uses warm lowpass-filtered mid-register presets, respects enabled(), and allows preview()", () => {
  const prevCtxDesc = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const prevWebkitDesc = Object.getOwnPropertyDescriptor(globalThis, "webkitAudioContext");

  interface MockOsc {
    type: OscillatorType;
    frequency: { value: number };
    connectedGain: MockGain | null;
    connect(target: unknown): unknown;
    start(): void;
    stop(): void;
  }
  interface MockGain {
    gain: {
      value: number;
      ramps: number[];
      setValueAtTime(): void;
      linearRampToValueAtTime(val: number): void;
      exponentialRampToValueAtTime(): void;
    };
    connect(target: unknown): unknown;
  }
  interface MockFilter {
    type: string;
    frequency: { value: number };
    Q: { value: number };
    connect(target: unknown): unknown;
  }

  let activeCtx: MockAudioContext | null = null;
  const createdOscs: MockOsc[] = [];
  const createdFilters: MockFilter[] = [];
  const createdGains: MockGain[] = [];

  class MockAudioContext {
    state: AudioContextState = "running";
    currentTime = 1;
    destination = {};
    constructor() {
      activeCtx = this;
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
    createBuffer() {
      return {};
    }
    createBufferSource() {
      return {
        buffer: null,
        connect(target: unknown) {
          return target;
        },
        start() {},
      };
    }
    createDynamicsCompressor() {
      return {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect(target: unknown) {
          return target;
        },
      };
    }
    createBiquadFilter() {
      const f: MockFilter = {
        type: "",
        frequency: { value: 0 },
        Q: { value: 0 },
        connect(target: unknown) {
          return target;
        },
      };
      createdFilters.push(f);
      return f;
    }
    createGain() {
      const g: MockGain = {
        gain: {
          value: 0,
          ramps: [],
          setValueAtTime() {},
          linearRampToValueAtTime(val: number) {
            g.gain.ramps.push(val);
          },
          exponentialRampToValueAtTime() {},
        },
        connect(target: unknown) {
          return target;
        },
      };
      createdGains.push(g);
      return g;
    }
    createOscillator() {
      const osc: MockOsc = {
        type: "sine",
        frequency: { value: 0 },
        connectedGain: null,
        connect(target: unknown) {
          osc.connectedGain = target as MockGain;
          return target;
        },
        start() {},
        stop() {},
      };
      createdOscs.push(osc);
      return osc;
    }
  }

  Object.defineProperty(globalThis, "AudioContext", { configurable: true, writable: true, value: MockAudioContext });
  Object.defineProperty(globalThis, "webkitAudioContext", { configurable: true, writable: true, value: undefined });

  const resetCaptured = () => {
    createdOscs.length = 0;
    createdFilters.length = 0;
    createdGains.length = 0;
  };

  try {
    let isEnabled = false;
    let currentStyle: RestSoundStyle = "chime";
    const audio = createRestAudio(
      () => isEnabled,
      () => currentStyle,
    );

    // Disabled -> zero oscillators scheduled
    audio.play(true);
    assert.equal(createdOscs.length, 0);

    // preview() plays marimba even while enabled() is false
    resetCaptured();
    audio.preview("marimba");
    assert.ok(createdOscs.length >= 3, "preview plays marimba voices when enabled() is false");
    assert.equal(createdFilters[0]?.type, "lowpass");
    assert.equal(createdFilters[0]?.frequency.value, 2400);

    // Verify all 3 presets when enabled() is true
    isEnabled = true;
    for (const style of ["chime", "marimba", "bell"] as const) {
      currentStyle = style;
      resetCaptured();
      audio.play(true);
      assert.ok(createdOscs.length >= 2, `${style} schedules oscillators`);
      assert.equal(createdFilters.length, 1, `${style} routes through lowpass filter`);
      assert.equal(createdFilters[0]!.type, "lowpass");
      assert.ok(createdFilters[0]!.frequency.value <= 3600, `${style} cutoff (${createdFilters[0]!.frequency.value}) <= 3600 Hz`);

      for (const g of createdGains) {
        const peak = Math.max(0, ...g.gain.ramps);
        assert.ok(peak <= 0.85, `${style} peak gain (${peak}) stays non-clipping <= 0.85`);
      }

      const fundamentals = createdOscs.filter((o) => Math.max(0, ...(o.connectedGain?.gain.ramps ?? [])) >= 0.45);
      assert.ok(fundamentals.length >= 2, `${style} has clearly audible primary notes (>= 0.45)`);
      for (const fOsc of fundamentals) {
        assert.equal(fOsc.type, "sine");
        assert.ok(
          fOsc.frequency.value >= 350 && fOsc.frequency.value <= 900,
          `${style} fundamental (${fOsc.frequency.value} Hz) in warm mid-register 350–900 Hz`,
        );
      }
    }
  } finally {
    if (activeCtx) (activeCtx as { state: string }).state = "closed";
    if (prevCtxDesc) Object.defineProperty(globalThis, "AudioContext", prevCtxDesc);
    else delete globalThis.AudioContext;
    if (prevWebkitDesc) Object.defineProperty(globalThis, "webkitAudioContext", prevWebkitDesc);
    else delete globalThis.webkitAudioContext;
  }
});

test("apple-fitness builds Shortcut/Fitness deep-links, classifies workouts accurately, and guards non-iOS browsers", () => {
  const prefs = {
    ...DEFAULT_WORKOUT_PREFERENCES,
    appleStrengthLaunch: "shortcut" as const,
    appleCardioLaunch: "fitness_app" as const,
    appleStrengthShortcutName: "铁记 传统力量",
    appleCardioShortcutName: "  ",
  };

  assert.equal(
    buildAppleFitnessLaunchUrl("strength", prefs),
    "shortcuts://run-shortcut?name=%E9%93%81%E8%AE%B0%20%E4%BC%A0%E7%BB%9F%E5%8A%9B%E9%87%8F",
  );
  assert.equal(
    buildAppleFitnessLaunchUrl("strength", { ...prefs, appleStrengthLaunch: "hub" }),
    `shortcuts://run-shortcut?name=${encodeURIComponent(DEFAULT_APPLE_HUB_SHORTCUT)}&input=text&text=strength`,
  );
  assert.equal(
    buildAppleFitnessLaunchUrl("cardio", prefs, "hub"),
    `shortcuts://run-shortcut?name=${encodeURIComponent(DEFAULT_APPLE_HUB_SHORTCUT)}&input=text&text=cardio`,
  );
  assert.equal(
    buildAppleHubActionUrl("end", { appleHubShortcutName: "铁记全能" }),
    `shortcuts://run-shortcut?name=${encodeURIComponent("铁记全能")}&input=text&text=end`,
  );
  assert.equal(
    buildAppleHubActionUrl("daily", { appleHubShortcutName: "  " }),
    `shortcuts://run-shortcut?name=${encodeURIComponent(DEFAULT_APPLE_HUB_SHORTCUT)}&input=text&text=daily`,
  );
  assert.equal(buildAppleFitnessLaunchUrl("cardio", prefs), APPLE_FITNESS_APP_URL);
  assert.equal(buildAppleFitnessLaunchUrl("cardio", prefs, "shortcut"), "shortcuts://run-shortcut?name=%E9%93%81%E8%AE%B0%E5%BC%80%E5%A7%8B%E6%9C%89%E6%B0%A7");
  assert.equal(buildAppleFitnessLaunchUrl("strength", prefs, "off"), null);
  assert.equal(buildAppleFitnessLaunchUrl("strength", { ...prefs, appleStrengthLaunch: "off" }, "fitness_app"), APPLE_FITNESS_APP_URL);

  // Inference rules
  assert.equal(inferAppleFitnessKind([], "自由训练"), "strength");
  assert.equal(inferAppleFitnessKind([], "户外跑步 5km"), "cardio");
  assert.equal(inferAppleFitnessKind([{ snapshot: { mode: "reps", name: "杠铃深蹲" } }], "下肢力量"), "strength");
  assert.equal(inferAppleFitnessKind([{ snapshot: { mode: "timed", name: "平板支撑" } }], "核心稳定"), "strength");
  assert.equal(inferAppleFitnessKind([{ snapshot: { mode: "timed", name: "划船机" } }], "周末训练"), "cardio");
  assert.equal(
    inferAppleFitnessKind(
      [{ snapshot: { mode: "reps", name: "卧推" } }, { snapshot: { mode: "timed", name: "跑步机爬坡" } }],
      "力量+有氧",
    ),
    "strength",
  );

  // Device detection
  assert.equal(isAppleMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5), true);
  assert.equal(isAppleMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5), true);
  assert.equal(isAppleMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 0), false);
  assert.equal(isAppleMobileDevice("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5), false);
  assert.equal(isAppleMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0), false);

  // Non-iOS launch behavior (silent vs toast notify)
  const notices: string[] = [];
  const silentRes = triggerAppleFitnessLaunch("strength", {
    prefs,
    silentNonIos: true,
    notify: (msg) => notices.push(msg),
  });
  assert.equal(silentRes.launched, false);
  assert.ok(silentRes.url?.startsWith("shortcuts://run-shortcut?name="));
  assert.equal(notices.length, 0);

  const loudRes = triggerAppleFitnessLaunch("cardio", {
    prefs,
    silentNonIos: false,
    notify: (msg) => notices.push(msg),
  });
  assert.equal(loudRes.launched, false);
  assert.equal(loudRes.url, APPLE_FITNESS_APP_URL);
  assert.equal(notices.length, 1);

  const hubQuietRes = triggerAppleHubAction("end", {
    prefs: { ...prefs, appleHubShortcutName: "铁记全能" },
    silentNonIos: true,
    notify: (msg) => notices.push(msg),
  });
  assert.equal(hubQuietRes.launched, false);
  assert.equal(hubQuietRes.url, `shortcuts://run-shortcut?name=${encodeURIComponent("铁记全能")}&input=text&text=end`);
  assert.equal(notices.length, 1);

  const hubLoudRes = triggerAppleHubAction("daily", {
    prefs,
    silentNonIos: false,
    notify: (msg) => notices.push(msg),
  });
  assert.equal(hubLoudRes.launched, false);
  assert.equal(
    hubLoudRes.url,
    `shortcuts://run-shortcut?name=${encodeURIComponent(DEFAULT_APPLE_HUB_SHORTCUT)}&input=text&text=daily`,
  );
  assert.equal(notices.length, 2);

  // Server workoutPrefsSchema default matches frontend auto-launch = true
  assert.equal(workoutPrefsSchema.parse({}).appleFitnessAutoLaunch, true);

  // Mocked iOS environment navigates synchronously via window.location.href
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    const loc = { href: "http://localhost/" };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: { location: loc, setTimeout: globalThis.setTimeout },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
    });
    Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: undefined });

    const iosStrength = triggerAppleFitnessLaunch("strength", {
      prefs: { ...prefs, appleStrengthLaunch: "hub", appleHubShortcutName: "铁记全能" },
      silentNonIos: true,
    });
    assert.equal(iosStrength.launched, true);
    assert.equal(loc.href, `shortcuts://run-shortcut?name=${encodeURIComponent("铁记全能")}&input=text&text=strength`);

    const iosCardio = triggerAppleFitnessLaunch("cardio", {
      prefs: { ...prefs, appleCardioLaunch: "fitness_app" },
      silentNonIos: true,
    });
    assert.equal(iosCardio.launched, true);
    assert.equal(loc.href, APPLE_FITNESS_APP_URL);
  } finally {
    if (prevWindow) Object.defineProperty(globalThis, "window", prevWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (prevDoc) Object.defineProperty(globalThis, "document", prevDoc);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("applyDeloadToTarget scales sets and weight cleanly and deload prefs round-trip via storage", () => {
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    },
  });
  try {
    assert.deepEqual(applyDeloadToTarget(4, 100, "reps", 2.5, 80, 50), { sets: 2, weight: 80 });
    assert.deepEqual(applyDeloadToTarget(3, 65, "reps", 2.5, 75, 50), { sets: 2, weight: 50 });
    assert.deepEqual(applyDeloadToTarget(3, 1.5, "reps", 2.5, 75, 50), { sets: 2, weight: 1.5 });
    assert.deepEqual(applyDeloadToTarget(4, 40, "assisted", 2.5, 80, 50), { sets: 2, weight: 50 });
    assert.deepEqual(applyDeloadToTarget(4, 0, "timed", 2.5, 75, 50), { sets: 2, weight: 0 });

    resetLocalWorkoutPreferences();
    assert.equal(readWorkoutPreferences().deloadMode, false);
    assert.equal(readWorkoutPreferences().deloadWeightPct, 80);
    writeWorkoutPreference("deloadMode", true);
    writeWorkoutPreference("deloadWeightPct", 75);
    writeWorkoutPreference("deloadSetsPct", 75);
    const updated = readWorkoutPreferences();
    assert.equal(updated.deloadMode, true);
    assert.equal(updated.deloadWeightPct, 75);
    assert.equal(updated.deloadSetsPct, 75);

    resetLocalWorkoutPreferences();
    assert.equal(readWorkoutPreferences().deloadMode, false);
  } finally {
    if (prevStorage) Object.defineProperty(globalThis, "localStorage", prevStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
