import type { ExerciseMode, WeightUnit, WorkoutData, WorkoutExercise } from "./domain";
import { applyDeloadToTarget, buildWarmupSetsPlan, readWorkoutPreferences, type WorkoutPreferences } from "./workout-helpers";

export interface RoutineLaunchExerciseRow {
  exerciseId: string;
  targetIndex?: number;
  restSeconds: number;
  supersetGroup?: string | null;
  weightUnit?: WeightUnit;
  autoWarmup?: boolean;
  snapshot: NonNullable<WorkoutExercise["snapshot"]>;
  sets: number;
  weight: number;
  reps: number;
  seconds: number;
  backup?: { id: string; name: string } | null;
}

export interface RoutineLaunchPayload {
  name: string;
  routineId: string;
  planId?: string | null;
  planVersion?: number | null;
  targetSnapshot?: unknown;
  exercises: RoutineLaunchExerciseRow[];
}

function defaultUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pure helper converting a resolved `/api/web/routine` response into a ready-to-launch
 * `WorkoutData` seed, applying deload scaling and per-exercise `autoWarmup` sets.
 */
export function buildWorkoutSeedFromRoutine(
  result: RoutineLaunchPayload,
  opts?: {
    date?: string;
    prefs?: WorkoutPreferences;
    makeId?: () => string;
  },
): Partial<WorkoutData> {
  const prefs = opts?.prefs ?? readWorkoutPreferences();
  const makeId = opts?.makeId ?? defaultUuid;

  const LB_PLATES = [45, 35, 25, 10, 5, 2.5];
  const exercises: WorkoutExercise[] = result.exercises.map((row) => {
    const unit = row.weightUnit ?? "kg";
    // #169: Use 5 lb step & 45 lb barbell for lb exercises instead of kg settings
    const stepForUnit = unit === "lb" ? 5 : prefs.weightStepKg;
    const scaled = prefs.deloadMode
      ? applyDeloadToTarget(
          row.sets,
          row.weight,
          row.snapshot.mode as ExerciseMode,
          stepForUnit,
          prefs.deloadWeightPct,
          prefs.deloadSetsPct,
        )
      : { sets: row.sets, weight: row.weight };

    const workSets = Array.from({ length: scaled.sets }, () => ({
      id: makeId(),
      type: "normal" as const,
      weight: scaled.weight,
      reps: row.reps,
      seconds: row.seconds,
      completed: false,
      rir: null,
    }));

    const warmupSets =
      row.autoWarmup && row.snapshot.mode === "reps" && scaled.weight > 0
        ? buildWarmupSetsPlan(
            scaled.weight,
            row.snapshot.equipment === "barbell",
            unit === "lb" ? 45 : prefs.barWeight,
            unit === "lb" ? LB_PLATES : prefs.enabledPlates,
            prefs.warmupScheme,
          ).map((step) => ({
            id: makeId(),
            type: "warmup" as const,
            weight: step.weight,
            reps: step.reps,
            seconds: 0,
            completed: false,
            rir: null,
          }))
        : [];

    return {
      id: makeId(),
      exerciseId: row.exerciseId,
      targetIndex: row.targetIndex ?? null,
      restSeconds: row.restSeconds,
      supersetGroup: row.supersetGroup ?? null,
      ...(row.weightUnit ? { weightUnit: row.weightUnit } : {}),
      snapshot: row.snapshot,
      backupExerciseId: row.backup?.id ?? null,
      backupExerciseName: row.backup?.name ?? null,
      sets: [...warmupSets, ...workSets],
    };
  });

  return {
    title: result.name,
    ...(opts?.date ? { date: opts.date } : {}),
    exercises,
    planId: result.planId ?? null,
    planVersion: result.planVersion ?? null,
    routineId: result.routineId,
    targetSnapshot: result.targetSnapshot,
  };
}

/**
 * Detect whether a new (non-completed) workout targets a past calendar date,
 * so the editor can enter rapid Backfill Mode (paused stopwatch, all-exercises view, no rest countdown).
 */
export function isBackfillWorkoutDate(date: string, todayStr: string, isHistoricalEdit: boolean): boolean {
  if (isHistoricalEdit) return false;
  return Boolean(date && todayStr && date < todayStr);
}

/**
 * Delay auto-advancing to the next exercise longer when the final set just broke a PR
 * so the user clearly sees the PR badge & toast before the screen transitions.
 */
export function resolveAutoAdvanceDelayMs(prHit: boolean): number {
  return prHit ? 1300 : 320;
}
