import type { Exercise, Plan, Routine, ScheduledDay, Workout } from "./index.js";
import { compareWorkouts, estimatedOneRepMax, isValidWorkSet, localDate, nextTarget, weightToKg } from "./logic.js";

export type PrMetric = "weight" | "oneRepMax" | "hold" | "assistance";

export interface ExercisePrBaseline {
  exerciseId: string;
  mode: Exercise["mode"];
  weight: number | null;
  oneRepMax: number | null;
  hold: number | null;
  assistance: number | null;
  lastDate: string | null;
}

export interface PrImprovement {
  metric: PrMetric;
  previous: number;
  current: number;
}

export interface PrOpportunity {
  kind: "will_break_weight" | "will_break_1rm" | "will_break_hold" | "will_break_assistance" | "nudge_reps" | "baseline";
  label: string;
  detail: string;
  repsNeeded?: number;
}

export interface ExerciseProgressionReport {
  weight: number;
  reps: number;
  increased: boolean;
  ruleLabel: string;
  status: "progress_weight" | "progress_reps" | "plateau_deload" | "maintain" | "baseline";
  statusLabel: string;
  reason: string;
  forecast: string;
  deloadWeight: number | null;
  backupExerciseId: string | null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToPlate(value: number, step = 1.25) {
  return Math.max(0, Math.round(value / step) * step);
}

function addDaysIso(date: string, offset: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
}

function isoWeekday(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay() || 7;
}

function weekMonday(date: string): string {
  const wd = isoWeekday(date);
  return addDaysIso(date, -(wd - 1));
}

function baselineKey(exerciseId: string, mode: Exercise["mode"]) {
  return `${exerciseId}:${mode}`;
}

function toCatalogueMap(catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>): ReadonlyMap<string, Exercise> {
  return Array.isArray(catalogue)
    ? new Map((catalogue as readonly Exercise[]).map((item) => [item.id, item]))
    : (catalogue as ReadonlyMap<string, Exercise>);
}

/**
 * Compute per-exercise all-time PR baselines prior to a given cutoff date/time.
 */
export function exercisePrBaselines(
  workouts: readonly { id?: string; data: Workout; deleted?: boolean }[],
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>,
  cutoff: { date: string; startedAt?: string; excludeWorkoutId?: string },
  searchExerciseIds?: ReadonlySet<string>,
): Map<string, ExercisePrBaseline> {
  const byId = toCatalogueMap(catalogue);
  const cutoffMs = cutoff.startedAt ? Date.parse(cutoff.startedAt) : null;
  const result = new Map<string, ExercisePrBaseline>();

  for (const entry of workouts) {
    if (entry.deleted) continue;
    if (cutoff.excludeWorkoutId && entry.id === cutoff.excludeWorkoutId) continue;
    const workout = entry.data;
    if (workout.status !== "completed") continue;
    if (workout.date > cutoff.date) continue;
    if (workout.date === cutoff.date && cutoffMs !== null) {
      const endOrStart = Date.parse(workout.endedAt ?? workout.startedAt);
      if (endOrStart >= cutoffMs) continue;
    }

    for (const row of workout.exercises) {
      if (searchExerciseIds && !searchExerciseIds.has(row.exerciseId)) continue;
      const exercise = row.snapshot ?? byId.get(row.exerciseId);
      const mode: Exercise["mode"] = exercise?.mode ??
        (row.sets.some((set) => set.seconds > 0) && row.sets.every((set) => set.reps === 0) ? "timed" : "reps");
      const key = baselineKey(row.exerciseId, mode);
      let hasWork = false;
      let bestHold = 0;
      let bestAssist = Infinity;
      let maxW = 0;
      let max1rm = 0;
      let has1rm = false;
      for (const set of row.sets) {
        if (!isValidWorkSet(set, mode)) continue;
        hasWork = true;
        if (mode === "timed") {
          if (set.seconds > bestHold) bestHold = set.seconds;
        } else if (mode === "assisted") {
          if (set.weight < bestAssist) bestAssist = set.weight;
        } else if (set.weight > 0 && set.reps > 0) {
          const wKg = weightToKg(set.weight, row.weightUnit);
          if (wKg > maxW) maxW = wKg;
          if (set.reps <= 10) {
            const est = round2(estimatedOneRepMax(wKg, set.reps));
            if (!has1rm || est > max1rm) {
              max1rm = est;
              has1rm = true;
            }
          }
        }
      }
      if (!hasWork) continue;

      const current = result.get(key) ?? {
        exerciseId: row.exerciseId,
        mode,
        weight: null,
        oneRepMax: null,
        hold: null,
        assistance: null,
        lastDate: null,
      };
      if (!current.lastDate || workout.date > current.lastDate) current.lastDate = workout.date;

      if (mode === "timed") {
        if (bestHold > 0 && (current.hold === null || bestHold > current.hold)) current.hold = bestHold;
      } else if (mode === "assisted") {
        if (current.assistance === null || bestAssist < current.assistance) current.assistance = bestAssist;
      } else if (maxW > 0) {
        if (current.weight === null || maxW > current.weight) current.weight = maxW;
        if (has1rm && (current.oneRepMax === null || max1rm > current.oneRepMax)) current.oneRepMax = max1rm;
      }
      result.set(key, current);
    }
  }
  return result;
}

/**
 * Check whether a set beats an exercise's historical PR baseline.
 */
export function checkSetPr(
  set: { type?: string; weight: number; reps: number; seconds?: number },
  mode: Exercise["mode"],
  baseline: ExercisePrBaseline | undefined,
): PrImprovement[] {
  if (!baseline || set.type === "warmup") return [];
  const improvements: PrImprovement[] = [];
  if (mode === "timed") {
    const seconds = set.seconds ?? 0;
    if (baseline.hold !== null && seconds > baseline.hold) {
      improvements.push({ metric: "hold", previous: baseline.hold, current: seconds });
    }
    return improvements;
  }
  if (mode === "assisted") {
    if (set.reps > 0 && baseline.assistance !== null && set.weight < baseline.assistance) {
      improvements.push({ metric: "assistance", previous: baseline.assistance, current: set.weight });
    }
    return improvements;
  }
  if (set.weight > 0 && set.reps > 0) {
    if (baseline.weight !== null && set.weight > baseline.weight) {
      improvements.push({ metric: "weight", previous: baseline.weight, current: set.weight });
    }
    if (set.reps <= 10 && baseline.oneRepMax !== null) {
      const current1rm = round2(estimatedOneRepMax(set.weight, set.reps));
      if (current1rm > baseline.oneRepMax) {
        improvements.push({ metric: "oneRepMax", previous: baseline.oneRepMax, current: current1rm });
      }
    }
  }
  return improvements;
}

/**
 * Summarize PR breakthrough opportunity or rep target threshold for an upcoming target.
 */
export function prOpportunityForTarget(
  target: { weight: number; reps: number; seconds: number },
  mode: Exercise["mode"],
  baseline: ExercisePrBaseline | undefined,
): PrOpportunity | null {
  if (!baseline) {
    return { kind: "baseline", label: "首次建立 PR 基准", detail: "完成本次记录后开始追踪纪录" };
  }
  if (mode === "timed") {
    if (baseline.hold === null) return null;
    if (target.seconds > baseline.hold) {
      return {
        kind: "will_break_hold",
        label: "目标突破时长 PR",
        detail: `历史最长 ${baseline.hold} 秒 → 本次 ${target.seconds} 秒`,
      };
    }
    return {
      kind: "baseline",
      label: `最佳 ${baseline.hold} 秒`,
      detail: `超过 ${baseline.hold} 秒即刷新最长保持 PR`,
    };
  }
  if (mode === "assisted") {
    if (baseline.assistance === null) return null;
    if (target.weight < baseline.assistance && target.weight >= 0) {
      return {
        kind: "will_break_assistance",
        label: "目标减少辅助 PR",
        detail: `最佳辅助 ${baseline.assistance} kg → 本次 ${target.weight} kg`,
      };
    }
    return {
      kind: "baseline",
      label: `最佳辅助 ${baseline.assistance} kg`,
      detail: `辅助降至 ${baseline.assistance} kg 以下即破纪录`,
    };
  }
  if (target.weight > 0 && baseline.weight !== null && target.weight > baseline.weight) {
    return {
      kind: "will_break_weight",
      label: `目标破重量 PR (+${round2(target.weight - baseline.weight)} kg)`,
      detail: `当前最佳 ${baseline.weight} kg · 本次目标 ${target.weight} kg`,
    };
  }
  if (target.weight > 0 && baseline.oneRepMax !== null) {
    if (target.reps > 0 && target.reps <= 10) {
      const target1rm = round2(estimatedOneRepMax(target.weight, target.reps));
      if (target1rm > baseline.oneRepMax) {
        return {
          kind: "will_break_1rm",
          label: "目标破估算 1RM 纪录",
          detail: `当前最佳 1RM ${baseline.oneRepMax} kg → 预计 ${target1rm} kg`,
        };
      }
    }
    for (let reps = 1; reps <= 10; reps++) {
      if (round2(estimatedOneRepMax(target.weight, reps)) > baseline.oneRepMax) {
        return {
          kind: "nudge_reps",
          repsNeeded: reps,
          label: `做满 ${reps} 次可破 1RM PR`,
          detail: `最佳重量 ${baseline.weight ?? target.weight} kg · 最佳 1RM ${baseline.oneRepMax} kg`,
        };
      }
    }
  }
  if (baseline.weight !== null) {
    return {
      kind: "baseline",
      label: `最佳 ${baseline.weight} kg`,
      detail: baseline.oneRepMax ? `历史最高 1RM ${baseline.oneRepMax} kg` : `历史最高重量 ${baseline.weight} kg`,
    };
  }
  return null;
}

export function progressionRuleLabel(item: Routine["exercises"][number], mode: Exercise["mode"] = "reps"): string {
  if (mode === "timed") return `计时目标 ${item.seconds} 秒 · 休 ${item.restSeconds}s`;
  const range = item.repsMin === item.repsMax ? `${item.repsMin} 次` : `${item.repsMin}–${item.repsMax} 次`;
  if (item.progression === "manual") return `固定负荷 ${range}`;
  const sign = mode === "assisted" ? "-" : "+";
  if (item.progression === "greyskull") return `Greyskull AMRAP ${range}+ · 达标 ${sign}${item.increment}kg / 翻倍×2 / 失利-10%`;
  if (item.progression === "linear") return `线性渐进 ${range} · 达标 ${sign}${item.increment}kg`;
  return `双重渐进 ${range} · RIR≥${item.targetRir} · ${sign}${item.increment}kg`;
}

/**
 * Evaluate per-exercise progression targets, plateau/deload warnings, and next-cycle forecast.
 */
export function evaluateExerciseProgression(
  item: Routine["exercises"][number],
  previousRow: Workout["exercises"][number] | undefined,
  historicalRow: Workout["exercises"][number] | undefined,
  recentSameExercise: readonly { feeling: Workout["feeling"]; row: Workout["exercises"][number] }[],
  mode: Exercise["mode"] = "reps",
  prescribedChanged = false,
): ExerciseProgressionReport {
  const assisted = mode === "assisted";
  const computed = prescribedChanged
    ? nextTarget(item, undefined, mode)
    : previousRow
      ? nextTarget(item, previousRow, mode)
      : nextTarget({ ...item, progression: "manual" }, historicalRow, mode);

  const ruleLabel = progressionRuleLabel(item, mode);
  const completedPrev = previousRow?.sets.filter((set) => isValidWorkSet(set, mode)) ?? [];
  const prevTopWeight = completedPrev.length
    ? (assisted ? Math.min : Math.max)(...completedPrev.map((set) => set.weight))
    : computed.weight;

  // Detect consecutive misses or recent fatigued streak on progression exercises
  let plateau = false;
  if (item.progression !== "manual" && !computed.increased && recentSameExercise.length >= 2 && mode !== "timed") {
    const recentTwo = recentSameExercise.slice(0, 2);
    const missedTwice = recentTwo.every(({ row }) => {
      const work = row.sets.filter((set) => isValidWorkSet(set, mode));
      return work.length < item.sets || work.some((set) => set.reps < item.repsMin);
    });
    const fatiguedStreak = recentTwo.every(({ feeling }) => feeling === "fatigued");
    if (missedTwice || fatiguedStreak) plateau = true;
  }

  const nextMilestoneWeight = mode === "timed"
    ? computed.weight
    : Math.max(0, round2(computed.weight + (assisted ? -item.increment : item.increment)));
  const forecast = item.progression === "manual" || mode === "timed"
    ? `当前按 ${item.sets} 组 × ${mode === "timed" ? `${item.seconds} 秒` : `${item.repsMin}–${item.repsMax} 次`} 稳定推进`
    : item.progression === "greyskull"
      ? `末组全力冲刺（AMRAP）：满 ${item.repsMin} 次升至 ${nextMilestoneWeight} kg，满 ${item.repsMin * 2} 次双倍加重`
      : item.progression === "linear"
        ? `下次满 ${item.sets} 组达 ${item.repsMin} 次且 RIR≥${item.targetRir}，将推至 ${nextMilestoneWeight} kg`
        : `满 ${item.sets} 组达 ${item.repsMax} 次且 RIR≥${item.targetRir}，将升至 ${nextMilestoneWeight} kg`;

  if (computed.deloaded) {
    return {
      weight: computed.weight,
      reps: computed.reps,
      increased: false,
      ruleLabel,
      status: "plateau_deload",
      statusLabel: "AMRAP 失利 · 自动减载 -10%",
      reason: `上次未完成 ${item.sets} 组 × ${item.repsMin} 次，按 Greyskull 规则自动减载 10% 至 ${computed.weight} kg 重建势能`,
      forecast,
      deloadWeight: computed.weight,
      backupExerciseId: item.backupExerciseId,
    };
  }

  const deloadWeight = plateau && computed.weight > 0
    ? roundToPlate(assisted ? computed.weight * 1.1 : computed.weight * 0.9, 1.25)
    : null;

  if (computed.increased) {
    if (computed.doubleJump) {
      return {
        weight: computed.weight,
        reps: computed.reps,
        increased: computed.increased,
        ruleLabel,
        status: "progress_weight",
        statusLabel: assisted ? `AMRAP 爆发 -${round2(item.increment * 2)} kg` : `AMRAP 爆发 +${round2(item.increment * 2)} kg`,
        reason: `上次末组 AMRAP 达成 ≥${item.repsMin * 2} 次（双倍达标），本次直接翻倍递增`,
        forecast,
        deloadWeight: null,
        backupExerciseId: item.backupExerciseId,
      };
    }
    return {
      weight: computed.weight,
      reps: computed.reps,
      increased: computed.increased,
      ruleLabel,
      status: "progress_weight",
      statusLabel: assisted ? `减辅助 -${item.increment} kg` : `渐进加重 +${item.increment} kg`,
      reason: item.progression === "greyskull"
        ? `上次完成 ${item.sets} 组 × ${item.repsMin}+ 次（${prevTopWeight} kg），按 Greyskull 规则推进重量`
        : `上次达成 ${item.sets} 组 × ${item.progression === "linear" ? item.repsMin : item.repsMax} 次（${prevTopWeight} kg），本次自动推进重量`,
      forecast,
      deloadWeight: null,
      backupExerciseId: item.backupExerciseId,
    };
  }

  if (plateau) {
    return {
      ...computed,
      ruleLabel,
      status: "plateau_deload",
      statusLabel: "平台期 · 建议减载",
      reason: `连续 2 次未稳步达成最低 ${item.repsMin} 次或体感疲惫，可减载至 ${deloadWeight ?? computed.weight} kg 调整状态`,
      forecast,
      deloadWeight,
      backupExerciseId: item.backupExerciseId,
    };
  }

  if (previousRow && item.progression === "double" && computed.reps > item.repsMin) {
    return {
      ...computed,
      ruleLabel,
      status: "progress_reps",
      statusLabel: `冲次数 ${computed.reps}/${item.repsMax}`,
      reason: `重量保持 ${computed.weight} kg，目标次数从上次基础上推进至 ${computed.reps} 次`,
      forecast,
      deloadWeight: null,
      backupExerciseId: item.backupExerciseId,
    };
  }

  if (previousRow || historicalRow) {
    return {
      ...computed,
      ruleLabel,
      status: "maintain",
      statusLabel: item.progression === "manual" ? "固定负荷" : "巩固冲击上限",
      reason: previousRow
        ? `沿用 ${computed.weight} kg，完成全组 ${item.progression === "linear" || item.progression === "greyskull" ? item.repsMin : item.repsMax} 次（RIR≥${item.targetRir}）即可触发下轮渐进`
        : `参考历史同动作表现预设为 ${computed.weight} kg`,
      forecast,
      deloadWeight: null,
      backupExerciseId: item.backupExerciseId,
    };
  }

  return {
    ...computed,
    ruleLabel,
    status: "baseline",
    statusLabel: "初始目标",
    reason: computed.weight > 0 ? `按计划初始负重 ${computed.weight} kg 开始建立记录` : "首次训练按自身状态设定起始重量",
    forecast,
    deloadWeight: null,
    backupExerciseId: item.backupExerciseId,
  };
}

export interface ProjectedScheduleDay {
  date: string;
  status: "completed" | "scheduled" | "projected" | "rest" | "empty";
  source: "history" | "manual" | "plan" | "rest" | "empty";
  title: string;
  routineId: string | null;
  planId: string | null;
  templateId: string | null;
  notes: string;
  exercisesCount: number;
  estimatedMinutes: number;
  muscles: string[];
  routine: Routine | null;
  workoutsCount: number;
}

function estimateRoutineMinutes(routine: Pick<Routine, "exercises">): number {
  const totalSeconds = routine.exercises.reduce((sum, ex) => {
    const work = ex.seconds > 0 ? ex.seconds : 35;
    const rest = Math.max(30, ex.restSeconds);
    return sum + ex.sets * (work + rest);
  }, 0);
  return Math.max(15, Math.round(totalSeconds / 60));
}

function routineMuscles(routine: Pick<Routine, "exercises">, catalogueById: ReadonlyMap<string, Exercise>): string[] {
  const seen = new Set<string>();
  for (const row of routine.exercises) {
    const muscle = catalogueById.get(row.exerciseId)?.muscle;
    if (muscle && muscle !== "cardio") seen.add(muscle);
  }
  return [...seen];
}

function spreadIndicesInWeek(remainingDates: string[], slotsNeeded: number): Set<string> {
  if (slotsNeeded <= 0 || !remainingDates.length) return new Set();
  if (slotsNeeded >= remainingDates.length) return new Set(remainingDates);
  const picked = new Set<string>();
  const step = remainingDates.length / slotsNeeded;
  for (let i = 0; i < slotsNeeded; i++) {
    const idx = Math.min(remainingDates.length - 1, Math.floor((i + 0.5) * step));
    picked.add(remainingDates[idx]!);
  }
  return picked;
}

/**
 * Project daily schedule states across [from, through], honoring completed history,
 * explicit ScheduledDay overrides, and the user's active plan (weekdays or rotation).
 */
export function projectScheduleRange(params: {
  from: string;
  through: string;
  todayDate: string;
  workouts: readonly Workout[];
  appleActivities: readonly { date: string; title: string; manualWorkoutId: string | null; plan: { routineId: string; name: string } | null }[];
  scheduledDays: ReadonlyMap<string, ScheduledDay>;
  activePlan: { id: string; version: number; updatedAt?: string; data: Plan } | null;
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>;
  daysPerWeek?: number;
}): ProjectedScheduleDay[] {
  const byId = toCatalogueMap(params.catalogue);
  const completedByDate = new Map<string, Workout[]>();
  for (const workout of params.workouts) {
    if (workout.status !== "completed") continue;
    const list = completedByDate.get(workout.date) ?? [];
    list.push(workout);
    completedByDate.set(workout.date, list);
  }
  const appleByDate = new Map<string, typeof params.appleActivities[number][]>();
  for (const item of params.appleActivities) {
    if (item.manualWorkoutId) continue;
    const list = appleByDate.get(item.date) ?? [];
    list.push(item);
    appleByDate.set(item.date, list);
  }

  // Determine rotation pointer up to today
  const plan = params.activePlan?.data ?? null;
  const planId = params.activePlan?.id ?? null;
  const planStart = plan && params.activePlan?.updatedAt ? localDate(Date.parse(params.activePlan.updatedAt)) : null;
  const planEnd = plan && planStart ? addDaysIso(planStart, plan.weeks * 7 - 1) : null;
  let rotationIndex = 0;
  if (plan && plan.schedule === "rotation" && plan.routines.length) {
    const routineIds = new Set(plan.routines.map((r) => r.id));
    let lastPlanWorkout: Workout | undefined;
    for (const w of params.workouts) {
      if (w.status !== "completed" || w.date > params.todayDate || w.planId !== planId || !w.routineId || !routineIds.has(w.routineId)) continue;
      if (!lastPlanWorkout || compareWorkouts(lastPlanWorkout, w) < 0) lastPlanWorkout = w;
    }
    const prevIdx = lastPlanWorkout ? plan.routines.findIndex((r) => r.id === lastPlanWorkout.routineId) : -1;
    rotationIndex = prevIdx >= 0 ? (prevIdx + 1) % plan.routines.length : 0;
  }

  // Build candidate date list
  const dates: string[] = [];
  for (let d = params.from; d <= params.through; d = addDaysIso(d, 1)) dates.push(d);

  // Pre-compute planned slots per ISO week for rotation plans
  const rotationSlots = new Set<string>();
  if (plan && plan.schedule === "rotation") {
    const targetPerWeek = Math.max(1, Math.min(7, params.daysPerWeek ?? Math.min(4, Math.max(3, plan.routines.length))));
    const futureOrToday = dates.filter((d) => d >= params.todayDate);
    const byWeek = new Map<string, string[]>();
    for (const d of futureOrToday) {
      const mon = weekMonday(d);
      const arr = byWeek.get(mon) ?? [];
      arr.push(d);
      byWeek.set(mon, arr);
    }
    for (const [mon, weekFuture] of byWeek) {
      let existingThisWeek = 0;
      for (let offset = 0; offset < 7; offset++) {
        const day = addDaysIso(mon, offset);
        const manualDone = (completedByDate.get(day)?.length ?? 0) > 0;
        const appleDone = (appleByDate.get(day)?.length ?? 0) > 0;
        const override = params.scheduledDays.get(day);
        if (manualDone || appleDone || override?.mode === "workout") existingThisWeek++;
      }
      const candidates = weekFuture.filter((day) => {
        if ((completedByDate.get(day)?.length ?? 0) > 0 || (appleByDate.get(day)?.length ?? 0) > 0) return false;
        const ov = params.scheduledDays.get(day);
        return !ov;
      });
      const needed = Math.max(0, targetPerWeek - existingThisWeek);
      for (const picked of spreadIndicesInWeek(candidates, needed)) rotationSlots.add(picked);
    }
  }

  return dates.map((date): ProjectedScheduleDay => {
    const done = completedByDate.get(date) ?? [];
    const appleDone = appleByDate.get(date) ?? [];
    const totalDone = done.length + appleDone.length;
    if (date <= params.todayDate && totalDone > 0) {
      const lead = done[0]?.title ?? appleDone[0]?.plan?.name ?? appleDone[0]?.title ?? "已完成训练";
      return {
        date,
        status: "completed",
        source: "history",
        title: totalDone > 1 ? `${lead} 等 ${totalDone} 项` : lead,
        routineId: done[0]?.routineId ?? appleDone[0]?.plan?.routineId ?? null,
        planId: done[0]?.planId ?? null,
        templateId: null,
        notes: "",
        exercisesCount: done[0]?.exercises.length ?? 0,
        estimatedMinutes: 0,
        muscles: done[0] ? [...new Set(done[0].exercises.map((e) => (e.snapshot ?? byId.get(e.exerciseId))?.muscle).filter((m): m is Exercise["muscle"] => Boolean(m && m !== "cardio")))] : [],
        routine: null,
        workoutsCount: totalDone,
      };
    }

    const override = params.scheduledDays.get(date);
    if (override) {
      if (override.mode === "rest") {
        return {
          date,
          status: "rest",
          source: "rest",
          title: override.title || "主动恢复 · 休息日",
          routineId: null,
          planId: null,
          templateId: null,
          notes: override.notes,
          exercisesCount: 0,
          estimatedMinutes: 0,
          muscles: [],
          routine: null,
          workoutsCount: 0,
        };
      }
      const routine: Routine = {
        id: override.routineId ?? `schedule_${date}`,
        name: override.title || "自定义排期训练",
        exercises: override.exercises.length ? override.exercises : [],
      };
      return {
        date,
        status: "scheduled",
        source: "manual",
        title: routine.name,
        routineId: override.routineId,
        planId: override.planId,
        templateId: override.templateId,
        notes: override.notes,
        exercisesCount: routine.exercises.length,
        estimatedMinutes: routine.exercises.length ? estimateRoutineMinutes(routine) : 45,
        muscles: routineMuscles(routine, byId),
        routine: routine.exercises.length ? routine : null,
        workoutsCount: 0,
      };
    }

    if (plan && planId) {
      const start = planStart ?? date;
      const end = planEnd ?? addDaysIso(start, plan.weeks * 7 - 1);
      if (date >= start && date <= end) {
        if (plan.schedule === "weekdays") {
          const wd = isoWeekday(date);
          const idx = plan.weekdays.indexOf(wd);
          if (idx >= 0 && plan.routines[idx]) {
            const routine = plan.routines[idx]!;
            return {
              date,
              status: "projected",
              source: "plan",
              title: routine.name,
              routineId: routine.id,
              planId,
              templateId: null,
              notes: "",
              exercisesCount: routine.exercises.length,
              estimatedMinutes: estimateRoutineMinutes(routine),
              muscles: routineMuscles(routine, byId),
              routine,
              workoutsCount: 0,
            };
          }
          return {
            date,
            status: "rest",
            source: "plan",
            title: "计划休息日",
            routineId: null,
            planId,
            templateId: null,
            notes: "",
            exercisesCount: 0,
            estimatedMinutes: 0,
            muscles: [],
            routine: null,
            workoutsCount: 0,
          };
        }

        if (plan.schedule === "rotation" && rotationSlots.has(date) && plan.routines.length) {
          const routine = plan.routines[rotationIndex % plan.routines.length]!;
          rotationIndex++;
          return {
            date,
            status: "projected",
            source: "plan",
            title: routine.name,
            routineId: routine.id,
            planId,
            templateId: null,
            notes: "",
            exercisesCount: routine.exercises.length,
            estimatedMinutes: estimateRoutineMinutes(routine),
            muscles: routineMuscles(routine, byId),
            routine,
            workoutsCount: 0,
          };
        }
      }
    }

    return {
      date,
      status: date >= params.todayDate ? "rest" : "empty",
      source: "empty",
      title: date >= params.todayDate ? "未安排训练" : "未训练",
      routineId: null,
      planId: null,
      templateId: null,
      notes: "",
      exercisesCount: 0,
      estimatedMinutes: 0,
      muscles: [],
      routine: null,
      workoutsCount: 0,
    };
  });
}

/**
 * Forecast weekly muscle sets (completed + upcoming scheduled/projected) and adjacent-day muscle overlaps.
 */
export function projectWeekMuscleForecast(params: {
  anchorDate: string;
  days: readonly ProjectedScheduleDay[];
  workouts: readonly Workout[];
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>;
}) {
  const byId = toCatalogueMap(params.catalogue);
  const mon = weekMonday(params.anchorDate);
  const sun = addDaysIso(mon, 6);
  const completedSets: Record<string, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
  const plannedSets: Record<string, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
  const dayMuscles = new Map<string, Set<string>>();

  for (const workout of params.workouts) {
    if (workout.status !== "completed" || workout.date < mon || workout.date > sun) continue;
    const set = dayMuscles.get(workout.date) ?? new Set<string>();
    for (const row of workout.exercises) {
      const ex = row.snapshot ?? byId.get(row.exerciseId);
      const count = row.sets.filter((s) => isValidWorkSet(s, ex?.mode)).length;
      if (count > 0 && ex && ex.muscle in completedSets) {
        completedSets[ex.muscle]! += count;
        set.add(ex.muscle);
      }
    }
    dayMuscles.set(workout.date, set);
  }

  for (const day of params.days) {
    if (day.date < mon || day.date > sun) continue;
    if ((day.status === "scheduled" || day.status === "projected") && day.routine) {
      const set = dayMuscles.get(day.date) ?? new Set<string>();
      for (const row of day.routine.exercises) {
        const ex = byId.get(row.exerciseId);
        if (ex && ex.muscle in plannedSets) {
          plannedSets[ex.muscle]! += row.sets;
          set.add(ex.muscle);
        }
      }
      dayMuscles.set(day.date, set);
    }
  }

  const prevDate = addDaysIso(params.anchorDate, -1);
  const nextDate = addDaysIso(params.anchorDate, 1);
  const targetDay = params.days.find((d) => d.date === params.anchorDate);
  const targetMuscles = new Set(targetDay?.muscles ?? []);
  const conflicts: string[] = [];
  if (targetMuscles.size) {
    const prevMuscles = dayMuscles.get(prevDate);
    const nextMuscles = dayMuscles.get(nextDate);
    const overlapPrev = prevMuscles ? [...targetMuscles].filter((m) => prevMuscles.has(m)) : [];
    const overlapNext = nextMuscles ? [...targetMuscles].filter((m) => nextMuscles.has(m)) : [];
    if (overlapPrev.length) conflicts.push(`与前一日（${prevDate.slice(5)}）存在连续同肌群负荷`);
    if (overlapNext.length) conflicts.push(`与次日（${nextDate.slice(5)}）存在连续同肌群负荷`);
  }

  return {
    weekStart: mon,
    weekEnd: sun,
    muscles: Object.keys(completedSets).map((muscle) => ({
      key: muscle,
      completed: completedSets[muscle]!,
      planned: plannedSets[muscle]!,
      total: completedSets[muscle]! + plannedSets[muscle]!,
    })),
    conflicts,
  };
}

/**
 * Resolve concrete exercise targets + progression reports + PR opportunities for a routine on a date.
 */
export function resolveRoutineWithTelemetry(params: {
  routine: Routine;
  planId: string | null;
  date: string;
  workouts: readonly Workout[];
  catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>;
}) {
  const byId = toCatalogueMap(params.catalogue);
  const history = params.workouts
    .filter((w) => w.status === "completed" && w.date <= params.date)
    .sort((a, b) => compareWorkouts(b, a));
  const previousRoutine = history.find((w) => w.routineId === params.routine.id && w.planId === params.planId);
  const baselines = exercisePrBaselines(
    history.map((data) => ({ data })),
    byId,
    { date: params.date },
    new Set(params.routine.exercises.map((e) => e.exerciseId)),
  );

  const exercises = params.routine.exercises.map((item, index) => {
    const exercise = byId.get(item.exerciseId);
    const mode: Exercise["mode"] = exercise?.mode ?? "reps";
    const matches = (row: Workout["exercises"][number]) =>
      row.exerciseId === item.exerciseId && (!mode || !row.snapshot || row.snapshot.mode === mode);
    const matchingRows = previousRoutine?.exercises.filter(matches) ?? [];
    const previousRow = matchingRows.find((r) => r.targetIndex === index) ?? (matchingRows.length === 1 ? matchingRows[0] : undefined);
    const previousTarget = previousRoutine?.targetSnapshot?.exercises[index];
    const prescribedChanged = item.weight !== null && (previousTarget?.exerciseId !== item.exerciseId || previousTarget.weight !== item.weight);
    const recentSameExercise: { feeling: Workout["feeling"]; row: Workout["exercises"][number] }[] = [];
    for (const w of history) {
      const r = w.exercises.find(matches);
      if (r) recentSameExercise.push({ feeling: w.feeling, row: r });
      if (recentSameExercise.length >= 3) break;
    }
    const historicalRow = recentSameExercise[0]?.row;

    const progression = evaluateExerciseProgression(item, previousRow, historicalRow, recentSameExercise, mode, prescribedChanged);
    const baseline = baselines.get(baselineKey(item.exerciseId, mode));
    const pr = prOpportunityForTarget(
      { weight: progression.weight, reps: mode === "timed" ? 0 : progression.reps, seconds: item.seconds },
      mode,
      baseline,
    );
    const backup = item.backupExerciseId ? byId.get(item.backupExerciseId) ?? null : null;

    return {
      item,
      exercise: exercise ?? null,
      weight: progression.weight,
      reps: mode === "timed" ? 0 : progression.reps,
      seconds: item.seconds,
      progression,
      baseline: baseline ?? null,
      pr,
      backup: backup ? { id: backup.id, name: backup.name } : null,
    };
  });

  return {
    exercises,
    summary: {
      progressionCount: exercises.filter((e) => e.progression.status === "progress_weight" || e.progression.status === "progress_reps").length,
      deloadCount: exercises.filter((e) => e.progression.status === "plateau_deload").length,
      prOpportunityCount: exercises.filter((e) => e.pr && e.pr.kind !== "baseline").length,
      estimatedMinutes: estimateRoutineMinutes(params.routine),
      muscles: routineMuscles(params.routine, byId),
    },
  };
}
