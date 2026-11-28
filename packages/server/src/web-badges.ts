import {
  compareWorkouts,
  estimatedOneRepMax,
  isValidWorkSet,
  localDate,
  nutritionDayComplete,
  weightToKg,
  workoutDurationSeconds,
  type Diet,
  type NutritionDay,
  type Weight,
  type Workout,
} from "@ironlog/shared";
import { projectAppleTraining } from "./apple-training-agenda.js";
import type { Store } from "./store.js";
import { shiftDay } from "./web-statistics.js";

export type BadgeCategory = "consistency" | "volume" | "strength" | "lifestyle" | "special";

export interface BadgeItem {
  id: string;
  title: string;
  subtitle: string;
  category: BadgeCategory;
  categoryLabel: string;
  rule: string;
  current: number;
  target: number;
  unit: string;
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
  tier: "standard" | "milestone" | "prestige";
}

export interface BadgesSummary {
  earnedCount: number;
  totalCount: number;
  categories: { key: BadgeCategory; label: string; earned: number; total: number }[];
  badges: BadgeItem[];
}

const categoryLabels: Record<BadgeCategory, string> = {
  consistency: "坚持节律",
  volume: "力量吨位",
  strength: "突破均衡",
  lifestyle: "健康闭环",
  special: "特别挑战",
};

const cardioTypes = new Set([
  "running",
  "walking",
  "cycling",
  "swimming",
  "elliptical",
  "stairclimbing",
  "stairstepper",
  "highintensityintervaltraining",
]);

function localTimeParts(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 8 * 3600000);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

function isoWeekKey(date: string) {
  const anchor = new Date(date + "T00:00:00Z");
  const dow = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - dow);
  return anchor.toISOString().slice(0, 10);
}

function makeBadge(
  spec: Omit<BadgeItem, "categoryLabel" | "progress" | "unlocked" | "current" | "unlockedAt"> & {
    current: number;
    unlocked?: boolean;
    unlockedAt: string | null;
    integerDisplay?: boolean;
  },
): BadgeItem {
  const { integerDisplay, ...rest } = spec;
  const unlocked = spec.unlocked ?? spec.current >= spec.target;
  const clamped = Math.min(spec.target, Math.max(0, spec.current));
  const rounded = integerDisplay ? Math.round(clamped) : Math.round(clamped * 10) / 10;
  // #105: Never allow display rounding to show target reached when unrounded current < target.
  const displayCurrent = unlocked
    ? spec.target
    : rounded >= spec.target && spec.target > 0
      ? integerDisplay
        ? Math.max(0, Math.floor(clamped))
        : Math.max(0, Math.floor(clamped * 10) / 10)
      : rounded;
  return {
    ...rest,
    current: displayCurrent,
    categoryLabel: categoryLabels[spec.category],
    progress: spec.target > 0 ? Math.min(1, Math.max(0, clamped / spec.target)) : 0,
    unlocked,
    unlockedAt: unlocked ? spec.unlockedAt : null,
  };
}

class ThresholdTracker {
  private readonly reached = new Map<number, string>();
  constructor(private readonly thresholds: number[]) {}
  observe(value: number, date: string) {
    for (const t of this.thresholds) {
      if (value >= t && !this.reached.has(t)) this.reached.set(t, date);
    }
  }
  dateFor(target: number) {
    return this.reached.get(target) ?? null;
  }
}

export function getWebBadges(store: Store, userId: string, through = localDate()): BadgesSummary {
  const catalogue = store.catalogueMap(userId, true);
  const workoutEntries = store
    .list(userId, "workout")
    .flatMap((record) => {
      const workout = record.data as Workout;
      return workout.status === "completed" && workout.date <= through ? [{ id: record.id, workout }] : [];
    })
    .sort((a, b) => compareWorkouts(a.workout, b.workout));
  const workouts = workoutEntries.map(({ workout }) => workout);

  const projected = projectAppleTraining(store, userId, through, catalogue, workoutEntries).entries
    .flatMap((entry) => entry.date <= through ? [{ ...entry, startedMs: Date.parse(entry.startedAt) }] : [])
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedMs - b.startedMs));

  const activities = [
    ...workouts.map((workout) => ({ date: workout.date, startedAt: workout.startedAt, startedMs: Date.parse(workout.startedAt) })),
    ...projected
      .filter((entry) => !entry.manualWorkoutId)
      .map((entry) => ({ date: entry.date, startedAt: entry.startedAt, startedMs: entry.startedMs })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedMs - b.startedMs));

  const activityAt = (n: number) => activities[n - 1]?.date ?? null;

  // Calendar rhythm, streaks, weekly & monthly density
  const sortedDates = [...new Set(activities.map((item) => item.date))].sort();
  let run = 0;
  let maxStreak = 0;
  let prev = "";
  const streakTracker = new ThresholdTracker([3, 7, 14, 21, 30]);
  const mondayDates: string[] = [];
  const fridayDates: string[] = [];
  const weekendDates: string[] = [];
  const weekCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  let maxWeekDays = 0;
  let maxMonthDays = 0;
  const weekTracker = new ThresholdTracker([4, 5]);
  const monthTracker = new ThresholdTracker([12, 16]);

  for (const date of sortedDates) {
    run = prev && shiftDay(prev, 1) === date ? run + 1 : 1;
    prev = date;
    if (run > maxStreak) maxStreak = run;
    streakTracker.observe(run, date);

    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    if (dow === 1) mondayDates.push(date);
    if (dow === 5) fridayDates.push(date);
    if (dow === 0 || dow === 6) weekendDates.push(date);

    const wk = isoWeekKey(date);
    const wkDays = (weekCounts.get(wk) ?? 0) + 1;
    weekCounts.set(wk, wkDays);
    if (wkDays > maxWeekDays) maxWeekDays = wkDays;
    weekTracker.observe(wkDays, date);

    const mk = date.slice(0, 7);
    const mkDays = (monthCounts.get(mk) ?? 0) + 1;
    monthCounts.set(mk, mkDays);
    if (mkDays > maxMonthDays) maxMonthDays = mkDays;
    monthTracker.observe(mkDays, date);
  }

  // Time-of-day sessions across manual & unlinked Apple sessions
  const earlyBirdDates: string[] = [];
  const lunchDates: string[] = [];
  const goldenHourDates: string[] = [];
  const nightOwlDates: string[] = [];
  for (const act of activities) {
    const t = localTimeParts(act.startedAt);
    if (!t) continue;
    if (t.hour < 9) earlyBirdDates.push(act.date);
    else if ((t.hour === 11 && t.minute >= 30) || t.hour === 12 || t.hour === 13) lunchDates.push(act.date);
    else if (t.hour >= 17 && t.hour <= 19) goldenHourDates.push(act.date);
    if (t.hour >= 20) nightOwlDates.push(act.date);
  }

  // #201: Training plan existence / activation filtered strictly by `through` with immutable creation date
  const planHistoryDates = (store.planSchedule(userId)?.history ?? [])
    .map((entry) => {
      const ms = Date.parse(entry.startedAt ?? entry.updatedAt ?? "");
      return Number.isFinite(ms) ? localDate(ms) : null;
    })
    .filter((d): d is string => d != null && d <= through)
    .sort();
  const planDraftRecords = store.list(userId, "plan");
  const planDraftIds = new Set(planDraftRecords.map((r) => r.id));
  const firstPlanChangeRow = store.db
    .prepare(
      "SELECT id, MIN(updated_at) AS firstAt FROM changes WHERE user_id = ? AND kind = 'plan' AND deleted = 0 GROUP BY id",
    )
    .all(userId) as Array<{ id: string; firstAt: string | null }>;
  const firstAtByPlanId = new Map<string, string>();
  for (const r of firstPlanChangeRow) {
    if (r.firstAt) firstAtByPlanId.set(r.id, r.firstAt);
  }
  const planDraftDates = planDraftRecords
    .map((rec) => {
      const iso = firstAtByPlanId.get(rec.id) ?? rec.updatedAt;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? localDate(ms) : null;
    })
    .filter((d): d is string => d != null && d <= through)
    .sort();
  // Also preserve legacy history-only plans whose draft was deleted
  const planDates = [...planHistoryDates, ...planDraftDates].sort();
  const hasPlan = planDates.length > 0 && (planDraftIds.size > 0 || planHistoryDates.length > 0);
  const planAt = planDates[0] ?? null;

  // Volume, sets, reps, duration, PRs, muscle split, SBD & accessories
  let totalVolume = 0;
  let totalSets = 0;
  let totalReps = 0;
  let totalSeconds = 0;
  let maxSessionVolume = 0;
  let maxSessionSets = 0;
  let maxSessionSeconds = 0;
  const tonnageTracker = new ThresholdTracker([5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]);
  const sessionVolTracker = new ThresholdTracker([5000, 10000]);
  const setsTracker = new ThresholdTracker([100, 300, 500, 1000, 2500]);
  const repsTracker = new ThresholdTracker([1000, 5000, 10000]);
  const hoursTracker = new ThresholdTracker([10, 50, 100]);
  const sessionSetsTracker = new ThresholdTracker([20]);
  const sessionMinTracker = new ThresholdTracker([60]);

  const bestSeen = new Map<string, { weight: number; est: number }>();
  const prExercises = new Set<string>();
  const prTracker = new ThresholdTracker([1, 3, 8, 15]);

  const coreFive = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0 };
  let split20Count = 0;
  let split50Count = 0;
  let fullSplit20At: string | null = null;
  let fullSplit50At: string | null = null;

  let maxBenchScore = 0;
  let maxSquatScore = 0;
  let maxDeadliftScore = 0;
  let maxOhpScore = 0;
  let maxRowScore = 0;
  let maxSbdScore = 0;
  const benchTracker = new ThresholdTracker([60, 80, 100, 120]);
  const squatTracker = new ThresholdTracker([80, 100, 120, 160]);
  const deadliftTracker = new ThresholdTracker([80, 120, 160]);
  const ohpTracker = new ThresholdTracker([50]);
  const rowTracker = new ThresholdTracker([70]);
  const sbdTracker = new ThresholdTracker([250, 400]);

  const usedExercises = new Set<string>();
  const usedEquipments = new Set<string>();
  const varietyTracker = new ThresholdTracker([10, 25]);
  const equipTracker = new ThresholdTracker([4]);
  const balancedDates: string[] = [];
  const fatiguedDates: string[] = [];
  const strengthDates = new Set<string>();
  const cardioDates = new Set<string>();

  for (const workout of workouts) {
    let hasStrength = false;
    let hasCardio = false;
    let sessionVolume = 0;
    let sessionSets = 0;
    // #199: Aggregate intra-workout best per exerciseId before comparing against prior-workout PR baseline
    const workoutExBest = new Map<string, { weight: number; est: number }>();
    if (workout.feeling === "balanced") balancedDates.push(workout.date);
    if (workout.feeling === "fatigued") fatiguedDates.push(workout.date);

    for (const row of workout.exercises) {
      const exercise = row.snapshot ?? catalogue.get(row.exerciseId);
      if (!exercise) continue;

      let sessionBestWeight = 0;
      let sessionBestEst = 0;
      let hadValidSet = false;

      for (const set of row.sets) {
        if (!isValidWorkSet(set, exercise.mode)) continue;
        hadValidSet = true;
        totalSets++;
        sessionSets++;
        setsTracker.observe(totalSets, workout.date);

        if (exercise.muscle in coreFive) {
          const muscleKey = exercise.muscle as keyof typeof coreFive;
          coreFive[muscleKey]++;
          if (coreFive[muscleKey] === 20) {
            split20Count++;
            if (split20Count === 5 && !fullSplit20At) fullSplit20At = workout.date;
          }
          if (coreFive[muscleKey] === 50) {
            split50Count++;
            if (split50Count === 5 && !fullSplit50At) fullSplit50At = workout.date;
          }
        }

        if (exercise.mode === "reps" && set.reps > 0) {
          totalReps += set.reps;
          repsTracker.observe(totalReps, workout.date);
        }

        if (exercise.mode === "reps" && set.weight > 0) {
          // #104 (P1): Convert lb weights to kg before volume, 1RM, milestones and PR checks.
          const weightKg = weightToKg(set.weight, row.weightUnit);
          const setVol = weightKg * set.reps * exercise.volumeMultiplier;
          totalVolume += setVol;
          sessionVolume += setVol;
          tonnageTracker.observe(totalVolume, workout.date);

          sessionBestWeight = Math.max(sessionBestWeight, weightKg);
          const est = set.reps <= 10 ? estimatedOneRepMax(weightKg, set.reps) : null;
          if (est !== null) sessionBestEst = Math.max(sessionBestEst, est);

          const liftScore = Math.max(weightKg, est ?? 0);
          const tag = `${row.exerciseId} ${exercise.name}`;

          if (row.exerciseId === "bench-press" || exercise.name.includes("杠铃卧推")) {
            if (liftScore > maxBenchScore) maxBenchScore = liftScore;
            benchTracker.observe(liftScore, workout.date);
          }
          if (row.exerciseId === "squat" || exercise.name.includes("杠铃深蹲")) {
            if (liftScore > maxSquatScore) maxSquatScore = liftScore;
            squatTracker.observe(liftScore, workout.date);
          }
          if (row.exerciseId.includes("deadlift") || exercise.name.includes("硬拉")) {
            if (liftScore > maxDeadliftScore) maxDeadliftScore = liftScore;
            deadliftTracker.observe(liftScore, workout.date);
          }
          // #198: Explicit overhead/shoulder press check (excludes chest-press, bench, leg-press)
          const isExcludedPress = /leg-press|bench|chest-press|incline-press|decline-press|floor-press|腿举|卧推|胸推/i.test(tag);
          const isOverheadPress =
            !isExcludedPress &&
            ((exercise.muscle === "shoulders" && (row.exerciseId.includes("press") || /推举|肩推/.test(exercise.name))) ||
              /(?:overhead-press|shoulder-press|military-press|arnold-press|push-press)/i.test(row.exerciseId) ||
              /(?:过头推举|站姿推举|坐姿推举|杠铃推举|哑铃推举|肩推|阿诺德推举|实力推|借力推)/.test(exercise.name));
          if (isOverheadPress) {
            if (liftScore > maxOhpScore) maxOhpScore = liftScore;
            ohpTracker.observe(liftScore, workout.date);
          }
          if (row.exerciseId.includes("row") || exercise.name.includes("划船")) {
            if (liftScore > maxRowScore) maxRowScore = liftScore;
            rowTracker.observe(liftScore, workout.date);
          }

          // #197: Big-3 SBD requires all three lifts (bench + squat + deadlift) to have valid records
          if (maxBenchScore > 0 && maxSquatScore > 0 && maxDeadliftScore > 0) {
            const sbdNow = maxBenchScore + maxSquatScore + maxDeadliftScore;
            if (sbdNow > maxSbdScore) maxSbdScore = sbdNow;
            sbdTracker.observe(sbdNow, workout.date);
          }
        }
      }

      if (hadValidSet) {
        // #200: Only count strength / cardio completion when at least one valid completed work set exists
        if (exercise.muscle === "cardio") hasCardio = true;
        else hasStrength = true;

        usedExercises.add(row.exerciseId);
        varietyTracker.observe(usedExercises.size, workout.date);
        if (exercise.equipment) {
          usedEquipments.add(exercise.equipment);
          equipTracker.observe(usedEquipments.size, workout.date);
        }
      }

      if (sessionBestWeight > 0) {
        const curW = workoutExBest.get(row.exerciseId);
        workoutExBest.set(row.exerciseId, {
          weight: Math.max(curW?.weight ?? 0, sessionBestWeight),
          est: Math.max(curW?.est ?? 0, sessionBestEst),
        });
      }
    }

    // #199: Compare merged workout bests against historical baseline from PRIOR workouts only
    for (const [exerciseId, cur] of workoutExBest) {
      const previous = bestSeen.get(exerciseId);
      if (previous && (cur.weight > previous.weight || cur.est > previous.est)) {
        prExercises.add(exerciseId);
        prTracker.observe(prExercises.size, workout.date);
      }
      bestSeen.set(exerciseId, {
        weight: Math.max(previous?.weight ?? 0, cur.weight),
        est: Math.max(previous?.est ?? 0, cur.est),
      });
    }

    if (sessionVolume > maxSessionVolume) maxSessionVolume = sessionVolume;
    sessionVolTracker.observe(sessionVolume, workout.date);
    if (sessionSets > maxSessionSets) maxSessionSets = sessionSets;
    sessionSetsTracker.observe(sessionSets, workout.date);

    if (hasStrength) strengthDates.add(workout.date);
    if (hasCardio) cardioDates.add(workout.date);
  }

  // #105: Merge manual workouts and unlinked Apple workouts chronologically before accumulating duration badges.
  const durationEvents: Array<{ date: string; startedMs: number; durationSeconds: number }> = [];
  for (const workout of workouts) {
    const durSec = workoutDurationSeconds(workout) ?? 0;
    if (durSec > 0) {
      durationEvents.push({ date: workout.date, startedMs: Date.parse(workout.startedAt) || 0, durationSeconds: durSec });
    }
  }
  for (const entry of projected) {
    if (!entry.manualWorkoutId && entry.durationSeconds && entry.durationSeconds > 0) {
      durationEvents.push({ date: entry.date, startedMs: entry.startedMs || 0, durationSeconds: entry.durationSeconds });
    }
  }
  durationEvents.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedMs - b.startedMs));
  for (const ev of durationEvents) {
    totalSeconds += ev.durationSeconds;
    if (ev.durationSeconds > maxSessionSeconds) maxSessionSeconds = ev.durationSeconds;
    sessionMinTracker.observe(ev.durationSeconds / 60, ev.date);
    hoursTracker.observe(totalSeconds / 3600, ev.date);
  }

  let totalAppleBurnKcal = 0;
  const appleBurnTracker = new ThresholdTracker([5000]);
  for (const entry of projected) {
    if (entry.activeEnergyKcal && entry.activeEnergyKcal > 0) {
      totalAppleBurnKcal += entry.activeEnergyKcal;
      appleBurnTracker.observe(totalAppleBurnKcal, entry.date);
    }
    const normalizedType = entry.activityType.replace(/[-_]/g, "").toLowerCase();
    // #105: Use activity.family so outdoorRunning, indoorCycling, rowing, etc. count toward double-day.
    if (entry.activity.family === "cardio" || cardioTypes.has(normalizedType)) cardioDates.add(entry.date);
    else if (entry.activity.family === "resistance" || normalizedType.includes("strengthtraining")) strengthDates.add(entry.date);
  }

  const doubleDays = [...strengthDates].filter((date) => cardioDates.has(date)).sort();

  // Diet records, nutrition milestones & weight tracking
  const allDietRecords = store
    .list(userId, "diet")
    .filter((record) => (record.data as Diet).date <= through)
    .sort((a, b) => (a.data as Diet).date.localeCompare((b.data as Diet).date));

  const mealsByDay = new Map<string, typeof allDietRecords>();
  let totalProteinG = 0;
  const proteinTotalTracker = new ThresholdTracker([2000, 5000]);
  for (const record of allDietRecords) {
    const d = record.data as Diet;
    const bucket = mealsByDay.get(d.date) ?? [];
    bucket.push(record);
    mealsByDay.set(d.date, bucket);
    totalProteinG += d.protein || 0;
    proteinTotalTracker.observe(totalProteinG, d.date);
  }

  const completeDietDates = store
    .list(userId, "nutritionDay")
    .filter((record) => {
      const day = record.data as NutritionDay;
      return day.date <= through && nutritionDayComplete(day, mealsByDay.get(day.date) ?? []);
    })
    .map((record) => (record.data as NutritionDay).date)
    .sort();
  const completeDietSet = new Set(completeDietDates);

  const highProteinDates = [...mealsByDay.entries()]
    .filter(([, records]) => records.reduce((sum, rec) => sum + ((rec.data as Diet).protein || 0), 0) >= 120)
    .map(([date]) => date)
    .sort();

  const fourMealDates = [...mealsByDay.entries()]
    .filter(([, records]) => {
      const seen = new Set(records.map((rec) => (rec.data as Diet).meal));
      return seen.has("breakfast") && seen.has("lunch") && seen.has("dinner") && seen.has("snack");
    })
    .map(([date]) => date)
    .sort();

  const weightDates = [
    ...new Set(
      store
        .list(userId, "weight")
        .map((record) => (record.data as Weight).date)
        .filter((date) => date <= through),
    ),
  ].sort();
  const weightDateSet = new Set(weightDates);

  const triadDates = sortedDates.filter((date) => completeDietSet.has(date) && weightDateSet.has(date));

  const missingSbdLifts = [
    ...(maxBenchScore > 0 ? [] : ["卧推"]),
    ...(maxSquatScore > 0 ? [] : ["深蹲"]),
    ...(maxDeadliftScore > 0 ? [] : ["硬拉"]),
  ];
  const hasAllSbd = missingSbdLifts.length === 0;
  const sbdSubtitleSuffix = hasAllSbd ? "" : `（尚缺 ${missingSbdLifts.join("、")}）`;
  const totalHoursRaw = totalSeconds / 3600;

  const badges: BadgeItem[] = [
    // ==================== 1. consistency (21 枚) ====================
    makeBadge({ id: "first-spark", title: "第 1 次训练", subtitle: "完成第 1 次记录", category: "consistency", rule: "完成第 1 次正式训练或 Apple 健康运动打卡", current: activities.length, target: 1, unit: "次", unlockedAt: activityAt(1), tier: "standard" }),
    makeBadge({ id: "habit-3", title: "累计 3 次", subtitle: "3 次训练记录", category: "consistency", rule: "累计完成 3 次训练或运动打卡", current: activities.length, target: 3, unit: "次", unlockedAt: activityAt(3), tier: "standard" }),
    makeBadge({ id: "habit-10", title: "累计 10 次", subtitle: "10 次训练记录", category: "consistency", rule: "累计完成 10 次训练或运动打卡", current: activities.length, target: 10, unit: "次", unlockedAt: activityAt(10), tier: "standard" }),
    makeBadge({ id: "habit-20", title: "累计 20 次", subtitle: "20 次训练记录", category: "consistency", rule: "累计完成 20 次训练或运动打卡", current: activities.length, target: 20, unit: "次", unlockedAt: activityAt(20), tier: "standard" }),
    makeBadge({ id: "habit-30", title: "累计 30 次", subtitle: "30 次训练记录", category: "consistency", rule: "累计完成 30 次训练或运动打卡", current: activities.length, target: 30, unit: "次", unlockedAt: activityAt(30), tier: "milestone" }),
    makeBadge({ id: "habit-45", title: "累计 45 次", subtitle: "45 次训练记录", category: "consistency", rule: "累计完成 45 次训练或运动打卡", current: activities.length, target: 45, unit: "次", unlockedAt: activityAt(45), tier: "milestone" }),
    makeBadge({ id: "iron-60", title: "累计 60 次", subtitle: "60 次训练记录", category: "consistency", rule: "累计完成 60 次训练或运动打卡", current: activities.length, target: 60, unit: "次", unlockedAt: activityAt(60), tier: "milestone" }),
    makeBadge({ id: "iron-80", title: "累计 80 次", subtitle: "80 次训练记录", category: "consistency", rule: "累计完成 80 次训练或运动打卡", current: activities.length, target: 80, unit: "次", unlockedAt: activityAt(80), tier: "milestone" }),
    makeBadge({ id: "iron-century", title: "累计 100 场", subtitle: "100 次训练记录", category: "consistency", rule: "累计完成 100 次训练或运动打卡", current: activities.length, target: 100, unit: "次", unlockedAt: activityAt(100), tier: "prestige" }),
    makeBadge({ id: "iron-150", title: "累计 150 场", subtitle: "150 次训练记录", category: "consistency", rule: "累计完成 150 次训练或运动打卡", current: activities.length, target: 150, unit: "次", unlockedAt: activityAt(150), tier: "prestige" }),
    makeBadge({ id: "iron-200", title: "累计 200 场", subtitle: "200 次训练记录", category: "consistency", rule: "累计完成 200 次训练或运动打卡", current: activities.length, target: 200, unit: "次", unlockedAt: activityAt(200), tier: "prestige" }),
    makeBadge({ id: "iron-365", title: "累计 365 场", subtitle: "365 次训练记录", category: "consistency", rule: "累计完成 365 次训练或运动打卡", current: activities.length, target: 365, unit: "次", unlockedAt: activityAt(365), tier: "prestige" }),
    makeBadge({ id: "monday-ignite", title: "周一 8 次", subtitle: "8 个星期一完成训练", category: "consistency", rule: "累计在 8 个星期一完成训练或运动打卡", current: mondayDates.length, target: 8, unit: "天", unlockedAt: mondayDates[7] ?? null, tier: "standard" }),
    makeBadge({ id: "friday-iron", title: "周五 8 次", subtitle: "8 个星期五完成训练", category: "consistency", rule: "累计在 8 个星期五完成训练或运动打卡", current: fridayDates.length, target: 8, unit: "天", unlockedAt: fridayDates[7] ?? null, tier: "standard" }),
    makeBadge({ id: "weekend-warrior", title: "周末 12 次", subtitle: "12 个周末训练日", category: "consistency", rule: "累计在 12 个周六或周日完成训练打卡", current: weekendDates.length, target: 12, unit: "天", unlockedAt: weekendDates[11] ?? null, tier: "milestone" }),
    makeBadge({ id: "week-quad", title: "单周 4 天", subtitle: "自然周内 4 个训练日", category: "consistency", rule: "任意自然周内达成至少 4 天训练或运动打卡", current: maxWeekDays, target: 4, unit: "天", unlockedAt: weekTracker.dateFor(4), tier: "standard" }),
    makeBadge({ id: "week-five", title: "单周 5 天", subtitle: "自然周内 5 个训练日", category: "consistency", rule: "任意自然周内达成至少 5 天训练或运动打卡", current: maxWeekDays, target: 5, unit: "天", unlockedAt: weekTracker.dateFor(5), tier: "milestone" }),
    makeBadge({ id: "month-12", title: "单月 12 天", subtitle: "自然月内 12 个训练日", category: "consistency", rule: "任意自然月内完成至少 12 天训练打卡", current: maxMonthDays, target: 12, unit: "天", unlockedAt: monthTracker.dateFor(12), tier: "milestone" }),
    makeBadge({ id: "month-16", title: "单月 16 天", subtitle: "自然月内 16 个训练日", category: "consistency", rule: "任意自然月内完成至少 16 天训练打卡", current: maxMonthDays, target: 16, unit: "天", unlockedAt: monthTracker.dateFor(16), tier: "prestige" }),
    makeBadge({ id: "plan-architect", title: "启用计划", subtitle: "创建草稿或启用 1 套计划", category: "consistency", rule: "保存至少 1 套训练计划草稿或正式启用计划", current: hasPlan ? 1 : 0, target: 1, unit: "套", unlockedAt: planAt, tier: "standard" }),
    makeBadge({ id: "active-days-50", title: "50 个活跃日", subtitle: "50 个训练自然日", category: "consistency", rule: "累计在 50 个不同自然日完成训练或运动", current: sortedDates.length, target: 50, unit: "天", unlockedAt: sortedDates[49] ?? null, tier: "milestone" }),

    // ==================== 2. volume (21 枚) ====================
    makeBadge({ id: "tonnage-5t", title: "累计 5 吨", subtitle: "5,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 5,000 kg", current: totalVolume, integerDisplay: true, target: 5000, unit: "kg", unlockedAt: tonnageTracker.dateFor(5000), tier: "standard" }),
    makeBadge({ id: "tonnage-10t", title: "累计 10 吨", subtitle: "10,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 10,000 kg", current: totalVolume, integerDisplay: true, target: 10000, unit: "kg", unlockedAt: tonnageTracker.dateFor(10000), tier: "standard" }),
    makeBadge({ id: "tonnage-25t", title: "累计 25 吨", subtitle: "25,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 25,000 kg", current: totalVolume, integerDisplay: true, target: 25000, unit: "kg", unlockedAt: tonnageTracker.dateFor(25000), tier: "standard" }),
    makeBadge({ id: "tonnage-50t", title: "累计 50 吨", subtitle: "50,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 50,000 kg", current: totalVolume, integerDisplay: true, target: 50000, unit: "kg", unlockedAt: tonnageTracker.dateFor(50000), tier: "milestone" }),
    makeBadge({ id: "tonnage-100t", title: "累计 100 吨", subtitle: "100,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 100,000 kg", current: totalVolume, integerDisplay: true, target: 100000, unit: "kg", unlockedAt: tonnageTracker.dateFor(100000), tier: "milestone" }),
    makeBadge({ id: "tonnage-250t", title: "累计 250 吨", subtitle: "250,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 250,000 kg", current: totalVolume, integerDisplay: true, target: 250000, unit: "kg", unlockedAt: tonnageTracker.dateFor(250000), tier: "prestige" }),
    makeBadge({ id: "tonnage-500t", title: "累计 500 吨", subtitle: "500,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 500,000 kg", current: totalVolume, integerDisplay: true, target: 500000, unit: "kg", unlockedAt: tonnageTracker.dateFor(500000), tier: "prestige" }),
    makeBadge({ id: "tonnage-1000t", title: "累计 1,000 吨", subtitle: "1,000,000 kg 容量", category: "volume", rule: "累计抗阻训练容量达到 1,000,000 kg", current: totalVolume, integerDisplay: true, target: 1000000, unit: "kg", unlockedAt: tonnageTracker.dateFor(1000000), tier: "prestige" }),
    makeBadge({ id: "session-5t", title: "单场 5 吨", subtitle: "单次 5,000 kg 容量", category: "volume", rule: "单次正式训练总容量达到 5,000 kg", current: maxSessionVolume, integerDisplay: true, target: 5000, unit: "kg", unlockedAt: sessionVolTracker.dateFor(5000), tier: "standard" }),
    makeBadge({ id: "session-10t", title: "单场 10 吨", subtitle: "单次 10,000 kg 容量", category: "volume", rule: "单次正式训练总容量达到 10,000 kg", current: maxSessionVolume, integerDisplay: true, target: 10000, unit: "kg", unlockedAt: sessionVolTracker.dateFor(10000), tier: "milestone" }),
    makeBadge({ id: "sets-100", title: "累计 100 组", subtitle: "100 个有效工作组", category: "volume", rule: "累计完成 100 个有效训练工作组", current: totalSets, target: 100, unit: "组", unlockedAt: setsTracker.dateFor(100), tier: "standard" }),
    makeBadge({ id: "sets-300", title: "累计 300 组", subtitle: "300 个有效工作组", category: "volume", rule: "累计完成 300 个有效训练工作组", current: totalSets, target: 300, unit: "组", unlockedAt: setsTracker.dateFor(300), tier: "standard" }),
    makeBadge({ id: "sets-500", title: "累计 500 组", subtitle: "500 个有效工作组", category: "volume", rule: "累计完成 500 个有效训练工作组", current: totalSets, target: 500, unit: "组", unlockedAt: setsTracker.dateFor(500), tier: "milestone" }),
    makeBadge({ id: "sets-1000", title: "累计 1,000 组", subtitle: "1,000 个有效工作组", category: "volume", rule: "累计完成 1,000 个有效训练工作组", current: totalSets, target: 1000, unit: "组", unlockedAt: setsTracker.dateFor(1000), tier: "prestige" }),
    makeBadge({ id: "sets-2500", title: "累计 2,500 组", subtitle: "2,500 个有效工作组", category: "volume", rule: "累计完成 2,500 个有效训练工作组", current: totalSets, target: 2500, unit: "组", unlockedAt: setsTracker.dateFor(2500), tier: "prestige" }),
    makeBadge({ id: "reps-1000", title: "累计 1,000 次", subtitle: "1,000 次抗阻重复", category: "volume", rule: "累计完成 1,000 次抗阻重复次数", current: totalReps, target: 1000, unit: "次", unlockedAt: repsTracker.dateFor(1000), tier: "standard" }),
    makeBadge({ id: "reps-5000", title: "累计 5,000 次", subtitle: "5,000 次抗阻重复", category: "volume", rule: "累计完成 5,000 次抗阻重复次数", current: totalReps, target: 5000, unit: "次", unlockedAt: repsTracker.dateFor(5000), tier: "milestone" }),
    makeBadge({ id: "reps-10000", title: "累计 10,000 次", subtitle: "10,000 次抗阻重复", category: "volume", rule: "累计完成 10,000 次抗阻重复次数", current: totalReps, target: 10000, unit: "次", unlockedAt: repsTracker.dateFor(10000), tier: "prestige" }),
    makeBadge({ id: "hours-10", title: "累计 10 小时", subtitle: "10 小时训练时长", category: "volume", rule: "累计有效训练与运动时长达到 10 小时", current: totalHoursRaw, target: 10, unit: "h", unlockedAt: hoursTracker.dateFor(10), tier: "standard" }),
    makeBadge({ id: "hours-50", title: "累计 50 小时", subtitle: "50 小时训练时长", category: "volume", rule: "累计有效训练与运动时长达到 50 小时", current: totalHoursRaw, target: 50, unit: "h", unlockedAt: hoursTracker.dateFor(50), tier: "milestone" }),
    makeBadge({ id: "hours-100", title: "累计 100 小时", subtitle: "100 小时训练时长", category: "volume", rule: "累计有效训练与运动时长达到 100 小时", current: totalHoursRaw, target: 100, unit: "h", unlockedAt: hoursTracker.dateFor(100), tier: "prestige" }),

    // ==================== 3. strength (21 枚) ====================
    makeBadge({ id: "pr-first", title: "1 项新纪录", subtitle: "首个动作突破 PR", category: "strength", rule: "在任意 1 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 1, unit: "项", unlockedAt: prTracker.dateFor(1), tier: "standard" }),
    makeBadge({ id: "pr-breaker", title: "3 项新纪录", subtitle: "3 个动作刷新 PR", category: "strength", rule: "在至少 3 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 3, unit: "项", unlockedAt: prTracker.dateFor(3), tier: "milestone" }),
    makeBadge({ id: "pr-master", title: "8 项新纪录", subtitle: "8 个动作刷新 PR", category: "strength", rule: "在至少 8 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 8, unit: "项", unlockedAt: prTracker.dateFor(8), tier: "prestige" }),
    makeBadge({ id: "pr-legend", title: "15 项新纪录", subtitle: "15 个动作刷新 PR", category: "strength", rule: "在至少 15 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 15, unit: "项", unlockedAt: prTracker.dateFor(15), tier: "prestige" }),
    makeBadge({ id: "full-split", title: "五大肌群 20 组", subtitle: "胸背腿肩臂各 ≥20 组", category: "strength", rule: "胸、背、腿、肩、臂 5 大肌群各自累计完成至少 20 组", current: split20Count, target: 5, unit: "肌群", unlockedAt: fullSplit20At, tier: "milestone" }),
    makeBadge({ id: "full-split-50", title: "五大肌群 50 组", subtitle: "胸背腿肩臂各 ≥50 组", category: "strength", rule: "胸、背、腿、肩、臂 5 大肌群各自累计完成至少 50 组", current: split50Count, target: 5, unit: "肌群", unlockedAt: fullSplit50At, tier: "prestige" }),
    makeBadge({ id: "bench-60", title: "卧推 60 kg", subtitle: "杠铃卧推达 60 kg", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 60 kg", current: maxBenchScore, target: 60, unit: "kg", unlockedAt: benchTracker.dateFor(60), tier: "standard" }),
    makeBadge({ id: "bench-80", title: "卧推 80 kg", subtitle: "杠铃卧推达 80 kg", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 80 kg", current: maxBenchScore, target: 80, unit: "kg", unlockedAt: benchTracker.dateFor(80), tier: "milestone" }),
    makeBadge({ id: "bench-100", title: "卧推 100 kg", subtitle: "杠铃卧推达 100 kg", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 100 kg", current: maxBenchScore, target: 100, unit: "kg", unlockedAt: benchTracker.dateFor(100), tier: "prestige" }),
    makeBadge({ id: "bench-120", title: "卧推 120 kg", subtitle: "杠铃卧推达 120 kg", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 120 kg", current: maxBenchScore, target: 120, unit: "kg", unlockedAt: benchTracker.dateFor(120), tier: "prestige" }),
    makeBadge({ id: "squat-80", title: "深蹲 80 kg", subtitle: "杠铃深蹲达 80 kg", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 80 kg", current: maxSquatScore, target: 80, unit: "kg", unlockedAt: squatTracker.dateFor(80), tier: "standard" }),
    makeBadge({ id: "squat-100", title: "深蹲 100 kg", subtitle: "杠铃深蹲达 100 kg", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 100 kg", current: maxSquatScore, target: 100, unit: "kg", unlockedAt: squatTracker.dateFor(100), tier: "milestone" }),
    makeBadge({ id: "squat-120", title: "深蹲 120 kg", subtitle: "杠铃深蹲达 120 kg", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 120 kg", current: maxSquatScore, target: 120, unit: "kg", unlockedAt: squatTracker.dateFor(120), tier: "prestige" }),
    makeBadge({ id: "squat-160", title: "深蹲 160 kg", subtitle: "杠铃深蹲达 160 kg", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 160 kg", current: maxSquatScore, target: 160, unit: "kg", unlockedAt: squatTracker.dateFor(160), tier: "prestige" }),
    makeBadge({ id: "deadlift-80", title: "硬拉 80 kg", subtitle: "硬拉类达 80 kg", category: "strength", rule: "硬拉类动作单组重量或估算 1RM 达到 80 kg", current: maxDeadliftScore, target: 80, unit: "kg", unlockedAt: deadliftTracker.dateFor(80), tier: "standard" }),
    makeBadge({ id: "deadlift-120", title: "硬拉 120 kg", subtitle: "硬拉类达 120 kg", category: "strength", rule: "硬拉类动作单组重量或估算 1RM 达到 120 kg", current: maxDeadliftScore, target: 120, unit: "kg", unlockedAt: deadliftTracker.dateFor(120), tier: "milestone" }),
    makeBadge({ id: "deadlift-160", title: "硬拉 160 kg", subtitle: "硬拉类达 160 kg", category: "strength", rule: "硬拉类动作单组重量或估算 1RM 达到 160 kg", current: maxDeadliftScore, target: 160, unit: "kg", unlockedAt: deadliftTracker.dateFor(160), tier: "prestige" }),
    makeBadge({ id: "ohp-50", title: "推举 50 kg", subtitle: "过头/肩部推举达 50 kg", category: "strength", rule: "过头推举或肩部推举单组重量/估算 1RM 达到 50 kg", current: maxOhpScore, target: 50, unit: "kg", unlockedAt: ohpTracker.dateFor(50), tier: "milestone" }),
    makeBadge({ id: "row-70", title: "划船 70 kg", subtitle: "划船类达 70 kg", category: "strength", rule: "划船类动作单组重量或估算 1RM 达到 70 kg", current: maxRowScore, target: 70, unit: "kg", unlockedAt: rowTracker.dateFor(70), tier: "milestone" }),
    makeBadge({ id: "sbd-250", title: "三大项 250 kg", subtitle: `SBD 合计 250 kg${sbdSubtitleSuffix}`, category: "strength", rule: "需分别拥有卧推、深蹲、硬拉有效记录，且三项最高重量/1RM 总和达到 250 kg", current: hasAllSbd ? maxSbdScore : Math.min(249.9, maxBenchScore + maxSquatScore + maxDeadliftScore), unlocked: hasAllSbd && maxSbdScore >= 250, target: 250, unit: "kg", unlockedAt: sbdTracker.dateFor(250), tier: "milestone" }),
    makeBadge({ id: "sbd-400", title: "三大项 400 kg", subtitle: `SBD 合计 400 kg${sbdSubtitleSuffix}`, category: "strength", rule: "需分别拥有卧推、深蹲、硬拉有效记录，且三项最高重量/1RM 总和达到 400 kg", current: hasAllSbd ? maxSbdScore : Math.min(399.9, maxBenchScore + maxSquatScore + maxDeadliftScore), unlocked: hasAllSbd && maxSbdScore >= 400, target: 400, unit: "kg", unlockedAt: sbdTracker.dateFor(400), tier: "prestige" }),

    // ==================== 4. lifestyle (21 枚) ====================
    makeBadge({ id: "diet-1", title: "完整饮食 1 天", subtitle: "1 天全天饮食记录", category: "lifestyle", rule: "累计完成 1 天全天完整饮食记录标记", current: completeDietDates.length, target: 1, unit: "天", unlockedAt: completeDietDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "diet-7", title: "完整饮食 7 天", subtitle: "7 天全天饮食记录", category: "lifestyle", rule: "累计完成 7 天全天完整饮食记录标记", current: completeDietDates.length, target: 7, unit: "天", unlockedAt: completeDietDates[6] ?? null, tier: "standard" }),
    makeBadge({ id: "diet-14", title: "完整饮食 14 天", subtitle: "14 天全天饮食记录", category: "lifestyle", rule: "累计完成 14 天全天完整饮食记录标记", current: completeDietDates.length, target: 14, unit: "天", unlockedAt: completeDietDates[13] ?? null, tier: "milestone" }),
    makeBadge({ id: "diet-30", title: "完整饮食 30 天", subtitle: "30 天全天饮食记录", category: "lifestyle", rule: "累计完成 30 天全天完整饮食记录标记", current: completeDietDates.length, target: 30, unit: "天", unlockedAt: completeDietDates[29] ?? null, tier: "milestone" }),
    makeBadge({ id: "diet-60", title: "完整饮食 60 天", subtitle: "60 天全天饮食记录", category: "lifestyle", rule: "累计完成 60 天全天完整饮食记录标记", current: completeDietDates.length, target: 60, unit: "天", unlockedAt: completeDietDates[59] ?? null, tier: "prestige" }),
    makeBadge({ id: "meals-50", title: "记录 50 餐", subtitle: "50 条饮食条目", category: "lifestyle", rule: "累计记录 50 条饮食餐次条目", current: allDietRecords.length, target: 50, unit: "条", unlockedAt: allDietRecords[49] ? (allDietRecords[49].data as Diet).date : null, tier: "standard" }),
    makeBadge({ id: "meals-200", title: "记录 200 餐", subtitle: "200 条饮食条目", category: "lifestyle", rule: "累计记录 200 条饮食餐次条目", current: allDietRecords.length, target: 200, unit: "条", unlockedAt: allDietRecords[199] ? (allDietRecords[199].data as Diet).date : null, tier: "milestone" }),
    makeBadge({ id: "protein-7", title: "高蛋白 7 天", subtitle: "7 天蛋白 ≥120 g", category: "lifestyle", rule: "累计 7 天每日蛋白质摄入达到 120 g 以上", current: highProteinDates.length, target: 7, unit: "天", unlockedAt: highProteinDates[6] ?? null, tier: "standard" }),
    makeBadge({ id: "protein-14", title: "高蛋白 14 天", subtitle: "14 天蛋白 ≥120 g", category: "lifestyle", rule: "累计 14 天每日蛋白质摄入达到 120 g 以上", current: highProteinDates.length, target: 14, unit: "天", unlockedAt: highProteinDates[13] ?? null, tier: "milestone" }),
    makeBadge({ id: "protein-30", title: "高蛋白 30 天", subtitle: "30 天蛋白 ≥120 g", category: "lifestyle", rule: "累计 30 天每日蛋白质摄入达到 120 g 以上", current: highProteinDates.length, target: 30, unit: "天", unlockedAt: highProteinDates[29] ?? null, tier: "prestige" }),
    makeBadge({ id: "protein-total-2kg", title: "累计蛋白 2 kg", subtitle: "2,000 g 蛋白质", category: "lifestyle", rule: "历史累计摄入蛋白质达到 2,000 g", current: totalProteinG, integerDisplay: true, target: 2000, unit: "g", unlockedAt: proteinTotalTracker.dateFor(2000), tier: "standard" }),
    makeBadge({ id: "protein-total-5kg", title: "累计蛋白 5 kg", subtitle: "5,000 g 蛋白质", category: "lifestyle", rule: "历史累计摄入蛋白质达到 5,000 g", current: totalProteinG, integerDisplay: true, target: 5000, unit: "g", unlockedAt: proteinTotalTracker.dateFor(5000), tier: "milestone" }),
    makeBadge({ id: "four-meals-10", title: "四餐齐备 10 天", subtitle: "10 天早午晚加餐", category: "lifestyle", rule: "累计 10 天集齐早、午、晚、加餐四餐记录", current: fourMealDates.length, target: 10, unit: "天", unlockedAt: fourMealDates[9] ?? null, tier: "standard" }),
    makeBadge({ id: "weight-7", title: "称重 7 天", subtitle: "7 天体重记录", category: "lifestyle", rule: "累计记录 7 天体重数据", current: weightDates.length, target: 7, unit: "天", unlockedAt: weightDates[6] ?? null, tier: "standard" }),
    makeBadge({ id: "weight-30", title: "称重 30 天", subtitle: "30 天体重记录", category: "lifestyle", rule: "累计记录 30 天体重数据", current: weightDates.length, target: 30, unit: "天", unlockedAt: weightDates[29] ?? null, tier: "standard" }),
    makeBadge({ id: "weight-60", title: "称重 60 天", subtitle: "60 天体重记录", category: "lifestyle", rule: "累计记录 60 天体重数据", current: weightDates.length, target: 60, unit: "天", unlockedAt: weightDates[59] ?? null, tier: "milestone" }),
    makeBadge({ id: "weight-90", title: "称重 90 天", subtitle: "90 天体重记录", category: "lifestyle", rule: "累计记录 90 天体重数据", current: weightDates.length, target: 90, unit: "天", unlockedAt: weightDates[89] ?? null, tier: "prestige" }),
    makeBadge({ id: "apple-sync-1", title: "Apple 同步 1 次", subtitle: "同步 1 场运动", category: "lifestyle", rule: "通过 Apple 健康快捷指令同步至少 1 场运动记录", current: projected.length, target: 1, unit: "次", unlockedAt: projected[0]?.date ?? null, tier: "standard" }),
    makeBadge({ id: "apple-sync", title: "Apple 同步 10 次", subtitle: "同步 10 场运动", category: "lifestyle", rule: "通过 Apple 健康快捷指令同步 10 场运动记录", current: projected.length, target: 10, unit: "次", unlockedAt: projected[9]?.date ?? null, tier: "standard" }),
    makeBadge({ id: "apple-sync-30", title: "Apple 同步 30 次", subtitle: "同步 30 场运动", category: "lifestyle", rule: "通过 Apple 健康快捷指令同步 30 场运动记录", current: projected.length, target: 30, unit: "次", unlockedAt: projected[29]?.date ?? null, tier: "milestone" }),
    makeBadge({ id: "apple-burn-5000", title: "运动消耗 5,000 千卡", subtitle: "Apple 健康累计消耗", category: "lifestyle", rule: "通过 Apple 健康同步运动累计消耗 5,000 kcal", current: totalAppleBurnKcal, integerDisplay: true, target: 5000, unit: "kcal", unlockedAt: appleBurnTracker.dateFor(5000), tier: "milestone" }),

    // ==================== 5. special (21 枚) ====================
    makeBadge({ id: "early-bird", title: "早训 1 次", subtitle: "09:00 前开练", category: "special", rule: "在每日 09:00 前开启并完成任意一场训练或有氧", current: earlyBirdDates.length, target: 1, unit: "次", unlockedAt: earlyBirdDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "early-bird-5", title: "早训 5 次", subtitle: "5 次 09:00 前开练", category: "special", rule: "累计 5 次在每日 09:00 前开启并完成训练或有氧", current: earlyBirdDates.length, target: 5, unit: "次", unlockedAt: earlyBirdDates[4] ?? null, tier: "milestone" }),
    makeBadge({ id: "lunch-lifter", title: "午间训练 1 次", subtitle: "11:30–13:59 开练", category: "special", rule: "在每日 11:30–13:59 开启并完成任意一场训练或运动", current: lunchDates.length, target: 1, unit: "次", unlockedAt: lunchDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "golden-hour-10", title: "晚间训练 10 次", subtitle: "17:00–19:59 开练", category: "special", rule: "累计 10 次在每日 17:00–19:59 开启并完成训练或运动", current: goldenHourDates.length, target: 10, unit: "次", unlockedAt: goldenHourDates[9] ?? null, tier: "standard" }),
    makeBadge({ id: "night-owl", title: "夜训 1 次", subtitle: "20:00 后开练", category: "special", rule: "在每日 20:00 及以后开启并完成任意一场训练或运动", current: nightOwlDates.length, target: 1, unit: "次", unlockedAt: nightOwlDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "night-owl-10", title: "夜训 10 次", subtitle: "10 次 20:00 后开练", category: "special", rule: "累计 10 次在每日 20:00 及以后开启并完成训练或运动", current: nightOwlDates.length, target: 10, unit: "次", unlockedAt: nightOwlDates[9] ?? null, tier: "milestone" }),
    makeBadge({ id: "double-day", title: "同日双练 1 天", subtitle: "力量与有氧同日完成", category: "special", rule: "在同一天内同时完成力量训练与有氧运动", current: doubleDays.length, target: 1, unit: "天", unlockedAt: doubleDays[0] ?? null, tier: "milestone" }),
    makeBadge({ id: "double-day-5", title: "同日双练 5 天", subtitle: "5 天力量加有氧", category: "special", rule: "累计 5 天同日同时完成力量训练与有氧运动", current: doubleDays.length, target: 5, unit: "天", unlockedAt: doubleDays[4] ?? null, tier: "prestige" }),
    makeBadge({ id: "streak-3", title: "连续 3 天", subtitle: "连续 3 天打卡", category: "special", rule: "达成连续 3 天每日均有训练或运动打卡纪录", current: maxStreak, target: 3, unit: "天", unlockedAt: streakTracker.dateFor(3), tier: "standard" }),
    makeBadge({ id: "streak-7", title: "连续 7 天", subtitle: "连续 7 天打卡", category: "special", rule: "达成连续 7 天每日均有训练或运动打卡纪录", current: maxStreak, target: 7, unit: "天", unlockedAt: streakTracker.dateFor(7), tier: "prestige" }),
    makeBadge({ id: "streak-14", title: "连续 14 天", subtitle: "连续 14 天打卡", category: "special", rule: "达成连续 14 天每日均有训练或运动打卡纪录", current: maxStreak, target: 14, unit: "天", unlockedAt: streakTracker.dateFor(14), tier: "prestige" }),
    makeBadge({ id: "streak-21", title: "连续 21 天", subtitle: "连续 21 天打卡", category: "special", rule: "达成连续 21 天每日均有训练或运动打卡纪录", current: maxStreak, target: 21, unit: "天", unlockedAt: streakTracker.dateFor(21), tier: "prestige" }),
    makeBadge({ id: "streak-30", title: "连续 30 天", subtitle: "连续 30 天打卡", category: "special", rule: "达成连续 30 天每日均有训练或运动打卡纪录", current: maxStreak, target: 30, unit: "天", unlockedAt: streakTracker.dateFor(30), tier: "prestige" }),
    makeBadge({ id: "variety-10", title: "10 个动作", subtitle: "完成 10 种不同动作", category: "special", rule: "累计使用至少 10 个不同训练动作完成有效工作组", current: usedExercises.size, target: 10, unit: "种", unlockedAt: varietyTracker.dateFor(10), tier: "standard" }),
    makeBadge({ id: "variety-25", title: "25 个动作", subtitle: "完成 25 种不同动作", category: "special", rule: "累计使用至少 25 个不同训练动作完成有效工作组", current: usedExercises.size, target: 25, unit: "种", unlockedAt: varietyTracker.dateFor(25), tier: "milestone" }),
    makeBadge({ id: "equipment-4", title: "4 种器械", subtitle: "使用 4 类训练器械", category: "special", rule: "使用至少 4 种不同器械类型完成有效工作组", current: usedEquipments.size, target: 4, unit: "类", unlockedAt: equipTracker.dateFor(4), tier: "standard" }),
    makeBadge({ id: "marathon-60m", title: "单次 60 分钟", subtitle: "单次训练 ≥60 分钟", category: "special", rule: "单次训练或运动有效时长达到 60 分钟以上", current: maxSessionSeconds / 60, target: 60, unit: "分", unlockedAt: sessionMinTracker.dateFor(60), tier: "standard" }),
    makeBadge({ id: "session-20sets", title: "单场 20 组", subtitle: "单场 ≥20 有效组", category: "special", rule: "单次正式训练完成至少 20 个有效工作组", current: maxSessionSets, target: 20, unit: "组", unlockedAt: sessionSetsTracker.dateFor(20), tier: "milestone" }),
    makeBadge({ id: "feeling-balanced-20", title: "适中体感 20 场", subtitle: "20 场标注「适中」", category: "special", rule: "累计完成 20 场训练体感标注为「适中」", current: balancedDates.length, target: 20, unit: "场", unlockedAt: balancedDates[19] ?? null, tier: "milestone" }),
    makeBadge({ id: "grit-fatigued-5", title: "疲惫完成 5 场", subtitle: "5 场标注「疲惫」", category: "special", rule: "累计完成 5 场训练体感标注为「疲惫」的坚持纪录", current: fatiguedDates.length, target: 5, unit: "场", unlockedAt: fatiguedDates[4] ?? null, tier: "milestone" }),
    makeBadge({ id: "triad-day-10", title: "三项同日 10 天", subtitle: "10 天练吃称齐全", category: "special", rule: "累计 10 天在同一日集齐训练打卡、完整饮食与体重记录", current: triadDates.length, target: 10, unit: "天", unlockedAt: triadDates[9] ?? null, tier: "prestige" }),
  ];

  const categories = (Object.keys(categoryLabels) as BadgeCategory[]).map((key) => {
    const items = badges.filter((item) => item.category === key);
    return {
      key,
      label: categoryLabels[key],
      earned: items.filter((item) => item.unlocked).length,
      total: items.length,
    };
  });

  return {
    earnedCount: badges.filter((item) => item.unlocked).length,
    totalCount: badges.length,
    categories,
    badges,
  };
}
