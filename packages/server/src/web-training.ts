import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  exercisePrBaselines, isValidWorkSet, localDate, nutritionDayComplete, nutritionTotals, planOn,
  plannedExerciseSchema, previousExerciseRows, profileSchema, projectScheduleRange, projectWeekMuscleForecast,
  recommendInCycle, resolveRoutineWithTelemetry, scheduledDaySchema,
  type Diet, type Exercise, type NutritionDay, type Routine, type ScheduledDay, type Weight, type Workout,
} from "@ironlog/shared";
import { DomainError, type Store } from "./store.js";
import { getDailyHealth, listDailyHealth, summarizeDailyHealth } from "./apple-health-daily.js";
import { projectAppleTraining, publicAppleActivity } from "./apple-training-agenda.js";

function shiftIsoDate(date: string, offset: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
}

function computeReadinessHint(store: Store, userId: string, workouts: Workout[], date: string) {
  const recentDaily = listDailyHealth(store.db, userId, shiftIsoDate(date, -13), date);
  const recentCutoff = shiftIsoDate(date, -2);
  let latestSleepMin: number | null = null;
  for (let i = recentDaily.length - 1; i >= 0; i--) {
    const entry = recentDaily[i]!;
    if (entry.date < recentCutoff) break;
    if (typeof entry.sleepMinutes === "number" && entry.sleepMinutes > 0) {
      latestSleepMin = entry.sleepMinutes;
      break;
    }
  }
  const healthSummary = recentDaily.length ? summarizeDailyHealth(recentDaily, { through: date }) : null;
  const hasRecentRecoverySignal = healthSummary?.recoveryReport?.signals?.some(
    (s) => ["sleepMinutes", "hrvMs", "restingHeartRateBpm"].includes(s.key) && s.date >= recentCutoff,
  ) ?? false;
  const readinessScore = hasRecentRecoverySignal ? (healthSummary?.recoveryReport?.readinessScore ?? null) : null;

  const from28 = shiftIsoDate(date, -27);
  const from7 = shiftIsoDate(date, -6);
  const catalogue = store.catalogueMap(userId, true);
  let load7 = 0;
  let load28 = 0;
  let count28 = 0;
  for (const w of workouts) {
    if (w.status !== "completed" || w.date < from28 || w.date > date) continue;
    count28++;
    let wLoad = 0;
    for (const row of w.exercises) {
      const ex = row.snapshot ?? catalogue.get(row.exerciseId);
      const mode = ex?.mode ?? "reps";
      const mult = ex?.volumeMultiplier ?? 1;
      if (mode !== "reps") continue;
      for (const s of row.sets) {
        if (isValidWorkSet(s, mode) && s.weight > 0 && s.reps > 0) {
          wLoad += s.weight * s.reps * mult;
        }
      }
    }
    load28 += wLoad;
    if (w.date >= from7) load7 += wLoad;
  }
  const acwr = count28 >= 4 && load28 > 0 ? load7 / (load28 / 4) : null;

  const signals: string[] = [];
  if (latestSleepMin != null && latestSleepMin < 360) {
    const h = Math.floor(latestSleepMin / 60);
    const m = Math.round(latestSleepMin % 60);
    signals.push(`最近睡眠仅 ${h}小时${m ? `${m}分` : ""}`);
  }
  if (readinessScore != null && readinessScore < 68) {
    signals.push(`生理恢复评分 ${readinessScore} 分`);
  }
  if (acwr != null && acwr > 1.38) {
    signals.push(`近7日容量较4周均值 +${Math.round((acwr - 1) * 100)}%`);
  }
  if (!signals.length) return null;

  const severe =
    (latestSleepMin != null && latestSleepMin < 330) ||
    (readinessScore != null && readinessScore < 58) ||
    (acwr != null && acwr > 1.55);
  return {
    tone: (severe ? "warn" : "caution") as "warn" | "caution",
    title: severe ? "恢复偏低，建议今日减载 10%" : "负荷或恢复临界，注意控制 RIR",
    detail: signals.join(" · "),
    suggestedScale: 0.9,
  };
}

export function getWebToday(store: Store, userId: string, date = localDate()) {
  const history = store.list(userId, "workout");
  const workouts = history.map(({ data }) => data as Workout);
  const activeRecord = history.filter(({ data }) => (data as Workout).status === "active" && (data as Workout).date <= date).at(-1);
  const active = activeRecord?.data as Workout | undefined;
  const completed = workouts.filter((workout) => workout.status === "completed" && workout.date === date);
  const completedEntries = history.flatMap(({ id, data }) => {
    const workout = data as Workout;
    return workout.status === "completed" && workout.date <= date ? [{ id, workout }] : [];
  });
  const plan = planOn(store.planSchedule(userId), date);
  const projected = projectAppleTraining(store, userId, date, undefined, completedEntries);
  const apple = projected.entries.filter((row) => row.date === date).map(publicAppleActivity);
  const applePlan = plan ? apple.find((row) => row.plan?.planId === plan.id && row.plan.planVersion === plan.version)?.plan ?? null : null;

  const overrideRecord = store.get(userId, "scheduledDay", "schedule_" + date);
  const override = overrideRecord && !overrideRecord.deleted ? overrideRecord.data as ScheduledDay : null;

  const manualPlanDone = plan && completed.some((workout) => workout.planId === plan.id &&
    (workout.planVersion === null || workout.planVersion === plan.version) &&
    plan.data.routines.some((routine) => routine.id === workout.routineId));
  const manualScheduledDone = override?.mode === "workout" && completed.some((workout) =>
    workout.title === override.title || (override.routineId && workout.routineId === override.routineId));

  let planned: { id: string; name: string; date: string; exercises: number; source?: "plan" | "scheduled" } | null = null;
  if (!applePlan && !manualScheduledDone) {
    if (override?.mode === "rest") {
      planned = null;
    } else if (override?.mode === "workout") {
      planned = {
        id: date,
        name: override.title || "今日排期训练",
        date,
        exercises: override.exercises.length,
        source: "scheduled",
      };
    } else if (plan && !manualPlanDone) {
      const suggested = recommendInCycle(plan, projected.completionHistory, date);
      if (suggested) {
        planned = {
          id: suggested.routine.id,
          name: suggested.routine.name,
          date: suggested.date,
          exercises: suggested.routine.exercises.length,
        };
      }
    }
  }

  const profileRecord = store.get(userId, "profile", "settings");
  const profile = profileSchema.parse(profileRecord?.deleted ? {} : profileRecord?.data ?? {});
  const meals = store.list(userId, "diet").filter(({ data }) => (data as Diet).date === date);
  const marker = store.get(userId, "nutritionDay", "nutritionDay_" + date);
  const weight = store.get(userId, "weight", "weight_" + date);
  const appleDaily = getDailyHealth(store.db, userId, date);
  const readinessHint = computeReadinessHint(store, userId, workouts, date);
  return {
    date, active: activeRecord && active ? { id: activeRecord.id, title: active.title,
      ...(active.date !== date && { from: active.date }),
      done: active.exercises.reduce((sum, row) => sum + row.sets.filter((set) => set.completed).length, 0),
      total: active.exercises.reduce((sum, row) => sum + row.sets.length, 0),
    } : null,
    completed: completed.length + apple.filter((row) => !row.manualWorkoutId).length,
    apple, applePlan, appleDaily,
    waterMl: appleDaily?.waterMl ?? 0,
    readinessHint,
    planned,
    restToday: override?.mode === "rest",
    nutrition: { count: meals.length, ...nutritionTotals(meals.map(({ data }) => data as Diet)),
      target: profile.calories, proteinTarget: profile.protein, complete: !marker?.deleted && nutritionDayComplete(marker?.data as NutritionDay | undefined, meals) },
    weight: weight && !weight.deleted ? (weight.data as Weight).weight : null,
    daysPerWeek: profile.daysPerWeek,
    restSeconds: profile.restSeconds,
  };
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const mode = z.enum(["reps", "timed", "assisted"]);
export const referenceInput = z.object({
  date: z.iso.date(),
  startedAt: z.iso.datetime(),
  workoutId: id.optional(),
  exercises: z.array(z.object({ id, mode: mode.optional() })).min(1).max(100),
});
export function getWebExerciseReferences(store: Store, userId: string, query: z.infer<typeof referenceInput>) {
  const baseMap = store.catalogueMap(userId, true);
  const targetIds = new Set(query.exercises.map((exercise) => exercise.id));
  const catalogue = new Map<string, Exercise>();
  for (const { id, mode } of query.exercises) {
    const exercise = baseMap.get(id);
    if (exercise) catalogue.set(id, mode ? { ...exercise, mode } : exercise);
  }
  const matches = previousExerciseRows(store.list(userId, "workout"), query.workoutId ?? "", {
    date: query.date, startedAt: query.startedAt, exercises: [],
  }, catalogue, targetIds);
  return query.exercises.flatMap(({ id, mode }) => {
    const row = matches.get(id);
    if (!row || (mode && row.snapshot && row.snapshot.mode !== mode)) return [];
    return [{ id, sets: row.sets.map((set) => isValidWorkSet(set, mode ?? row.snapshot?.mode)
      ? { weight: set.weight, reps: set.reps, seconds: set.seconds } : null) }];
  });
}

export function getWebExercisePrs(store: Store, userId: string, query: z.infer<typeof referenceInput>) {
  const byId = store.catalogueMap(userId, true);
  const ids = new Set(query.exercises.map((item) => item.id));
  const baselines = exercisePrBaselines(
    store.list(userId, "workout").map((row) => ({ id: row.id, data: row.data as Workout, deleted: row.deleted })),
    byId,
    { date: query.date, startedAt: query.startedAt, excludeWorkoutId: query.workoutId },
    ids,
  );
  return query.exercises.flatMap(({ id, mode }) => {
    const resolvedMode = mode ?? byId.get(id)?.mode ?? "reps";
    const baseline = baselines.get(`${id}:${resolvedMode}`);
    return baseline ? [baseline] : [];
  });
}

export const routineQuery = z.object({
  id: z.string().min(1).max(100),
  source: z.enum(["plan", "template", "scheduled"]),
  date: z.iso.date().optional(),
});
export function getWebRoutine(store: Store, userId: string, query: z.infer<typeof routineQuery>) {
  const targetDate = query.date ?? localDate();
  const plan = query.source === "plan" ? store.activePlan(userId) : null;
  let routine: Routine | null = null;
  let planId: string | null = plan?.id ?? null;
  let planVersion: number | null = plan?.version ?? null;

  if (query.source === "plan") {
    routine = plan?.data.routines.find((item) => item.id === query.id) ?? null;
  } else if (query.source === "template") {
    const template = store.get(userId, "template", query.id);
    routine = template && !template.deleted ? template.data as Routine : null;
  } else if (query.source === "scheduled") {
    const scheduleDate = query.id.startsWith("schedule_") ? query.id.slice(9) : query.id;
    const override = store.get(userId, "scheduledDay", "schedule_" + scheduleDate);
    if (override && !override.deleted && (override.data as ScheduledDay).mode === "workout") {
      const data = override.data as ScheduledDay;
      planId = data.planId ?? null;
      const activePlan = planId ? store.activePlan(userId) : null;
      planVersion = activePlan?.id === planId ? activePlan.version : null;
      routine = {
        id: data.routineId ?? `schedule_${scheduleDate}`,
        name: data.title || "排期训练",
        exercises: data.exercises,
      };
    } else {
      const projected = getWebScheduleDay(store, userId, scheduleDate);
      if (projected.day.routine) {
        routine = projected.day.routine;
        planId = projected.day.planId;
        const activePlan = store.activePlan(userId);
        planVersion = activePlan?.id === planId ? activePlan.version : null;
      }
    }
  }

  if (!routine || !routine.exercises.length) throw new DomainError("训练计划或模板已变更，请刷新页面", 404);
  const byId = store.catalogueMap(userId);
  if (routine.exercises.some((row) => !byId.has(row.exerciseId))) {
    throw new DomainError("训练计划包含已移除的动作，请更新计划", 409);
  }
  const workouts = store.list(userId, "workout").map(({ data }) => data as Workout);
  const telemetry = resolveRoutineWithTelemetry({
    routine,
    planId,
    date: targetDate,
    workouts,
    catalogue: byId,
  });

  const exercises = telemetry.exercises.map((entry, targetIndex) => {
    const exercise = entry.exercise!;
    const { name, muscle, equipment, mode, volumeMultiplier } = exercise;
    const backup = entry.item.backupExerciseId ? byId.get(entry.item.backupExerciseId) : undefined;
    return {
      exerciseId: entry.item.exerciseId,
      targetIndex,
      restSeconds: entry.item.restSeconds,
      supersetGroup: entry.item.supersetGroup ?? null,
      snapshot: { name, muscle, equipment, mode, volumeMultiplier },
      sets: entry.item.sets,
      weight: entry.weight,
      reps: entry.reps,
      seconds: entry.seconds,
      progression: entry.progression,
      baseline: entry.baseline,
      pr: entry.pr,
      backup: backup ? {
        id: backup.id,
        name: backup.name,
        snapshot: {
          name: backup.name,
          muscle: backup.muscle,
          equipment: backup.equipment,
          mode: backup.mode,
          volumeMultiplier: backup.volumeMultiplier,
        },
      } : null,
    };
  });

  return {
    name: routine.name,
    routineId: routine.id,
    planId,
    planVersion,
    targetSnapshot: routine,
    exercises,
    summary: telemetry.summary,
  };
}

export const scheduleRangeQuery = z.object({
  from: z.iso.date().optional(),
  through: z.iso.date().optional(),
});

function buildScheduleContext(store: Store, userId: string, todayDate: string) {
  const workoutRecords = store.list(userId, "workout");
  const workouts = workoutRecords.map(({ data }) => data as Workout);
  const completedEntries = workoutRecords.flatMap(({ id, data }) => {
    const workout = data as Workout;
    return workout.status === "completed" && workout.date <= todayDate ? [{ id, workout }] : [];
  });
  const catalogue = store.catalogueMap(userId);
  const appleProjected = projectAppleTraining(store, userId, todayDate, catalogue, completedEntries);
  const scheduledRecords = store.list(userId, "scheduledDay");
  const scheduledDays = new Map<string, ScheduledDay>();
  const recordByDate = new Map<string, { id: string; version: number; data: ScheduledDay }>();
  for (const row of scheduledRecords) {
    const data = row.data as ScheduledDay;
    scheduledDays.set(data.date, data);
    recordByDate.set(data.date, { id: row.id, version: row.version, data });
  }
  const activePlan = store.activePlan(userId);
  const profileRecord = store.get(userId, "profile", "settings");
  const profile = profileSchema.parse(profileRecord?.deleted ? {} : profileRecord?.data ?? {});
  return { workouts, appleProjected, scheduledDays, recordByDate, activePlan, catalogue, profile };
}

export function getWebSchedule(store: Store, userId: string, query: z.infer<typeof scheduleRangeQuery>) {
  const todayDate = localDate();
  const anchor = new Date(todayDate + "T00:00:00Z");
  const weekday = (anchor.getUTCDay() + 6) % 7;
  const from = query.from ?? shiftIsoDate(todayDate, -weekday);
  const through = query.through ?? shiftIsoDate(todayDate, 13);
  if (from > through || Date.parse(through) - Date.parse(from) > 90 * 86400000) {
    throw new DomainError("排期查询日期范围不能超过 90 天");
  }
  const ctx = buildScheduleContext(store, userId, todayDate);
  const days = projectScheduleRange({
    from,
    through,
    todayDate,
    workouts: ctx.workouts,
    appleActivities: ctx.appleProjected.entries.map(publicAppleActivity),
    scheduledDays: ctx.scheduledDays,
    activePlan: ctx.activePlan,
    catalogue: ctx.catalogue,
    daysPerWeek: ctx.profile.daysPerWeek,
  });
  const weekForecast = projectWeekMuscleForecast({
    anchorDate: todayDate,
    days,
    workouts: ctx.workouts,
    catalogue: ctx.catalogue,
  });
  const templates = store.list(userId, "template").map((row) => {
    const data = row.data as Routine;
    return {
      id: row.id,
      name: data.name,
      exercisesCount: data.exercises.length,
      exercises: data.exercises,
    };
  });
  return {
    today: todayDate,
    from,
    through,
    days,
    weekForecast,
    activePlan: ctx.activePlan ? {
      id: ctx.activePlan.id,
      version: ctx.activePlan.version,
      name: ctx.activePlan.data.name,
      schedule: ctx.activePlan.data.schedule,
      weeks: ctx.activePlan.data.weeks,
      weekdays: ctx.activePlan.data.weekdays,
      routines: ctx.activePlan.data.routines,
    } : null,
    templates,
  };
}

export function getWebScheduleDay(store: Store, userId: string, date: string) {
  const todayDate = localDate();
  const wd = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const weekStart = shiftIsoDate(date, -wd);
  const weekEnd = shiftIsoDate(weekStart, 6);
  const ctx = buildScheduleContext(store, userId, todayDate);
  const from = weekStart < todayDate && todayDate <= weekEnd ? weekStart : shiftIsoDate(date, -Math.max(1, wd));
  const through = weekEnd;
  const days = projectScheduleRange({
    from: from < weekStart ? from : weekStart,
    through,
    todayDate,
    workouts: ctx.workouts,
    appleActivities: ctx.appleProjected.entries.map(publicAppleActivity),
    scheduledDays: ctx.scheduledDays,
    activePlan: ctx.activePlan,
    catalogue: ctx.catalogue,
    daysPerWeek: ctx.profile.daysPerWeek,
  });
  const day = days.find((item) => item.date === date)!;
  const weekForecast = projectWeekMuscleForecast({
    anchorDate: date,
    days,
    workouts: ctx.workouts,
    catalogue: ctx.catalogue,
  });
  const telemetry = day.routine && day.routine.exercises.length
    ? resolveRoutineWithTelemetry({
        routine: day.routine,
        planId: day.planId,
        date,
        workouts: ctx.workouts,
        catalogue: ctx.catalogue,
      })
    : null;
  const override = ctx.recordByDate.get(date) ?? null;
  const prevDay = days.find((item) => item.date === shiftIsoDate(date, -1)) ?? null;
  const nextDay = days.find((item) => item.date === shiftIsoDate(date, 1)) ?? null;
  return {
    date,
    today: todayDate,
    day,
    override,
    telemetry,
    weekForecast,
    adjacent: {
      previous: prevDay ? { date: prevDay.date, status: prevDay.status, title: prevDay.title } : null,
      next: nextDay ? { date: nextDay.date, status: nextDay.status, title: nextDay.title } : null,
    },
  };
}

export const scheduleDayPutInput = z.object({
  mode: z.enum(["workout", "rest"]),
  title: z.string().trim().max(120).default(""),
  planId: id.nullable().default(null),
  routineId: id.nullable().default(null),
  templateId: id.nullable().default(null),
  notes: z.string().max(1000).default(""),
  exercises: z.array(plannedExerciseSchema).max(100).default([]),
  opId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  baseVersion: z.number().int().min(0).optional(),
});

export function saveWebScheduleDay(store: Store, userId: string, date: string, input: z.infer<typeof scheduleDayPutInput>) {
  const existing = store.get(userId, "scheduledDay", "schedule_" + date);
  const currentVersion = existing?.version ?? 0;
  if (input.baseVersion !== undefined && input.baseVersion !== currentVersion) {
    throw new DomainError("排期已被其他页面修改，请刷新后再试", 409);
  }
  const { opId, baseVersion: _ignored, ...rest } = input;
  const data = scheduledDaySchema.parse({ ...rest, date });
  const result = store.mutate(userId, {
    opId: opId ?? randomUUID(),
    id: "schedule_" + date,
    kind: "scheduledDay",
    baseVersion: currentVersion,
    deleted: false,
    data,
  });
  if (result.status === "conflict") throw new DomainError("排期已被其他页面修改，请刷新后再试", 409);
  return { record: result.record, detail: getWebScheduleDay(store, userId, date) };
}

export function clearWebScheduleDay(store: Store, userId: string, date: string, opId?: string) {
  const existing = store.get(userId, "scheduledDay", "schedule_" + date);
  if (existing && !existing.deleted) {
    const result = store.mutate(userId, {
      opId: opId ?? randomUUID(),
      id: "schedule_" + date,
      kind: "scheduledDay",
      baseVersion: existing.version,
      deleted: true,
      data: existing.data,
    });
    if (result.status === "conflict") throw new DomainError("排期已被其他页面修改，请刷新后再试", 409);
  }
  return { detail: getWebScheduleDay(store, userId, date) };
}

export const scheduleShiftInput = z.object({
  fromDate: z.iso.date(),
  toDate: z.iso.date(),
});

export function shiftWebScheduleDay(store: Store, userId: string, input: z.infer<typeof scheduleShiftInput>) {
  if (input.fromDate === input.toDate) throw new DomainError("请选择不同的目标日期");
  return store.db.transaction(() => {
    const source = getWebScheduleDay(store, userId, input.fromDate);
    if (!source.day.routine || (source.day.status !== "scheduled" && source.day.status !== "projected")) {
      throw new DomainError("这一天还没有可顺延的排期训练");
    }
    const targetOverride = store.get(userId, "scheduledDay", "schedule_" + input.toDate);
    const targetResult = store.mutate(userId, {
      opId: randomUUID(),
      id: "schedule_" + input.toDate,
      kind: "scheduledDay",
      baseVersion: targetOverride?.version ?? 0,
      deleted: false,
      data: scheduledDaySchema.parse({
        date: input.toDate,
        mode: "workout",
        title: source.day.title,
        planId: source.day.planId,
        routineId: source.day.routineId,
        templateId: source.day.templateId,
        notes: source.day.notes,
        exercises: source.day.routine.exercises,
      }),
    });
    if (targetResult.status === "conflict") throw new DomainError("目标日期排期已变更，请重试", 409);

    const fromOverride = store.get(userId, "scheduledDay", "schedule_" + input.fromDate);
    const fromResult = store.mutate(userId, {
      opId: randomUUID(),
      id: "schedule_" + input.fromDate,
      kind: "scheduledDay",
      baseVersion: fromOverride?.version ?? 0,
      deleted: false,
      data: scheduledDaySchema.parse({
        date: input.fromDate,
        mode: "rest",
        title: "调休恢复",
        planId: null,
        routineId: null,
        templateId: null,
        notes: `原定训练已顺延至 ${input.toDate}`,
        exercises: [],
      }),
    });
    if (fromResult.status === "conflict") throw new DomainError("原日期排期已变更，请重试", 409);
    return {
      from: getWebScheduleDay(store, userId, input.fromDate),
      to: getWebScheduleDay(store, userId, input.toDate),
    };
  })();
}

export function matchActivePlanRoutine(
  active: ReturnType<Store["activePlan"]>,
  workout: Pick<Workout, "planId" | "routineId" | "title">,
): Routine | null {
  if (!active) return null;
  if (workout.planId && workout.routineId) {
    if (workout.planId !== active.id) return null;
    return active.data.routines.find((r) => r.id === workout.routineId) ?? null;
  }
  const title = workout.title.trim();
  if (!title) return null;
  return active.data.routines.find((r) => r.name.trim() === title) ?? null;
}

export const syncPlanRoutineInput = z.object({
  workoutId: z.string().min(1).max(100),
  expectedRevision: z.number().int().min(0).optional(),
});

export function syncWorkoutRoutineToActivePlan(
  store: Store,
  userId: string,
  input: z.infer<typeof syncPlanRoutineInput>,
) {
  return store.db.transaction(() => {
    const workoutRec = store.get(userId, "workout", input.workoutId);
    if (!workoutRec || workoutRec.deleted) throw new DomainError("找不到对应的训练记录", 404);
    const workout = workoutRec.data as Workout;
    if (workout.status !== "completed") throw new DomainError("仅已完成的训练可同步回计划", 409);

    const active = store.activePlan(userId);
    if (!active) throw new DomainError("当前没有正在执行的训练计划", 404);
    if (input.expectedRevision !== undefined && active.revision !== input.expectedRevision) {
      throw new DomainError("当前计划已变化，请刷新后重试", 409);
    }

    const oldRoutine = matchActivePlanRoutine(active, workout);
    const routineIdx = oldRoutine ? active.data.routines.findIndex((r) => r.id === oldRoutine.id) : -1;
    if (!oldRoutine || routineIdx < 0) throw new DomainError("本场训练未关联或匹配到当前计划中的训练日", 404);
    if (!workout.exercises.length) throw new DomainError("本场训练没有动作，无法同步回计划", 400);

    const cat = store.catalogueMap(userId);
    if (workout.exercises.some((row) => !cat.has(row.exerciseId))) {
      throw new DomainError("本场包含已归档或已删除动作，无法同步到当前计划", 409);
    }

    const usedOldIndices = new Set<number>();

    const nextExercises = workout.exercises.map((row) => {
      let oldIdx = -1;
      if (
        row.targetIndex != null &&
        !usedOldIndices.has(row.targetIndex) &&
        oldRoutine.exercises[row.targetIndex]?.exerciseId === row.exerciseId
      ) {
        oldIdx = row.targetIndex;
      } else {
        oldIdx = oldRoutine.exercises.findIndex(
          (item, idx) => !usedOldIndices.has(idx) && item.exerciseId === row.exerciseId,
        );
      }
      if (oldIdx >= 0) usedOldIndices.add(oldIdx);
      const oldMatch = oldIdx >= 0 ? oldRoutine.exercises[oldIdx] : undefined;

      const exMeta = cat.get(row.exerciseId)!;
      const timed = exMeta.mode === "timed";
      const workSets = row.sets.filter((s) => isValidWorkSet(s, exMeta.mode));
      const nonWarmup = row.sets.filter((s) => s.type !== "warmup");
      const setsCount = Math.max(1, Math.min(100, workSets.length || nonWarmup.length || row.sets.length || 3));
      const maxSec = timed ? Math.max(0, ...row.sets.map((s) => s.seconds || 0)) : 0;

      return plannedExerciseSchema.parse({
        exerciseId: row.exerciseId,
        sets: setsCount,
        repsMin: timed ? 1 : (oldMatch?.repsMin ?? 8),
        repsMax: timed ? 1 : (oldMatch ? Math.max(oldMatch.repsMin, oldMatch.repsMax) : 12),
        weight: !timed && oldMatch?.weight != null ? oldMatch.weight : null,
        seconds: timed ? Math.max(15, Math.min(86400, maxSec || oldMatch?.seconds || 45)) : 0,
        restSeconds: Math.max(0, Math.min(900, Math.round(row.restSeconds ?? oldMatch?.restSeconds ?? 90))),
        targetRir: oldMatch?.targetRir ?? 2,
        progression: oldMatch?.progression ?? (timed ? "manual" : "double"),
        increment: oldMatch?.increment ?? 2.5,
        backupExerciseId: oldMatch?.backupExerciseId &&
          oldMatch.backupExerciseId !== row.exerciseId &&
          cat.has(oldMatch.backupExerciseId)
          ? oldMatch.backupExerciseId
          : null,
        supersetGroup: row.supersetGroup?.trim() ? row.supersetGroup.trim().slice(0, 16) : null,
      });
    });

    const nextRoutines = active.data.routines.map((r, i) =>
      i === routineIdx ? { ...r, exercises: nextExercises } : r,
    );
    const saved = store.mutate(userId, {
      opId: randomUUID(),
      id: active.id,
      kind: "plan",
      baseVersion: active.version,
      deleted: false,
      data: { ...active.data, routines: nextRoutines },
    });
    if (saved.status === "conflict" || !saved.record) {
      throw new DomainError("当前计划已变化，请刷新后重试", 409);
    }
    const activePlan = store.applyPlan(userId, active.id, saved.record.version, active.revision, false);
    return {
      syncedRoutineName: oldRoutine.name,
      exercisesCount: nextExercises.length,
      activePlan,
    };
  }).immediate();
}
