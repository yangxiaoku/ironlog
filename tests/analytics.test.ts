import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAcwrSeries,
  calculateIpfGlPoints,
  calculateMonotonyAndStrain,
  calculateSetInol,
  estimatedOneRepMax,
  evaluateEffortAndRepZones,
  evaluateNutritionEnergyBalance,
  evaluateProteinAdequacy,
  evaluateSessionInol,
  evaluateSymmetryAndFrequency,
  evaluateWeeklyMuscleDose,
  evaluateWeightChangeRate,
  localDate,
  type Workout,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";

function fixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("analytics-test-owner");
  const other = auth.login("analytics-test-other");
  const call = (url: string, options: { token?: string; method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: "Bearer " + (options.token ?? owner.token),
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  let seq = 0;
  const save = (kind: "workout" | "diet" | "weight" | "profile", id: string, data: unknown, baseVersion = 0) =>
    store.mutate(owner.userId, { id, kind, opId: "analytics-op-" + seq++, data, baseVersion, deleted: false });
  return { db, app, store, call, save, owner, other };
}

test("运动科学公式单元验证：ACWR、单调性、肌群剂量、INOL、IPF GL 与营养评估", () => {
  // 1. ACWR (Gabbett 2016)
  const days: { date: string; load: number }[] = [];
  for (let i = 0; i < 35; i++) {
    // 5 weeks of steady 1000 load per day
    days.push({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, load: 1000 });
  }
  const steadyAcwr = calculateAcwrSeries(days, 7, 28);
  assert.equal(steadyAcwr.length, 35);
  // In steady state: 7-day acute = 7000, 28-day chronic weekly average = 28000 / 4 = 7000 => ACWR = 1.0 (Sweet Spot)
  const lastSteady = steadyAcwr[steadyAcwr.length - 1];
  assert.equal(lastSteady.acwr, 1);
  assert.equal(lastSteady.zone, "sweet_spot");

  // Spike load to 2500 for acute days
  const spikedDays = days.map((d, idx) => (idx >= 28 ? { ...d, load: 2500 } : d));
  const spikedAcwr = calculateAcwrSeries(spikedDays, 7, 28);
  const lastSpike = spikedAcwr[spikedAcwr.length - 1];
  assert.ok(lastSpike.acwr >= 1.5);
  assert.equal(lastSpike.zone, "danger");

  // 2. Foster (1998) Monotony & Strain
  // Flat load: high monotony
  const flat = [1000, 1000, 1000, 1000, 1000, 1000, 1000];
  const flatResult = calculateMonotonyAndStrain(flat);
  assert.ok(flatResult.monotony >= 2.0);
  assert.equal(flatResult.monotonyLevel, "high");

  // Undulating load with rest days: good variation
  const undulating = [2000, 0, 1800, 0, 2200, 1500, 0];
  const undulatingResult = calculateMonotonyAndStrain(undulating);
  assert.ok(undulatingResult.monotony < 1.5);
  assert.equal(undulatingResult.monotonyLevel, "low");

  // 3. Schoenfeld (2017) Muscle Dose
  const maint = evaluateWeeklyMuscleDose("chest", "胸部", 6);
  assert.equal(maint.category, "maintenance");
  const opt = evaluateWeeklyMuscleDose("chest", "胸部", 15);
  assert.equal(opt.category, "optimal");
  const over = evaluateWeeklyMuscleDose("chest", "胸部", 24);
  assert.equal(over.category, "overreaching");

  // 4. INOL (Hristov)
  // 5 reps @ 80% (80kg with 100kg 1RM): 5 / (100 - 80) = 0.25
  const inol1 = calculateSetInol(5, 80, 100);
  assert.equal(inol1, 0.25);
  // 3 sets of 5 @ 80kg => 0.75 (optimal session)
  const session = evaluateSessionInol("bench", "杠铃卧推", 100, [
    { reps: 5, weight: 80 },
    { reps: 5, weight: 80 },
    { reps: 5, weight: 80 },
  ]);
  assert.equal(session.sessionInol, 0.75);
  assert.equal(session.category, "optimal");

  // 5. IPF GL Points
  // 75kg male with 100kg bench press (~52.9 pts -> advanced), 80kg bench (~42.3 pts -> intermediate)
  const glBench = calculateIpfGlPoints("male", 75, 100, "classic_bench");
  assert.ok(glBench.score >= 47 && glBench.score < 63);
  assert.equal(glBench.tier, "advanced");
  const glBenchSolid = calculateIpfGlPoints("male", 75, 80, "classic_bench");
  assert.ok(glBenchSolid.score >= 35 && glBenchSolid.score < 47);
  assert.equal(glBenchSolid.tier, "intermediate");

  // 6. Morton (2018) Protein Adequacy (threshold 1.6 g/kg)
  const proteinLogged = [
    { date: "2026-11-01", proteinGrams: 140 }, // 140 / 75 = 1.86 >= 1.6
    { date: "2026-11-02", proteinGrams: 130 }, // 130 / 75 = 1.73 >= 1.6
    { date: "2026-11-03", proteinGrams: 90 }, // 90 / 75 = 1.2 < 1.6
  ];
  const proteinEval = evaluateProteinAdequacy(proteinLogged, 75);
  assert.equal(proteinEval.daysMeetingTarget, 2);
  assert.equal(proteinEval.complianceRatePct, 67);
  assert.equal(proteinEval.status, "optimal");

  // 7. Helms (2014) Weight Rate
  const weights = [
    { date: "2026-11-01", weight: 80 },
    { date: "2026-11-29", weight: 78 }, // 2kg down in 4 weeks = 0.5kg/week = 0.625%/week
  ];
  const weightRate = evaluateWeightChangeRate(weights);
  assert.ok(weightRate);
  assert.equal(weightRate.category, "optimal_cut");
});

test("数据分析接口鉴权、空账户默认值、多维度指标与文献元数据", async () => {
  const { db, app, call, save, owner } = fixture();
  try {
    // 401 without auth
    const unauthorized = await app.request("/api/web/analytics");
    assert.equal(unauthorized.status, 401);

    // Empty account returns well-formed response
    const emptyRes = await call("/api/web/analytics");
    assert.equal(emptyRes.status, 200);
    const emptyData = (await emptyRes.json()) as ReturnType<typeof getWebAnalytics>;
    assert.ok(emptyData.today);
    assert.equal(emptyData.userProfile.weightKg, null);
    assert.equal(emptyData.userProfile.gender, null);
    assert.equal(emptyData.nutrition.protein.averageGramsPerKg, null);
    assert.equal(emptyData.acwr.referenceWeightKg, null);
    assert.equal(emptyData.acwr.current.acwr, 0);
    assert.equal(emptyData.muscles.audits.length, 6);
    assert.ok(emptyData.citations.gabbett2016);
    assert.ok(emptyData.citations.schoenfeld2017);

    const today = localDate();

    // Populate user profile
    save("profile", "settings", {
      calories: 2400,
      protein: 160,
      carbs: 260,
      fat: 65,
      daysPerWeek: 4,
      targetWeight: 72,
      energyProfile: {
        weightKg: 75,
        heightCm: 178,
        sex: "male",
        birthDate: "1995-06-15",
        weightDate: today,
        activityFactor: 1.55,
        context: "general",
      },
    });

    // Populate workouts over the past 3 weeks
    for (let offset = 21; offset >= 0; offset -= 2) {
      const date = shiftDay(today, -offset);
      const workout: Workout = {
        title: "上肢推拉力量",
        date,
        startedAt: `${date}T10:00:00.000Z`,
        endedAt: `${date}T11:00:00.000Z`,
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
            id: `row-bp-${offset}`,
            exerciseId: "bench-press",
            restSeconds: 90,
            snapshot: null,
            sets: [
              { id: `s1-${offset}`, type: "normal", weight: 80, reps: 6, completed: true, seconds: 0, rir: null },
              { id: `s2-${offset}`, type: "normal", weight: 80, reps: 6, completed: true, seconds: 0, rir: null },
              { id: `s3-${offset}`, type: "normal", weight: 80, reps: 6, completed: true, seconds: 0, rir: null },
            ],
          },
          {
            id: `row-pu-${offset}`,
            exerciseId: "pull-up",
            restSeconds: 90,
            snapshot: null,
            sets: [
              { id: `s4-${offset}`, type: "normal", weight: 0, reps: 10, completed: true, seconds: 0, rir: null },
              { id: `s5-${offset}`, type: "normal", weight: 0, reps: 10, completed: true, seconds: 0, rir: null },
            ],
          },
        ],
      };
      save("workout", `wo-${offset}`, workout);
    }

    // Populate diet
    for (let offset = 6; offset >= 0; offset--) {
      const date = shiftDay(today, -offset);
      save("diet", `diet-${offset}`, {
        date,
        meal: "lunch",
        name: "鸡胸肉与米饭",
        calories: 700,
        protein: 130, // 130g protein for 75kg = 1.73 g/kg (>1.6)
        carbs: 90,
        fat: 15,
        source: "manual",
      });
    }

    // A profile weight recorded today cannot be used for a report ending yesterday.
    const historical = await (await call(`/api/web/analytics?days=30&through=${shiftDay(today, -1)}`)).json() as ReturnType<typeof getWebAnalytics>;
    assert.equal(historical.userProfile.weightKg, null);
    assert.equal(historical.acwr.referenceWeightKg, 75);
    assert.equal(historical.ipfGl.bench, null);
    assert.ok(historical.ipfGl.components.bench1RM > 0);
    assert.equal(historical.nutrition.protein.averageGramsPerDay, 130);
    assert.equal(historical.nutrition.protein.averageGramsPerKg, null);
    assert.equal(historical.nutrition.protein.complianceRatePct, null);

    // Populate weights
    save("weight", `weight_${shiftDay(today, -28)}`, { date: shiftDay(today, -28), weight: 76.5 });
    save("weight", `weight_${today}`, { date: today, weight: 75.0 });

    // Request analytics
    const res = await call(`/api/web/analytics?days=30&through=${today}`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as ReturnType<typeof getWebAnalytics>;
    assert.ok(data.periodComparison.current.sessions > 0);
    assert.equal(data.periodComparison.previous.sessions, 0);
    assert.equal(data.periodComparison.deltas.sessionsPct, null);

    // 1. User profile
    assert.equal(data.userProfile.weightKg, 75);
    assert.equal(data.userProfile.gender, "male");
    assert.equal(data.acwr.referenceWeightKg, null);

    // 2. ACWR
    assert.ok(data.acwr.series.length > 0);
    assert.ok(data.acwr.current.acuteLoad > 0);
    assert.ok(data.acwr.current.chronicLoad > 0);
    assert.ok(data.acwr.current.acwr > 0);

    // 3. Monotony & Strain
    assert.ok(data.monotony.current.totalWeeklyLoad > 0);
    assert.ok(data.monotony.current.monotony > 0);

    // 4. Schoenfeld Muscle Audit
    const chestAudit = data.muscles.audits.find((m) => m.muscleKey === "chest");
    assert.ok(chestAudit);
    assert.ok(chestAudit.sets > 0);

    // 5. INOL
    assert.ok(data.inol.lifts.length > 0);
    const benchInol = data.inol.lifts.find((l) => l.exerciseId === "bench-press");
    assert.ok(benchInol);
    assert.ok(benchInol.sessionInol > 0);
    assert.ok(benchInol.oneRepMax >= 80);

    // 6. IPF GL
    assert.ok(data.ipfGl.bench);
    assert.ok(data.ipfGl.bench.score > 0);
    assert.equal(data.ipfGl.bench.liftType, "classic_bench");

    // 7. Nutrition Morton
    assert.equal(data.nutrition.protein.totalDaysLogged, 7);
    assert.equal(data.nutrition.protein.complianceRatePct, 100);
    assert.equal(data.nutrition.protein.status, "optimal");

    // 8. Helms Weight Rate
    assert.ok(data.bodyweight.report);
    assert.equal(data.bodyweight.report.category, "optimal_cut");

    // 9. Citations
    assert.equal(data.citations.gabbett2016.year, 2016);
    assert.equal(data.citations.schoenfeld2017.year, 2017);
    assert.equal(data.citations.williams2017.year, 2017);
    assert.equal(data.citations.plews2013.year, 2013);
    assert.equal(data.citations.schoenfeld2016.year, 2016);
    assert.equal(data.citations.zourdos2016.year, 2016);
    assert.equal(data.citations.hall2008.year, 2008);
    assert.equal(Object.keys(data.citations).length, 12);
  } finally {
    db.close();
  }
});

test("睡眠报表区分缺测与汇总，按相邻夜晚比较睡眠中点并隔离账号", async () => {
  const { db, call, owner, other } = fixture();
  try {
    const through = shiftDay(localDate(), -2);
    const date = (offset: number) => shiftDay(through, offset);
    const putDaily = db.prepare("INSERT INTO apple_health_daily VALUES (?, ?, ?, ?)");
    const put = (offset: number, data: object) =>
      putDaily.run(owner.userId, date(offset), new Date().toISOString(), JSON.stringify({ source: "shortcut", ...data }));
    const time = (offset: number, label: string) => Date.parse(`${date(offset)}T${label}:00+08:00`);
    const timed = (offset: number, start: string) => [time(offset - 1, start), time(offset, "04:00")];
    const first = timed(-13, "20:00");
    put(-13, {
      sleepMinutes: 900,
      syncedSleepObservations: [
        { stage: "asleep", interval: first },
        { stage: "core", interval: [first[0], time(-13, "03:00")] },
        { stage: "deep", interval: [time(-13, "02:00"), first[1]] },
        { stage: "awake", interval: [first[1], time(-13, "04:15")] },
        { stage: "asleep", interval: [time(-13, "14:00"), time(-13, "14:30")] },
        { stage: "rem", minutes: 75 },
      ],
    });
    for (const [offset, start] of [[-12, "20:40"], [-11, "19:40"], [-10, "20:00"]] as const) {
      put(offset, { syncedSleepObservations: [{ stage: "asleep", interval: timed(offset, start) }] });
    }
    put(-9, { sleepMinutes: 0, steps: 1000 });
    put(-8, { sleepMinutes: 410, sleepCoreMinutes: 260, sleepDeepMinutes: 70 });
    put(-6, { sleepMinutes: 420 });
    put(-3, { sleepMinutes: 390 });
    put(1, { sleepMinutes: 540 });
    for (let offset = -20; offset <= -14; offset++) put(offset, { sleepMinutes: 400 });

    const path = `/api/web/analytics?days=14&through=${through}`;
    const result = await call(path);
    assert.equal(result.status, 200);
    const data = await result.json() as ReturnType<typeof getWebAnalytics>;
    const { sleepReport } = data;
    assert.equal(sleepReport.series.length, 14);
    assert.equal(sleepReport.series.at(-1)?.date, through);
    assert.equal(sleepReport.current.recordedDays, 7);
    assert.equal(sleepReport.current.averageMinutes, 450);
    assert.equal(sleepReport.current.referenceDays, 5);
    assert.equal(sleepReport.previous.recordedDays, 7);
    assert.equal(sleepReport.averageChangeMinutes, 50);
    assert.deepEqual(sleepReport.timing, { measuredDays: 4, adjacentPairs: 3, medianShiftMinutes: 20 });
    assert.equal(sleepReport.series[0]?.minutes, 510);
    assert.equal(sleepReport.series[0]?.window?.endAt, new Date(first[1]!).toISOString());
    assert.equal(sleepReport.series[0]?.source, "intervals");
    assert.equal(sleepReport.series[0]?.stages, null);
    assert.equal(sleepReport.series[4]?.minutes, null);
    assert.deepEqual(sleepReport.series[5]?.stages, { core: 260, deep: 70, rem: null });
    assert.equal(sleepReport.series[5]?.source, "summary");
    assert.equal(sleepReport.series[5]?.window, null);
    assert.equal(data.appleDaily.averages.sleepMinutes, sleepReport.current.averageMinutes);
    assert.equal(data.appleDaily.series[0]?.sleepMinutes, sleepReport.series[0]?.minutes);
    assert.equal(JSON.stringify(data).includes("syncedSleepObservations"), false);

    db.prepare("DELETE FROM apple_health_daily WHERE user_id = ? AND date = ?").run(owner.userId, date(-12));
    const sparse = await (await call(path)).json() as ReturnType<typeof getWebAnalytics>;
    assert.equal(sparse.sleepReport.averageChangeMinutes, null);
    assert.deepEqual(sparse.sleepReport.timing, { measuredDays: 3, adjacentPairs: 1, medianShiftMinutes: null });
    const isolated = await (await call(path, { token: other.token })).json() as ReturnType<typeof getWebAnalytics>;
    assert.equal(isolated.sleepReport.current.recordedDays, 0);
    assert.equal(isolated.sleepReport.current.averageMinutes, null);
  } finally {
    db.close();
  }
});

test("ACWR EWMA、去耦合模型、OLS 回归减重速率与去脂体重蛋白折算", () => {
  // 1. Steady 1000/day -> EWMA & Uncoupled ACWR stay at 1.00
  const steadyLoads = Array.from({ length: 28 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    load: 1000,
  }));
  const steady = calculateAcwrSeries(steadyLoads);
  const lastSteady = steady[steady.length - 1]!;
  assert.equal(lastSteady.ewmaAcwr, 1);
  assert.equal(lastSteady.ewmaZone, "sweet_spot");
  assert.equal(lastSteady.uncoupledAcwr, 1);

  // 2. Spiked last 7 days (2500/day vs prior 21 days 1000/day)
  // Uncoupled separates acute 7d from prior 21d (2500 / 1000 = 2.5), avoiding mathematical coupling attenuation
  const spikedLoads = steadyLoads.map((item, idx) =>
    idx >= 21 ? { ...item, load: 2500 } : item,
  );
  const spiked = calculateAcwrSeries(spikedLoads);
  // Williams (2017): EWMA reacts immediately on day 1 of spike faster than rolling average
  assert.ok(spiked[21]!.ewmaAcwr > spiked[21]!.acwr);
  const lastSpike = spiked[spiked.length - 1]!;
  assert.equal(lastSpike.uncoupledAcwr, 2.5);
  assert.ok(lastSpike.uncoupledAcwr > lastSpike.acwr);
  assert.ok(lastSpike.ewmaAcwr >= 1.4);
  assert.ok(lastSpike.ewmaZone === "caution" || lastSpike.ewmaZone === "danger");

  // 3. Weight rate OLS regression resists end-day water retention spike
  const noisyCut = [
    { date: "2026-11-01", weight: 80.0 },
    { date: "2026-11-08", weight: 79.3 },
    { date: "2026-11-15", weight: 78.6 },
    { date: "2026-11-22", weight: 77.9 },
    { date: "2026-11-29", weight: 79.0 }, // +1.1kg temporary spike vs day 21
  ];
  const olsReport = evaluateWeightChangeRate(noisyCut);
  assert.ok(olsReport);
  assert.equal(olsReport.trendMethod, "ols_regression");
  assert.ok(olsReport.rSquared != null && olsReport.rSquared > 0 && olsReport.rSquared < 1);
  assert.equal(olsReport.category, "optimal_cut");
  assert.ok(olsReport.weeklySlopeKg < -0.3);

  // 4. Protein adequacy lean body mass reference
  const prot = evaluateProteinAdequacy(
    [{ date: "2026-11-01", proteinGrams: 130 }],
    75,
    { leanBodyMassKg: 60 },
  );
  assert.equal(prot.leanMassGramsPerKg, 2.17);
});

test("RIR 储备次修正 1RM 估算与去脂体重蛋白接口对接", async () => {
  const { db, call, save, owner } = fixture();
  try {
    const today = localDate();
    save("profile", "settings", {
      calories: 2400,
      protein: 150,
      carbs: 250,
      fat: 70,
      daysPerWeek: 4,
      targetWeight: 74,
      energyProfile: {
        weightKg: 75,
        heightCm: 178,
        sex: "male",
        birthDate: "1995-06-15",
        weightDate: today,
        activityFactor: 1.55,
        context: "general",
      },
    });
    save("workout", "wo-rir", {
      title: "卧推实力测试",
      date: today,
      startedAt: `${today}T10:00:00.000Z`,
      endedAt: `${today}T10:45:00.000Z`,
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
          id: "ex-bp",
          exerciseId: "bench-press",
          restSeconds: 120,
          snapshot: null,
          sets: [
            { id: "s-rir", type: "normal", weight: 100, reps: 5, completed: true, seconds: 0, rir: 2 },
          ],
        },
      ],
    });
    save("diet", "diet-rir", {
      date: today,
      meal: "dinner",
      name: "牛排",
      calories: 700,
      protein: 132,
      carbs: 40,
      fat: 25,
      source: "manual",
    });

    const device = (await (await call("/api/integrations/apple-health/tokens", {
      method: "POST",
      body: { label: "LBM测仪" },
    })).json()) as any;
    await call("/api/integrations/apple-health/daily", {
      method: "POST",
      token: device.token,
      body: { date: today, weightKg: 75, leanBodyMassKg: 60 },
    });

    const analytics = (await (await call(`/api/web/analytics?days=30&through=${today}`)).json()) as ReturnType<typeof getWebAnalytics>;
    const expectedRir1RM = Math.round(estimatedOneRepMax(100, 7) * 10) / 10;
    const flat1RM = Math.round(estimatedOneRepMax(100, 5) * 10) / 10;
    assert.ok(expectedRir1RM > flat1RM);
    assert.equal(analytics.ipfGl.components.bench1RM, expectedRir1RM);
    assert.equal(analytics.nutrition.protein.leanMassGramsPerKg, 2.2);
  } finally {
    db.close();
  }
});

test("ACWR 前缀和与 INOL 1RM/推举筛查及非主项周累计计算", async () => {
  // 1. 90-day varied load sequence: prefix-sum ACWR/uncoupled must match brute-force window sums
  const variedLoads = Array.from({ length: 90 }, (_, i) => ({
    date: shiftDay("2026-01-01", i),
    load: (i % 3 === 0 ? 0 : 1200 + (i % 7) * 350),
  }));
  const acwrSeries = calculateAcwrSeries(variedLoads, 7, 28);
  assert.equal(acwrSeries.length, 90);
  for (let i = 0; i < variedLoads.length; i++) {
    const acuteStart = Math.max(0, i - 6);
    const chronicStart = Math.max(0, i - 27);
    const bruteAcute = variedLoads.slice(acuteStart, i + 1).reduce((s, d) => s + d.load, 0);
    const chronicSlice = variedLoads.slice(chronicStart, i + 1);
    const bruteChronic = chronicSlice.reduce((s, d) => s + d.load, 0) / Math.max(1, chronicSlice.length / 7);
    const expectedAcwr = bruteChronic > 0 ? Math.round((bruteAcute / bruteChronic) * 100) / 100 : bruteAcute > 0 ? 1.5 : 0;
    assert.equal(acwrSeries[i]!.acuteLoad, Math.round(bruteAcute));
    assert.equal(acwrSeries[i]!.chronicLoad, Math.round(bruteChronic));
    assert.equal(acwrSeries[i]!.acwr, expectedAcwr);

    const priorSlice = variedLoads.slice(chronicStart, acuteStart);
    let expectedUncoupled: number | null = null;
    if (priorSlice.length >= 7) {
      const priorWeekly = priorSlice.reduce((s, d) => s + d.load, 0) / Math.max(1, priorSlice.length / 7);
      if (priorWeekly > 0) expectedUncoupled = Math.round((bruteAcute / priorWeekly) * 100) / 100;
    }
    assert.equal(acwrSeries[i]!.uncoupledAcwr, expectedUncoupled);
  }

  // 2. INOL: 1RM single counts toward weeklyInol & leg-press does not hijack overhead press slot
  const { db, call, save } = fixture();
  try {
    const today = localDate();
    save("workout", "wo-compound", {
      title: "推腿混合日",
      date: today,
      startedAt: `${today}T09:00:00.000Z`,
      endedAt: `${today}T10:00:00.000Z`,
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
          id: "ex-lp",
          exerciseId: "leg-press",
          restSeconds: 90,
          snapshot: null,
          sets: [
            { id: "lp-1", type: "normal", weight: 160, reps: 10, completed: true, seconds: 0, rir: null },
          ],
        },
        {
          id: "ex-ohp",
          exerciseId: "overhead-press",
          restSeconds: 120,
          snapshot: null,
          sets: [
            { id: "ohp-1", type: "normal", weight: 60, reps: 1, completed: true, seconds: 0, rir: null },
          ],
        },
      ],
    });
    const compoundRes = (await (await call(`/api/web/analytics?days=30&through=${today}`)).json()) as ReturnType<typeof getWebAnalytics>;
    const ohpInol = compoundRes.inol.lifts.find((l) => l.exerciseId === "overhead-press");
    assert.ok(ohpInol, "overhead-press should be selected for press INOL slot instead of leg-press");
    assert.ok(ohpInol.sessionInol > 0);
    assert.ok(ohpInol.weeklyInol >= ohpInol.sessionInol, "1RM single must contribute to weeklyInol");
    assert.equal(compoundRes.inol.lifts.find((l) => l.exerciseId === "leg-press"), undefined);

    // 3. Fallback non-compound lifts should compute real weeklyInol rather than 0
    const { db: db2, call: call2, save: save2 } = fixture();
    try {
      save2("workout", "wo-fallback", {
        title: "划船专项",
        date: today,
        startedAt: `${today}T11:00:00.000Z`,
        endedAt: `${today}T11:40:00.000Z`,
        status: "completed",
        notes: "",
        feeling: "easy",
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
            id: "ex-row",
            exerciseId: "barbell-row",
            restSeconds: 90,
            snapshot: null,
            sets: [
              { id: "r-1", type: "normal", weight: 70, reps: 8, completed: true, seconds: 0, rir: null },
              { id: "r-2", type: "normal", weight: 70, reps: 8, completed: true, seconds: 0, rir: null },
            ],
          },
        ],
      });
      const fbRes = (await (await call2(`/api/web/analytics?days=30&through=${today}`)).json()) as ReturnType<typeof getWebAnalytics>;
      const rowInol = fbRes.inol.lifts.find((l) => l.exerciseId === "barbell-row");
      assert.ok(rowInol);
      assert.ok(rowInol.weeklyInol > 0, "fallback exercise should report computed weeklyInol");
      assert.equal(rowInol.weeklyInol, rowInol.sessionInol);
    } finally {
      db2.close();
    }
  } finally {
    db.close();
  }
});

test("高次数 1RM 不断崖下跌、协同肌群 0.5 折算组数及罗马尼亚硬拉折算三大项", async () => {
  const { db, call, save } = fixture();
  try {
    const today = localDate();
    save("weight", `weight_${today}`, { date: today, weight: 75 });
    save("workout", "wo-algo-audit", {
      title: "推拉下肢混合验证",
      date: today,
      startedAt: `${today}T10:00:00.000Z`,
      endedAt: `${today}T11:00:00.000Z`,
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
          id: "ex-bp",
          exerciseId: "bench-press",
          restSeconds: 90,
          snapshot: null,
          sets: [
            { id: "bp-1", type: "normal", weight: 80, reps: 12, completed: true, seconds: 0, rir: null },
            { id: "bp-2", type: "normal", weight: 80, reps: 12, completed: true, seconds: 0, rir: null },
          ],
        },
        {
          id: "ex-sq",
          exerciseId: "squat",
          restSeconds: 120,
          snapshot: null,
          sets: [
            { id: "sq-1", type: "normal", weight: 100, reps: 5, completed: true, seconds: 0, rir: null },
          ],
        },
        {
          id: "ex-rdl",
          exerciseId: "romanian-deadlift",
          restSeconds: 90,
          snapshot: null,
          sets: [
            { id: "rdl-1", type: "normal", weight: 70, reps: 10, completed: true, seconds: 0, rir: null },
          ],
        },
      ],
    });

    const analytics = (await (await call(`/api/web/analytics?days=30&through=${today}`)).json()) as ReturnType<typeof getWebAnalytics>;
    // 1. 12-rep bench set must compute Epley 1RM (80 * 1.4 = 112), not collapse to 80
    assert.equal(analytics.ipfGl.components.bench1RM, 112);

    // 2. bench-press (2 sets -> secondary shoulders/arms +1 each) + squat (1 set -> secondary core +0.5)
    //    + romanian-deadlift (1 set -> secondary back/core +0.5 each)
    const auditMap = new Map(analytics.muscles.audits.map((a) => [a.muscleKey, a.sets]));
    assert.equal(auditMap.get("chest"), 2);
    assert.equal(auditMap.get("shoulders"), 1);
    assert.equal(auditMap.get("arms"), 1);
    assert.equal(auditMap.get("legs"), 2);
    assert.equal(auditMap.get("back"), 0.5);
    assert.equal(auditMap.get("core"), 1);

    // 3. RDL (70 * (1 + 10/30) = 93.333...) reports exact Epley 1RM (93.3) without synthetic multipliers
    const rawRdl1Rm = estimatedOneRepMax(70, 10);
    const expectedRdl1Rm = Math.round(rawRdl1Rm * 10) / 10;
    assert.equal(analytics.ipfGl.components.deadliftRaw1RM, expectedRdl1Rm);
    assert.equal(analytics.ipfGl.components.deadlift1RM, expectedRdl1Rm);
    assert.equal(analytics.ipfGl.components.deadliftSourceName, "罗马尼亚硬拉");

    // 4. Symmetry, frequency, effort spectrum, and period breakdown populated cleanly
    assert.equal(analytics.muscles.symmetry?.pushPullStatus, "push_dominant");
    assert.equal(analytics.effortSpectrum?.totalWorkSets, 4);
    assert.equal(analytics.effortSpectrum?.repZones.strength.sets, 1);
    assert.equal(analytics.effortSpectrum?.repZones.hypertrophy.sets, 3);
    assert.equal(analytics.weeklyBreakdown.length, 1);
    assert.equal(analytics.exerciseProgress.length, 3);
  } finally {
    db.close();
  }
});

test("科学拓展算法验证：推拉对称性、RIR 强度分布与自适应 TDEE 反推", () => {
  const sym = evaluateSymmetryAndFrequency(
    { chest: 10, shoulders: 4, back: 12, legs: 14, arms: 6, core: 4 },
    { chest: 8, back: 8, legs: 6, shoulders: 8, arms: 6, core: 4 },
  );
  assert.equal(sym.pushSets, 12);
  assert.equal(sym.pullSets, 12);
  assert.equal(sym.pushPullRatio, 1);
  assert.equal(sym.pushPullStatus, "balanced");
  assert.equal(sym.frequencyByMuscle.chest, 2);

  const effort = evaluateEffortAndRepZones([
    { reps: 5, rir: 2, weight: 100, mode: "reps" },
    { reps: 8, rir: 1, weight: 80, mode: "reps" },
    { reps: 15, rir: 4, weight: 40, mode: "reps" },
  ]);
  assert.equal(effort.repZones.strength.sets, 1);
  assert.equal(effort.repZones.hypertrophy.sets, 1);
  assert.equal(effort.repZones.metabolic.sets, 1);
  assert.equal(effort.rirDistribution.loggedCount, 3);
  assert.equal(effort.stimulatingSets, 2);

  const energy = evaluateNutritionEnergyBalance({
    dailyMacros: [
      { date: "2026-11-01", calories: 2200, protein: 160, carbs: 240, fat: 66, isTrainingDay: true },
      { date: "2026-11-02", calories: 2000, protein: 150, carbs: 200, fat: 66, isTrainingDay: false },
      { date: "2026-11-03", calories: 2200, protein: 160, carbs: 240, fat: 66, isTrainingDay: true },
      { date: "2026-11-04", calories: 2000, protein: 150, carbs: 200, fat: 66, isTrainingDay: false },
      { date: "2026-11-05", calories: 2100, protein: 155, carbs: 220, fat: 66, isTrainingDay: true },
    ],
    targetCalories: 2100,
    weightSlopeKgPerWeek: -0.5, // ~550 kcal/day deficit => TDEE ~ 2100 + 550 = 2650 kcal
    weightSampleCount: 5,
    weightRSquared: 0.85,
  });
  assert.equal(energy.avgCalories, 2100);
  assert.equal(energy.estimatedTdeeKcal, 2650);
  assert.equal(energy.trainingDayAvgKcal, 2167);
  assert.equal(energy.restDayAvgKcal, 2000);
});

test("体重变化斜率同日去重与 Huber IRLS 抗极端水肿噪点", () => {
  // 1. Clean linear -0.5 kg/week cut with multiple same-day weigh-ins still recovers exact -0.5 slope & r2=1
  const cleanSameDay = evaluateWeightChangeRate([
    { date: "2026-11-01", weight: 79.8 },
    { date: "2026-11-01", weight: 80.2 }, // daily mean = 80.0
    { date: "2026-11-08", weight: 79.5 },
    { date: "2026-11-15", weight: 79.0 },
    { date: "2026-11-22", weight: 78.5 },
    { date: "2026-11-29", weight: 78.0 },
  ]);
  assert.ok(cleanSameDay);
  assert.equal(cleanSameDay.weeklySlopeKg, -0.5);
  assert.equal(cleanSameDay.rSquared, 1);
  assert.equal(cleanSameDay.category, "optimal_cut");

  // 2. Extreme +3.0 kg endpoint water-retention jump on day 28 would flip naive OLS positive (+0.10),
  //    but Theil-Sen + Huber IRLS downweights the outlier and preserves the underlying cut trend.
  const spikedCut = evaluateWeightChangeRate([
    { date: "2026-11-01", weight: 80.0 },
    { date: "2026-11-08", weight: 79.5 },
    { date: "2026-11-15", weight: 79.0 },
    { date: "2026-11-22", weight: 78.5 },
    { date: "2026-11-29", weight: 81.0 },
  ]);
  assert.ok(spikedCut);
  assert.ok(spikedCut.weeklySlopeKg < -0.35, `expected slope < -0.35, got ${spikedCut.weeklySlopeKg}`);
  assert.equal(spikedCut.category, "optimal_cut");
});

test("全套升级：个人单品/减载偏好接口、180/365天窗口、平台期、Rep-Max、计划执行率、睡眠对照、围度、饮水与WHO有氧", async () => {
  const { db, call, save, owner } = fixture();
  try {
    const today = localDate();

    // 1. Profile quick-foods & deloadMode persistence
    save("profile", "settings", {
      calories: 2200,
      protein: 150,
      carbs: 220,
      fat: 60,
      daysPerWeek: 4,
      energyProfile: {
        weightKg: 75,
        heightCm: 175,
        sex: "male",
        birthDate: "1995-05-10",
        weightDate: today,
        activityFactor: 1.55,
        context: "general",
      },
    });

    const qfRes = await call("/api/web/profile/quick-foods", {
      method: "PUT",
      body: {
        quickFoods: [
          { id: "qf1", name: "鸡胸肉", baseGrams: 100, unit: "g", calories: 132, protein: 24, carbs: 0, fat: 3 },
        ],
      },
    });
    assert.equal(qfRes.status, 200);
    const profAfterQf = await (await call("/api/web/profile")).json();
    assert.equal(profAfterQf.profile.quickFoods.length, 1);
    assert.equal(profAfterQf.profile.quickFoods[0].name, "鸡胸肉");

    const deloadPrefRes = await call("/api/web/profile/workout-prefs", {
      method: "PUT",
      body: { deloadMode: true, deloadWeightPct: 75, deloadSetsPct: 50 },
    });
    assert.equal(deloadPrefRes.status, 200);
    const deloadPrefJson = await deloadPrefRes.json();
    assert.equal(deloadPrefJson.workoutPrefs.deloadMode, true);
    assert.equal(deloadPrefJson.workoutPrefs.deloadWeightPct, 75);

    // 2. Scheduled days for Plan Adherence + Weighted Pull-up + Plateau regression + Sleep correlation
    const d1 = shiftDay(today, -10);
    const d2 = shiftDay(today, -5);
    const d3 = today;

    // Create & apply active plan via starter plan adopt endpoint
    const starters = await (await call("/api/web/starter-plans")).json();
    const applyRes = await call(`/api/web/starter-plans/${starters[0].id}/adopt`, {
      method: "POST",
      body: { mode: "apply" },
    });
    assert.equal(applyRes.status, 201);

    // Explicit scheduled day override
    await call(`/api/web/schedule/${d1}`, {
      method: "PUT",
      body: { mode: "workout", title: "推力日", exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 5, repsMax: 8, weight: 80, seconds: 0, restSeconds: 90 }] },
    });
    await call(`/api/web/schedule/${d2}`, {
      method: "PUT",
      body: { mode: "workout", title: "推力日", exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 5, repsMax: 8, weight: 80, seconds: 0, restSeconds: 90 }] },
    });

    // Workouts: declining bench 100->95->90 (regression) + weighted pull-up (+20kg x 8 reps => 75+20=95kg 8RM)
    const mkWorkout = (date: string, benchW: number, includePullup = false): Workout => ({
      title: "推力日",
      date,
      startedAt: `${date}T10:00:00.000Z`,
      endedAt: `${date}T11:00:00.000Z`,
      status: "completed",
      notes: "",
      feeling: date === d2 ? "fatigued" : "balanced",
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
          id: `ex-bp-${date}`,
          exerciseId: "bench-press",
          restSeconds: 90,
          snapshot: null,
          sets: [
            { id: `s1-${date}`, type: "normal", weight: benchW, reps: 5, completed: true, seconds: 0, rir: null },
            { id: `s2-${date}`, type: "normal", weight: benchW, reps: 5, completed: true, seconds: 0, rir: null },
          ],
        },
        ...(includePullup
          ? [
              {
                id: `ex-pu-${date}`,
                exerciseId: "pull-up",
                restSeconds: 90,
                snapshot: null,
                sets: [
                  { id: `sp1-${date}`, type: "normal" as const, weight: 20, reps: 8, completed: true, seconds: 0, rir: null },
                ],
              },
            ]
          : []),
      ],
    });
    save("workout", "w-d1", mkWorkout(d1, 100, true));
    save("workout", "w-d2", mkWorkout(d2, 95, false));
    save("workout", "w-d3", mkWorkout(d3, 90, false));

    // Measurements + weights
    await call("/api/web/measurements", {
      method: "PUT",
      body: { date: d1, waistCm: 84, chestCm: 100, armCm: 36, hipCm: 96, notes: "" },
    });
    await call("/api/web/measurements", {
      method: "PUT",
      body: { date: d3, waistCm: 82, chestCm: 100.5, armCm: 36.2, hipCm: 95, notes: "" },
    });
    save("weight", `weight_${d1}`, { date: d1, weight: 76.0 });
    save("weight", `weight_${d3}`, { date: d3, weight: 74.8 });

    // Sleep (via apple_health_daily) + Water + Diet
    db.prepare(
      `INSERT INTO apple_health_daily (user_id, date, updated_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET data=excluded.data`,
    ).run(owner.userId, d2, new Date().toISOString(), JSON.stringify({ date: d2, updatedAt: new Date().toISOString(), source: "apple-health", sleepMinutes: 330 }));
    db.prepare(
      `INSERT INTO apple_health_daily (user_id, date, updated_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET data=excluded.data`,
    ).run(owner.userId, d3, new Date().toISOString(), JSON.stringify({ date: d3, updatedAt: new Date().toISOString(), source: "apple-health", sleepMinutes: 460 }));
    await call("/api/web/water", { method: "POST", body: { date: d1, setMl: 2400 } });
    await call("/api/web/water", { method: "POST", body: { date: d3, setMl: 2100 } });

    save("diet", "d-1", { date: d1, meal: "lunch", name: "午餐", calories: 1900, protein: 150, carbs: 190, fat: 55, source: "manual" });
    save("diet", "d-3", { date: d3, meal: "lunch", name: "午餐", calories: 2000, protein: 160, carbs: 200, fat: 60, source: "manual" });

    // Apple Health cardio run with distance + HR
    const appleDev = (await (await call("/api/integrations/apple-health/tokens", {
      method: "POST",
      body: { label: "跑步手表" },
    })).json()) as { token: string };
    const awRes = await call("/api/integrations/apple-health/workouts", {
      method: "POST",
      token: appleDev.token,
      body: {
        schemaVersion: 1,
        captureMethod: "workout",
        externalWorkoutId: "aw-run-1",
        activityType: "running",
        environment: "outdoor",
        startedAt: `${d3}T07:00:00+08:00`,
        endedAt: `${d3}T07:30:00+08:00`,
        timeZone: "Asia/Shanghai",
        durationSeconds: 1800,
        durationKind: "workout_active",
        distanceMeters: 5000,
        activeEnergyKcal: 360,
        heartRate: { avgBpm: 162, maxBpm: 178 },
      },
    });
    assert.ok(awRes.status === 200 || awRes.status === 201);

    // Verify 180d & 365d endpoints work
    const res180 = await call(`/api/web/analytics?days=180&through=${today}`);
    assert.equal(res180.status, 200);
    const data180 = (await res180.json()) as any;
    assert.equal(data180.nutrition.dailySeries.length, 180);
    assert.equal(data180.nutrition.hydration.loggedDays, 2);
    assert.equal(data180.nutrition.hydration.complianceRatePct, 100);

    const res365 = await call(`/api/web/analytics?days=365&through=${today}`);
    assert.equal(res365.status, 200);
    const data365 = (await res365.json()) as any;
    assert.equal(data365.nutrition.dailySeries.length, 365);

    // Verify Plateau regression detected for bench-press
    const bpPlateau = data180.plateaus.find((p: any) => p.id === "bench-press");
    assert.ok(bpPlateau, "bench-press regression should be flagged in plateaus");
    assert.equal(bpPlateau.status, "regression");

    // Verify Rep-Max Matrix includes weighted pull-up (74.8kg latest bw + 20kg = 94.8kg @ 8RM)
    const puRm = data180.repMaxBoard.find((r: any) => r.id === "pull-up");
    assert.ok(puRm, "weighted pull-up should appear in repMaxBoard");
    assert.equal(puRm.rm8.weight, 94.8);
    assert.equal(puRm.rm5.weight, 94.8);

    // Verify Plan Adherence populated
    assert.equal(data180.planAdherence.hasPlan, true);
    assert.ok(data180.planAdherence.scheduledSessions >= 2);
    assert.ok(data180.planAdherence.completedSessions >= 2);

    // Verify Measurements WHR, WHtR & deltas
    assert.equal(data180.bodyMeasurements.latest.waistCm, 82);
    assert.equal(data180.bodyMeasurements.deltas.waistCm, -2);
    assert.ok(data180.bodyMeasurements.whr != null);
    assert.ok(data180.bodyMeasurements.whtr != null);

    // Verify Sleep × Training pairing
    assert.equal(data180.sleepTrainingImpact.pairedDays, 2);
    assert.equal(data180.sleepTrainingImpact.goodSleep.days, 1);
    assert.equal(data180.sleepTrainingImpact.shortSleep.days, 1);

    // Verify WHO Cardio & Pace Trend
    assert.ok(data180.appleWorkouts.whoCardio.vigorousMinutes >= 30);
    assert.ok(data180.appleWorkouts.whoCardio.equivalentMinutes >= 60);
    assert.equal(data180.appleWorkouts.paceTrend.length, 1);
    assert.equal(data180.appleWorkouts.paceTrend[0].paceMinPerKm, 6);
  } finally {
    db.close();
  }
});
