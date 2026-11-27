import type { Exercise, Workout, Weight, Plan, Routine, StoredRecord } from "./index.js";

export function validateRecordIdentity(record: Pick<StoredRecord, "kind" | "id" | "data">) {
  const { kind, id, data } = record;
  if (kind === "profile" && id !== "settings") throw new Error("配置 ID 必须为 settings");
  if (kind === "weight" && id !== `weight_${(data as Weight).date}`) {
    throw new Error("体重记录 ID 必须与日期对应");
  }
  if (kind === "nutritionDay" && id !== `nutritionDay_${(data as { date: string }).date}`)
    throw new Error("饮食日标记 ID 必须与日期对应");
  if (kind === "exercise" && (data as Exercise).id !== id) throw new Error("动作 ID 不匹配");
  if (kind === "template" && (data as Routine).id !== id) throw new Error("模板 ID 不匹配");
  if (kind === "scheduledDay" && id !== `schedule_${(data as { date: string }).date}`) {
    throw new Error("日程记录 ID 必须与日期对应");
  }
}

export function localDate(timestamp = Date.now()): string {
  return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
}

type WorkoutOrder = Pick<Workout, "date" | "startedAt" | "endedAt">;
export type PlanCompletion = WorkoutOrder & Pick<Workout, "status" | "planId" | "routineId" | "title">;
function compareIsoDate(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function compareWorkouts(a: WorkoutOrder, b: WorkoutOrder) {
  return (
    compareIsoDate(a.date, b.date) ||
    Date.parse(a.endedAt ?? a.startedAt) - Date.parse(b.endedAt ?? b.startedAt)
  );
}

export const LB_TO_KG = 0.45359237;

export function weightToKg(weight: number, unit?: "kg" | "lb"): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return unit === "lb" ? Math.round(weight * LB_TO_KG * 100) / 100 : weight;
}

export function kgToUnit(kg: number, unit?: "kg" | "lb"): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return unit === "lb" ? Math.round((kg / LB_TO_KG) * 10) / 10 : Math.round(kg * 100) / 100;
}

export function estimatedOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

export function isValidWorkSet(set: Workout["exercises"][number]["sets"][number], mode?: Exercise["mode"]) {
  return set.completed && set.type !== "warmup" &&
    (mode === "timed" ? set.seconds > 0 : set.reps > 0 || (!mode && set.seconds > 0));
}

export function countValidWorkSets(sets: Workout["exercises"][number]["sets"], mode?: Exercise["mode"]) {
  return sets.filter((set) => isValidWorkSet(set, mode)).length;
}

export function previousExerciseRows(
  records: Pick<StoredRecord, "id" | "data" | "deleted">[],
  workoutId: string,
  current: Pick<Workout, "date" | "startedAt" | "exercises">,
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>,
  targetIds?: ReadonlySet<string>,
) {
  const byId = Array.isArray(catalogue)
    ? new Map((catalogue as readonly Exercise[]).map((exercise) => [exercise.id, exercise]))
    : (catalogue as ReadonlyMap<string, Exercise>);
  const modes = new Map<string, Exercise["mode"]>();
  if (targetIds) {
    for (const id of targetIds) {
      const exercise = byId.get(id);
      if (exercise) modes.set(id, exercise.mode);
    }
  } else {
    for (const [id, exercise] of byId) modes.set(id, exercise.mode);
  }
  for (const row of current.exercises) {
    if (row.snapshot) modes.set(row.exerciseId, row.snapshot.mode);
  }
  const startedAt = Date.parse(current.startedAt);
  const completed = records
    .filter((record) => !record.deleted && record.id !== workoutId)
    .map((record) => record.data as Workout)
    .filter((workout) => workout.status === "completed" && (
      workout.date < current.date ||
      (workout.date === current.date && Date.parse(workout.endedAt ?? workout.startedAt) < startedAt)
    ))
    .sort((a, b) => compareWorkouts(b, a));
  const previous = new Map<string, Workout["exercises"][number]>();
  for (const workout of completed) {
    for (const row of workout.exercises) {
      if (targetIds && !targetIds.has(row.exerciseId)) continue;
      if (previous.has(row.exerciseId)) continue;
      const mode = modes.get(row.exerciseId);
      if (mode && row.snapshot && row.snapshot.mode !== mode) continue;
      if (row.sets.some((set) => isValidWorkSet(set, mode ?? row.snapshot?.mode)))
        previous.set(row.exerciseId, row);
    }
    if (targetIds && previous.size >= targetIds.size) break;
  }
  return previous;
}

export function workoutMetrics(workout: Workout, catalogue: Exercise[] | ReadonlyMap<string, Exercise>, options: { roundVolume?: boolean } = {}) {
  const exercises = Array.isArray(catalogue)
    ? new Map(catalogue.map((exercise) => [exercise.id, exercise]))
    : catalogue;
  let volume = 0;
  let completedSets = 0;
  const best: Record<string, { weight: number; estimated1rm: number }> = {};
  for (const item of workout.exercises) {
    const exercise = item.snapshot ?? exercises.get(item.exerciseId);
    for (const set of item.sets) {
      if (!set.completed || set.type === "warmup") continue;
      completedSets++;
      if (!exercise || exercise.mode !== "reps" || set.reps <= 0) continue;
      const weightKg = weightToKg(set.weight, item.weightUnit);
      volume += weightKg * set.reps * exercise.volumeMultiplier;
      const prior = best[item.exerciseId] ?? { weight: 0, estimated1rm: 0 };
      best[item.exerciseId] = {
        weight: Math.max(prior.weight, weightKg),
        estimated1rm: Math.max(
          prior.estimated1rm,
          estimatedOneRepMax(weightKg, set.reps),
        ),
      };
    }
  }
  return { volume: options.roundVolume === false ? volume : Math.round(volume * 10) / 10, completedSets, best };
}

export function weightTrend(logs: Weight[], options: { roundAverage?: boolean } = {}) {
  const sorted = [...logs].sort((a, b) => compareIsoDate(a.date, b.date));
  const timestamps = sorted.map((log) => Date.parse(log.date + "T00:00:00Z"));
  const result: (Weight & { average: number; count: number })[] = [];
  let first = 0;
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end]!.date === sorted[index]!.date) end++;
    const earliest = timestamps[index]! - 6 * 86400000;
    while (first < end && timestamps[first]! < earliest) first++;
    // Same-date records share a window. Preserve summation order for decimal rounding.
    let sum = 0;
    for (let position = first; position < end; position++) sum += sorted[position]!.weight;
    const count = end - first;
    const average = options.roundAverage === false ? sum / count : Math.round(sum / count * 10) / 10;
    for (let position = index; position < end; position++) {
      result.push({ ...sorted[position]!, average, count });
    }
    index = end;
  }
  return result;
}

export function validatePlanExercises(
  plan: Plan | { exercises: Routine["exercises"] },
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>,
) {
  const exercises = Array.isArray(catalogue)
    ? new Map((catalogue as readonly Exercise[]).map((exercise) => [exercise.id, exercise]))
    : (catalogue as ReadonlyMap<string, Exercise>);
  const items =
    "routines" in plan
      ? plan.routines.flatMap((routine) => routine.exercises)
      : plan.exercises;
  for (const item of items) {
    const exercise = exercises.get(item.exerciseId);
    if (!exercise)
      throw new Error(`动作不存在 ${item.exerciseId}`);
    if (item.backupExerciseId && !exercises.has(item.backupExerciseId))
      throw new Error(`备用动作不存在 ${item.backupExerciseId}`);
    if (item.backupExerciseId === item.exerciseId)
      throw new Error("备用动作需要与原动作不同");
    if (exercise.mode === "timed" && item.seconds <= 0)
      throw new Error("计时动作需要设置有效的持续时间");
  }
}

export function nextTarget(
  item: Routine["exercises"][number],
  previous?: Workout["exercises"][number],
  mode = previous?.snapshot?.mode ?? "reps",
): { weight: number; reps: number; increased: boolean; deloaded?: boolean; doubleJump?: boolean } {
  const assisted = mode === "assisted";
  const completed =
    previous?.sets.filter((set) => set.completed && set.type !== "warmup" && (!assisted || set.reps > 0)) ??
    [];
  const weight = completed.length
    ? (assisted ? Math.min : Math.max)(...completed.map((set) => set.weight))
    : (item.weight ?? 0);
  if (item.progression === "greyskull") {
    if (!completed.length) {
      return { weight, reps: item.repsMin, increased: false };
    }
    const allHit =
      completed.length >= item.sets &&
      completed.every(
        (set) =>
          set.weight === weight &&
          set.reps >= item.repsMin &&
          (set.rir === null || set.rir >= item.targetRir),
      );
    if (!allHit) {
      const deloaded = Math.max(0, Math.round(((assisted ? weight * 1.1 : weight * 0.9) / 1.25)) * 1.25);
      return {
        weight: Math.round(deloaded * 100) / 100,
        reps: item.repsMin,
        increased: false,
        deloaded: true,
      };
    }
    const amrap = completed.at(-1)!;
    const canProgress = !assisted || (weight > 0 && item.increment > 0);
    const doubleJump = canProgress && item.increment > 0 && amrap.reps >= item.repsMin * 2;
    const change = canProgress ? (doubleJump ? item.increment * 2 : item.increment) : 0;
    return {
      weight: Math.round(Math.max(0, weight + (assisted ? -change : change)) * 100) / 100,
      reps: item.repsMin,
      increased: change > 0,
      ...(doubleJump ? { doubleJump: true } : {}),
    };
  }
  const threshold = item.progression === "linear" ? item.repsMin : item.repsMax;
  const allReached =
    completed.length >= item.sets &&
    completed.every(
      (set) =>
        set.weight === weight &&
        set.reps >= threshold &&
        (set.rir === null || set.rir >= item.targetRir),
    );
  const increase = item.progression !== "manual" && allReached && (!assisted || (weight > 0 && item.increment > 0));
  const change = increase ? item.increment : 0;
  const reps =
    item.progression === "double" && completed.length && !increase
      ? Math.min(
          item.repsMax,
          Math.max(
            item.repsMin,
            Math.min(...completed.map((set) => set.reps)) + 1,
          ),
        )
      : item.repsMin;
  return {
    weight: Math.round(Math.max(0, weight + (assisted ? -change : change)) * 100) / 100,
    reps,
    increased: increase,
  };
}

export function recommendRoutine(
  planId: string,
  plan: Plan,
  workouts: readonly PlanCompletion[],
  date = localDate(),
) {
  const completed = workouts.filter(
    (workout) =>
      workout.planId === planId &&
      workout.status === "completed" &&
      workout.date <= date,
  );
  if (plan.schedule === "rotation") {
    const routineIds = new Set(plan.routines.map((routine) => routine.id));
    let previous: PlanCompletion | undefined;
    for (const workout of completed) {
      if (!workout.routineId || !routineIds.has(workout.routineId)) continue;
      if (!previous || compareWorkouts(previous, workout) < 0) previous = workout;
    }
    const previousIndex = plan.routines.findIndex(
      (routine) => routine.id === previous?.routineId,
    );
    const routine = plan.routines[(previousIndex + 1) % plan.routines.length]!;
    return {
      routine,
      date,
      reason: previous
        ? `接续上次已完成的「${previous.title}」`
        : "从计划的第一个训练日开始",
    };
  }
  const today = new Date(`${date}T00:00:00Z`);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(today.getTime() + offset * 86400000);
    const candidateDate = candidate.toISOString().slice(0, 10);
    const weekday = candidate.getUTCDay() || 7;
    const index = plan.weekdays.indexOf(weekday);
    if (index < 0) continue;
    const routine = plan.routines[index]!;
    if (
      completed.some(
        (workout) =>
          workout.routineId === routine.id && workout.date === candidateDate,
      )
    )
      continue;
    return {
      routine,
      date: candidateDate,
      reason: offset === 0 ? "按每周训练安排" : "按计划查看下一次训练",
    };
  }
  return null;
}

export function routineTargets(
  routine: Routine,
  workouts: Workout[],
  planId: string | null,
  date = localDate(),
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise> = [],
) {
  const history = workouts
    .filter((workout) => workout.status === "completed" && workout.date <= date)
    .sort((a, b) => compareWorkouts(b, a));
  const previousRoutine = history.find(
    (workout) => workout.routineId === routine.id && workout.planId === planId,
  );
  const byId = Array.isArray(catalogue)
    ? new Map((catalogue as readonly Exercise[]).map((exercise) => [exercise.id, exercise]))
    : (catalogue as ReadonlyMap<string, Exercise>);
  return routine.exercises.map((item, index) => {
    const mode = byId.get(item.exerciseId)?.mode;
    const matches = (row: Workout["exercises"][number]) =>
      row.exerciseId === item.exerciseId && (!mode || !row.snapshot || row.snapshot.mode === mode);
    const matchingRows = previousRoutine?.exercises.filter(matches) ?? [];
    const previous =
      matchingRows.find((row) => row.targetIndex === index) ??
      (matchingRows.length === 1 ? matchingRows[0] : undefined);
    const previousTarget = previousRoutine?.targetSnapshot?.exercises[index];
    const prescribedChanged =
      item.weight !== null &&
      (previousTarget?.exerciseId !== item.exerciseId ||
        previousTarget.weight !== item.weight);
    if (prescribedChanged) return nextTarget(item, undefined, mode);
    if (previous) return nextTarget(item, previous, mode);
    let historical: Workout["exercises"][number] | undefined;
    for (const workout of history) {
      const found = workout.exercises.find(matches);
      if (found) {
        historical = found;
        break;
      }
    }
    return nextTarget({ ...item, progression: "manual" }, historical, mode);
  });
}
