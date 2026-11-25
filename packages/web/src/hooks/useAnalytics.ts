import { useEffect, useState } from "react";
import type { SleepReport } from "@ironlog/shared";
import type { AppleDailyEntry } from "../components/apple/AppleHealthModals";
import { cachedApiFetch, peekQuery } from "../lib/query-cache";

export const ANALYTICS_PERIODS = [14, 30, 60, 90, 180, 365] as const;
export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number];

export interface RepMaxHit {
  weight: number;
  reps: number;
  date: string;
}

interface AnalyticsResponse {
  today: string;
  through: string;
  period: AnalyticsPeriod;
  userProfile: { weightKg: number | null; appleWeightKg: number | null; gender: "male" | "female" | null };
  acwr: {
    referenceWeightKg: number | null;
    current: {
      acwr: number;
      ewmaAcwr?: number;
      uncoupledAcwr?: number | null;
      zone: "deload" | "sweet_spot" | "caution" | "danger";
      ewmaZone?: string;
      acuteLoad: number;
      chronicLoad: number;
    };
    series: Array<{ date: string; acwr: number; ewmaAcwr?: number; zone: string }>;
  };
  monotony: {
    current: {
      monotony: number;
      monotonyLevel: "high" | "moderate" | "low";
      meanDailyLoad: number;
      standardDeviation: number;
      trainingStrain: number;
      monotonyAdvice: string;
    };
    previous: { trainingStrain: number };
  };
  muscles: {
    audits: Array<{
      muscleName: string;
      sets: number;
      avg4WeekSets: number;
      freqPerWeek?: number;
      category: "optimal" | "overreaching" | "maintenance";
      categoryLabel: string;
      advice: string;
    }>;
    symmetry?: {
      pushSets: number;
      pullSets: number;
      pushPullRatio: number | null;
      pushPullStatus: "balanced" | "push_dominant" | "pull_dominant" | "no_data";
      pushPullLabel: string;
      upperSets: number;
      lowerSets: number;
      upperLowerRatio: number | null;
      advice: string;
    };
  };
  effortSpectrum?: {
    totalWorkSets: number;
    repZones: {
      strength: { sets: number; pct: number };
      hypertrophy: { sets: number; pct: number };
      metabolic: { sets: number; pct: number };
    };
    rirDistribution: {
      loggedCount: number;
      avgRir: number | null;
      nearFailure: { sets: number; pct: number };
      optimal: { sets: number; pct: number };
      reserveHigh: { sets: number; pct: number };
    };
    stimulatingSets: number;
    advice: string;
  };
  periodComparison?: {
    currentRange?: { from: string; through: string };
    previousRange?: { from: string; through: string };
    current: { sessions: number; activeDays: number; workSets: number; tonnageKg: number; durationMinutes: number; dietDaysLogged: number };
    previous: { sessions: number; activeDays: number; workSets: number; tonnageKg: number; durationMinutes: number; dietDaysLogged: number };
    deltas: { sessionsPct: number | null; workSetsPct: number | null; tonnagePct: number | null };
  };
  weeklyBreakdown?: Array<{
    weekIndex: number;
    from: string;
    through: string;
    sessions: number;
    activeDays: number;
    workSets: number;
    hardSets: number;
    tonnageKg: number;
    durationMinutes: number;
    load: number;
  }>;
  exerciseProgress?: Array<{
    id: string;
    name: string;
    muscle: string;
    mode: string;
    sessions: number;
    workSets: number;
    tonnageKg: number;
    first1RM: number;
    last1RM: number;
    best1RM: number;
    delta1RM: number;
  }>;
  inol: {
    lifts: Array<{
      name: string;
      oneRepMax: number;
      sessionDate?: string;
      category: string;
      categoryLabel: string;
      sessionInol: number;
      weeklyInol: number;
      totalSets: number;
      totalReps: number;
      advice: string;
    }>;
  };
  ipfGl: {
    bench?: { score: number; tierLabel: string } | null;
    total?: { score: number; tierLabel: string } | null;
    components: {
      bench1RM: number;
      squat1RM: number;
      deadlift1RM: number;
      total3Lift: number;
    };
  };
  nutrition: {
    protein: {
      status: "insufficient" | "optimal" | "suboptimal" | "high";
      statusLabel: string;
      averageGramsPerDay: number;
      averageGramsPerKg: number | null;
      leanMassGramsPerKg?: number | null;
      daysMeetingTarget: number | null;
      totalDaysLogged: number;
      complianceRatePct: number | null;
      advice: string;
    };
    energy?: {
      daysLogged: number;
      trainingDaysLogged: number;
      restDaysLogged: number;
      avgCalories: number;
      avgProtein: number;
      avgCarbs: number;
      avgFat: number;
      macroPct: { protein: number; carbs: number; fat: number };
      calorieTarget: number;
      calorieAdherencePct: number | null;
      trainingDayAvgKcal: number | null;
      restDayAvgKcal: number | null;
      trainingDayAvgProtein: number | null;
      restDayAvgProtein: number | null;
      estimatedTdeeKcal: number | null;
      tdeeConfidence: "high" | "moderate" | "insufficient";
      tdeeBasis?: { from: string; through: string; completeDays: number; weightSamples: number } | null;
      energyAdvice: string;
    };
    dailySeries?: Array<{
      date: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      mealsCount: number;
      isTrainingDay: boolean;
      waterMl: number | null;
    }>;
    hydration?: {
      targetMl: number;
      loggedDays: number;
      averageMl: number;
      daysMeetingTarget: number;
      complianceRatePct: number;
      totalDays: number;
    };
  };
  planAdherence?: {
    hasPlan: boolean;
    planName: string | null;
    scheduleMode: string | null;
    from: string;
    through: string;
    scheduledSessions: number;
    completedSessions: number;
    pendingSessions?: number;
    missedSessions: number;
    adherencePct: number | null;
    byRoutine: Array<{
      key?: string;
      name: string;
      scheduled: number;
      completed: number;
      missed: number;
      adherencePct: number | null;
    }>;
  };
  plateaus?: Array<{
    id: string;
    name: string;
    muscle: string;
    sessionsCount: number;
    baseline1RM: number;
    latest1RM: number;
    deltaPct: number;
    lastDate: string;
    status: "plateau" | "regression";
    advice: string;
  }>;
  repMaxBoard?: Array<{
    id: string;
    name: string;
    muscle: string;
    rm1?: RepMaxHit;
    rm3?: RepMaxHit;
    rm5?: RepMaxHit;
    rm8?: RepMaxHit;
    rm10?: RepMaxHit;
  }>;
  bodyMeasurements?: {
    count: number;
    latestDate: string | null;
    latest: {
      waistCm: number | null;
      chestCm: number | null;
      armCm: number | null;
      thighCm: number | null;
      hipCm: number | null;
    };
    deltas: {
      waistCm: number | null;
      chestCm: number | null;
      armCm: number | null;
      thighCm: number | null;
      hipCm: number | null;
    };
    whr: number | null;
    whtr: number | null;
    avgE1rmPct: number | null;
    recompSignal: {
      status: "optimal" | "caution" | "neutral";
      label: string;
      detail: string;
    } | null;
  };
  sleepTrainingImpact?: {
    pairedDays: number;
    goodSleep: { days: number; avgWorkSets: number | null; avgTonnageKg: number | null; fatiguedPct: number | null };
    midSleep: { days: number; avgWorkSets: number | null; avgTonnageKg: number | null; fatiguedPct: number | null };
    shortSleep: { days: number; avgWorkSets: number | null; avgTonnageKg: number | null; fatiguedPct: number | null };
    insight: string | null;
  };
  bodyweight: {
    report?: {
      category: string;
      categoryLabel: string;
      changeRatePerWeekPct: number;
      weeklySlopeKg: number;
      deltaKg: number;
      weeksSpan: number;
      trendMethod?: string;
      rSquared?: number | null;
      advice: string;
    } | null;
  };
  trainingSummary?: { sessions: number; workSets: number; tonnageKg: number; activeDays: number; dietDaysLogged: number };
  sleepReport?: SleepReport;
  citations: Record<string, { authors: string; year: number; journal: string; title: string; takeaway: string }>;
  appleDaily?: {
    series?: AppleDailyEntry[];
    averages?: { sleepMinutes?: number | null; restingHeartRateBpm?: number | null; hrvMs?: number | null };
    latestBody?: { weightKg?: { value: number; date: string } | null; bodyFatPct?: { value: number } | null };
    bodyReport?: {
      hasData: boolean;
      weightKg?: number | null;
      bodyFatPct?: number | null;
      fatMassKg?: number | null;
      leanBodyMassKg?: number | null;
      leanSharePct?: number | null;
      bmi?: number | null;
      bmiStatus?: { label: string } | null;
      ffmi?: number | null;
      ffmiStatus?: { label: string } | null;
      waistCm?: number | null;
      whtr?: number | null;
      whtrStatus?: { label: string } | null;
      waistStatus?: { label: string } | null;
      heightCm?: number | null;
      heightSource?: string;
      measuredAt?: { weightDate?: string } | null;
      insights?: string[];
      metabolic?: {
        appleRestingAvgKcal?: number | null;
        bmrKatchMcArdleKcal: number;
        sedentaryTdeeKcal: number;
        trainingTdeeKcal: number;
        recompCutTargetKcal: number;
        proteinTargetG: number;
        measuredVsPredictedPct?: number | null;
      } | null;
      recomposition?: {
        targetWaistCm: number;
        waistDeltaCm?: number | null;
        milestones: Array<{ label: string; targetWeightKg: number; fatToLoseKg: number; estWeeks: number }>;
      } | null;
    } | null;
    recoveryReport?: {
      hasData: boolean;
      readinessScore?: number | null;
      readinessTone?: string;
      readinessLabel: string;
      baselineMode?: string;
      signals?: Array<{
        key: string;
        label: string;
        value: number;
        unit: string;
        statusLabel: string;
        tone: string;
        detail: string;
        rangeBand?: { min: number; max: number; optMin: number; optMax: number };
      }>;
      heartRateLatest?: { value: number; spreadFromRhr?: number | null; date: string } | null;
      vo2MaxLatest?: { value: number; date: string } | null;
      insights?: string[];
      lnHrvBaseline?: { latest: number; zScore?: number | null; swcHalfSd?: number | null } | null;
      autonomicBalanceRatio?: number | null;
    } | null;
    activityReport?: {
      hasData: boolean;
      latestSteps?: number | null;
      latestDistanceKm?: number | null;
      latestActiveEnergyKcal?: number | null;
      latestFlightsClimbed?: number | null;
      avgSteps?: number | null;
      avgDistanceKm?: number | null;
      strideCm?: number | null;
      activityTierLabel?: string;
    } | null;
    correlations?: Array<{ label: string; r: number; sampleDays: number; note: string }>;
    weeklyComparison?: {
      recentWindow: { from: string; through: string };
      previousWindow: { daysWithData: number };
      hasPreviousBaseline: boolean;
      metrics: Array<{ key: string; label: string; unit: string; current: number | null; delta: number | null }>;
    } | null;
    coverageSummary?: {
      syncedCount: number;
      totalCount: number;
      categoryProgress?: Array<{ category: string; synced: number; total: number }>;
      syncedMetrics: Array<{ label: string }>;
      missingMetrics?: Array<{ category: string; label: string }>;
    } | null;
  } | null;
  appleWorkouts?: AppleWorkoutsBucket & {
    realDeviceCount: number;
    demoCount: number;
    realDeviceStats?: AppleWorkoutsBucket | null;
  };
}

interface AppleWorkoutsBucket {
  totalCount: number;
  realDeviceCount?: number;
  linkedManualCount?: number;
  totalDurationSeconds: number;
  totalCaloriesKcal: number;
  totalDistanceKm: number;
  avgBpm: number | null;
  maxBpm: number | null;
  byActivity: Array<{ title: string; count: number; durationSeconds: number; caloriesKcal: number; avgBpm: number | null }>;
  hrZones?: {
    hrMax: number;
    hrMaxSource: string;
    zones: Array<{ key: string; label: string; count: number; pct: number; durationSeconds: number }>;
  } | null;
  whoCardio?: {
    targetMinutes: number;
    moderateMinutes: number;
    vigorousMinutes: number;
    equivalentMinutes: number;
    completionPct: number;
  };
  paceTrend?: Array<{
    date: string;
    title: string;
    distanceKm: number;
    durationMinutes: number;
    paceMinPerKm: number;
  }>;
  recent: Array<{
    id: string;
    date: string;
    title: string;
    activityType: string;
    isDemo?: boolean;
    captureMethod?: string;
    startedAt?: string;
    endedAt?: string;
    manualWorkoutId?: string | null;
    durationKind?: string;
    durationSeconds: number;
    activeEnergyKcal?: number | null;
    distanceMeters?: number | null;
    heartRate?: { avgBpm?: number | null; maxBpm?: number | null } | null;
  }>;
}

type AnalyticsResult = {
  requestKey: string;
  data?: AnalyticsResponse;
  error?: string;
};

export function useAnalytics(period: AnalyticsPeriod, through: string, userId: string, epoch: number) {
  const query = new URLSearchParams({ days: String(period), through });
  const path = "/api/web/analytics?" + query.toString();
  const requestKey = JSON.stringify([userId, epoch, path]);
  const [result, setResult] = useState<AnalyticsResult>();
  const current = result?.requestKey === requestKey ? result : undefined;
  const data = current?.data ?? peekQuery<AnalyticsResponse>(path, userId)?.data;

  useEffect(() => {
    let active = true;
    void cachedApiFetch<AnalyticsResponse>(path, { epoch, userId }).then(
      (response) => { if (active) setResult({ requestKey, data: response }); },
      (error: Error) => { if (active) setResult({ requestKey, error: error?.message || "加载数据分析失败" }); },
    );
    return () => { active = false; };
  }, [path, requestKey, userId, epoch]);

  return { data, error: current?.error, loading: current === undefined };
}
