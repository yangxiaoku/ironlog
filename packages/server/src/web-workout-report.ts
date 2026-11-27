import {
  estimatedOneRepMax, isValidWorkSet, weightToKg, workoutDurationSeconds,
  type Exercise, type Workout,
} from "@ironlog/shared";
import { DomainError, type Store } from "./store.js";
import { matchActivePlanRoutine } from "./web-training.js";

type Set = Workout["exercises"][number]["sets"][number];
type Metric = "weight" | "oneRepMax" | "hold" | "assistance";
type Scores = Partial<Record<Metric, number>>;

function round(value: number) { return Math.round(value * 100) / 100; }

const REPORT_MUSCLES = new Set(["chest", "back", "legs", "shoulders", "arms", "core", "cardio"]);

function trainingRows(workout: Workout, catalogue: ReadonlyMap<string, Exercise>) {
  return workout.exercises.map((row) => {
    const catalogueEx = catalogue.get(row.exerciseId);
    const exercise = row.snapshot ?? catalogueEx;
    const mode = exercise?.mode ?? (row.sets.some((set) => set.seconds > 0) && row.sets.every((set) => set.reps === 0) ? "timed" : "reps");
    const working = row.sets.filter((set) => isValidWorkSet(set, exercise?.mode));
    const unit = row.weightUnit;
    const volume = exercise?.mode === "reps" ? working.reduce((sum, set) =>
      sum + weightToKg(set.weight, unit) * set.reps * exercise.volumeMultiplier, 0) : 0;
    return {
      id: row.id, exerciseId: row.exerciseId, name: exercise?.name ?? row.exerciseId, mode, working,
      muscle: exercise?.muscle ?? catalogueEx?.muscle ?? null,
      secondaryMuscles: catalogueEx?.secondaryMuscles ?? [],
      supersetGroup: row.supersetGroup ?? null,
      weightUnit: unit ?? "kg",
      completed: row.sets.filter((set) => isValidWorkSet({ ...set, type: "normal" }, exercise?.mode)),
      volume,
    };
  });
}

function performances(mode: Exercise["mode"], sets: Array<Set & { _unit?: "kg" | "lb" }>): Scores {
  if (!sets.length) return {};
  if (mode === "timed") {
    let hold = -Infinity;
    for (const set of sets) if (set.seconds > hold) hold = set.seconds;
    return { hold };
  }
  if (mode === "assisted") {
    let assistance = Infinity;
    for (const set of sets) {
      const wKg = weightToKg(set.weight, set._unit);
      if (wKg < assistance) assistance = wKg;
    }
    return { assistance };
  }
  let maxWeight = 0;
  let max1rm = 0;
  let hasWeight = false;
  let has1rm = false;
  for (const set of sets) {
    if (set.weight <= 0 || set.reps <= 0) continue;
    const wKg = weightToKg(set.weight, set._unit);
    if (!hasWeight || wKg > maxWeight) { maxWeight = wKg; hasWeight = true; }
    if (set.reps <= 10) {
      const est = estimatedOneRepMax(wKg, set.reps);
      if (!has1rm || est > max1rm) { max1rm = est; has1rm = true; }
    }
  }
  return { ...(hasWeight && { weight: maxWeight }), ...(has1rm && { oneRepMax: round(max1rm) }) };
}

function improved(metric: Metric, value: number, baseline: number) {
  return metric === "assistance" ? value < baseline : value > baseline;
}

function key(row: { exerciseId: string; mode: Exercise["mode"] }) { return row.exerciseId + ":" + row.mode; }

export function getWebWorkoutReport(store: Store, userId: string, id: string) {
  const record = store.get(userId, "workout", id);
  if (!record || record.deleted) throw new DomainError("找不到这条训练记录", 404);
  const workout = record.data as Workout;
  if (workout.status !== "completed") throw new DomainError("完成训练后可查看复盘", 409);
  const catalogue = store.catalogueMap(userId, true);
  const rows = trainingRows(workout, catalogue);
  const relevant = new Set(rows.map(key));
  const searchIds = new Set(rows.map(({ exerciseId }) => exerciseId));
  const targetTimeMs = Date.parse(workout.endedAt ?? workout.startedAt);
  const baseline = new Map<string, Scores>();
  let prevEntry: { id: string; workout: Workout; timeMs: number } | null = null;
  for (const entry of store.list(userId, "workout")) {
    const session = entry.data as Workout;
    const sessionMs = Date.parse(session.endedAt ?? session.startedAt) || 0;
    if (entry.id === id || session.status !== "completed" || session.date > workout.date ||
      (session.date === workout.date && sessionMs >= targetTimeMs)) continue;
    const sameRoutine = workout.routineId
      ? session.routineId === workout.routineId
      : session.title.trim() === workout.title.trim();
    if (sameRoutine && (
      !prevEntry ||
      session.date > prevEntry.workout.date ||
      (session.date === prevEntry.workout.date && sessionMs > prevEntry.timeMs)
    )) {
      prevEntry = { id: entry.id, workout: session, timeMs: sessionMs };
    }
    for (const row of session.exercises) {
      if (!searchIds.has(row.exerciseId)) continue;
      const exercise = row.snapshot ?? catalogue.get(row.exerciseId);
      const mode = exercise?.mode ?? (row.sets.some((set) => set.seconds > 0) && row.sets.every((set) => set.reps === 0) ? "timed" : "reps");
      const exerciseKey = row.exerciseId + ":" + mode;
      if (!relevant.has(exerciseKey)) continue;
      const working = row.sets.filter((set) => isValidWorkSet(set, exercise?.mode));
      if (!working.length) continue;
      const scores = baseline.get(exerciseKey) ?? {};
      const today = performances(mode, working.map((s) => ({ ...s, _unit: row.weightUnit })));
      for (const metric of Object.keys(today) as Metric[]) {
        const value = today[metric]!;
        const previous = scores[metric];
        if (previous === undefined || improved(metric, value, previous)) scores[metric] = value;
      }
      baseline.set(exerciseKey, scores);
    }
  }
  const bestNow = new Map<string, { name: string; mode: Exercise["mode"]; sets: Array<Set & { _unit?: "kg" | "lb" }> }>();
  for (const row of rows) {
    const exerciseKey = key(row);
    const current = bestNow.get(exerciseKey) ?? { name: row.name, mode: row.mode, sets: [] };
    current.sets = current.sets.concat(row.working.map((s) => ({ ...s, _unit: row.weightUnit as "kg" | "lb" })));
    bestNow.set(exerciseKey, current);
  }
  const records = [...bestNow.entries()].flatMap(([exerciseKey, row]) => {
    const current = performances(row.mode, row.sets);
    const previous = baseline.get(exerciseKey);
    if (!previous) return [];
    const improvements = (Object.keys(current) as Metric[]).flatMap((metric) => {
      const value = current[metric]!;
      const before = previous[metric];
      return before === undefined || !improved(metric, value, before) ? [] : [{ metric, previous: before, current: value }];
    });
    return improvements.length ? [{ key: exerciseKey, name: row.name, improvements }] : [];
  });
  const totalSets = rows.reduce((sum, row) => sum + row.working.length, 0);
  const totalVolume = round(rows.reduce((sum, row) => sum + row.volume, 0));

  const muscleMap = new Map<string, number>();
  for (const row of rows) {
    const workCount = row.working.length;
    if (!workCount) continue;
    if (row.muscle && REPORT_MUSCLES.has(row.muscle)) {
      muscleMap.set(row.muscle, (muscleMap.get(row.muscle) ?? 0) + workCount);
    }
    for (const sec of row.secondaryMuscles) {
      if (sec === row.muscle || !REPORT_MUSCLES.has(sec)) continue;
      muscleMap.set(sec, (muscleMap.get(sec) ?? 0) + workCount * 0.5);
    }
  }
  const muscleSets = [...muscleMap.entries()]
    .map(([muscleKey, sets]) => ({ key: muscleKey, sets: Math.round(sets * 10) / 10 }))
    .sort((a, b) => b.sets - a.sets);

  let previousComparison: {
    workoutId: string;
    date: string;
    title: string;
    volumeDelta: number;
    volumePct: number | null;
    setsDelta: number;
  } | null = null;
  if (prevEntry) {
    const prevRows = trainingRows(prevEntry.workout, catalogue);
    const prevVolume = round(prevRows.reduce((sum, row) => sum + row.volume, 0));
    const prevSets = prevRows.reduce((sum, row) => sum + row.working.length, 0);
    previousComparison = {
      workoutId: prevEntry.id,
      date: prevEntry.workout.date,
      title: prevEntry.workout.title,
      volumeDelta: round(totalVolume - prevVolume),
      volumePct: prevVolume > 0 ? Math.round(((totalVolume - prevVolume) / prevVolume) * 1000) / 10 : null,
      setsDelta: totalSets - prevSets,
    };
  }

  const activePlan = store.activePlan(userId);
  const matchedRoutine = matchActivePlanRoutine(activePlan, workout);

  return {
    id, title: workout.title, date: workout.date, feeling: workout.feeling, notes: workout.notes,
    planId: workout.planId ?? null,
    routineId: workout.routineId ?? null,
    canSyncToActivePlan: Boolean(matchedRoutine),
    activePlanRevision: matchedRoutine ? activePlan!.revision : null,
    activeRoutineName: matchedRoutine?.name ?? null,
    duration: workoutDurationSeconds(workout),
    sets: totalSets,
    volume: totalVolume,
    muscleSets,
    previousComparison,
    exercises: rows.filter((row) => row.completed.length).map((row) => ({
      id: row.id, exerciseId: row.exerciseId, name: row.name, mode: row.mode,
      supersetGroup: row.supersetGroup,
      weightUnit: row.weightUnit,
      completed: row.completed.map(({ type, weight, reps, seconds, rir, note }) => ({
        type, weight, reps, seconds, rir, ...(note ? { note } : {}),
      })),
      volume: round(row.volume),
    })),
    records,
  };
}
