import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countValidWorkSets,
  evaluateExerciseProgression,
  localDate,
  nextTarget,
  planSchema,
  starterPlans,
  validatePlanExercises,
  workoutSchema,
  type Workout,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { serverCatalogue } from "../packages/server/src/catalogue.js";
import { openDatabase } from "../packages/server/src/db.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";
import { resolveSetRestSeconds } from "../web/src/workout-clock.js";
import { duration, plateBreakdown, workoutSeconds } from "../web/src/ui.js";

function fixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("opengym-owner");
  const other = auth.login("opengym-other");
  const call = (url: string, options: { token?: string; method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: "Bearer " + (options.token ?? owner.token),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  return { db, app, store, auth, call, owner, other };
}

test("Greyskull AMRAP 渐进：常规加重、末组双倍达标×2 爆发与失利自动减载 -10%", () => {
  const item = {
    exerciseId: "bench-press",
    sets: 3,
    repsMin: 5,
    repsMax: 5,
    weight: 80,
    seconds: 0,
    restSeconds: 150,
    targetRir: 2,
    progression: "greyskull" as const,
    increment: 2.5,
    backupExerciseId: null,
  };
  const makeRow = (weights: number[], repsList: number[]): Workout["exercises"][number] => ({
    id: "r1",
    exerciseId: "bench-press",
    targetIndex: 0,
    supersetGroup: null,
    restSeconds: 150,
    snapshot: { name: "平板杠铃卧推", muscle: "chest", equipment: "barbell", mode: "reps", volumeMultiplier: 1 },
    sets: weights.map((weight, i) => ({
      id: `s${i}`,
      type: "normal",
      weight,
      reps: repsList[i]!,
      seconds: 0,
      completed: true,
      rir: null,
    })),
  });

  // 1) Normal hit (5, 5, 7 < 10) -> +2.5 kg
  const normalPrev = makeRow([80, 80, 80], [5, 5, 7]);
  const hitRes = nextTarget(item, normalPrev, "reps");
  assert.equal(hitRes.weight, 82.5);
  assert.equal(hitRes.increased, true);
  assert.equal(hitRes.doubleJump, undefined);
  const hitReport = evaluateExerciseProgression(item, normalPrev, undefined, [], "reps");
  assert.equal(hitReport.status, "progress_weight");
  assert.match(hitReport.statusLabel, /\+2\.5 kg/);

  // 2) AMRAP double-rep threshold (5, 5, 10 >= 2*5) -> +5 kg double jump
  const amrapPrev = makeRow([80, 80, 80], [5, 5, 10]);
  const burstRes = nextTarget(item, amrapPrev, "reps");
  assert.equal(burstRes.weight, 85);
  assert.equal(burstRes.increased, true);
  assert.equal(burstRes.doubleJump, true);
  const burstReport = evaluateExerciseProgression(item, amrapPrev, undefined, [], "reps");
  assert.equal(burstReport.status, "progress_weight");
  assert.match(burstReport.statusLabel, /AMRAP 爆发.*\+5 kg/);

  // 3) Missed reps (5, 4, 3 at 100 kg) -> -10% deload rounded to 1.25 kg (= 90 kg)
  const missPrev = makeRow([100, 100, 100], [5, 4, 3]);
  const missRes = nextTarget(item, missPrev, "reps");
  assert.equal(missRes.weight, 90);
  assert.equal(missRes.increased, false);
  assert.equal(missRes.deloaded, true);
  const missReport = evaluateExerciseProgression(item, missPrev, undefined, [], "reps");
  assert.equal(missReport.status, "plateau_deload");
  assert.equal(missReport.deloadWeight, 90);
  assert.match(missReport.statusLabel, /自动减载 -10%/);
});

test("rest_pause 休停组通过 schema 校验、计入有效工作组且正确导出 CSV", async () => {
  const { db, call } = fixture();
  try {
    const date = shiftDay(localDate(), -1);
    const parsedWorkout = workoutSchema.parse({
      title: "休停刺激测试",
      date,
      startedAt: `${date}T10:00:00Z`,
      endedAt: `${date}T10:40:00Z`,
      status: "completed",
      exercises: [
        {
          id: "ex-rp-1",
          exerciseId: "lateral-raise",
          restSeconds: 60,
          sets: [
            { id: "rp-w", type: "warmup", weight: 5, reps: 15, seconds: 0, completed: true, rir: null },
            { id: "rp-1", type: "normal", weight: 10, reps: 15, seconds: 0, completed: true, rir: 0 },
            { id: "rp-2", type: "rest_pause", weight: 10, reps: 6, seconds: 0, completed: true, rir: 0 },
          ],
        },
      ],
    });
    assert.equal(countValidWorkSets(parsedWorkout.exercises[0]!.sets, "reps"), 2);

    const saveRes = await call("/api/records", {
      method: "POST",
      body: { opId: "rp-op-1", id: "w-rp-1", kind: "workout", baseVersion: 0, deleted: false, data: parsedWorkout },
    });
    assert.equal(saveRes.status, 200);

    const csvRes = await call("/api/web/export-csv/workouts");
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.match(csvText, /休停/);
  } finally {
    db.close();
  }
});

test("经典训练方案库全量通过校验，支持存草稿、一键启用及冲突时零残留孤立草稿", async () => {
  const { db, store, call, owner } = fixture();
  try {
    assert.equal(starterPlans.length, 5);
    for (const preset of starterPlans) {
      planSchema.parse(preset.plan);
      validatePlanExercises(preset.plan, serverCatalogue);
    }

    const listRes = await call("/api/web/starter-plans");
    assert.equal(listRes.status, 200);
    const items = (await listRes.json()) as Array<{
      id: string;
      exerciseNames: Record<string, string>;
      weeklyMuscleSets: Array<{ key: string; name: string; sets: number }>;
    }>;
    assert.equal(items.length, 5);
    const ppl = items.find((i) => i.id === "ppl-3");
    assert.ok(ppl);
    assert.equal(ppl.exerciseNames["bench-press"], "平板杠铃卧推");
    assert.ok(ppl.weeklyMuscleSets.some((m) => m.key === "chest" && m.sets > 0));

    // Adopt as draft without activating
    const draftRes = await call("/api/web/starter-plans/dumbbell-home-3/adopt", {
      method: "POST",
      body: { mode: "draft" },
    });
    assert.equal(draftRes.status, 201);
    const draftBody = (await draftRes.json()) as { mode: string; activePlan: unknown };
    assert.equal(draftBody.mode, "draft");
    assert.equal(draftBody.activePlan, null);

    // Adopt & apply Greyskull starter plan
    const applyRes = await call("/api/web/starter-plans/greyskull-5x5/adopt", {
      method: "POST",
      body: { mode: "apply", expectedRevision: 0 },
    });
    assert.equal(applyRes.status, 201);
    const applyBody = (await applyRes.json()) as { mode: string; activePlan: { revision: number; data: { name: string } } };
    assert.equal(applyBody.mode, "apply");
    assert.equal(applyBody.activePlan.revision, 1);
    assert.match(applyBody.activePlan.data.name, /Greyskull/);

    // Revision conflict (409) must roll back draft creation cleanly
    const beforeCount = store.list(owner.userId, "plan").length;
    const conflictRes = await call("/api/web/starter-plans/ppl-3/adopt", {
      method: "POST",
      body: { mode: "apply", expectedRevision: 99 },
    });
    assert.equal(conflictRes.status, 409);
    const afterCount = store.list(owner.userId, "plan").length;
    assert.equal(afterCount, beforeCount);
  } finally {
    db.close();
  }
});

test("统计接口返回 6 肌群恢复状态与间隔，精准反映近期力竭、协同外溢、已恢复与久未刺激", async () => {
  const { db, call } = fixture();
  try {
    const today = localDate();
    const chestEndMs = Date.now() - 4 * 3600 * 1000;
    const chestStartMs = chestEndMs - 3600 * 1000;
    const chestDate = localDate(chestEndMs);
    const fiveDaysAgo = shiftDay(today, -5);

    // Heavy failure chest session 4h ago (bench-press hits chest + secondary shoulders/arms)
    const chestSave = await call("/api/records", {
      method: "POST",
      body: {
        opId: "ms-op-1",
        id: "w-ms-chest",
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: {
          title: "高强度推胸",
          date: chestDate,
          startedAt: new Date(chestStartMs).toISOString(),
          endedAt: new Date(chestEndMs).toISOString(),
          status: "completed",
          exercises: [
            {
              id: "ms-e1",
              exerciseId: "bench-press",
              restSeconds: 120,
              sets: Array.from({ length: 6 }, (_, i) => ({
                id: `ms-c-${i}`,
                type: "failure",
                weight: 100,
                reps: 6,
                completed: true,
                rir: 0,
              })),
            },
          ],
        },
      },
    });
    assert.equal(chestSave.status, 200);

    // Moderate back session 5 days ago -> should now be ready (>=80%)
    const backSave = await call("/api/records", {
      method: "POST",
      body: {
        opId: "ms-op-2",
        id: "w-ms-back",
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: {
          title: "稳态划船",
          date: fiveDaysAgo,
          startedAt: `${fiveDaysAgo}T10:00:00Z`,
          endedAt: `${fiveDaysAgo}T10:45:00Z`,
          status: "completed",
          exercises: [
            {
              id: "ms-e2",
              exerciseId: "barbell-row",
              restSeconds: 90,
              sets: Array.from({ length: 4 }, (_, i) => ({
                id: `ms-b-${i}`,
                type: "normal",
                weight: 70,
                reps: 10,
                completed: true,
                rir: 2,
              })),
            },
          ],
        },
      },
    });
    assert.equal(backSave.status, 200);

    const res = await call(`/api/web/statistics?days=30&through=${today}`);
    assert.equal(res.status, 200);
    const stats = (await res.json()) as {
      muscles: Array<{ key: string; sets: number }>;
      muscleStatus: Array<{
        key: string;
        recoveryPct: number;
        fatiguePct: number;
        status: "fatigued" | "recovering" | "ready" | "detrained";
        daysSinceLast: number | null;
        recent7dSets: number;
      }>;
    };

    // Existing primary muscles field stays unchanged
    assert.equal(stats.muscles.find((m) => m.key === "chest")?.sets, 6);
    assert.equal(stats.muscles.find((m) => m.key === "back")?.sets, 4);

    const byKey = new Map(stats.muscleStatus.map((m) => [m.key, m]));
    assert.equal(byKey.get("chest")?.status, "fatigued");
    assert.ok((byKey.get("chest")?.recoveryPct ?? 100) < 45);
    assert.equal(byKey.get("chest")?.daysSinceLast, chestDate === today ? 0 : 1);

    // Secondary spillover from bench-press (0.5 per set = 3.0)
    assert.equal(byKey.get("shoulders")?.recent7dSets, 3);
    assert.equal(byKey.get("arms")?.recent7dSets, 5); // 3 from bench-press (0.5*6) + 2 from barbell-row (0.5*4)
    assert.equal(byKey.get("back")?.status, "ready");
    assert.equal(byKey.get("back")?.daysSinceLast, 5);
    assert.equal(byKey.get("legs")?.status, "detrained");
    assert.equal(byKey.get("legs")?.daysSinceLast, null);
  } finally {
    db.close();
  }
});

test("第三方 CSV 导入接口支持 Strong(lbs/RPE)、Hevy、FitNotes、铁记往返、去重与账号隔离", async () => {
  const { db, app, call, other } = fixture();
  try {
    // 1) Auth & invalid CSV checks
    assert.equal((await app.request("/api/web/import-csv/preview", { method: "POST" })).status, 401);
    const badRes = await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: "foo,bar\n1,2" },
    });
    assert.equal(badRes.status, 400);

    const d1 = shiftDay(localDate(), -3);
    const d2 = shiftDay(localDate(), -2);
    const d3 = shiftDay(localDate(), -4);

    // 2) Strong CSV (lbs + RPE -> kg & RIR)
    const strongCsv = [
      "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,RPE",
      `${d1} 09:00:00,Push Power,50m,Bench Press (Barbell),W,95,lbs,10,`,
      `${d1} 09:00:00,Push Power,50m,Bench Press (Barbell),1,220,lbs,5,8`,
    ].join("\n");
    const previewStrong = await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: strongCsv },
    });
    assert.equal(previewStrong.status, 200);
    const pStrong = (await previewStrong.json()) as {
      format: string;
      importableWorkouts: number;
      matchedExercises: number;
      totalSets: number;
    };
    assert.equal(pStrong.format, "strong");
    assert.equal(pStrong.importableWorkouts, 1);
    assert.equal(pStrong.matchedExercises, 1);
    assert.equal(pStrong.totalSets, 2);

    const commitStrong = await call("/api/web/import-csv/commit", {
      method: "POST",
      body: { csv: strongCsv },
    });
    assert.equal(commitStrong.status, 200);
    const workoutsAfterStrong = (await (await call("/api/records/workout")).json()) as Array<{ data: Workout }>;
    const importedStrong = workoutsAfterStrong.find((w) => w.data.title === "Push Power")?.data;
    assert.ok(importedStrong);
    assert.equal(importedStrong.exercises[0]!.exerciseId, "bench-press");
    assert.equal(importedStrong.exercises[0]!.sets[0]!.type, "warmup");
    assert.equal(importedStrong.exercises[0]!.sets[1]!.rir, 2); // RPE 8 -> RIR 2
    assert.ok(importedStrong.exercises[0]!.sets[1]!.weight > 99 && importedStrong.exercises[0]!.sets[1]!.weight < 100.5);

    // Re-importing same Strong CSV skips duplicate by default, imports when skipDuplicates=false
    const dupPreview = (await (await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: strongCsv, skipDuplicates: true },
    })).json()) as { duplicateWorkouts: number; importableWorkouts: number };
    assert.equal(dupPreview.duplicateWorkouts, 1);
    assert.equal(dupPreview.importableWorkouts, 0);

    // 3) Hevy CSV (warmup, dropset, failure + superset + duration)
    const hevyCsv = [
      "title,start_time,end_time,exercise_title,superset_id,set_index,set_type,weight_kg,reps,duration_seconds,rpe",
      `Upper Hypertrophy,${d2} 18:00:00,${d2} 18:55:00,Incline Dumbbell Press,1,0,dropset,24,10,0,9`,
      `Upper Hypertrophy,${d2} 18:00:00,${d2} 18:55:00,Incline Dumbbell Press,1,1,failure,18,12,0,10`,
    ].join("\n");
    const commitHevy = (await (await call("/api/web/import-csv/commit", {
      method: "POST",
      body: { csv: hevyCsv },
    })).json()) as { format: string; importedWorkouts: number; importedSets: number };
    assert.equal(commitHevy.format, "hevy");
    assert.equal(commitHevy.importedWorkouts, 1);
    assert.equal(commitHevy.importedSets, 2);

    // 4) FitNotes CSV -> creates custom exercise for unknown lift
    const fitNotesCsv = [
      "Date,Exercise,Category,Weight,Reps,Time,Comment",
      `${d3},Zottman Cable Finisher,Arms,15,12,,pump set`,
    ].join("\n");
    const commitFit = (await (await call("/api/web/import-csv/commit", {
      method: "POST",
      body: { csv: fitNotesCsv },
    })).json()) as { format: string; createdCustomExercises: number; importedWorkouts: number };
    assert.equal(commitFit.format, "fitnotes");
    assert.equal(commitFit.createdCustomExercises, 1);
    assert.equal(commitFit.importedWorkouts, 1);

    // 5) Ironlog CSV export -> re-import into isolated `other` user account (round-trip)
    const exportedCsv = await (await call("/api/web/export-csv/workouts")).text();
    const otherImport = (await (await call("/api/web/import-csv/commit", {
      token: other.token,
      method: "POST",
      body: { csv: exportedCsv },
    })).json()) as { format: string; importedWorkouts: number };
    assert.equal(otherImport.format, "ironlog");
    assert.equal(otherImport.importedWorkouts, 3);
  } finally {
    db.close();
  }
});

test("配置接口保存并回传我的训练器械 (equipment)，同时兼容省略 equipment 的幂等重试", async () => {
  const { db, call } = fixture();
  try {
    const initial = (await (await call("/api/web/profile")).json()) as {
      version: number;
      profile: { equipment: string[] };
    };
    assert.equal(initial.version, 0);

    // 1) Save omitting equipment (legacy caller) + idempotent retry with same opId
    const legacyPayload = {
      calories: 2300,
      protein: 160,
      carbs: 240,
      fat: 70,
      daysPerWeek: 4,
      restSeconds: 90,
      targetWeight: 72,
      energyProfile: null,
      version: 0,
      opId: "prof-retry-1",
    };
    const r1 = await call("/api/web/profile", { method: "PUT", body: legacyPayload });
    assert.equal(r1.status, 200);
    const retry = await call("/api/web/profile", { method: "PUT", body: legacyPayload });
    assert.equal(retry.status, 200);

    // 2) Update equipment to home dumbbell + band
    const r2 = await call("/api/web/profile", {
      method: "PUT",
      body: {
        ...legacyPayload,
        opId: "prof-equip-2",
        version: 1,
        equipment: ["dumbbell", "bodyweight", "band"],
      },
    });
    assert.equal(r2.status, 200);
    const updated = (await r2.json()) as { version: number; profile: { equipment: string[] } };
    assert.equal(updated.version, 2);
    assert.deepEqual(updated.profile.equipment, ["dumbbell", "bodyweight", "band"]);

    const fetched = (await (await call("/api/web/profile")).json()) as { profile: { equipment: string[] } };
    assert.deepEqual(fetched.profile.equipment, ["dumbbell", "bodyweight", "band"]);
  } finally {
    db.close();
  }
});

test("便携计划 JSON 导入接口：支持中英文动作名解析、肌群组数统计、草稿/启用与冲突零残留回滚", async () => {
  const { db, app, store, call, owner } = fixture();
  try {
    assert.equal((await app.request("/api/web/plans/import-json", { method: "POST" })).status, 401);

    // Invalid JSON -> 400
    const badJson = await call("/api/web/plans/import-json", {
      method: "POST",
      body: { json: "{not-json", mode: "preview" },
    });
    assert.equal(badJson.status, 400);

    // Unknown exercise name -> 400
    const unknownEx = await call("/api/web/plans/import-json", {
      method: "POST",
      body: {
        json: JSON.stringify({
          name: "Bad Plan",
          routines: [{ name: "Day 1", exercises: [{ name: "Nonexistent Alien Curl", sets: 3 }] }],
        }),
        mode: "preview",
      },
    });
    assert.equal(unknownEx.status, 400);

    // Portable ironlog-plan wrapper using mixed English names & Chinese names without explicit IDs
    const wrappedPlan = {
      format: "ironlog-plan",
      version: 1,
      plan: {
        name: "导入上下肢方案",
        weeks: 6,
        schedule: "rotation",
        routines: [
          {
            name: "上肢日",
            exercises: [
              { name: "Bench Press (Barbell)", sets: 4, repsMin: 6, repsMax: 8, progression: "double" },
              { exerciseId: "barbell-row", sets: 4, repsMin: 8, repsMax: 10 },
            ],
          },
          {
            name: "下肢日",
            exercises: [
              { name: "Romanian Deadlift", sets: 3, reps: 10 },
              { name: "平板支撑", sets: 3, seconds: 45 },
            ],
          },
        ],
      },
    };

    const previewRes = await call("/api/web/plans/import-json", {
      method: "POST",
      body: { json: JSON.stringify(wrappedPlan), mode: "preview" },
    });
    assert.equal(previewRes.status, 200);
    const preview = (await previewRes.json()) as {
      mode: string;
      routineCount: number;
      exerciseCount: number;
      plan: { routines: Array<{ exercises: Array<{ exerciseId: string; progression: string }> }> };
      exerciseNames: Record<string, string>;
      weeklyMuscleSets: Array<{ key: string; sets: number }>;
    };
    assert.equal(preview.mode, "preview");
    assert.equal(preview.routineCount, 2);
    assert.equal(preview.exerciseCount, 4);
    assert.equal(preview.plan.routines[0]!.exercises[0]!.exerciseId, "bench-press");
    assert.equal(preview.plan.routines[1]!.exercises[0]!.exerciseId, "romanian-deadlift");
    assert.equal(preview.plan.routines[1]!.exercises[1]!.exerciseId, "plank");
    assert.equal(preview.exerciseNames["bench-press"], "平板杠铃卧推");
    assert.ok(preview.weeklyMuscleSets.some((m) => m.key === "chest" && m.sets === 4));
    assert.ok(preview.weeklyMuscleSets.some((m) => m.key === "back" && m.sets === 5.5)); // barbell-row 4 + romanian-deadlift sec 0.5*3

    // Save as draft
    const draftRes = await call("/api/web/plans/import-json", {
      method: "POST",
      body: { json: JSON.stringify(wrappedPlan), mode: "draft" },
    });
    assert.equal(draftRes.status, 201);

    // Apply immediately
    const applyRes = await call("/api/web/plans/import-json", {
      method: "POST",
      body: { json: JSON.stringify(wrappedPlan), mode: "apply", expectedRevision: 0 },
    });
    assert.equal(applyRes.status, 201);
    const applied = (await applyRes.json()) as { mode: string; activePlan: { revision: number; data: { name: string } } };
    assert.equal(applied.mode, "apply");
    assert.equal(applied.activePlan.revision, 1);
    assert.equal(applied.activePlan.data.name, "导入上下肢方案");

    // Stale expectedRevision (409) leaves zero orphan drafts
    const countBefore = store.list(owner.userId, "plan").length;
    const conflictRes = await call("/api/web/plans/import-json", {
      method: "POST",
      body: { json: JSON.stringify(wrappedPlan), mode: "apply", expectedRevision: 99 },
    });
    assert.equal(conflictRes.status, 409);
    const countAfter = store.list(owner.userId, "plan").length;
    assert.equal(countAfter, countBefore);
  } finally {
    db.close();
  }
});

test("已练动作与个人 PR 索引接口 (/api/web/trained-exercises) 统计准确且严格隔离账号", async () => {
  const { db, app, call, owner, other } = fixture();
  try {
    const unauthRes = await app.request("/api/web/trained-exercises");
    assert.equal(unauthRes.status, 401);

    const emptyRes = await call("/api/web/trained-exercises");
    assert.equal(emptyRes.status, 200);
    const emptyBody = (await emptyRes.json()) as { total: number; items: unknown[] };
    assert.equal(emptyBody.total, 0);
    assert.deepEqual(emptyBody.items, []);

    const w1 = workoutSchema.parse({
      title: "全身基础 A",
      date: "2026-11-10",
      startedAt: "2026-11-10T08:00:00Z",
      endedAt: "2026-11-10T08:50:00Z",
      status: "completed",
      exercises: [
        {
          id: "ex-te-bench-1",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [
            { id: "s-w1-w", type: "warmup", weight: 40, reps: 10, seconds: 0, completed: true, rir: null },
            { id: "s-w1-1", type: "normal", weight: 80, reps: 5, seconds: 0, completed: true, rir: 2 },
            { id: "s-w1-2", type: "normal", weight: 90, reps: 5, seconds: 0, completed: true, rir: 0 },
          ],
        },
        {
          id: "ex-te-plank-1",
          exerciseId: "plank",
          restSeconds: 60,
          sets: [
            { id: "s-w1-p1", type: "normal", weight: 0, reps: 0, seconds: 60, completed: true, rir: null },
          ],
        },
      ],
    });

    const w2 = workoutSchema.parse({
      title: "上肢推进 B",
      date: "2026-11-14",
      startedAt: "2026-11-14T09:00:00Z",
      endedAt: "2026-11-14T09:45:00Z",
      status: "completed",
      exercises: [
        {
          id: "ex-te-bench-2",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [
            { id: "s-w2-1", type: "normal", weight: 85, reps: 8, seconds: 0, completed: true, rir: 1 },
            { id: "s-w2-incomplete", type: "normal", weight: 100, reps: 5, seconds: 0, completed: false, rir: 0 },
          ],
        },
      ],
    });

    const wActive = workoutSchema.parse({
      title: "进行中下肢",
      date: "2026-11-16",
      startedAt: "2026-11-16T09:00:00Z",
      endedAt: null,
      status: "active",
      exercises: [
        {
          id: "ex-te-squat-active",
          exerciseId: "squat",
          restSeconds: 120,
          sets: [
            { id: "s-act-1", type: "normal", weight: 140, reps: 5, seconds: 0, completed: true, rir: 1 },
          ],
        },
      ],
    });

    for (const [opId, id, data] of [
      ["te-op-1", "w-te-1", w1],
      ["te-op-2", "w-te-2", w2],
      ["te-op-3", "w-te-active", wActive],
    ] as const) {
      const saveRes = await call("/api/records", {
        method: "POST",
        token: owner.token,
        body: { opId, id, kind: "workout", baseVersion: 0, deleted: false, data },
      });
      assert.equal(saveRes.status, 200);
    }

    const res = await call("/api/web/trained-exercises", { token: owner.token });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      total: number;
      items: Array<{
        id: string;
        mode: string;
        sessionsCount: number;
        totalWorkSets: number;
        lastDate: string;
        bestWeight: number | null;
        best1rm: number | null;
        bestHold: number | null;
      }>;
    };

    assert.equal(body.total, 2);
    assert.equal(body.items.length, 2);
    assert.equal(body.items[0]?.id, "bench-press");
    assert.equal(body.items[0]?.mode, "reps");
    assert.equal(body.items[0]?.sessionsCount, 2);
    assert.equal(body.items[0]?.totalWorkSets, 3);
    assert.equal(body.items[0]?.lastDate, "2026-11-14");
    assert.equal(body.items[0]?.bestWeight, 90);
    assert.ok((body.items[0]?.best1rm ?? 0) > 105);

    assert.equal(body.items[1]?.id, "plank");
    assert.equal(body.items[1]?.mode, "timed");
    assert.equal(body.items[1]?.sessionsCount, 1);
    assert.equal(body.items[1]?.totalWorkSets, 1);
    assert.equal(body.items[1]?.lastDate, "2026-11-10");
    assert.equal(body.items[1]?.bestHold, 60);

    const otherRes = await call("/api/web/trained-exercises", { token: other.token });
    assert.equal(otherRes.status, 200);
    const otherBody = (await otherRes.json()) as { total: number; items: unknown[] };
    assert.equal(otherBody.total, 0);
    assert.deepEqual(otherBody.items, []);
  } finally {
    db.close();
  }
});

test("计划/模板动作支持超级组预设并贯通预览接口与 JSON 计划导入", async () => {
  const { db, call, owner } = fixture();
  try {
    const planPayload = {
      format: "ironlog-plan",
      version: 1,
      plan: {
        name: "超级组拮抗分化",
        weeks: 4,
        schedule: "rotation",
        routines: [
          {
            id: "rt_superset_1",
            name: "胸背超级组",
            exercises: [
              { exerciseId: "bench-press", sets: 4, repsMin: 6, repsMax: 10, restSeconds: 30, supersetGroup: "A" },
              { exerciseId: "barbell-row", sets: 4, repsMin: 6, repsMax: 10, restSeconds: 90, supersetGroup: "A" },
            ],
          },
        ],
      },
    };
    const importRes = await call("/api/web/plans/import-json", {
      method: "POST",
      body: { json: JSON.stringify(planPayload), mode: "apply", expectedRevision: 0 },
    });
    assert.equal(importRes.status, 201);
    const imported = (await importRes.json()) as {
      activePlan: { data: { routines: Array<{ id: string; exercises: Array<{ supersetGroup?: string | null }> }> } };
    };
    const routineId = imported.activePlan.data.routines[0]!.id;
    assert.equal(imported.activePlan.data.routines[0]!.exercises[0]?.supersetGroup, "A");
    assert.equal(imported.activePlan.data.routines[0]!.exercises[1]?.supersetGroup, "A");

    const planPreviewRes = await call(`/api/web/routine?id=${encodeURIComponent(routineId)}&source=plan&date=2026-11-20`);
    assert.equal(planPreviewRes.status, 200);
    const planPreview = (await planPreviewRes.json()) as { exercises: Array<{ supersetGroup: string | null }> };
    assert.equal(planPreview.exercises[0]?.supersetGroup, "A");
    assert.equal(planPreview.exercises[1]?.supersetGroup, "A");

    const tplId = "tpl_superset_test";
    const tplSave = await call("/api/records", {
      method: "POST",
      token: owner.token,
      body: {
        opId: "tpl-ss-op-1",
        id: tplId,
        kind: "template",
        baseVersion: 0,
        deleted: false,
        data: {
          id: tplId,
          name: "下肢核心超级组模板",
          exercises: [
            { exerciseId: "squat", sets: 3, repsMin: 5, repsMax: 8, weight: 100, seconds: 0, restSeconds: 30, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null, supersetGroup: "B" },
            { exerciseId: "plank", sets: 3, repsMin: 1, repsMax: 1, weight: null, seconds: 60, restSeconds: 90, targetRir: 2, progression: "manual", increment: 0, backupExerciseId: null, supersetGroup: "B" },
          ],
        },
      },
    });
    assert.equal(tplSave.status, 200);

    const tplPreviewRes = await call(`/api/web/routine?id=${encodeURIComponent(tplId)}&source=template&date=2026-11-20`);
    assert.equal(tplPreviewRes.status, 200);
    const tplPreview = (await tplPreviewRes.json()) as { exercises: Array<{ supersetGroup: string | null }> };
    assert.equal(tplPreview.exercises[0]?.supersetGroup, "B");
    assert.equal(tplPreview.exercises[1]?.supersetGroup, "B");
  } finally {
    db.close();
  }
});

test("完训复盘一键同步回当前训练计划 (/api/web/plans/sync-routine) 保留原计划连续性并校验版本冲突", async () => {
  const { db, call, owner, other } = fixture();
  try {
    const draftRes = await call("/api/plans/drafts", {
      method: "POST",
      body: {
        name: "上肢渐进计划",
        weeks: 6,
        schedule: "rotation",
        weekdays: [],
        rationale: "线性加重配合备份替换",
        routines: [
          {
            id: "routine_push",
            name: "推胸日",
            exercises: [
              {
                exerciseId: "bench-press",
                sets: 3,
                repsMin: 6,
                repsMax: 10,
                weight: 80,
                seconds: 0,
                restSeconds: 90,
                targetRir: 1,
                progression: "linear",
                increment: 5,
                backupExerciseId: "overhead-press",
                supersetGroup: null,
              },
              {
                exerciseId: "overhead-press",
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
                supersetGroup: null,
              },
            ],
          },
        ],
      },
    });
    assert.equal(draftRes.status, 201);
    const draftBody = (await draftRes.json()) as { record: { id: string; version: number } };
    const originalPlanId = draftBody.record.id;

    const applyRes = await call("/api/plans/apply", {
      method: "POST",
      body: { id: originalPlanId, version: draftBody.record.version, expectedRevision: 0 },
    });
    assert.equal(applyRes.status, 200);

    const workoutData = workoutSchema.parse({
      title: "推胸日",
      date: "2026-11-20",
      startedAt: "2026-11-20T09:00:00Z",
      endedAt: "2026-11-20T09:50:00Z",
      status: "completed",
      planId: originalPlanId,
      planVersion: draftBody.record.version,
      routineId: "routine_push",
      exercises: [
        {
          id: "w-sync-ex-1",
          exerciseId: "bench-press",
          targetIndex: 0,
          restSeconds: 120,
          supersetGroup: "A",
          sets: [
            { id: "ws-w1", type: "warmup", weight: 40, reps: 10, seconds: 0, completed: true, rir: null },
            { id: "ws-1", type: "normal", weight: 82.5, reps: 8, seconds: 0, completed: true, rir: 1 },
            { id: "ws-2", type: "normal", weight: 82.5, reps: 8, seconds: 0, completed: true, rir: 1 },
            { id: "ws-3", type: "normal", weight: 82.5, reps: 7, seconds: 0, completed: true, rir: 1 },
            { id: "ws-4", type: "normal", weight: 82.5, reps: 7, seconds: 0, completed: true, rir: 0 },
          ],
        },
        {
          id: "w-sync-ex-2",
          exerciseId: "lateral-raise",
          restSeconds: 60,
          supersetGroup: "A",
          sets: [
            { id: "wl-1", type: "normal", weight: 10, reps: 15, seconds: 0, completed: true, rir: 2 },
            { id: "wl-2", type: "normal", weight: 10, reps: 15, seconds: 0, completed: true, rir: 1 },
            { id: "wl-3", type: "normal", weight: 10, reps: 14, seconds: 0, completed: true, rir: 1 },
          ],
        },
      ],
    });
    const saveWo = await call("/api/records", {
      method: "POST",
      body: { opId: "sync-wo-op-1", id: "w-sync-1", kind: "workout", baseVersion: 0, deleted: false, data: workoutData },
    });
    assert.equal(saveWo.status, 200);

    const reportRes = await call("/api/web/workout-report/w-sync-1");
    assert.equal(reportRes.status, 200);
    const report = (await reportRes.json()) as {
      canSyncToActivePlan: boolean;
      activePlanRevision: number | null;
      activeRoutineName: string | null;
    };
    assert.equal(report.canSyncToActivePlan, true);
    assert.equal(report.activePlanRevision, 1);
    assert.equal(report.activeRoutineName, "推胸日");

    const staleRes = await call("/api/web/plans/sync-routine", {
      method: "POST",
      body: { workoutId: "w-sync-1", expectedRevision: 99 },
    });
    assert.equal(staleRes.status, 409);

    const crossUserRes = await call("/api/web/plans/sync-routine", {
      token: other.token,
      method: "POST",
      body: { workoutId: "w-sync-1" },
    });
    assert.equal(crossUserRes.status, 404);

    const syncRes = await call("/api/web/plans/sync-routine", {
      method: "POST",
      token: owner.token,
      body: { workoutId: "w-sync-1", expectedRevision: report.activePlanRevision },
    });
    assert.equal(syncRes.status, 200);
    const synced = (await syncRes.json()) as {
      syncedRoutineName: string;
      exercisesCount: number;
      activePlan: {
        id: string;
        revision: number;
        data: {
          routines: Array<{
            id: string;
            exercises: Array<{
              exerciseId: string;
              sets: number;
              repsMin: number;
              repsMax: number;
              restSeconds: number;
              progression: string;
              increment: number;
              targetRir: number;
              backupExerciseId: string | null;
              supersetGroup?: string | null;
            }>;
          }>;
        };
      };
    };

    assert.equal(synced.syncedRoutineName, "推胸日");
    assert.equal(synced.exercisesCount, 2);
    assert.equal(synced.activePlan.id, originalPlanId);
    assert.equal(synced.activePlan.revision, 2);

    const updatedEx = synced.activePlan.data.routines[0]!.exercises;
    assert.equal(updatedEx.length, 2);
    assert.equal(updatedEx[0]?.exerciseId, "bench-press");
    assert.equal(updatedEx[0]?.sets, 4);
    assert.equal(updatedEx[0]?.restSeconds, 120);
    assert.equal(updatedEx[0]?.supersetGroup, "A");
    assert.equal(updatedEx[0]?.repsMin, 6);
    assert.equal(updatedEx[0]?.repsMax, 10);
    assert.equal(updatedEx[0]?.targetRir, 1);
    assert.equal(updatedEx[0]?.progression, "linear");
    assert.equal(updatedEx[0]?.increment, 5);
    assert.equal(updatedEx[0]?.backupExerciseId, "overhead-press");

    assert.equal(updatedEx[1]?.exerciseId, "lateral-raise");
    assert.equal(updatedEx[1]?.sets, 3);
    assert.equal(updatedEx[1]?.restSeconds, 60);
    assert.equal(updatedEx[1]?.supersetGroup, "A");
  } finally {
    db.close();
  }
});

test("常用餐单模板编辑更新（版本递增）与饮水负增量归零保护", async () => {
  const { db, call, owner } = fixture();
  try {
    const tplId = "mealTpl_edit_test";
    const createRes = await call("/api/records", {
      method: "POST",
      token: owner.token,
      body: {
        opId: "mt-create-1",
        id: tplId,
        kind: "mealTemplate",
        baseVersion: 0,
        deleted: false,
        data: {
          name: "训练前快碳餐",
          foods: [
            { name: "香蕉 1根", calories: 105, protein: 1.3, carbs: 27, fat: 0.4, source: "manual", rawPrompt: "" },
          ],
        },
      },
    });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { record: { version: number; data: { name: string; foods: unknown[] } } };
    assert.equal(created.record.version, 1);

    const updateRes = await call("/api/records", {
      method: "POST",
      token: owner.token,
      body: {
        opId: "mt-update-1",
        id: tplId,
        kind: "mealTemplate",
        baseVersion: created.record.version,
        deleted: false,
        data: {
          name: "训练前加强餐",
          foods: [
            { name: "香蕉 1根", calories: 105, protein: 1.3, carbs: 27, fat: 0.4, source: "manual", rawPrompt: "" },
            { name: "乳清蛋白 1勺", calories: 120, protein: 24, carbs: 3, fat: 1.5, source: "manual", rawPrompt: "" },
          ],
        },
      },
    });
    assert.equal(updateRes.status, 200);
    const updated = (await updateRes.json()) as { record: { version: number; data: { name: string; foods: Array<{ name: string }> } } };
    assert.equal(updated.record.version, 2);
    assert.equal(updated.record.data.name, "训练前加强餐");
    assert.equal(updated.record.data.foods.length, 2);

    const waterDate = localDate();
    const w1 = await (await call("/api/web/water", { method: "POST", body: { date: waterDate, deltaMl: 500 } })).json() as { waterMl: number };
    assert.equal(w1.waterMl, 500);
    const w2 = await (await call("/api/web/water", { method: "POST", body: { date: waterDate, deltaMl: -250 } })).json() as { waterMl: number };
    assert.equal(w2.waterMl, 250);
    const w3 = await (await call("/api/web/water", { method: "POST", body: { date: waterDate, deltaMl: -500 } })).json() as { waterMl: number };
    assert.equal(w3.waterMl, 0);
  } finally {
    db.close();
  }
});

test("智能组间休息判定 (resolveSetRestSeconds)：热身封顶、递减连做免休、休停20秒与常规组", () => {
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "warmup", nextSetType: "normal", defaultRestSeconds: 120 }),
    { seconds: 45, reason: "warmup" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "warmup", nextSetType: "normal", defaultRestSeconds: 30 }),
    { seconds: 30, reason: "warmup" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "normal", nextSetType: "drop", defaultRestSeconds: 120 }),
    { seconds: 0, reason: "drop_chain" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "rest_pause", nextSetType: "normal", defaultRestSeconds: 120 }),
    { seconds: 20, reason: "rest_pause" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "rest_pause", nextSetType: "rest_pause", defaultRestSeconds: 0 }),
    { seconds: 20, reason: "rest_pause" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "normal", nextSetType: "normal", defaultRestSeconds: 90 }),
    { seconds: 90, reason: "normal" },
  );
  assert.deepEqual(
    resolveSetRestSeconds({ setType: "drop", nextSetType: null, defaultRestSeconds: 90 }),
    { seconds: 90, reason: "normal" },
  );
});

test("体重记录软删除后支持 ?includeDeleted=1 获取墓碑版本并安全重建，默认查询仍返回 404", async () => {
  const { db, call } = fixture();
  try {
    const createRes = await call("/api/records", {
      method: "POST",
      body: {
        opId: "w-op-1",
        kind: "weight",
        id: "weight_2026-11-20",
        baseVersion: 0,
        deleted: false,
        data: { date: "2026-11-20", weight: 75 },
      },
    });
    assert.equal(createRes.status, 200);

    const delRes = await call("/api/records", {
      method: "POST",
      body: {
        opId: "w-op-2",
        kind: "weight",
        id: "weight_2026-11-20",
        baseVersion: 1,
        deleted: true,
        data: { date: "2026-11-20", weight: 75 },
      },
    });
    assert.equal(delRes.status, 200);

    const normalGet = await call("/api/web/records/weight/weight_2026-11-20");
    assert.equal(normalGet.status, 404);

    const tombGet = await call("/api/web/records/weight/weight_2026-11-20?includeDeleted=1");
    assert.equal(tombGet.status, 200);
    const tomb = (await tombGet.json()) as { deleted: boolean; version: number };
    assert.equal(tomb.deleted, true);
    assert.equal(tomb.version, 2);

    const resurrectRes = await call("/api/records", {
      method: "POST",
      body: {
        opId: "w-op-3",
        kind: "weight",
        id: "weight_2026-11-20",
        baseVersion: tomb.version,
        deleted: false,
        data: { date: "2026-11-20", weight: 75.5 },
      },
    });
    assert.equal(resurrectRes.status, 200);

    const revivedGet = await call("/api/web/records/weight/weight_2026-11-20");
    assert.equal(revivedGet.status, 200);
    const revived = (await revivedGet.json()) as { deleted: boolean; version: number; data: { weight: number } };
    assert.equal(revived.deleted, false);
    assert.equal(revived.version, 3);
    assert.equal(revived.data.weight, 75.5);
  } finally {
    db.close();
  }
});

test("配片上限保护 (plateBreakdown) 与异常时长容错 (duration / workoutSeconds)", () => {
  const huge = plateBreakdown(9999999, 20, [0.5]);
  assert.equal(huge.valid, false);
  assert.deepEqual(huge.plates, []);

  const bounded = plateBreakdown(1000, 20, [0.5]);
  assert.equal(bounded.valid, true);
  assert.ok(bounded.plates.length <= 64);

  const normal = plateBreakdown(60, 20, [20, 10, 5]);
  assert.equal(normal.valid, true);
  assert.deepEqual(normal.plates, [20]);

  assert.equal(duration(NaN), "—");
  assert.equal(duration(undefined as unknown as number), "—");
  assert.equal(workoutSeconds({ startedAt: "invalid", endedAt: "2026-11-20T10:00:00Z", status: "completed" }), null);
});

test("/api/me 准确判定 appleHealthConnected 与 isNewUser（手动饮水不误判为苹果健康）", async () => {
  const { db, call } = fixture();
  try {
    // 1. 全新账号：无记录、无 Apple 设备与体征
    const me0 = await (await call("/api/me")).json() as { appleHealthConnected: boolean; isNewUser: boolean };
    assert.equal(me0.appleHealthConnected, false);
    assert.equal(me0.isNewUser, true);

    // 2. 仅记录手动饮水：仍不应视为已对接 Apple 健康
    const waterRes = await call("/api/web/water", {
      method: "POST",
      body: { date: localDate(), deltaMl: 500 },
    });
    assert.equal(waterRes.status, 200);
    const meWater = await (await call("/api/me")).json() as { appleHealthConnected: boolean; isNewUser: boolean };
    assert.equal(meWater.appleHealthConnected, false);
    assert.equal(meWater.isNewUser, true);

    // 3. 生成 Apple 健康上传令牌后 -> appleHealthConnected 变为 true；撤销该未上报设备后回退为 false
    const tokRes = await call("/api/integrations/apple-health/tokens", {
      method: "POST",
      body: { label: "iPhone 快捷指令" },
    });
    assert.equal(tokRes.status, 201);
    const tokBody = (await tokRes.json()) as { id: string };
    const meWithToken = await (await call("/api/me")).json() as { appleHealthConnected: boolean };
    assert.equal(meWithToken.appleHealthConnected, true);

    const revRes = await call(`/api/integrations/apple-health/tokens/${encodeURIComponent(tokBody.id)}`, {
      method: "DELETE",
    });
    assert.equal(revRes.status, 200);
    const meAfterRevoke = await (await call("/api/me")).json() as { appleHealthConnected: boolean };
    assert.equal(meAfterRevoke.appleHealthConnected, false);

    // 4. 导入 Apple Health 体能训练后 -> appleHealthConnected 保持 true
    const importRes = await call("/api/integrations/apple-health/health-data-export/import", {
      method: "POST",
      body: {
        data: {
          workouts: [{
            name: "Traditional Strength Training",
            start: "2026-11-20T09:00:00Z",
            end: "2026-11-20T09:45:00Z",
            duration: 2700,
          }],
        },
      },
    });
    assert.equal(importRes.status, 200);
    const meWithWorkout = await (await call("/api/me")).json() as { appleHealthConnected: boolean };
    assert.equal(meWithWorkout.appleHealthConnected, true);

    // 5. 创建任意手记训练/饮食/体重/计划后 -> isNewUser 变为 false
    const recRes = await call("/api/records", {
      method: "POST",
      body: {
        opId: "me-w-1",
        kind: "weight",
        id: "weight_2026-11-20",
        baseVersion: 0,
        deleted: false,
        data: { date: "2026-11-20", weight: 74.2 },
      },
    });
    assert.equal(recRes.status, 200);
    const meTrained = await (await call("/api/me")).json() as { isNewUser: boolean };
    assert.equal(meTrained.isNewUser, false);
  } finally {
    db.close();
  }
});

test("同日同名早晚训练 CSV 往返保留两场、全量导出含 Apple 训练、Health Data Export 解析时长与热量、心率区间按场次占比且演示账号隔离真实健康数据", async () => {
  const { db, store, auth, call, owner, other } = fixture();
  try {
    const day = shiftDay(localDate(), -1);
    const { readHealthDataExport } = await import("../packages/server/src/health-data-export.js");
    const { seedWebDemo } = await import("../packages/server/src/web-demo.js");

    // 1. Morning and evening same-day same-title workouts round-trip via CSV without merging
    for (const [i, hour] of ["08", "18"].entries()) {
      const workout = workoutSchema.parse({
        title: "同日同名力量训练",
        date: day,
        startedAt: new Date(`${day}T${hour}:00:00+08:00`).toISOString(),
        endedAt: new Date(`${day}T${hour}:30:00+08:00`).toISOString(),
        status: "completed",
        exercises: [{
          id: `ex-${i}`,
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [{ id: `set-${i}`, weight: 40 + i * 10, reps: 8, completed: true, type: "normal" }],
        }],
      });
      store.mutate(owner.userId, {
        kind: "workout",
        id: `same-day-wo-${i}`,
        opId: `same-day-op-${i}`,
        baseVersion: 0,
        deleted: false,
        data: workout,
      });
    }
    const exportedCsvRes = await call("/api/web/export-csv/workouts");
    assert.equal(exportedCsvRes.status, 200);
    const csvText = await exportedCsvRes.text();
    const importedRes = await call("/api/web/import-csv/commit", {
      token: other.token,
      method: "POST",
      body: { csv: csvText, skipDuplicates: true },
    });
    assert.equal(importedRes.status, 200);
    const importedReport = (await importedRes.json()) as { importedWorkouts: number; importedSets: number };
    assert.equal(importedReport.importedWorkouts, 2);
    assert.equal(importedReport.importedSets, 2);

    // 2. Full JSON export includes Apple Health workouts, and HR zones report 50%/50% session share for 90m vs 10m workouts
    const tokRes = await call("/api/integrations/apple-health/tokens", {
      method: "POST",
      body: { label: "审计手机" },
    });
    const { token: deviceToken } = (await tokRes.json()) as { token: string };
    for (const sample of [
      { durationSeconds: 5400, heartRate: { avgBpm: 125, maxBpm: 180 }, t: "08" },
      { durationSeconds: 600, heartRate: { avgBpm: 165, maxBpm: 178 }, t: "18" },
    ]) {
      const startedAt = new Date(`${day}T${sample.t}:00:00+08:00`).toISOString();
      const endedAt = new Date(Date.parse(startedAt) + sample.durationSeconds * 1000).toISOString();
      const up = await call("/api/integrations/apple-health/workouts", {
        token: deviceToken,
        method: "POST",
        body: {
          schemaVersion: 1,
          captureMethod: "workout",
          activityType: "running",
          externalWorkoutId: `hr-run-${sample.t}`,
          startedAt,
          endedAt,
          durationSeconds: sample.durationSeconds,
          activeEnergyKcal: 210,
          heartRate: sample.heartRate,
        },
      });
      assert.equal(up.status, 201);
    }

    const exportJson = (await (await call("/api/export")).json()) as {
      appleHealthWorkouts: Array<{ externalWorkoutId: string }>;
    };
    assert.equal(Array.isArray(exportJson.appleHealthWorkouts), true);
    assert.equal(exportJson.appleHealthWorkouts.length, 2);

    store.mutate(owner.userId, {
      kind: "profile", id: "settings", opId: "heart-rate-zone-profile", baseVersion: 0, deleted: false,
      data: {
        energyProfile: {
          weightKg: 75, weightDate: day, heightCm: 175, sex: "male",
          birthDate: `${Number(day.slice(0, 4)) - 30}-01-01`, activityFactor: 1.6, context: "general",
        },
      },
    });
    const analytics = (await (await call(`/api/web/analytics?days=14&through=${day}`)).json()) as any;
    assert.equal(analytics.appleWorkouts.hrZones.basis, "session_avg_hr");
    const nonEmptyZones = analytics.appleWorkouts.hrZones.zones.filter((z: any) => z.count > 0);
    assert.equal(nonEmptyZones.length, 2);
    assert.deepEqual(
      nonEmptyZones.map((z: any) => ({ key: z.key, count: z.count, pct: z.pct, durationPct: z.durationPct })),
      [
        { key: "z2", count: 1, pct: 50, durationPct: 90 },
        { key: "z4", count: 1, pct: 50, durationPct: 10 },
      ],
    );

    // 3. Health Data Export parses unitless duration (seconds) and energy + energy_unit ("kcal")
    const parsedExport = readHealthDataExport({
      workouts: [
        {
          id: "01A1D7A4-81A4-7841-954D-85452EB9E44F",
          type: "running",
          display_name: "Running",
          start_date: "2026-11-14T01:20:49Z",
          end_date: "2026-11-14T01:32:22Z",
          duration: 691.95818400383,
          energy: 19.720442123665443,
          energy_unit: "kcal",
          distance: 399.89633569371654,
          distance_unit: "m",
        },
        {
          id: "01A1D8A3-264C-7114-897D-71FFB86CE400",
          type: "strength_training",
          display_name: "Traditional Strength Training",
          start_date: "2026-11-14T05:58:53Z",
          end_date: "2026-11-14T07:17:19Z",
          duration: 4705.857506036758,
          reported_totals: { duration: 4705.857506036758 },
        },
      ],
    });
    assert.equal(parsedExport.length, 2);
    assert.equal(parsedExport[0]!.durationSeconds, 692);
    assert.ok(Math.abs((parsedExport[0]!.activeEnergyKcal ?? 0) - 19.72) < 0.01);
    assert.equal(parsedExport[1]!.durationSeconds, 4706);

    // 4. Demo account isolation: real Shortcut daily health rows on preview-only are migrated to an isolated account
    const demoLogin = auth.login("preview-only");
    const demoDevRes = await call("/api/integrations/apple-health/tokens", {
      token: demoLogin.token,
      method: "POST",
      body: { label: "混入演示的真机" },
    });
    const { token: demoDevToken } = (await demoDevRes.json()) as { token: string };
    const upDaily = await call("/api/integrations/apple-health/daily", {
      token: demoDevToken,
      method: "POST",
      body: { date: day, steps: 6543, sleepMinutes: 450 },
    });
    assert.equal(upDaily.status, 200);
    seedWebDemo(store, auth);
    const demoShortcutCount = (
      db.prepare("SELECT COUNT(*) AS n FROM apple_health_daily WHERE user_id=?").get(demoLogin.userId) as { n: number }
    ).n;
    const isolatedUser = auth.login("real-health-owner");
    const isolatedCount = (
      db.prepare("SELECT COUNT(*) AS n FROM apple_health_daily WHERE user_id=?").get(isolatedUser.userId) as { n: number }
    ).n;
    assert.equal(demoShortcutCount, 0);
    assert.equal(isolatedCount, 1);
  } finally {
    db.close();
  }
});

test("智能合并保留更新记录，恢复 Apple 训练到另一个账号后可正常去重", async () => {
  const { db, store, call, owner, other } = fixture();
  try {
    const date = shiftDay(localDate(), -1);
    const id = `weight_${date}`;
    store.mutate(owner.userId, { kind: "weight", id, opId: "recent-weight", baseVersion: 0, data: { date, weight: 78 }, deleted: false });
    await call("/api/web/exercise-notes/bench-press", { method: "PUT", body: { note: "新握距" } });
    await call("/api/web/measurements", { method: "PUT", body: { date, waistCm: 81 } });
    const device = async (token: string) => (
      await (await call("/api/integrations/apple-health/tokens", {
        token, method: "POST", body: { label: "fixture-watch" },
      })).json()
    ).token as string;
    const appleWorkout = {
      schemaVersion: 1, captureMethod: "workout", activityType: "running", externalWorkoutId: "fixture-backup-run",
      startedAt: `${date}T08:00:00+08:00`, endedAt: `${date}T08:30:00+08:00`,
    };
    const postWorkout = (token: string) => call("/api/integrations/apple-health/workouts", {
      token, method: "POST", body: appleWorkout,
    });
    assert.equal((await postWorkout(await device(owner.token))).status, 201);
    const backup = await (await call("/api/export")).json();
    const old = "2000-01-01T00:00:00.000Z";
    const older = {
      ...backup,
      records: backup.records.map((record: Record<string, unknown>) => ({
        ...record, updatedAt: old, data: { date, weight: 70 },
      })),
      exerciseNotes: [{ exerciseId: "bench-press", note: "旧握距", updatedAt: old }],
      bodyMeasurements: [{ date, waistCm: 75, updatedAt: old }],
    };
    const restore = (payload: unknown, token: string, strategy = "merge", mode = "commit") =>
      call("/api/web/restore-backup", { token, method: "POST", body: { backup: payload, mode, strategy } });
    assert.equal((await restore({ format: "ironlog" }, owner.token, "replace")).status, 400);
    assert.equal((await restore("null", owner.token)).status, 400);
    const preview = await (await restore(older, owner.token, "merge", "preview")).json();
    assert.equal(preview.diff.toUpdate, 0);
    const same = await (await restore(older, owner.token)).json();
    assert.equal(same.updated, 0);
    assert.equal((store.get(owner.userId, "weight", id)?.data as { weight: number }).weight, 78);
    const exportAfter = await (await call("/api/export")).json();
    assert.equal(exportAfter.exerciseNotes[0].note, "新握距");
    assert.equal(exportAfter.bodyMeasurements[0].waistCm, 81);

    assert.equal((await restore(backup, other.token)).status, 200);
    assert.equal((await restore(backup, other.token)).status, 200);
    assert.equal((await postWorkout(await device(other.token))).status, 200);
    const restored = await (await call("/api/export", { token: other.token })).json();
    assert.equal(restored.appleHealthWorkouts.length, 1);
    assert.notEqual(restored.appleHealthWorkouts[0].id, backup.appleHealthWorkouts[0].id);
  } finally {
    db.close();
  }
});

test("覆盖恢复发布删除变更并使新旧设备上的过期记录版本失效", async () => {
  const { db, store, call, owner, other } = fixture();
  try {
    const date = localDate();
    const id = `weight_${date}`;
    const weight = (value: number, baseVersion: number, opId: string) => ({
      kind: "weight" as const, id, opId, baseVersion, data: { date, weight: value }, deleted: false,
    });
    const ownerWeight = (value: number, baseVersion: number, opId: string) =>
      call("/api/records", { method: "POST", body: weight(value, baseVersion, opId) });
    assert.equal((await ownerWeight(70, 0, "backup-weight")).status, 200);
    const backup = await (await call("/api/export")).json();
    assert.equal((await ownerWeight(75, 1, "recent-weight")).status, 200);
    const extra = { kind: "diet" as const, id: "only-on-current", opId: "current-meal", baseVersion: 0, deleted: false,
      data: { date, meal: "lunch", name: "被移除的记录", calories: 420, carbs: 65, fat: 9, protein: 20 } };
    store.mutate(owner.userId, extra);
    store.mutate(other.userId, { ...extra, opId: "other-meal" });

    const sync = async (cursor: number) => (await call("/api/sync", {
      method: "POST", body: { cursor, mutations: [] },
    })).json();
    const before = await sync(0);
    assert.equal((await call("/api/web/restore-backup", {
      method: "POST", body: { backup, mode: "commit", strategy: "replace" },
    })).status, 200);
    const after = await sync(before.cursor);
    assert.ok(after.cursor > before.cursor);
    const records = after.records as Array<{ id: string; deleted: boolean; version: number; data: unknown; updatedAt: string }>;
    const restoredWeight = records.find((row) => row.id === id);
    assert.equal(restoredWeight?.version, 3);
    assert.equal((restoredWeight?.data as { weight: number }).weight, 70);
    const deleted = records.find((row) => row.id === extra.id);
    assert.ok(deleted?.updatedAt);
    assert.deepEqual(deleted, {
      id: extra.id, kind: "diet", version: 2, deleted: true, data: {}, updatedAt: deleted.updatedAt,
    });
    assert.equal(store.list(owner.userId, "diet").length, 0);
    assert.equal(store.list(other.userId, "diet").length, 1);
    assert.equal((await ownerWeight(72, 1, "stale-before-backup")).status, 409);
    assert.equal((await ownerWeight(75, 2, "stale-after-backup")).status, 409);
    assert.equal((await call("/api/records", { method: "POST", body: { ...extra, opId: "stale-meal", baseVersion: 1 } })).status, 409);
    assert.equal((await ownerWeight(71, 3, "fresh-weight")).status, 200);
  } finally {
    db.close();
  }
});

test("覆盖恢复保留计划历史且拒绝旧修订，包括恢复为空计划的情况", async () => {
  const { db, store, call, owner, other } = fixture();
  try {
    const userId = owner.userId;
    const empty = store.export(userId);
    const first = store.createDraft(userId, starterPlans[0]!.plan).record!;
    const second = store.createDraft(userId, starterPlans[1]!.plan).record!;
    store.applyPlan(userId, first.id, first.version, 0);
    const older = store.export(userId);
    store.applyPlan(userId, second.id, second.version, 1);
    store.applyPlan(userId, first.id, first.version, 2);

    const planBefore = store.planSchedule(userId);
    const corrupt = structuredClone(older);
    corrupt.activePlan!.data.routines = [];
    const { activePlan: _missingPlan, ...missing } = older;
    const badHistory = structuredClone(older);
    badHistory.activePlan!.history[0]!.data.routines = [];
    for (const backup of [corrupt, missing, badHistory]) {
      for (const mode of ["preview", "commit"]) {
        const response = await call("/api/web/restore-backup", {
          method: "POST", body: { mode, strategy: "replace", backup },
        });
        assert.equal(response.status, 400);
        assert.deepEqual(store.planSchedule(userId), planBefore);
      }
    }

    const replace = (backup: typeof empty) => call("/api/web/restore-backup", {
      method: "POST", body: { mode: "commit", strategy: "replace", backup },
    });
    assert.equal((await replace(older)).status, 200);
    const restored = store.planSchedule(userId)!;
    assert.ok(restored.revision > 3);
    assert.equal(restored.id, first.id);
    assert.deepEqual(restored.history, older.activePlan?.history);
    assert.throws(() => store.applyPlan(userId, second.id, second.version, 3), /已变化/);

    assert.equal((await replace(empty)).status, 200);
    assert.equal(store.activePlan(userId), null);
    const next = store.createDraft(userId, starterPlans[0]!.plan).record!;
    store.applyPlan(userId, next.id, next.version, 0);
    assert.ok(store.activePlan(userId)!.revision > restored.revision);
    assert.throws(() => store.applyPlan(userId, next.id, next.version, 1), /已变化/);

    const otherPlan = store.createDraft(other.userId, starterPlans[0]!.plan).record!;
    store.applyPlan(other.userId, otherPlan.id, otherPlan.version, 0);
    assert.equal(store.activePlan(other.userId)?.revision, 1);
  } finally {
    db.close();
  }
});

test("健康 JSON 备份可复原睡眠时段，兼容旧备份且拒绝损坏的样本", async () => {
  const { db, call, owner, other } = fixture();
  try {
    const through = shiftDay(localDate(), -1);
    const seconds = (clock: string, day: string) => `${day}T${clock}:00+08:00`;
    const token = (await (await call("/api/integrations/apple-health/tokens", {
      method: "POST", body: { label: "backup sleep fixture" },
    })).json()).token as string;
    for (let i = 3; i >= 0; i--) {
      const date = shiftDay(through, -i);
      const evening = shiftDay(date, -1);
      const start = seconds(`22:${20 + i * 10}`, evening);
      const split = seconds("01:00", date);
      const end = seconds("05:45", date);
      assert.equal((await call("/api/integrations/apple-health/daily", {
        token, method: "POST", body: {
          date, steps: 1200, sleepSamples: [`Core|${start}|${split}`, `REM|${split}|${end}`],
        },
      })).status, 200);
    }

    const path = `/api/web/analytics?days=14&through=${through}`;
    const original = (await (await call(path)).json()).sleepReport;
    assert.equal(original.timing.adjacentPairs, 3);
    const backup = await (await call("/api/export")).json();
    assert.equal(backup.appleHealthDaily[0].sleepObservations.length, 2);
    const legacy = { ...backup, appleHealthDaily: backup.appleHealthDaily.map((row: Record<string, unknown>) => {
      const { sleepObservations: _samples, ...summary } = row;
      return { ...summary, steps: 1900, updatedAt: new Date(Date.now() + 60_000).toISOString() };
    }) };
    const restore = (payload: unknown, strategy = "merge", mode = "commit") =>
      call("/api/web/restore-backup", { token: other.token, method: "POST", body: { backup: payload, strategy, mode } });
    assert.equal((await restore(legacy)).status, 200);
    assert.equal((await (await call(path, { token: other.token })).json()).sleepReport.timing.measuredDays, 0);
    assert.equal((await restore(backup)).status, 200);
    const recovered = await (await call(path, { token: other.token })).json();
    assert.deepEqual(recovered.sleepReport, original);
    assert.equal(recovered.appleDaily.series.at(-1).steps, 1900);
    assert.equal((await restore(legacy)).status, 200);
    assert.deepEqual((await (await call(path, { token: other.token })).json()).sleepReport, original);
    assert.equal((await restore(backup, "replace")).status, 200);
    assert.deepEqual((await (await call(path, { token: other.token })).json()).sleepReport, original);

    const invalid = { ...backup, appleHealthDaily: [{ ...backup.appleHealthDaily[0],
      sleepObservations: [{ stage: "deep", interval: [Date.now(), 10] }] }] };
    assert.equal((await restore(invalid, "replace", "preview")).status, 400);
    assert.equal((await restore(invalid, "replace")).status, 400);
    assert.deepEqual((await (await call(path, { token: other.token })).json()).sleepReport, original);
    const publicDaily = await (await call(`/api/integrations/apple-health/daily?from=${through}&through=${through}`, { token: owner.token })).text();
    assert.equal(publicDaily.includes("SleepObservations") || publicDaily.includes("sleepObservations"), false);
  } finally {
    db.close();
  }
});

test("Pre-launch: full JSON backup restore, web password change, and MCP/API token management", async () => {
  const { db, store, auth, call, owner, app } = fixture();
  try {
    const day = localDate();
    // 1. Seed owner with workout, diet, weight, measurement, exercise note, custom exercise, and Apple Health data
    store.mutate(owner.userId, {
      kind: "exercise",
      id: "custom_pendulum_squat",
      opId: "op-ex-1",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "custom_pendulum_squat",
        name: "钟摆深蹲",
        englishName: "Pendulum Squat",
        category: "strength",
        equipment: "machine",
        muscle: "legs",
        secondaryMuscles: [],
        mode: "reps",
        volumeMultiplier: 1,
        aliases: [],
        description: "腿部器械",
        instructions: ["双脚踩稳踏板，沿器械轨迹下蹲"],
        mistakes: [],
        custom: true,
      },
    });
    store.mutate(owner.userId, {
      kind: "workout",
      id: "wo-backup-1",
      opId: "op-wo-1",
      baseVersion: 0,
      deleted: false,
      data: workoutSchema.parse({
        title: "下肢钟摆训练",
        date: day,
        startedAt: new Date(`${day}T09:00:00+08:00`).toISOString(),
        endedAt: new Date(`${day}T10:00:00+08:00`).toISOString(),
        status: "completed",
        exercises: [{
          id: "row-1",
          exerciseId: "custom_pendulum_squat",
          restSeconds: 90,
          sets: [{ id: "s-1", weight: 100, reps: 8, completed: true, type: "normal" }],
        }],
      }),
    });
    await call("/api/web/exercise-notes/custom_pendulum_squat", {
      method: "PUT",
      body: { note: "踏板倒数第二格" },
    });
    await call("/api/web/measurements", {
      method: "PUT",
      body: { date: day, waistCm: 76.5, notes: "晨起空腹" },
    });

    const fullBackup = await (await call("/api/export")).json();

    // Restore into a brand-new user account
    const targetUser = auth.login("backup-restore-target");
    const previewRes = await call("/api/web/restore-backup", {
      token: targetUser.token,
      method: "POST",
      body: { backup: fullBackup, mode: "preview", strategy: "merge" },
    });
    assert.equal(previewRes.status, 200);
    const previewBody = (await previewRes.json()) as any;
    assert.equal(previewBody.counts.workouts, 1);
    assert.equal(previewBody.counts.customExercises, 1);
    assert.equal(previewBody.counts.measurements, 1);
    assert.equal(previewBody.counts.exerciseNotes, 1);
    // #227: Total preview/commit counts include auxiliary tables (2 records + 1 measurement + 1 exerciseNote = 4)
    assert.equal(previewBody.diff.toImport, 4);
    assert.equal(previewBody.breakdown.records.toImport, 2);

    const commitRes = await call("/api/web/restore-backup", {
      token: targetUser.token,
      method: "POST",
      body: { backup: fullBackup, mode: "commit", strategy: "merge" },
    });
    assert.equal(commitRes.status, 200);
    const commitBody = (await commitRes.json()) as any;
    assert.equal(commitBody.imported, 4);
    assert.equal(commitBody.breakdown.records.imported, 2);

    const restoredWorkouts = store.list(targetUser.userId, "workout");
    assert.equal(restoredWorkouts.length, 1);
    assert.equal((restoredWorkouts[0]!.data as any).title, "下肢钟摆训练");

    // 2. MCP / API Token management
    const issueTokRes = await call("/api/tokens", {
      method: "POST",
      body: { label: "Claude Desktop MCP" },
    });
    assert.equal(issueTokRes.status, 201);
    const { token: mcpToken } = (await issueTokRes.json()) as { token: string };
    assert.ok(mcpToken.startsWith("tj_"));

    const listTokRes = await call("/api/tokens");
    assert.equal(listTokRes.status, 200);
    const tokensList = (await listTokRes.json()) as Array<{ id: string; label: string; expiresAt: string | null }>;
    const mcpEntry = tokensList.find((t) => t.label === "Claude Desktop MCP");
    assert.ok(mcpEntry);
    assert.ok(typeof mcpEntry!.expiresAt === "string" && Date.parse(mcpEntry!.expiresAt) > Date.now());

    const delTokRes = await call(`/api/tokens/${mcpEntry!.id}`, { method: "DELETE" });
    assert.equal(delTokRes.status, 200);

    // 3. Web password change
    const regRes = await app.request("http://localhost/auth/web/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username: "pwtester", password: "OldPassword123" }),
    });
    assert.equal(regRes.status, 201);
    const { userId: pwUserId } = (await regRes.json()) as { userId: string };
    const cookie = regRes.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    assert.ok(cookie.startsWith("ironlog_session="));

    const changePwRes = await app.request("http://localhost/api/web/password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        Cookie: cookie,
        "X-Ironlog-Account": pwUserId,
      },
      body: JSON.stringify({ currentPassword: "OldPassword123", newPassword: "NewPassword456" }),
    });
    assert.equal(changePwRes.status, 200);

    // Old password must now be rejected
    const oldLoginRes = await app.request("http://localhost/auth/web/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username: "pwtester", password: "OldPassword123" }),
    });
    assert.equal(oldLoginRes.status, 401);

    // New password must succeed
    const newLoginRes = await app.request("http://localhost/auth/web/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username: "pwtester", password: "NewPassword456" }),
    });
    assert.equal(newLoginRes.status, 200);

    // 4. Multi-style daily share payload aggregation (strength + cardio + diet)
    const sessionUi = await import("../web/dist/session-ui.js" as string);
    assert.equal(Array.isArray(sessionUi.SHARE_CARD_STYLES), true);
    assert.deepEqual(
      sessionUi.SHARE_CARD_STYLES.map((s: any) => s.id),
      ["paper", "ring", "mono", "poster", "obsidian"],
    );
    const sharePayload = sessionUi.buildDailySharePayload({
      date: "2026-11-22",
      todayKey: "2026-11-22",
      isDemo: true,
      workouts: [{
        data: {
          date: "2026-11-22",
          elapsedSeconds: 52 * 60,
          exercises: [
            {
              exerciseId: "bench-press",
              snapshot: { name: "平板杠铃卧推", mode: "reps", volumeMultiplier: 1 },
              sets: [
                { weight: 60, reps: 8, completed: true, type: "normal" },
                { weight: 60, reps: 8, completed: true, type: "normal" },
                { weight: 60, reps: 8, completed: true, type: "normal" },
                { weight: 60, reps: 8, completed: true, type: "normal" },
              ],
            },
            {
              exerciseId: "incline-dumbbell-press",
              snapshot: { name: "上斜哑铃卧推", mode: "reps", volumeMultiplier: 1 },
              sets: [
                { weight: 25, reps: 10, completed: true, type: "normal" },
                { weight: 25, reps: 10, completed: true, type: "normal" },
                { weight: 25, reps: 10, completed: true, type: "normal" },
                { weight: 25, reps: 10, completed: true, type: "normal" },
              ],
            },
            {
              exerciseId: "cable-pushdown",
              snapshot: { name: "绳索下压", mode: "reps", volumeMultiplier: 1 },
              sets: [
                { weight: 16, reps: 12, completed: true, type: "normal" },
                { weight: 16, reps: 12, completed: true, type: "normal" },
                { weight: 16, reps: 12, completed: true, type: "normal" },
                { weight: 16, reps: 12, completed: true, type: "normal" },
              ],
            },
          ],
        },
      }],
      appleEntries: [{
        id: "ap-elliptical",
        activityType: "elliptical",
        title: "椭圆机",
        durationSeconds: 24 * 60,
        heartRate: { avgBpm: 126 },
      }],
      diets: [
        { data: { calories: 2124, protein: 156, carbs: 231, fat: 64 } },
      ],
    });
    assert.equal(sharePayload.dateDot, "2026.11.22");
    assert.equal(sharePayload.totalMinutes, 76);
    assert.equal(sharePayload.strength.minutes, 52);
    assert.equal(sharePayload.strength.totalSets, 12);
    assert.equal(sharePayload.strength.totalVolumeKg, 3688);
    assert.equal(sharePayload.strength.exercises[0].summary, "60 kg × 8 × 4 组");
    assert.equal(sharePayload.cardio.title, "椭圆机");
    assert.equal(sharePayload.cardio.minutes, 24);
    assert.equal(sharePayload.cardio.avgBpm, 126);
    assert.equal(sharePayload.diet.calories, 2124);
    assert.equal(sharePayload.diet.protein, 156);
    assert.equal(sharePayload.diet.carbs, 231);
    assert.equal(sharePayload.diet.fat, 64);
  } finally {
    db.close();
  }
});

test("覆盖恢复自定义动作墓碑不崩溃 CSV/计划导入，且备份保留 Apple 训练 identityKey", async () => {
  const { db, store, auth, call, owner } = fixture();
  try {
    // 1. Export clean baseline backup (empty custom exercise)
    const emptyExportRes = await call("/api/export");
    assert.equal(emptyExportRes.status, 200);
    const baselineBackup = await emptyExportRes.json();

    // 2. Create custom exercise, then replace-restore older backup (creating stripped {id} tombstone)
    await call("/api/records", {
      method: "POST",
      body: {
        opId: "custom-ex-create",
        id: "custom-fly-1",
        kind: "exercise",
        baseVersion: 0,
        deleted: false,
        data: {
          id: "custom-fly-1",
          name: "单臂龙门夹胸",
          englishName: "Single Arm Cable Fly",
          aliases: ["夹胸"],
          muscle: "chest",
          secondaryMuscles: ["shoulders"],
          equipment: "cable",
          mode: "reps",
          volumeMultiplier: 1,
          instructions: ["收紧胸肌中缝。"],
          mistakes: [],
          custom: true,
        },
      },
    });
    const replaceRes = await call("/api/web/restore-backup", {
      method: "POST",
      body: { backup: baselineBackup, mode: "commit", strategy: "replace" },
    });
    assert.equal(replaceRes.status, 200);

    // 3. Subsequent CSV import preview & JSON plan import must NOT crash with 500
    assert.equal(store.catalogueMap(owner.userId, true).has("custom-fly-1"), false);
    const csvRes = await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Weight Unit,Reps,RPE\n2026-11-20 09:00:00,Push Power,50m,Bench Press (Barbell),1,80,kg,5,8" },
    });
    assert.equal(csvRes.status, 200);
    const planRes = await call("/api/web/plans/import-json", {
      method: "POST",
      body: {
        mode: "preview",
        json: JSON.stringify({
          name: "导入计划",
          schedule: "weekdays",
          weeks: 4,
          weekdays: [1, 3, 5],
          routines: [{ id: "r1", name: "推力日", exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 5, repsMax: 8, restSeconds: 90 }] }],
        }),
      },
    });
    assert.equal(planRes.status, 200);

    // 4. Apple Health trigger & workout with identical timestamps keep distinct identityKey across export/restore
    const dev = (await (await call("/api/integrations/apple-health/tokens", {
      method: "POST",
      body: { label: "Watch" },
    })).json()) as { token: string };
    const trigRes = await call("/api/integrations/apple-health/workouts", {
      method: "POST",
      token: dev.token,
      body: {
        schemaVersion: 1,
        captureMethod: "trigger",
        activityType: "running",
        environment: "outdoor",
        startedAt: "2026-11-21T07:00:00+08:00",
        endedAt: "2026-11-21T07:30:00+08:00",
        durationSeconds: 1800,
        durationKind: "event_elapsed",
      },
    });
    assert.ok(trigRes.status === 200 || trigRes.status === 201);
    const fullWoRes = await call("/api/integrations/apple-health/workouts", {
      method: "POST",
      token: dev.token,
      body: {
        schemaVersion: 1,
        captureMethod: "workout",
        clientSessionId: "sess-1",
        activityType: "running",
        environment: "outdoor",
        startedAt: "2026-11-21T07:00:00+08:00",
        endedAt: "2026-11-21T07:30:00+08:00",
        durationSeconds: 1800,
        durationKind: "workout_active",
        activeEnergyKcal: 340,
        heartRate: { avgBpm: 158, maxBpm: 175 },
      },
    });
    assert.ok(fullWoRes.status === 200 || fullWoRes.status === 201);

    const exported = (await (await call("/api/export")).json()) as {
      appleHealthWorkouts: Array<{ identityKey?: string; activeEnergyKcal?: number }>;
    };
    assert.equal(exported.appleHealthWorkouts.length, 2);
    assert.ok(exported.appleHealthWorkouts.every((w) => typeof w.identityKey === "string" && w.identityKey.length > 0));

    const freshUser = auth.login("restore-target-user");
    const restoreNewRes = await call("/api/web/restore-backup", {
      token: freshUser.token,
      method: "POST",
      body: { backup: exported, mode: "commit", strategy: "replace" },
    });
    assert.equal(restoreNewRes.status, 200);
    const rows = db
      .prepare("SELECT identity_key, data FROM apple_health_workouts WHERE user_id = ?")
      .all(freshUser.userId) as Array<{ identity_key: string; data: string }>;
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => JSON.parse(r.data).activeEnergyKcal === 340));
  } finally {
    db.close();
  }
});
