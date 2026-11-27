import { z } from "zod";
import type Database from "better-sqlite3";
import {
  compareWorkouts, estimateEnergy, estimatedOneRepMax, isValidWorkSet, localDate, muscleNames,
  nutritionDayComplete, nutritionTotals, profileSchema, weightToKg, weightTrend, workoutDurationSeconds,
  type Diet, type NutritionDay, type StoredRecord, type Weight, type Workout,
} from "@ironlog/shared";
import { listDailyHealth, summarizeDailyHealth } from "./apple-health-daily.js";
import { projectAppleTraining } from "./apple-training-agenda.js";
import type { Db } from "./db.js";
import { DomainError, type Store } from "./store.js";

type Stmt = Database.Statement<unknown[], unknown>;
const prefStmts = new WeakMap<Db, { read: Stmt; write: Stmt }>();
function getPrefStmts(db: Db) {
  let stmts = prefStmts.get(db);
  if (!stmts) {
    stmts = {
      read: db.prepare("SELECT revision, data FROM web_statistics_preferences WHERE user_id=?"),
      write: db.prepare(`INSERT INTO web_statistics_preferences VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision, data=excluded.data`),
    };
    prefStmts.set(db, stmts);
  }
  return stmts;
}

const days = [7, 30, 90, 365] as const;
const panels = ["load", "muscle", "consistency", "strength", "weight", "nutrition", "apple", "feeling"] as const;
const preferenceSchema = z.object({
  days: z.literal(days).default(30),
  includeWarmups: z.boolean().default(false),
  panels: z.array(z.enum(panels)).min(1).max(panels.length)
    .refine((value) => new Set(value).size === value.length).default([...panels]),
});
export const webPreferencesInput = preferenceSchema.extend({ revision: z.number().int().nonnegative() });
export const webStatsQuery = z.object({
  days: z.enum(["7", "30", "90", "365"]).transform(Number).optional(),
  through: z.iso.date().optional(),
  exercise: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
});
const DAY_MS = 86400000;
const TRACKED_MUSCLES = ["chest", "back", "legs", "shoulders", "arms", "core"] as const;
const TRACKED_MUSCLE_SET = new Set<string>(TRACKED_MUSCLES);
const MUSCLE_RECOVERY_TAU_HOURS: Record<string, number> = {
  legs: 72,
  back: 60,
  chest: 60,
  shoulders: 48,
  arms: 42,
  core: 36,
};
export function shiftDay(date: string, delta: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + delta * DAY_MS).toISOString().slice(0, 10);
}
function number(value: number) { return Math.round(value * 100) / 100; }

export function webPreferences(db: Db, userId: string) {
  const row = getPrefStmts(db).read.get(userId) as { revision: number; data: string } | undefined;
  return { revision: row?.revision ?? 0, ...preferenceSchema.parse(row ? JSON.parse(row.data) : {}) };
}

export function saveWebPreferences(db: Db, userId: string, input: z.infer<typeof webPreferencesInput>) {
  return db.transaction(() => {
    if (webPreferences(db, userId).revision !== input.revision)
      throw new DomainError("统计设置已在其他设备更新，请重新加载", 409);
    const preferences = preferenceSchema.parse(input);
    const revision = input.revision + 1;
    getPrefStmts(db).write.run(userId, revision, JSON.stringify(preferences));
    return { revision, ...preferences };
  }).immediate();
}

export function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export type StreakFreezeEntry = { weekKey: string; usedAt: string };

export function hasUsedStreakFreezeInMonth(
  targetDate: string,
  frozenWeeks: readonly string[] = [],
  freezeLog: readonly StreakFreezeEntry[] = [],
): boolean {
  const monthPrefix = targetDate.slice(0, 7);
  if (freezeLog.some((entry) => entry.usedAt.startsWith(monthPrefix))) {
    return true;
  }
  // Legacy fallback: only inspect weeks that have no recorded `usedAt` date in freezeLog.
  const loggedWeeks = new Set(freezeLog.map((entry) => entry.weekKey));
  const legacyWeeks = new Set(frozenWeeks.filter((wk) => !loggedWeeks.has(wk)));
  if (legacyWeeks.size === 0) return false;
  for (let offset = 0; offset < 31; offset++) {
    const d = shiftDay(targetDate, -offset);
    if (!d.startsWith(monthPrefix)) break;
    if (legacyWeeks.has(isoWeekKey(d))) return true;
  }
  return false;
}

export function computeWeeklyStreak(
  activityDays: ReadonlySet<string>,
  todayDate: string,
  frozenWeeks: readonly string[] = [],
  freezeLog: readonly StreakFreezeEntry[] = [],
) {
  const frozenSet = new Set<string>([...frozenWeeks, ...freezeLog.map((entry) => entry.weekKey)]);
  const activeWeeks = new Set<string>();
  for (const d of activityDays) {
    if (d <= todayDate) activeWeeks.add(isoWeekKey(d));
  }
  const currentWeekKey = isoWeekKey(todayDate);
  const prevWeekKey = isoWeekKey(shiftDay(todayDate, -7));

  let cursorDate = activeWeeks.has(currentWeekKey) || frozenSet.has(currentWeekKey)
    ? todayDate
    : activeWeeks.has(prevWeekKey) || frozenSet.has(prevWeekKey)
      ? shiftDay(todayDate, -7)
      : null;

  let currentWeeks = 0;
  const seen = new Set<string>();
  while (cursorDate) {
    const wk = isoWeekKey(cursorDate);
    if (seen.has(wk)) break;
    seen.add(wk);
    if (activeWeeks.has(wk) || frozenSet.has(wk)) {
      currentWeeks++;
      cursorDate = shiftDay(cursorDate, -7);
    } else {
      break;
    }
  }

  // Monthly allowance: 1 freeze per calendar month based on consumption date (`usedAt`)
  const usedThisMonth = hasUsedStreakFreezeInMonth(todayDate, frozenWeeks, freezeLog) ? 1 : 0;

  return {
    currentWeeks,
    currentWeekKey,
    isCurrentWeekFrozen: frozenSet.has(currentWeekKey),
    freezeRemainingThisMonth: Math.max(0, 1 - usedThisMonth),
    frozenWeeks: [...frozenSet].sort(),
  };
}

export function getWebStatistics(store: Store, userId: string, query: z.infer<typeof webStatsQuery>) {
  const preferences = webPreferences(store.db, userId);
  const period = query.days ?? preferences.days;
  const today = localDate();
  const through = query.through ?? today;
  if (through > today || through < "1902-01-01") throw new DomainError("选择有效的统计截止日期");
  const from = shiftDay(through, 1 - period);
  const previousFrom = shiftDay(from, -period);
  const trendFrom = shiftDay(through, -363);
  const earliest = previousFrom < trendFrom ? previousFrom : trendFrom;
  const inPeriod = (date: string) => date >= from && date <= through;
  const profileRecord = store.get(userId, "profile", "settings");
  const profile = profileSchema.parse(profileRecord?.deleted ? {} : profileRecord?.data ?? {});
  const catalogue = store.catalogueMap(userId, true);
  const days = new Map(Array.from({ length: period * 2 }, (_, i) => {
    const date = shiftDay(previousFrom, i);
    return [date, { date, workouts: 0, volume: 0, sets: 0, seconds: 0, timedWorkouts: 0, apple: 0, addedApple: 0 }];
  }));
  const activityDays = new Set<string>();
  const muscleSets: Record<string, number> = {};
  const recoveryWindowFrom = shiftDay(through, -20);
  const recent7dFrom = shiftDay(through, -6);
  const refMs = through === today ? Date.now() : Date.parse(through + "T23:59:59+08:00");
  const lastTrainedDateByMuscle = new Map<string, string>();
  const muscleFatigueScore = new Map<string, number>();
  const muscleRecent7dSets = new Map<string, number>();
  const exerciseOptions = new Map<string, { id: string; name: string; count: number }>();
  const strengthByExercise = new Map<string, { date: string; weight: number; estimated1rm: number | null }[]>();
  const workouts = store.list(userId, "workout")
    .map((record) => ({ id: record.id, workout: record.data as Workout }))
    .filter(({ workout }) => workout.status === "completed" && workout.date <= through)
    .sort((a, b) => compareWorkouts(a.workout, b.workout));
  const recent = [];
  const feelings = { easy: 0, balanced: 0, fatigued: 0, missing: 0 };
  for (const { id, workout } of workouts) {
    activityDays.add(workout.date);
    const day = days.get(workout.date);
    const duration = workoutDurationSeconds(workout);
    let sessionSets = 0;
    let sessionVolume = 0;
    const sessionMuscleLoad = new Map<string, number>();
    const sessionMuscleRawSets = new Map<string, number>();
    const byExercise = new Map<string, { name: string; weight: number; estimated1rm: number | null }>();
    for (const row of workout.exercises) {
      const exercise = row.snapshot ?? catalogue.get(row.exerciseId);
      if (!exercise) continue;
      const secondaryList = (catalogue.get(row.exerciseId)?.secondaryMuscles ?? [])
        .filter((sec) => sec !== exercise.muscle && TRACKED_MUSCLE_SET.has(sec));
      for (const set of row.sets) {
        const isStrictWork = isValidWorkSet(set, exercise.mode);
        if (isStrictWork) {
          if (TRACKED_MUSCLE_SET.has(exercise.muscle)) {
            if (!lastTrainedDateByMuscle.has(exercise.muscle) || workout.date > lastTrainedDateByMuscle.get(exercise.muscle)!) {
              lastTrainedDateByMuscle.set(exercise.muscle, workout.date);
            }
          }
          for (const sec of secondaryList) {
            if (!lastTrainedDateByMuscle.has(sec) || workout.date > lastTrainedDateByMuscle.get(sec)!) {
              lastTrainedDateByMuscle.set(sec, workout.date);
            }
          }
          if (workout.date >= recoveryWindowFrom) {
            const setWeight = set.type === "failure" || set.rir === 0
              ? 1.35
              : set.type === "drop" || set.type === "rest_pause"
                ? 1.25
                : set.rir === 1
                  ? 1.2
                  : set.rir != null && set.rir >= 4
                    ? 0.75
                    : 1.0;
            if (TRACKED_MUSCLE_SET.has(exercise.muscle)) {
              sessionMuscleLoad.set(exercise.muscle, (sessionMuscleLoad.get(exercise.muscle) ?? 0) + 1.0 * setWeight);
              sessionMuscleRawSets.set(exercise.muscle, (sessionMuscleRawSets.get(exercise.muscle) ?? 0) + 1.0);
            }
            for (const sec of new Set(secondaryList)) {
              sessionMuscleLoad.set(sec, (sessionMuscleLoad.get(sec) ?? 0) + 0.5 * setWeight);
              sessionMuscleRawSets.set(sec, (sessionMuscleRawSets.get(sec) ?? 0) + 0.5);
            }
          }
        }
        const warmup = set.type === "warmup";
        if (!isValidWorkSet(warmup && preferences.includeWarmups ? { ...set, type: "normal" } : set, exercise.mode)) continue;
        sessionSets++;
        if (inPeriod(workout.date))
          muscleSets[exercise.muscle] = (muscleSets[exercise.muscle] ?? 0) + 1;
        if (exercise.mode !== "reps" || set.weight <= 0) continue;
        const setWeightKg = weightToKg(set.weight, row.weightUnit);
        sessionVolume += setWeightKg * set.reps * exercise.volumeMultiplier;
        if (warmup) continue;
        const previous = byExercise.get(row.exerciseId);
        const estimate = set.reps <= 10 ? estimatedOneRepMax(setWeightKg, set.reps) : null;
        byExercise.set(row.exerciseId, {
          name: exercise.name, weight: Math.max(previous?.weight ?? 0, setWeightKg),
          estimated1rm: estimate == null ? previous?.estimated1rm ?? null : Math.max(previous?.estimated1rm ?? 0, estimate),
        });
      }
    }
    if (sessionMuscleLoad.size > 0) {
      const parsedEnd = Date.parse(workout.endedAt ?? (workout.date + "T18:00:00+08:00"));
      const endedMs = Number.isFinite(parsedEnd) ? parsedEnd : Date.parse(workout.date + "T18:00:00+08:00");
      const hoursAgo = Math.max(0, (refMs - endedMs) / 3600000);
      for (const [mKey, weightedLoad] of sessionMuscleLoad) {
        const tau = MUSCLE_RECOVERY_TAU_HOURS[mKey] ?? 48;
        const contribution = weightedLoad * 11 * Math.exp(-hoursAgo / (tau * 0.65));
        muscleFatigueScore.set(mKey, (muscleFatigueScore.get(mKey) ?? 0) + contribution);
      }
      if (workout.date >= recent7dFrom) {
        for (const [mKey, rawSets] of sessionMuscleRawSets) {
          muscleRecent7dSets.set(mKey, (muscleRecent7dSets.get(mKey) ?? 0) + rawSets);
        }
      }
    }
    for (const [exerciseId, result] of byExercise) {
      const option = exerciseOptions.get(exerciseId);
      exerciseOptions.set(exerciseId, { id: exerciseId, name: result.name, count: (option?.count ?? 0) + 1 });
      if (inPeriod(workout.date)) {
        const points = strengthByExercise.get(exerciseId) ?? [];
        const last = points.at(-1);
        if (last?.date === workout.date) {
          last.weight = Math.max(last.weight, result.weight);
          if (result.estimated1rm !== null) last.estimated1rm = Math.max(last.estimated1rm ?? 0, number(result.estimated1rm));
        } else points.push({
          date: workout.date, weight: result.weight,
          estimated1rm: result.estimated1rm === null ? null : number(result.estimated1rm),
        });
        strengthByExercise.set(exerciseId, points);
      }
    }
    if (!day) continue;
    day.workouts++;
    day.volume += sessionVolume;
    day.sets += sessionSets;
    if (duration !== null) { day.seconds += duration; day.timedWorkouts++; }
    if (inPeriod(workout.date)) {
      feelings[workout.feeling ?? "missing"]++;
      recent.push({ id, title: workout.title, date: workout.date, feeling: workout.feeling,
        sets: sessionSets, volume: number(sessionVolume), duration });
    }
  }
  const weights = weightTrend(store.list(userId, "weight").map((row) => row.data as Weight)
    .filter((row) => row.date >= shiftDay(from, -6) && row.date <= through)).filter((row) => inPeriod(row.date));
  const meals = new Map<string, StoredRecord[]>();
  for (const record of store.list(userId, "diet")) {
    const date = (record.data as Diet).date;
    if (inPeriod(date)) {
      if (!meals.has(date)) meals.set(date, []);
      meals.get(date)!.push(record);
    }
  }
  const marked = new Map(store.list(userId, "nutritionDay")
    .map(({ data }) => [(data as NutritionDay).date, data as NutritionDay]));
  const nutrition = [...meals].sort(([a], [b]) => a.localeCompare(b)).map(([date, meals]) => {
    return { date, complete: nutritionDayComplete(marked.get(date), meals),
      ...nutritionTotals(meals.map(({ data }) => data as Diet)) };
  });
  const apple = projectAppleTraining(store, userId, through, catalogue, workouts).entries.flatMap((item) => {
    if (!item.manualWorkoutId) activityDays.add(item.date);
    const day = days.get(item.date);
    if (day) {
      day.apple++;
      if (!item.manualWorkoutId) day.addedApple++;
    }
    if (!inPeriod(item.date)) return [];
    return [{
      date: item.date, type: item.activityType, title: item.activity.title,
      durationSeconds: item.durationSeconds ?? null, durationKind: item.durationKind ?? null,
      kcal: item.activeEnergyKcal ?? null, energyKind: item.energyKind ?? null, heartRate: item.heartRate ?? null,
    }];
  });
  const daily = [...days.values()];
  const sum = (rows: typeof daily) => ({
    workouts: rows.reduce((total, row) => total + row.workouts, 0),
    activities: rows.reduce((total, row) => total + row.workouts + row.addedApple, 0),
    volume: number(rows.reduce((total, row) => total + row.volume, 0)),
    sets: rows.reduce((total, row) => total + row.sets, 0),
    seconds: rows.reduce((total, row) => total + row.seconds, 0),
    timedWorkouts: rows.reduce((total, row) => total + row.timedWorkouts, 0),
    activeDays: rows.filter((row) => row.workouts > 0 || row.addedApple > 0).length,
  });
  const series = daily.slice(period);
  const exercises = [...exerciseOptions.values()].sort((a, b) =>
    Number(strengthByExercise.has(b.id)) - Number(strengthByExercise.has(a.id)) || b.count - a.count);
  const selectedExercise = exercises.find((item) => item.id === query.exercise)?.id ?? exercises[0]?.id ?? null;
  const energy = through === today ? estimateEnergy(profile.energyProfile, through)
    : profile.calorieEstimate?.asOf === through ? estimateEnergy(profile.calorieEstimate.inputs, through) : null;
  const appleDailySummary = summarizeDailyHealth(
    listDailyHealth(store.db, userId, from, through),
    { heightCm: profile.energyProfile?.heightCm ?? null, sex: profile.energyProfile?.sex === "female" ? "female" : "male", through },
  );
  const throughMs = Date.parse(through + "T00:00:00Z");
  const muscleStatus = TRACKED_MUSCLES.map((key) => {
    const fatiguePct = Math.min(100, Math.round(muscleFatigueScore.get(key) ?? 0));
    const recoveryPct = Math.max(0, 100 - fatiguePct);
    const lastTrainedDate = lastTrainedDateByMuscle.get(key) ?? null;
    const daysSinceLast = lastTrainedDate
      ? Math.max(0, Math.round((throughMs - Date.parse(lastTrainedDate + "T00:00:00Z")) / DAY_MS))
      : null;
    const status = recoveryPct < 45
      ? "fatigued" as const
      : recoveryPct < 80
        ? "recovering" as const
        : daysSinceLast === null || daysSinceLast >= 10
          ? "detrained" as const
          : "ready" as const;
    const statusLabel = status === "fatigued"
      ? "建议休整"
      : status === "recovering"
        ? "恢复中"
        : status === "detrained"
          ? "久未刺激"
          : "状态就绪";
    return {
      key,
      name: muscleNames[key] ?? key,
      fatiguePct,
      recoveryPct,
      status,
      statusLabel,
      lastTrainedDate,
      daysSinceLast,
      recent7dSets: Math.round((muscleRecent7dSets.get(key) ?? 0) * 10) / 10,
    };
  });
  return {
    today, from, through, period, preferences, goals: profile, energy,
    totals: sum(series), previous: sum(daily.slice(0, period)),
    daily: series.map((day) => ({ ...day, volume: number(day.volume) })),
    activity: Array.from({ length: 364 }, (_, i) => {
      const date = shiftDay(trendFrom, i);
      return { date, active: activityDays.has(date) };
    }),
    recent: recent.reverse().slice(0, 6), weights, nutrition, apple, appleDailySummary, feelings,
    muscles: Object.entries(muscleSets).map(([key, sets]) => ({
      key, name: muscleNames[key as keyof typeof muscleNames] ?? key, sets,
    })).sort((a, b) => b.sets - a.sets),
    muscleStatus,
    weeklyStreak: computeWeeklyStreak(activityDays, through, profile.streakFreezeWeeks ?? [], profile.streakFreezeLog ?? []),
    strength: { exercises, selectedExercise, points: selectedExercise ? strengthByExercise.get(selectedExercise) ?? [] : [] },
  };
}
