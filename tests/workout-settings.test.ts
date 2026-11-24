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
  resetLocalWorkoutPreferences,
  writeWorkoutPreference,
} from "../packages/web/src/lib/workout-helpers.ts";
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
    });
    assert.equal(applied.autoAdvanceExercise, false);
    assert.equal(applied.weightStepKg, 1.25);
    assert.deepEqual(applied.enabledPlates, [20, 10]);
    assert.equal(applied.warmupScheme, "light");
    assert.equal(applied.soundStyle, "bell");
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
      body: { warmupScheme: "heavy", soundStyle: "marimba" },
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
    assert.equal(createdFilters[0]?.frequency.value, 1600);

    // Verify all 3 presets when enabled() is true
    isEnabled = true;
    for (const style of ["chime", "marimba", "bell"] as const) {
      currentStyle = style;
      resetCaptured();
      audio.play(true);
      assert.ok(createdOscs.length >= 2, `${style} schedules oscillators`);
      assert.equal(createdFilters.length, 1, `${style} routes through lowpass filter`);
      assert.equal(createdFilters[0]!.type, "lowpass");
      assert.ok(createdFilters[0]!.frequency.value <= 2600, `${style} cutoff (${createdFilters[0]!.frequency.value}) <= 2600 Hz`);

      for (const g of createdGains) {
        const peak = Math.max(0, ...g.gain.ramps);
        assert.ok(peak <= 0.25, `${style} peak gain (${peak}) stays headphone-safe <= 0.25`);
      }

      const fundamentals = createdOscs.filter((o) => Math.max(0, ...(o.connectedGain?.gain.ramps ?? [])) >= 0.1);
      assert.ok(fundamentals.length >= 2, `${style} has primary warm notes`);
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
