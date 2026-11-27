import type { Plan, Profile, Workout } from "./index.js";
import { localDate, recommendRoutine, type PlanCompletion } from "./logic.js";

function snapshot(profile: Profile, date: string) {
  const { calories, protein, carbs, fat, daysPerWeek, targetWeight } = profile;
  return { date, calories, protein, carbs, fat, daysPerWeek, targetWeight };
}

export function goalsOn(profile: Profile, date: string) {
  if (!profile.goalHistory?.length) return snapshot(profile, date);
  return profile.goalHistory.reduce<ReturnType<typeof snapshot> | null>((best, entry) =>
    entry.date <= date && (!best || entry.date >= best.date) ? entry : best, null);
}

export function trackGoals(previous: Profile, next: Profile, date: string, previousDate?: string): Profile {
  const old = snapshot(previous, date);
  const current = snapshot(next, date);
  if (JSON.stringify(old) === JSON.stringify(current)) return next;
  const history = previous.goalHistory ?? (previousDate && previousDate < date ? [snapshot(previous, previousDate)] : []);
  return { ...next, goalHistory: [...history.filter((entry) => entry.date !== date), current] };
}

export interface PlanActivation {
  id: string;
  version?: number;
  updatedAt?: string;
  startedAt?: string;
  data: Plan;
}

export interface ScheduledPlan extends PlanActivation {
  history?: PlanActivation[];
}

export function planCycle(plan: PlanActivation, asOf: string) {
  const instant = Date.parse(plan.startedAt ?? plan.updatedAt ?? "");
  if (!Number.isFinite(instant)) return null;
  const start = localDate(instant);
  const day = Math.floor((Date.parse(asOf) - Date.parse(start)) / 86400000);
  const end = new Date(Date.parse(start) + (plan.data.weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
  return { start, end, week: Math.max(1, Math.min(plan.data.weeks, Math.floor(day / 7) + 1)), days: day + 1, expired: asOf > end };
}

export function planOn(plan: ScheduledPlan | null | undefined, date: string) {
  if (!plan) return null;
  const entries = plan.history?.length ? plan.history : [plan];
  const active = entries.reduce<PlanActivation | null>((best, entry) => {
    const instant = Date.parse(entry.updatedAt ?? "");
    if (!Number.isFinite(instant)) return best ?? entry;
    if (localDate(instant) > date) return best;
    return !best || instant >= (Date.parse(best.updatedAt ?? "") || 0) ? entry : best;
  }, null);
  return active && !planCycle(active, date)?.expired ? active : null;
}

export function recommendInCycle(plan: PlanActivation, workouts: readonly PlanCompletion[], date: string) {
  const cycle = planCycle(plan, date);
  if (cycle && (cycle.expired || date < cycle.start)) return null;
  const result = recommendRoutine(plan.id, plan.data, cycle ? workouts.filter((workout) => workout.date >= cycle.start) : workouts, date);
  return result && (!cycle || result.date <= cycle.end) ? result : null;
}
