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

    // Populate weights
    save("weight", `weight_${shiftDay(today, -28)}`, { date: shiftDay(today, -28), weight: 76.5 });
    save("weight", `weight_${today}`, { date: today, weight: 75.0 });

    // Request analytics
    const res = await call(`/api/web/analytics?days=30&through=${today}`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as ReturnType<typeof getWebAnalytics>;

    // 1. User profile
    assert.equal(data.userProfile.weightKg, 75);
    assert.equal(data.userProfile.gender, "male");

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
