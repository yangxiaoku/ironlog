import {
  localDate,
  profileSchema,
  weightTrend,
  workoutMetrics,
  compareWorkouts,
  estimateEnergy,
  type Diet,
  type EnergyEstimate,
  type Weight,
  type Workout,
} from "@ironlog/shared";
import { listDailyHealth, summarizeDailyHealth } from "./apple-health-daily.js";
import { projectAppleTraining, publicAppleActivity } from "./apple-training-agenda.js";
import type { Store } from "./store.js";

function readProfile(store: Store, userId: string) {
  const record = store.get(userId, "profile", "settings");
  return profileSchema.parse(record?.deleted ? {} : record?.data ?? {});
}

export function getStats(store: Store, userId: string, date = localDate()) {
  const profile = readProfile(store, userId);
  const snapshot = profile.calorieEstimate;
  const today = localDate();
  let energy: EnergyEstimate = { status: "unavailable", reason: "所选日期缺少身体资料快照" };
  if (date === today) energy = estimateEnergy(profile.energyProfile, date);
  else if (snapshot?.asOf === date && date <= today) energy = estimateEnergy(snapshot.inputs, date);
  const diets = store
    .list(userId, "diet")
    .filter((record) => (record.data as Diet).date === date);
  const totals = diets.reduce(
    (sum, record) => {
      const food = record.data as Diet;
      return {
        calories: sum.calories + food.calories,
        protein: sum.protein + food.protein,
        carbs: sum.carbs + food.carbs,
        fat: sum.fat + food.fat,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const catalogue = store.catalogueMap(userId, true);
  const workouts = store
    .list(userId, "workout")
    .filter((record) => (record.data as Workout).status === "completed" && (record.data as Workout).date <= date)
    .sort((a, b) => compareWorkouts(a.data as Workout, b.data as Workout));
  const series: Record<
    string,
    { date: string; weight: number; estimated1rm: number }[]
  > = {};
  const todayWorkouts: (typeof workouts[number] & { metrics: ReturnType<typeof workoutMetrics> })[] = [];
  for (const record of workouts) {
    const workout = record.data as Workout;
    const metrics = workoutMetrics(workout, catalogue);
    for (const [exerciseId, best] of Object.entries(metrics.best)) {
      (series[exerciseId] ??= []).push({ date: workout.date, ...best });
    }
    if (workout.date === date) todayWorkouts.push({ ...record, metrics });
  }
  const completedEntries = workouts.map((record) => ({ id: record.id, workout: record.data as Workout }));
  const appleActivities = projectAppleTraining(store, userId, date, catalogue, completedEntries)
    .entries.filter((row) => row.date === date)
    .map(publicAppleActivity);
  const addedAppleActivities = appleActivities.filter((item) => !item.manualWorkoutId).length;
  return {
    date,
    profile,
    energy,
    totals,
    remaining: profile.calories - totals.calories,
    weights: weightTrend(
      store.list(userId, "weight").map((record) => record.data as Weight).filter((weight) => weight.date <= date),
    ),
    workouts: todayWorkouts,
    appleActivities,
    trainingSummary: {
      manualWorkouts: todayWorkouts.length,
      appleActivities: appleActivities.length,
      addedAppleActivities,
      totalActivities: todayWorkouts.length + addedAppleActivities,
    },
    series,
  };
}

export function getTrainingContext(store: Store, userId: string, days = 28) {
  const after = localDate(Date.now() - (days - 1) * 86400000);
  const through = localDate();
  const profile = readProfile(store, userId);
  const workouts = store.list(userId, "workout").filter((record) => {
    const workout = record.data as Workout;
    return (
      workout.date >= after &&
      workout.date <= through &&
      workout.status === "completed"
    );
  });
  const diets = store.list(userId, "diet").filter((record) => {
    const diet = record.data as Diet;
    return diet.date >= after && diet.date <= through;
  });
  const dailyNutrition: Record<
    string,
    { calories: number; protein: number; carbs: number; fat: number }
  > = {};
  for (const record of diets) {
    const diet = record.data as Diet;
    const sum = (dailyNutrition[diet.date] ??= {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    sum.calories += diet.calories;
    sum.protein += diet.protein;
    sum.carbs += diet.carbs;
    sum.fat += diet.fat;
  }
  const appleDailyDigest = summarizeDailyHealth(
    listDailyHealth(store.db, userId, after, through),
    { heightCm: profile.energyProfile?.heightCm ?? null, sex: profile.energyProfile?.sex === "female" ? "female" : "male" },
  );
  return {
    from: after,
    through,
    profile,
    energy: estimateEnergy(profile.energyProfile, through),
    activePlan: store.activePlan(userId),
    workouts: workouts.map((record) => record.data),
    dailyNutrition,
    weights: store
      .list(userId, "weight")
      .map((record) => record.data as Weight)
      .filter((log) => log.date >= after && log.date <= through),
    appleHealthDaily: appleDailyDigest.daysWithData > 0
      ? {
          daysSynced: appleDailyDigest.daysWithData,
          latestDate: appleDailyDigest.latest?.date ?? null,
          body: appleDailyDigest.bodyReport,
          recovery: appleDailyDigest.recoveryReport,
          averages: appleDailyDigest.averages,
        }
      : null,
    coverage: {
      workoutCount: workouts.length,
      dietDays: Object.keys(dailyNutrition).length,
      windowDays: days,
    },
  };
}
