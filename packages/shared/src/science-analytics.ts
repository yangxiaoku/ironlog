/**
 * Evidence-Based Sports Science & Exercise Physiology Analytics
 *
 * Grounded in peer-reviewed sports science literature:
 * 1. Tim Gabbett (2016, BJSM): Acute:Chronic Workload Ratio (ACWR) and injury prevention paradox.
 * 2. Brad Schoenfeld et al. (2017, JSS): Dose-response relationship of weekly working sets for hypertrophy.
 * 3. Carl Foster (1998, MSSE): Training Monotony & Strain metrics for overtraining syndrome monitoring.
 * 4. Hristo Hristov: Intensity Number of Lifts (INOL) for resistance training neuromuscular loading.
 * 5. International Powerlifting Federation (IPF, 2020): Goodlift (GL) Points relative strength coefficient.
 * 6. Robert Morton et al. (2018, BJSM): Daily protein threshold meta-analysis (>=1.6 g/kg/day).
 * 7. Eric Helms et al. (2014, JISSN): Optimal rate of weight change for muscle retention during cuts.
 */

export interface LiteratureCitation {
  id: string;
  authors: string;
  year: number;
  title: string;
  journal: string;
  doiOrUrl?: string;
  takeaway: string;
}

export const SCIENCE_CITATIONS: Record<string, LiteratureCitation> = {
  gabbett2016: {
    id: "gabbett2016",
    authors: "Gabbett, T. J.",
    year: 2016,
    title: "The training—injury prevention paradox: should athletes be training smarter and harder?",
    journal: "British Journal of Sports Medicine, 50(5), 273-280",
    takeaway: "急慢性负荷比（ACWR）处于 0.8–1.3 黄金区间时运动伤病风险最低且体能适应最佳，超过 1.5 属于高风险负荷激增区。",
  },
  schoenfeld2017: {
    id: "schoenfeld2017",
    authors: "Schoenfeld, B. J., Ogborn, D., & Krieger, J. W.",
    year: 2017,
    title: "Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis",
    journal: "Journal of Sports Sciences, 35(11), 1073-1082",
    takeaway: "每个肌群每周 10–20 组有效工作组展现出最高性价比的肌肥大剂量反应；小于 10 组属于维持或起步，大于 20 组边际效益递减并增加疲劳。",
  },
  foster1998: {
    id: "foster1998",
    authors: "Foster, C.",
    year: 1998,
    title: "Monitoring training in athletes with reference to overtraining syndrome",
    journal: "Medicine & Science in Sports & Exercise, 30(7), 1164-1168",
    takeaway: "训练单调性（Monotony = 均值 / 标准差）>= 2.0 预示负荷缺乏起伏和恢复日；训练应激（Strain = 周负荷 × 单调性）陡增是过度训练的前兆。",
  },
  hristovInol: {
    id: "hristovInol",
    authors: "Hristov, H.",
    year: 2005,
    title: "Intensity Number of Lifts (INOL): A Method for Managing Resistance Training Load",
    journal: "Strength and Conditioning Literature",
    takeaway: "INOL = 次数 / (100 - %1RM)。单练主项 0.4–1.0 为最佳负荷；单项周累计 2.0–3.0 兼顾力量刺激与中枢神经恢复。",
  },
  ipfGl2020: {
    id: "ipfGl2020",
    authors: "International Powerlifting Federation (IPF)",
    year: 2020,
    title: "IPF GL Points Formula for Classic & Equipped Powerlifting",
    journal: "IPF Technical Rules",
    takeaway: "基于体重指数曲线矫正举重重量，科学量化不同体重力量举者的绝对力量在同等体质下的相对强弱系数。",
  },
  morton2018: {
    id: "morton2018",
    authors: "Morton, R. W., et al.",
    year: 2018,
    title: "A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength",
    journal: "British Journal of Sports Medicine, 52(6), 376-384",
    takeaway: "日均蛋白质摄入达 1.6 g/kg/天时抗阻训练肌肥大效应达到显著拐点，超出 2.2 g/kg/天无额外收益。",
  },
  helms2014: {
    id: "helms2014",
    authors: "Helms, E. R., Aragon, A. A., & Fitschen, P. J.",
    year: 2014,
    title: "Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation",
    journal: "Journal of the International Society of Sports Nutrition, 11:20",
    takeaway: "减脂期将体重变化速率控制在每周 -0.5% 至 -1.0% 可最大程度保护去脂体重（瘦体重），避免力量与肌肉大量流失。",
  },
  williams2017: {
    id: "williams2017",
    authors: "Williams, S., West, S., Cross, M. J., & Stokes, K. A.",
    year: 2017,
    title: "Better way to determine the acute:chronic workload ratio?",
    journal: "British Journal of Sports Medicine, 51(3):209–210",
    takeaway: "相比等权滚动均值，指数加权移动平均（EWMA-ACWR）对近期负荷衰减更敏感，能更早识别急性训练负荷过载风险。",
  },
  plews2013: {
    id: "plews2013",
    authors: "Plews, D. J., Laursen, P. B., Stanley, J., Kilding, A. E., & Buchheit, M.",
    year: 2013,
    title: "Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring",
    journal: "Sports Medicine, 43(9):773–781",
    takeaway: "静息 HRV（rMSSD）经自然对数 ln(rMSSD) 变换后以个体均值±0.5 SD 最小有意义变化（SWC）评估恢复偏离更具生理稳定性。",
  },
};

export type AcwrZone = "deload" | "sweet_spot" | "caution" | "danger";

export interface AcwrPoint {
  date: string;
  load: number;
  acuteLoad: number;
  chronicLoad: number;
  acwr: number;
  zone: AcwrZone;
  zoneLabel: string;
  ewmaAcwr: number;
  ewmaZone: AcwrZone;
  ewmaZoneLabel: string;
  uncoupledAcwr: number | null;
}

export function classifyAcwr(acwr: number): { zone: AcwrZone; label: string; advice: string } {
  if (acwr < 0.8) {
    return {
      zone: "deload",
      label: "减载恢复区 (<0.8)",
      advice: "负荷刺激较低或处于主动恢复期，身体充分休整，适合作为周期性减载阶段。",
    };
  }
  if (acwr <= 1.3) {
    return {
      zone: "sweet_spot",
      label: "黄金收益区 (0.8–1.3)",
      advice: "最佳进阶区间！训练刺激与机能恢复达到科学平衡，运动损伤风险最低，力量与肌量超量恢复最佳。",
    };
  }
  if (acwr < 1.5) {
    return {
      zone: "caution",
      label: "警惕疲劳区 (1.3–1.5)",
      advice: "负荷增长略快，疲劳积累加速，建议密切关注睡眠、肌肉酸痛与关节感受，注意安排轻重交替。",
    };
  }
  return {
    zone: "danger",
    label: "高危负荷区 (≥1.5)",
    advice: "负荷激增（Workload Spike）！机体未经过充分耐受，组织损伤与过度训练风险显著上升，强烈建议安排主动休息或减载！",
  };
}

export function calculateAcwrSeries(
  dailyLoads: { date: string; load: number }[],
  acuteWindow = 7,
  chronicWindow = 28,
): AcwrPoint[] {
  if (!dailyLoads.length) return [];
  const sorted = [...dailyLoads].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const results: AcwrPoint[] = [];

  // Williams et al. (2017) EWMA decay constants: lambda = 2 / (N + 1)
  const lambdaAcute = 2 / (acuteWindow + 1);
  const lambdaChronic = 2 / (chronicWindow + 1);
  const prefix = new Float64Array(sorted.length + 1);
  for (let i = 0; i < sorted.length; i++) {
    prefix[i + 1] = prefix[i]! + (sorted[i]?.load ?? 0);
  }
  let ewmaAcute = 0;
  let ewmaChronic = 0;

  for (let i = 0; i < sorted.length; i++) {
    const currentItem = sorted[i];
    if (!currentItem) continue;

    if (i === 0) {
      ewmaAcute = currentItem.load;
      ewmaChronic = currentItem.load;
    } else {
      ewmaAcute = currentItem.load * lambdaAcute + (1 - lambdaAcute) * ewmaAcute;
      ewmaChronic = currentItem.load * lambdaChronic + (1 - lambdaChronic) * ewmaChronic;
    }

    const acuteStart = Math.max(0, i - acuteWindow + 1);
    const chronicStart = Math.max(0, i - chronicWindow + 1);
    const acuteLoad = prefix[i + 1]! - prefix[acuteStart]!;

    // Chronic load represents average weekly load over the chronic window (typically 4 weeks)
    const chronicSum = prefix[i + 1]! - prefix[chronicStart]!;
    const chronicLen = i + 1 - chronicStart;
    const weeksInChronic = Math.max(1, chronicLen / 7);
    const chronicLoad = chronicSum / weeksInChronic;

    const acwr = chronicLoad > 0 ? Math.round((acuteLoad / chronicLoad) * 100) / 100 : acuteLoad > 0 ? 1.5 : 0;
    const { zone, label } = classifyAcwr(acwr);

    const ewmaAcwr = ewmaChronic > 0
      ? Math.round((ewmaAcute / ewmaChronic) * 100) / 100
      : ewmaAcute > 0
        ? 1.5
        : 0;
    const ewmaClassified = classifyAcwr(ewmaAcwr);

    // Uncoupled ACWR excludes the acute window from the chronic denominator to eliminate mathematical coupling
    const priorLen = acuteStart - chronicStart;
    let uncoupledAcwr: number | null = null;
    if (priorLen >= 7) {
      const priorSum = prefix[acuteStart]! - prefix[chronicStart]!;
      const priorWeeklyLoad = priorSum / Math.max(1, priorLen / 7);
      if (priorWeeklyLoad > 0) {
        uncoupledAcwr = Math.round((acuteLoad / priorWeeklyLoad) * 100) / 100;
      }
    }

    results.push({
      date: currentItem.date,
      load: Math.round(currentItem.load),
      acuteLoad: Math.round(acuteLoad),
      chronicLoad: Math.round(chronicLoad),
      acwr,
      zone,
      zoneLabel: label,
      ewmaAcwr,
      ewmaZone: ewmaClassified.zone,
      ewmaZoneLabel: ewmaClassified.label,
      uncoupledAcwr,
    });
  }

  return results;
}

export interface MonotonyAndStrain {
  meanDailyLoad: number;
  standardDeviation: number;
  monotony: number;
  totalWeeklyLoad: number;
  trainingStrain: number;
  monotonyLevel: "low" | "moderate" | "high";
  monotonyAdvice: string;
}

export function calculateMonotonyAndStrain(dailyLoads: number[]): MonotonyAndStrain {
  const n = dailyLoads.length || 7;
  let total = 0;
  for (let i = 0; i < dailyLoads.length; i++) total += dailyLoads[i]!;
  const mean = total / n;
  let varianceSum = 0;
  for (let i = 0; i < dailyLoads.length; i++) {
    const d = dailyLoads[i]! - mean;
    varianceSum += d * d;
  }
  const sd = Math.sqrt(varianceSum / n);

  // If sd is near zero, monotony is theoretically very high (every day identical)
  const monotony = sd < 0.001 ? (mean > 0 ? 3.0 : 0) : Math.round((mean / sd) * 100) / 100;
  const strain = Math.round(total * monotony);

  let monotonyLevel: "low" | "moderate" | "high" = "low";
  let monotonyAdvice = "负荷起伏健康，轻重日安排合理，有充分的生理恢复低谷。";
  if (monotony >= 2.0) {
    monotonyLevel = "high";
    monotonyAdvice = "训练单调性极高 (≥2.0)，每日负荷缺乏波动，缺乏彻底的休息日，极易导致慢性疲劳与免疫抑制。";
  } else if (monotony >= 1.5) {
    monotonyLevel = "moderate";
    monotonyAdvice = "训练单调性中等 (1.5–2.0)，建议在重负荷训练日之后插入明确的轻训日或休息日。";
  }

  return {
    meanDailyLoad: Math.round(mean),
    standardDeviation: Math.round(sd),
    monotony,
    totalWeeklyLoad: Math.round(total),
    trainingStrain: strain,
    monotonyLevel,
    monotonyAdvice,
  };
}

export type MuscleDoseCategory = "maintenance" | "optimal" | "overreaching";

export interface MuscleDoseAudit {
  muscleKey: string;
  muscleName: string;
  sets: number;
  category: MuscleDoseCategory;
  categoryLabel: string;
  benchmarkMin: number;
  benchmarkMax: number;
  percentageOfTarget: number;
  advice: string;
}

export function evaluateWeeklyMuscleDose(
  muscleKey: string,
  muscleName: string,
  sets: number,
): MuscleDoseAudit {
  const benchmarkMin = 10;
  const benchmarkMax = 20;

  if (sets < benchmarkMin) {
    return {
      muscleKey,
      muscleName,
      sets,
      category: "maintenance",
      categoryLabel: "偏少 (<10组)",
      benchmarkMin,
      benchmarkMax,
      percentageOfTarget: Math.round((sets / benchmarkMin) * 100),
      advice: "每周组数偏少，只够维持现状；想多长点肌肉可以补 2–4 组。",
    };
  }
  if (sets <= benchmarkMax) {
    return {
      muscleKey,
      muscleName,
      sets,
      category: "optimal",
      categoryLabel: "练到位 (10–20组)",
      benchmarkMin,
      benchmarkMax,
      percentageOfTarget: 100,
      advice: "处于最适合长肌肉的周组数区间，继续保持这个节奏。",
    };
  }
  return {
    muscleKey,
    muscleName,
    sets,
    category: "overreaching",
    categoryLabel: "组数过多 (>20组)",
    benchmarkMin,
    benchmarkMax,
    percentageOfTarget: Math.round((sets / benchmarkMax) * 100),
    advice: "每周组数已经比较高，注意关节感受和恢复，不必盲目再加量。",
  };
}

export function calculateSetInol(reps: number, weight: number, oneRepMax: number): number {
  if (reps <= 0 || weight <= 0 || oneRepMax <= 0) return 0;
  const intensityPct = (weight / oneRepMax) * 100;
  if (intensityPct >= 100) return Math.round((reps / 1) * 100) / 100; // Cap to 99% intensity math
  const inol = reps / (100 - intensityPct);
  return Math.round(inol * 100) / 100;
}

export interface InolExerciseSummary {
  exerciseId: string;
  name: string;
  oneRepMax: number;
  totalSets: number;
  totalReps: number;
  sessionInol: number;
  category: "easy" | "optimal" | "tough" | "brutal";
  categoryLabel: string;
  advice: string;
}

export function evaluateSessionInol(
  exerciseId: string,
  name: string,
  oneRepMax: number,
  sets: { reps: number; weight: number }[],
): InolExerciseSummary {
  let sessionInol = 0;
  let totalReps = 0;
  for (const set of sets) {
    sessionInol += calculateSetInol(set.reps, set.weight, oneRepMax);
    totalReps += set.reps;
  }
  sessionInol = Math.round(sessionInol * 100) / 100;

  let category: "easy" | "optimal" | "tough" | "brutal" = "optimal";
  let categoryLabel = "最佳负荷 (0.4–1.0)";
  let advice = "单次训练神经与负荷刺激处于黄金区间，有效促进力量增长且机能可迅速恢复。";

  if (sessionInol < 0.4) {
    category = "easy";
    categoryLabel = "轻松/恢复 (<0.4)";
    advice = "强度刺激较低，适合热身、技术打磨或减载恢复。";
  } else if (sessionInol > 2.0) {
    category = "brutal";
    categoryLabel = "极限超负荷 (>2.0)";
    advice = "单次中枢神经疲劳严重，超过常规训练恢复极限，建议后续至少安排 48–72 小时充分休息。";
  } else if (sessionInol > 1.0) {
    category = "tough";
    categoryLabel = "艰难负荷 (1.0–2.0)";
    advice = "负荷沉重，对神经与肌纤维募集要求极高，需保证充分营养与深睡眠。";
  }

  return {
    exerciseId,
    name,
    oneRepMax: Math.round(oneRepMax * 10) / 10,
    totalSets: sets.length,
    totalReps,
    sessionInol,
    category,
    categoryLabel,
    advice,
  };
}

export interface IpfGlResult {
  score: number;
  totalKg: number;
  bodyweightKg: number;
  gender: "male" | "female";
  liftType: "classic_3lift" | "classic_bench";
  tier: "beginner" | "intermediate" | "advanced" | "elite";
  tierLabel: string;
}

export function calculateIpfGlPoints(
  gender: "male" | "female",
  bodyweightKg: number,
  totalKg: number,
  liftType: "classic_3lift" | "classic_bench" = "classic_bench",
): IpfGlResult {
  const bw = Math.max(30, Math.min(250, bodyweightKg));
  const tot = Math.max(0, totalKg);

  let a = 0;
  let b = 0;
  let c = 0;

  if (liftType === "classic_3lift") {
    if (gender === "male") {
      a = 1199.72839;
      b = 1025.18162;
      c = 0.00921;
    } else {
      a = 610.32796;
      b = 1045.56252;
      c = 0.03048;
    }
  } else {
    // classic_bench
    if (gender === "male") {
      a = 320.98041;
      b = 281.40258;
      c = 0.01008;
    } else {
      a = 142.40398;
      b = 442.52671;
      c = 0.04724;
    }
  }

  const denominator = a - b * Math.exp(-c * bw);
  const score = denominator > 0 ? Math.round(((tot * 100) / denominator) * 100) / 100 : 0;

  let tier: "beginner" | "intermediate" | "advanced" | "elite" = "beginner";
  let tierLabel = "大众入门 (<35 分)";

  if (score >= 63) {
    tier = "elite";
    tierLabel = "健力精英 (≥63 分)";
  } else if (score >= 47) {
    tier = "advanced";
    tierLabel = "资深进阶 (47–62 分)";
  } else if (score >= 35) {
    tier = "intermediate";
    tierLabel = "扎实力量 (35–46 分)";
  }

  return {
    score,
    totalKg: Math.round(tot * 10) / 10,
    bodyweightKg: Math.round(bw * 10) / 10,
    gender,
    liftType,
    tier,
    tierLabel,
  };
}

export interface ProteinAdequacyReport {
  targetGramsPerKg: number;
  averageGramsPerDay: number;
  averageGramsPerKg: number;
  leanMassGramsPerKg: number | null;
  totalDaysLogged: number;
  daysMeetingTarget: number;
  complianceRatePct: number;
  status: "suboptimal" | "optimal" | "high";
  statusLabel: string;
  advice: string;
}

/** Evaluates daily protein adequacy against Morton (2018) bodyweight and optional Helms (2014) lean-mass targets. */
export function evaluateProteinAdequacy(
  dailyProteins: { date: string; proteinGrams: number }[],
  bodyweightKg: number,
  options?: { leanBodyMassKg?: number | null },
): ProteinAdequacyReport {
  const targetPerKg = 1.6;
  const bw = Math.max(35, bodyweightKg);
  const valid = dailyProteins.filter((item) => item.proteinGrams > 0);
  const leanMass = options?.leanBodyMassKg != null && options.leanBodyMassKg > 20
    ? options.leanBodyMassKg
    : null;

  if (!valid.length) {
    return {
      targetGramsPerKg: targetPerKg,
      averageGramsPerDay: 0,
      averageGramsPerKg: 0,
      leanMassGramsPerKg: null,
      totalDaysLogged: 0,
      daysMeetingTarget: 0,
      complianceRatePct: 0,
      status: "suboptimal",
      statusLabel: "暂无记录",
      advice: "记录饮食后，会按体重自动帮你看每天蛋白质够不够吃（建议 ≥1.6 g/kg）。",
    };
  }

  const totalProtein = valid.reduce((s, item) => s + item.proteinGrams, 0);
  const avgGrams = totalProtein / valid.length;
  const avgPerKg = avgGrams / bw;
  const leanMassGramsPerKg = leanMass != null
    ? Math.round((avgGrams / leanMass) * 100) / 100
    : null;
  const meetingDays = valid.filter((item) => item.proteinGrams / bw >= targetPerKg).length;
  const compliance = Math.round((meetingDays / valid.length) * 100);

  let status: "suboptimal" | "optimal" | "high" = "optimal";
  let statusLabel = "吃得够 (1.6–2.2 g/kg)";
  let advice = "蛋白质吃得很够，能很好地支持肌肉修复与生长。";

  if (avgPerKg < targetPerKg) {
    status = "suboptimal";
    statusLabel = "稍微偏低 (<1.6 g/kg)";
    advice = `目前平均每天约 ${Math.round(avgPerKg * 10) / 10} g/kg，建议尽量吃到 ${Math.round(bw * targetPerKg)} g 以上更利于恢复和长肉。`;
  } else if (avgPerKg > 2.4) {
    status = "high";
    statusLabel = "非常充裕 (>2.4 g/kg)";
    advice = "蛋白质吃得非常充足，减脂期能更好保住肌肉并增强饱腹感。";
  }

  if (leanMassGramsPerKg != null) {
    advice += ` 按你的肌肉量换算约 ${leanMassGramsPerKg} g/kg，保肌需求${leanMassGramsPerKg >= 2.0 ? "已达标" : "还可再高一点"}。`;
  }

  return {
    targetGramsPerKg: targetPerKg,
    averageGramsPerDay: Math.round(avgGrams),
    averageGramsPerKg: Math.round(avgPerKg * 100) / 100,
    leanMassGramsPerKg,
    totalDaysLogged: valid.length,
    daysMeetingTarget: meetingDays,
    complianceRatePct: compliance,
    status,
    statusLabel,
    advice,
  };
}

export interface WeightRateReport {
  startWeight: number;
  endWeight: number;
  deltaKg: number;
  weeksSpan: number;
  weeklySlopeKg: number;
  rSquared: number | null;
  trendMethod: "ols_regression" | "two_point";
  changeRatePerWeekPct: number;
  category: "rapid_loss" | "optimal_cut" | "stable" | "lean_bulk" | "rapid_gain";
  categoryLabel: string;
  advice: string;
}

function computeWeeklyOlsSlope(
  sorted: { date: string; weight: number }[],
): { slopeKgPerWeek: number; meanWeight: number; rSquared: number } | null {
  if (sorted.length < 3) return null;
  const first = sorted[0];
  if (!first) return null;
  const t0 = Date.parse(first.date + "T00:00:00Z");
  const pts = sorted.map((p) => ({
    x: (Date.parse(p.date + "T00:00:00Z") - t0) / (7 * 86400000),
    y: p.weight,
  }));
  const n = pts.length;
  const xBar = pts.reduce((s, p) => s + p.x, 0) / n;
  const yBar = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - xBar;
    const dy = p.y - yBar;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx <= 1e-9) return null;
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  let ssRes = 0;
  for (const p of pts) {
    const err = p.y - (intercept + slope * p.x);
    ssRes += err * err;
  }
  const r2 = syy <= 1e-9 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / syy));
  return {
    slopeKgPerWeek: slope,
    meanWeight: yBar,
    rSquared: Math.round(r2 * 100) / 100,
  };
}

/** Evaluates weekly weight change rate using OLS linear regression when >= 3 weigh-ins exist. */
export function evaluateWeightChangeRate(
  weightPoints: { date: string; weight: number }[],
): WeightRateReport | null {
  if (weightPoints.length < 2) return null;
  const sorted = [...weightPoints].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  if (!start || !end) return null;

  const daysDiff = Math.max(1, (Date.parse(end.date + "T00:00:00Z") - Date.parse(start.date + "T00:00:00Z")) / 86400000);
  const weeks = Math.max(0.5, daysDiff / 7);
  const delta = end.weight - start.weight;

  const ols = computeWeeklyOlsSlope(sorted);
  const trendMethod: WeightRateReport["trendMethod"] = ols ? "ols_regression" : "two_point";
  const weeklySlope = ols ? ols.slopeKgPerWeek : delta / weeks;
  const baseWeight = ols ? Math.max(30, ols.meanWeight) : start.weight;
  const ratePerWeekPct = (weeklySlope / baseWeight) * 100;
  const roundedRate = Math.round(ratePerWeekPct * 100) / 100;
  const roundedSlopeKg = Math.round(weeklySlope * 100) / 100;
  const rSquared = ols ? ols.rSquared : null;

  let category: WeightRateReport["category"] = "stable";
  let categoryLabel = "体重平稳";
  let advice = "体重基本保持稳定，适合巩固力量或维持期。";

  if (roundedRate < -1.0) {
    category = "rapid_loss";
    categoryLabel = "掉得偏快 (<-1.0%/周)";
    advice = "每周掉重超过 1%，减太快容易连带着掉肌肉和力气，建议稍微多吃一点点。";
  } else if (roundedRate <= -0.4) {
    category = "optimal_cut";
    categoryLabel = "稳步减脂 (-0.5%~-1.0%/周)";
    advice = "这个减脂节奏很理想，掉脂肪的同时能最大程度保住肌肉和力量。";
  } else if (roundedRate >= 0.8) {
    category = "rapid_gain";
    categoryLabel = "涨得偏快 (>0.8%/周)";
    advice = "体重涨得比较快，容易顺带多涨体脂，如果不是刚起步的新手可以稍微收一点热量。";
  } else if (roundedRate >= 0.25) {
    category = "lean_bulk";
    categoryLabel = "干净增肌 (+0.25%~+0.6%/周)";
    advice = "处于比较理想的温和增肌节奏，不容易多余长胖。";
  }

  if (ols && rSquared != null) {
    advice += `（已结合近 ${sorted.length} 次记录自动过滤早晚水分起伏。）`;
  }

  return {
    startWeight: Math.round(start.weight * 10) / 10,
    endWeight: Math.round(end.weight * 10) / 10,
    deltaKg: Math.round(delta * 10) / 10,
    weeksSpan: Math.round(weeks * 10) / 10,
    weeklySlopeKg: roundedSlopeKg,
    rSquared,
    trendMethod,
    changeRatePerWeekPct: roundedRate,
    category,
    categoryLabel,
    advice,
  };
}
