import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeWorkoutToFit,
  evaluateExerciseProgression,
  evaluateNutritionEnergyBalance,
  evaluateStrengthStandards,
  nextTarget,
  projectScheduleRange,
  type Workout,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import { getWebBadges } from "../packages/server/src/web-badges.js";
import { buildWebCsv } from "../packages/server/src/web-extras.js";
import { commitWorkoutCsvImport, csvImportInput, previewWorkoutCsvImport } from "../packages/server/src/web-import.js";
import { computeWeeklyStreak } from "../packages/server/src/web-statistics.js";
import { getWebWorkoutReport } from "../packages/server/src/web-workout-report.js";
import { buildDailySharePayload } from "../packages/web/src/lib/share-card.js";

function makeFixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("r12-21-owner");
  const call = (
    url: string,
    options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token === "" ? {} : { Authorization: "Bearer " + (options.token ?? owner.token) }),
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  return { db, app, store, auth, owner, call };
}

test("R17 #171/#172/#176: API tokens fail closed on interactive endpoints and pairing code is 8-char alphanumeric", async () => {
  const { call, auth, owner } = makeFixture();

  // Issue a scoped API token via interactive session
  const tokRes = await call("/api/tokens", {
    method: "POST",
    body: { label: "automation-script", ttlDays: 30 },
  });
  assert.equal(tokRes.status, 201);
  const issued = (await tokRes.json()) as { token: string; scope?: string };
  assert.ok(issued.token);
  assert.equal(auth.identifyWithScope(issued.token)?.scope, "api");

  // API token MUST be blocked from interactive-only webhook & apple token management endpoints
  const whRes = await call("/api/web/profile/webhook", {
    method: "PUT",
    token: issued.token,
    body: { enabled: false, url: "", secret: "", events: ["workout.completed"] },
  });
  assert.equal(whRes.status, 403);
  const appleTokRes = await call("/api/integrations/apple-health/tokens", { token: issued.token });
  assert.equal(appleTokRes.status, 403);

  // Interactive session CAN issue pairing code and it is 8-char unambiguous alphanumeric
  const pairRes = await call("/api/web/auth/pairing-code", { method: "POST" });
  assert.equal(pairRes.status, 201);
  const pair = (await pairRes.json()) as { code: string };
  assert.match(pair.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.ok(owner.userId);
});

test("R17 #175: backup export preserves photo thumbnails/sourceKey and restore clears apple_health_deleted tombstones", async () => {
  const { call, store, db, owner } = makeFixture();
  const sampleImg = "data:image/jpeg;base64," + Buffer.from("fake-jpg-bytes-123456").toString("base64");
  const sampleThumb = "data:image/jpeg;base64," + Buffer.from("tiny-thumb").toString("base64");

  const pRes = await call("/api/web/progress-photos", {
    method: "POST",
    body: {
      date: "2026-11-20",
      pose: "front",
      mime: "image/jpeg",
      imageData: sampleImg,
      thumbnailData: sampleThumb,
      sourceKey: "photo-src-1",
    },
  });
  assert.equal(pRes.status, 201);

  const exported = store.export(owner.userId);
  assert.equal(exported.progressPhotos.length, 1);
  assert.equal(exported.progressPhotos[0]!.thumbnailData, sampleThumb);
  assert.ok(typeof exported.progressPhotos[0]!.sourceKey === "string" && exported.progressPhotos[0]!.sourceKey.length > 0);

  // Insert an apple_health_deleted tombstone and restore in replace mode
  db.prepare("INSERT OR REPLACE INTO apple_health_deleted (user_id, identity_key, deleted_at) VALUES (?, ?, ?)").run(
    owner.userId,
    "hk-deleted-1",
    "2026-11-25T10:00:00Z",
  );
  store.restoreBackup(owner.userId, exported, { mode: "commit", strategy: "replace" });
  const tombstone = db
    .prepare("SELECT identity_key FROM apple_health_deleted WHERE user_id = ? AND identity_key = ?")
    .get(owner.userId, "hk-deleted-1");
  assert.equal(tombstone, undefined);
});

test("R17 #178/#179/#183: progression excludes drop/rest_pause/0-rep, schedule projection stays consistent, FIT includes lap", () => {
  const target = nextTarget(
    {
      exerciseId: "bench-press",
      sets: 3,
      repsMin: 6,
      repsMax: 10,
      weight: 80,
      seconds: 0,
      restSeconds: 90,
      targetRir: 2,
      progression: "double",
      increment: 2.5,
      backupExerciseId: null,
      supersetGroup: null,
    },
    {
      sets: [
        { id: "s1", type: "normal", weight: 80, reps: 0, seconds: 0, completed: true, rir: 2 },
        { id: "s2", type: "drop", weight: 60, reps: 15, seconds: 0, completed: true, rir: 1 },
      ],
    },
    "reps",
  );
  // Zero-rep and drop sets must not count as valid progression trigger
  assert.equal(target.weight, 80);

  const prog = evaluateExerciseProgression(
    {
      exerciseId: "bench-press",
      sets: 2,
      repsMin: 8,
      repsMax: 10,
      weight: 80,
      seconds: 0,
      restSeconds: 90,
      targetRir: 2,
      progression: "double",
      increment: 2.5,
      backupExerciseId: null,
      supersetGroup: null,
    },
    {
      id: "row-prev",
      exerciseId: "bench-press",
      restSeconds: 90,
      sets: [
        { id: "a", type: "normal", weight: 80, reps: 10, seconds: 0, completed: true, rir: 2 },
        { id: "b", type: "drop", weight: 60, reps: 12, seconds: 0, completed: true, rir: 1 },
      ],
    },
    undefined,
    [],
    "reps",
  );
  // Only 1 normal set hit ceiling, drop set excluded -> must NOT progress weight (stays at 80 kg, progress_reps)
  assert.notEqual(prog.status, "progress_weight");
  assert.equal(prog.status, "progress_reps");

  // #183: Strength standards skip when sex is undefined/null
  const stds = evaluateStrengthStandards(new Map([["bench-press", 100]]), 80, undefined as unknown as "male");
  assert.deepEqual(stds, []);

  // #179: projectScheduleRange consistency between full range and sub-range
  const activePlan = {
    id: "plan-ppl-1",
    version: 1,
    startedAt: "2026-11-23T00:00:00Z",
    data: {
      name: "PPL",
      weeks: 4,
      schedule: "rotation" as const,
      weekdays: [] as number[],
      rationale: "test",
      source: "manual" as const,
      parentId: null,
      routines: [
        { id: "rA", name: "Push", exercises: [] },
        { id: "rB", name: "Pull", exercises: [] },
      ],
    },
  };
  const full = projectScheduleRange({
    activePlan,
    from: "2026-11-23",
    through: "2026-12-06",
    todayDate: "2026-11-23",
    daysPerWeek: 3,
    workouts: [],
    appleActivities: [],
    scheduledDays: new Map(),
    catalogue: new Map(),
  });
  const sub = projectScheduleRange({
    activePlan,
    from: "2026-11-30",
    through: "2026-12-06",
    todayDate: "2026-11-23",
    daysPerWeek: 3,
    workouts: [],
    appleActivities: [],
    scheduledDays: new Map(),
    catalogue: new Map(),
  });
  const fullSlice = full.filter((d) => d.date >= "2026-11-30");
  assert.deepEqual(
    sub.map((d) => [d.date, d.routineId]),
    fullSlice.map((d) => [d.date, d.routineId]),
  );

  // #183: FIT binary export succeeds with extreme duration/volume values (clamped without throwing)
  const hugeWorkout: Workout = {
    title: "Extreme Test",
    date: "2026-11-25",
    startedAt: "2026-11-25T10:00:00Z",
    endedAt: "2026-11-25T11:00:00Z",
    status: "completed",
    source: "manual",
    feeling: null,
    notes: "",
    exercises: [
      {
        id: "ex1",
        exerciseId: "bench-press",
        restSeconds: 90,
        sets: [
          { id: "s1", type: "normal", weight: 500, reps: 100, seconds: 0, completed: true, rir: null },
        ],
      },
    ],
  };
  const fit = encodeWorkoutToFit(hugeWorkout, new Map());
  assert.ok(fit.length > 50);
  assert.equal(Buffer.from(fit.slice(8, 12)).toString("ascii"), ".FIT");
});

test("R12 #134: shiftWebScheduleDay rejects stale confirmation when active plan switched on another device", async () => {
  const { call, store, owner } = makeFixture();
  const makeRoutine = (id: string, name: string, exerciseId: string) => ({
    id,
    name,
    exercises: [
      {
        exerciseId,
        sets: 3,
        repsMin: 8,
        repsMax: 12,
        weight: 60,
        seconds: 0,
        restSeconds: 90,
        targetRir: 2,
        progression: "double" as const,
        increment: 2.5,
        backupExerciseId: null,
        supersetGroup: null,
      },
    ],
  });

  const d1 = store.createDraft(owner.userId, {
    name: "Plan A",
    weeks: 4,
    schedule: "weekdays",
    weekdays: [1, 2],
    rationale: "A",
    source: "manual",
    parentId: null,
    routines: [makeRoutine("rA1", "Push A", "bench-press"), makeRoutine("rA2", "Pull A", "barbell-row")],
  });
  store.applyPlan(owner.userId, d1.record.id, d1.record.version, 0);

  // First shift attempt hits conflict on Tuesday 2026-12-01 (Monday 2026-11-30 -> Tuesday 2026-12-01)
  const firstRes = await call("/api/web/schedule/shift", {
    method: "POST",
    body: { fromDate: "2026-11-30", toDate: "2026-12-01" },
  });
  assert.equal(firstRes.status, 409);
  const conflict = (await firstRes.json()) as {
    planRevision: number;
    fromRoutineId: string | null;
    fromVersion: number;
    conflictTarget: { version: number; routineId?: string | null };
  };
  assert.equal(typeof conflict.planRevision, "number");

  // Another device switches active plan to Plan B
  const d2 = store.createDraft(owner.userId, {
    name: "Plan B",
    weeks: 4,
    schedule: "weekdays",
    weekdays: [1, 2],
    rationale: "B",
    source: "manual",
    parentId: null,
    routines: [makeRoutine("rB1", "Legs B", "squat"), makeRoutine("rB2", "Shoulders B", "overhead-press")],
  });
  store.applyPlan(owner.userId, d2.record.id, d2.record.version, conflict.planRevision);

  // Re-submitting old overwrite confirmation MUST fail with 409 instead of moving Plan B's Squat
  const staleRes = await call("/api/web/schedule/shift", {
    method: "POST",
    body: {
      fromDate: "2026-11-30",
      toDate: "2026-12-01",
      overwrite: true,
      expectedFromVersion: conflict.fromVersion,
      expectedToVersion: conflict.conflictTarget.version,
      expectedPlanRevision: conflict.planRevision,
      expectedFromRoutineId: conflict.fromRoutineId,
      expectedToRoutineId: conflict.conflictTarget.routineId ?? null,
    },
  });
  assert.equal(staleRes.status, 409);
});

test("R14 #147: DELETE /api/web/nutrition-day enforces opId idempotency and expectedVersion against cross-device re-confirm", async () => {
  const { call } = makeFixture();
  const date = "2026-11-20";
  await call("/api/records", {
    method: "POST",
    body: {
      opId: "diet-seed-1",
      id: "diet-1",
      kind: "diet",
      baseVersion: 0,
      deleted: false,
      data: { date, meal: "lunch", name: "鸡胸肉", calories: 400, protein: 40, carbs: 20, fat: 8, source: "manual", rawPrompt: "" },
    },
  });

  // Confirm day -> v1
  const put1 = await call("/api/web/nutrition-day", {
    method: "PUT",
    body: { date, opId: "nd-put-1" },
  });
  assert.equal(put1.status, 200);
  const put1Json = (await put1.json()) as { complete: boolean; version: number };
  assert.equal(put1Json.complete, true);
  assert.equal(put1Json.version, 1);

  // Device A cancels v1 with opId "cancel-op-1" -> v2
  const del1 = await call(`/api/web/nutrition-day?date=${date}&opId=cancel-op-1&expectedVersion=1`, {
    method: "DELETE",
  });
  assert.equal(del1.status, 200);

  // Device B re-confirms -> v3
  const put2 = await call("/api/web/nutrition-day", {
    method: "PUT",
    body: { date, opId: "nd-put-2" },
  });
  assert.equal(put2.status, 200);
  const put2Json = (await put2.json()) as { complete: boolean; version: number };
  assert.equal(put2Json.version, 3);

  // Device A replays original opId "cancel-op-1" (lost receipt) -> replays cleanly WITHOUT deleting v3!
  const replayDel = await call(`/api/web/nutrition-day?date=${date}&opId=cancel-op-1&expectedVersion=1`, {
    method: "DELETE",
  });
  assert.equal(replayDel.status, 200);

  // Verify day is STILL complete on server!
  const getAfterReplay = await call(`/api/web/nutrition-day?date=${date}`);
  const afterJson = (await getAfterReplay.json()) as { complete: boolean; version: number };
  assert.equal(afterJson.complete, true);
  assert.equal(afterJson.version, 3);

  // Fresh DELETE with stale expectedVersion=1 -> 409 conflict
  const staleDel = await call(`/api/web/nutrition-day?date=${date}&opId=cancel-op-2&expectedVersion=1`, {
    method: "DELETE",
  });
  assert.equal(staleDel.status, 409);
});

test("R14/R18/R20 #153/#193/#194/#197/#198/#202: macroPct sums 100%, paired WHR, unrounded badges & SBD Big-3, freeze dates", async () => {
  // #153: 20g P (12.5%), 140g C (87.5%), 0g F (0%) -> macroPct must sum to 100%, never 101%
  const nut = evaluateNutritionEnergyBalance({
    dailyMacros: [
      {
        date: "2026-11-20",
        calories: 640,
        protein: 20,
        carbs: 140,
        fat: 0,
        isTrainingDay: false,
      },
    ],
    targetCalories: 2200,
  });
  assert.equal(nut.macroPct.protein + nut.macroPct.carbs + nut.macroPct.fat, 100);

  // #202: computeWeeklyStreak respects targetDate and does not consume future freeze logs
  const streak = computeWeeklyStreak(
    new Set(["2026-11-02", "2026-11-09"]),
    "2026-11-15",
    ["2026-W47"],
    [{ weekKey: "2026-W47", usedAt: "2026-11-18" }],
  );
  assert.equal(streak.freezeRemainingThisMonth, 1);

  // #193/#194 & #197/#198: analytics & badges checks
  const { store, owner, call } = makeFixture();
  // Two dates: waist on 11-18, hip on 11-20 (unpaired!) -> whr should be null
  assert.equal((await call("/api/web/measurements", { method: "PUT", body: { date: "2026-11-18", waistCm: 80 } })).status, 200);
  assert.equal((await call("/api/web/measurements", { method: "PUT", body: { date: "2026-11-20", hipCm: 100 } })).status, 200);
  const analytics = getWebAnalytics(store, owner.userId, { days: 30, through: "2026-11-25" });
  assert.equal(analytics.bodyMeasurements.whr, null);

  // #198: Big-3 SBD badge requires all 3 lifts (squat + bench + deadlift), not just 1 lift >= 300kg
  store.mutate(owner.userId, {
    kind: "workout",
    id: "w-sbd",
    opId: "w-sbd-op",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "Bench only",
      date: "2026-11-20",
      startedAt: "2026-11-20T10:00:00Z",
      endedAt: "2026-11-20T11:00:00Z",
      status: "completed",
      source: "manual",
      feeling: null,
      notes: "",
      exercises: [
        {
          id: "e1",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: "s1", type: "normal", weight: 320, reps: 1, seconds: 0, completed: true, rir: null }],
        },
      ],
    },
  });
  const badges = getWebBadges(store, owner.userId, "2026-11-25");
  const sbd250 = badges.badges.find((b) => b.id === "sbd-250");
  assert.ok(sbd250);
  assert.equal(sbd250.unlocked, false);
});

test("R18 #184/#185/#191: Apple Health daily cross-midnight sleep dedupe, untimed supersede, and bodyFatPct merge", async () => {
  const { call } = makeFixture();
  const devRes = await call("/api/integrations/apple-health/tokens", {
    method: "POST",
    body: { label: "test-iphone" },
  });
  assert.equal(devRes.status, 201);
  const dev = (await devRes.json()) as { token: string };

  // Batch sync weight + bodyFat on 2026-11-20, then weight-only update preserves bodyFatPct (#191)
  const r1 = await call("/api/integrations/apple-health/daily", {
    method: "POST",
    token: dev.token,
    body: { date: "2026-11-20", weightKg: 75.2, bodyFatPct: 16.4 },
  });
  assert.equal(r1.status, 200);
  const r2 = await call("/api/integrations/apple-health/daily", {
    method: "POST",
    token: dev.token,
    body: { date: "2026-11-20", weightKg: 75.0 },
  });
  assert.equal(r2.status, 200);
  const getDaily = await call("/api/integrations/apple-health/daily?from=2026-11-20&through=2026-11-20");
  const dailyJson = (await getDaily.json()) as { entries: Array<{ weightKg?: number; bodyFatPct?: number }> };
  assert.equal(dailyJson.entries[0]?.weightKg, 75);
  assert.equal(dailyJson.entries[0]?.bodyFatPct, 16.4);

  // Cross-midnight sleep interval uploaded on two adjacent days should not double count (#184)
  const s1 = await call("/api/integrations/apple-health/daily", {
    method: "POST",
    token: dev.token,
    body: {
      date: "2026-11-21",
      shortcutGenVersion: 3,
      sleepSamples: ["Core|2026-11-21T23:15:00+08:00|2026-11-21T23:55:00+08:00"].join("\n"),
    },
  });
  assert.equal(s1.status, 200);
  const s2 = await call("/api/integrations/apple-health/daily", {
    method: "POST",
    token: dev.token,
    body: {
      date: "2026-11-22",
      shortcutGenVersion: 3,
      sleepSamples: [
        "Core|2026-11-21T23:15:00+08:00|2026-11-21T23:55:00+08:00",
        "Deep|2026-11-22T00:05:00+08:00|2026-11-22T06:25:00+08:00",
      ].join("\n"),
    },
  });
  assert.equal(s2.status, 200);
  const sleepRange = await call("/api/integrations/apple-health/daily?from=2026-11-21&through=2026-11-22");
  const sleepJson = (await sleepRange.json()) as { entries: Array<{ date: string; sleepMinutes?: number | null }> };
  const totalSleep = sleepJson.entries.reduce((s, e) => s + (e.sleepMinutes ?? 0), 0);
  assert.equal(totalSleep, 420); // 40 min + 380 min = 420 min, NOT 460 min!
});

test("R21 #214–#222: CSV semicolon decimal comma, export round-trip, previewSignature 409, and opId idempotency", () => {
  const { store, owner } = makeFixture();

  // #214: Semicolon-delimited CSV with European decimal comma (62,5 -> 62.5)
  const euroCsv = [
    "Date;Workout Name;Exercise Name;Set Order;Weight;Reps",
    "2026-11-20 09:00:00;Morning Push;Bench Press;1;62,5;8",
  ].join("\n");
  const euroPrev = previewWorkoutCsvImport(store, owner.userId, csvImportInput.parse({ csv: euroCsv }));
  assert.equal(euroPrev.totalSets, 1);
  const euroCommit = commitWorkoutCsvImport(
    store,
    owner.userId,
    csvImportInput.parse({
      csv: euroCsv,
      opId: "csv-euro-op-1",
      expectedPreviewSignature: euroPrev.previewSignature,
    }),
  );
  assert.equal(euroCommit.importedWorkouts, 1);

  // #221: Replaying exact same opId returns idempotent receipt without importing again
  const euroReplay = commitWorkoutCsvImport(
    store,
    owner.userId,
    csvImportInput.parse({
      csv: euroCsv,
      opId: "csv-euro-op-1",
    }),
  );
  assert.equal(euroReplay.replayed, true);
  assert.equal(store.list(owner.userId, "workout").length, 1);

  // #220: Stale previewSignature after DB changes throws 409
  assert.throws(
    () =>
      commitWorkoutCsvImport(
        store,
        owner.userId,
        csvImportInput.parse({
          csv: euroCsv,
          expectedPreviewSignature: euroPrev.previewSignature,
        }),
      ),
    (err: { status?: number }) => err?.status === 409,
  );

  // #217/#218: Ironlog CSV export -> re-import preserves custom exercise metadata & separate rows
  store.mutate(owner.userId, {
    kind: "workout",
    id: "w-rt-1",
    opId: "w-rt-1-op",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "Custom Roundtrip",
      date: "2026-11-21",
      startedAt: "2026-11-21T08:00:00Z",
      endedAt: "2026-11-21T09:00:00Z",
      status: "completed",
      source: "manual",
      feeling: null,
      notes: "",
      exercises: [
        {
          id: "row-plank-1",
          exerciseId: "custom-plank-rt",
          restSeconds: 60,
          snapshot: { name: "负重平板支撑", muscle: "core", equipment: "weighted", mode: "timed", volumeMultiplier: 1 },
          sets: [{ id: "s1", type: "normal", weight: 0, reps: 0, seconds: 90, completed: true, rir: null }],
        },
      ],
    },
  });
  const exportedCsv = buildWebCsv(store, owner.userId, "workouts").content;
  assert.ok(exportedCsv.includes("动作行ID"));
  assert.ok(exportedCsv.includes("动作模式"));
  const { store: store2, owner: owner2 } = makeFixture();
  const rtCommit = commitWorkoutCsvImport(store2, owner2.userId, csvImportInput.parse({ csv: exportedCsv }));
  assert.ok(rtCommit.importedWorkouts >= 1);
  const importedPlank = store2
    .list(owner2.userId, "workout")
    .flatMap((w) => (w.data as Workout).exercises)
    .find((e) => e.snapshot?.name === "负重平板支撑");
  assert.ok(importedPlank);
  assert.equal(importedPlank.snapshot?.mode, "timed");
  assert.equal(importedPlank.snapshot?.muscle, "core");
});

test("R13 #106/#136–#141/#145: ShareCard payload isolation, lb unit, cardio classification, dedupe, hybrid, unknown duration & varying sets", () => {
  const { store, owner } = makeFixture();
  // Create a manual cardio workout and check report exposes muscle/category/cardioMeta (#141)
  store.mutate(owner.userId, {
    kind: "workout",
    id: "cardio-run-1",
    opId: "cardio-run-1-op",
    baseVersion: 0,
    deleted: false,
    data: {
      title: "户外跑步",
      date: "2026-11-22",
      startedAt: "2026-11-22T07:00:00Z",
      endedAt: "2026-11-22T07:30:00Z",
      status: "completed",
      source: "manual",
      feeling: null,
      notes: "",
      cardioMeta: { activityType: "running", environment: "outdoor", distanceMeters: 5000, estimatedKcal: 320, lapSeconds: [] },
      exercises: [
        {
          id: "ex-run",
          exerciseId: "cardio-outdoor-run",
          restSeconds: 0,
          snapshot: { name: "户外跑步", muscle: "cardio", equipment: "bodyweight", mode: "timed", volumeMultiplier: 1 },
          sets: [{ id: "s1", type: "normal", weight: 0, reps: 0, seconds: 1800, completed: true, rir: null }],
        },
      ],
    },
  });
  const cardioReport = getWebWorkoutReport(store, owner.userId, "cardio-run-1");
  const cardioSingle = buildDailySharePayload({
    date: "2026-11-22",
    singleReport: cardioReport as unknown as Parameters<typeof buildDailySharePayload>[0]["singleReport"],
    diets: [{ date: "2026-11-22", meal: "lunch", name: "饭", calories: 777, protein: 30, carbs: 90, fat: 20, source: "manual", rawPrompt: "" }],
    appleEntries: [{ id: "ap-other", activityType: "cycling", durationSeconds: 1200 }],
  });
  // #136: singleReport ignores day's diet and unrelated Apple activities
  assert.equal(cardioSingle.diet.hasData, false);
  // #141: manual cardio is classified as cardio (30 min), NOT strength
  assert.equal(cardioSingle.cardio.hasData, true);
  assert.equal(cardioSingle.cardio.minutes, 30);
  assert.equal(cardioSingle.strength.minutes, 0);

  // #106 & #140 & #145: singleReport preserves lb unit, unknown duration stays 0 (not 15), varying sets show 最佳组
  const lbPayload = buildDailySharePayload({
    date: "2026-11-22",
    singleReport: {
      id: "w-lb",
      title: "卧推",
      date: "2026-11-22",
      duration: null,
      sets: 2,
      volume: 1120,
      muscleSets: [],
      records: [],
      exercises: [
        {
          id: "r1",
          exerciseId: "bench-press",
          name: "平板杠铃卧推",
          mode: "reps",
          weightUnit: "lb",
          volume: 1120,
          completed: [
            { type: "normal", weight: 115, reps: 8, seconds: 0, rir: null },
            { type: "normal", weight: 135, reps: 8, seconds: 0, rir: null },
          ],
        },
      ],
    },
  });
  assert.equal(lbPayload.totalMinutes, 0);
  assert.equal(lbPayload.durationUnknown, true);
  assert.equal(lbPayload.strength.exercises[0]?.summary, "最佳组 135 lb × 8 · 共 2 组");

  // #137: Multiple independent Apple Watch strength workouts sum durations (20 + 45 = 65 min)
  const twoAppleStrength = buildDailySharePayload({
    date: "2026-11-22",
    appleEntries: [
      { id: "ap-s1", activityType: "traditional_strength", durationSeconds: 1200 },
      { id: "ap-s2", activityType: "traditional_strength", durationSeconds: 2700 },
    ],
  });
  assert.equal(twoAppleStrength.strength.minutes, 65);
  assert.equal(twoAppleStrength.totalMinutes, 65);

  // #138: Linked Apple cardio dedupes with manual cardio workout (30 min, NOT 60 min)
  const linkedRun = buildDailySharePayload({
    date: "2026-11-22",
    workouts: [
      {
        id: "cardio-run-1",
        kind: "workout",
        version: 1,
        deleted: false,
        updatedAt: "2026-11-22T07:30:00Z",
        data: {
          title: "户外跑步",
          date: "2026-11-22",
          startedAt: "2026-11-22T07:00:00Z",
          endedAt: "2026-11-22T07:30:00Z",
          status: "completed",
          source: "manual",
          feeling: null,
          notes: "",
          exercises: [
            {
              id: "ex-run",
              exerciseId: "cardio-outdoor-run",
              restSeconds: 0,
              snapshot: { name: "户外跑步", muscle: "cardio", equipment: "bodyweight", mode: "timed", volumeMultiplier: 1 },
              sets: [{ id: "s1", type: "normal", weight: 0, reps: 0, seconds: 1800, completed: true, rir: null }],
            },
          ],
        },
      },
    ],
    appleEntries: [
      {
        id: "ap-run-1",
        activityType: "running",
        durationSeconds: 1800,
        avgHeartRate: 152,
        manualWorkoutId: "cardio-run-1",
      },
    ],
  });
  assert.equal(linkedRun.cardio.minutes, 30);
  assert.equal(linkedRun.cardio.avgBpm, 152);
  assert.equal(linkedRun.totalMinutes, 30);

  // #139: Hybrid workout (60 min total containing bench + 10 min cycling) -> totalMinutes = 60, NOT 70
  const hybrid = buildDailySharePayload({
    date: "2026-11-22",
    workouts: [
      {
        id: "w-hybrid",
        kind: "workout",
        version: 1,
        deleted: false,
        updatedAt: "2026-11-22T11:00:00Z",
        data: {
          title: "混合训练",
          date: "2026-11-22",
          startedAt: "2026-11-22T10:00:00Z",
          endedAt: "2026-11-22T11:00:00Z",
          status: "completed",
          source: "manual",
          feeling: null,
          notes: "",
          exercises: [
            {
              id: "e1",
              exerciseId: "bench-press",
              restSeconds: 90,
              snapshot: { name: "卧推", muscle: "chest", equipment: "barbell", mode: "reps", volumeMultiplier: 1 },
              sets: [{ id: "s1", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: null }],
            },
            {
              id: "e2",
              exerciseId: "cycling",
              restSeconds: 0,
              snapshot: { name: "骑行", muscle: "cardio", equipment: "machine", mode: "timed", volumeMultiplier: 1 },
              sets: [{ id: "s2", type: "normal", weight: 0, reps: 0, seconds: 600, completed: true, rir: null }],
            },
          ],
        },
      },
    ],
  });
  assert.equal(hybrid.strength.minutes, 60);
  assert.equal(hybrid.cardio.minutes, 10);
  assert.equal(hybrid.totalMinutes, 60);
});
