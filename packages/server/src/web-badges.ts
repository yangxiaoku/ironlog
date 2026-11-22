import {
  compareWorkouts,
  estimatedOneRepMax,
  isValidWorkSet,
  localDate,
  nutritionDayComplete,
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
  },
): BadgeItem {
  const unlocked = spec.unlocked ?? spec.current >= spec.target;
  const clamped = Math.min(spec.target, Math.max(0, spec.current));
  return {
    ...spec,
    current: unlocked ? spec.target : Math.round(clamped * 10) / 10,
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

  // Training plan existence / activation
  const planHistory = store.planSchedule(userId)?.history ?? [];
  const planDrafts = store.list(userId, "plan");
  const hasPlan = planDrafts.length > 0 || planHistory.length > 0;
  const planAt = planHistory.length
    ? localDate(Date.parse(planHistory[0]!.updatedAt))
    : planDrafts.length ? through : null;

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
    const durSec = workoutDurationSeconds(workout) ?? 0;
    if (durSec > 0) {
      totalSeconds += durSec;
      if (durSec > maxSessionSeconds) maxSessionSeconds = durSec;
      sessionMinTracker.observe(durSec / 60, workout.date);
      hoursTracker.observe(totalSeconds / 3600, workout.date);
    }
    if (workout.feeling === "balanced") balancedDates.push(workout.date);
    if (workout.feeling === "fatigued") fatiguedDates.push(workout.date);

    for (const row of workout.exercises) {
      const exercise = row.snapshot ?? catalogue.get(row.exerciseId);
      if (!exercise) continue;
      if (exercise.muscle === "cardio") hasCardio = true;
      else hasStrength = true;

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
          const setVol = set.weight * set.reps * exercise.volumeMultiplier;
          totalVolume += setVol;
          sessionVolume += setVol;
          tonnageTracker.observe(totalVolume, workout.date);

          sessionBestWeight = Math.max(sessionBestWeight, set.weight);
          const est = set.reps <= 10 ? estimatedOneRepMax(set.weight, set.reps) : null;
          if (est !== null) sessionBestEst = Math.max(sessionBestEst, est);

          const liftScore = Math.max(set.weight, est ?? 0);
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
          if (!/leg-press|bench|腿举|卧推/i.test(tag) && (row.exerciseId.includes("press") || /推举|肩推/.test(exercise.name))) {
            if (liftScore > maxOhpScore) maxOhpScore = liftScore;
            ohpTracker.observe(liftScore, workout.date);
          }
          if (row.exerciseId.includes("row") || exercise.name.includes("划船")) {
            if (liftScore > maxRowScore) maxRowScore = liftScore;
            rowTracker.observe(liftScore, workout.date);
          }

          const sbdNow = maxBenchScore + maxSquatScore + maxDeadliftScore;
          if (sbdNow > maxSbdScore) maxSbdScore = sbdNow;
          sbdTracker.observe(sbdNow, workout.date);
        }
      }

      if (hadValidSet) {
        usedExercises.add(row.exerciseId);
        varietyTracker.observe(usedExercises.size, workout.date);
        if (exercise.equipment) {
          usedEquipments.add(exercise.equipment);
          equipTracker.observe(usedEquipments.size, workout.date);
        }
      }

      if (sessionBestWeight > 0) {
        const previous = bestSeen.get(row.exerciseId);
        if (previous && (sessionBestWeight > previous.weight || sessionBestEst > previous.est)) {
          prExercises.add(row.exerciseId);
          prTracker.observe(prExercises.size, workout.date);
        }
        bestSeen.set(row.exerciseId, {
          weight: Math.max(previous?.weight ?? 0, sessionBestWeight),
          est: Math.max(previous?.est ?? 0, sessionBestEst),
        });
      }
    }

    if (sessionVolume > maxSessionVolume) maxSessionVolume = sessionVolume;
    sessionVolTracker.observe(sessionVolume, workout.date);
    if (sessionSets > maxSessionSets) maxSessionSets = sessionSets;
    sessionSetsTracker.observe(sessionSets, workout.date);

    if (hasStrength) strengthDates.add(workout.date);
    if (hasCardio) cardioDates.add(workout.date);
  }

  let totalAppleBurnKcal = 0;
  const appleBurnTracker = new ThresholdTracker([5000]);
  for (const entry of projected) {
    if (!entry.manualWorkoutId && entry.durationSeconds && entry.durationSeconds > 0) {
      totalSeconds += entry.durationSeconds;
      if (entry.durationSeconds > maxSessionSeconds) maxSessionSeconds = entry.durationSeconds;
      sessionMinTracker.observe(entry.durationSeconds / 60, entry.date);
      hoursTracker.observe(totalSeconds / 3600, entry.date);
    }
    if (entry.activeEnergyKcal && entry.activeEnergyKcal > 0) {
      totalAppleBurnKcal += entry.activeEnergyKcal;
      appleBurnTracker.observe(totalAppleBurnKcal, entry.date);
    }
    const normalizedType = entry.activityType.replace(/[-_]/g, "").toLowerCase();
    if (cardioTypes.has(normalizedType)) cardioDates.add(entry.date);
    else if (normalizedType.includes("strengthtraining")) strengthDates.add(entry.date);
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

  const round1 = (v: number) => Math.round(v * 10) / 10;

  const badges: BadgeItem[] = [
    // ==================== 1. consistency (21 枚) ====================
    makeBadge({ id: "first-spark", title: "初次开练", subtitle: "万事开头第一举", category: "consistency", rule: "完成第 1 次正式训练或 Apple 健康运动打卡", current: activities.length, target: 1, unit: "次", unlockedAt: activityAt(1), tier: "standard" }),
    makeBadge({ id: "habit-3", title: "三日破冰", subtitle: "迈出习惯养成的第一步", category: "consistency", rule: "累计完成 3 次训练或运动打卡", current: activities.length, target: 3, unit: "次", unlockedAt: activityAt(3), tier: "standard" }),
    makeBadge({ id: "habit-10", title: "十场启航", subtitle: "建立初步身体记忆", category: "consistency", rule: "累计完成 10 次训练或运动打卡", current: activities.length, target: 10, unit: "次", unlockedAt: activityAt(10), tier: "standard" }),
    makeBadge({ id: "habit-20", title: "二十渐入", subtitle: "动作节奏越来越顺手", category: "consistency", rule: "累计完成 20 次训练或运动打卡", current: activities.length, target: 20, unit: "次", unlockedAt: activityAt(20), tier: "standard" }),
    makeBadge({ id: "habit-30", title: "三十而立", subtitle: "把训练变成日常节拍", category: "consistency", rule: "累计完成 30 次训练或运动打卡", current: activities.length, target: 30, unit: "次", unlockedAt: activityAt(30), tier: "milestone" }),
    makeBadge({ id: "habit-45", title: "四十五韧", subtitle: "走出新手蜜月期依然坚挺", category: "consistency", rule: "累计完成 45 次训练或运动打卡", current: activities.length, target: 45, unit: "次", unlockedAt: activityAt(45), tier: "milestone" }),
    makeBadge({ id: "iron-60", title: "六十进阶", subtitle: "两个月的汗水沉淀", category: "consistency", rule: "累计完成 60 次训练或运动打卡", current: activities.length, target: 60, unit: "次", unlockedAt: activityAt(60), tier: "milestone" }),
    makeBadge({ id: "iron-80", title: "八十笃行", subtitle: "距离百场只差最后二十击", category: "consistency", rule: "累计完成 80 次训练或运动打卡", current: activities.length, target: 80, unit: "次", unlockedAt: activityAt(80), tier: "milestone" }),
    makeBadge({ id: "iron-century", title: "百场铁血", subtitle: "百炼方成钢", category: "consistency", rule: "累计完成 100 次训练或运动打卡", current: activities.length, target: 100, unit: "次", unlockedAt: activityAt(100), tier: "prestige" }),
    makeBadge({ id: "iron-150", title: "百五恒心", subtitle: "半年以上的长周期坚守", category: "consistency", rule: "累计完成 150 次训练或运动打卡", current: activities.length, target: 150, unit: "次", unlockedAt: activityAt(150), tier: "prestige" }),
    makeBadge({ id: "iron-200", title: "双百宗师", subtitle: "钢铁意志的长期主义", category: "consistency", rule: "累计完成 200 次训练或运动打卡", current: activities.length, target: 200, unit: "次", unlockedAt: activityAt(200), tier: "prestige" }),
    makeBadge({ id: "iron-365", title: "三百六五", subtitle: "全年无愧的铁人勋章", category: "consistency", rule: "累计完成 365 次训练或运动打卡", current: activities.length, target: 365, unit: "次", unlockedAt: activityAt(365), tier: "prestige" }),
    makeBadge({ id: "monday-ignite", title: "周一点火", subtitle: "绝不在周一开摆的国际练胸党", category: "consistency", rule: "累计在 8 个星期一完成训练或运动打卡", current: mondayDates.length, target: 8, unit: "天", unlockedAt: mondayDates[7] ?? null, tier: "standard" }),
    makeBadge({ id: "friday-iron", title: "周五铁夜", subtitle: "把周五变成加练狂欢", category: "consistency", rule: "累计在 8 个星期五完成训练或运动打卡", current: fridayDates.length, target: 8, unit: "天", unlockedAt: fridayDates[7] ?? null, tier: "standard" }),
    makeBadge({ id: "weekend-warrior", title: "周末武士", subtitle: "休息日也不忘在铁馆打卡", category: "consistency", rule: "累计在 12 个周六或周日完成训练打卡", current: weekendDates.length, target: 12, unit: "天", unlockedAt: weekendDates[11] ?? null, tier: "milestone" }),
    makeBadge({ id: "week-quad", title: "一周四练", subtitle: "单周规律高频分化起点", category: "consistency", rule: "任意自然周内达成至少 4 天训练或运动打卡", current: maxWeekDays, target: 4, unit: "天", unlockedAt: weekTracker.dateFor(4), tier: "standard" }),
    makeBadge({ id: "week-five", title: "五日轰炸", subtitle: "周分化满载火力运转", category: "consistency", rule: "任意自然周内达成至少 5 天训练或运动打卡", current: maxWeekDays, target: 5, unit: "天", unlockedAt: weekTracker.dateFor(5), tier: "milestone" }),
    makeBadge({ id: "month-12", title: "月度十二", subtitle: "月均隔天一练的稳健输出", category: "consistency", rule: "任意自然月内完成至少 12 天训练打卡", current: maxMonthDays, target: 12, unit: "天", unlockedAt: monthTracker.dateFor(12), tier: "milestone" }),
    makeBadge({ id: "month-16", title: "铁月十六", subtitle: "单月出勤过半的高燃节奏", category: "consistency", rule: "任意自然月内完成至少 16 天训练打卡", current: maxMonthDays, target: 16, unit: "天", unlockedAt: monthTracker.dateFor(16), tier: "prestige" }),
    makeBadge({ id: "plan-architect", title: "计划蓝图", subtitle: "有规划的渐进才能走得更远", category: "consistency", rule: "创建或启用至少 1 套训练计划", current: hasPlan ? 1 : 0, target: 1, unit: "套", unlockedAt: planAt, tier: "standard" }),
    makeBadge({ id: "active-days-50", title: "五十活跃日", subtitle: "五十个汗流浃背的日常日期", category: "consistency", rule: "累计在 50 个不同自然日完成训练或运动", current: sortedDates.length, target: 50, unit: "天", unlockedAt: sortedDates[49] ?? null, tier: "milestone" }),

    // ==================== 2. volume (21 枚) ====================
    makeBadge({ id: "tonnage-5t", title: "五吨初试", subtitle: "五千千克热身完毕", category: "volume", rule: "累计抗阻训练容量达到 5,000 kg", current: Math.round(totalVolume), target: 5000, unit: "kg", unlockedAt: tonnageTracker.dateFor(5000), tier: "standard" }),
    makeBadge({ id: "tonnage-10t", title: "万钧之力", subtitle: "累计举起十吨钢铁", category: "volume", rule: "累计抗阻训练容量达到 10,000 kg", current: Math.round(totalVolume), target: 10000, unit: "kg", unlockedAt: tonnageTracker.dateFor(10000), tier: "standard" }),
    makeBadge({ id: "tonnage-25t", title: "廿五重卡", subtitle: "相当于举起一辆重型卡车", category: "volume", rule: "累计抗阻训练容量达到 25,000 kg", current: Math.round(totalVolume), target: 25000, unit: "kg", unlockedAt: tonnageTracker.dateFor(25000), tier: "standard" }),
    makeBadge({ id: "tonnage-50t", title: "五十吨重装", subtitle: "相当于举起一节重载车厢", category: "volume", rule: "累计抗阻训练容量达到 50,000 kg", current: Math.round(totalVolume), target: 50000, unit: "kg", unlockedAt: tonnageTracker.dateFor(50000), tier: "milestone" }),
    makeBadge({ id: "tonnage-100t", title: "百吨巨兽", subtitle: "十万千克的汗水堆叠", category: "volume", rule: "累计抗阻训练容量达到 100,000 kg", current: Math.round(totalVolume), target: 100000, unit: "kg", unlockedAt: tonnageTracker.dateFor(100000), tier: "milestone" }),
    makeBadge({ id: "tonnage-250t", title: "二百五吨", subtitle: "接近一架宽体客机的起飞重量", category: "volume", rule: "累计抗阻训练容量达到 250,000 kg", current: Math.round(totalVolume), target: 250000, unit: "kg", unlockedAt: tonnageTracker.dateFor(250000), tier: "prestige" }),
    makeBadge({ id: "tonnage-500t", title: "五百吨神迹", subtitle: "半百万千克的铁血征程", category: "volume", rule: "累计抗阻训练容量达到 500,000 kg", current: Math.round(totalVolume), target: 500000, unit: "kg", unlockedAt: tonnageTracker.dateFor(500000), tier: "prestige" }),
    makeBadge({ id: "tonnage-1000t", title: "千吨泰坦", subtitle: "百万千克传奇达成", category: "volume", rule: "累计抗阻训练容量达到 1,000,000 kg", current: Math.round(totalVolume), target: 1000000, unit: "kg", unlockedAt: tonnageTracker.dateFor(1000000), tier: "prestige" }),
    makeBadge({ id: "session-5t", title: "单场五吨", subtitle: "一节高强度大容量的训练轰炸", category: "volume", rule: "单次正式训练总容量达到 5,000 kg", current: Math.round(maxSessionVolume), target: 5000, unit: "kg", unlockedAt: sessionVolTracker.dateFor(5000), tier: "standard" }),
    makeBadge({ id: "session-10t", title: "单场十吨", subtitle: "单次扛下万斤重铁的硬核输出", category: "volume", rule: "单次正式训练总容量达到 10,000 kg", current: Math.round(maxSessionVolume), target: 10000, unit: "kg", unlockedAt: sessionVolTracker.dateFor(10000), tier: "milestone" }),
    makeBadge({ id: "sets-100", title: "百组筑基", subtitle: "前一百组标准动作夯实基础", category: "volume", rule: "累计完成 100 个有效训练工作组", current: totalSets, target: 100, unit: "组", unlockedAt: setsTracker.dateFor(100), tier: "standard" }),
    makeBadge({ id: "sets-300", title: "三百组锤炼", subtitle: "扎实容量筑起肌肉底座", category: "volume", rule: "累计完成 300 个有效训练工作组", current: totalSets, target: 300, unit: "组", unlockedAt: setsTracker.dateFor(300), tier: "standard" }),
    makeBadge({ id: "sets-500", title: "五百组中坚", subtitle: "五百组打磨出的力量轮廓", category: "volume", rule: "累计完成 500 个有效训练工作组", current: totalSets, target: 500, unit: "组", unlockedAt: setsTracker.dateFor(500), tier: "milestone" }),
    makeBadge({ id: "sets-1000", title: "千组铁壁", subtitle: "每一次力竭前的稳扎稳打", category: "volume", rule: "累计完成 1,000 个有效训练工作组", current: totalSets, target: 1000, unit: "组", unlockedAt: setsTracker.dateFor(1000), tier: "prestige" }),
    makeBadge({ id: "sets-2500", title: "两千五百组", subtitle: "肌肉量与耐力的深厚护城河", category: "volume", rule: "累计完成 2,500 个有效训练工作组", current: totalSets, target: 2500, unit: "组", unlockedAt: setsTracker.dateFor(2500), tier: "prestige" }),
    makeBadge({ id: "reps-1000", title: "千次重复", subtitle: "一千次推起与拉回的神经刻录", category: "volume", rule: "累计完成 1,000 次抗阻重复次数", current: totalReps, target: 1000, unit: "次", unlockedAt: repsTracker.dateFor(1000), tier: "standard" }),
    makeBadge({ id: "reps-5000", title: "五千次淬炼", subtitle: "动作模式已成身体本能", category: "volume", rule: "累计完成 5,000 次抗阻重复次数", current: totalReps, target: 5000, unit: "次", unlockedAt: repsTracker.dateFor(5000), tier: "milestone" }),
    makeBadge({ id: "reps-10000", title: "万次定律", subtitle: "一万次有效收缩的蜕变", category: "volume", rule: "累计完成 10,000 次抗阻重复次数", current: totalReps, target: 10000, unit: "次", unlockedAt: repsTracker.dateFor(10000), tier: "prestige" }),
    makeBadge({ id: "hours-10", title: "十小时铁馆", subtitle: "把碎片时间放进杠铃里", category: "volume", rule: "累计有效训练与运动时长达到 10 小时", current: round1(totalSeconds / 3600), target: 10, unit: "h", unlockedAt: hoursTracker.dateFor(10), tier: "standard" }),
    makeBadge({ id: "hours-50", title: "五十小时沉淀", subtitle: "五十小时汗水的真实刻度", category: "volume", rule: "累计有效训练与运动时长达到 50 小时", current: round1(totalSeconds / 3600), target: 50, unit: "h", unlockedAt: hoursTracker.dateFor(50), tier: "milestone" }),
    makeBadge({ id: "hours-100", title: "百小时匠人", subtitle: "铁馆里的一百个小时", category: "volume", rule: "累计有效训练与运动时长达到 100 小时", current: round1(totalSeconds / 3600), target: 100, unit: "h", unlockedAt: hoursTracker.dateFor(100), tier: "prestige" }),

    // ==================== 3. strength (21 枚) ====================
    makeBadge({ id: "pr-first", title: "首破纪录", subtitle: "超越昨天的第一个刻度", category: "strength", rule: "在任意 1 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 1, unit: "项", unlockedAt: prTracker.dateFor(1), tier: "standard" }),
    makeBadge({ id: "pr-breaker", title: "破壁时刻", subtitle: "持续刷新自己的上限", category: "strength", rule: "在至少 3 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 3, unit: "项", unlockedAt: prTracker.dateFor(3), tier: "milestone" }),
    makeBadge({ id: "pr-master", title: "八项全破", subtitle: "全面刷新多肌群动作极限", category: "strength", rule: "在至少 8 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 8, unit: "项", unlockedAt: prTracker.dateFor(8), tier: "prestige" }),
    makeBadge({ id: "pr-legend", title: "十五项破界", subtitle: "武器库中半数动作都刻着你的纪录", category: "strength", rule: "在至少 15 个动作上刷新个人最高重量或估算 1RM", current: prExercises.size, target: 15, unit: "项", unlockedAt: prTracker.dateFor(15), tier: "prestige" }),
    makeBadge({ id: "full-split", title: "五维均衡", subtitle: "全身肌群协同发展", category: "strength", rule: "胸、背、腿、肩、臂 5 大肌群各自累计完成至少 20 组", current: split20Count, target: 5, unit: "肌群", unlockedAt: fullSplit20At, tier: "milestone" }),
    makeBadge({ id: "full-split-50", title: "五维大师", subtitle: "没有短板的全面体格", category: "strength", rule: "胸、背、腿、肩、臂 5 大肌群各自累计完成至少 50 组", current: split50Count, target: 5, unit: "肌群", unlockedAt: fullSplit50At, tier: "prestige" }),
    makeBadge({ id: "bench-60", title: "六十卧推", subtitle: "每侧一枚 20kg 大片的起点", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 60 kg", current: round1(maxBenchScore), target: 60, unit: "kg", unlockedAt: benchTracker.dateFor(60), tier: "standard" }),
    makeBadge({ id: "bench-80", title: "八十卧推", subtitle: "突破自重的胸肌推力", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 80 kg", current: round1(maxBenchScore), target: 80, unit: "kg", unlockedAt: benchTracker.dateFor(80), tier: "milestone" }),
    makeBadge({ id: "bench-100", title: "百公斤卧推", subtitle: "上肢推力殿堂门票", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 100 kg", current: round1(maxBenchScore), target: 100, unit: "kg", unlockedAt: benchTracker.dateFor(100), tier: "prestige" }),
    makeBadge({ id: "bench-120", title: "百二卧推", subtitle: "硬核推力两对半大片俱乐部", category: "strength", rule: "杠铃卧推单组重量或估算 1RM 达到 120 kg", current: round1(maxBenchScore), target: 120, unit: "kg", unlockedAt: benchTracker.dateFor(120), tier: "prestige" }),
    makeBadge({ id: "squat-80", title: "八十深蹲", subtitle: "下肢驱动力的稳固根基", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 80 kg", current: round1(maxSquatScore), target: 80, unit: "kg", unlockedAt: squatTracker.dateFor(80), tier: "standard" }),
    makeBadge({ id: "squat-100", title: "百公斤深蹲", subtitle: "扛起三位数重量的下盘自信", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 100 kg", current: round1(maxSquatScore), target: 100, unit: "kg", unlockedAt: squatTracker.dateFor(100), tier: "milestone" }),
    makeBadge({ id: "squat-120", title: "百二深蹲", subtitle: "下肢力量基石突破", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 120 kg", current: round1(maxSquatScore), target: 120, unit: "kg", unlockedAt: squatTracker.dateFor(120), tier: "prestige" }),
    makeBadge({ id: "squat-160", title: "百六深蹲", subtitle: "四大片铁王座冲击", category: "strength", rule: "杠铃深蹲单组重量或估算 1RM 达到 160 kg", current: round1(maxSquatScore), target: 160, unit: "kg", unlockedAt: squatTracker.dateFor(160), tier: "prestige" }),
    makeBadge({ id: "deadlift-80", title: "八十硬拉", subtitle: "后链铰链发力的开启", category: "strength", rule: "硬拉类动作单组重量或估算 1RM 达到 80 kg", current: round1(maxDeadliftScore), target: 80, unit: "kg", unlockedAt: deadliftTracker.dateFor(80), tier: "standard" }),
    makeBadge({ id: "deadlift-120", title: "百二硬拉", subtitle: "后链钢筋铁骨养成", category: "strength", rule: "硬拉类动作单组重量或估算 1RM 达到 120 kg", current: round1(maxDeadliftScore), target: 120, unit: "kg", unlockedAt: deadliftTracker.dateFor(120), tier: "milestone" }),
    makeBadge({ id: "deadlift-160", title: "百六硬拉", subtitle: "地球引力征服者", category: "strength", rule: "硬拉类动作单组重量或估算 1RM 达到 160 kg", current: round1(maxDeadliftScore), target: 160, unit: "kg", unlockedAt: deadliftTracker.dateFor(160), tier: "prestige" }),
    makeBadge({ id: "ohp-50", title: "五十肩推", subtitle: "垂直上推过顶的力量门面", category: "strength", rule: "推举类动作单组重量或估算 1RM 达到 50 kg", current: round1(maxOhpScore), target: 50, unit: "kg", unlockedAt: ohpTracker.dateFor(50), tier: "milestone" }),
    makeBadge({ id: "row-70", title: "七十划船", subtitle: "厚实背部拉力的强力背书", category: "strength", rule: "划船类动作单组重量或估算 1RM 达到 70 kg", current: round1(maxRowScore), target: 70, unit: "kg", unlockedAt: rowTracker.dateFor(70), tier: "milestone" }),
    makeBadge({ id: "sbd-250", title: "三大项二百五", subtitle: "卧推+深蹲+硬拉合力迈过两百五", category: "strength", rule: "卧推、深蹲、硬拉最高权重/1RM 总和达到 250 kg", current: round1(maxSbdScore), target: 250, unit: "kg", unlockedAt: sbdTracker.dateFor(250), tier: "milestone" }),
    makeBadge({ id: "sbd-400", title: "三大项四百", subtitle: "四百公斤殿堂级综合战力", category: "strength", rule: "卧推、深蹲、硬拉最高权重/1RM 总和达到 400 kg", current: round1(maxSbdScore), target: 400, unit: "kg", unlockedAt: sbdTracker.dateFor(400), tier: "prestige" }),

    // ==================== 4. lifestyle (21 枚) ====================
    makeBadge({ id: "diet-1", title: "首日净食", subtitle: "第一天把每餐营养都算清", category: "lifestyle", rule: "累计完成 1 天全天完整饮食记录标记", current: completeDietDates.length, target: 1, unit: "天", unlockedAt: completeDietDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "diet-7", title: "七日净食", subtitle: "连续记录建立热量账本", category: "lifestyle", rule: "累计完成 7 天全天完整饮食记录标记", current: completeDietDates.length, target: 7, unit: "天", unlockedAt: completeDietDates[6] ?? null, tier: "standard" }),
    makeBadge({ id: "diet-14", title: "饮食自律", subtitle: "三分练，七分吃", category: "lifestyle", rule: "累计完成 14 天全天完整饮食记录标记", current: completeDietDates.length, target: 14, unit: "天", unlockedAt: completeDietDates[13] ?? null, tier: "milestone" }),
    makeBadge({ id: "diet-30", title: "满月净食", subtitle: "三十天精确掌控热量与宏量", category: "lifestyle", rule: "累计完成 30 天全天完整饮食记录标记", current: completeDietDates.length, target: 30, unit: "天", unlockedAt: completeDietDates[29] ?? null, tier: "milestone" }),
    makeBadge({ id: "diet-60", title: "六十日净食", subtitle: "饮食管理已成为本能习惯", category: "lifestyle", rule: "累计完成 60 天全天完整饮食记录标记", current: completeDietDates.length, target: 60, unit: "天", unlockedAt: completeDietDates[59] ?? null, tier: "prestige" }),
    makeBadge({ id: "meals-50", title: "五十餐记录", subtitle: "每一口都有据可查", category: "lifestyle", rule: "累计记录 50 条饮食餐次条目", current: allDietRecords.length, target: 50, unit: "条", unlockedAt: allDietRecords[49] ? (allDietRecords[49].data as Diet).date : null, tier: "standard" }),
    makeBadge({ id: "meals-200", title: "两百餐账本", subtitle: "建立起专属你的营养数据库", category: "lifestyle", rule: "累计记录 200 条饮食餐次条目", current: allDietRecords.length, target: 200, unit: "条", unlockedAt: allDietRecords[199] ? (allDietRecords[199].data as Diet).date : null, tier: "milestone" }),
    makeBadge({ id: "protein-7", title: "蛋白七日", subtitle: "肌肉修复原料供应充足一周", category: "lifestyle", rule: "累计 7 天每日蛋白质摄入达到 120 g 以上", current: highProteinDates.length, target: 7, unit: "天", unlockedAt: highProteinDates[6] ?? null, tier: "standard" }),
    makeBadge({ id: "protein-14", title: "蛋白达人", subtitle: "充足蛋白质驱动超量恢复", category: "lifestyle", rule: "累计 14 天每日蛋白质摄入达到 120 g 以上", current: highProteinDates.length, target: 14, unit: "天", unlockedAt: highProteinDates[13] ?? null, tier: "milestone" }),
    makeBadge({ id: "protein-30", title: "蛋白大师", subtitle: "一个月高蛋白饮食稳定护航", category: "lifestyle", rule: "累计 30 天每日蛋白质摄入达到 120 g 以上", current: highProteinDates.length, target: 30, unit: "天", unlockedAt: highProteinDates[29] ?? null, tier: "prestige" }),
    makeBadge({ id: "protein-total-2kg", title: "两千克蛋白", subtitle: "累计补充 2,000 g 优质蛋白", category: "lifestyle", rule: "历史累计摄入蛋白质达到 2,000 g", current: Math.round(totalProteinG), target: 2000, unit: "g", unlockedAt: proteinTotalTracker.dateFor(2000), tier: "standard" }),
    makeBadge({ id: "protein-total-5kg", title: "五千克蛋白", subtitle: "打造高蛋白合成正氮环境", category: "lifestyle", rule: "历史累计摄入蛋白质达到 5,000 g", current: Math.round(totalProteinG), target: 5000, unit: "g", unlockedAt: proteinTotalTracker.dateFor(5000), tier: "milestone" }),
    makeBadge({ id: "four-meals-10", title: "三餐加餐", subtitle: "少食多餐全天候稳定供能", category: "lifestyle", rule: "累计 10 天集齐早、午、晚、加餐四餐记录", current: fourMealDates.length, target: 10, unit: "天", unlockedAt: fourMealDates[9] ?? null, tier: "standard" }),
    makeBadge({ id: "weight-7", title: "七日称重", subtitle: "用七日均线看穿水分起伏", category: "lifestyle", rule: "累计记录 7 天体重数据", current: weightDates.length, target: 7, unit: "天", unlockedAt: weightDates[6] ?? null, tier: "standard" }),
    makeBadge({ id: "weight-30", title: "体重掌舵", subtitle: "用连续趋势替代单日波动", category: "lifestyle", rule: "累计记录 30 天体重数据", current: weightDates.length, target: 30, unit: "天", unlockedAt: weightDates[29] ?? null, tier: "standard" }),
    makeBadge({ id: "weight-60", title: "六十日体态", subtitle: "两个月的精准体成分追踪", category: "lifestyle", rule: "累计记录 60 天体重数据", current: weightDates.length, target: 60, unit: "天", unlockedAt: weightDates[59] ?? null, tier: "milestone" }),
    makeBadge({ id: "weight-90", title: "九十日航线", subtitle: "一整个季度的体重纪律轨迹", category: "lifestyle", rule: "累计记录 90 天体重数据", current: weightDates.length, target: 90, unit: "天", unlockedAt: weightDates[89] ?? null, tier: "prestige" }),
    makeBadge({ id: "apple-sync-1", title: "首场同步", subtitle: "第一笔手表数据成功落袋", category: "lifestyle", rule: "通过 Apple 健康快捷指令同步至少 1 场运动记录", current: projected.length, target: 1, unit: "次", unlockedAt: projected[0]?.date ?? null, tier: "standard" }),
    makeBadge({ id: "apple-sync", title: "生态闭环", subtitle: "手表与训练台无缝合流", category: "lifestyle", rule: "通过 Apple 健康快捷指令同步 10 场运动记录", current: projected.length, target: 10, unit: "次", unlockedAt: projected[9]?.date ?? null, tier: "standard" }),
    makeBadge({ id: "apple-sync-30", title: "三十场互联", subtitle: "全自动无感运动数据闭环", category: "lifestyle", rule: "通过 Apple 健康快捷指令同步 30 场运动记录", current: projected.length, target: 30, unit: "次", unlockedAt: projected[29]?.date ?? null, tier: "milestone" }),
    makeBadge({ id: "apple-burn-5000", title: "五千卡燃烧", subtitle: "手表实测五千千卡高能燃脂", category: "lifestyle", rule: "通过 Apple 健康同步运动累计消耗 5,000 kcal", current: Math.round(totalAppleBurnKcal), target: 5000, unit: "kcal", unlockedAt: appleBurnTracker.dateFor(5000), tier: "milestone" }),

    // ==================== 5. special (21 枚) ====================
    makeBadge({ id: "early-bird", title: "晨光先驱", subtitle: "在城市苏醒前热身完毕", category: "special", rule: "在每日 09:00 前开启并完成任意一场训练或有氧", current: earlyBirdDates.length, target: 1, unit: "次", unlockedAt: earlyBirdDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "early-bird-5", title: "晨练五场", subtitle: "五次战胜被窝的清晨举铁", category: "special", rule: "累计 5 次在每日 09:00 前开启并完成训练或有氧", current: earlyBirdDates.length, target: 5, unit: "次", unlockedAt: earlyBirdDates[4] ?? null, tier: "milestone" }),
    makeBadge({ id: "lunch-lifter", title: "午间铁客", subtitle: "借午休一小时高效充血", category: "special", rule: "在每日 11:30–13:59 开启并完成任意一场训练或运动", current: lunchDates.length, target: 1, unit: "次", unlockedAt: lunchDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "golden-hour-10", title: "黄金晚训", subtitle: "下班后黄金晚高峰守望者", category: "special", rule: "累计 10 次在每日 17:00–19:59 开启并完成训练或运动", current: goldenHourDates.length, target: 10, unit: "次", unlockedAt: goldenHourDates[9] ?? null, tier: "standard" }),
    makeBadge({ id: "night-owl", title: "夜训行者", subtitle: "华灯初上后的铁馆专注", category: "special", rule: "在每日 20:00 及以后开启并完成任意一场训练或运动", current: nightOwlDates.length, target: 1, unit: "次", unlockedAt: nightOwlDates[0] ?? null, tier: "standard" }),
    makeBadge({ id: "night-owl-10", title: "暗夜十场", subtitle: "夜间静音灯光里的十次酣畅", category: "special", rule: "累计 10 次在每日 20:00 及以后开启并完成训练或运动", current: nightOwlDates.length, target: 10, unit: "次", unlockedAt: nightOwlDates[9] ?? null, tier: "milestone" }),
    makeBadge({ id: "double-day", title: "双修达人", subtitle: "力量与耐力兼收并蓄", category: "special", rule: "在同一天内同时完成力量训练与有氧运动", current: doubleDays.length, target: 1, unit: "天", unlockedAt: doubleDays[0] ?? null, tier: "milestone" }),
    makeBadge({ id: "double-day-5", title: "五日双修", subtitle: "力量加有氧双线狂飙五天", category: "special", rule: "累计 5 天同日同时完成力量训练与有氧运动", current: doubleDays.length, target: 5, unit: "天", unlockedAt: doubleDays[4] ?? null, tier: "prestige" }),
    makeBadge({ id: "streak-3", title: "三连火花", subtitle: "连续三天不断电的第一把火", category: "special", rule: "达成连续 3 天每日均有训练或运动打卡纪录", current: maxStreak, target: 3, unit: "天", unlockedAt: streakTracker.dateFor(3), tier: "standard" }),
    makeBadge({ id: "streak-7", title: "七日连击", subtitle: "一周七天不间断的能量弧", category: "special", rule: "达成连续 7 天每日均有训练或运动打卡纪录", current: maxStreak, target: 7, unit: "天", unlockedAt: streakTracker.dateFor(7), tier: "prestige" }),
    makeBadge({ id: "streak-14", title: "十四日铁律", subtitle: "连续两周无断档的自律铁军", category: "special", rule: "达成连续 14 天每日均有训练或运动打卡纪录", current: maxStreak, target: 14, unit: "天", unlockedAt: streakTracker.dateFor(14), tier: "prestige" }),
    makeBadge({ id: "streak-21", title: "廿一日习惯", subtitle: "心理学公认习惯定型里程碑", category: "special", rule: "达成连续 21 天每日均有训练或运动打卡纪录", current: maxStreak, target: 21, unit: "天", unlockedAt: streakTracker.dateFor(21), tier: "prestige" }),
    makeBadge({ id: "streak-30", title: "满月连击", subtitle: "整月零缺席的极致坚持", category: "special", rule: "达成连续 30 天每日均有训练或运动打卡纪录", current: maxStreak, target: 30, unit: "天", unlockedAt: streakTracker.dateFor(30), tier: "prestige" }),
    makeBadge({ id: "variety-10", title: "十艺精通", subtitle: "解锁十种不同训练动作轨迹", category: "special", rule: "累计使用至少 10 个不同训练动作完成有效工作组", current: usedExercises.size, target: 10, unit: "种", unlockedAt: varietyTracker.dateFor(10), tier: "standard" }),
    makeBadge({ id: "variety-25", title: "廿五武器库", subtitle: "动作库里的全能战神", category: "special", rule: "累计使用至少 25 个不同训练动作完成有效工作组", current: usedExercises.size, target: 25, unit: "种", unlockedAt: varietyTracker.dateFor(25), tier: "milestone" }),
    makeBadge({ id: "equipment-4", title: "四器皆通", subtitle: "杠铃哑铃绳索器械样样精通", category: "special", rule: "使用至少 4 种不同器械类型完成有效工作组", current: usedEquipments.size, target: 4, unit: "类", unlockedAt: equipTracker.dateFor(4), tier: "standard" }),
    makeBadge({ id: "marathon-60m", title: "六十分钟鏖战", subtitle: "一整小时不间断的深度充血", category: "special", rule: "单次训练或运动有效时长达到 60 分钟以上", current: Math.round(maxSessionSeconds / 60), target: 60, unit: "分", unlockedAt: sessionMinTracker.dateFor(60), tier: "standard" }),
    makeBadge({ id: "session-20sets", title: "单场二十组", subtitle: "高容积单场耐力极限测试", category: "special", rule: "单次正式训练完成至少 20 个有效工作组", current: maxSessionSets, target: 20, unit: "组", unlockedAt: sessionSetsTracker.dateFor(20), tier: "milestone" }),
    makeBadge({ id: "feeling-balanced-20", title: "稳态二十场", subtitle: "找到恰到好处的渐进超负荷点", category: "special", rule: "累计完成 20 场训练体感标注为「适中」", current: balancedDates.length, target: 20, unit: "场", unlockedAt: balancedDates[19] ?? null, tier: "milestone" }),
    makeBadge({ id: "grit-fatigued-5", title: "逆风五场", subtitle: "累到想放弃时还是扛完了全程", category: "special", rule: "累计完成 5 场训练体感标注为「疲惫」的坚持纪录", current: fatiguedDates.length, target: 5, unit: "场", unlockedAt: fatiguedDates[4] ?? null, tier: "milestone" }),
    makeBadge({ id: "triad-day-10", title: "十日全满贯", subtitle: "练吃称三环同一天完美闭环", category: "special", rule: "累计 10 天在同一日集齐训练打卡、完整饮食与体重记录", current: triadDates.length, target: 10, unit: "天", unlockedAt: triadDates[9] ?? null, tier: "prestige" }),
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
