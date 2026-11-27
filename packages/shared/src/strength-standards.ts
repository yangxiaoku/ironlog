export type StrengthTierKey = "untrained" | "novice" | "intermediate" | "advanced" | "elite";

export interface StrengthStandardEntry {
  key: "squat" | "bench" | "deadlift" | "ohp" | "row";
  label: string;
  oneRepMaxKg: number;
  ratioToBw: number;
  tier: StrengthTierKey;
  tierLabel: string;
  nextTierLabel: string | null;
  nextTierKg: number | null;
  progressPct: number;
}

export interface StructuralBalanceItem {
  id: string;
  label: string;
  framework: "poliquin" | "powerlifting";
  numeratorLabel: string;
  denominatorLabel: string;
  actualRatio: number;
  targetMin: number;
  targetMax: number;
  idealRatio: number;
  status: "weak" | "balanced" | "strong";
  statusLabel: string;
  advice: string;
}

export interface StructuralBalanceReport {
  ratios: StructuralBalanceItem[];
  summary: string;
}

export const LIFT_ID_GROUPS = {
  bench: ["bench-press", "exdb_0025"],
  squat: ["squat", "exdb_3593", "exdb_0043"],
  deadlift: ["exdb_0032", "exdb_0117", "deadlift"],
  ohp: ["overhead-press", "exdb_0091", "exdb_0405", "exdb_0426"],
  row: ["barbell-row", "exdb_0027", "exdb_0028", "exdb_0073", "pull-up", "exdb_0652"],
} as const;

const LIFT_LABELS: Record<keyof typeof LIFT_ID_GROUPS, string> = {
  squat: "杠铃深蹲",
  bench: "平板卧推",
  deadlift: "硬拉",
  ohp: "站姿推举",
  row: "划船 / 引体",
};

// Male / Female bodyweight multiplier cutoffs: [novice, intermediate, advanced, elite]
const MALE_THRESHOLDS: Record<keyof typeof LIFT_ID_GROUPS, readonly [number, number, number, number]> = {
  squat: [1.0, 1.5, 2.0, 2.5],
  bench: [0.75, 1.15, 1.5, 1.9],
  deadlift: [1.25, 1.75, 2.25, 2.75],
  ohp: [0.5, 0.75, 1.0, 1.25],
  row: [0.65, 0.95, 1.25, 1.55],
};

const FEMALE_THRESHOLDS: Record<keyof typeof LIFT_ID_GROUPS, readonly [number, number, number, number]> = {
  squat: [0.7, 1.1, 1.5, 1.9],
  bench: [0.45, 0.75, 1.0, 1.3],
  deadlift: [0.9, 1.3, 1.75, 2.2],
  ohp: [0.32, 0.5, 0.7, 0.9],
  row: [0.45, 0.7, 0.95, 1.2],
};

const TIER_META: ReadonlyArray<{ key: StrengthTierKey; label: string }> = [
  { key: "untrained", label: "入门" },
  { key: "novice", label: "初级" },
  { key: "intermediate", label: "进阶" },
  { key: "advanced", label: "熟练" },
  { key: "elite", label: "精英" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function resolveBestLift(
  best1RMById: ReadonlyMap<string, number> | Record<string, number>,
  ids: readonly string[],
): number {
  const isMap = best1RMById instanceof Map;
  const record = isMap ? null : (best1RMById as Record<string, number>);
  let best = 0;
  for (const id of ids) {
    const val = isMap ? (best1RMById.get(id) ?? 0) : (record?.[id] ?? 0);
    if (Number.isFinite(val) && val > best) best = val;
  }
  return round1(best);
}

/**
 * Classify user's relative strength tier across core compound lifts based on bodyweight and sex.
 */
export function evaluateStrengthStandards(
  best1RMById: ReadonlyMap<string, number> | Record<string, number>,
  bodyweightKg: number | null | undefined,
  sex: "male" | "female" = "male",
): StrengthStandardEntry[] {
  const bw = Number(bodyweightKg);
  if (!Number.isFinite(bw) || bw < 30 || bw > 250) return [];
  const table = sex === "female" ? FEMALE_THRESHOLDS : MALE_THRESHOLDS;
  const order: Array<keyof typeof LIFT_ID_GROUPS> = ["squat", "bench", "deadlift", "ohp", "row"];
  const results: StrengthStandardEntry[] = [];

  for (const key of order) {
    const max1rm = resolveBestLift(best1RMById, LIFT_ID_GROUPS[key]);
    if (max1rm <= 0) continue;
    // #129: Evaluate tier thresholds against unrounded ratio so 0.99625x does not prematurely round up to 1.00x.
    const rawRatio = max1rm / bw;
    const ratio = round2(rawRatio);
    const cuts = table[key];
    let tierIdx = 0;
    for (let i = 0; i < cuts.length; i++) {
      if (rawRatio >= cuts[i]!) tierIdx = i + 1;
    }
    const tierInfo = TIER_META[tierIdx]!;
    const nextCut = tierIdx < cuts.length ? cuts[tierIdx]! : null;
    const prevCut = tierIdx > 0 ? cuts[tierIdx - 1]! : 0;
    const nextTierInfo = tierIdx + 1 < TIER_META.length ? TIER_META[tierIdx + 1]! : null;
    const nextTierKg = nextCut != null ? round1(nextCut * bw) : null;
    const progressPct =
      nextCut != null
        ? Math.max(0, Math.min(100, Math.round(((ratio - prevCut) / Math.max(0.05, nextCut - prevCut)) * 100)))
        : 100;

    results.push({
      key,
      label: LIFT_LABELS[key],
      oneRepMaxKg: max1rm,
      ratioToBw: ratio,
      tier: tierInfo.key,
      tierLabel: tierInfo.label,
      nextTierLabel: nextTierInfo?.label ?? null,
      nextTierKg,
      progressPct,
    });
  }
  return results;
}

/**
 * Evaluate Poliquin & Powerlifting structural balance ratios from estimated 1RM values.
 */
export function evaluateStructuralBalance(
  best1RMById: ReadonlyMap<string, number> | Record<string, number>,
): StructuralBalanceReport {
  const bench = resolveBestLift(best1RMById, LIFT_ID_GROUPS.bench);
  const squat = resolveBestLift(best1RMById, LIFT_ID_GROUPS.squat);
  const deadlift = resolveBestLift(best1RMById, LIFT_ID_GROUPS.deadlift);
  const ohp = resolveBestLift(best1RMById, LIFT_ID_GROUPS.ohp);
  const row = resolveBestLift(best1RMById, LIFT_ID_GROUPS.row);

  const specs: Array<{
    id: string;
    label: string;
    framework: "poliquin" | "powerlifting";
    num: number;
    den: number;
    numLabel: string;
    denLabel: string;
    min: number;
    max: number;
    ideal: number;
    weakAdvice: string;
    strongAdvice: string;
  }> = [
    {
      id: "ohp_to_bench",
      label: "推举 / 卧推（Poliquin 上肢垂直推）",
      framework: "poliquin",
      num: ohp,
      den: bench,
      numLabel: "推举",
      denLabel: "卧推",
      min: 0.6,
      max: 0.72,
      ideal: 0.66,
      weakAdvice: "过头推举相对卧推偏弱，建议加强站姿推举、上斜推与肩袖外旋稳定性。",
      strongAdvice: "过头推举占优，可适度提升水平推（平板/哑铃卧推）容量。",
    },
    {
      id: "row_to_bench",
      label: "划船 / 卧推（Poliquin 前后链推拉平衡）",
      framework: "poliquin",
      num: row,
      den: bench,
      numLabel: "划船/引体",
      denLabel: "卧推",
      min: 0.8,
      max: 1.0,
      ideal: 0.9,
      weakAdvice: "上背拉动力量落后于卧推，容易圆肩或肩峰夹挤，建议拉推组数比提升至 1.2:1。",
      strongAdvice: "背部拉动基础扎实，前后链平衡极佳。",
    },
    {
      id: "squat_to_bench",
      label: "深蹲 / 卧推（上下肢核心力量比）",
      framework: "powerlifting",
      num: squat,
      den: bench,
      numLabel: "深蹲",
      denLabel: "卧推",
      min: 1.25,
      max: 1.5,
      ideal: 1.35,
      weakAdvice: "下肢深蹲相对卧推偏弱，建议每周保障 2 次下肢复合刺激（深蹲/腿举）。",
      strongAdvice: "下肢力量突出，可针对性补强卧推与上肢推举技术。",
    },
    {
      id: "deadlift_to_squat",
      label: "硬拉 / 深蹲（前后链铰链比例）",
      framework: "powerlifting",
      num: deadlift,
      den: squat,
      numLabel: "硬拉",
      denLabel: "深蹲",
      min: 1.15,
      max: 1.35,
      ideal: 1.25,
      weakAdvice: "髋铰链与后链（臀腿/竖脊肌）相对深蹲偏弱，可加练罗马尼亚硬拉与腿弯举。",
      strongAdvice: "后链拉动强劲，可适度强化股四头肌与前蹲以防深蹲底端薄弱。",
    },
  ];

  const ratios: StructuralBalanceItem[] = [];
  for (const s of specs) {
    if (s.num <= 0 || s.den <= 0) continue;
    const actual = round2(s.num / s.den);
    const status: StructuralBalanceItem["status"] =
      actual < s.min ? "weak" : actual > s.max ? "strong" : "balanced";
    ratios.push({
      id: s.id,
      label: s.label,
      framework: s.framework,
      numeratorLabel: s.numLabel,
      denominatorLabel: s.denLabel,
      actualRatio: actual,
      targetMin: s.min,
      targetMax: s.max,
      idealRatio: s.ideal,
      status,
      statusLabel: status === "balanced" ? "比例均衡" : status === "weak" ? "偏弱待补强" : "明显占优",
      advice:
        status === "balanced"
          ? `${s.numLabel}/${s.denLabel} 位于理想黄金区间（${Math.round(s.min * 100)}%–${Math.round(s.max * 100)}%），继续保持当前结构。`
          : status === "weak"
            ? s.weakAdvice
            : s.strongAdvice,
    });
  }

  const weakCount = ratios.filter((r) => r.status === "weak").length;
  const summary =
    ratios.length === 0
      ? "完成深蹲、卧推、硬拉、推举或划船中的至少两项后，自动生成 Poliquin / 力量举结构平衡诊断。"
      : weakCount === 0
        ? `已比对 ${ratios.length} 组核心肌力比例，整体结构均衡无明显短板。`
        : `已比对 ${ratios.length} 组比例，发现 ${weakCount} 项相对薄弱环节，可按下方建议优先补强。`;

  return { ratios, summary };
}
