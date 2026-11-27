import {
  goalsOn, localDate, planOn,
  type PlanActivation, type Profile, type ScheduledDay, type ScheduledPlan, type Workout,
} from "@ironlog/shared";
import type { AppleAgendaItem } from "./apple-training-agenda.js";
import { shiftDay } from "./web-statistics.js";

type CompletionLink = Pick<Workout, "planId" | "planVersion" | "routineId">;

function activeVersionsOnDate(
  planSchedule: ScheduledPlan | null,
  date: string,
  planId: string,
): Set<number> {
  const versions = new Set<number>();
  if (!planSchedule) return versions;
  const history = planSchedule.history ?? [];
  let priorLatest: PlanActivation | null = null;
  for (const entry of history) {
    if (!entry.updatedAt) continue;
    const entryDate = localDate(Date.parse(entry.updatedAt));
    if (entryDate < date) {
      priorLatest = entry;
    } else if (entryDate === date) {
      if (entry.id === planId && entry.version != null) versions.add(entry.version);
    }
  }
  if (priorLatest && priorLatest.id === planId && priorLatest.version != null) versions.add(priorLatest.version);
  if (planSchedule.id === planId && planSchedule.version != null && (!planSchedule.updatedAt || localDate(Date.parse(planSchedule.updatedAt)) <= date)) {
    versions.add(planSchedule.version);
  }
  return versions;
}

export function matchesScheduledWorkout(
  schedule: ScheduledDay,
  link: CompletionLink,
  active: PlanActivation | null,
  validVersions?: ReadonlySet<number>,
) {
  const versionOk =
    active?.id !== link.planId ||
    link.planVersion == null ||
    link.planVersion === active?.version ||
    Boolean(validVersions?.has(link.planVersion));
  return link.routineId === (schedule.routineId ?? `schedule_${schedule.date}`) &&
    link.planId === schedule.planId &&
    versionOk;
}

export function summarizePlanAdherence(
  planSchedule: ScheduledPlan | null,
  overrides: ReadonlyMap<string, ScheduledDay>,
  workouts: readonly { workout: Workout }[],
  apple: readonly AppleAgendaItem[],
  profile: Profile,
  from: string,
  through: string,
  today: string,
) {
  const completions = new Map<string, CompletionLink[]>();
  for (const { workout } of workouts) {
    if (!workout.routineId || workout.date < from) continue;
    const rows = completions.get(workout.date) ?? [];
    rows.push(workout);
    completions.set(workout.date, rows);
  }
  for (const item of apple) {
    if (!item.plan || item.date < from) continue;
    const rows = completions.get(item.date) ?? [];
    rows.push(item.plan);
    completions.set(item.date, rows);
  }
  const byRoutine = new Map<string, { name: string; scheduled: number; completed: number; missed: number }>();
  const rotations = new Map<string, {
    elapsedDays: number; days: number; elapsedFixed: number; fixed: number; elapsedFree: number; free: number;
    completed: number; daysPerWeek: number;
  }>();
  const planIds = new Set<string>();
  let lastPlan: PlanActivation | null = null;
  let scheduledSessions = 0;
  let completedSessions = 0;
  let pendingSessions = 0;
  let firstScheduledDay: string | null = null;
  const countSlot = (key: string, name: string, completed: boolean, date: string) => {
    const pending = !completed && date === today;
    scheduledSessions++;
    if (completed) completedSessions++;
    if (pending) pendingSessions++;
    const row = byRoutine.get(key) ?? { name, scheduled: 0, completed: 0, missed: 0 };
    row.scheduled++;
    if (completed) row.completed++;
    else if (!pending) row.missed++;
    byRoutine.set(key, row);
    firstScheduledDay ??= date;
  };
  for (let date = from; date <= through; date = shiftDay(date, 1)) {
    const active = planOn(planSchedule, date);
    const override = overrides.get(date);
    const matches = completions.get(date) ?? [];
    const weekday = new Date(date + "T00:00:00Z").getUTCDay() || 7;
    if (active) {
      planIds.add(active.id);
      lastPlan = active;
    }
    const validVersions = active ? activeVersionsOnDate(planSchedule, date, active.id) : undefined;
    if (override?.mode === "workout") {
      const routineId = override.routineId ?? `schedule_${date}`;
      countSlot(override.routineId ? `${override.planId ?? ""}:${routineId}` : `manual:${override.title}`,
        override.title || "排期训练",
        matches.some((m) => matchesScheduledWorkout(override, m, active, validVersions)), date);
    } else if (!override && active?.data.schedule === "weekdays") {
      const routine = active.data.routines[active.data.weekdays.indexOf(weekday)];
      if (routine) countSlot(`${active.id}:${routine.id}`, routine.name,
        matches.some((m) => m.planId === active.id && m.routineId === routine.id &&
          (m.planVersion == null || m.planVersion === active.version || Boolean(validVersions?.has(m.planVersion)))), date);
    }
    if (active?.data.schedule === "rotation") {
      const monday = shiftDay(date, 1 - weekday);
      const key = `${active.id}:${active.startedAt ?? active.updatedAt ?? active.version ?? ""}:${monday}`;
      const week = rotations.get(key) ?? {
        elapsedDays: 0, days: 0, elapsedFixed: 0, fixed: 0, elapsedFree: 0, free: 0, completed: 0,
        daysPerWeek: goalsOn(profile, date)?.daysPerWeek ?? profile.daysPerWeek,
      };
      week.days++;
      if (date < today) week.elapsedDays++;
      if (override?.mode === "workout") {
        week.fixed++;
        if (date < today) week.elapsedFixed++;
      } else if (!override) {
        week.free++;
        if (date < today) week.elapsedFree++;
        week.completed += new Set(matches.filter((m) => m.planId === active.id &&
          (m.planVersion == null || m.planVersion === active.version || Boolean(validVersions?.has(m.planVersion))) &&
          active.data.routines.some((r) => r.id === m.routineId)).map((m) => m.routineId)).size;
      }
      firstScheduledDay ??= date;
      rotations.set(key, week);
    }
  }
  for (const week of rotations.values()) {
    const weeklyTarget = Math.max(0, week.daysPerWeek - week.fixed);
    const proratedQuota = Math.min(week.free, Math.max(0, Math.round(week.days * week.daysPerWeek / 7) - week.fixed));
    const quota = Math.max(proratedQuota, Math.min(week.completed, weeklyTarget));
    const elapsedQuota = Math.min(week.elapsedFree, Math.max(0, Math.round(week.elapsedDays * week.daysPerWeek / 7) - week.elapsedFixed));
    const done = Math.min(quota, week.completed);
    scheduledSessions += quota;
    completedSessions += done;
    pendingSessions += Math.max(0, quota - Math.max(done, elapsedQuota));
  }
  const assessed = scheduledSessions - pendingSessions;
  return {
    hasPlan: planIds.size > 0 || byRoutine.size > 0,
    planName: planIds.size > 1 ? "多套训练计划" : lastPlan?.data.name ?? (byRoutine.size ? "手动排期" : null),
    scheduleMode: lastPlan?.data.schedule ?? null,
    from: firstScheduledDay ?? from,
    through,
    scheduledSessions,
    completedSessions,
    pendingSessions,
    missedSessions: assessed - completedSessions,
    adherencePct: assessed > 0 ? Math.round(completedSessions / assessed * 100) : null,
    byRoutine: [...byRoutine.entries()].map(([key, row]) => {
      const total = row.completed + row.missed;
      return { key, ...row, adherencePct: total ? Math.round(row.completed / total * 100) : null };
    }).sort((a, b) => (a.adherencePct ?? 101) - (b.adherencePct ?? 101) || b.missed - a.missed),
  };
}
