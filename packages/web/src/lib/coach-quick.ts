import type { PlannedExercise, WorkoutExercise, WorkoutSet } from "./domain";

export type CoachQuickScenario = "pain" | "occupied" | "time" | "great";

export interface CoachQuickOption {
  id: CoachQuickScenario;
  label: string;
  subtitle: string;
}

export const COACH_QUICK_SCENARIOS: readonly CoachQuickOption[] = [
  { id: "pain", label: "部位发紧 / 微痛", subtitle: "立刻降重减压或切换备选动作" },
  { id: "occupied", label: "器械被占", subtitle: "优先切备选动作或重新挑同肌群替代" },
  { id: "time", label: "时间不够", subtitle: "浓缩剩余组数并缩短组间休息" },
  { id: "great", label: "状态极佳", subtitle: "小幅加量或追加 1 组冲刺" },
] as const;

export interface CoachQuickAdvice {
  scenario: CoachQuickScenario;
  headline: string;
  rationale: string;
  actionLabel: string;
  actionKind: "apply_sets" | "swap_backup" | "open_swap";
  apply?: (row: WorkoutExercise, step: number) => WorkoutExercise;
}

function roundStep(val: number, step: number): number {
  const s = step > 0 ? step : 2.5;
  return Math.max(0, Math.round(val / s) * s);
}

/**
 * Generates an immediate, safe, deterministic coaching adjustment for the current exercise
 * (usable offline or when AI API key is not configured, and paired with AI adapt modal when available).
 */
export function buildCoachQuickAdvice(
  scenario: CoachQuickScenario,
  row: WorkoutExercise,
  weightStep = 2.5,
): CoachQuickAdvice {
  const name = row.snapshot?.name ?? row.exerciseId;
  const unit = row.weightUnit ?? "kg";
  const step = unit === "lb" ? 5 : weightStep;
  const pendingCount = row.sets.filter((s) => !s.completed && s.type !== "warmup").length;
  const mode = row.snapshot?.mode ?? "reps";

  if (scenario === "pain") {
    if (row.backupExerciseId) {
      return {
        scenario,
        headline: `建议先停做「${name}」，改用备选动作`,
        rationale: `检测到你已预设「${row.backupExerciseName || "备选动作"}」，遇到发紧或关节不适时优先切换无痛轨道动作最稳妥。`,
        actionLabel: `一键切换：${row.backupExerciseName || "备选动作"}`,
        actionKind: "swap_backup",
      };
    }
    return {
      scenario,
      headline: `建议对「${name}」减重 15% 并放慢离心`,
      rationale:
        pendingCount > 0
          ? `把剩余 ${pendingCount} 组重量下调约 15%、组间休息延长 30 秒，专注无痛全程控制；如仍不适请直接替换动作。`
          : "当前动作已无待做组，建议直接记录组备注并下次训练前充分热身。",
      actionLabel: "应用：待做组减重 15% + 休息 +30s",
      actionKind: "apply_sets",
      apply: (cur, st) => ({
        ...cur,
        restSeconds: Math.min(300, (cur.restSeconds ?? 90) + 30),
        sets: cur.sets.map((s) => {
          if (s.completed || s.type === "warmup" || mode === "timed") return s;
          return {
            ...s,
            weight: roundStep(s.weight * 0.85, st),
            note: s.note ? s.note : "发紧减载控制",
          };
        }),
      }),
    };
  }

  if (scenario === "occupied") {
    if (row.backupExerciseId) {
      return {
        scenario,
        headline: `器械被占 · 立刻切到「${row.backupExerciseName || "预设备选动作"}」`,
        rationale: "使用预设备选动作可直接带出该动作的历史参考重量，不打断训练节奏。",
        actionLabel: `一键切换备选`,
        actionKind: "swap_backup",
      };
    }
    return {
      scenario,
      headline: `器械被占 · 换同肌群等价动作`,
      rationale: "打开动作替换选择器，挑一个空闲的同肌群动作，系统会自动匹配该动作的历史重量。",
      actionLabel: "打开替换动作列表",
      actionKind: "open_swap",
    };
  }

  if (scenario === "time") {
    return {
      scenario,
      headline: `时间紧张 · 浓缩「${name}」剩余组数`,
      rationale:
        pendingCount > 2
          ? `保留最多 2 组高刺激待做组，并将组间休息压缩至 60 秒，保住核心刺激又省时间。`
          : "将组间休息压缩至 60 秒，快速完成剩余有效组。",
      actionLabel: pendingCount > 2 ? "应用：保留 2 组待做 + 休 60s" : "应用：组间休 60s",
      actionKind: "apply_sets",
      apply: (cur) => {
        let keptPending = 0;
        const trimmed = cur.sets.filter((s) => {
          if (s.completed || s.type === "warmup") return true;
          keptPending++;
          return keptPending <= 2;
        });
        return {
          ...cur,
          restSeconds: Math.min(cur.restSeconds ?? 90, 60),
          sets: trimmed.length ? trimmed : cur.sets,
        };
      },
    };
  }

  // scenario === "great"
  return {
    scenario,
    headline: `状态极佳 · 稳妥加量冲刺`,
    rationale:
      pendingCount > 0
        ? `把未完成工作组增加 +${step} ${unit}（自重/计时动作则追加 1 组），同时保持动作标准不借力。`
        : `为「${name}」追加 1 组冲刺工作组，锁定今天的好状态。`,
    actionLabel: pendingCount > 0 && mode === "reps" ? `应用：待做组 +${step} ${unit}` : "应用：追加 1 组冲刺",
    actionKind: "apply_sets",
    apply: (cur, st) => {
      const hasPending = cur.sets.some((s) => !s.completed && s.type !== "warmup");
      if (hasPending && mode === "reps") {
        return {
          ...cur,
          sets: cur.sets.map((s) => {
            if (s.completed || s.type === "warmup") return s;
            return { ...s, weight: Math.round((s.weight + st) * 100) / 100 };
          }),
        };
      }
      const last = cur.sets.at(-1);
      const bonus: WorkoutSet = {
        id: `bonus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        type: "normal",
        weight: last?.weight ?? 0,
        reps: last?.reps ?? 8,
        seconds: last?.seconds ?? (mode === "timed" ? 30 : 0),
        completed: false,
        rir: null,
        note: "状态佳加练组",
      };
      return { ...cur, sets: [...cur.sets, bonus] };
    },
  };
}

/**
 * Append planned exercises from another routine/template onto an existing workout exercise list,
 * generating fresh unique IDs without touching any existing completed sets.
 */
export function appendRoutineExercises(
  existing: WorkoutExercise[],
  routineExercises: PlannedExercise[],
  resolveSnapshot: (exerciseId: string) => WorkoutExercise["snapshot"],
  makeId: () => string,
): WorkoutExercise[] {
  const appended: WorkoutExercise[] = routineExercises.map((pe) => {
    const snap = resolveSnapshot(pe.exerciseId);
    const count = Math.max(1, Math.min(20, pe.sets || 3));
    const sets: WorkoutSet[] = Array.from({ length: count }, () => ({
      id: makeId(),
      type: "normal",
      weight: pe.weight ?? 0,
      reps: snap?.mode === "timed" ? 0 : (pe.repsMin || 8),
      seconds: snap?.mode === "timed" ? Math.max(10, pe.seconds || 30) : 0,
      completed: false,
      rir: null,
    }));
    return {
      id: makeId(),
      exerciseId: pe.exerciseId,
      supersetGroup: pe.supersetGroup ?? null,
      ...(pe.weightUnit ? { weightUnit: pe.weightUnit } : {}),
      restSeconds: pe.restSeconds ?? 90,
      snapshot: snap,
      backupExerciseId: pe.backupExerciseId ?? null,
      sets,
    };
  });
  return [...existing, ...appended];
}
