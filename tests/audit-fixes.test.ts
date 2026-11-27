import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  computeFitCrc,
  encodeWorkoutToFit,
  evaluateExerciseProgression,
  localDate,
  nextTarget,
  projectScheduleRange,
  resolveFitDurationSeconds,
  resolveRoutineWithTelemetry,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { mountWebAssets } from "../packages/server/src/web-assets.js";
import { upsertDailyHealth } from "../packages/server/src/apple-health-daily.js";
import { projectAppleTraining } from "../packages/server/src/apple-training-agenda.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import {
  getWebRoutine,
  getWebSchedule,
  saveWebScheduleDay,
  shiftWebScheduleDay,
  syncWorkoutRoutineToActivePlan,
} from "../packages/server/src/web-training.js";
import { getWebWorkoutReport } from "../packages/server/src/web-workout-report.js";
import { deliverWebhookEvent, isPrivateWebhookUrl, validateWebhookTarget } from "../packages/server/src/webhook.js";
import { parseHashView } from "../packages/web/src/lib/routes.js";
import { viewLoaders } from "../packages/web/src/lib/prefetch.js";

function makeCtx(appConfig: Parameters<typeof createApp>[1] = {}) {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db, appConfig);
  const user = auth.login("audit-user");
  const other = auth.login("audit-other");
  const call = (
    url: string,
    options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token === "" ? {} : { Authorization: `Bearer ${options.token ?? user.token}` }),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  return { db, app, store, user, other, call };
}

function shiftDay(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

test("#01 同名独立模板训练回写只更新模板，不篡改同名生效计划", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const sharedTitle = "推 · 上肢推";

    // Create & apply active plan with 3-set bench press routine named sharedTitle
    const planRes = store.mutate(user.userId, {
      opId: "plan-create-1",
      id: "plan_1",
      kind: "plan",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "plan_1",
        name: "PPL 计划",
        weeks: 4,
        rationale: "PPL 回归测试计划",
        schedule: "rotation",
        weekdays: [],
        routines: [
          {
            id: "rt_plan_push",
            name: sharedTitle,
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
              },
            ],
          },
        ],
      },
    });
    assert.equal(planRes.status, "applied");
    store.applyPlan(user.userId, "plan_1", planRes.record!.version, 0, false);

    // Create standalone template with identical name and 2 sets
    const tplRes = store.mutate(user.userId, {
      opId: "tpl-create-1",
      id: "tpl_same_name",
      kind: "template",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "tpl_same_name",
        name: sharedTitle,
        exercises: [
          {
            exerciseId: "bench-press",
            sets: 2,
            repsMin: 8,
            repsMax: 12,
            weight: 60,
            seconds: 0,
            restSeconds: 90,
            targetRir: 2,
            progression: "double",
            increment: 2.5,
          },
        ],
      },
    });
    assert.equal(tplRes.status, "applied");

    // Workout launched from standalone template: planId=null, routineId="tpl_same_name", completed 4 sets
    store.mutate(user.userId, {
      opId: "wo-from-tpl",
      id: "wo_tpl_4sets",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: sharedTitle,
        date: today,
        startedAt: `${today}T09:00:00Z`,
        endedAt: `${today}T09:40:00Z`,
        status: "completed",
        planId: null,
        planVersion: null,
        routineId: "tpl_same_name",
        exercises: [
          {
            id: "exrow_1",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: Array.from({ length: 4 }, (_, i) => ({
              id: `s_${i}`,
              type: "normal",
              weight: 60,
              reps: 10,
              seconds: 0,
              completed: true,
              rir: 2,
            })),
          },
        ],
      },
    });

    const report = getWebWorkoutReport(store, user.userId, "wo_tpl_4sets");
    assert.equal(report.canSyncToActivePlan, false);

    const synced = syncWorkoutRoutineToActivePlan(store, user.userId, { workoutId: "wo_tpl_4sets" });
    assert.equal(synced.syncedKind, "template");

    const tplAfter = store.get(user.userId, "template", "tpl_same_name")!.data as { exercises: Array<{ sets: number }> };
    const planAfter = store.activePlan(user.userId)!.data;
    assert.equal(tplAfter.exercises[0]!.sets, 4);
    assert.equal(planAfter.routines[0]!.exercises[0]!.sets, 3);
  } finally {
    db.close();
  }
});

test("#02 Apple 健康补传不覆盖同日较新称重、手工体脂与已删除体重记录", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const dPrev = shiftDay(today, -1);

    // 1) Sync 09:00 72kg, then backfill older 07:00 74kg on same day -> stays 72kg
    upsertDailyHealth(store, user.userId, {
      date: dPrev,
      weightKg: 72,
      weightMeasuredAt: `${dPrev}T09:00:00+08:00`,
      occurredAt: `${dPrev}T09:05:00+08:00`,
    });
    const w0 = store.get(user.userId, "weight", `weight_${dPrev}`)!;
    assert.equal((w0.data as { weight: number }).weight, 72);

    upsertDailyHealth(store, user.userId, {
      date: dPrev,
      weightKg: 74,
      weightMeasuredAt: `${dPrev}T07:00:00+08:00`,
      occurredAt: `${dPrev}T07:05:00+08:00`,
    });
    const wAfterBackfill = store.get(user.userId, "weight", `weight_${dPrev}`)!;
    assert.equal((wAfterBackfill.data as { weight: number }).weight, 72);

    // 2) Manual bodyFat 22% must not be overwritten by later Apple sync 16.5%
    store.mutate(user.userId, {
      opId: "manual-fat-1",
      id: `weight_${dPrev}`,
      kind: "weight",
      baseVersion: wAfterBackfill.version,
      deleted: false,
      data: { date: dPrev, weight: 72, bodyFat: 22 },
    });
    const newerSync = upsertDailyHealth(store, user.userId, {
      date: dPrev,
      weightKg: 71.8,
      weightMeasuredAt: `${dPrev}T18:00:00+08:00`,
      bodyFatPct: 16.5,
      bodyFatMeasuredAt: `${dPrev}T18:00:00+08:00`,
      occurredAt: `${dPrev}T18:05:00+08:00`,
    });
    assert.equal(newerSync.weightSynced, true);
    const wAfterFatSync = store.get(user.userId, "weight", `weight_${dPrev}`)!;
    assert.equal((wAfterFatSync.data as { weight: number; bodyFat: number | null }).weight, 71.8);
    assert.equal((wAfterFatSync.data as { weight: number; bodyFat: number | null }).bodyFat, 22);

    // 3) User deletes weight record -> next Apple sync must NOT recreate deleted record
    store.mutate(user.userId, {
      opId: "delete-weight-1",
      id: `weight_${dPrev}`,
      kind: "weight",
      baseVersion: wAfterFatSync.version,
      deleted: true,
      data: wAfterFatSync.data,
    });
    upsertDailyHealth(store, user.userId, {
      date: dPrev,
      weightKg: 71.5,
      weightMeasuredAt: `${dPrev}T21:00:00+08:00`,
      occurredAt: `${dPrev}T21:05:00+08:00`,
    });
    const deletedRec = store.get(user.userId, "weight", `weight_${dPrev}`);
    assert.equal(deletedRec?.deleted, true);

    // 4) User manually clears synced bodyFat to null -> subsequent Apple sync must respect clear
    const dPrev2 = shiftDay(today, -2);
    upsertDailyHealth(store, user.userId, {
      date: dPrev2,
      weightKg: 70,
      weightMeasuredAt: `${dPrev2}T08:00:00+08:00`,
      bodyFatPct: 18,
      bodyFatMeasuredAt: `${dPrev2}T08:00:00+08:00`,
      occurredAt: `${dPrev2}T08:05:00+08:00`,
    });
    const syncedRec = store.get(user.userId, "weight", `weight_${dPrev2}`)!;
    assert.equal((syncedRec.data as { bodyFat: number | null }).bodyFat, 18);

    store.mutate(user.userId, {
      opId: "manual-clear-bf-1",
      id: `weight_${dPrev2}`,
      kind: "weight",
      baseVersion: syncedRec.version,
      deleted: false,
      data: { date: dPrev2, weight: 70, bodyFat: null },
    });
    upsertDailyHealth(store, user.userId, {
      date: dPrev2,
      weightKg: 70,
      weightMeasuredAt: `${dPrev2}T20:00:00+08:00`,
      bodyFatPct: 19,
      bodyFatMeasuredAt: `${dPrev2}T20:00:00+08:00`,
      occurredAt: `${dPrev2}T20:05:00+08:00`,
    });
    const afterManualClearBf = store.get(user.userId, "weight", `weight_${dPrev2}`)!;
    assert.equal((afterManualClearBf.data as { bodyFat: number | null }).bodyFat, null);
  } finally {
    db.close();
  }
});

test("#03 CSV 导入支持同日不同时间第二场同名训练，精确识别同源重复与缺时间疑似重复", async () => {
  const { db, store, user, call } = makeCtx();
  try {
    const day = shiftDay(localDate(), -2);
    // Existing 08:00 workout in account
    store.mutate(user.userId, {
      opId: "wo-morning",
      id: "wo_morning_1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "胸背训练",
        date: day,
        startedAt: `${day}T08:00:00.000Z`,
        endedAt: `${day}T08:45:00.000Z`,
        status: "completed",
        exercises: [
          {
            id: "r1",
            exerciseId: "bench-press",
            restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });

    // Ironlog CSV containing an evening 18:00 workout with IDENTICAL title & exercise
    const eveningCsv = [
      "日期,训练标题,时长(分钟),体感,动作,超级组,组号,组类型,重量(kg),次数,时长(秒),RIR,已完成,容量(kg),开始时间,训练ID",
      `${day},胸背训练,40,均衡,平板杠铃卧推,,1,常规,80,8,0,2,是,640,${day}T18:00:00.000Z,ext_evening_1`,
    ].join("\n");

    const previewRes = await (await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: eveningCsv, skipDuplicates: true },
    })).json() as { importableWorkouts: number; duplicateWorkouts: number; suspectedDuplicateWorkouts: number };
    assert.equal(previewRes.duplicateWorkouts, 0);
    assert.equal(previewRes.suspectedDuplicateWorkouts, 0);
    assert.equal(previewRes.importableWorkouts, 1);

    const commitRes = await (await call("/api/web/import-csv/commit", {
      method: "POST",
      body: { csv: eveningCsv, skipDuplicates: true },
    })).json() as { importedWorkouts: number };
    assert.equal(commitRes.importedWorkouts, 1);
    assert.equal(store.list(user.userId, "workout").length, 2);

    // Exported CSV includes 训练ID column for lossless re-import deduplication
    const exportedText = await (await call("/api/web/export-csv/workouts")).text();
    assert.match(exportedText, /训练ID/);

    // Re-importing exact same CSV (matches sourceSessionId / timestamp) is skipped
    const rePreview = await (await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: eveningCsv, skipDuplicates: true },
    })).json() as { importableWorkouts: number; duplicateWorkouts: number };
    assert.equal(rePreview.duplicateWorkouts, 1);
    assert.equal(rePreview.importableWorkouts, 0);

    // Missing start time on FitNotes CSV on same day with same exercise -> marked suspected
    const fitNotesNoTimeCsv = [
      "Date,Exercise,Category,Weight,Reps,Time,Comment",
      `${day},Bench Press (Barbell),Chest,70,10,,date-only session`,
    ].join("\n");
    const fnPreview = await (await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: fitNotesNoTimeCsv, skipDuplicates: true },
    })).json() as { importableWorkouts: number; suspectedDuplicateWorkouts: number };
    assert.equal(fnPreview.suspectedDuplicateWorkouts, 1);
    assert.equal(fnPreview.importableWorkouts, 0);

    const fnIncludePreview = await (await call("/api/web/import-csv/preview", {
      method: "POST",
      body: { csv: fitNotesNoTimeCsv, skipDuplicates: true, includeSuspectedDuplicates: true },
    })).json() as { importableWorkouts: number; suspectedDuplicateWorkouts: number };
    assert.equal(fnIncludePreview.suspectedDuplicateWorkouts, 1);
    assert.equal(fnIncludePreview.importableWorkouts, 1);
  } finally {
    db.close();
  }
});

test("#04 Apple 力量训练在手动休息日保留为独立活动，不误补签原计划", () => {
  const { db, store, user } = makeCtx();
  try {
    const today = localDate();
    const wd = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
    const planRes = store.mutate(user.userId, {
      opId: "p-weekday",
      id: "plan_wd",
      kind: "plan",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "plan_wd",
        name: "星期固定计划",
        weeks: 4,
        rationale: "休息日覆写回归测试计划",
        schedule: "weekdays",
        weekdays: [wd],
        routines: [
          {
            id: "rt_wd_push",
            name: "推日抗阻",
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
              },
            ],
          },
        ],
      },
    });
    store.applyPlan(user.userId, "plan_wd", planRes.record!.version, 0, false);

    // Manually override today to a rest day
    saveWebScheduleDay(store, user.userId, today, {
      mode: "rest",
      title: "手动休息",
      planId: null,
      routineId: null,
      templateId: null,
      notes: "临时休息",
      exercises: [],
    });

    // Upload Apple TraditionalStrengthTraining on that rest day
    db.prepare(
      `INSERT INTO apple_health_workouts (id, user_id, identity_key, ended_at, received_at, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "aw_rest_strength",
      user.userId,
      "id_rest_strength",
      `${today}T10:50:00+08:00`,
      new Date().toISOString(),
      JSON.stringify({
        externalWorkoutId: "ext_rest_1",
        activityType: "HKWorkoutActivityTypeTraditionalStrengthTraining",
        environment: "indoor",
        captureMethod: "workout",
        startedAt: `${today}T10:00:00+08:00`,
        endedAt: `${today}T10:50:00+08:00`,
        durationSeconds: 3000,
        durationKind: "workout_active",
        activeEnergyKcal: 280,
        energyKind: "workout",
        annotation: {},
      }),
    );

    const projected = projectAppleTraining(store, user.userId, today);
    assert.equal(projected.entries.length, 1);
    assert.equal(projected.entries[0]!.plan, null);

    const schedule = getWebSchedule(store, user.userId, { from: today, through: today });
    assert.equal(schedule.days[0]!.status, "rest");
    assert.equal(schedule.days[0]!.source, "rest");

    // Also test projectScheduleRange directly when manual rest override + unmatched Apple activity exist
    const rangeDays = projectScheduleRange({
      from: today,
      through: today,
      todayDate: today,
      workouts: [],
      appleActivities: [{ date: today, title: "传统力量训练", manualWorkoutId: null, plan: null }],
      scheduledDays: new Map([[today, { date: today, mode: "rest", title: "手动休息", planId: null, routineId: null, templateId: null, notes: "", exercises: [] }]]),
      activePlan: store.activePlan(user.userId),
      catalogue: store.catalogueMap(user.userId),
    });
    assert.equal(rangeDays[0]!.status, "rest");

    // 5) Plan deferral via shiftWebScheduleDay: Push (shiftDay1) shifted to shiftDay2 (which originally had Pull)
    const shiftDay1 = shiftDay(today, 2);
    const shiftDay2 = shiftDay(today, 3);
    const wdShift1 = new Date(`${shiftDay1}T00:00:00Z`).getUTCDay() || 7;
    const wdShift2 = new Date(`${shiftDay2}T00:00:00Z`).getUTCDay() || 7;
    const activeBeforeShift = store.activePlan(user.userId)!;
    const shiftPlanRes = store.mutate(user.userId, {
      opId: "p-weekday-shift",
      id: "plan_wd",
      kind: "plan",
      baseVersion: activeBeforeShift.version,
      deleted: false,
      data: {
        ...activeBeforeShift.data,
        weekdays: [wdShift1, wdShift2],
        routines: [
          activeBeforeShift.data.routines[0]!,
          {
            id: "rt_wd_pull",
            name: "拉日抗阻",
            exercises: [
              {
                exerciseId: "barbell-row",
                sets: 3,
                repsMin: 8,
                repsMax: 12,
                weight: 60,
                seconds: 0,
                restSeconds: 90,
                targetRir: 2,
                progression: "double",
                increment: 2.5,
              },
            ],
          },
        ],
      },
    });
    store.applyPlan(user.userId, "plan_wd", shiftPlanRes.record!.version, activeBeforeShift.revision, false);

    shiftWebScheduleDay(store, user.userId, { fromDate: shiftDay1, toDate: shiftDay2 });

    const insertAppleStrength = (id: string, extId: string, day: string) => {
      db.prepare(
        `INSERT INTO apple_health_workouts (id, user_id, identity_key, ended_at, received_at, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        user.userId,
        `id_${id}`,
        `${day}T11:50:00+08:00`,
        new Date().toISOString(),
        JSON.stringify({
          externalWorkoutId: extId,
          activityType: "HKWorkoutActivityTypeTraditionalStrengthTraining",
          environment: "indoor",
          captureMethod: "workout",
          startedAt: `${day}T11:00:00+08:00`,
          endedAt: `${day}T11:50:00+08:00`,
          durationSeconds: 3000,
          durationKind: "workout_active",
          activeEnergyKcal: 300,
          energyKind: "workout",
          annotation: {},
        }),
      );
    };
    insertAppleStrength("aw_shifted_day1", "ext_shifted_1", shiftDay1);
    insertAppleStrength("aw_shifted_day2", "ext_shifted_2", shiftDay2);

    const shiftedProjected = projectAppleTraining(store, user.userId, shiftDay2);
    const day1Entry = shiftedProjected.entries.find((e) => e.date === shiftDay1)!;
    const day2Entry = shiftedProjected.entries.find((e) => e.date === shiftDay2)!;
    assert.equal(day1Entry.plan, null);
    assert.equal(day2Entry.plan?.routineId, "rt_wd_push");

    const scheduleAfterShift = getWebSchedule(store, user.userId, { from: shiftDay1, through: shiftDay2 });
    assert.equal(scheduleAfterShift.days[0]!.status, "rest");
  } finally {
    db.close();
  }
});

test("#06 & #07 饮水增量支持 opId 幂等重试；手动清零饮水不被相同 Apple 样本重新恢复", async () => {
  const { db, store, user, call } = makeCtx();
  try {
    const today = localDate();

    // #06 Same opId retried -> remains 250 ml (not 500 ml)
    const w1 = await call("/api/web/water", { method: "POST", body: { date: today, deltaMl: 250, opId: "water-retry-1" } });
    assert.equal(w1.status, 200);
    assert.equal(((await w1.json()) as { waterMl: number }).waterMl, 250);

    const w2 = await call("/api/web/water", { method: "POST", body: { date: today, deltaMl: 250, opId: "water-retry-1" } });
    assert.equal(w2.status, 200);
    assert.equal(((await w2.json()) as { waterMl: number }).waterMl, 250);

    // Same opId with conflicting payload returns 409
    const wConflict = await call("/api/web/water", { method: "POST", body: { date: today, deltaMl: 500, opId: "water-retry-1" } });
    assert.equal(wConflict.status, 409);

    // #07 On a clean day: Upload Apple 600ml -> user clears to 0 -> re-upload same 600ml stays 0 -> newer 850ml adds +250ml
    const appleDay = shiftDay(today, -1);
    const t1 = new Date(Date.now() - 120_000).toISOString();
    upsertDailyHealth(store, user.userId, { date: appleDay, waterMl: 600, occurredAt: t1 });
    const afterClear = await (await call("/api/web/water", {
      method: "POST",
      body: { date: appleDay, setMl: 0, opId: "water-clear-1" },
    })).json() as { waterMl: number };
    assert.equal(afterClear.waterMl, 0);

    const t2 = new Date(Date.now() + 60_000).toISOString();
    const resame = upsertDailyHealth(store, user.userId, { date: appleDay, waterMl: 600, occurredAt: t2 });
    assert.equal(resame.daily.waterMl, 0);

    const t3 = new Date(Date.now() + 120_000).toISOString();
    const newerDrink = upsertDailyHealth(store, user.userId, { date: appleDay, waterMl: 850, occurredAt: t3 });
    assert.equal(newerDrink.daily.waterMl, 250);
  } finally {
    db.close();
  }
});

test("#08 排期保存按 opId 幂等重放回执并返回 200，过时不同操作仍返 409", async () => {
  const { db, call } = makeCtx();
  try {
    const targetDate = shiftDay(localDate(), 2);
    const body = {
      mode: "rest" as const,
      title: "主动恢复",
      planId: null,
      routineId: null,
      templateId: null,
      notes: "散步拉伸",
      exercises: [],
      opId: "sched-op-retry-1",
      baseVersion: 0,
    };

    const r1 = await call(`/api/web/schedule/${targetDate}`, { method: "PUT", body });
    assert.equal(r1.status, 200);

    const r2 = await call(`/api/web/schedule/${targetDate}`, { method: "PUT", body });
    assert.equal(r2.status, 200);

    // Different opId with stale baseVersion 0 returns 409 conflict
    const rStale = await call(`/api/web/schedule/${targetDate}`, {
      method: "PUT",
      body: { ...body, opId: "sched-op-other-2", title: "改名", baseVersion: 0 },
    });
    assert.equal(rStale.status, 409);

    // Same opId reused for modified payload returns 409
    const rReuse = await call(`/api/web/schedule/${targetDate}`, {
      method: "PUT",
      body: { ...body, title: "篡改内容" },
    });
    assert.equal(rReuse.status, 409);
  } finally {
    db.close();
  }
});

test("#09 辅助动作按磅(lb)与公斤(kg)等价记录时产生一致的统计负荷", () => {
  const { db, store, user } = makeCtx();
  try {
    const d1 = shiftDay(localDate(), -3);
    const d2 = shiftDay(localDate(), -1);
    const assistedEx = [...store.catalogueMap(user.userId).values()].find((e) => e.mode === "assisted");
    assert.ok(assistedEx, "Catalogue must have an assisted exercise");

    // Set 75kg body weight
    store.mutate(user.userId, {
      opId: "wt-1",
      id: `weight_${d1}`,
      kind: "weight",
      baseVersion: 0,
      deleted: false,
      data: { date: d1, weight: 75, bodyFat: null },
    });

    // Session 1: 25 kg assistance x 10 reps -> effective load = (75 - 25) * 10 = 500
    store.mutate(user.userId, {
      opId: "w-assist-kg",
      id: "w_assist_kg",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "辅助 kg",
        date: d1,
        startedAt: `${d1}T10:00:00Z`,
        endedAt: `${d1}T10:30:00Z`,
        status: "completed",
        exercises: [
          {
            id: "row_kg",
            exerciseId: assistedEx.id,
            weightUnit: "kg",
            restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 25, reps: 10, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });

    // Session 2: 55.1 lb assistance (~25 kg) x 10 reps
    store.mutate(user.userId, {
      opId: "w-assist-lb",
      id: "w_assist_lb",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "辅助 lb",
        date: d2,
        startedAt: `${d2}T10:00:00Z`,
        endedAt: `${d2}T10:30:00Z`,
        status: "completed",
        exercises: [
          {
            id: "row_lb",
            exerciseId: assistedEx.id,
            weightUnit: "lb",
            restSeconds: 90,
            sets: [{ id: "s2", type: "normal", weight: 55.1, reps: 10, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });

    const analytics = getWebAnalytics(store, user.userId, { period: 30, through: localDate() });
    const day1 = analytics.acwr.series.find((d) => d.date === d1)!;
    const day2 = analytics.acwr.series.find((d) => d.date === d2)!;
    const expectedLoad = Math.round(50 * 10 * assistedEx.volumeMultiplier);
    assert.equal(day1.load, expectedLoad);
    assert.ok(Math.abs(day2.load - day1.load) <= 10, `Expected lb load (${day2.load}) ~= kg load (${day1.load})`);
  } finally {
    db.close();
  }
});

test("#10 训练预览与渐进目标统一换算 lb 历史重量到目标单位并保留单位标签", () => {
  const { db, store, user } = makeCtx();
  try {
    const prevDate = shiftDay(localDate(), -2);
    const today = localDate();

    // History logged 135 lb x 10
    store.mutate(user.userId, {
      opId: "wo-lb-hist",
      id: "wo_lb_hist",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "卧推 lb",
        date: prevDate,
        startedAt: `${prevDate}T10:00:00Z`,
        endedAt: `${prevDate}T10:40:00Z`,
        status: "completed",
        exercises: [
          {
            id: "ex_lb",
            exerciseId: "bench-press",
            weightUnit: "lb",
            restSeconds: 90,
            sets: [
              { id: "s1", type: "normal", weight: 135, reps: 10, seconds: 0, completed: true, rir: 2 },
            ],
          },
        ],
      },
    });

    // Template using kg
    store.mutate(user.userId, {
      opId: "tpl-kg-1",
      id: "tpl_kg_target",
      kind: "template",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "tpl_kg_target",
        name: "公斤模板",
        exercises: [
          {
            exerciseId: "bench-press",
            sets: 3,
            repsMin: 8,
            repsMax: 12,
            weight: null,
            seconds: 0,
            restSeconds: 90,
            targetRir: 2,
            progression: "double",
            increment: 2.5,
            weightUnit: "kg",
          },
        ],
      },
    });

    const preview = getWebRoutine(store, user.userId, { id: "tpl_kg_target", source: "template", date: today });
    const row = preview.exercises[0]!;
    assert.ok(row.lastTop);
    assert.equal(row.lastTop.weightUnit, "kg");
    assert.equal(row.lastTop.originalWeight, 135);
    assert.equal(row.lastTop.originalUnit, "lb");
    assert.ok(row.lastTop.weight > 60 && row.lastTop.weight < 62, `Expected ~61.23kg, got ${row.lastTop.weight}`);
    assert.ok(row.weight > 60 && row.weight < 62, `Expected target weight converted from 135 lb, got ${row.weight}`);

    // Progression helper with lb target reads lb text and converts kg history to lb
    const nextRes = nextTarget(
      {
        exerciseId: "bench-press",
        sets: 1,
        repsMin: 8,
        repsMax: 10,
        weight: null,
        seconds: 0,
        restSeconds: 90,
        targetRir: 2,
        progression: "double",
        increment: 5,
        weightUnit: "lb",
      },
      {
        id: "r_kg",
        exerciseId: "bench-press",
        restSeconds: 90,
        weightUnit: "kg",
        sets: [{ id: "s1", type: "normal", weight: 60, reps: 10, seconds: 0, completed: true, rir: 2 }],
      },
      "reps",
    );
    // 60kg -> 132.3 lb + 5 lb = 137.3 lb
    assert.ok(nextRes.weight > 136 && nextRes.weight < 139, `Expected ~137.3 lb, got ${nextRes.weight}`);
    const prog = evaluateExerciseProgression(
      {
        exerciseId: "bench-press",
        sets: 1,
        repsMin: 8,
        repsMax: 10,
        weight: null,
        seconds: 0,
        restSeconds: 90,
        targetRir: 2,
        progression: "double",
        increment: 5,
        weightUnit: "lb",
      },
      undefined,
      undefined,
      [],
      "reps",
    );
    assert.match(prog.statusLabel, /初始/);
    assert.match(prog.ruleLabel, /\+5lb/);
    assert.doesNotMatch(prog.ruleLabel, /kg/);
    assert.match(prog.forecast, /lb/);

    // Historical 100 kg bench press PR baseline vs 135 lb (~61.2 kg) target must NOT falsely trigger PR break
    const heavyKgDate = shiftDay(today, -1);
    store.mutate(user.userId, {
      opId: "wo-kg-100-pr",
      id: "wo_kg_100_pr",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "大重量卧推 kg",
        date: heavyKgDate,
        startedAt: `${heavyKgDate}T10:00:00Z`,
        endedAt: `${heavyKgDate}T10:40:00Z`,
        status: "completed",
        exercises: [
          {
            id: "ex_kg_pr",
            exerciseId: "bench-press",
            weightUnit: "kg",
            restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 100, reps: 10, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });
    const telemetry = resolveRoutineWithTelemetry({
      routine: {
        id: "rt_lb_pr_check",
        name: "磅数卧推校验",
        exercises: [
          {
            exerciseId: "bench-press",
            sets: 3,
            repsMin: 8,
            repsMax: 10,
            weight: 135,
            seconds: 0,
            restSeconds: 90,
            targetRir: 2,
            progression: "double",
            increment: 5,
            weightUnit: "lb",
          },
        ],
      },
      planId: null,
      date: today,
      workouts: store.list(user.userId, "workout").map((r) => r.data as Parameters<typeof resolveRoutineWithTelemetry>[0]["workouts"][number]),
      catalogue: store.catalogueMap(user.userId),
    });
    const prKind = telemetry.exercises[0]!.pr?.kind;
    assert.notEqual(prKind, "will_break_1rm");
    assert.notEqual(prKind, "will_break_weight");
  } finally {
    db.close();
  }
});

test("#11 FIT 导出拒绝时长缺失训练，不伪造热量与焦耳并按 Developer Data 保留容量", () => {
  // Missing / unknown / equal start=end durations must be rejected
  assert.equal(resolveFitDurationSeconds({ title: "t", date: "2026-11-27", startedAt: "2026-11-27T10:00:00Z", endedAt: null }), null);
  assert.equal(resolveFitDurationSeconds({ title: "t", date: "2026-11-27", startedAt: "2026-11-27T10:00:00Z", endedAt: "2026-11-27T10:00:00Z" }), null);
  assert.equal(resolveFitDurationSeconds({ title: "t", date: "2026-11-27", durationSeconds: 1800, durationUnknown: true }), null);
  assert.throws(() => encodeWorkoutToFit({ title: "t", date: "2026-11-27", startedAt: "2026-11-27T10:00:00Z", endedAt: null }));
  assert.throws(() => encodeWorkoutToFit({ title: "t", date: "2026-11-27", startedAt: "2026-11-27T10:00:00Z", endedAt: "2026-11-27T10:00:00Z" }));

  // Valid duration without measured calories/work -> omits field 11 & field 48, writes developer field for 500 kg
  const bytes = encodeWorkoutToFit({
    title: "测试导出",
    date: "2026-11-27",
    startedAt: "2026-11-27T10:00:00Z",
    durationSeconds: 3000,
    totalSets: 5,
    totalVolumeKg: 500,
  });
  const dataSize = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24);
  assert.equal(bytes[12]! | (bytes[13]! << 8), computeFitCrc(bytes, 0, 12));
  assert.equal(bytes[bytes.length - 2]! | (bytes[bytes.length - 1]! << 8), computeFitCrc(bytes, 0, bytes.length - 2));

  // Walk binary FIT messages to verify Session(18) exact fields & developer field value
  const defs = new Map<number, { globalNum: number; fields: Array<{ num: number; size: number }>; devFields: Array<{ num: number; size: number }> }>();
  let pos = 14;
  const end = 14 + dataSize;
  let sessionStdNums: number[] = [];
  let sessionDevVals: number[] = [];
  let sessionElapsedMs = 0;

  while (pos < end) {
    const hdr = bytes[pos++]!;
    const isDef = (hdr & 0x40) !== 0;
    const hasDev = (hdr & 0x20) !== 0;
    const localNum = hdr & 0x0f;
    if (isDef) {
      pos++; // reserved
      pos++; // arch
      const globalNum = bytes[pos]! | (bytes[pos + 1]! << 8);
      pos += 2;
      const numFields = bytes[pos++]!;
      const fields: Array<{ num: number; size: number }> = [];
      for (let i = 0; i < numFields; i++) {
        const num = bytes[pos++]!;
        const size = bytes[pos++]!;
        pos++; // base_type
        fields.push({ num, size });
      }
      const devFields: Array<{ num: number; size: number }> = [];
      if (hasDev) {
        const numDev = bytes[pos++]!;
        for (let i = 0; i < numDev; i++) {
          const num = bytes[pos++]!;
          const size = bytes[pos++]!;
          pos++; // dev_data_index
          devFields.push({ num, size });
        }
      }
      defs.set(localNum, { globalNum, fields, devFields });
    } else {
      const def = defs.get(localNum)!;
      const readU32 = (off: number) =>
        (bytes[off]! | (bytes[off + 1]! << 8) | (bytes[off + 2]! << 16) | (bytes[off + 3]! << 24)) >>> 0;
      const fieldValues = new Map<number, number>();
      for (const f of def.fields) {
        if (f.size === 4) fieldValues.set(f.num, readU32(pos));
        pos += f.size;
      }
      const devVals: number[] = [];
      for (const df of def.devFields) {
        if (df.size === 4) devVals.push(readU32(pos));
        pos += df.size;
      }
      if (def.globalNum === 18) {
        sessionStdNums = def.fields.map((f) => f.num);
        sessionElapsedMs = fieldValues.get(7) ?? 0;
        sessionDevVals = devVals;
      }
    }
  }

  assert.equal(sessionElapsedMs, 3_000_000);
  assert.equal(sessionStdNums.includes(11), false, "Must omit unmeasured total_calories (11)");
  assert.equal(sessionStdNums.includes(48), false, "Must omit unmeasured total_work (48)");
  assert.deepEqual(sessionDevVals, [5000]); // 500.0 kg scaled ×10
});

test("#12 保留字或无效路由 Hash 安全降级为首页，不接受原型继承属性", () => {
  assert.equal(parseHashView("#toString"), "overview");
  assert.equal(parseHashView("#constructor"), "overview");
  assert.equal(parseHashView("#__proto__"), "overview");
  assert.equal(parseHashView("#unknown_route"), "overview");
  assert.equal(parseHashView("#workout"), "workout");
  assert.equal(Object.hasOwn(viewLoaders, "toString"), false);
  assert.equal(Object.hasOwn(viewLoaders, "constructor"), false);
});

test("#13 Accept-Encoding: identity, gzip;q=0 时不返回 gzip 压缩体", async () => {
  const { db, app, call } = makeCtx();
  mountWebAssets(app);
  try {
    // 1) Builtin catalogue endpoint
    const catRes = await call("/api/exercises?builtin=1", {
      headers: { "Accept-Encoding": "identity, gzip;q=0" },
    });
    assert.equal(catRes.status, 200);
    assert.equal(catRes.headers.get("content-encoding"), null);
    assert.match(catRes.headers.get("vary") ?? "", /Accept-Encoding/i);
    const etag = catRes.headers.get("etag");
    assert.ok(etag);
    const catJson = await catRes.json() as { exercises: unknown[] };
    assert.ok(Array.isArray(catJson.exercises) && catJson.exercises.length > 0);

    // 304 Not Modified response also carries Vary: Accept-Encoding
    const cat304 = await call("/api/exercises?builtin=1", {
      headers: { "If-None-Match": etag! },
    });
    assert.equal(cat304.status, 304);
    assert.match(cat304.headers.get("vary") ?? "", /Accept-Encoding/i);

    // Wildcard q=0 rejects gzip
    const catWildcardZero = await call("/api/exercises?builtin=1", {
      headers: { "Accept-Encoding": "*;q=0" },
    });
    assert.equal(catWildcardZero.status, 200);
    assert.equal(catWildcardZero.headers.get("content-encoding"), null);

    // Explicitly accepting gzip returns gzip
    const catGz = await call("/api/exercises?builtin=1", {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });
    assert.equal(catGz.headers.get("content-encoding"), "gzip");
    const unzipped = JSON.parse(gunzipSync(new Uint8Array(await catGz.arrayBuffer())).toString("utf8")) as { exercises: unknown[] };
    assert.equal(unzipped.exercises.length, catJson.exercises.length);

    // 2) JSON API middleware (>1KB statistics response)
    const statsDeclined = await call("/api/web/statistics", {
      headers: { "Accept-Encoding": "identity, gzip;q=0" },
    });
    assert.equal(statsDeclined.status, 200);
    assert.equal(statsDeclined.headers.get("content-encoding"), null);
    await statsDeclined.json();

    // 3) Static web assets (/app/index.html)
    const assetDeclined = await app.request("/app/index.html", {
      headers: { "Accept-Encoding": "identity, gzip;q=0" },
    });
    assert.equal(assetDeclined.status, 200);
    assert.equal(assetDeclined.headers.get("content-encoding"), null);

    const assetGz = await app.request("/app/index.html", {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(assetGz.status, 200);
    assert.equal(assetGz.headers.get("content-encoding"), "gzip");
  } finally {
    db.close();
  }
});

test("#14 合法域名不被前缀误判为 IPv6 内网地址，且严格执行部署侧 Webhook 出站策略", async () => {
  // Public hostnames starting with fc/fd/fe80 must NOT be flagged private
  assert.equal(isPrivateWebhookUrl("https://fcdn.example/hook"), false);
  assert.equal(isPrivateWebhookUrl("https://fd.example.com/hook"), false);
  assert.equal(isPrivateWebhookUrl("https://fc2.com/callback"), false);

  // Genuine private IPv4 / IPv6 / CGNAT / IPv4-mapped IPv6 / single-label hosts MUST be blocked
  assert.equal(isPrivateWebhookUrl("http://[fc00::1]/hook"), true);
  assert.equal(isPrivateWebhookUrl("http://[fd12:3456::1]/hook"), true);
  assert.equal(isPrivateWebhookUrl("http://[fe80::1]/hook"), true);
  assert.equal(isPrivateWebhookUrl("http://[::ffff:127.0.0.1]/hook"), true);
  assert.equal(isPrivateWebhookUrl("http://100.64.0.1/hook"), true);
  assert.equal(isPrivateWebhookUrl("http://172.16.0.1/hook"), true);
  assert.equal(isPrivateWebhookUrl("http://intranet/hook"), true);

  // Deployment policy controls private webhook exceptions regardless of user checkbox
  const lanCfg = { url: "http://192.168.1.50:5678/webhook", allowPrivateNetwork: true };
  assert.equal(validateWebhookTarget(lanCfg, { allowPrivateNetwork: false }).ok, false);
  assert.equal(validateWebhookTarget(lanCfg, { allowPrivateNetwork: true }).ok, true);

  // DNS rebinding / private resolved-IP SSRF guard on public-looking hostnames
  const rebindBlocked127 = await deliverWebhookEvent(
    { enabled: true, url: "https://rebind.example/hook", secret: "", allowPrivateNetwork: false },
    "webhook.test",
    { test: true },
    (async () => new Response("ok", { status: 200 })) as typeof fetch,
    { allowPrivateNetwork: false },
    async () => [{ address: "127.0.0.1" }],
  );
  assert.equal(rebindBlocked127.delivered, false);
  assert.match(rebindBlocked127.error ?? "", /内网或保留 IP/);

  const rebindBlockedMetadata = await deliverWebhookEvent(
    { enabled: true, url: "https://rebind.example/hook", secret: "", allowPrivateNetwork: true },
    "webhook.test",
    { test: true },
    (async () => new Response("ok", { status: 200 })) as typeof fetch,
    { allowPrivateNetwork: false },
    async () => [{ address: "169.254.169.254" }],
  );
  assert.equal(rebindBlockedMetadata.delivered, false);
  assert.match(rebindBlockedMetadata.error ?? "", /内网或保留 IP/);

  const { db, store, user, call } = makeCtx({ allowPrivateWebhooks: false });
  try {
    const putLan = await call("/api/web/profile/webhook", {
      method: "PUT",
      body: { enabled: true, url: "http://192.168.1.50:5678/webhook", secret: "", allowPrivateNetwork: true },
    });
    assert.equal(putLan.status, 400);

    const testLan = await call("/api/web/webhook/test", {
      method: "POST",
      body: { enabled: true, url: "http://192.168.1.50:5678/webhook", secret: "", allowPrivateNetwork: true },
    });
    assert.equal(testLan.status, 400);

    // Even when saving a public URL (or disabled webhook) with allowPrivateNetwork: true, deployment policy forces it false
    const putForcedFalse = await (await call("/api/web/profile/webhook", {
      method: "PUT",
      body: { enabled: true, url: "https://fcdn.example/webhook", secret: "", allowPrivateNetwork: true },
    })).json() as { webhookConfig: { allowPrivateNetwork: boolean } };
    assert.equal(putForcedFalse.webhookConfig.allowPrivateNetwork, false);
    const storedSettings = store.get(user.userId, "profile", "settings")?.data as { webhookConfig?: { allowPrivateNetwork?: boolean } };
    assert.equal(storedSettings.webhookConfig?.allowPrivateNetwork, false);

    const putPublic = await call("/api/web/profile/webhook", {
      method: "PUT",
      body: { enabled: true, url: "https://fcdn.example/webhook", secret: "", allowPrivateNetwork: false },
    });
    assert.equal(putPublic.status, 200);
  } finally {
    db.close();
  }
});
