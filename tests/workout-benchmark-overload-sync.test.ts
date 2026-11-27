import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import {
  getWebExerciseReferences,
  getWebRoutine,
  syncWorkoutRoutineToActivePlan,
} from "../packages/server/src/web-training.js";
import {
  describeSetOverloadCue,
  diffWorkoutAgainstSourceRoutine,
  summarizeExerciseBenchmarks,
} from "../packages/web/src/lib/workout-set-ops.js";
import type { WorkoutExercise } from "../packages/web/src/lib/domain.js";

describe("Workout Benchmark, Pro Overload Badges & Finish Source Sync", () => {
  it("describeSetOverloadCue produces professional 4-tier PR and progressive overload cues", () => {
    const baseline = { exerciseId: "bench", mode: "reps" as const, weight: 80, oneRepMax: 100 };
    const ref = { weight: 75, reps: 8, seconds: 0 };

    // Incomplete or warmup returns null
    assert.equal(
      describeSetOverloadCue({ type: "normal", completed: false, weight: 85, reps: 8, seconds: 0 }, ref, "reps", "kg", baseline),
      null,
    );
    assert.equal(
      describeSetOverloadCue({ type: "warmup", completed: true, weight: 85, reps: 8, seconds: 0 }, ref, "reps", "kg", baseline),
      null,
    );

    // 1. All-time absolute weight PR
    const wPr = describeSetOverloadCue(
      { type: "normal", completed: true, weight: 82.5, reps: 5, seconds: 0 },
      ref,
      "reps",
      "kg",
      baseline,
    );
    assert.ok(wPr);
    assert.equal(wPr.tone, "pr");
    assert.equal(wPr.isPr, true);
    assert.match(wPr.badge, /新绝对负重 PR.*\+2\.5 kg/);

    // 2. All-time e1RM PR (weight <= 80, reps 10 => e1RM = 80*(1+10/30) = 106.7 > 100)
    const e1rmPr = describeSetOverloadCue(
      { type: "normal", completed: true, weight: 80, reps: 10, seconds: 0 },
      ref,
      "reps",
      "kg",
      baseline,
    );
    assert.ok(e1rmPr);
    assert.equal(e1rmPr.tone, "pr");
    assert.match(e1rmPr.badge, /新估算 1RM 纪录/);

    // 3. Weight progressive overload vs last session (not all-time PR)
    const wOverload = describeSetOverloadCue(
      { type: "normal", completed: true, weight: 77.5, reps: 8, seconds: 0 },
      ref,
      "reps",
      "kg",
      baseline,
    );
    assert.ok(wOverload);
    assert.equal(wOverload.tone, "overload");
    assert.equal(wOverload.isPr, false);
    assert.match(wOverload.badge, /负荷超负荷.*\+2\.5 kg/);

    // 4. Rep progressive overload at same weight
    const rOverload = describeSetOverloadCue(
      { type: "normal", completed: true, weight: 75, reps: 10, seconds: 0 },
      ref,
      "reps",
      "kg",
      baseline,
    );
    assert.ok(rOverload);
    assert.equal(rOverload.tone, "overload");
    assert.match(rOverload.badge, /容量超负荷.*\+2 次/);

    // Assisted & timed overload
    const assistOverload = describeSetOverloadCue(
      { type: "normal", completed: true, weight: 15, reps: 8, seconds: 0 },
      { weight: 20, reps: 8, seconds: 0 },
      "assisted",
      "kg",
      null,
    );
    assert.ok(assistOverload);
    assert.match(assistOverload.badge, /减辅助超负荷.*-5 kg/);

    const timedOverload = describeSetOverloadCue(
      { type: "normal", completed: true, weight: 0, reps: 0, seconds: 70 },
      { weight: 0, reps: 0, seconds: 60 },
      "timed",
      "kg",
      null,
    );
    assert.ok(timedOverload);
    assert.match(timedOverload.badge, /等长耐力超负荷.*\+10s/);
  });

  it("summarizeExerciseBenchmarks builds openGym 3-card metrics across modes", () => {
    const summary = summarizeExerciseBenchmarks(
      [
        { weight: 70, reps: 10, seconds: 0 },
        { weight: 80, reps: 8, seconds: 0 },
        { weight: 80, reps: 7, seconds: 0 },
      ],
      { exerciseId: "bench", mode: "reps", weight: 85, oneRepMax: 104.5 },
      "reps",
      "kg",
      1,
    );
    assert.equal(summary.hasAny, true);
    assert.equal(summary.lastTopValue, "80 kg × 8");
    assert.equal(summary.bestWeightValue, "85 kg");
    assert.equal(summary.thirdValue, "104.5 kg");
    assert.equal(summary.lastTotalVolumeKg, 70 * 10 + 80 * 8 + 80 * 7);
    assert.match(summary.lastSummary, /70×10/);
  });

  it("diffWorkoutAgainstSourceRoutine detects swaps, adds, removes, reorders, and structure changes", () => {
    const snapshot = {
      id: "tpl_1",
      name: "上肢推",
      exercises: [
        { exerciseId: "ex_a", sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 },
        { exerciseId: "ex_b", sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 },
      ],
    };

    const makeRow = (
      exerciseId: string,
      setsCount: number,
      restSeconds = 90,
      targetIndex: number | null = null,
    ): WorkoutExercise => ({
      id: `row_${exerciseId}`,
      exerciseId,
      targetIndex,
      restSeconds,
      sets: Array.from({ length: setsCount }, (_, i) => ({
        id: `s_${i}`,
        type: "normal",
        weight: 60,
        reps: 10,
        seconds: 0,
        completed: true,
        rir: null,
      })),
    });

    // No change
    const same = diffWorkoutAgainstSourceRoutine([makeRow("ex_a", 3, 90, 0), makeRow("ex_b", 3, 90, 1)], snapshot);
    assert.equal(same.hasChanges, false);

    // Swap 1 exercise + change sets on the other
    const changed = diffWorkoutAgainstSourceRoutine([makeRow("ex_a", 4, 120, 0), makeRow("ex_c", 3, 90, null)], snapshot);
    assert.equal(changed.hasChanges, true);
    assert.equal(changed.swappedCount, 1);
    assert.equal(changed.structureAdjustCount, 1);
    assert.match(changed.summary, /替换 1 个动作/);
    assert.match(changed.summary, /调整 1 处组数\/休息/);
  });

  it("server returns previous date & lastTop on routine preview and syncs workouts back to custom templates", async () => {
    const db = openDatabase(":memory:");
    const { app, store, auth } = createApp(db);
    const { userId, token } = auth.login("u_bench_sync");
    const ids = [...store.catalogueMap(userId).keys()];
    const ex1 = ids[0]!;
    const ex2 = ids[1]!;

    // 1. Seed a completed workout on 2026-11-20 for ex1
    const w1 = await app.request("/api/records", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        opId: "op_w1",
        id: "w_prev",
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: {
          title: "上肢推",
          date: "2026-11-20",
          startedAt: "2026-11-20T09:00:00.000Z",
          endedAt: "2026-11-20T09:45:00.000Z",
          status: "completed",
          exercises: [
            {
              id: "row1",
              exerciseId: ex1,
              restSeconds: 90,
              sets: [
                { id: "s1", type: "normal", weight: 70, reps: 10, seconds: 0, completed: true, rir: 2 },
                { id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 1 },
              ],
            },
          ],
        },
      }),
    });
    assert.equal(w1.status, 200);

    // 2. Verify getWebExerciseReferences includes previous session date
    const refs = getWebExerciseReferences(store, userId, {
      date: "2026-11-27",
      startedAt: "2026-11-27T10:00:00.000Z",
      exercises: [{ id: ex1 }],
    });
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.date, "2026-11-20");

    // 3. Create custom template with ex1 (3 sets)
    const tplRes = await app.request("/api/records", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        opId: "op_tpl1",
        id: "tpl_push",
        kind: "template",
        baseVersion: 0,
        deleted: false,
        data: {
          id: "tpl_push",
          name: "我的推日模板",
          exercises: [
            {
              exerciseId: ex1,
              sets: 3,
              repsMin: 8,
              repsMax: 12,
              weight: null,
              seconds: 0,
              restSeconds: 90,
              targetRir: 2,
              progression: "double",
              increment: 2.5,
            },
          ],
        },
      }),
    });
    assert.equal(tplRes.status, 200);

    // 4. Verify getWebRoutine returns lastTop for ex1
    const preview = getWebRoutine(store, userId, { id: "tpl_push", source: "template", date: "2026-11-27" });
    assert.ok(preview.exercises[0]!.lastTop);
    assert.equal(preview.exercises[0]!.lastTop!.weight, 80);
    assert.equal(preview.exercises[0]!.lastTop!.reps, 8);
    assert.equal(preview.exercises[0]!.lastTop!.date, "2026-11-20");

    // 5. Log a completed workout from tpl_push with ex1 (4 sets, 120s rest) + newly added ex2
    const w2 = await app.request("/api/records", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        opId: "op_w2",
        id: "w_from_tpl",
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: {
          title: "我的推日模板",
          date: "2026-11-27",
          startedAt: "2026-11-27T10:00:00.000Z",
          endedAt: "2026-11-27T10:50:00.000Z",
          status: "completed",
          routineId: "tpl_push",
          exercises: [
            {
              id: "r_1",
              exerciseId: ex1,
              targetIndex: 0,
              restSeconds: 120,
              sets: [
                { id: "a1", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 },
                { id: "a2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 },
                { id: "a3", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 1 },
                { id: "a4", type: "normal", weight: 80, reps: 7, seconds: 0, completed: true, rir: 1 },
              ],
            },
            {
              id: "r_2",
              exerciseId: ex2,
              restSeconds: 60,
              sets: [
                { id: "b1", type: "normal", weight: 20, reps: 12, seconds: 0, completed: true, rir: 2 },
                { id: "b2", type: "normal", weight: 20, reps: 12, seconds: 0, completed: true, rir: 2 },
              ],
            },
          ],
        },
      }),
    });
    assert.equal(w2.status, 200);

    // 6. Sync workout changes back to the template!
    const syncRes = syncWorkoutRoutineToActivePlan(store, userId, { workoutId: "w_from_tpl" });
    assert.equal(syncRes.syncedKind, "template");
    assert.equal(syncRes.syncedRoutineName, "我的推日模板");
    assert.equal(syncRes.exercisesCount, 2);

    const updatedTpl = store.get(userId, "template", "tpl_push");
    assert.ok(updatedTpl);
    const tplExercises = (updatedTpl.data as { exercises: Array<{ exerciseId: string; sets: number; restSeconds: number }> }).exercises;
    assert.equal(tplExercises.length, 2);
    assert.equal(tplExercises[0]!.sets, 4);
    assert.equal(tplExercises[0]!.restSeconds, 120);
    assert.equal(tplExercises[1]!.exerciseId, ex2);
    assert.equal(tplExercises[1]!.sets, 2);

    db.close();
  });
});
