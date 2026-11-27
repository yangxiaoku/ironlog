import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localDate, type Workout } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { getDailyHealth, upsertDailyHealth } from "../packages/server/src/apple-health-daily.js";
import { buildSleepReport } from "../packages/server/src/sleep-report.js";
import { getStats } from "../packages/server/src/stats.js";
import { saveProgressPhoto, updateDailyWater } from "../packages/server/src/web-extras.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";
import {
  clearWebScheduleDay,
  getWebSchedule,
  getWebToday,
  saveWebScheduleDay,
  shiftWebScheduleDay,
  syncWorkoutRoutineToActivePlan,
} from "../packages/server/src/web-training.js";
import { copyDietBatch, DietCopyMismatchError } from "../packages/web/src/lib/diet-copy.js";
import { flushQueue } from "../packages/web/src/lib/offline-queue.js";

function makeCtx() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db, {});
  const userA = auth.login("audit_all_a");
  const userB = auth.login("audit_all_b");
  const call = (
    path: string,
    opts: { method?: string; body?: unknown; token?: string } = {},
  ) =>
    app.request(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${opts.token ?? userA.token}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  return { db, store, auth, userA, userB, app, call };
}

// ============================================================
// Batch A: All 10 P1s + Backup/Restore/Plan Sync (#15-#19, #52-#55, #61, #66, #67)
// ============================================================

test("#66 (P1) 批量同步事务回滚后 listCache 不泄露未入库的自定义动作", async () => {
  const { db, store, userA, call } = makeCtx();
  try {
    const today = localDate();
    // Batch with valid new custom exercise + invalid workout -> whole tx rolls back with 400
    const badSync = await call("/api/sync", {
      method: "POST",
      body: {
        cursor: 0,
        mutations: [
          {
            opId: "op_ghost_ex",
            id: "ghost_ex_1",
            kind: "exercise",
            baseVersion: 0,
            deleted: false,
            data: {
              id: "ghost_ex_1",
              name: "幽灵动作",
              englishName: "Ghost Exercise",
              aliases: [],
              muscle: "chest",
              secondaryMuscles: [],
              equipment: "barbell",
              category: "strength",
              mode: "reps",
              volumeMultiplier: 1,
              instructions: ["测试"],
              mistakes: [],
              custom: true,
            },
          },
          {
            opId: "op_bad_wo",
            id: "bad_wo_1",
            kind: "workout",
            baseVersion: 0,
            deleted: false,
            data: {
              title: "坏训练",
              date: today,
              startedAt: `${today}T12:00:00Z`,
              endedAt: `${today}T11:00:00Z`, // endedAt < startedAt -> throws 400
              status: "completed",
              exercises: [
                {
                  id: "r1",
                  exerciseId: "ghost_ex_1",
                  restSeconds: 90,
                  sets: [{ id: "s1", type: "normal", weight: 50, reps: 8, seconds: 0, completed: true, rir: 2 }],
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(badSync.status, 400);

    // Save an unrelated diet record (reusing the rolled-back seq number!)
    const dietRes = await call("/api/records", {
      method: "POST",
      body: {
        opId: "op_diet_after_rollback",
        id: "diet_after_rb",
        kind: "diet",
        baseVersion: 0,
        deleted: false,
        data: { date: today, meal: "lunch", name: "鸡胸", calories: 300, protein: 40, carbs: 10, fat: 5 },
      },
    });
    assert.equal(dietRes.status, 200);

    // Ghost exercise MUST NOT appear in list or be accepted by a new workout
    assert.equal(store.list(userA.userId, "exercise").some((r) => r.id === "ghost_ex_1"), false);
    const woRes = await call("/api/records", {
      method: "POST",
      body: {
        opId: "op_ref_ghost",
        id: "wo_ref_ghost",
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: {
          title: "引用幽灵",
          date: today,
          startedAt: `${today}T10:00:00Z`,
          endedAt: `${today}T10:30:00Z`,
          status: "completed",
          exercises: [
            {
              id: "r1",
              exerciseId: "ghost_ex_1",
              restSeconds: 90,
              sets: [{ id: "s1", type: "normal", weight: 50, reps: 8, seconds: 0, completed: true, rir: 2 }],
            },
          ],
        },
      },
    });
    assert.equal(woRes.status, 400);
  } finally {
    db.close();
  }
});

test("#15, #16, #17, #18, #53, #55 全量备份覆盖恢复：含照片/归档动作/版本对齐/坏行预拦截/幂等重试/饮水去重", async () => {
  const { db, store, userA, userB, call } = makeCtx();
  try {
    const today = localDate();
    const img = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

    // 1. Create custom exercise, plan referencing it, apply plan, archive custom exercise (#16)
    store.mutate(userA.userId, {
      opId: "ex_c1",
      id: "cust_fly_1",
      kind: "exercise",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "cust_fly_1",
        name: "自定义夹胸",
        englishName: "Custom Fly",
        aliases: [],
        muscle: "chest",
        secondaryMuscles: [],
        equipment: "machine",
        category: "strength",
        mode: "reps",
        volumeMultiplier: 1,
        instructions: ["测试"],
        mistakes: [],
        custom: true,
      },
    });
    const draft = store.createDraft(userA.userId, {
      name: "迁移测试计划",
      weeks: 4,
      schedule: "rotation",
      weekdays: [],
      rationale: "测试",
      source: "manual",
      parentId: null,
      routines: [
        {
          id: "rt_1",
          name: "推力日",
          exercises: [
            {
              exerciseId: "bench-press",
              sets: 3,
              repsMin: 8,
              repsMax: 12,
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
    });
    store.applyPlan(userA.userId, draft.record!.id, draft.record!.version, 0);

    // Another draft referencing archived custom exercise (#16)
    store.createDraft(userA.userId, {
      name: "含归档动作旧计划",
      weeks: 4,
      schedule: "rotation",
      weekdays: [],
      rationale: "旧草稿",
      source: "manual",
      parentId: null,
      routines: [
        {
          id: "rt_old",
          name: "旧胸",
          exercises: [
            {
              exerciseId: "cust_fly_1",
              sets: 3,
              repsMin: 10,
              repsMax: 12,
              weight: 30,
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
    });
    // Archive the custom exercise
    store.mutate(userA.userId, {
      opId: "ex_c1_del",
      id: "cust_fly_1",
      kind: "exercise",
      baseVersion: 1,
      deleted: true,
      data: store.get(userA.userId, "exercise", "cust_fly_1")!.data,
    });

    // Save a body measurement (#53), a progress photo (#18), and water +250ml (#55)
    await call("/api/web/measurements", { method: "PUT", body: { date: today, waistCm: 80, notes: "ok" } });
    saveProgressPhoto(db, userA.userId, { date: today, pose: "front", mime: "image/jpeg", imageData: img, note: "前视图" });
    updateDailyWater(db, userA.userId, { date: today, deltaMl: 250, opId: "water_op_55" });

    // Export full backup from userA
    const exported = store.export(userA.userId);
    assert.equal(exported.progressPhotos.length, 1);

    // #53: Corrupt measurement date in backup -> overwrite preview & commit MUST REJECT and preserve userB's existing measurement!
    await call("/api/web/measurements", { method: "PUT", body: { date: today, waistCm: 77, notes: "B原数据" }, token: userB.token });
    const corruptBackup = JSON.parse(JSON.stringify(exported));
    corruptBackup.bodyMeasurements[0].date = "not-a-date";
    assert.throws(() => store.restoreBackup(userB.userId, corruptBackup, { mode: "preview", strategy: "replace" }), /身体围度无效/);
    assert.throws(() => store.restoreBackup(userB.userId, corruptBackup, { mode: "commit", strategy: "replace" }), /身体围度无效/);
    const bMeasAfterReject = (await (await call("/api/web/measurements", { token: userB.token })).json()) as Array<{ waistCm: number }>;
    assert.equal(bMeasAfterReject.length, 1);
    assert.equal(bMeasAfterReject[0]!.waistCm, 77);

    // #16 & #18: Valid backup restores cleanly onto userB (including archived custom exercise plan AND progress photo!)
    const prevOk = store.restoreBackup(userB.userId, exported, { mode: "preview", strategy: "replace" });
    assert.equal(prevOk.counts.progressPhotos, 1);
    const firstCommit = store.restoreBackup(userB.userId, exported, { mode: "commit", strategy: "replace", opId: "restore_op_15" });
    assert.equal(firstCommit.counts.progressPhotos, 1);
    const bPhotos = (await (await call("/api/web/progress-photos", { token: userB.token })).json()) as Array<{ id: string }>;
    assert.equal(bPhotos.length, 1);

    // #15: Another device adds a diet record AFTER first restore; retrying SAME restore opId MUST NOT delete the new diet record!
    store.mutate(userB.userId, {
      opId: "post_restore_diet",
      id: "diet_post_15",
      kind: "diet",
      baseVersion: 0,
      deleted: false,
      data: { date: today, meal: "dinner", name: "恢复后新增晚餐", calories: 500, protein: 35, carbs: 50, fat: 15 },
    });
    const retryCommit = store.restoreBackup(userB.userId, exported, { mode: "commit", strategy: "replace", opId: "restore_op_15" });
    assert.equal(retryCommit.imported, firstCommit.imported);
    const postDiet = store.get(userB.userId, "diet", "diet_post_15");
    assert.ok(postDiet && !postDiet.deleted, "post-restore diet record must survive idempotent restore retry");

    // #17: After overwrite restore, plan record version is bumped above activePlan.version; sync-back reconciles cleanly (no 409!)
    const activeB = store.activePlan(userB.userId)!;
    const planRecB = store.get(userB.userId, "plan", activeB.id)!;
    assert.ok(planRecB.version >= activeB.version);
    store.mutate(userB.userId, {
      opId: "wo_sync_17",
      id: "wo_17",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "推力日",
        date: today,
        startedAt: `${today}T02:00:00Z`,
        endedAt: `${today}T02:45:00Z`,
        status: "completed",
        planId: activeB.id,
        planVersion: activeB.version,
        routineId: "rt_1",
        exercises: [
          {
            id: "ex_17",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [
              { id: "s1", type: "normal", weight: 65, reps: 10, seconds: 0, completed: true, rir: 2 },
              { id: "s2", type: "normal", weight: 65, reps: 10, seconds: 0, completed: true, rir: 2 },
              { id: "s3", type: "normal", weight: 65, reps: 10, seconds: 0, completed: true, rir: 2 },
              { id: "s4", type: "normal", weight: 65, reps: 10, seconds: 0, completed: true, rir: 2 },
            ],
          },
        ],
      },
    });
    const syncRes = syncWorkoutRoutineToActivePlan(store, userB.userId, { workoutId: "wo_17" });
    assert.equal(syncRes.syncedKind, "plan");
    assert.equal(syncRes.activePlan?.version, planRecB.version + 1);

    // #55: Overwrite restore on userA preserves water opId receipt so replaying water_op_55 stays 250 ml (NOT 500 ml!)
    store.restoreBackup(userA.userId, exported, { mode: "commit", strategy: "replace", opId: "restore_a_55" });
    const waterReplay = updateDailyWater(db, userA.userId, { date: today, deltaMl: 250, opId: "water_op_55" });
    assert.equal(waterReplay.waterMl, 250);
  } finally {
    db.close();
  }
});

test("#19 (P1) 旧计划 v1 开练后回写禁止覆盖已升级的 v2 生效计划，#61 (P1) 顺延不静默覆盖非空目标日，#62 清除排期校验版本", () => {
  const { db, store, userA } = makeCtx();
  try {
    const today = localDate();
    const d1 = shiftDay(today, 1);
    const d2 = shiftDay(today, 2);

    // Create & apply plan v1 (3 sets), then upgrade to v2 (5 sets)
    const draft = store.createDraft(userA.userId, {
      name: "推拉计划",
      weeks: 4,
      schedule: "rotation",
      weekdays: [],
      rationale: "v1",
      source: "manual",
      parentId: null,
      routines: [
        {
          id: "push",
          name: "推",
          exercises: [
            { exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null },
          ],
        },
      ],
    });
    store.applyPlan(userA.userId, draft.record!.id, 1, 0);
    // Upgrade plan to v2 with 5 sets
    const planV2 = JSON.parse(JSON.stringify(draft.record!.data));
    planV2.routines[0].exercises[0].sets = 5;
    store.mutate(userA.userId, {
      opId: "plan_v2_up",
      id: draft.record!.id,
      kind: "plan",
      baseVersion: 1,
      deleted: false,
      data: planV2,
    });
    store.applyPlan(userA.userId, draft.record!.id, 2, 1);

    // Workout started on v1 with 3 sets tries to sync back -> MUST throw 409!
    store.mutate(userA.userId, {
      opId: "wo_v1_old",
      id: "wo_from_v1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "推",
        date: today,
        startedAt: `${today}T02:00:00Z`,
        endedAt: `${today}T02:30:00Z`,
        status: "completed",
        planId: draft.record!.id,
        planVersion: 1,
        routineId: "push",
        exercises: [
          {
            id: "r1",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [
              { id: "s1", type: "normal", weight: 60, reps: 10, seconds: 0, completed: true, rir: 2 },
              { id: "s2", type: "normal", weight: 60, reps: 10, seconds: 0, completed: true, rir: 2 },
              { id: "s3", type: "normal", weight: 60, reps: 10, seconds: 0, completed: true, rir: 2 },
            ],
          },
        ],
      },
    });
    assert.throws(() => syncWorkoutRoutineToActivePlan(store, userA.userId, { workoutId: "wo_from_v1" }), /v1.*v2/);
    assert.equal(store.activePlan(userA.userId)!.data.routines[0]!.exercises[0]!.sets, 5);

    // #61: Schedule chest on d1 and legs on d2; shifting d1 -> d2 without overwrite MUST return 409 conflict!
    saveWebScheduleDay(store, userA.userId, d1, {
      mode: "workout",
      title: "胸部训练",
      notes: "胸备注",
      exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }],
    });
    const d2Saved = saveWebScheduleDay(store, userA.userId, d2, {
      mode: "workout",
      title: "腿部训练",
      notes: "腿备注",
      exercises: [{ exerciseId: "squat", sets: 4, repsMin: 6, repsMax: 8, weight: 90, seconds: 0, restSeconds: 120, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }],
    });
    assert.throws(() => shiftWebScheduleDay(store, userA.userId, { fromDate: d1, toDate: d2, overwrite: false }), /已有安排/);
    // d2 must remain legs untouched
    assert.equal((store.get(userA.userId, "scheduledDay", `schedule_${d2}`)!.data as { title: string }).title, "腿部训练");

    // #62: Stale DELETE with old version fails with 409!
    const d2v2 = saveWebScheduleDay(store, userA.userId, d2, {
      mode: "workout",
      title: "腿部更新",
      notes: "99kg深蹲",
      baseVersion: d2Saved.record!.version,
      exercises: [{ exerciseId: "squat", sets: 4, repsMin: 6, repsMax: 8, weight: 99, seconds: 0, restSeconds: 120, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }],
    });
    assert.throws(() => clearWebScheduleDay(store, userA.userId, d2, undefined, d2Saved.record!.version), /已被其他设备修改/);
    assert.equal(store.get(userA.userId, "scheduledDay", `schedule_${d2}`)!.deleted, false);
    // Clearing with latest version succeeds
    clearWebScheduleDay(store, userA.userId, d2, undefined, d2v2.record!.version);
    assert.equal(store.get(userA.userId, "scheduledDay", `schedule_${d2}`)!.deleted, true);
  } finally {
    db.close();
  }
});

// ============================================================
// Batch B: Calendar (#63, #64, #65) & Workout Editing (#26-#28, #54, #67, #68)
// ============================================================

test("#63, #64, #65 日历：独立有氧不误标抗阻完成、Apple打卡推进轮换、回写不延长计划结束日", async () => {
  const { db, store, userA, call } = makeCtx();
  try {
    const today = localDate();
    const device = (await (await call("/api/integrations/apple-health/tokens", { method: "POST", body: { label: "Watch" } })).json()) as { token: string };

    // #63: Schedule chest resistance on yesterday + upload standalone Apple outdoor run -> calendar keeps chest scheduled!
    const yest = shiftDay(today, -1);
    saveWebScheduleDay(store, userA.userId, yest, {
      mode: "workout",
      title: "胸部抗阻",
      notes: "",
      exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }],
    });
    const runRes = await call("/api/integrations/apple-health/workouts", {
      method: "POST",
      token: device.token,
      body: {
        schemaVersion: 1,
        captureMethod: "workout",
        externalWorkoutId: "run_standalone_63",
        activityType: "running",
        environment: "outdoor",
        startedAt: `${yest}T07:00:00+08:00`,
        endedAt: `${yest}T07:30:00+08:00`,
        durationSeconds: 1800,
        durationKind: "workout_active",
        distanceMeters: 5000,
      },
    });
    assert.equal(runRes.status, 201);
    const sched63 = getWebSchedule(store, userA.userId, { from: yest, through: yest });
    assert.equal(sched63.days[0]!.status, "scheduled");
    assert.equal(sched63.days[0]!.title, "胸部抗阻");
    assert.ok(sched63.days[0]!.routine != null);

    // Clear override for #64 & #65
    clearWebScheduleDay(store, userA.userId, yest);

    // #64 & #65: 4-week rotation A/B started 20 days ago -> Apple strength credits A -> next projected day is B, and nothing projected past 28-day end!
    const draft = store.createDraft(userA.userId, {
      name: "AB轮换",
      weeks: 4,
      schedule: "rotation",
      weekdays: [],
      rationale: "test",
      source: "manual",
      parentId: null,
      routines: [
        { id: "rt_a", name: "训练A", exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }] },
        { id: "rt_b", name: "训练B", exercises: [{ exerciseId: "squat", sets: 3, repsMin: 8, repsMax: 12, weight: 80, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }] },
      ],
    });
    store.applyPlan(userA.userId, draft.record!.id, 1, 0);
    const started20dAgo = `${shiftDay(today, -20)}T00:00:00.000Z`;
    db.prepare("UPDATE active_plans SET updated_at=?, cycle_started_at=? WHERE user_id=?").run(started20dAgo, started20dAgo, userA.userId);
    db.prepare("UPDATE plan_activations SET updated_at=?, cycle_started_at=? WHERE user_id=?").run(started20dAgo, started20dAgo, userA.userId);

    // Upload Apple strength workout on yesterday -> credits rt_a
    const strRes = await call("/api/integrations/apple-health/workouts", {
      method: "POST",
      token: device.token,
      body: {
        schemaVersion: 1,
        captureMethod: "workout",
        externalWorkoutId: "str_apple_64",
        activityType: "traditionalStrengthTraining",
        environment: "indoor",
        startedAt: `${yest}T10:00:00+08:00`,
        endedAt: `${yest}T10:45:00+08:00`,
        durationSeconds: 2700,
        durationKind: "workout_active",
      },
    });
    assert.equal(strRes.status, 201);
    assert.equal(getWebToday(store, userA.userId, yest).applePlan?.routineId, "rt_a");

    // #64: Next projected day in calendar MUST be rt_b (NOT rt_a!)
    const sched64 = getWebSchedule(store, userA.userId, { from: yest, through: shiftDay(today, 20) });
    const nextProjected = sched64.days.find((d) => d.date > yest && d.status === "projected");
    assert.ok(nextProjected);
    assert.equal(nextProjected!.routineId, "rt_b");

    // #65: Even after preserving cycle on a plan update (updated_at = today, cycle_started_at = 20d ago),
    // days AFTER plan end (today + 8..20) MUST NOT have projected plan workouts!
    const planEnd = shiftDay(shiftDay(today, -20), 27); // today + 7
    db.prepare("UPDATE active_plans SET updated_at=? WHERE user_id=?").run(new Date().toISOString(), userA.userId);
    const sched65 = getWebSchedule(store, userA.userId, { from: today, through: shiftDay(today, 20) });
    const afterEndProjected = sched65.days.filter((d) => d.date > planEnd && d.status === "projected");
    assert.equal(afterEndProjected.length, 0);
  } finally {
    db.close();
  }
});

// ============================================================
// Batch C: Apple Health, Steps, Sleep & Annotations (#20-#25, #56-#57, #72-#75)
// ============================================================

test("#20, #21, #56, #57, #75 称重同值推进水位、迁移保留归属、步数乱序收敛、睡眠口径统一与手工饮水不冒充Apple同步", async () => {
  const { db, store, userA, userB, call } = makeCtx();
  try {
    const today = localDate();
    const yest = shiftDay(today, -1);

    // #20: 09:00 72kg -> 11:00 72kg -> late 10:00 74kg MUST NOT overwrite weight record (stays 72kg!)
    upsertDailyHealth(store, userA.userId, { date: today, weightKg: 72, weightMeasuredAt: `${today}T09:00:00+08:00` });
    upsertDailyHealth(store, userA.userId, { date: today, weightKg: 72, weightMeasuredAt: `${today}T11:00:00+08:00` });
    upsertDailyHealth(store, userA.userId, { date: today, weightKg: 74, weightMeasuredAt: `${today}T10:00:00+08:00` });
    assert.equal((store.get(userA.userId, "weight", `weight_${today}`)!.data as { weight: number }).weight, 72);

    // #21: Export from userA -> restore onto userB -> newer 12:00 73kg updates userB's weight record!
    const exp = store.export(userA.userId);
    store.restoreBackup(userB.userId, exp, { mode: "commit", strategy: "replace", opId: "r_21" });
    upsertDailyHealth(store, userB.userId, { date: today, weightKg: 73, weightMeasuredAt: `${today}T12:00:00+08:00` });
    assert.equal((store.get(userB.userId, "weight", `weight_${today}`)!.data as { weight: number }).weight, 73);

    // #56: Out-of-order hourly steps arrive in different orders -> both converge to exact 2050!
    upsertDailyHealth(store, userA.userId, { date: today, shortcutGenVersion: "4", occurredAt: `${today}T10:30:00+08:00`, stepsSamples: [`${yest} 10:00|1100`] });
    upsertDailyHealth(store, userA.userId, { date: today, shortcutGenVersion: "4", occurredAt: `${today}T09:10:00+08:00`, stepsSamples: [`${yest} 09:00|900`] });
    upsertDailyHealth(store, userA.userId, { date: today, shortcutGenVersion: "4", occurredAt: `${today}T09:40:00+08:00`, stepsSamples: [`${yest} 09:00|950`] });
    assert.equal(getDailyHealth(db, userA.userId, yest)?.steps, 2050);

    // #57: Stale 900 min scalar followed by 240 min timed core + 60 min untimed REM -> daily API, sleep report & homepage readiness ALL see 300 min!
    upsertDailyHealth(store, userA.userId, { date: today, sleepMinutes: 900 });
    upsertDailyHealth(store, userA.userId, {
      date: today,
      sleepSamples: [
        { stage: "core", startedAt: `${today}T01:00:00+08:00`, endedAt: `${today}T05:00:00+08:00` },
        { stage: "rem", durationMinutes: 60 },
      ],
    });
    assert.equal(getDailyHealth(db, userA.userId, today)?.sleepMinutes, 300);
    const rawRow = db.prepare("SELECT data FROM apple_health_daily WHERE user_id=? AND date=?").get(userA.userId, today) as { data: string };
    assert.equal(buildSleepReport([JSON.parse(rawRow.data)], today, today, 1).series[0]!.minutes, 300);
    const homeToday = getWebToday(store, userA.userId, today);
    assert.ok(homeToday.readinessHint != null);
    assert.match(homeToday.readinessHint!.detail, /5小时/);

    // #75: Manual water on an account with NO Apple device yields lastDaily === null;
    // manual water on yesterday does NOT replace today's Apple Health sync (steps 3456) in /status!
    const userC = store.db ? makeCtx() : null!;
    try {
      updateDailyWater(userC.db, userC.userA.userId, { date: today, deltaMl: 250 });
      const statusOnlyWater = (await (await userC.call("/api/integrations/apple-health/status")).json()) as { lastDaily: unknown };
      assert.equal(statusOnlyWater.lastDaily, null);

      upsertDailyHealth(userC.store, userC.userB.userId, { date: today, steps: 3456 });
      updateDailyWater(userC.db, userC.userB.userId, { date: yest, deltaMl: 300 });
      const statusB = (await (await userC.call("/api/integrations/apple-health/status", { token: userC.userB.token })).json()) as {
        lastDaily: { date: string; steps: number | null } | null;
      };
      assert.equal(statusB.lastDaily?.date, today);
      assert.equal(statusB.lastDaily?.steps, 3456);
    } finally {
      userC.db.close();
    }
  } finally {
    db.close();
  }
});

test("#22, #23, #24, #25, #72, #73 Apple 事件防幽灵、多设备网页开练合并、删除不复活、类型别名兼容与备注多端合并", async () => {
  const { db, call } = makeCtx();
  try {
    const dev1 = (await (await call("/api/integrations/apple-health/tokens", { method: "POST", body: { label: "Watch 1" } })).json()) as { token: string };
    const dev2 = (await (await call("/api/integrations/apple-health/tokens", { method: "POST", body: { label: "Watch 2" } })).json()) as { token: string };
    const now = Date.now();
    const iso = (offsetMin: number) => new Date(now + offsetMin * 60_000).toISOString();

    // #22: Cycling starts at -30m, late running start arrives at -40m -> cycling ends -> NO ghost active running!
    assert.equal((await call("/api/integrations/apple-health/events", { token: dev1.token, body: { schemaVersion: 1, event: "start", activityType: "cycling", environment: "outdoor", occurredAt: iso(-30) } })).status, 200);
    assert.equal((await call("/api/integrations/apple-health/events", { token: dev1.token, body: { schemaVersion: 1, event: "start", activityType: "running", environment: "outdoor", occurredAt: iso(-40) } })).status, 200);
    const cycEndRes = await call("/api/integrations/apple-health/events", { token: dev1.token, body: { schemaVersion: 1, event: "end", activityType: "cycling", environment: "outdoor", occurredAt: iso(-10) } });
    assert.ok(cycEndRes.status === 200 || cycEndRes.status === 201);
    const st22 = (await (await call("/api/integrations/apple-health/status")).json()) as { activeSession: unknown };
    assert.equal(st22.activeSession, null);

    // #23: One web launch across 2 devices, both report end -> collapses into ONE workout!
    const launchAt = iso(-25);
    const endAt = iso(-5);
    const launchRes = await call("/api/integrations/apple-health/session-start", {
      body: { activityType: "traditionalStrengthTraining", environment: "indoor", startedAt: launchAt },
    });
    assert.equal((await launchRes.json() as { recorded: number }).recorded, 2);
    const strEnd1 = await call("/api/integrations/apple-health/events", { token: dev1.token, body: { schemaVersion: 1, event: "end", activityType: "traditionalStrengthTraining", environment: "indoor", occurredAt: endAt } });
    assert.ok(strEnd1.status === 200 || strEnd1.status === 201);
    await call("/api/integrations/apple-health/events", { token: dev2.token, body: { schemaVersion: 1, event: "end", activityType: "traditionalStrengthTraining", environment: "indoor", occurredAt: endAt } });
    const allWo23 = (await (await call("/api/integrations/apple-health/workouts")).json()) as Array<{ activityType: string; startedAt: string }>;
    assert.equal(allWo23.filter((w) => w.startedAt === launchAt).length, 1);

    // #25: Same externalWorkoutId with snake_case vs camelCase activityType succeeds (no 409)
    const wStart = iso(-120);
    const wEnd = iso(-80);
    const up1 = await call("/api/integrations/apple-health/workouts", {
      token: dev1.token,
      body: { schemaVersion: 1, captureMethod: "workout", externalWorkoutId: "ext_alias_25", activityType: "traditional_strength_training", environment: "indoor", startedAt: wStart, endedAt: wEnd, durationSeconds: 2400, durationKind: "workout_active" },
    });
    assert.equal(up1.status, 201);
    const { workoutId } = (await up1.json()) as { workoutId: string };
    const up2 = await call("/api/integrations/apple-health/workouts", {
      token: dev1.token,
      body: { schemaVersion: 1, captureMethod: "workout", externalWorkoutId: "ext_alias_25", activityType: "traditionalStrengthTraining", environment: "indoor", startedAt: wStart, endedAt: wEnd, durationSeconds: 2400, durationKind: "workout_active", activeEnergyKcal: 260 },
    });
    assert.equal(up2.status, 200);

    // #72: Device B edits notes + distanceKm; stale Device A edits ONLY feeling -> safe merge preserves B's notes & distanceKm!
    const annB = await call(`/api/integrations/apple-health/workouts/${encodeURIComponent(workoutId)}/annotation`, {
      method: "PUT",
      body: { source: "manual", notes: "设备B备注", distanceKm: "5.1", expectedUpdatedAt: null },
    });
    assert.equal(annB.status, 200);
    const annA = await call(`/api/integrations/apple-health/workouts/${encodeURIComponent(workoutId)}/annotation`, {
      method: "PUT",
      body: { source: "manual", feeling: "easy", expectedUpdatedAt: null, base: { feeling: null } },
    });
    assert.equal(annA.status, 200);
    const annABody = (await annA.json()) as { annotation: { notes: string; distanceKm: string; feeling: string } };
    assert.equal(annABody.annotation.notes, "设备B备注");
    assert.equal(annABody.annotation.distanceKm, "5.1");
    assert.equal(annABody.annotation.feeling, "easy");

    // #73: Confirmed web cardio session attaches laps & sessionId onto workout that already had a manual note (NO 409!)
    const cardioAttach = await call(`/api/integrations/apple-health/workouts/${encodeURIComponent(workoutId)}/annotation`, {
      method: "PUT",
      body: { sessionId: "web_cardio_sess_1", source: "cardio_session", notes: "", feeling: "balanced", distanceKm: "", lapSeconds: [310, 305] },
    });
    assert.equal(cardioAttach.status, 200);
    const attached = (await cardioAttach.json()) as { annotation: { lapSeconds: number[]; notes: string; sessionId: string } };
    assert.deepEqual(attached.annotation.lapSeconds, [310, 305]);
    assert.equal(attached.annotation.notes, "设备B备注");
    assert.equal(attached.annotation.sessionId, "web_cardio_sess_1");

    // #24: Deleting workout prevents identical re-upload from resurrecting it
    assert.equal((await call(`/api/integrations/apple-health/workouts/${encodeURIComponent(workoutId)}`, { method: "DELETE" })).status, 200);
    await call("/api/integrations/apple-health/workouts", {
      token: dev1.token,
      body: { schemaVersion: 1, captureMethod: "workout", externalWorkoutId: "ext_alias_25", activityType: "traditionalStrengthTraining", environment: "indoor", startedAt: wStart, endedAt: wEnd, durationSeconds: 2400, durationKind: "workout_active" },
    });
    const afterReupload = (await (await call("/api/integrations/apple-health/workouts")).json()) as Array<{ externalWorkoutId?: string }>;
    assert.equal(afterReupload.some((w) => w.externalWorkoutId === "ext_alias_25"), false);
  } finally {
    db.close();
  }
});

// ============================================================
// Batch D: Offline Queue, Diet Copy, MCP & PWA (#58-#60, #69-#71) + Static UI Guards (#26-#28, #54, #67, #68, #74)
// ============================================================

test("#58, #59, #60, #69, #70, #71 及前端回归护栏（#26-#28, #54, #67, #68, #74）", async () => {
  const { db, store, userA, call } = makeCtx();
  try {
    const today = localDate();

    // #58: POST /api/plans/drafts with same opId is idempotent; different content with same opId returns 409
    const planPayload = {
      opId: "mcp_draft_op_58",
      name: "MCP计划",
      weeks: 4,
      schedule: "rotation",
      weekdays: [],
      rationale: "测试幂等",
      routines: [
        { id: "d1", name: "日1", exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, restSeconds: 90 }] },
      ],
    };
    const d1 = await call("/api/plans/drafts", { body: planPayload });
    assert.equal(d1.status, 201);
    const id1 = ((await d1.json()) as { record: { id: string } }).record.id;
    const d2 = await call("/api/plans/drafts", { body: planPayload });
    assert.equal(d2.status, 201);
    const id2 = ((await d2.json()) as { record: { id: string } }).record.id;
    assert.equal(id2, id1);
    assert.equal(store.list(userA.userId, "plan").length, 1);
    const d3Conflict = await call("/api/plans/drafts", { body: { ...planPayload, name: "不同计划" } });
    assert.equal(d3Conflict.status, 409);

    // #59: GET /api/stats (used by MCP get_today) includes Apple Watch activities
    const yest59 = shiftDay(today, -1);
    const dev = (await (await call("/api/integrations/apple-health/tokens", { method: "POST", body: { label: "W" } })).json()) as { token: string };
    const run59 = await call("/api/integrations/apple-health/workouts", {
      token: dev.token,
      body: {
        schemaVersion: 1,
        captureMethod: "workout",
        externalWorkoutId: "mcp_run_59",
        activityType: "running",
        environment: "outdoor",
        startedAt: `${yest59}T06:00:00+08:00`,
        endedAt: `${yest59}T06:30:00+08:00`,
        durationSeconds: 1800,
        durationKind: "workout_active",
        distanceMeters: 5000,
      },
    });
    assert.equal(run59.status, 201);
    const stats = getStats(store, userA.userId, yest59);
    assert.equal(stats.appleActivities.length, 1);
    assert.equal(stats.trainingSummary.totalActivities, 1);

    // #69: flushQueue signals transientFailure: true on 503 so useUiStore schedules bounded backoff retry
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v); },
      removeItem: (k: string) => { mem.delete(k); },
    };
    storage.setItem(
      "ironlog-offline-queue:u1",
      JSON.stringify([{ opId: "op503", path: "/api/records", method: "POST", body: {} }]),
    );
    const flushRes = await flushQueue(storage, "u1", async () => {
      throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    });
    assert.equal(flushRes.transientFailure, true);
    assert.equal(flushRes.remaining, 1);

    // #71: copyDietBatch detects template change after failed copy (310 kcal -> 450 kcal) and throws DietCopyMismatchError!
    let shouldFail = true;
    await assert.rejects(() =>
      copyDietBatch({
        userId: "u1",
        intent: "template:tpl1:lunch",
        date: today,
        meal: "lunch",
        foods: [{ name: "旧餐单", calories: 310, protein: 30, carbs: 30, fat: 8 }],
        storage,
        send: async () => {
          if (shouldFail) throw new Error("network error");
          return { results: [] };
        },
      }),
    );
    shouldFail = false;
    await assert.rejects(
      () =>
        copyDietBatch({
          userId: "u1",
          intent: "template:tpl1:lunch",
          date: today,
          meal: "lunch",
          detectSourceChange: true,
          foods: [{ name: "新餐单", calories: 450, protein: 40, carbs: 45, fat: 12 }],
          storage,
          send: async (b) => ({ results: b.mutations.map((m) => ({ opId: m.opId, status: "applied" as const, record: null })) }),
        }),
      (err: unknown) => err instanceof DietCopyMismatchError && err.pendingSummary.calories === 310 && err.newSummary.calories === 450,
    );
    // Explicit replace-with-new writes the updated 450 kcal content
    let sentCalories = 0;
    const count = await copyDietBatch({
      userId: "u1",
      intent: "template:tpl1:lunch",
      date: today,
      meal: "lunch",
      foods: [{ name: "新餐单", calories: 450, protein: 40, carbs: 45, fat: 12 }],
      mode: "replace-with-new",
      storage,
      send: async (b) => {
        sentCalories = (b.mutations[0]!.data as { calories: number }).calories;
        return { results: b.mutations.map((m) => ({ opId: m.opId, status: "applied" as const, record: null })) };
      },
    });
    assert.equal(count, 1);
    assert.equal(sentCalories, 450);

    // Static guards for #60, #67, #68, #70, #74, #26-#28, #54
    const viteCfg = readFileSync("packages/web/vite.config.ts", "utf8");
    assert.match(viteCfg, /sameOrigin && \/\^\\\/app\\\//);
    assert.match(viteCfg, /sameOrigin && \/\^\\\/media\\\/exercises\\\//);

    const reportModal = readFileSync("packages/web/src/components/workout/WorkoutReportModal.tsx", "utf8");
    assert.match(reportModal, /rowUnit \? \{ weightUnit: rowUnit \}/);

    const editorModal = readFileSync("packages/web/src/components/workout/WorkoutEditorModal.tsx", "utf8");
    assert.match(editorModal, /staleDraftConflict/);
    assert.match(editorModal, /pendingSaveOpRef/);
    assert.match(editorModal, /unitOriginRef/);
    assert.match(editorModal, /durationEdited/);
    assert.match(editorModal, /exerciseRowId: row\.id/);

    const uiStore = readFileSync("packages/web/src/store/useUiStore.ts", "utf8");
    assert.match(uiStore, /flushingAccounts/);
    assert.match(uiStore, /OFFLINE_RETRY_DELAYS_MS/);

    const liveBar = readFileSync("packages/web/src/components/LiveWorkoutBar.tsx", "utf8");
    assert.match(liveBar, /waitedMs > 90_000 && Date\.now\(\) - lastCheckedAt < 20_000/);
  } finally {
    db.close();
  }
});
