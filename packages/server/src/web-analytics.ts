import { z } from "zod";
import {
  calculateAcwrSeries,
  calculateIpfGlPoints,
  calculateMonotonyAndStrain,
  calculateSetInol,
  evaluateEffortAndRepZones,
  evaluateNutritionEnergyBalance,
  evaluateProteinAdequacy,
  evaluateSessionInol,
  evaluateSymmetryAndFrequency,
  evaluateWeeklyMuscleDose,
  evaluateWeightChangeRate,
  estimatedOneRepMax,
  isValidWorkSet,
  localDate,
  muscleNames,
  profileSchema,
  SCIENCE_CITATIONS,
  workoutDurationSeconds,
  type Exercise,
  type Diet,
  type Weight,
  type Workout,
} from "@ironlog/shared";
import type { Store } from "./store.js";
import { DomainError } from "./store.js";
import { alignSleepSnapshots, listDailyHealthSnapshots, publicDailySnapshot, summarizeDailyHealth } from "./apple-health-daily.js";
import { projectAppleTraining } from "./apple-training-agenda.js";
import { buildSleepReport } from "./sleep-report.js";
import { shiftDay } from "./web-statistics.js";

export const webAnalyticsQuery = z.object({
  days: z.enum(["14", "30", "60", "90"]).transform(Number).optional(),
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
  const userGender: "male" | "female" = profile.energyProfile?.sex === "female" ? "female" : "male";
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
    sex: userGender,
    through,
  });

  // Retrieve user weights
  const allWeights = store
    .list(userId, "weight")
    .map((row) => row.data as Weight)
    .filter((w) => w.date <= through && w.weight > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const latestWeightRecord = allWeights.at(-1);
  const userWeightKg = latestWeightRecord?.weight ?? profile.energyProfile?.weightKg ?? appleDailySummary.bodyReport.weightKg ?? 75;

  // Build continuous daily loads map for ACWR & Monotony
  const dailyLoadsMap = new Map<string, number>();
  for (let i = 0; i < historyDays; i++) {
    dailyLoadsMap.set(shiftDay(historyStart, i), 0);
  }

  // Workouts
  const workouts = store
    .list(userId, "workout")
    .map((record) => ({ id: record.id, workout: record.data as Workout }))
    .filter(({ workout }) => workout.status === "completed" && workout.date <= through)
    .sort((a, b) => a.workout.date.localeCompare(b.workout.date));

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

  for (const { id: workoutId, workout } of workouts) {
    let workoutLoad = 0;
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
        if (inPeriod) {
          periodWorkSets++;
          periodExSets++;
          if (weekEntry) weekEntry.workSets++;
          const isHard =
            (set.rir != null && Number.isFinite(set.rir) && set.rir <= 2) ||
            set.type === "failure" ||
            set.type === "drop";
          if (isHard && weekEntry) weekEntry.hardSets++;
          periodEffortSets.push({
            reps: set.reps,
            rir: set.rir ?? null,
            mode: exercise?.mode ?? "reps",
            weight: set.weight,
            setType: set.type,
          });
        } else if (inPrevPeriod) {
          prevWorkSets++;
        }

        if (exercise?.muscle) {
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
          const setVolume = set.weight * set.reps * exercise.volumeMultiplier;
          const hasValidRir = set.rir != null && Number.isFinite(set.rir) && set.rir >= 0 && set.rir <= 4;
          const effortMult = set.rir != null && Number.isFinite(set.rir) && set.rir >= 0 && set.rir <= 5
            ? 1 + (5 - set.rir) * 0.05
            : 1;
          workoutLoad += setVolume * effortMult;
          if (inPeriod) {
            periodTonnageKg += setVolume;
            periodExTonnage += setVolume;
            if (weekEntry) weekEntry.tonnageKg += setVolume;
          } else if (inPrevPeriod) {
            prevTonnageKg += setVolume;
          }

          // Adjust effective reps by RIR (Helms / Zourdos RPE-1RM equivalence) when valid RIR (0–4) is logged
          const effectiveReps = hasValidRir ? set.reps + set.rir! : set.reps;
          const estimate = estimatedOneRepMax(set.weight, Math.min(effectiveReps, 12));
          if (inPeriod) periodExBest1RM = Math.max(periodExBest1RM, estimate);
          const currentBest = exercise1RMs.get(item.exerciseId);
          exercise1RMs.set(item.exerciseId, {
            name: exercise.name,
            best1RM: Math.max(currentBest?.best1RM ?? 0, estimate),
            count: (currentBest?.count ?? 0) + 1,
          });

          // Track for INOL
          if (isPast7) {
            const list = exerciseWeeklySets.get(item.exerciseId) ?? [];
            list.push({ reps: set.reps, weight: set.weight });
            exerciseWeeklySets.set(item.exerciseId, list);
          }
          // Track most recent session sets
          const recent = exerciseRecentSets.get(item.exerciseId);
          if (!recent || recent.date < workout.date) {
            exerciseRecentSets.set(item.exerciseId, {
              date: workout.date,
              sets: [{ reps: set.reps, weight: set.weight }],
            });
          } else if (recent.date === workout.date) {
            recent.sets.push({ reps: set.reps, weight: set.weight });
          }
        } else if (exercise?.mode === "assisted" && set.reps > 0) {
          const effectiveLoad = Math.max(15, userWeightKg - Math.min(userWeightKg - 15, set.weight));
          workoutLoad += Math.round(effectiveLoad * set.reps * exercise.volumeMultiplier);
        } else if (exercise?.mode === "timed") {
          workoutLoad += Math.max(30, Math.round((set.seconds || 30) * 1.8));
        } else if (set.reps > 0) {
          // Bodyweight reps scaled by user body mass
          const bwLoad = Math.round(userWeightKg * 0.6 * Math.min(set.reps, 40) * (exercise?.volumeMultiplier ?? 1));
          workoutLoad += Math.max(15, bwLoad);
        }
      }

      if (inPeriod && periodExSets > 0 && exercise) {
        const prev = exercisePeriodProgress.get(item.exerciseId);
        const rounded1RM = Math.round(periodExBest1RM * 10) / 10;
        if (!prev) {
          const sessions = new Set<string>([workoutId]);
          exercisePeriodProgress.set(item.exerciseId, {
            id: item.exerciseId,
            name: exercise.name,
            muscle: exercise.muscle ?? "other",
            mode: exercise.mode ?? "reps",
            sessions,
            workSets: periodExSets,
            tonnageKg: periodExTonnage,
            firstDate: workout.date,
            first1RM: rounded1RM,
            lastDate: workout.date,
            last1RM: rounded1RM,
            best1RM: rounded1RM,
          });
        } else {
          prev.sessions.add(workoutId);
          prev.workSets += periodExSets;
          prev.tonnageKg += periodExTonnage;
          if (rounded1RM > 0) {
            if (prev.first1RM === 0 || workout.date < prev.firstDate) {
              prev.firstDate = workout.date;
              prev.first1RM = rounded1RM;
            }
            if (workout.date >= prev.lastDate) {
              prev.lastDate = workout.date;
              prev.last1RM = rounded1RM;
            }
            prev.best1RM = Math.max(prev.best1RM, rounded1RM);
          }
        }
      }
    }

    if (weekEntry) weekEntry.load += Math.round(workoutLoad);
    if (dailyLoadsMap.has(workout.date)) {
      dailyLoadsMap.set(workout.date, (dailyLoadsMap.get(workout.date) ?? 0) + workoutLoad);
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

  // IPF GL Points relative strength
  // Look for best primary bench, squat, deadlift 1RMs (with biomechanical conversion from RDL/SLDL if needed)
  let primaryBench = 0;
  let fallbackBench = 0;
  let primarySquat = 0;
  let fallbackSquat = 0;
  let primaryDeadlift = 0;
  let accessoryDeadlift = 0;
  let accessoryDeadliftName = "";

  for (const [id, data] of exercise1RMs) {
    const tag = `${id} ${data.name}`;
    const isBarbell = catalogue.get(id)?.equipment === "barbell" || /barbell|杠铃/i.test(tag);

    if ((id.includes("bench") || data.name.includes("卧推")) && !/dip|row|curl|pullover|臂屈伸|划船|弯举/i.test(tag)) {
      if (isBarbell && !/incline|decline|dumbbell|上斜|下斜|哑铃/i.test(tag)) {
        primaryBench = Math.max(primaryBench, data.best1RM);
      } else {
        fallbackBench = Math.max(fallbackBench, data.best1RM);
      }
    }

    if (id.includes("squat") || data.name.includes("深蹲")) {
      if (isBarbell && !/hack|split|goblet|sissy|bulgarian|pistol|哈克|分腿|保加利亚|高脚杯|西斯/i.test(tag)) {
        primarySquat = Math.max(primarySquat, data.best1RM);
      } else {
        fallbackSquat = Math.max(fallbackSquat, data.best1RM);
      }
    }

    const isRdlVariant = /romanian|stiff|straight-leg|rdl|罗马尼亚|直腿/i.test(tag);
    if (isRdlVariant && (id.includes("deadlift") || data.name.includes("硬拉") || /\brdl\b/i.test(tag))) {
      if (data.best1RM > accessoryDeadlift) {
        accessoryDeadlift = data.best1RM;
        accessoryDeadliftName = data.name;
      }
    } else if (id.includes("deadlift") || data.name.includes("硬拉")) {
      primaryDeadlift = Math.max(primaryDeadlift, data.best1RM);
    }
  }

  const bestBench = primaryBench > 0 ? primaryBench : fallbackBench;
  const bestSquat = primarySquat > 0 ? primarySquat : fallbackSquat;
  const deadliftRaw1RM = primaryDeadlift === 0 && accessoryDeadlift > 0
    ? Math.round(accessoryDeadlift * 10) / 10
    : null;
  const deadliftSourceName = deadliftRaw1RM != null ? accessoryDeadliftName : null;
  const bestDeadlift = primaryDeadlift > 0 ? primaryDeadlift : accessoryDeadlift;

  const benchGl = bestBench > 0
    ? calculateIpfGlPoints(userGender, userWeightKg, bestBench, "classic_bench")
    : null;

  const total3Lift = bestBench > 0 && bestSquat > 0 && bestDeadlift > 0
    ? bestBench + bestSquat + bestDeadlift
    : 0;

  const totalGl = total3Lift > 0
    ? calculateIpfGlPoints(userGender, userWeightKg, total3Lift, "classic_3lift")
    : null;

  // Morton Nutrition & Full Energy Balance over the past 30 days
  const dietRecords = store.list(userId, "diet");
  const dailyProteinsMap = new Map<string, number>();
  const dailyMacrosMap = new Map<string, { calories: number; protein: number; carbs: number; fat: number }>();
  const periodDietDays = new Set<string>();
  const prevDietDays = new Set<string>();
  for (const record of dietRecords) {
    const diet = record.data as Diet;
    if (diet.date >= displayStart && diet.date <= through) {
      periodDietDays.add(diet.date);
    } else if (diet.date >= prevPeriodStart && diet.date <= prevPeriodEnd) {
      prevDietDays.add(diet.date);
    }
    if (diet.date >= shiftDay(through, -29) && diet.date <= through) {
      dailyProteinsMap.set(diet.date, (dailyProteinsMap.get(diet.date) ?? 0) + (diet.protein ?? 0));
      const curM = dailyMacrosMap.get(diet.date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
      curM.calories += diet.calories ?? 0;
      curM.protein += diet.protein ?? 0;
      curM.carbs += diet.carbs ?? 0;
      curM.fat += diet.fat ?? 0;
      dailyMacrosMap.set(diet.date, curM);
    }
  }
  const dailyProteinsArray = Array.from(dailyProteinsMap.entries()).map(([date, proteinGrams]) => ({
    date,
    proteinGrams,
  }));
  const proteinReport = evaluateProteinAdequacy(dailyProteinsArray, userWeightKg, {
    leanBodyMassKg: appleDailySummary.bodyReport.leanBodyMassKg,
  });

  // Helms Weight Change Rate over the past 30 days
  const recentWeights = allWeights
    .filter((w) => w.date >= shiftDay(through, -35) && w.date <= through)
    .map((w) => ({ date: w.date, weight: w.weight }));
  const weightRateReport = evaluateWeightChangeRate(recentWeights);

  const dailyMacrosArray = Array.from(dailyMacrosMap.entries()).map(([date, m]) => ({
    date,
    ...m,
    isTrainingDay: allTrainingDates.has(date),
  }));
  const energyNutrition = evaluateNutritionEnergyBalance({
    dailyMacros: dailyMacrosArray,
    targetCalories: profile.calories,
    weightSlopeKgPerWeek: weightRateReport?.weeklySlopeKg ?? null,
    weightSampleCount: recentWeights.length,
    weightRSquared: weightRateReport?.rSquared ?? null,
  });

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
  const appleWorkoutsSummary = summarizeAppleWorkouts(
    projectAppleTraining(store, userId, through, catalogue, workouts).entries.filter(
      (entry) => entry.date >= displayStart && entry.date <= through,
    ),
    profile.energyProfile?.birthDate ?? null,
    through,
  );

  return {
    today,
    through,
    period: displayPeriod,
    userProfile: {
      weightKg: Math.round(userWeightKg * 10) / 10,
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
    appleWorkouts: appleWorkoutsSummary,
    acwr: {
      current: currentAcwr,
      series: displayAcwrSeries,
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
        deadliftRaw1RM,
        deadliftSourceName,
        total3Lift: Math.round(total3Lift * 10) / 10,
      },
      citations: SCIENCE_CITATIONS.ipfGl2020,
    },
    nutrition: {
      protein: proteinReport,
      energy: energyNutrition,
      citations: SCIENCE_CITATIONS.morton2018,
    },
    bodyweight: {
      report: weightRateReport,
      citations: SCIENCE_CITATIONS.helms2014,
    },
    citations: SCIENCE_CITATIONS,
  };
}

function resolveHrMax(birthDate: string | null, asOfDate: string) {
  if (!birthDate) return { hrMax: 190, hrMaxSource: "default_190" as const };
  const ms = Date.parse(asOfDate + "T00:00:00Z") - Date.parse(birthDate + "T00:00:00Z");
  const age = ms / (365.25 * 86_400_000);
  if (!Number.isFinite(age) || age < 12 || age > 95) return { hrMax: 190, hrMaxSource: "default_190" as const };
  return { hrMax: Math.round(208 - 0.7 * age), hrMaxSource: "tanaka_age" as const };
}

function computeAppleWorkoutBucket(
  entries: ReturnType<typeof projectAppleTraining>["entries"],
  hrMax: number,
  hrMaxSource: "tanaka_age" | "default_190",
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
    { key: "z1", label: "Z1 恢复 (<60%)", minPct: 0, maxPct: 0.6, count: 0, durationSeconds: 0 },
    { key: "z2", label: "Z2 有氧燃脂 (60–69%)", minPct: 0.6, maxPct: 0.7, count: 0, durationSeconds: 0 },
    { key: "z3", label: "Z3 节奏耐力 (70–79%)", minPct: 0.7, maxPct: 0.8, count: 0, durationSeconds: 0 },
    { key: "z4", label: "Z4 乳酸阈值 (80–89%)", minPct: 0.8, maxPct: 0.9, count: 0, durationSeconds: 0 },
    { key: "z5", label: "Z5 峰值冲刺 (≥90%)", minPct: 0.9, maxPct: 2, count: 0, durationSeconds: 0 },
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
      const pct = avgHr / hrMax;
      const zone = zones.find((z) => pct >= z.minPct && pct < z.maxPct) ?? zones[zones.length - 1]!;
      zone.count++;
      zone.durationSeconds += dur;
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
      manualWorkoutId: item.manualWorkoutId,
    }));

  const zoneTotalCount = zones.reduce((s, z) => s + z.count, 0);
  const zoneTotalSec = zones.reduce((s, z) => s + z.durationSeconds, 0);
  const hrZones = zoneTotalCount > 0
    ? {
        hrMax,
        hrMaxSource,
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
    byActivity,
    recent,
  };
}

function summarizeAppleWorkouts(
  entries: ReturnType<typeof projectAppleTraining>["entries"],
  birthDate: string | null = null,
  asOfDate = localDate(),
) {
  const { hrMax, hrMaxSource } = resolveHrMax(birthDate, asOfDate);
  const allStats = computeAppleWorkoutBucket(entries, hrMax, hrMaxSource, 60);
  const realDeviceEntries = entries.filter((item) => !item.id.startsWith("demo_"));
  const realDeviceStats = computeAppleWorkoutBucket(realDeviceEntries, hrMax, hrMaxSource, 60);

  return {
    ...allStats,
    realDeviceCount: realDeviceEntries.length,
    demoCount: entries.length - realDeviceEntries.length,
    realDeviceStats,
  };
}
