import type { Exercise, Workout } from "./index.js";
import { isValidWorkSet } from "./logic.js";

export type BodyMapMuscle = "chest" | "back" | "shoulders" | "arms" | "core" | "legs";

export const BODY_MAP_MUSCLES: readonly BodyMapMuscle[] = [
  "chest",
  "back",
  "shoulders",
  "arms",
  "core",
  "legs",
] as const;

const TRACKED = new Set<string>(BODY_MAP_MUSCLES);

export interface MuscleProgressEntry {
  muscle: BodyMapMuscle;
  completedSets: number;
  plannedSets: number;
  ratio: number;
}

export interface MuscleRetentionEntry {
  muscle: BodyMapMuscle;
  retention: number; // 0.50 (needs stimulus) .. 1.00 (freshly stimulated)
  daysSinceLast: number | null;
  setsLast14d: number;
  status: "fresh" | "ready" | "due";
}

function toCatalogueLookup(
  catalogue?: readonly Exercise[] | ReadonlyMap<string, Pick<Exercise, "muscle" | "secondaryMuscles" | "mode">>,
): ReadonlyMap<string, Pick<Exercise, "muscle" | "secondaryMuscles" | "mode">> {
  if (!catalogue) return new Map();
  if (Array.isArray(catalogue)) {
    return new Map(catalogue.map((ex) => [ex.id, ex]));
  }
  return catalogue as ReadonlyMap<string, Pick<Exercise, "muscle" | "secondaryMuscles" | "mode">>;
}

/**
 * Summarize completed vs planned effective sets per muscle for a live or planned workout.
 * Primary muscle gets 1.0 set credit; secondary muscles get 0.5 set credit.
 */
export function summarizeWorkoutMuscleSets(
  exercises: ReadonlyArray<{
    exerciseId: string;
    snapshot?: { muscle?: string; mode?: Exercise["mode"] } | null;
    sets: ReadonlyArray<{ type?: string; completed?: boolean; reps?: number; seconds?: number }>;
  }>,
  catalogue?: readonly Exercise[] | ReadonlyMap<string, Pick<Exercise, "muscle" | "secondaryMuscles" | "mode">>,
): MuscleProgressEntry[] {
  const byId = toCatalogueLookup(catalogue);
  const completedMap = new Map<BodyMapMuscle, number>();
  const plannedMap = new Map<BodyMapMuscle, number>();

  for (const row of exercises) {
    const cat = byId.get(row.exerciseId);
    const primary = (row.snapshot?.muscle ?? cat?.muscle) as string | undefined;
    const secondary = (cat?.secondaryMuscles ?? []).filter((m) => m !== primary && TRACKED.has(m));
    const workSets = row.sets.filter((s) => s.type !== "warmup");
    const plannedCount = workSets.length;
    const doneCount = workSets.filter((s) => Boolean(s.completed)).length;

    if (primary && TRACKED.has(primary)) {
      const m = primary as BodyMapMuscle;
      plannedMap.set(m, (plannedMap.get(m) ?? 0) + plannedCount);
      completedMap.set(m, (completedMap.get(m) ?? 0) + doneCount);
    }
    for (const sec of secondary) {
      const m = sec as BodyMapMuscle;
      plannedMap.set(m, (plannedMap.get(m) ?? 0) + plannedCount * 0.5);
      completedMap.set(m, (completedMap.get(m) ?? 0) + doneCount * 0.5);
    }
  }

  return BODY_MAP_MUSCLES.map((muscle) => {
    const plannedSets = Math.round((plannedMap.get(muscle) ?? 0) * 10) / 10;
    const completedSets = Math.round((completedMap.get(muscle) ?? 0) * 10) / 10;
    const ratio = plannedSets > 0 ? Math.min(1, completedSets / plannedSets) : 0;
    return { muscle, completedSets, plannedSets, ratio };
  })
    .filter((entry) => entry.plannedSets > 0 || entry.completedSets > 0)
    .sort((a, b) => b.plannedSets - a.plannedSets || b.completedSets - a.completedSets);
}

/**
 * Compute normalized 0..1 muscle intensity scores for a planned routine or exercise list.
 */
export function muscleIntensityMapFromExercises(
  exercises: ReadonlyArray<{
    exerciseId: string;
    sets?: number | readonly unknown[];
    snapshot?: { muscle?: string } | null;
  }>,
  catalogue?: readonly Exercise[] | ReadonlyMap<string, Pick<Exercise, "muscle" | "secondaryMuscles" | "mode">>,
): Partial<Record<BodyMapMuscle, number>> {
  const byId = toCatalogueLookup(catalogue);
  const raw = new Map<BodyMapMuscle, number>();
  for (const row of exercises) {
    const cat = byId.get(row.exerciseId);
    const primary = (row.snapshot?.muscle ?? cat?.muscle) as string | undefined;
    const secondary = (cat?.secondaryMuscles ?? []).filter((m) => m !== primary && TRACKED.has(m));
    const count = Array.isArray(row.sets) ? row.sets.length : Math.max(1, Number(row.sets) || 1);
    if (primary && TRACKED.has(primary)) {
      const m = primary as BodyMapMuscle;
      raw.set(m, (raw.get(m) ?? 0) + count);
    }
    for (const sec of secondary) {
      const m = sec as BodyMapMuscle;
      raw.set(m, (raw.get(m) ?? 0) + count * 0.5);
    }
  }
  const maxVal = Math.max(0, ...raw.values());
  if (maxVal <= 0) return {};
  const result: Partial<Record<BodyMapMuscle, number>> = {};
  for (const [m, v] of raw) {
    result[m] = Math.round(Math.min(1, Math.max(0.22, v / maxVal)) * 100) / 100;
  }
  return result;
}

/**
 * Compute strength/stimulus retention per muscle group (0.50..1.00) based on days since last work set.
 * - 0..3 days: 1.00 ("fresh")
 * - 4..7 days: decays smoothly 0.96 -> 0.78 ("ready")
 * - 8..14+ days (or never trained): decays down to 0.50 floor ("due")
 */
export function computeMuscleRetention(
  workouts: readonly Pick<Workout, "status" | "date" | "exercises">[],
  catalogue: readonly Exercise[] | ReadonlyMap<string, Pick<Exercise, "muscle" | "secondaryMuscles" | "mode">>,
  todayDate: string,
): MuscleRetentionEntry[] {
  const byId = toCatalogueLookup(catalogue);
  const todayMs = Date.parse(`${todayDate}T00:00:00Z`);
  const lastDateByMuscle = new Map<BodyMapMuscle, string>();
  const sets14dByMuscle = new Map<BodyMapMuscle, number>();

  for (const workout of workouts) {
    if (workout.status !== "completed" || workout.date > todayDate) continue;
    const wMs = Date.parse(`${workout.date}T00:00:00Z`);
    const daysAgo = Number.isFinite(todayMs) && Number.isFinite(wMs)
      ? Math.max(0, Math.round((todayMs - wMs) / 86_400_000))
      : 999;

    for (const row of workout.exercises) {
      const cat = byId.get(row.exerciseId);
      const mode = row.snapshot?.mode ?? cat?.mode;
      const validSets = row.sets.filter((s) => isValidWorkSet(s, mode)).length;
      if (validSets <= 0) continue;

      const primary = (row.snapshot?.muscle ?? cat?.muscle) as string | undefined;
      const secondary = (cat?.secondaryMuscles ?? []).filter((m) => m !== primary && TRACKED.has(m));

      const touch = (m: BodyMapMuscle, credit: number) => {
        const prev = lastDateByMuscle.get(m);
        if (!prev || workout.date > prev) lastDateByMuscle.set(m, workout.date);
        if (daysAgo <= 13) {
          sets14dByMuscle.set(m, (sets14dByMuscle.get(m) ?? 0) + credit);
        }
      };

      if (primary && TRACKED.has(primary)) touch(primary as BodyMapMuscle, validSets);
      for (const sec of secondary) touch(sec as BodyMapMuscle, validSets * 0.5);
    }
  }

  return BODY_MAP_MUSCLES.map((muscle) => {
    const lastDate = lastDateByMuscle.get(muscle) ?? null;
    const setsLast14d = Math.round((sets14dByMuscle.get(muscle) ?? 0) * 10) / 10;
    if (!lastDate) {
      return { muscle, retention: 0.5, daysSinceLast: null, setsLast14d: 0, status: "due" as const };
    }
    const lastMs = Date.parse(`${lastDate}T00:00:00Z`);
    const daysSinceLast = Math.max(0, Math.round((todayMs - lastMs) / 86_400_000));
    let retention = 1;
    if (daysSinceLast > 3) {
      const decayDays = Math.min(11, daysSinceLast - 3);
      retention = Math.max(0.5, 1 - (decayDays / 11) * 0.5);
    }
    retention = Math.round(retention * 100) / 100;
    const status: MuscleRetentionEntry["status"] =
      daysSinceLast <= 3 ? "fresh" : daysSinceLast <= 7 ? "ready" : "due";
    return { muscle, retention, daysSinceLast, setsLast14d, status };
  });
}
