import {
  estimated1RM,
  kgToUnit,
  weightToKg,
  type ExerciseMode,
  type ExerciseReferenceSet,
  type PlannedExercise,
  type WeightUnit,
  type WorkoutExercise,
  type WorkoutSet,
} from "./domain";

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

export type SetOverloadCueTone = "pr" | "overload" | "same" | "down";

export interface SetOverloadCue {
  tone: SetOverloadCueTone;
  badge: string;
  detail: string;
  isPr: boolean;
}

function fmtDeltaNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Produce a concise, sports-science-grounded inline cue when a completed working set
 * exceeds either all-time PR baselines or the previous session's corresponding set.
 */
export function describeSetOverloadCue(
  set: Pick<WorkoutSet, "type" | "completed" | "weight" | "reps" | "seconds">,
  ref: ExerciseReferenceSet | null | undefined,
  mode: ExerciseMode,
  weightUnit: WeightUnit | undefined,
  baseline: LiveExercisePrBaseline | null | undefined,
): SetOverloadCue | null {
  if (!set.completed || set.type === "warmup") return null;
  const unit: WeightUnit = weightUnit ?? "kg";

  // 1. All-time PR beats highest priority
  const prKind = checkSetBeatsPrBaseline(set, mode, weightUnit, baseline);
  if (prKind && baseline) {
    if (prKind === "weight") {
      const prevInUnit = baseline.weight != null ? kgToUnit(baseline.weight, unit) : 0;
      const diff = prevInUnit > 0 ? set.weight - prevInUnit : 0;
      return {
        tone: "pr",
        isPr: true,
        badge: diff > 0 ? `🏆 新绝对负重 PR · +${fmtDeltaNum(diff)} ${unit}` : `🏆 新绝对负重 PR · ${fmtDeltaNum(set.weight)} ${unit}`,
        detail: "刷新历史单组最高负重纪录",
      };
    }
    if (prKind === "oneRepMax") {
      const wKg = weightToKg(set.weight, unit);
      const e1rm = Math.round(estimated1RM(wKg, set.reps) * 10) / 10;
      const diff = baseline.oneRepMax != null ? e1rm - baseline.oneRepMax : 0;
      return {
        tone: "pr",
        isPr: true,
        badge: diff > 0 ? `🏆 新估算 1RM 纪录 · ${fmtDeltaNum(e1rm)} kg (+${fmtDeltaNum(diff)})` : `🏆 新估算 1RM 纪录 · ${fmtDeltaNum(e1rm)} kg`,
        detail: "Epley 估算单次极限力量创历史新高",
      };
    }
    if (prKind === "hold") {
      const diff = baseline.hold != null ? set.seconds - baseline.hold : 0;
      return {
        tone: "pr",
        isPr: true,
        badge: diff > 0 ? `🏆 新等长耐力 PR · +${Math.round(diff)}s` : `🏆 新等长耐力 PR · ${set.seconds}s`,
        detail: "刷新单组最长保持时间纪录",
      };
    }
    if (prKind === "assistance") {
      const prevInUnit = baseline.assistance != null ? kgToUnit(baseline.assistance, unit) : 0;
      const diff = prevInUnit > 0 ? prevInUnit - set.weight : 0;
      return {
        tone: "pr",
        isPr: true,
        badge: diff > 0 ? `🏆 新最小辅助 PR · -${fmtDeltaNum(diff)} ${unit}` : `🏆 新最小辅助 PR · ${fmtDeltaNum(set.weight)} ${unit}`,
        detail: "刷新最低辅助重量纪录",
      };
    }
  }

  // 2. Progressive overload vs last session's corresponding set
  if (!ref) return null;
  if (mode === "timed") {
    if (set.seconds <= 0 || ref.seconds <= 0) return null;
    const diff = set.seconds - ref.seconds;
    if (diff > 0) {
      return {
        tone: "overload",
        isPr: false,
        badge: `↗ 等长耐力超负荷 · +${Math.round(diff)}s`,
        detail: `较上次同组延长 ${Math.round(diff)} 秒`,
      };
    }
    if (diff === 0) return { tone: "same", isPr: false, badge: "= 与上次同组持平", detail: "与上次同组保持一致" };
    return { tone: "down", isPr: false, badge: `↓ 较上次 -${Math.abs(Math.round(diff))}s`, detail: "较上次同组略短" };
  }

  if (mode === "assisted") {
    if (set.reps <= 0 || ref.reps <= 0) return null;
    if (set.weight < ref.weight) {
      const diff = ref.weight - set.weight;
      return {
        tone: "overload",
        isPr: false,
        badge: `↗ 减辅助超负荷 · -${fmtDeltaNum(diff)} ${unit}`,
        detail: `减少辅助 ${fmtDeltaNum(diff)} ${unit}，净自重负荷提升`,
      };
    }
    if (set.weight === ref.weight && set.reps > ref.reps) {
      const repDiff = set.reps - ref.reps;
      return {
        tone: "overload",
        isPr: false,
        badge: `↗ 容量超负荷 · +${repDiff} 次`,
        detail: `同辅助下多完成 ${repDiff} 次`,
      };
    }
    if (set.weight === ref.weight && set.reps === ref.reps) {
      return { tone: "same", isPr: false, badge: "= 与上次同组持平", detail: "与上次同组保持一致" };
    }
    return { tone: "down", isPr: false, badge: "↓ 较上次略降", detail: "较上次同组负荷略低" };
  }

  if (set.reps <= 0 || ref.reps <= 0) return null;
  const wDiff = set.weight - ref.weight;
  const repDiff = set.reps - ref.reps;
  if (wDiff > 0) {
    return {
      tone: "overload",
      isPr: false,
      badge: `↗ 负荷超负荷 · +${fmtDeltaNum(wDiff)} ${unit}`,
      detail: `较上次同组负重提升 ${fmtDeltaNum(wDiff)} ${unit}（机械张力提升）`,
    };
  }
  if (wDiff === 0 && repDiff > 0) {
    return {
      tone: "overload",
      isPr: false,
      badge: `↗ 容量超负荷 · +${repDiff} 次`,
      detail: `同负重下多完成 ${repDiff} 次（有效做功提升）`,
    };
  }
  const curVol = set.weight * set.reps;
  const refVol = ref.weight * ref.reps;
  if (curVol > refVol && refVol > 0) {
    return {
      tone: "overload",
      isPr: false,
      badge: `↗ 单组容量超负荷 · +${Math.round(curVol - refVol)} ${unit}`,
      detail: `单组总做功较上次提升 ${Math.round(curVol - refVol)} ${unit}`,
    };
  }
  if (wDiff === 0 && repDiff === 0) {
    return { tone: "same", isPr: false, badge: "= 与上次同组持平", detail: "与上次同组保持一致" };
  }
  return { tone: "down", isPr: false, badge: "↓ 较上次略降", detail: "较上次同组负荷或次数略低" };
}

export interface ExerciseBenchmarkSummary {
  hasAny: boolean;
  lastTopLabel: string;
  lastTopValue: string;
  lastSummary: string;
  bestWeightLabel: string;
  bestWeightValue: string;
  thirdLabel: string;
  thirdValue: string;
  lastTotalVolumeKg: number;
}

/**
 * Compute openGym-style 3-cell benchmark metrics for the top of an exercise card.
 */
export function summarizeExerciseBenchmarks(
  validRefs: readonly ExerciseReferenceSet[],
  baseline: LiveExercisePrBaseline | null | undefined,
  mode: ExerciseMode,
  weightUnit: WeightUnit | undefined,
  volumeMultiplier = 1,
): ExerciseBenchmarkSummary {
  const unit: WeightUnit = weightUnit ?? "kg";
  const mult = volumeMultiplier > 0 ? volumeMultiplier : 1;

  if (!validRefs.length && !baseline) {
    return {
      hasAny: false,
      lastTopLabel: "上次顶组",
      lastTopValue: "—",
      lastSummary: "",
      bestWeightLabel: "历史最高",
      bestWeightValue: "—",
      thirdLabel: "估算 1RM",
      thirdValue: "—",
      lastTotalVolumeKg: 0,
    };
  }

  if (mode === "timed") {
    const topSec = validRefs.length ? Math.max(...validRefs.map((r) => r.seconds || 0)) : 0;
    const totalSec = validRefs.reduce((sum, r) => sum + (r.seconds || 0), 0);
    return {
      hasAny: true,
      lastTopLabel: "上次最长",
      lastTopValue: topSec > 0 ? `${topSec}s` : "—",
      lastSummary: validRefs.slice(0, 4).map((r) => `${r.seconds}s`).join(" · "),
      bestWeightLabel: "历史纪录",
      bestWeightValue: baseline?.hold != null && baseline.hold > 0 ? `${baseline.hold}s` : topSec > 0 ? `${topSec}s` : "—",
      thirdLabel: "上次总计时",
      thirdValue: totalSec > 0 ? `${totalSec}s` : "—",
      lastTotalVolumeKg: 0,
    };
  }

  if (mode === "assisted") {
    const bestLast = validRefs.length
      ? validRefs.reduce((best, cur) =>
          cur.weight < best.weight || (cur.weight === best.weight && cur.reps > best.reps) ? cur : best,
        )
      : null;
    const totalReps = validRefs.reduce((sum, r) => sum + (r.reps || 0), 0);
    const minAssist =
      baseline?.assistance != null ? kgToUnit(baseline.assistance, unit) : bestLast ? bestLast.weight : null;
    return {
      hasAny: true,
      lastTopLabel: "上次最轻辅助",
      lastTopValue: bestLast ? `${fmtDeltaNum(bestLast.weight)} ${unit} × ${bestLast.reps}` : "—",
      lastSummary: validRefs.slice(0, 4).map((r) => `${r.weight}×${r.reps}`).join(" · "),
      bestWeightLabel: "历史最小辅助",
      bestWeightValue: minAssist != null ? `${fmtDeltaNum(minAssist)} ${unit}` : "—",
      thirdLabel: "上次总次数",
      thirdValue: totalReps > 0 ? `${totalReps} 次` : "—",
      lastTotalVolumeKg: 0,
    };
  }

  const bestLast = validRefs.length
    ? validRefs.reduce((best, cur) =>
        cur.weight > best.weight || (cur.weight === best.weight && cur.reps > best.reps) ? cur : best,
      )
    : null;
  const lastBestE1rm = validRefs.length
    ? Math.max(0, ...validRefs.map((r) => estimated1RM(weightToKg(r.weight, unit), r.reps)))
    : 0;
  const lastTotalVolumeKg = validRefs.reduce(
    (sum, r) => sum + weightToKg(r.weight, unit) * (r.reps || 0) * mult,
    0,
  );
  const prWeightInUnit =
    baseline?.weight != null && baseline.weight > 0
      ? kgToUnit(baseline.weight, unit)
      : bestLast && bestLast.weight > 0
        ? bestLast.weight
        : 0;
  const prE1rmKg =
    baseline?.oneRepMax != null && baseline.oneRepMax > 0 ? baseline.oneRepMax : lastBestE1rm;

  return {
    hasAny: true,
    lastTopLabel: "上次顶组",
    lastTopValue: bestLast
      ? bestLast.weight > 0
        ? `${fmtDeltaNum(bestLast.weight)} ${unit} × ${bestLast.reps}`
        : `徒手 × ${bestLast.reps}`
      : "—",
    lastSummary: validRefs
      .slice(0, 4)
      .map((r) => (r.weight > 0 ? `${r.weight}×${r.reps}` : `${r.reps}次`))
      .join(" · "),
    bestWeightLabel: "历史最高",
    bestWeightValue: prWeightInUnit > 0 ? `${fmtDeltaNum(prWeightInUnit)} ${unit}` : "—",
    thirdLabel: "估算 1RM",
    thirdValue: prE1rmKg > 0 ? `${fmtDeltaNum(prE1rmKg)} kg` : "—",
    lastTotalVolumeKg: Math.round(lastTotalVolumeKg),
  };
}

export interface WorkoutSourceDiff {
  hasChanges: boolean;
  summary: string;
  addedCount: number;
  removedCount: number;
  swappedCount: number;
  reordered: boolean;
  structureAdjustCount: number;
}

/**
 * Diff a live workout's exercise list against its originating plan routine or template snapshot
 * (`targetSnapshot.exercises`), so the Finish Panel can offer a safe opt-in sync back to source.
 */
export function diffWorkoutAgainstSourceRoutine(
  exercises: readonly WorkoutExercise[],
  targetSnapshot: unknown,
): WorkoutSourceDiff {
  const empty: WorkoutSourceDiff = {
    hasChanges: false,
    summary: "",
    addedCount: 0,
    removedCount: 0,
    swappedCount: 0,
    reordered: false,
    structureAdjustCount: 0,
  };
  if (!targetSnapshot || typeof targetSnapshot !== "object") return empty;
  const srcList = (targetSnapshot as { exercises?: PlannedExercise[] }).exercises;
  if (!Array.isArray(srcList) || !srcList.length || !exercises.length) return empty;

  const srcIds = srcList.map((e) => e.exerciseId);
  const curIds = exercises.map((e) => e.exerciseId);

  const srcCounts = new Map<string, number>();
  for (const id of srcIds) srcCounts.set(id, (srcCounts.get(id) ?? 0) + 1);
  const curCounts = new Map<string, number>();
  for (const id of curIds) curCounts.set(id, (curCounts.get(id) ?? 0) + 1);

  let rawAdded = 0;
  let rawRemoved = 0;
  for (const [id, c] of curCounts) {
    const s = srcCounts.get(id) ?? 0;
    if (c > s) rawAdded += c - s;
  }
  for (const [id, s] of srcCounts) {
    const c = curCounts.get(id) ?? 0;
    if (s > c) rawRemoved += s - c;
  }
  const swappedCount = Math.min(rawAdded, rawRemoved);
  const addedCount = rawAdded - swappedCount;
  const removedCount = rawRemoved - swappedCount;
  const reordered =
    swappedCount === 0 &&
    addedCount === 0 &&
    removedCount === 0 &&
    srcIds.some((id, idx) => curIds[idx] !== id);

  let structureAdjustCount = 0;
  const usedSrc = new Set<number>();
  for (const row of exercises) {
    let matchIdx = -1;
    if (
      row.targetIndex != null &&
      !usedSrc.has(row.targetIndex) &&
      srcList[row.targetIndex]?.exerciseId === row.exerciseId
    ) {
      matchIdx = row.targetIndex;
    } else {
      matchIdx = srcList.findIndex((item, idx) => !usedSrc.has(idx) && item.exerciseId === row.exerciseId);
    }
    if (matchIdx < 0) continue;
    usedSrc.add(matchIdx);
    const src = srcList[matchIdx]!;
    const nonWarmupSets = row.sets.filter((s) => s.type !== "warmup").length || row.sets.length;
    const setsChanged = nonWarmupSets !== src.sets;
    const restChanged = Math.round(row.restSeconds ?? 90) !== Math.round(src.restSeconds ?? 90);
    const unitChanged = (row.weightUnit ?? "kg") !== (src.weightUnit ?? "kg");
    const ssChanged = (row.supersetGroup?.trim() || null) !== (src.supersetGroup?.trim() || null);
    if (setsChanged || restChanged || unitChanged || ssChanged) {
      structureAdjustCount++;
    }
  }

  const parts: string[] = [];
  if (swappedCount > 0) parts.push(`替换 ${swappedCount} 个动作`);
  if (addedCount > 0) parts.push(`新增 ${addedCount} 个动作`);
  if (removedCount > 0) parts.push(`移除 ${removedCount} 个动作`);
  if (reordered) parts.push("调整动作顺序");
  if (structureAdjustCount > 0) parts.push(`调整 ${structureAdjustCount} 处组数/休息`);

  return {
    hasChanges: parts.length > 0,
    summary: parts.join(" · "),
    addedCount,
    removedCount,
    swappedCount,
    reordered,
    structureAdjustCount,
  };
}
