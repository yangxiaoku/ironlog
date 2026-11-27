import { test } from "node:test";
import assert from "node:assert/strict";
import { localDate } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { mergeIntervalsMinutes, parseSleepSamples, parseTolerantNumber } from "../packages/server/src/apple-health-daily.js";
import { getTrainingContext } from "../packages/server/src/stats.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";

function setup() {
  const db = openDatabase(":memory:");
  const { app, auth, store } = createApp(db);
  const owner = auth.login("daily-health-owner");
  const other = auth.login("daily-health-other");
  const call = (path: string, token?: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const issue = async () => {
    const res = await call("/api/integrations/apple-health/tokens", owner.token, "POST", { label: "iPhone 16" });
    assert.equal(res.status, 201);
    return res.json() as Promise<{ id: string; token: string }>;
  };
  return { db, owner, other, call, issue, store };
}

test("同一 Apple 训练带或不带来源 ID 时只计一次，保留补充心率与相邻场次", async () => {
  const { db, call, issue, owner } = setup();
  try {
    const date = shiftDay(localDate(), -1);
    const device = await issue();
    const payload = {
      schemaVersion: 1, captureMethod: "workout", activityType: "running", environment: "outdoor",
      startedAt: `${date}T07:00:00+08:00`, endedAt: `${date}T07:30:00+08:00`,
      durationSeconds: 1800, activeEnergyKcal: 240, energyKind: "workout",
    };
    for (const sample of [
      { ...payload, heartRate: { avgBpm: 145 } },
      { ...payload, externalWorkoutId: "known-first-activity" },
      { ...payload, externalWorkoutId: "known-second-activity", activeEnergyKcal: 210,
        startedAt: `${date}T07:31:00+08:00`, endedAt: `${date}T08:01:00+08:00` },
    ]) {
      const response = await call("/api/integrations/apple-health/workouts", device.token, "POST", sample);
      assert.equal(response.status, 201);
    }
    const response = await call(`/api/web/analytics?through=${date}`, owner.token);
    assert.equal(response.status, 200);
    const { appleWorkouts } = await response.json() as any;
    assert.equal(appleWorkouts.totalCount, 2);
    assert.equal(appleWorkouts.totalCaloriesKcal, 450);
    assert.equal(appleWorkouts.avgBpm, 145);
  } finally {
    db.close();
  }
});

test("带时间的步数快照可纠正旧高估并拒绝过期或无日期的覆盖", async () => {
  const { db, call, issue, owner } = setup();
  try {
    const date = shiftDay(localDate(), -1);
    const later = `${date}T11:00:00+08:00`;
    const device = await issue();
    const path = "/api/integrations/apple-health/daily";
    const post = async (body: Record<string, unknown>) => {
      const response = await call(path, device.token, "POST", { date, shortcutGenVersion: "3", ...body });
      assert.equal(response.status, 200);
      return ((await response.json()) as any).daily.steps;
    };
    const samples = (value: number) => [`${date}T08:00:00+08:00|${value}`];
    assert.equal(await post({ steps: 12000 }), 12000);
    assert.equal(await post({ occurredAt: later, stepsSamples: samples(1200) }), 1200);
    assert.equal(await post({ occurredAt: `${date}T10:00:00+08:00`, stepsSamples: samples(900) }), 1200);
    assert.equal(await post({ occurredAt: `${date}T12:00:00+08:00`, steps: 13000 }), 1200);
    assert.equal(await post({ occurredAt: `${date}T13:00:00+08:00`, stepsSamples: samples(1500) }), 1500);
    const read = await call(`${path}?from=${date}&through=${date}`, owner.token);
    const { entries } = await read.json() as any;
    assert.equal(entries[0].steps, 1500);
    assert.equal(entries[0].stepsSampledAt, undefined);
  } finally {
    db.close();
  }
});

test("parseSleepSamples 精确合并重叠阶段区间，不重复计算深睡与卧床时间", () => {
  assert.equal(mergeIntervalsMinutes([[0, 600_000], [300_000, 900_000]]), 15);
  const parsed = parseSleepSamples([
    "In Bed|2026-11-19T23:30:00+08:00|2026-11-20T07:30:00+08:00", // 480 min in bed
    "Core|2026-11-19T23:45:00+08:00|2026-11-20T02:45:00+08:00",   // 180 min
    "Deep|2026-11-20T02:45:00+08:00|2026-11-20T04:15:00+08:00",   // 90 min
    // Overlapping duplicate Core reading from second device should not double count
    "Core|2026-11-20T02:30:00+08:00|2026-11-20T03:00:00+08:00",
    "REM|2026-11-20T04:15:00+08:00|2026-11-20T05:45:00+08:00",    // 90 min
    "Awake|2026-11-20T05:45:00+08:00|2026-11-20T06:00:00+08:00",  // 15 min
    "Core|2026-11-20T06:00:00+08:00|2026-11-20T07:15:00+08:00",   // 75 min
  ].join("\n"));

  assert.equal(parsed.sleepInBedMinutes, 480);
  assert.equal(parsed.sleepDeepMinutes, 90);
  assert.equal(parsed.sleepRemMinutes, 90);
  assert.equal(parsed.sleepCoreMinutes, 270);
  assert.equal(parsed.sleepAwakeMinutes, 15);
  assert.equal(parsed.sleepMinutes, 435); // Union of deep+core+rem intervals: 23:45..05:45 (360) + 06:00..07:15 (75)
  assert.equal(parsed.sleepEfficiencyPct, 91);

  const zhParsed = parseSleepSamples([
    "在床上|2026-11-20T23:30:00+08:00|2026-11-21T07:00:00+08:00",
    "深度睡眠|2026-11-21T00:00:00+08:00|2026-11-21T01:30:00+08:00",
    "浅度睡眠|2026-11-21T01:30:00+08:00|2026-11-21T04:30:00+08:00",
    "快速眼动睡眠|2026-11-21T04:30:00+08:00|2026-11-21T05:30:00+08:00",
    "快速动眼睡眠|2026-11-21T05:30:00+08:00|2026-11-21T06:00:00+08:00",
    "睡眠中|2026-11-21T06:00:00+08:00|2026-11-21T06:30:00+08:00",
  ].join("\n"));
  assert.equal(zhParsed.sleepInBedMinutes, 450);
  assert.equal(zhParsed.sleepDeepMinutes, 90);
  assert.equal(zhParsed.sleepCoreMinutes, 180);
  assert.equal(zhParsed.sleepRemMinutes, 90);
  assert.equal(zhParsed.sleepMinutes, 390);

  const cjkDateSleep = parseSleepSamples("核心睡眠|2026年11月21日 上午1:00|2026年11月21日 上午2:30");
  assert.equal(cjkDateSleep.sleepCoreMinutes, 90);
  assert.equal(cjkDateSleep.sleepMinutes, 90);

  // 4th column Duration: uses timestamps without double-counting when valid, and falls back to Duration when timestamps are empty
  const mixedDurationSleep = parseSleepSamples([
    "核心睡眠|2026-11-21T01:00:00+08:00|2026-11-21T02:30:00+08:00|5400",
    "深度睡眠|||2700",
    "快速动眼睡眠|||1小时5分钟",
    "清醒时间|||00:10:00",
  ].join("\n"));
  assert.equal(mixedDurationSleep.sleepCoreMinutes, 90);
  assert.equal(mixedDurationSleep.sleepDeepMinutes, 45);
  assert.equal(mixedDurationSleep.sleepRemMinutes, 65);
  assert.equal(mixedDurationSleep.sleepAwakeMinutes, 10);
  assert.equal(mixedDurationSleep.sleepMinutes, 200);
});

test("体征上传的 false 标志保留已有数据，睡眠归到实际睡眠结束日", async () => {
  const { db, owner, call, issue } = setup();
  try {
    const today = localDate();
    const yesterday = shiftDay(today, -1);
    const path = "/api/integrations/apple-health/daily";
    const device = await issue();
    const upload = (body: object) => call(path, device.token, "POST", body);
    const post = async (body: object) => {
      const response = await upload(body);
      assert.equal(response.status, 200);
      return response.json();
    };

    await post({ date: today, steps: 1400 });
    const updated = await post({ date: today, dryRun: "false", replace: "false", restingHeartRateBpm: 60 });
    assert.equal(updated.dryRun, false);
    assert.equal(updated.daily.steps, 1400);
    const preview = await post({ date: today, dryRun: "true", replace: "true", steps: 20 });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.daily.steps, 20);

    await post({
      date: today,
      sleepSamples: [
        `Core|${yesterday}T19:00:00+08:00|${yesterday}T23:55:00+08:00`,
        `In Bed|${yesterday}T18:30:00+08:00|${today}T00:30:00+08:00`,
        `Awake|${yesterday}T23:55:00+08:00|${today}T00:15:00+08:00`,
      ],
    });
    const daily = await (await call(`${path}?from=${yesterday}&through=${today}`, owner.token)).json();
    assert.deepEqual(daily.entries.map((row: { date: string; sleepMinutes?: number; steps?: number }) =>
      [row.date, row.sleepMinutes, row.steps]), [[yesterday, 295, undefined], [today, undefined, 1400]]);

    const start = Date.parse(`${yesterday}T19:00:00+08:00`);
    const end = Date.parse(`${yesterday}T23:55:00+08:00`);
    const afterMidnight = Date.parse(`${today}T00:30:00+08:00`);
    // Reproduce the earlier archive layout alongside the same night after it was synced again.
    const stored = db.prepare("UPDATE apple_health_daily SET data = ? WHERE user_id = ? AND date = ?");
    stored.run(JSON.stringify({ source: "shortcut", steps: 1400, sleepMinutes: 295, syncedSleepObservations: [
      { stage: "core", interval: [start, end] },
      { stage: "inBed", interval: [start, afterMidnight] },
    ] }), owner.userId, today);
    const stats = await (await call(`/api/web/analytics?days=14&through=${today}`, owner.token)).json();
    assert.deepEqual(stats.sleepReport.series.slice(-2).map((row: { minutes: number | null }) => row.minutes), [295, null]);
    assert.equal(stats.sleepReport.current.recordedDays, 1);
    assert.equal(stats.appleDaily.series.at(-1).steps, 1400);
    const historical = await (await call(`/api/web/analytics?days=14&through=${yesterday}`, owner.token)).json();
    assert.equal(historical.sleepReport.series.at(-1).minutes, 295);
    assert.equal(historical.appleDaily.series.at(-1).steps, undefined);
    const originals = await (await call(`${path}?from=${today}&through=${today}`, owner.token)).json();
    assert.equal(originals.entries[0].sleepMinutes, 295);
  } finally {
    db.close();
  }
});

test("v2 快捷指令单次上传包含昨晨与今晨两晚睡眠时，服务端自动按醒来日期拆分并保留夜间隔微断档", async () => {
  const { db, owner, call, issue } = setup();
  try {
    const device = await issue();
    const today = localDate();
    const yesterday = shiftDay(today, -1);
    const twoDaysAgo = shiftDay(today, -2);
    const path = "/api/integrations/apple-health/daily";
    // Simulate a prior double-counted upload on today followed by a v2 sync with two nights
    const res = await call(path, device.token, "POST", {
      schemaVersion: 1,
      shortcutGenVersion: "2",
      occurredAt: `${today}T13:20:00+08:00`,
      steps: "683",
      sleepSamples: [
        // Yesterday morning sleep session (ended on yesterday)
        `核心睡眠|${yesterday}T00:05:00+08:00|${yesterday}T05:35:00+08:00|19800`,
        `深度睡眠|${yesterday}T05:35:00+08:00|${yesterday}T07:05:00+08:00|5400`,
        // Tonight sleep with a 10-minute midnight sensor gap should stay ONE session attributed to today
        `核心睡眠|${yesterday}T23:40:00+08:00|${yesterday}T23:55:00+08:00|900`,
        `核心睡眠|${today}T00:05:00+08:00|${today}T05:50:00+08:00|20700`,
        `深度睡眠|${today}T05:50:00+08:00|${today}T06:50:00+08:00|3600`,
        `快速动眼睡眠|${today}T06:50:00+08:00|${today}T08:05:00+08:00|4500`,
      ].join("\n"),
    });
    assert.equal(res.status, 200);
    const { entries } = await (await call(`${path}?from=${twoDaysAgo}&through=${today}`, owner.token)).json() as any;
    assert.deepEqual(entries.map((row: any) => [row.date, row.sleepMinutes]), [
      [yesterday, 420],
      [today, 495],
    ]);
    assert.equal(entries[1].steps, 683);
    assert.equal(entries[0].steps, undefined);
  } finally {
    db.close();
  }
});

test("睡眠接受 HealthKit 数字分期，卧床单独记录，午夜重试不复制前一晚", () => {
  const inBed = "0|2026-11-20T23:30:00+08:00|2026-11-21T07:00:00+08:00";
  const samples = [
    inBed,
    "3|2026-11-20T23:45:00+08:00|2026-11-21T04:00:00+08:00",
    { stage: 4, startedAt: "2026-11-21T04:00:00+08:00", endedAt: "2026-11-21T05:00:00+08:00" },
    "AsleepREM|2026-11-21T05:00:00+08:00|2026-11-21T06:00:00+08:00",
    "5|2026-11-21T05:00:00+08:00|2026-11-21T06:00:00+08:00",
  ];
  const result = parseSleepSamples(samples, "2026-11-21");
  assert.equal(result.sleepMinutes, 375);
  assert.equal(result.sleepCoreMinutes, 255);
  assert.equal(result.sleepDeepMinutes, 60);
  assert.equal(result.sleepRemMinutes, 60);
  assert.equal(result.sleepInBedMinutes, 450);
  assert.deepEqual(parseSleepSamples(samples, "2026-11-22"), {});
  const bedOnly = parseSleepSamples(inBed, "2026-11-21");
  assert.equal(bedOnly.sleepInBedMinutes, 450);
  assert.equal(bedOnly.sleepMinutes, undefined);
});

test("v3 将近三天的睡眠、活动和体征按日期回填，重传和空样本保持原记录", async () => {
  const { db, owner, call, issue } = setup();
  try {
    const device = await issue();
    const today = localDate();
    const yesterday = shiftDay(today, -1);
    const oldest = shiftDay(today, -2);
    const outside = shiftDay(today, -3);
    const path = "/api/integrations/apple-health/daily";
    const get = () => call(`${path}?from=${outside}&through=${today}`, owner.token).then((response) => response.json() as any);
    const payload = {
      date: today, shortcutGenVersion: "3",
      stepsSamples: [
        `${outside}T18:30:00+08:00|999`,
        `${oldest}T12:00:00+08:00|2000`,
        `${today}T01:00:00+08:00|30`,
        `${today}T08:00:00+08:00|50`,
      ].join("\n"),
      activeEnergyKcalSamples: [`${yesterday}T09:00:00+08:00|1.25 kcal`, "missing", `${yesterday}T10:00:00+08:00|1.25 kcal`],
      heartRateBpm: "58 bpm", heartRateBpmMeasuredAt: `${yesterday}T12:00:00+08:00`,
      weightKg: "70.2 kg", weightMeasuredAt: `${oldest}T09:00:00+08:00`,
      respiratoryRate: "14", respiratoryRateMeasuredAt: "",
      bloodOxygenPct: "", 
      sleepSamples: [
        `3|${outside}T23:30:00+08:00|${oldest}T04:00:00+08:00`,
        `4|${oldest}T04:00:00+08:00|${oldest}T05:00:00+08:00`,
        `5|${oldest}T05:00:00+08:00|${oldest}T06:30:00+08:00`,
        `5|${oldest}T05:00:00+08:00|${oldest}T06:30:00+08:00`,
        `3|${yesterday}T23:30:00+08:00|${today}T07:30:00+08:00`,
        "深度睡眠|||2700",
      ].join("\n"),
    };
    const empty = await call(path, device.token, "POST", { date: today, shortcutGenVersion: "3", stepsSamples: "", sleepSamples: "" });
    assert.equal(empty.status, 200);
    assert.deepEqual((await get()).entries, []);
    const preview = await call(path + "?dryRun=1", device.token, "POST", payload);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json() as any).history.length, 2);
    assert.deepEqual((await get()).entries, []);
    for (let count = 0; count < 2; count++) assert.equal((await call(path, device.token, "POST", payload)).status, 200);
    const { entries } = await get();
    assert.deepEqual(entries.map((row: any) => [row.date, row.steps, row.sleepMinutes, row.activeEnergyKcal, row.heartRateBpm, row.weightKg]), [
      [oldest, 2000, 420, undefined, undefined, 70.2],
      [yesterday, undefined, undefined, 2.5, 58, undefined],
      [today, 80, 480, undefined, undefined, undefined],
    ]);
    assert.equal(entries[0].sleepRemMinutes, 90);
    assert.equal(entries[2].respiratoryRate, undefined);
  } finally { db.close(); }
});

test("parseTolerantNumber 容错处理 Shortcuts 单位后缀、千分位及空占位值", () => {
  assert.equal(parseTolerantNumber("8,421", "步数", { integer: true }), 8421);
  assert.equal(parseTolerantNumber("74.25 kg", "体重"), 74.25);
  assert.equal(parseTolerantNumber("8,450 步", "步数", { integer: true }), 8450);
  assert.equal(parseTolerantNumber("450 千卡", "活动能量"), 450);
  assert.equal(parseTolerantNumber("14 次/分", "呼吸频率"), 14);
  assert.equal(parseTolerantNumber("unknown", "静息心率"), undefined);
  assert.equal(parseTolerantNumber("", "体脂率"), undefined);
  assert.equal(parseTolerantNumber("N/A", "血氧"), undefined);
  assert.throws(() => parseTolerantNumber("-5", "体重", { min: 1, max: 500 }), /超出有效范围/);
});

test("每日全量健康接口支持权限隔离、单调累计合并、百分比归一与自动回填体重记录", async () => {
  const { db, owner, other, call, issue, store } = setup();
  try {
    const device = await issue();
    const today = localDate();
    const yesterday = shiftDay(today, -1);

    // Reject web token on upload route and device token on read route
    assert.equal((await call("/api/integrations/apple-health/daily", owner.token, "POST", { steps: 1000 })).status, 401);
    assert.equal((await call("/api/integrations/apple-health/daily", device.token)).status, 401);

    // Dry-run does not persist to SQLite
    const dry = await call("/api/integrations/apple-health/daily?dryRun=1", device.token, "POST", {
      date: today,
      steps: "5000",
      weightKg: 75.5,
    });
    assert.equal(dry.status, 200);
    assert.equal((await dry.json() as any).dryRun, true);
    assert.equal(store.get(owner.userId, "weight", `weight_${today}`), null);

    // Full Shortcut telemetry payload (mixing fractions, strings with units, sleep samples, and empty fields)
    const upload = await call("/api/integrations/apple-health/daily", device.token, "POST", {
      schemaVersion: 1,
      occurredAt: `${today}T22:30:00+08:00`,
      steps: "9,420",
      activeEnergyKcal: "480 kcal",
      restingEnergyKcal: "1620",
      distanceKm: "6.85",
      flightsClimbed: "12",
      sleepSamples: [
        `In Bed|${yesterday}T23:30:00+08:00|${today}T07:00:00+08:00`,
        `Deep|${today}T00:30:00+08:00|${today}T02:00:00+08:00`,
        `Core|${today}T02:00:00+08:00|${today}T05:30:00+08:00`,
        `REM|${today}T05:30:00+08:00|${today}T06:45:00+08:00`,
      ].join("\n"),
      weightKg: "74.6 kg",
      weightMeasuredAt: `${today}T07:15:00+08:00`,
      bodyFatPct: "0.178", // fractional HealthKit % should scale to 17.8%
      bodyFatMeasuredAt: `${today}T07:15:00+08:00`,
      leanBodyMassKg: "61.3",
      bmi: "23.1",
      waistCm: "0.81", // meters converted to 81 cm
      restingHeartRateBpm: "53",
      heartRateBpm: "68",
      hrvMs: "64.5",
      vo2Max: "48.2",
      bloodOxygenPct: "0.98",
      respiratoryRate: "14.5",
      waterMl: "2100",
      dietaryEnergyKcal: "unknown",
    });
    assert.equal(upload.status, 200);
    const body = await upload.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.weightSynced, true);
    assert.equal(body.daily.steps, 9420);
    assert.equal(body.daily.totalEnergyKcal, 2100);
    assert.equal(body.daily.sleepMinutes, 375);
    assert.equal(body.daily.bodyFatPct, 17.8);
    assert.equal(body.daily.waistCm, 81);
    assert.equal(body.daily.bloodOxygenPct, 98);
    assert.equal(body.daily.dietaryEnergyKcal, undefined);

    // Weight record was backfilled cleanly with body fat
    const weightRec = store.get(owner.userId, "weight", `weight_${today}`);
    assert.equal((weightRec?.data as any).weight, 74.6);
    assert.equal((weightRec?.data as any).bodyFat, 17.8);

    // Monotonic merge keeps max steps even if a partial update sends lower or blank steps
    const partial = await call("/api/integrations/apple-health/daily", device.token, "POST", {
      date: today,
      steps: "500",
      waterMl: "2500",
      restingHeartRateBpm: "51",
    });
    assert.equal(partial.status, 200);
    const partialJson = await partial.json() as any;
    assert.equal(partialJson.daily.steps, 9420);
    assert.equal(partialJson.daily.waterMl, 2500);
    assert.equal(partialJson.daily.restingHeartRateBpm, 51);

    // Manual weight override on yesterday must NOT be overwritten by Apple backfill
    store.mutate(owner.userId, {
      kind: "weight",
      id: `weight_${yesterday}`,
      opId: "manual_yest",
      baseVersion: 0,
      deleted: false,
      data: { date: yesterday, weight: 79.9, bodyFat: null },
    });
    const backdated = await call("/api/integrations/apple-health/daily", device.token, "POST", {
      date: today,
      weightKg: 74.0,
      weightMeasuredAt: `${yesterday}T08:00:00+08:00`,
    });
    assert.equal((await backdated.json() as any).weightSynced, false);
    assert.equal((store.get(owner.userId, "weight", `weight_${yesterday}`)?.data as any).weight, 79.9);

    // Today & Analytics & Read routes reflect data and isolate accounts
    const readOwner = await (await call(`/api/integrations/apple-health/daily?from=${yesterday}&through=${today}`, owner.token)).json() as any;
    assert.equal(readOwner.entries.length, 2);
    assert.deepEqual((await (await call(`/api/integrations/apple-health/daily?from=${today}&through=${today}`, other.token)).json() as any).entries, []);

    const webToday = await (await call("/api/web/today", owner.token)).json() as any;
    assert.equal(webToday.appleDaily.steps, 9420);
    assert.equal(webToday.appleDaily.sleepMinutes, 375);

    const analytics = await (await call(`/api/web/analytics?days=30&through=${today}`, owner.token)).json() as any;
    assert.equal(analytics.appleDaily.daysWithData, 2);
    assert.equal(analytics.appleDaily.averages.sleepMinutes, 375);
    assert.equal(analytics.appleDaily.latestBody.bodyFatPct.value, 17.8);
    assert.equal(analytics.appleDaily.recoveryReport.hasData, true);
    assert.equal(analytics.appleDaily.recoveryReport.baselineMode, "single_day_reference");
    assert.ok(analytics.appleDaily.recoveryReport.readinessScore >= 60);
    assert.ok(analytics.appleWorkouts);
    assert.equal(analytics.appleWorkouts.totalCount, 0);

    // Revoking device token blocks subsequent uploads
    await call(`/api/integrations/apple-health/tokens/${device.id}`, owner.token, "DELETE");
    assert.equal((await call("/api/integrations/apple-health/daily", device.token, "POST", { steps: 10000 })).status, 401);
  } finally {
    db.close();
  }
});

test("Apple 健康体成分 FFMI/WHtR 评估、心肺准备度基线切换与运动分类汇总报表", async () => {
  const { db, store, call, owner } = setup();
  try {
    const today = localDate();
    const prevWeekDay = shiftDay(today, -10);
    const d1 = shiftDay(today, -2);
    const d2 = shiftDay(today, -1);
    const device = await (await call("/api/integrations/apple-health/tokens", owner.token, "POST", { label: "分析手机" })).json() as any;

    await call("/api/integrations/apple-health/daily", device.token, "POST", {
      date: prevWeekDay,
      weightKg: 81.0,
      restingHeartRateBpm: 70,
      hrvMs: 32.0,
    });
    for (const [d, w, bf, rhr, hrv] of [
      [d1, 80.2, 25.0, 68, 35.0],
      [d2, 79.8, 24.7, 67, 36.0],
    ] as const) {
      await call("/api/integrations/apple-health/daily", device.token, "POST", {
        date: d,
        weightKg: w,
        bodyFatPct: bf,
        restingHeartRateBpm: rhr,
        hrvMs: hrv,
      });
    }
    await call("/api/integrations/apple-health/daily", device.token, "POST", {
      date: today,
      weightKg: 79.55,
      bodyFatPct: 24.4,
      leanBodyMassKg: 60.1,
      bmi: 25.1,
      waistCm: 90,
      heartRateBpm: 81,
      restingHeartRateBpm: 66,
      hrvMs: 36.8,
      bloodOxygenPct: 96,
      respiratoryRate: 12.5,
    });
    const woRes = await call("/api/integrations/apple-health/workouts", device.token, "POST", {
      schemaVersion: 1,
      captureMethod: "workout",
      externalWorkoutId: "daily-analytics-run-1",
      activityType: "running",
      environment: "outdoor",
      startedAt: `${d1}T07:00:00+08:00`,
      endedAt: `${d1}T07:30:00+08:00`,
      durationSeconds: 1800,
      durationKind: "workout_active",
      activeEnergyKcal: 260,
      energyKind: "workout",
      distanceMeters: 4200,
      heartRate: { avgBpm: 145, maxBpm: 168 },
    });
    assert.equal(woRes.status, 201);

    const analytics = await (await call(`/api/web/analytics?days=30&through=${today}`, owner.token)).json() as any;
    const { bodyReport, recoveryReport, deltas } = analytics.appleDaily;

    assert.equal(bodyReport.heightSource, "bmi_inferred");
    assert.ok(Math.abs(bodyReport.heightCm - 178) < 0.3);
    assert.ok(Math.abs(bodyReport.ffmi - 19.0) <= 0.2);
    assert.ok(Math.abs(bodyReport.whtr - 0.506) <= 0.003);
    assert.ok(Math.abs(bodyReport.fatMassKg - 19.45) <= 0.05);
    assert.equal(bodyReport.metabolic.bmrKatchMcArdleKcal, Math.round(370 + 21.6 * 60.1));
    assert.ok(bodyReport.metabolic.recompCutTargetKcal > 1500);
    assert.ok(bodyReport.metabolic.proteinTargetG >= 126);
    assert.equal(bodyReport.recomposition.targetWaistCm, 89);
    assert.equal(bodyReport.recomposition.milestones.length, 0);
    assert.equal(bodyReport.ffmiStatus, null);
    assert.equal(bodyReport.waistStatus, null);
    assert.equal(deltas.weightKg.delta, -1.45);
    assert.equal(analytics.appleDaily.weeklyComparison.hasPreviousBaseline, true);
    const wcWeight = analytics.appleDaily.weeklyComparison.metrics.find((m: any) => m.key === "weightKg");
    assert.ok(wcWeight && wcWeight.delta < 0);

    assert.equal(recoveryReport.baselineMode, "personal_baseline");
    assert.ok(recoveryReport.readinessScore >= 80);
    assert.ok(recoveryReport.autonomicBalanceRatio != null && recoveryReport.autonomicBalanceRatio > 4);
    assert.ok(recoveryReport.lnHrvBaseline != null && typeof recoveryReport.lnHrvBaseline.zScore === "number");
    const hrvSig = recoveryReport.signals.find((s: any) => s.key === "hrvMs");
    assert.ok(hrvSig && typeof hrvSig.zScore === "number" && typeof hrvSig.lnValue === "number" && typeof hrvSig.swcHalfSd === "number");
    assert.equal(recoveryReport.heartRateLatest.value, 81);
    assert.equal(recoveryReport.heartRateLatest.spreadFromRhr, 15);
    assert.ok(recoveryReport.signals.every((s: any) => s.rangeBand && s.rangeBand.max > s.rangeBand.min));
    assert.equal(analytics.appleDaily.series.length, 4);
    assert.equal(analytics.appleDaily.coverageSummary.syncedCount, 10);
    assert.equal(analytics.userProfile.appleWeightKg, 79.55);

    assert.equal(analytics.appleWorkouts.totalCount, 1);
    assert.equal(analytics.appleWorkouts.realDeviceCount, 1);
    assert.equal(analytics.appleWorkouts.demoCount, 0);
    assert.equal(analytics.appleWorkouts.totalCaloriesKcal, 260);
    assert.equal(analytics.appleWorkouts.totalDistanceKm, 4.2);
    assert.equal(analytics.appleWorkouts.avgBpm, 145);
    assert.equal(analytics.appleWorkouts.maxBpm, 168);
    assert.equal(analytics.appleWorkouts.byActivity[0].title, "户外跑步");
    assert.equal(analytics.appleWorkouts.recent[0].isDemo, false);
    assert.equal(analytics.appleWorkouts.recent[0].captureMethod, "workout");
    assert.equal(Date.parse(analytics.appleWorkouts.recent[0].startedAt), Date.parse(`${d1}T07:00:00+08:00`));
    assert.equal(Date.parse(analytics.appleWorkouts.recent[0].endedAt), Date.parse(`${d1}T07:30:00+08:00`));
    assert.equal(analytics.appleWorkouts.recent[0].durationKind, "workout_active");
    assert.equal(analytics.appleWorkouts.hrZones, null);
    assert.equal(analytics.appleWorkouts.realDeviceStats.hrZones, null);

    const statsRes = await (await call(`/api/web/statistics?days=30&through=${today}`, owner.token)).json() as any;
    assert.equal(statsRes.appleDailySummary.bodyReport.weightKg, 79.55);
    assert.ok(statsRes.appleDailySummary.recoveryReport.readinessScore >= 80);

    const ctx = getTrainingContext(store, owner.userId);
    assert.equal(ctx.appleHealthDaily?.daysSynced, 4);
    assert.equal(ctx.appleHealthDaily?.body.weightKg, 79.55);
    assert.equal(ctx.appleHealthDaily?.recovery.readinessScore, recoveryReport.readinessScore);

    const birthDate = `${Number(today.slice(0, 4)) - 30}-01-01`;
    store.mutate(owner.userId, {
      kind: "profile", id: "settings", opId: "analytics-heart-rate-profile", baseVersion: 0, deleted: false,
      data: {
        energyProfile: {
          weightKg: 79.55, weightDate: today, heightCm: 178, sex: "male", birthDate,
          context: "general", activityFactor: 1.6,
        },
      },
    });
    const withProfile = await (await call(`/api/web/analytics?days=30&through=${today}`, owner.token)).json() as any;
    assert.equal(withProfile.appleWorkouts.avgBpm, 145);
    assert.equal(withProfile.appleWorkouts.hrZones.hrMax, 187);
    assert.equal(withProfile.appleWorkouts.hrZones.hrMaxSource, "tanaka_age");
    assert.equal(withProfile.appleWorkouts.hrZones.zones.find((z: any) => z.key === "z3").count, 1);
    assert.equal(withProfile.appleDaily.bodyReport.recomposition.milestones.length, 2);
    assert.equal(withProfile.appleDaily.bodyReport.recomposition.milestones[0].targetFatPct, 20);
    assert.equal(withProfile.appleDaily.bodyReport.recomposition.milestones[0].weeklyFatRateKg, 0.48);
  } finally {
    db.close();
  }
});

test("Apple 健康日常活动量、皮尔逊相关性发现与真机/示例运动分离统计", async () => {
  const { db, store, call, owner } = setup();
  try {
    const today = localDate();
    const device = await (await call("/api/integrations/apple-health/tokens", owner.token, "POST", { label: "日常分析机" })).json() as any;

    await call("/api/integrations/apple-health/daily", device.token, "POST", {
      date: shiftDay(today, -3),
      steps: 38,
      distanceKm: 0.03,
      activeEnergyKcal: 12,
      sleepMinutes: 340,
      hrvMs: 31.0,
    });
    const earlyRes = await (await call(`/api/web/analytics?days=30&through=${today}`, owner.token)).json() as any;
    assert.equal(earlyRes.appleDaily.activityReport.hasData, true);
    assert.equal(earlyRes.appleDaily.activityReport.latestSteps, 38);
    assert.equal(earlyRes.appleDaily.activityReport.latestDistanceKm, 0.03);
    assert.equal(earlyRes.appleDaily.activityReport.strideCm, null);
    assert.equal(earlyRes.appleDaily.activityReport.activityTierLabel, "今日刚起步 (<300 步)");
    assert.deepEqual(earlyRes.appleDaily.correlations, []);

    for (const [offset, steps, dist, activeKcal, sleepMin, hrv] of [
      [-2, 1800, 1.3, 95, 390, 35.5],
      [-1, 3400, 2.5, 190, 430, 40.0],
      [0, 5000, 3.75, 290, 470, 46.5],
    ] as const) {
      await call("/api/integrations/apple-health/daily", device.token, "POST", {
        date: shiftDay(today, offset),
        steps,
        distanceKm: dist,
        activeEnergyKcal: activeKcal,
        sleepMinutes: sleepMin,
        hrvMs: hrv,
      });
    }

    const demoItem = {
      schemaVersion: 1,
      captureMethod: "workout",
      activityType: "running",
      environment: "outdoor",
      startedAt: `${shiftDay(today, -1)}T07:10:00+08:00`,
      endedAt: `${shiftDay(today, -1)}T07:35:00+08:00`,
      durationSeconds: 1500,
      durationKind: "workout_active",
      activeEnergyKcal: 210,
      energyKind: "workout",
      distanceMeters: 3800,
    };
    store.db.prepare("INSERT INTO apple_health_workouts VALUES (?,?,?,?,?,?)")
      .run("demo_outdoor_run", owner.userId, "demo_outdoor_run", demoItem.endedAt, demoItem.endedAt, JSON.stringify(demoItem));

    const realWo = await call("/api/integrations/apple-health/workouts", device.token, "POST", {
      schemaVersion: 1,
      captureMethod: "workout",
      externalWorkoutId: "real-watch-strength-1",
      activityType: "traditionalStrengthTraining",
      environment: "indoor",
      startedAt: `${shiftDay(today, -1)}T18:00:00+08:00`,
      endedAt: `${shiftDay(today, -1)}T18:45:00+08:00`,
      durationSeconds: 2700,
      durationKind: "workout_active",
      activeEnergyKcal: 310,
      energyKind: "workout",
    });
    assert.equal(realWo.status, 201);

    const woSave = await call("/api/records", owner.token, "POST", {
      opId: "op-report-wo-1",
      id: "report-wo-1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "胸背复合训练",
        date: today,
        startedAt: `${shiftDay(today, -1)}T19:00:00.000Z`,
        endedAt: `${shiftDay(today, -1)}T19:45:00.000Z`,
        status: "completed",
        notes: "",
        feeling: "balanced",
        source: "manual",
        rawPrompt: "",
        planId: null,
        planVersion: null,
        routineId: null,
        targetSnapshot: null,
        restEndsAt: null,
        adjustments: [],
        exercises: [
          {
            id: "ex-bp-1",
            exerciseId: "bench-press",
            restSeconds: 90,
            snapshot: null,
            sets: [
              { id: "set-1", type: "normal", weight: 80, reps: 5, completed: true, seconds: 0, rir: null },
              { id: "set-2", type: "normal", weight: 80, reps: 5, completed: true, seconds: 0, rir: null },
            ],
          },
        ],
      },
    });
    assert.equal(woSave.status, 200);
    const dietSave = await call("/api/records", owner.token, "POST", {
      opId: "op-report-diet-1",
      id: "report-diet-1",
      kind: "diet",
      baseVersion: 0,
      deleted: false,
      data: { date: today, meal: "lunch", name: "牛肉饭", calories: 720, protein: 55, carbs: 85, fat: 18, source: "manual" },
    });
    assert.equal(dietSave.status, 200);

    const analytics = await (await call(`/api/web/analytics?days=30&through=${today}`, owner.token)).json() as any;
    const { activityReport, correlations, coverageSummary } = analytics.appleDaily;
    assert.equal(activityReport.latestSteps, 5000);
    assert.equal(activityReport.latestDistanceKm, 3.75);
    assert.equal(activityReport.strideCm, 75);
    assert.equal(activityReport.activityTierLabel, "日常中等活动 (3,000–7,499 步)");
    assert.ok(correlations.length >= 2);
    assert.ok(correlations.some((c: any) => c.label.includes("睡眠") && c.r >= 0.9 && c.sampleDays === 4 && c.tStat > 9.9 && c.pLabel === "p < 0.01"));
    assert.ok(correlations.some((c: any) => c.label.includes("步数") && c.r >= 0.9 && c.sampleDays === 4 && c.tStat > 9.9 && c.pLabel === "p < 0.01"));

    assert.equal(coverageSummary.syncedCount, 5);
    assert.equal(coverageSummary.missingMetrics.length, coverageSummary.totalCount - 5);
    assert.equal(coverageSummary.categoryProgress.length, 4);
    assert.ok(coverageSummary.categoryProgress.some((c: any) => c.category === "体成分" && c.synced === 0));

    assert.equal(analytics.trainingSummary.sessions, 1);
    assert.equal(analytics.trainingSummary.activeDays, 1);
    assert.equal(analytics.trainingSummary.workSets, 2);
    assert.equal(analytics.trainingSummary.tonnageKg, 800);
    assert.equal(analytics.trainingSummary.dietDaysLogged, 1);

    assert.equal(analytics.appleWorkouts.totalCount, 2);
    assert.equal(analytics.appleWorkouts.realDeviceCount, 1);
    assert.equal(analytics.appleWorkouts.demoCount, 1);
    assert.equal(analytics.appleWorkouts.realDeviceStats.totalCount, 1);
    assert.equal(analytics.appleWorkouts.realDeviceStats.totalCaloriesKcal, 310);
    assert.equal(analytics.appleWorkouts.realDeviceStats.totalDurationSeconds, 2700);
    assert.equal(analytics.appleWorkouts.realDeviceStats.byActivity.length, 1);
    assert.equal(analytics.appleWorkouts.realDeviceStats.byActivity[0].title, "传统力量训练");
    const demoRow = analytics.appleWorkouts.recent.find((w: any) => w.id === "demo_outdoor_run");
    const realRow = analytics.appleWorkouts.recent.find((w: any) => w.id !== "demo_outdoor_run");
    assert.equal(demoRow?.isDemo, true);
    assert.equal(realRow?.isDemo, false);
  } finally {
    db.close();
  }
});

test("Student's t 检验过滤小样本伪相关与 Katch-McArdle 实测代谢对比", async () => {
  const { db, call, owner } = setup();
  try {
    const today = localDate();
    const device = await (await call("/api/integrations/apple-health/tokens", owner.token, "POST", { label: "噪音测试设备" })).json() as any;

    // 4 days with r ~ 0.50 noise (passes naive |r|>=0.45 threshold, but df=2 t~0.82 < 2.920 => rejected by t-test)
    for (const [offset, sleepMin, hrv, steps, activeKcal, restKcal] of [
      [-3, 360, 35.0, 4000, 200, 1400],
      [-2, 400, 42.0, 5000, 240, 1410],
      [-1, 440, 38.0, 6000, 210, 1390],
      [0, 480, 41.0, 7000, 235, 1400],
    ] as const) {
      await call("/api/integrations/apple-health/daily", device.token, "POST", {
        date: shiftDay(today, offset),
        sleepMinutes: sleepMin,
        hrvMs: hrv,
        steps,
        activeEnergyKcal: activeKcal,
        restingEnergyKcal: restKcal,
        weightKg: 76,
        leanBodyMassKg: 60,
      });
    }

    const analytics = await (await call(`/api/web/analytics?days=30&through=${today}`, owner.token)).json() as any;
    assert.deepEqual(analytics.appleDaily.correlations, []);
    assert.ok(analytics.appleDaily.bodyReport.metabolic.measuredVsPredictedPct < -10);
    assert.ok(analytics.appleDaily.bodyReport.insights.some((line: string) => line.includes("热适应")));
  } finally {
    db.close();
  }
});

test("当天半日累积静息能量不误触发全天 BMR 热适应预警", async () => {
  const { db, call, owner } = setup();
  try {
    const today = localDate();
    const device = await (await call("/api/integrations/apple-health/tokens", owner.token, "POST", { label: "半日设备" })).json() as any;
    await call("/api/integrations/apple-health/daily", device.token, "POST", {
      date: today,
      weightKg: 79.2,
      leanBodyMassKg: 60.1,
      restingEnergyKcal: 899.8,
    });
    const analytics = await (await call(`/api/web/analytics?days=30&through=${today}`, owner.token)).json() as any;
    assert.equal(analytics.appleDaily.bodyReport.metabolic.appleRestingAvgKcal, null);
    assert.equal(analytics.appleDaily.bodyReport.metabolic.measuredVsPredictedPct, null);
    assert.ok(!analytics.appleDaily.bodyReport.insights.some((line: string) => line.includes("热适应")));
    assert.ok(analytics.appleDaily.bodyReport.insights.some((line: string) => line.includes("满整天")));
  } finally {
    db.close();
  }
});

test("部分睡眠补传不会覆盖已有完整睡眠，v2 混传带时间戳与仅时长分期均被保留", async () => {
  const { db, call, owner } = setup();
  try {
    const day = shiftDay(localDate(), -1);
    const dayBefore = shiftDay(day, -1);
    const device = await (await call("/api/integrations/apple-health/tokens", owner.token, "POST", { label: "睡眠合并机" })).json() as any;
    const path = "/api/integrations/apple-health/daily";

    // 1. Sync full 420-min sleep for `day`, then sync only the last 30-min sample for `day`
    const fullRes = await call(path, device.token, "POST", {
      date: day,
      shortcutGenVersion: "3",
      sleepSamples: `核心睡眠|${day}T00:00:00+08:00|${day}T07:00:00+08:00|25200`,
    });
    assert.equal(fullRes.status, 200);
    assert.equal(((await fullRes.json()) as any).daily.sleepMinutes, 420);

    const partialRes = await call(path, device.token, "POST", {
      date: day,
      shortcutGenVersion: "3",
      sleepSamples: `核心睡眠|${day}T06:30:00+08:00|${day}T07:00:00+08:00|1800`,
    });
    assert.equal(partialRes.status, 200);
    assert.equal(((await partialRes.json()) as any).daily.sleepMinutes, 420);

    // 2. v2 upload mixing timestamped 60m core sample and duration-only 45m deep sample
    const v2Res = await call(path, device.token, "POST", {
      date: dayBefore,
      shortcutGenVersion: "2",
      sleepSamples: [
        `核心睡眠|${dayBefore}T01:00:00+08:00|${dayBefore}T02:00:00+08:00|3600`,
        "深度睡眠|||2700",
      ].join("\n"),
    });
    assert.equal(v2Res.status, 200);
    const v2Daily = ((await v2Res.json()) as any).daily;
    assert.equal(v2Daily.sleepMinutes, 105);
    assert.equal(v2Daily.sleepCoreMinutes, 60);
    assert.equal(v2Daily.sleepDeepMinutes, 45);
  } finally {
    db.close();
  }
});
