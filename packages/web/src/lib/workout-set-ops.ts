import { estimated1RM, weightToKg, type ExerciseMode, type ExerciseReferenceSet, type WeightUnit, type WorkoutSet } from "./domain";

export type SetCompareDirection = "up" | "same" | "down" | null;
export type LivePrHitKind = "weight" | "oneRepMax" | "hold" | "assistance" | null;

export interface LiveExercisePrBaseline {
  exerciseId: string;
  mode: ExerciseMode;
  weight?: number | null;
  oneRepMax?: number | null;
  hold?: number | null;
  assistance?: number | null;
}

/**
 * Duplicate a set directly below `setIdx` as an incomplete working/same-type set.
 */
export function duplicateSetInList(sets: readonly WorkoutSet[], setIdx: number, makeId: () => string): WorkoutSet[] {
  const src = sets[setIdx];
  if (!src) return [...sets];
  const copy: WorkoutSet = {
    id: makeId(),
    type: src.type,
    weight: src.weight,
    reps: src.reps,
    seconds: src.seconds,
    completed: false,
    rir: null,
    ...(src.restAfterSeconds != null ? { restAfterSeconds: src.restAfterSeconds } : {}),
  };
  const next = [...sets];
  next.splice(setIdx + 1, 0, copy);
  return next;
}

/**
 * Insert a drop set (~80% weight snapped to step) directly below `setIdx`.
 */
export function insertDropSetAfter(
  sets: readonly WorkoutSet[],
  setIdx: number,
  weightStep: number,
  makeId: () => string,
): WorkoutSet[] {
  const src = sets[setIdx];
  if (!src) return [...sets];
  const step = weightStep > 0 ? weightStep : 2.5;
  const dropped = src.weight > 0 ? Math.max(0, Math.round((src.weight * 0.8) / step) * step) : 0;
  const dropSet: WorkoutSet = {
    id: makeId(),
    type: "drop",
    weight: Math.round(dropped * 100) / 100,
    reps: src.reps || 8,
    seconds: src.seconds,
    completed: false,
    rir: null,
  };
  const next = [...sets];
  next.splice(setIdx + 1, 0, dropSet);
  return next;
}

/**
 * Insert a rest-pause cluster set (same weight, ~half reps) directly below `setIdx`.
 */
export function insertRestPauseSetAfter(
  sets: readonly WorkoutSet[],
  setIdx: number,
  makeId: () => string,
): WorkoutSet[] {
  const src = sets[setIdx];
  if (!src) return [...sets];
  const rpSet: WorkoutSet = {
    id: makeId(),
    type: "rest_pause",
    weight: src.weight,
    reps: Math.max(2, Math.round((src.reps || 8) / 2)),
    seconds: src.seconds,
    completed: false,
    rir: null,
  };
  const next = [...sets];
  next.splice(setIdx + 1, 0, rpSet);
  return next;
}

/**
 * Compare a completed working set against the previous session's corresponding set.
 */
export function compareSetAgainstReference(
  set: Pick<WorkoutSet, "type" | "completed" | "weight" | "reps" | "seconds">,
  ref: ExerciseReferenceSet | null | undefined,
  mode: ExerciseMode,
): SetCompareDirection {
  if (!set.completed || set.type === "warmup" || !ref) return null;
  if (mode === "timed") {
    if (set.seconds <= 0 || ref.seconds <= 0) return null;
    if (set.seconds > ref.seconds) return "up";
    if (set.seconds < ref.seconds) return "down";
    return "same";
  }
  if (mode === "assisted") {
    if (set.reps <= 0 || ref.reps <= 0) return null;
    if (set.weight < ref.weight || (set.weight === ref.weight && set.reps > ref.reps)) return "up";
    if (set.weight > ref.weight || (set.weight === ref.weight && set.reps < ref.reps)) return "down";
    return "same";
  }
  if (set.reps <= 0 || ref.reps <= 0) return null;
  if (set.weight > ref.weight || (set.weight === ref.weight && set.reps > ref.reps)) return "up";
  if (set.weight < ref.weight || (set.weight === ref.weight && set.reps < ref.reps)) return "down";
  return "same";
}

/**
 * Check whether a completed working set beats the user's all-time PR baseline for this exercise.
 * Normalizes lb weights to kg so PR comparisons stay apples-to-apples.
 */
export function checkSetBeatsPrBaseline(
  set: Pick<WorkoutSet, "type" | "completed" | "weight" | "reps" | "seconds">,
  mode: ExerciseMode,
  weightUnit: WeightUnit | undefined,
  baseline: LiveExercisePrBaseline | null | undefined,
): LivePrHitKind {
  if (!set.completed || set.type === "warmup" || !baseline) return null;
  if (mode === "timed") {
    if (baseline.hold != null && baseline.hold > 0 && set.seconds > baseline.hold) return "hold";
    return null;
  }
  if (mode === "assisted") {
    const wKg = weightToKg(set.weight, weightUnit);
    if (set.reps > 0 && baseline.assistance != null && wKg < baseline.assistance) return "assistance";
    return null;
  }
  if (set.weight <= 0 || set.reps <= 0) return null;
  const wKg = weightToKg(set.weight, weightUnit);
  if (baseline.weight != null && baseline.weight > 0 && wKg > baseline.weight) return "weight";
  if (set.reps <= 10 && baseline.oneRepMax != null && baseline.oneRepMax > 0) {
    const e1rm = Math.round(estimated1RM(wKg, set.reps) * 100) / 100;
    if (e1rm > baseline.oneRepMax) return "oneRepMax";
  }
  return null;
}
