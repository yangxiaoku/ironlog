import { z } from "zod";
import {
  ageOnDate,
  calculateAcwrSeries,
  calculateIpfGlPoints,
  calculateMonotonyAndStrain,
  classicStrength,
  computeMuscleRetention,
  calculateSetInol,
  evaluateEffortAndRepZones,
  evaluateNutritionEnergyBalance,
  evaluateProteinAdequacy,
  evaluateSessionInol,
  evaluateStrengthStandards,
  evaluateStructuralBalance,
  evaluateSymmetryAndFrequency,
  evaluateWeeklyMuscleDose,
  evaluateWeightChangeRate,
  estimatedOneRepMax,
  goalsOn,
  isValidWorkSet,
  localDate,
  muscleNames,
  nutritionDayComplete,
  profileSchema,
  SCIENCE_CITATIONS,
  weightToKg,
  workoutDurationSeconds,
  type Exercise,
  type Diet,
  type NutritionDay,
  type ScheduledDay,
  type StoredRecord,
  type Weight,
  type Workout,
} from "@ironlog/shared";
import type { Store } from "./store.js";
import { DomainError } from "./store.js";
import { alignSleepSnapshots, listDailyHealthSnapshots, publicDailySnapshot, summarizeDailyHealth } from "./apple-health-daily.js";
import { projectAppleTraining } from "./apple-training-agenda.js";
import { buildSleepReport } from "./sleep-report.js";
import { listMeasurements } from "./web-extras.js";
import { summarizePlanAdherence } from "./plan-adherence.js";
import { shiftDay } from "./web-statistics.js";

function isWeightedBodyweight(exerciseId: string, name: string) {
  return /pull-up|chin-up|dip|引体|双杠/i.test(`${exerciseId} ${name}`);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

type RepMaxHit = { weight: number; reps: number; date: string };

export const webAnalyticsQuery = z.object({
  days: z.enum(["14", "30", "60", "90", "180", "365"]).transform(Number).optional(),
  through: z.iso.date().optional(),
});

export function getWebAnalytics(store: Store, userId: string, query: z.infer<typeof webAnalyticsQuery>) {
  const today = localDate();
  const through = query.through ?? today;
  if (through > today || through < "1902-01-01") throw new DomainError("选择有效的统计截止日期");

  const displayPeriod = query.days ?? 30;
  // To have a reliable 28-day chronic window at the start of displayPeriod, we need displayPeriod + 28 days of history
  const historyDays = displayPeriod + 28;
  const historyStart = shiftDay(through, 1 - historyDays);
  const displayStart = shiftDay(through, 1 - displayPeriod);
  const prevPeriodStart = shiftDay(displayStart, -displayPeriod);
  const prevPeriodEnd = shiftDay(displayStart, -1);

  const profileRecord = store.get(userId, "profile", "settings");
  const profile = profileSchema.parse(profileRecord?.deleted ? {} : profileRecord?.data ?? {});
  const catalogue = store.catalogueMap(userId, true);
  const userGender = profile.energyProfile?.sex ?? null;
  const healthSnapshots = alignSleepSnapshots(listDailyHealthSnapshots(store.db, userId, prevPeriodStart, shiftDay(through, 1)))
    .filter(({ date }) => date >= prevPeriodStart && date <= through);
  const sleepReport = buildSleepReport(healthSnapshots, displayStart, through, displayPeriod);
  const sleepByDate = new Map(sleepReport.series.map((day) => [day.date, day]));
  const dailyHealthEntries = healthSnapshots.filter(({ date }) => date >= displayStart).map((snapshot) => {
    const day = sleepByDate.get(snapshot.date);
    const sleepMinutes = day?.minutes ?? undefined;
    return {
      ...publicDailySnapshot(snapshot),
      sleepMinutes,
      sleepCoreMinutes: day?.stages?.core ?? undefined,
      sleepDeepMinutes: day?.stages?.deep ?? undefined,
      sleepRemMinutes: day?.stages?.rem ?? undefined,
      sleepEfficiencyPct: sleepMinutes != null && sleepMinutes === snapshot.sleepMinutes ? snapshot.sleepEfficiencyPct : undefined,
    };
  });
  const appleDailySummary = summarizeDailyHealth(dailyHealthEntries, {
    heightCm: profile.energyProfile?.heightCm ?? null,
    sex: userGender ?? undefined,
    through,
  });

  // Retrieve user weights
  const allWeights = store
    .list(userId, "weight")
    .map((row) => row.data as Weight)
    .filter((w) => w.date <= through && w.weight > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const appleWeightsAsc = healthSnapshots
    .filter((s) => s.date <= through && typeof s.weightKg === "number" && s.weightKg > 0)
    .map((s) => ({ date: s.date, weight: s.weightKg as number }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const latestWeightRecord = allWeights.at(-1);
  const energyProfile = profile.energyProfile;
  const profileWeightKg = energyProfile && (energyProfile.weightDate ? energyProfile.weightDate <= through : through === today)
    ? energyProfile.weightKg
    : null;
  const userWeightKg = latestWeightRecord?.weight ?? profileWeightKg ?? appleDailySummary.bodyReport.weightKg ?? null;
  const loadWeightKg = userWeightKg ?? 75;
  let loadUsesReferenceWeight = false;

  // Per-workout historical weight lookup: always pick latest weight on/before workout.date so future weigh-ins never rewrite past loads
  const resolveWeightOnDate = (targetDate: string): { weightKg: number; isReference: boolean } => {
    let bestWeight: { date: string; weight: number } | null = null;
    for (let i = allWeights.length - 1; i >= 0; i--) {
      if (allWeights[i]!.date <= targetDate) {
        bestWeight = allWeights[i]!;
        break;
      }
    }
    if (bestWeight) return { weightKg: bestWeight.weight, isReference: false };

    let bestApple: { date: string; weight: number } | null = null;
    for (let i = appleWeightsAsc.length - 1; i >= 0; i--) {
      if (appleWeightsAsc[i]!.date <= targetDate) {
        bestApple = appleWeightsAsc[i]!;
        break;
      }
    }
    if (bestApple) return { weightKg: bestApple.weight, isReference: false };

    if (energyProfile && energyProfile.weightKg > 0 && (!energyProfile.weightDate || energyProfile.weightDate <= targetDate)) {
      return { weightKg: energyProfile.weightKg, isReference: false };
    }
    return { weightKg: 75, isReference: true };
  };

  // Build continuous daily loads map for ACWR & Monotony
  const dailyLoadsMap = new Map<string, number>();
  for (let i = 0; i < historyDays; i++) {
    dailyLoadsMap.set(shiftDay(historyStart, i), 0);
  }

  // #211: Sort workouts deterministically by date, actual start/end timestamp, then id so upload order never alters progress
  const workouts = store
    .list(userId, "workout")
    .map((record) => ({ id: record.id, workout: record.data as Workout }))
    .filter(({ workout }) => workout.status === "completed" && workout.date <= through)
    .sort((a, b) => {
      if (a.workout.date !== b.workout.date) return a.workout.date.localeCompare(b.workout.date);
      const aStart = Date.parse(a.workout.startedAt) || 0;
      const bStart = Date.parse(b.workout.startedAt) || 0;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = Date.parse(a.workout.endedAt ?? "") || 0;
      const bEnd = Date.parse(b.workout.endedAt ?? "") || 0;
      if (aEnd !== bEnd) return aEnd - bEnd;
      return a.id.localeCompare(b.id);
    });

  const muscleSetsPast7Days: Record<string, number> = {
    chest: 0,
    back: 0,
    legs: 0,
    shoulders: 0,
    arms: 0,
    core: 0,
  };
  const muscleSetsPast28Days: Record<string, number> = {
    chest: 0,
    back: 0,
    legs: 0,
    shoulders: 0,
    arms: 0,
    core: 0,
  };
  const muscleSessionDays28d: Record<string, Set<string>> = {
    chest: new Set(),
    back: new Set(),
    legs: new Set(),
    shoulders: new Set(),
    arms: new Set(),
    core: new Set(),
  };

  const past7DaysStart = shiftDay(through, -6);
  const past28DaysStart = shiftDay(through, -27);

  // Exercise best 1RMs and recent workouts for INOL
  const exercise1RMs = new Map<string, { name: string; best1RM: number; count: number }>();
  const exerciseRecentSets = new Map<string, { date: string; sets: { reps: number; weight: number }[] }>();
  const exerciseWeeklySets = new Map<string, { reps: number; weight: number }[]>();
  const periodTrainingDays = new Set<string>();
  const allTrainingDates = new Set<string>();
  const prevTrainingDays = new Set<string>();
  let periodSessions = 0;
  let periodWorkSets = 0;
  let periodTonnageKg = 0;
  let periodDurationSec = 0;
  let prevSessions = 0;
  let prevWorkSets = 0;
  let prevTonnageKg = 0;
  let prevDurationSec = 0;

  const periodEffortSets: Array<{ reps: number; rir?: number | null; mode?: string; weight: number; setType?: string }> = [];
  const displayStartMs = Date.parse(displayStart + "T00:00:00Z");
  const weeklyBuckets = new Map<number, {
    from: string;
    through: string;
    sessions: number;
    days: Set<string>;
    workSets: number;
    hardSets: number;
    tonnageKg: number;
    durationSeconds: number;
    load: number;
  }>();
  const exercisePeriodProgress = new Map<string, {
    id: string;
    name: string;
    muscle: string;
    mode: string;
    sessions: Set<string>;
    workSets: number;
    tonnageKg: number;
    firstDate: string;
    first1RM: number;
    lastDate: string;
    last1RM: number;
    best1RM: number;
  }>();
  const exerciseSessions = new Map<string, Array<{
    date: string;
    name: string;
    muscle: string;
    best1RM: number;
    workSets: number;
    volume: number;
  }>>();
  const repMaxByEx = new Map<string, {
    id: string;
    name: string;
    muscle: string;
    count: number;
    rm1?: RepMaxHit;
    rm3?: RepMaxHit;
    rm5?: RepMaxHit;
    rm8?: RepMaxHit;
    rm10?: RepMaxHit;
  }>();
  const workoutStatsByDate = new Map<string, { sessions: number; workSets: number; tonnageKg: number; fatiguedCount: number }>();

  for (const { id: workoutId, workout } of workouts) {
    let workoutLoad = 0;
    let workoutWorkSets = 0;
    let workoutTonnageKg = 0;
    const { weightKg: workoutBodyWeightKg, isReference: workoutWeightIsRef } = resolveWeightOnDate(workout.date);
    const workoutExMap = new Map<string, { name: string; muscle: string; best1RM: number; workSets: number; volume: number }>();
    allTrainingDates.add(workout.date);
    const durSec = workoutDurationSeconds(workout) ?? 0;
    const inPeriod = workout.date >= displayStart && workout.date <= through;
    const inPrevPeriod = workout.date >= prevPeriodStart && workout.date <= prevPeriodEnd;

    let weekEntry: ReturnType<typeof weeklyBuckets.get> | undefined;
    if (inPeriod) {
      periodSessions++;
      periodTrainingDays.add(workout.date);
      periodDurationSec += durSec;
      const weekIdx = Math.max(0, Math.floor((Date.parse(workout.date + "T00:00:00Z") - displayStartMs) / (7 * 86_400_000)));
      weekEntry = weeklyBuckets.get(weekIdx);
      if (!weekEntry) {
        const wFrom = shiftDay(displayStart, weekIdx * 7);
        const wToRaw = shiftDay(wFrom, 6);
        const wTo = wToRaw > through ? through : wToRaw;
        weekEntry = {
          from: wFrom,
          through: wTo,
          sessions: 0,
          days: new Set(),
          workSets: 0,
          hardSets: 0,
          tonnageKg: 0,
          durationSeconds: 0,
          load: 0,
        };
        weeklyBuckets.set(weekIdx, weekEntry);
      }
      weekEntry.sessions++;
      weekEntry.days.add(workout.date);
      weekEntry.durationSeconds += durSec;
    } else if (inPrevPeriod) {
      prevSessions++;
      prevTrainingDays.add(workout.date);
      prevDurationSec += durSec;
    }

    const workoutPeriodEx = new Map<string, {
      name: string;
      muscle: string;
      mode: string;
      workSets: number;
      tonnageKg: number;
      best1RM: number;
    }>();

    for (const item of workout.exercises) {
      const exercise = item.snapshot ?? catalogue.get(item.exerciseId);
      const secondaryMuscles = (
        exercise && "secondaryMuscles" in exercise && Array.isArray(exercise.secondaryMuscles)
          ? exercise.secondaryMuscles
          : catalogue.get(item.exerciseId)?.secondaryMuscles
      ) ?? [];
      const isPast7 = workout.date >= past7DaysStart;
      const isPast28 = workout.date >= past28DaysStart;

      let periodExBest1RM = 0;
      let periodExSets = 0;
      let periodExTonnage = 0;

      for (const set of item.sets) {
        if (!isValidWorkSet(set, exercise?.mode)) continue;
        workoutWorkSets++;
        if (inPeriod) {
          periodWorkSets++;
          periodExSets++;
          if (weekEntry) weekEntry.workSets++;
          const isHard =
            (set.rir != null && Number.isFinite(set.rir) && set.rir <= 2) ||
            set.type === "failure" ||
            set.type === "drop";
          if (isHard && weekEntry) weekEntry.hardSets++;
          const rawWeightKg = weightToKg(set.weight, item.weightUnit);
          periodEffortSets.push({
            reps: set.reps,
            rir: set.rir ?? null,
            mode: exercise?.mode ?? "reps",
            weight: rawWeightKg,
            setType: set.type,
          });
        } else if (inPrevPeriod) {
          prevWorkSets++;
        }

        if (exercise?.muscle && exercise.muscle in muscleSetsPast7Days) {
          if (isPast7) {
            muscleSetsPast7Days[exercise.muscle] = (muscleSetsPast7Days[exercise.muscle] ?? 0) + 1;
          }
          if (isPast28) {
            muscleSetsPast28Days[exercise.muscle] = (muscleSetsPast28Days[exercise.muscle] ?? 0) + 1;
            muscleSessionDays28d[exercise.muscle]?.add(workout.date);
          }
          for (const sec of secondaryMuscles) {
            if (sec === exercise.muscle || !(sec in muscleSetsPast7Days)) continue;
            if (isPast7) muscleSetsPast7Days[sec] = (muscleSetsPast7Days[sec] ?? 0) + 0.5;
            if (isPast28) {
              muscleSetsPast28Days[sec] = (muscleSetsPast28Days[sec] ?? 0) + 0.5;
              muscleSessionDays28d[sec]?.add(workout.date);
            }
          }
        }

        if (exercise && exercise.mode === "reps" && set.weight > 0 && set.reps > 0) {
          const setWeightKg = weightToKg(set.weight, item.weightUnit);
          const weightedBw = isWeightedBodyweight(item.exerciseId, exercise.name);
          if (weightedBw) loadUsesReferenceWeight ||= workoutWeightIsRef;
          const effectiveWeight = weightedBw
            ? round1(workoutBodyWeightKg + setWeightKg)
            : setWeightKg;
          const setVolume = effectiveWeight * set.reps * exercise.volumeMultiplier;
          const hasValidRir = set.rir != null && Number.isFinite(set.rir) && set.rir >= 0 && set.rir <= 4;
          const effortMult = set.rir != null && Number.isFinite(set.rir) && set.rir >= 0 && set.rir <= 5
            ? 1 + (5 - set.rir) * 0.05
            : 1;
          workoutLoad += setVolume * effortMult;
          workoutTonnageKg += setVolume;
          if (inPeriod) {
            periodTonnageKg += setVolume;
            periodExTonnage += setVolume;
            if (weekEntry) weekEntry.tonnageKg += setVolume;
          } else if (inPrevPeriod) {
            prevTonnageKg += setVolume;
          }

          // Adjust effective reps by RIR (Helms / Zourdos RPE-1RM equivalence) when valid RIR (0–4) is logged
          const effectiveReps = hasValidRir ? set.reps + set.rir! : set.reps;
          const estimate = estimatedOneRepMax(effectiveWeight, Math.min(effectiveReps, 12));
          if (inPeriod) periodExBest1RM = Math.max(periodExBest1RM, estimate);
          const currentBest = exercise1RMs.get(item.exerciseId);
          exercise1RMs.set(item.exerciseId, {
            name: exercise.name,
            best1RM: Math.max(currentBest?.best1RM ?? 0, estimate),
            count: (currentBest?.count ?? 0) + 1,
          });

          const wEx = workoutExMap.get(item.exerciseId) ?? {
            name: exercise.name,
            muscle: exercise.muscle ?? "other",
            best1RM: 0,
            workSets: 0,
            volume: 0,
          };
          wEx.workSets += 1;
          wEx.volume += setVolume;
          if (estimate > wEx.best1RM) wEx.best1RM = estimate;
          workoutExMap.set(item.exerciseId, wEx);

          const rm = repMaxByEx.get(item.exerciseId) ?? {
            id: item.exerciseId,
            name: exercise.name,
            muscle: exercise.muscle ?? "other",
            count: 0,
          };
          rm.count += 1;
          const roundedHitWeight = round1(effectiveWeight);
          const brackets = [
            [1, "rm1"],
            [3, "rm3"],
            [5, "rm5"],
            [8, "rm8"],
            [10, "rm10"],
          ] as const;
          for (const [minReps, key] of brackets) {
            if (set.reps >= minReps) {
              const cur = rm[key];
              if (!cur || roundedHitWeight > cur.weight || (roundedHitWeight === cur.weight && set.reps > cur.reps)) {
                rm[key] = { weight: roundedHitWeight, reps: set.reps, date: workout.date };
              }
            }
          }
          repMaxByEx.set(item.exerciseId, rm);

          // Track for INOL
          if (isPast7) {
            const list = exerciseWeeklySets.get(item.exerciseId) ?? [];
            list.push({ reps: set.reps, weight: effectiveWeight });
            exerciseWeeklySets.set(item.exerciseId, list);
          }
          // Track most recent session sets
          const recent = exerciseRecentSets.get(item.exerciseId);
          if (!recent || recent.date < workout.date) {
            exerciseRecentSets.set(item.exerciseId, {
              date: workout.date,
              sets: [{ reps: set.reps, weight: effectiveWeight }],
            });
          } else if (recent.date === workout.date) {
            recent.sets.push({ reps: set.reps, weight: effectiveWeight });
          }
        } else if (exercise?.mode === "assisted" && set.reps > 0) {
          loadUsesReferenceWeight ||= workoutWeightIsRef;
          const assistKg = weightToKg(set.weight, item.weightUnit);
          const effectiveLoad = Math.max(15, workoutBodyWeightKg - Math.min(workoutBodyWeightKg - 15, assistKg));
          workoutLoad += Math.round(effectiveLoad * set.reps * exercise.volumeMultiplier);
        } else if (exercise?.mode === "timed") {
          workoutLoad += Math.max(30, Math.round((set.seconds || 30) * 1.8));
        } else if (set.reps > 0) {
          loadUsesReferenceWeight ||= workoutWeightIsRef;
          const bwLoad = Math.round(workoutBodyWeightKg * 0.6 * Math.min(set.reps, 40) * (exercise?.volumeMultiplier ?? 1));
          workoutLoad += Math.max(15, bwLoad);
        }
      }

      if (inPeriod && periodExSets > 0 && exercise) {
        const cur = workoutPeriodEx.get(item.exerciseId) ?? {
          name: exercise.name,
          muscle: exercise.muscle ?? "other",
          mode: exercise.mode ?? "reps",
          workSets: 0,
          tonnageKg: 0,
          best1RM: 0,
        };
        cur.workSets += periodExSets;
        cur.tonnageKg += periodExTonnage;
        cur.best1RM = Math.max(cur.best1RM, periodExBest1RM);
        workoutPeriodEx.set(item.exerciseId, cur);
      }
    }

    // #211: Update exercisePeriodProgress once per chronologically-sorted workout so first1RM/last1RM/best1RM are exact
    for (const [exId, cur] of workoutPeriodEx) {
      const rounded1RM = Math.round(cur.best1RM * 10) / 10;
      const prev = exercisePeriodProgress.get(exId);
      if (!prev) {
        exercisePeriodProgress.set(exId, {
          id: exId,
          name: cur.name,
          muscle: cur.muscle,
          mode: cur.mode,
          sessions: new Set<string>([workoutId]),
          workSets: cur.workSets,
          tonnageKg: cur.tonnageKg,
          firstDate: workout.date,
          first1RM: rounded1RM,
          lastDate: workout.date,
          last1RM: rounded1RM,
          best1RM: rounded1RM,
        });
      } else {
        prev.sessions.add(workoutId);
        prev.workSets += cur.workSets;
        prev.tonnageKg += cur.tonnageKg;
        if (rounded1RM > 0) {
          if (prev.first1RM === 0) {
            prev.firstDate = workout.date;
            prev.first1RM = rounded1RM;
          }
          prev.lastDate = workout.date;
          prev.last1RM = rounded1RM;
          prev.best1RM = Math.max(prev.best1RM, rounded1RM);
        }
      }
    }

    if (weekEntry) weekEntry.load += Math.round(workoutLoad);
    if (dailyLoadsMap.has(workout.date)) {
      dailyLoadsMap.set(workout.date, (dailyLoadsMap.get(workout.date) ?? 0) + workoutLoad);
    }
    const dayStats = workoutStatsByDate.get(workout.date) ?? {
      sessions: 0,
      workSets: 0,
      tonnageKg: 0,
      fatiguedCount: 0,
    };
    dayStats.sessions += 1;
    dayStats.workSets += workoutWorkSets;
    dayStats.tonnageKg += Math.round(workoutTonnageKg);
    if (workout.feeling === "fatigued") dayStats.fatiguedCount += 1;
    workoutStatsByDate.set(workout.date, dayStats);
    for (const [exId, info] of workoutExMap) {
      if (info.best1RM <= 0) continue;
      const list = exerciseSessions.get(exId) ?? [];
      list.push({
        date: workout.date,
        name: info.name,
        muscle: info.muscle,
        best1RM: round1(info.best1RM),
        workSets: info.workSets,
        volume: Math.round(info.volume),
      });
      exerciseSessions.set(exId, list);
    }
  }

  // Calculate full ACWR series
  const dailyLoadsArray = Array.from(dailyLoadsMap.entries()).map(([date, load]) => ({ date, load }));
  const fullAcwrSeries = calculateAcwrSeries(dailyLoadsArray, 7, 28);
  // Filter for the requested display period
  const displayAcwrSeries = fullAcwrSeries.filter((pt) => pt.date >= displayStart && pt.date <= through);
  const currentAcwr = displayAcwrSeries.at(-1) ?? {
    date: through,
    load: 0,
    acuteLoad: 0,
    chronicLoad: 0,
    acwr: 0,
    zone: "deload" as const,
    zoneLabel: "低负荷/减载区 (<0.8)",
  };

  // Monotony & Strain for past 7 days vs previous 7 days
  const past7Loads = Array.from({ length: 7 }, (_, i) => dailyLoadsMap.get(shiftDay(through, -6 + i)) ?? 0);
  const prev7Loads = Array.from({ length: 7 }, (_, i) => dailyLoadsMap.get(shiftDay(through, -13 + i)) ?? 0);
  const currentMonotony = calculateMonotonyAndStrain(past7Loads);
  const prevMonotony = calculateMonotonyAndStrain(prev7Loads);

  // Muscle Volume Dose-Response & Symmetry / Frequency Audits
  const muscleDaysCount28d = Object.fromEntries(
    Object.entries(muscleSessionDays28d).map(([k, s]) => [k, s.size]),
  );
  const symmetry = evaluateSymmetryAndFrequency(muscleSetsPast7Days, muscleDaysCount28d);
  const muscleAudits = Object.entries(muscleSetsPast7Days).map(([key, sets]) => {
    const name = muscleNames[key as keyof typeof muscleNames] ?? key;
    const roundedSets = Math.round(sets * 10) / 10;
    const audit = evaluateWeeklyMuscleDose(key, name, roundedSets);
    const avg28Sets = Math.round(((muscleSetsPast28Days[key] ?? 0) / 4) * 10) / 10;
    return {
      ...audit,
      avg4WeekSets: avg28Sets,
      freqPerWeek: symmetry.frequencyByMuscle[key] ?? 0,
    };
  });

  const effortSpectrum = evaluateEffortAndRepZones(periodEffortSets);

  const sumWeeklyInol = (sets: { reps: number; weight: number }[], best1RM: number) => {
    let total = 0;
    for (const s of sets) total += calculateSetInol(s.reps, s.weight, best1RM);
    return Math.round(total * 100) / 100;
  };

  // INOL for top compound lifts
  const compoundCandidates = [
    { key: "bench", match: (id: string, name: string) => id.includes("bench") || name.includes("卧推") },
    { key: "squat", match: (id: string, name: string) => id.includes("squat") || name.includes("深蹲") },
    { key: "deadlift", match: (id: string, name: string) => id.includes("deadlift") || name.includes("硬拉") },
    {
      key: "press",
      match: (id: string, name: string) =>
        !id.includes("leg-press") &&
        !id.includes("bench") &&
        !id.includes("chest-press") &&
        !name.includes("腿举") &&
        !name.includes("卧推") &&
        (id.includes("overhead-press") ||
          id.includes("shoulder-press") ||
          id.includes("military-press") ||
          id.includes("press") ||
          name.includes("推举")),
    },
    { key: "row", match: (id: string, name: string) => id.includes("row") || name.includes("划船") },
    { key: "pullup", match: (id: string, name: string) => id.includes("pull-up") || id.includes("chin-up") || name.includes("引体") },
  ];

  const inolSummaries = [];
  const processedExerciseIds = new Set<string>();

  for (const cand of compoundCandidates) {
    const matching: [string, { name: string; best1RM: number; count: number }][] = [];
    for (const entry of exercise1RMs) {
      const [id, data] = entry;
      if (!processedExerciseIds.has(id) && cand.match(id, data.name)) matching.push(entry);
    }
    if (!matching.length) continue;
    matching.sort((a, b) => {
      const aPrimary = /barbell|杠铃/.test(a[0] + a[1].name) ? 1 : 0;
      const bPrimary = /barbell|杠铃/.test(b[0] + b[1].name) ? 1 : 0;
      return bPrimary - aPrimary || b[1].count - a[1].count || b[1].best1RM - a[1].best1RM;
    });
    const [id, data] = matching[0]!;
    processedExerciseIds.add(id);
    const recent = exerciseRecentSets.get(id);
    if (recent && recent.sets.length > 0 && data.best1RM > 0) {
      const summary = evaluateSessionInol(id, data.name, data.best1RM, recent.sets);
      const weeklySets = exerciseWeeklySets.get(id) ?? [];
      inolSummaries.push({
        ...summary,
        sessionDate: recent.date,
        weeklyInol: sumWeeklyInol(weeklySets, data.best1RM),
      });
    }
  }

  // If no standard compound lifts found, take top 2 by usage count
  if (inolSummaries.length === 0) {
    const sortedExercises = [...exercise1RMs.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [id, data] of sortedExercises.slice(0, 2)) {
      const recent = exerciseRecentSets.get(id);
      if (recent && recent.sets.length > 0 && data.best1RM > 0) {
        const weeklySets = exerciseWeeklySets.get(id) ?? [];
        inolSummaries.push({
          ...evaluateSessionInol(id, data.name, data.best1RM, recent.sets),
          sessionDate: recent.date,
          weeklyInol: sumWeeklyInol(weeklySets, data.best1RM),
        });
      }
    }
  }

  const { bench: bestBench, squat: bestSquat, deadlift: bestDeadlift, total } =
    classicStrength((id) => exercise1RMs.get(id)?.best1RM);

  const benchGl = bestBench > 0 && userGender != null && userWeightKg != null
    ? calculateIpfGlPoints(userGender, userWeightKg, bestBench, "classic_bench")
    : null;

  const total3Lift = total ?? 0;

  const totalGl = total3Lift > 0 && userGender != null && userWeightKg != null
    ? calculateIpfGlPoints(userGender, userWeightKg, total3Lift, "classic_3lift")
    : null;

  // Morton Nutrition & Full Energy Balance over the selected period
  const dietRecords = store.list(userId, "diet");
  const dailyProteinsMap = new Map<string, number>();
  const dailyMacrosMap = new Map<string, { calories: number; protein: number; carbs: number; fat: number }>();
  const dailyMeals = new Map<string, StoredRecord[]>();
  const periodDietDays = new Set<string>();
  const prevDietDays = new Set<string>();
  for (const record of dietRecords) {
    const diet = record.data as Diet;
    if (diet.date >= displayStart && diet.date <= through) {
      periodDietDays.add(diet.date);
      dailyProteinsMap.set(diet.date, (dailyProteinsMap.get(diet.date) ?? 0) + (diet.protein ?? 0));
      const curM = dailyMacrosMap.get(diet.date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
      curM.calories += diet.calories ?? 0;
      curM.protein += diet.protein ?? 0;
      curM.carbs += diet.carbs ?? 0;
      curM.fat += diet.fat ?? 0;
      dailyMacrosMap.set(diet.date, curM);
      const meals = dailyMeals.get(diet.date) ?? [];
      meals.push(record);
      dailyMeals.set(diet.date, meals);
    } else if (diet.date >= prevPeriodStart && diet.date <= prevPeriodEnd) {
      prevDietDays.add(diet.date);
    }
  }
  const dailyProteinsArray = Array.from(dailyProteinsMap.entries()).map(([date, proteinGrams]) => ({
    date,
    proteinGrams,
  }));
  const proteinReport = evaluateProteinAdequacy(dailyProteinsArray, userWeightKg, {
    leanBodyMassKg: appleDailySummary.bodyReport.leanBodyMassKg,
  });

  // Helms Weight Change Rate over at least 35 days (or full display period when > 35d)
  const weightLookbackDays = Math.max(displayPeriod, 35);
  const recentWeights = allWeights
    .filter((w) => w.date >= shiftDay(through, -weightLookbackDays) && w.date <= through)
    .map((w) => ({ date: w.date, weight: w.weight }));
  const weightRateReport = evaluateWeightChangeRate(recentWeights);

  // Unify training days across Ironlog completed workouts AND completed Apple Health activities
  const appleActivities = projectAppleTraining(store, userId, through, catalogue, workouts).entries;
  const unifiedTrainingDates = new Set<string>(allTrainingDates);
  for (const act of appleActivities) {
    if (act.date <= through) unifiedTrainingDates.add(act.date);
  }

  // #210: Match each diet day against the calorie goal snapshot active on that date
  const periodTargetCalories = goalsOn(profile, through)?.calories ?? profile.calories;
  const dailyMacrosArray = Array.from(dailyMacrosMap.entries()).map(([date, m]) => ({
    date,
    ...m,
    isTrainingDay: unifiedTrainingDates.has(date),
    targetCalories: goalsOn(profile, date)?.calories ?? periodTargetCalories,
  }));
  const tdeeStart = shiftDay(through, 1 - Math.min(displayPeriod, 28));
  const tdeeWeights = recentWeights.filter(({ date }) => date >= tdeeStart);
  const firstWeighIn = tdeeWeights[0]?.date;
  const lastWeighIn = tdeeWeights.at(-1)?.date;
  const markers = new Map(store.list(userId, "nutritionDay")
    .map(({ data }) => [(data as NutritionDay).date, data as NutritionDay]));
  const completeDays = dailyMacrosArray.filter(({ date, calories }) => calories > 0 &&
    nutritionDayComplete(markers.get(date), dailyMeals.get(date) ?? []));
  const tdeeDays = firstWeighIn && lastWeighIn
    ? completeDays.filter(({ date }) => date >= firstWeighIn && date <= lastWeighIn)
    : [];
  const tdeeTrend = evaluateWeightChangeRate(tdeeWeights);
  const energyNutrition = evaluateNutritionEnergyBalance({
    dailyMacros: dailyMacrosArray,
    targetCalories: periodTargetCalories,
    tdeeObservation: firstWeighIn && lastWeighIn ? {
      from: firstWeighIn,
      through: lastWeighIn,
      completeDays: tdeeDays.length,
      averageIntakeKcal: tdeeDays.length ? tdeeDays.reduce((sum, d) => sum + d.calories, 0) / tdeeDays.length : null,
      weightSlopeKgPerWeek: tdeeTrend?.weeklySlopeKg ?? null,
      weightSamples: tdeeWeights.length,
      weightRSquared: tdeeTrend?.rSquared ?? null,
    } : undefined,
  });

  const waterByDate = new Map<string, number | null>(
    healthSnapshots.map((snapshot) => [snapshot.date, snapshot.waterMl ?? null]),
  );
  const dailyNutritionSeries = Array.from({ length: displayPeriod }, (_, idx) => {
    const d = shiftDay(displayStart, idx);
    const m = dailyMacrosMap.get(d);
    return {
      date: d,
      calories: Math.round(m?.calories ?? 0),
      protein: round1(m?.protein ?? 0),
      carbs: round1(m?.carbs ?? 0),
      fat: round1(m?.fat ?? 0),
      mealsCount: dailyMeals.get(d)?.length ?? 0,
      isTrainingDay: unifiedTrainingDates.has(d),
      waterMl: waterByDate.get(d) ?? null,
    };
  });
  const hydrationLogged = dailyNutritionSeries.filter((d) => typeof d.waterMl === "number" && d.waterMl > 0);
  const targetWaterMl = profile.waterGoalMl ?? 2000;
  const hydrationMet = hydrationLogged.filter((d) => (d.waterMl ?? 0) >= targetWaterMl).length;
  const hydrationReport = {
    targetMl: targetWaterMl,
    loggedDays: hydrationLogged.length,
    averageMl: hydrationLogged.length
      ? Math.round(hydrationLogged.reduce((s, d) => s + (d.waterMl ?? 0), 0) / hydrationLogged.length)
      : 0,
    daysMeetingTarget: hydrationMet,
    complianceRatePct: hydrationLogged.length ? Math.round((hydrationMet / hydrationLogged.length) * 100) : 0,
    totalDays: displayPeriod,
  };

  const pctDelta = (curr: number, prev: number) =>
    prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;

  const periodComparison = {
    currentRange: { from: displayStart, through },
    previousRange: { from: prevPeriodStart, through: prevPeriodEnd },
    current: {
      sessions: periodSessions,
      activeDays: periodTrainingDays.size,
      workSets: periodWorkSets,
      tonnageKg: Math.round(periodTonnageKg),
      durationMinutes: Math.round(periodDurationSec / 60),
      dietDaysLogged: periodDietDays.size,
    },
    previous: {
      sessions: prevSessions,
      activeDays: prevTrainingDays.size,
      workSets: prevWorkSets,
      tonnageKg: Math.round(prevTonnageKg),
      durationMinutes: Math.round(prevDurationSec / 60),
      dietDaysLogged: prevDietDays.size,
    },
    deltas: {
      sessionsPct: pctDelta(periodSessions, prevSessions),
      workSetsPct: pctDelta(periodWorkSets, prevWorkSets),
      tonnagePct: pctDelta(Math.round(periodTonnageKg), Math.round(prevTonnageKg)),
    },
  };

  const weeklyBreakdown = [...weeklyBuckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([weekIdx, w]) => ({
      weekIndex: weekIdx + 1,
      from: w.from,
      through: w.through,
      sessions: w.sessions,
      activeDays: w.days.size,
      workSets: w.workSets,
      hardSets: w.hardSets,
      tonnageKg: Math.round(w.tonnageKg),
      durationMinutes: Math.round(w.durationSeconds / 60),
      load: Math.round(w.load),
    }));

  const exerciseProgress = [...exercisePeriodProgress.values()]
    .sort((a, b) => (b.sessions.size * 10 + b.workSets) - (a.sessions.size * 10 + a.workSets))
    .slice(0, 12)
    .map((e) => ({
      id: e.id,
      name: e.name,
      muscle: e.muscle,
      mode: e.mode,
      sessions: e.sessions.size,
      workSets: e.workSets,
      tonnageKg: Math.round(e.tonnageKg),
      first1RM: e.first1RM,
      last1RM: e.last1RM,
      best1RM: e.best1RM,
      delta1RM: e.first1RM > 0 && e.last1RM > 0 ? Math.round((e.last1RM - e.first1RM) * 10) / 10 : 0,
    }));

  // 1. Plateau & Regression Alerts (last 3 sessions)
  const plateaus: Array<{
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
  }> = [];
  for (const [exId, sess] of exerciseSessions) {
    if (sess.length < 3) continue;
    const latest = sess.at(-1)!;
    if (latest.date < displayStart) continue;
    const [s0, s1, s2] = sess.slice(-3);
    if (!s0 || !s1 || !s2) continue;
    if (s2.best1RM <= s0.best1RM && s1.best1RM <= s0.best1RM * 1.005) {
      const deltaPct = Math.round(((s2.best1RM - s0.best1RM) / Math.max(1, s0.best1RM)) * 1000) / 10;
      const status: "plateau" | "regression" = deltaPct <= -2.5 ? "regression" : "plateau";
      plateaus.push({
        id: exId,
        name: s2.name,
        muscle: s2.muscle,
        sessionsCount: sess.length,
        baseline1RM: s0.best1RM,
        latest1RM: s2.best1RM,
        deltaPct,
        lastDate: s2.date,
        status,
        advice:
          status === "regression"
            ? "近 3 次推算力量小幅回落，建议留意睡眠恢复，必要时开启减载或减掉 1 组力竭组。"
            : "近 3 次刺激趋于停滞，可尝试微调小重量、切换次数区间（如 5–8 次→8–12 次）或换同肌群变式。",
      });
    }
  }
  plateaus.sort((a, b) => a.deltaPct - b.deltaPct || b.sessionsCount - a.sessionsCount);
  const topPlateaus = plateaus.slice(0, 6);

  // 2. Rep-Max Matrix (1RM / 3RM / 5RM / 8RM / 10RM)
  const isPrimaryLift = (id: string, name: string) =>
    /bench|squat|deadlift|press|row|pull-up|chin-up|dip|卧推|深蹲|硬拉|推举|划船|引体|双杠/i.test(`${id} ${name}`);
  const repMaxBoard = [...repMaxByEx.values()]
    .filter((r) => r.rm1 || r.rm3 || r.rm5 || r.rm8 || r.rm10)
    .sort((a, b) => {
      const ap = isPrimaryLift(a.id, a.name) ? 1 : 0;
      const bp = isPrimaryLift(b.id, b.name) ? 1 : 0;
      return bp - ap || b.count - a.count;
    })
    .slice(0, 8)
    .map(({ count: _count, ...rest }) => rest);

  const scheduledDays = new Map(store.list(userId, "scheduledDay")
    .map(({ data }) => [(data as ScheduledDay).date, data as ScheduledDay]));
  const planAdherence = summarizePlanAdherence(
    store.planSchedule(userId), scheduledDays, workouts, appleActivities, profile, displayStart, through, today,
  );

  // 4. Self-tracked Body Measurements & Recomp / Muscle-Preservation Signal
  const measurementsAsc = listMeasurements(store.db, userId)
    .filter((m) => m.date <= through)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latestNonNull = (key: "waistCm" | "chestCm" | "armCm" | "thighCm" | "hipCm") => {
    for (let i = measurementsAsc.length - 1; i >= 0; i--) {
      const val = measurementsAsc[i]?.[key];
      if (typeof val === "number") return { value: val, date: measurementsAsc[i]!.date };
    }
    return null;
  };
  const periodMeasurements = measurementsAsc.filter((m) => m.date >= displayStart);
  // #195: Filter per field strictly within the selected display period so adding an unrelated field never alters deltas
  const fieldPeriodDelta = (key: "waistCm" | "chestCm" | "armCm" | "thighCm" | "hipCm") => {
    const pts = periodMeasurements
      .filter((m) => typeof m[key] === "number")
      .map((m) => ({ date: m.date, value: m[key] as number }));
    if (pts.length < 2) return { delta: null as number | null, from: null as string | null, to: null as string | null };
    return {
      delta: round1(pts.at(-1)!.value - pts[0]!.value),
      from: pts[0]!.date,
      to: pts.at(-1)!.date,
    };
  };
  const waistLatest = latestNonNull("waistCm") ?? (appleDailySummary.bodyReport.waistCm != null ? { value: appleDailySummary.bodyReport.waistCm, date: through } : null);
  const hipLatest = latestNonNull("hipCm");
  const chestLatest = latestNonNull("chestCm");
  const armLatest = latestNonNull("armCm");
  const thighLatest = latestNonNull("thighCm");
  const heightCm = profile.energyProfile?.heightCm ?? appleDailySummary.bodyReport.heightCm ?? null;
  const waistDeltaInfo = fieldPeriodDelta("waistCm");
  const chestDeltaInfo = fieldPeriodDelta("chestCm");
  const armDeltaInfo = fieldPeriodDelta("armCm");
  const thighDeltaInfo = fieldPeriodDelta("thighCm");
  const hipDeltaInfo = fieldPeriodDelta("hipCm");
  const waistDeltaCm = waistDeltaInfo.delta;
  const armDeltaCm = armDeltaInfo.delta;

  // #193: WHR requires same-day paired waist + hip measurement to avoid combining months-apart readings
  let sameDayWhrRow: { date: string; waistCm: number; hipCm: number } | null = null;
  for (let i = measurementsAsc.length - 1; i >= 0; i--) {
    const m = measurementsAsc[i]!;
    if (typeof m.waistCm === "number" && m.waistCm > 0 && typeof m.hipCm === "number" && m.hipCm > 0) {
      sameDayWhrRow = { date: m.date, waistCm: m.waistCm, hipCm: m.hipCm };
      break;
    }
  }
  const whr = sameDayWhrRow ? round2(sameDayWhrRow.waistCm / sameDayWhrRow.hipCm) : null;
  const whrDate = sameDayWhrRow?.date ?? null;
  const whrUnpairedDates =
    !sameDayWhrRow && waistLatest && hipLatest
      ? { waistDate: waistLatest.date, hipDate: hipLatest.date }
      : null;

  // #194: Evaluate WHtR threshold strictly on the unrounded ratio and keep 3-decimal precision near 0.50
  const rawWhtr = waistLatest && heightCm && heightCm > 0 ? waistLatest.value / heightCm : null;
  const whtr = rawWhtr != null ? Math.round(rawWhtr * 1000) / 1000 : null;
  const whtrStatus: "healthy" | "elevated" | null = rawWhtr != null ? (rawWhtr < 0.5 ? "healthy" : "elevated") : null;

  const trackedLifts = exerciseProgress.filter((e) => e.sessions >= 2 && e.first1RM > 0);
  const avgE1rmPct = trackedLifts.length
    ? round1((trackedLifts.reduce((s, e) => s + ((e.last1RM - e.first1RM) / e.first1RM) * 100, 0)) / trackedLifts.length)
    : null;
  // #196: Do not assert "力量保持稳定" or "减脂保肌节奏稳健" when strength observations are absent
  let recompSignal: { status: "optimal" | "caution" | "neutral"; label: string; detail: string } | null = null;
  if (weightRateReport || waistDeltaCm != null || trackedLifts.length > 0) {
    const slope = weightRateReport?.weeklySlopeKg ?? 0;
    if (slope < -0.1 && avgE1rmPct != null && avgE1rmPct >= -2 && (waistDeltaCm == null || waistDeltaCm <= 0)) {
      recompSignal = {
        status: "optimal",
        label: "减脂保肌节奏稳健",
        detail: `体重每周 ${fmtSign(slope)} kg，${waistDeltaCm != null ? `周期内腰围变化 ${fmtSign(waistDeltaCm)} cm，` : "周期内暂无可对比腰围，"}核心动作推算 1RM 变化 ${fmtSign(avgE1rmPct)}%。`,
      };
    } else if (slope < -0.1 && avgE1rmPct == null) {
      recompSignal = {
        status: "neutral",
        label: "体重下降（待补充力量对比）",
        detail: `体重每周 ${fmtSign(slope)} kg${waistDeltaCm != null ? `，周期内腰围变化 ${fmtSign(waistDeltaCm)} cm` : "，周期内暂无可对比腰围"}；当前周期缺少同动作多次力量记录，暂无法判断力量与肌肉保留情况。`,
      };
    } else if (slope < -0.15 && avgE1rmPct != null && avgE1rmPct <= -4) {
      recompSignal = {
        status: "caution",
        label: "注意减脂期力量下滑",
        detail: `近期减重同时推算力量平均下滑 ${Math.abs(avgE1rmPct)}%，建议确认蛋白质是否吃足或适当收窄热量缺口。`,
      };
    } else if (slope > 0.1 && (armDeltaCm ?? 0) > 0 && (waistDeltaCm == null || waistDeltaCm <= 1)) {
      recompSignal = {
        status: "optimal",
        label: "干净增肌中",
        detail: `体重稳步上行，周期内臂围增加 +${armDeltaCm} cm 且腰围受控，围度分配健康。`,
      };
    } else if (measurementsAsc.length > 0 || weightRateReport) {
      recompSignal = {
        status: "neutral",
        label: trackedLifts.length > 0 ? "体态与力量平稳过渡" : "体态趋势观察中（待补充力量记录）",
        detail:
          trackedLifts.length > 0
            ? `继续保持规律称重、围度与力量记录，系统会持续对照肌肉与脂肪走向。`
            : `已记录体重/围度趋势，补充同动作 2 次以上抗阻训练记录后即可联动评估力量与肌肉保留。`,
      };
    }
  }
  const bodyMeasurementsSummary = {
    count: measurementsAsc.length,
    latestDate: measurementsAsc.at(-1)?.date ?? null,
    latest: {
      waistCm: waistLatest?.value ?? null,
      chestCm: chestLatest?.value ?? null,
      armCm: armLatest?.value ?? null,
      thighCm: thighLatest?.value ?? null,
      hipCm: hipLatest?.value ?? null,
    },
    latestDates: {
      waistCm: waistLatest?.date ?? null,
      chestCm: chestLatest?.date ?? null,
      armCm: armLatest?.date ?? null,
      thighCm: thighLatest?.date ?? null,
      hipCm: hipLatest?.date ?? null,
    },
    deltas: {
      waistCm: waistDeltaCm,
      chestCm: chestDeltaInfo.delta,
      armCm: armDeltaCm,
      thighCm: thighDeltaInfo.delta,
      hipCm: hipDeltaInfo.delta,
    },
    deltaRanges: {
      waistCm: waistDeltaInfo.from && waistDeltaInfo.to ? { from: waistDeltaInfo.from, to: waistDeltaInfo.to } : null,
      chestCm: chestDeltaInfo.from && chestDeltaInfo.to ? { from: chestDeltaInfo.from, to: chestDeltaInfo.to } : null,
      armCm: armDeltaInfo.from && armDeltaInfo.to ? { from: armDeltaInfo.from, to: armDeltaInfo.to } : null,
      thighCm: thighDeltaInfo.from && thighDeltaInfo.to ? { from: thighDeltaInfo.from, to: thighDeltaInfo.to } : null,
      hipCm: hipDeltaInfo.from && hipDeltaInfo.to ? { from: hipDeltaInfo.from, to: hipDeltaInfo.to } : null,
    },
    whr,
    whrDate,
    whrUnpairedDates,
    whtr,
    whtrStatus,
    avgE1rmPct,
    recompSignal,
  };

  // 5. Sleep × Same-Day Training Performance
  const summarizeSleepBucket = (rows: Array<{ workSets: number; tonnageKg: number; fatigued: boolean }>) => ({
    days: rows.length,
    avgWorkSets: rows.length ? round1(rows.reduce((s, r) => s + r.workSets, 0) / rows.length) : null,
    avgTonnageKg: rows.length ? Math.round(rows.reduce((s, r) => s + r.tonnageKg, 0) / rows.length) : null,
    fatiguedPct: rows.length ? Math.round((rows.filter((r) => r.fatigued).length / rows.length) * 100) : null,
  });
  const goodRows: Array<{ workSets: number; tonnageKg: number; fatigued: boolean }> = [];
  const midRows: Array<{ workSets: number; tonnageKg: number; fatigued: boolean }> = [];
  const shortRows: Array<{ workSets: number; tonnageKg: number; fatigued: boolean }> = [];
  for (const sDay of sleepReport.series) {
    if (sDay.minutes == null) continue;
    const wStats = workoutStatsByDate.get(sDay.date);
    if (!wStats || wStats.sessions === 0) continue;
    const row = {
      workSets: wStats.workSets,
      tonnageKg: wStats.tonnageKg,
      fatigued: wStats.fatiguedCount > 0,
    };
    if (sDay.minutes >= 420) goodRows.push(row);
    else if (sDay.minutes >= 360) midRows.push(row);
    else shortRows.push(row);
  }
  const goodSleepBucket = summarizeSleepBucket(goodRows);
  const midSleepBucket = summarizeSleepBucket(midRows);
  const shortSleepBucket = summarizeSleepBucket(shortRows);
  const pairedSleepDays = goodRows.length + midRows.length + shortRows.length;
  let sleepTrainingInsight: string | null = null;
  if (goodSleepBucket.days >= 3 && shortSleepBucket.days >= 3 &&
      goodSleepBucket.avgTonnageKg != null && shortSleepBucket.avgTonnageKg != null) {
    sleepTrainingInsight = `≥7 小时组（${goodSleepBucket.days} 天）平均容量 ${goodSleepBucket.avgTonnageKg} kg，<6 小时组（${shortSleepBucket.days} 天）平均容量 ${shortSleepBucket.avgTonnageKg} kg。动作和训练安排也会影响容量。`;
  } else if (pairedSleepDays > 0) {
    sleepTrainingInsight = `已配对 ${pairedSleepDays} 个睡眠和训练日。每组至少记录 3 天后可对照平均容量。`;
  }
  const sleepTrainingImpact = {
    pairedDays: pairedSleepDays,
    goodSleep: goodSleepBucket,
    midSleep: midSleepBucket,
    shortSleep: shortSleepBucket,
    insight: sleepTrainingInsight,
  };

  const appleWorkoutsSummary = summarizeAppleWorkouts(
    appleActivities.filter(
      (entry) => entry.date >= displayStart && entry.date <= through,
    ),
    profile.energyProfile?.birthDate ?? null,
    through,
    workouts.filter((w) => w.workout.date >= displayStart && w.workout.date <= through),
  );

  const best1RMMap = new Map<string, number>();
  for (const [exId, entry] of exercise1RMs) {
    best1RMMap.set(exId, entry.best1RM);
  }
  // #183: Do not fabricate male-specific strength standards when user sex is unset.
  const strengthStandards = userGender ? evaluateStrengthStandards(best1RMMap, userWeightKg, userGender) : [];
  const structuralBalance = evaluateStructuralBalance(best1RMMap);

  const reviewYear = through.slice(0, 4);
  const yearStart = `${reviewYear}-01-01`;
  const yearEnd = `${reviewYear}-12-31`;
  const yearCutoff = yearEnd < through ? yearEnd : through;
  const yearActiveDays = new Set<string>();
  const yearExCounts = new Map<string, { name: string; sets: number }>();
  let yearManualSessions = 0;
  let yearAppleOnlySessions = 0;
  let yearLinkedAppleSessions = 0;
  let yearDurationSeconds = 0;
  let yearTonnageKg = 0;
  let yearWorkSets = 0;
  let yearBestPr: { name: string; oneRepMaxKg: number; date: string } | null = null;
  for (const { workout } of workouts) {
    if (workout.date < yearStart || workout.date > yearCutoff) continue;
    yearManualSessions++;
    yearActiveDays.add(workout.date);
    const durSec = workoutDurationSeconds(workout);
    // #213: Accumulate exact seconds across sessions and round once at output
    if (durSec != null && durSec > 0) yearDurationSeconds += durSec;
    for (const row of workout.exercises) {
      const ex = row.snapshot ?? catalogue.get(row.exerciseId);
      const exName = ex?.name ?? row.exerciseId;
      for (const s of row.sets) {
        if (!isValidWorkSet(s, ex?.mode)) continue;
        yearWorkSets++;
        const prevCnt = yearExCounts.get(row.exerciseId) ?? { name: exName, sets: 0 };
        prevCnt.sets += 1;
        yearExCounts.set(row.exerciseId, prevCnt);
        if (ex?.mode === "reps" && s.weight > 0 && s.reps > 0) {
          const wKg = weightToKg(s.weight, row.weightUnit);
          yearTonnageKg += wKg * s.reps * (ex.volumeMultiplier ?? 1);
          const e1rm = round1(estimatedOneRepMax(wKg, Math.min(s.reps, 12)));
          if (!yearBestPr || e1rm > yearBestPr.oneRepMaxKg) {
            yearBestPr = { name: exName, oneRepMaxKg: e1rm, date: workout.date };
          }
        }
      }
    }
  }
  // #212: Merge standalone Apple Watch / Health sessions into Year in Review (linked ones count once)
  for (const entry of appleActivities) {
    if (entry.date < yearStart || entry.date > yearCutoff) continue;
    if (entry.manualWorkoutId) {
      yearLinkedAppleSessions++;
      continue;
    }
    yearAppleOnlySessions++;
    yearActiveDays.add(entry.date);
    if (entry.durationSeconds != null && entry.durationSeconds > 0) {
      yearDurationSeconds += entry.durationSeconds;
    }
  }
  const yearSessions = yearManualSessions + yearAppleOnlySessions;
  const yearDietDays = new Set(
    store.list(userId, "diet").map((r) => (r.data as Diet).date).filter((d) => d >= yearStart && d <= yearCutoff),
  ).size;
  const yearInReview = {
    year: Number(reviewYear),
    from: yearStart,
    through: yearCutoff,
    sessions: yearSessions,
    manualSessions: yearManualSessions,
    appleOnlySessions: yearAppleOnlySessions,
    linkedAppleSessions: yearLinkedAppleSessions,
    activeDays: yearActiveDays.size,
    totalMinutes: Math.round(yearDurationSeconds / 60),
    totalTonnageKg: Math.round(yearTonnageKg),
    totalWorkSets: yearWorkSets,
    dietDays: yearDietDays,
    topExercises: [...yearExCounts.values()].sort((a, b) => b.sets - a.sets).slice(0, 3),
    bestPr: yearBestPr,
  };

  return {
    today,
    through,
    period: displayPeriod,
    strengthStandards,
    structuralBalance,
    yearInReview,
    userProfile: {
      weightKg: userWeightKg != null ? Math.round(userWeightKg * 10) / 10 : null,
      appleWeightKg: appleDailySummary.bodyReport.weightKg,
      gender: userGender,
    },
    trainingSummary: {
      sessions: periodSessions,
      activeDays: periodTrainingDays.size,
      workSets: periodWorkSets,
      tonnageKg: Math.round(periodTonnageKg),
      dietDaysLogged: periodDietDays.size,
    },
    appleDaily: appleDailySummary,
    sleepReport,
    sleepTrainingImpact,
    appleWorkouts: appleWorkoutsSummary,
    planAdherence,
    plateaus: topPlateaus,
    repMaxBoard,
    bodyMeasurements: bodyMeasurementsSummary,
    acwr: {
      current: currentAcwr,
      series: displayAcwrSeries,
      referenceWeightKg: loadUsesReferenceWeight ? loadWeightKg : null,
      citations: SCIENCE_CITATIONS.gabbett2016,
    },
    monotony: {
      current: currentMonotony,
      previous: prevMonotony,
      deltaStrain: currentMonotony.trainingStrain - prevMonotony.trainingStrain,
      citations: SCIENCE_CITATIONS.foster1998,
    },
    muscles: {
      audits: muscleAudits,
      symmetry,
      retention: computeMuscleRetention(
        workouts.map((r) => r.workout),
        catalogue,
        through,
      ),
      citations: SCIENCE_CITATIONS.schoenfeld2017,
    },
    effortSpectrum,
    periodComparison,
    weeklyBreakdown,
    exerciseProgress,
    inol: {
      lifts: inolSummaries,
      citations: SCIENCE_CITATIONS.hristovInol,
    },
    ipfGl: {
      bench: benchGl,
      total: totalGl,
      components: {
        bench1RM: Math.round(bestBench * 10) / 10,
        squat1RM: Math.round(bestSquat * 10) / 10,
        deadlift1RM: Math.round(bestDeadlift * 10) / 10,
        total3Lift: Math.round(total3Lift * 10) / 10,
      },
      citations: SCIENCE_CITATIONS.ipfGl2020,
    },
    nutrition: {
      protein: proteinReport,
      energy: energyNutrition,
      dailySeries: dailyNutritionSeries,
      hydration: hydrationReport,
      citations: SCIENCE_CITATIONS.morton2018,
    },
    bodyweight: {
      report: weightRateReport,
      citations: SCIENCE_CITATIONS.helms2014,
    },
    citations: SCIENCE_CITATIONS,
  };
}

function fmtSign(val: number) {
  return val > 0 ? `+${val}` : String(val);
}

function resolveHrMax(birthDate: string | null, asOfDate: string) {
  const age = birthDate ? ageOnDate(birthDate, asOfDate) : null;
  return age != null && age >= 18 && age <= 81 ? Math.round(208 - 0.7 * age) : null;
}

function computeAppleWorkoutBucket(
  entries: ReturnType<typeof projectAppleTraining>["entries"],
  hrMax: number | null,
  asOfDate: string,
  recentLimit = 60,
) {
  let totalDurationSeconds = 0;
  let totalCaloriesKcal = 0;
  let totalDistanceMeters = 0;
  let linkedManualCount = 0;
  let hrWeightedSum = 0;
  let hrWeightedDuration = 0;
  let maxBpm: number | null = null;
  const zones = [
    { key: "z1", label: "Z1 <60%", minPct: 0, maxPct: 0.6, count: 0, durationSeconds: 0 },
    { key: "z2", label: "Z2 60–69%", minPct: 0.6, maxPct: 0.7, count: 0, durationSeconds: 0 },
    { key: "z3", label: "Z3 70–79%", minPct: 0.7, maxPct: 0.8, count: 0, durationSeconds: 0 },
    { key: "z4", label: "Z4 80–89%", minPct: 0.8, maxPct: 0.9, count: 0, durationSeconds: 0 },
    { key: "z5", label: "Z5 ≥90%", minPct: 0.9, maxPct: Infinity, count: 0, durationSeconds: 0 },
  ];

  const grouped = new Map<string, {
    activityType: string;
    title: string;
    count: number;
    durationSeconds: number;
    caloriesKcal: number;
    distanceMeters: number;
    hrSum: number;
    hrCount: number;
  }>();

  for (const item of entries) {
    const dur = item.durationSeconds ?? 0;
    const kcal = item.activeEnergyKcal ?? 0;
    const dist = item.distanceMeters ?? 0;
    const avgHr = item.heartRate?.avgBpm ?? null;
    const peakHr = item.heartRate?.maxBpm ?? null;

    totalDurationSeconds += dur;
    totalCaloriesKcal += kcal;
    totalDistanceMeters += dist;
    if (item.manualWorkoutId) linkedManualCount++;
    if (avgHr != null) {
      const weight = dur > 0 ? dur : 60;
      hrWeightedSum += avgHr * weight;
      hrWeightedDuration += weight;
      if (hrMax != null) {
        const pct = avgHr / hrMax;
        const zone = zones.find((z) => pct >= z.minPct && pct < z.maxPct);
        if (zone) {
          zone.count++;
          zone.durationSeconds += dur;
        }
      }
    }
    if (peakHr != null && (maxBpm == null || peakHr > maxBpm)) maxBpm = peakHr;

    const bucket = grouped.get(item.activity.title) ?? {
      activityType: item.activityType,
      title: item.activity.title,
      count: 0,
      durationSeconds: 0,
      caloriesKcal: 0,
      distanceMeters: 0,
      hrSum: 0,
      hrCount: 0,
    };
    bucket.count++;
    bucket.durationSeconds += dur;
    bucket.caloriesKcal += kcal;
    bucket.distanceMeters += dist;
    if (avgHr != null) {
      bucket.hrSum += avgHr;
      bucket.hrCount++;
    }
    grouped.set(item.activity.title, bucket);
  }

  const byActivity = [...grouped.values()]
    .map((g) => ({
      activityType: g.activityType,
      title: g.title,
      count: g.count,
      durationSeconds: g.durationSeconds,
      caloriesKcal: Math.round(g.caloriesKcal),
      distanceKm: Math.round((g.distanceMeters / 1000) * 100) / 100,
      avgBpm: g.hrCount > 0 ? Math.round(g.hrSum / g.hrCount) : null,
    }))
    .sort((a, b) => b.count - a.count || b.durationSeconds - a.durationSeconds);

  const recent = [...entries]
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
    .slice(0, recentLimit)
    .map((item) => ({
      id: item.id,
      date: item.date,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      title: item.activity.title,
      activityType: item.activityType,
      captureMethod: item.captureMethod,
      isDemo: item.id.startsWith("demo_"),
      durationSeconds: item.durationSeconds,
      durationKind: item.durationKind,
      activeEnergyKcal: item.activeEnergyKcal,
      distanceMeters: item.distanceMeters,
      heartRate: item.heartRate,
      annotation: item.annotation,
      manualWorkoutId: item.manualWorkoutId,
    }));

  const zoneTotalCount = zones.reduce((s, z) => s + z.count, 0);
  const zoneTotalSec = zones.reduce((s, z) => s + z.durationSeconds, 0);
  const hrZones = hrMax != null && zoneTotalCount > 0
    ? {
        hrMax,
        hrMaxSource: "tanaka_age" as const,
        basis: "session_avg_hr" as const,
        zones: zones.map((z) => ({
          key: z.key,
          label: z.label,
          count: z.count,
          durationSeconds: z.durationSeconds,
          pct: Math.round((z.count / zoneTotalCount) * 100),
          durationPct: zoneTotalSec > 0 ? Math.round((z.durationSeconds / zoneTotalSec) * 100) : 0,
        })),
      }
    : null;

  // WHO Weekly Aerobic Target (past 7 days) & Sport-Separated Pace / Speed Trends
  const isStrengthOrMindBody = (type: string, title: string) =>
    /traditionalstrength|functionalstrength|coretraining|strengthtraining|yoga|pilates|flexibility|cooldown|preparationandrecovery|力量|抗阻|瑜伽|普拉提|拉伸|恢复/i.test(
      `${type} ${title}`,
    );
  const isAerobicCardio = (type: string, title: string) => {
    if (isStrengthOrMindBody(type, title)) return false;
    return /run|cycl|swim|hik|row|elliptical|hiit|highintensityinterval|walk|stair|jumprope|mixedcardio|crosstraining|dance|basketball|soccer|tennis|badminton|cardio|跑步|骑行|游泳|徒步|划船|椭圆|踏步|爬楼|跳绳|有氧|间歇|步行/i.test(
      `${type} ${title}`,
    );
  };
  const classifySportCategory = (type: string, title: string): "run" | "cycle" | "walk" | "other" => {
    const joined = `${type} ${title}`;
    if (/run|跑步/i.test(joined)) return "run";
    if (/cycl|bike|骑行|單車/i.test(joined)) return "cycle";
    if (/walk|hik|步行|健走|徒步/i.test(joined)) return "walk";
    return "other";
  };

  const cardioWeekStart = shiftDay(asOfDate, -6);
  let moderateSec = 0;
  let vigorousSec = 0;
  let measuredSec = 0;
  let estimatedSec = 0;
  for (const item of entries) {
    if (item.date < cardioWeekStart || item.date > asOfDate) continue;
    const dur = item.durationSeconds ?? 0;
    if (dur <= 0) continue;
    if (!isAerobicCardio(item.activityType, item.activity.title)) continue;
    const avgHr = item.heartRate?.avgBpm ?? null;
    if (avgHr != null && hrMax != null) {
      const pct = avgHr / hrMax;
      if (pct >= 0.8) {
        vigorousSec += dur;
        measuredSec += dur;
      } else if (pct >= 0.6) {
        moderateSec += dur;
        measuredSec += dur;
      }
    } else {
      moderateSec += dur;
      estimatedSec += dur;
    }
  }
  const moderateMinutes = Math.round(moderateSec / 60);
  const vigorousMinutes = Math.round(vigorousSec / 60);
  const equivalentMinutes = moderateMinutes + vigorousMinutes * 2;
  const whoCardio = {
    targetMinutes: 150,
    moderateMinutes,
    vigorousMinutes,
    measuredMinutes: Math.round(measuredSec / 60),
    estimatedMinutes: Math.round(estimatedSec / 60),
    equivalentMinutes,
    completionPct: Math.min(100, Math.round((equivalentMinutes / 150) * 100)),
  };

  const paceEntries = [...entries]
    .filter((item) => (item.distanceMeters ?? 0) >= 500 && (item.durationSeconds ?? 0) >= 120)
    .sort((a, b) => a.date.localeCompare(b.date) || a.endedAt.localeCompare(b.endedAt))
    .map((item) => {
      const distanceKm = round2((item.distanceMeters ?? 0) / 1000);
      const durationMinutes = round1((item.durationSeconds ?? 0) / 60);
      const paceMinPerKm = round2(durationMinutes / Math.max(0.1, distanceKm));
      const speedKmh = round2(distanceKm / Math.max(1 / 60, durationMinutes / 60));
      const sportCategory = classifySportCategory(item.activityType, item.activity.title);
      return {
        date: item.date,
        title: item.activity.title,
        sportCategory,
        distanceKm,
        durationMinutes,
        paceMinPerKm,
        speedKmh,
      };
    });
  const paceTrend = paceEntries.slice(-20);
  const paceTrendsBySport = {
    run: paceEntries.filter((e) => e.sportCategory === "run").slice(-20),
    cycle: paceEntries.filter((e) => e.sportCategory === "cycle").slice(-20),
    walk: paceEntries.filter((e) => e.sportCategory === "walk").slice(-20),
  };

  return {
    totalCount: entries.length,
    linkedManualCount,
    standaloneCount: entries.length - linkedManualCount,
    totalDurationSeconds,
    totalCaloriesKcal: Math.round(totalCaloriesKcal),
    totalDistanceKm: Math.round((totalDistanceMeters / 1000) * 100) / 100,
    avgBpm: hrWeightedDuration > 0 ? Math.round(hrWeightedSum / hrWeightedDuration) : null,
    maxBpm,
    hrZones,
    whoCardio,
    paceTrend,
    paceTrendsBySport,
    byActivity,
    recent,
  };
}

function parseManualCardioDistanceMeters(workout: Workout): number | null {
  if (workout.cardioMeta?.distanceMeters != null && Number.isFinite(workout.cardioMeta.distanceMeters) && workout.cardioMeta.distanceMeters > 0) {
    return workout.cardioMeta.distanceMeters;
  }
  const m = (workout.notes ?? "").match(/距离[：:]\s*(\d+(?:[.,]\d+)?)\s*km/i);
  if (m) {
    const km = Number(m[1]!.replace(",", "."));
    if (Number.isFinite(km) && km > 0 && km <= 500) return Math.round(km * 1000);
  }
  return null;
}

function summarizeAppleWorkouts(
  entries: ReturnType<typeof projectAppleTraining>["entries"],
  birthDate: string | null = null,
  asOfDate = localDate(),
  manualWorkouts: readonly { id: string; workout: Workout }[] = [],
) {
  const hrMax = resolveHrMax(birthDate, asOfDate);
  // #77 & #180 (P1): Only deduplicate manual cardio against Apple CARDIO workouts (never let Apple Watch strength
  // workouts within +-15 min suppress a post-lift manual run/cycle), and require real time overlap or same activity.
  const linkedManualIds = new Set(entries.map((e) => e.manualWorkoutId).filter((id): id is string => Boolean(id)));
  const isStrengthLikeApple = (activityType: string) => {
    const key = activityType.toLowerCase();
    return key.includes("strength") || key.includes("weight") || key.includes("core") || key.includes("yoga") || key.includes("pilates") || key.includes("flexibility");
  };
  const appleCardioRanges = entries
    .filter((e) => !isStrengthLikeApple(e.activityType))
    .map((e) => ({
      activityType: e.activityType,
      startMs: Date.parse(e.startedAt),
      endMs: Date.parse(e.endedAt),
    }));
  const syntheticManualEntries: ReturnType<typeof projectAppleTraining>["entries"] = [];
  for (const { id, workout } of manualWorkouts) {
    if (linkedManualIds.has(id)) continue;
    const isManualCardio =
      Boolean(workout.cardioMeta) ||
      (workout.exercises.length > 0 && workout.exercises.every((row) => row.snapshot?.muscle === "cardio" || row.exerciseId.startsWith("cardio-")));
    if (!isManualCardio) continue;
    const durSec = workoutDurationSeconds(workout) ?? 0;
    if (durSec <= 0) continue;
    const wStartMs = Date.parse(workout.startedAt);
    const wEndMs = Date.parse(workout.endedAt ?? workout.startedAt);
    const activityType =
      workout.cardioMeta?.activityType ||
      workout.exercises[0]?.exerciseId.replace(/^cardio-/, "") ||
      "mixedCardio";
    const overlapsAppleCardio =
      Number.isFinite(wStartMs) &&
      Number.isFinite(wEndMs) &&
      appleCardioRanges.some((a) => {
        if (!Number.isFinite(a.startMs) || !Number.isFinite(a.endMs)) return false;
        const realOverlap = wStartMs < a.endMs && wEndMs > a.startMs;
        if (realOverlap) return true;
        return a.activityType === activityType && wStartMs <= a.endMs + 5 * 60_000 && wEndMs >= a.startMs - 5 * 60_000;
      });
    if (overlapsAppleCardio) continue;
    const distanceMeters = parseManualCardioDistanceMeters(workout) ?? undefined;
    syntheticManualEntries.push({
      schemaVersion: 1,
      id: `manual:${id}`,
      date: workout.date,
      startedAt: workout.startedAt,
      endedAt: workout.endedAt ?? workout.startedAt,
      receivedAt: workout.endedAt ?? workout.startedAt,
      activityType,
      environment: workout.cardioMeta?.environment ?? "unknown",
      captureMethod: "workout",
      durationSeconds: durSec,
      durationKind: "workout_active",
      activeEnergyKcal: workout.cardioMeta?.estimatedKcal ?? undefined,
      energyKind: workout.cardioMeta?.estimatedKcal != null ? "window_estimate" : undefined,
      distanceMeters,
      heartRate: undefined,
      activity: {
        family: "cardio",
        title: workout.title || "有氧训练",
      },
      manualWorkoutId: id,
      plan: null,
    } as unknown as ReturnType<typeof projectAppleTraining>["entries"][number]);
  }
  const mergedEntries = syntheticManualEntries.length ? [...entries, ...syntheticManualEntries] : entries;
  const allStats = computeAppleWorkoutBucket(mergedEntries, hrMax, asOfDate);
  const realDeviceEntries = mergedEntries.filter((item) => !item.id.startsWith("demo_"));
  const realDeviceStats = computeAppleWorkoutBucket(realDeviceEntries, hrMax, asOfDate);

  return {
    ...allStats,
    realDeviceCount: realDeviceEntries.length,
    demoCount: mergedEntries.length - realDeviceEntries.length,
    realDeviceStats,
  };
}
