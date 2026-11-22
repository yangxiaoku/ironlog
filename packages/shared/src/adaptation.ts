import type {
  Exercise,
  Workout,
  WorkoutAdaptation,
  WorkoutAdjustment,
} from "./index.js";

export function exerciseSnapshot(
  exercise: Pick<
    Exercise,
    "name" | "muscle" | "equipment" | "mode" | "volumeMultiplier"
  >,
) {
  return {
    name: exercise.name,
    muscle: exercise.muscle,
    equipment: exercise.equipment,
    mode: exercise.mode,
    volumeMultiplier: exercise.volumeMultiplier,
  };
}

export function unfinishedSets(row: Workout["exercises"][number]) {
  return row.sets
    .filter((set) => !set.completed)
    .map((set) => ({
      id: set.id,
      type: set.type,
      weight: set.weight,
      reps: set.reps,
      seconds: set.seconds ?? 0,
      completed: false,
      rir: set.rir ?? null,
    }));
}

export function validateWorkoutAdjustment(
  workout: Workout,
  change: WorkoutAdjustment,
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>,
) {
  if (workout.status !== "active")
    throw new Error("本次训练已结束，请重新查看记录");
  const row = workout.exercises.find(
    (item) => item.id === change.exerciseRowId,
  );
  if (!row) throw new Error("待调整动作已经移除，请重新获取建议");
  const before = change.before;
  const snapshotKeys = [
    "name",
    "muscle",
    "equipment",
    "mode",
    "volumeMultiplier",
  ] as const;
  const snapshotChanged =
    before.snapshot !== undefined &&
    snapshotKeys.some((key) => row.snapshot?.[key] !== before.snapshot?.[key]);
  if (
    row.exerciseId !== before.exerciseId ||
    snapshotChanged ||
    row.restSeconds !== before.restSeconds ||
    JSON.stringify(unfinishedSets(row)) !==
      JSON.stringify(unfinishedSets({ ...row, sets: before.openSets }))
  ) {
    throw new Error("待调整的训练组已变化，请重新获取建议");
  }
  if (!before.openSets.length) throw new Error("该动作已完成");
  const exerciseId = change.patch.exerciseId ?? row.exerciseId;
  const replacing = exerciseId !== row.exerciseId;
  const exercise =
    !replacing && row.snapshot
      ? { id: row.exerciseId, ...row.snapshot }
      : Array.isArray(catalogue)
        ? (catalogue as readonly Exercise[]).find((item) => item.id === exerciseId)
        : (catalogue as ReadonlyMap<string, Exercise>).get(exerciseId);
  if (!exercise) throw new Error("建议中的动作已不可用");
  const remaining = change.patch.remainingSets ?? before.openSets.length;
  const completedCount = row.sets.filter((set) => set.completed).length;
  if (remaining + (replacing ? 0 : completedCount) > 100)
    throw new Error("调整后的单个动作最多100组");
  if (replacing && remaining > 0 && change.patch.weight === undefined)
    throw new Error("替换动作需要明确新的重量");
  if (remaining > 0) {
    const base = before.openSets[0]!;
    if (
      exercise.mode === "timed" &&
      (change.patch.seconds ?? base.seconds) <= 0
    )
      throw new Error("计时动作需要有效的持续时间");
    if (exercise.mode !== "timed" && (change.patch.reps ?? base.reps) <= 0)
      throw new Error("训练动作需要有效的次数");
  }
  return { row, exercise, replacing, remaining };
}

export function applyWorkoutAdaptation(
  workout: Workout,
  proposal: WorkoutAdaptation,
  selectedRowIds: string[],
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>,
  createId: () => string,
): Workout {
  if ((workout.adjustments ?? []).some((item) => item.id === proposal.id))
    return workout;
  const selected = new Set(selectedRowIds);
  if (!selected.size) throw new Error("请先选择需要应用的调整");
  const changes = proposal.changes.filter((change) =>
    selected.has(change.exerciseRowId),
  );
  if (
    changes.length !== selected.size ||
    new Set(changes.map((change) => change.exerciseRowId)).size !==
      changes.length
  )
    throw new Error("调整项不存在或重复");
  for (const change of changes)
    validateWorkoutAdjustment(workout, change, catalogue);
  const result = JSON.parse(JSON.stringify(workout)) as Workout;
  for (const change of changes) {
    const { row, exercise, replacing, remaining } = validateWorkoutAdjustment(
      result,
      change,
      catalogue,
    );
    const completed = row.sets.filter((set) => set.completed);
    const open = unfinishedSets(row);
    const base = open[open.length - 1]!;
    const sets = Array.from({ length: remaining }, (_, index) => {
      const original = open[index];
      const set = original ?? {
        ...base,
        id: createId(),
        type: "normal" as const,
        rir: null,
      };
      return {
        ...set,
        weight: change.patch.weight ?? set.weight,
        reps: exercise.mode === "timed" ? 0 : (change.patch.reps ?? set.reps),
        seconds:
          exercise.mode === "timed" ? (change.patch.seconds ?? set.seconds) : 0,
        completed: false,
      };
    });
    const index = result.exercises.indexOf(row);
    if (replacing && completed.length) {
      row.sets = completed;
      if (remaining)
        result.exercises.splice(index + 1, 0, {
          id: createId(),
          exerciseId: exercise.id,
          ...(row.supersetGroup ? { supersetGroup: row.supersetGroup } : {}),
          snapshot: exerciseSnapshot(exercise),
          restSeconds: change.patch.restSeconds ?? row.restSeconds,
          sets,
        });
    } else if (!sets.length && !completed.length) {
      result.exercises.splice(index, 1);
    } else {
      row.exerciseId = exercise.id;
      row.snapshot = replacing ? exerciseSnapshot(exercise) : row.snapshot;
      row.restSeconds = change.patch.restSeconds ?? row.restSeconds;
      const updated = new Map(sets.map((set) => [set.id, set]));
      const originalIds = new Set(row.sets.map((set) => set.id));
      row.sets = row.sets.flatMap((set) =>
        set.completed
          ? [set]
          : updated.has(set.id)
            ? [updated.get(set.id)!]
            : [],
      );
      row.sets.push(...sets.filter((set) => !originalIds.has(set.id)));
    }
  }
  if (result.exercises.length > 100)
    throw new Error("调整后的训练最多100个动作");
  result.adjustments = [
    ...(result.adjustments ?? []),
    { ...proposal, changes },
  ];
  return result;
}
