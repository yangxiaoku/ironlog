export const classicLiftIds = {
  bench: ["bench-press", "exdb_0025"],
  squat: ["squat", "exdb_3593"],
  deadlift: ["exdb_0032", "exdb_0117"],
} as const;

export function classicStrength(bestOneRepMax: (id: string) => number | null | undefined) {
  const best = (ids: readonly string[]) => Math.max(0, ...ids.map((id) => bestOneRepMax(id) ?? 0));
  const bench = best(classicLiftIds.bench);
  const squat = best(classicLiftIds.squat);
  const deadlift = best(classicLiftIds.deadlift);
  return { bench, squat, deadlift, total: bench > 0 && squat > 0 && deadlift > 0 ? bench + squat + deadlift : null };
}
