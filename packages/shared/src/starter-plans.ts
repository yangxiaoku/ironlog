import type { Plan, Routine } from "./index.js";

type PlannedRow = Routine["exercises"][number];

function repsEx(
  exerciseId: string,
  sets: number,
  repsMin: number,
  repsMax: number,
  options: {
    restSeconds?: number;
    targetRir?: number;
    progression?: PlannedRow["progression"];
    increment?: number;
    backupExerciseId?: string | null;
    weight?: number | null;
  } = {},
): PlannedRow {
  return {
    exerciseId,
    sets,
    repsMin,
    repsMax,
    weight: options.weight ?? null,
    seconds: 0,
    restSeconds: options.restSeconds ?? 90,
    targetRir: options.targetRir ?? 2,
    progression: options.progression ?? "double",
    increment: options.increment ?? 2.5,
    backupExerciseId: options.backupExerciseId ?? null,
  };
}

function timedEx(exerciseId: string, sets: number, seconds: number, restSeconds = 60): PlannedRow {
  return {
    exerciseId,
    sets,
    repsMin: 1,
    repsMax: 1,
    weight: null,
    seconds,
    restSeconds,
    targetRir: 2,
    progression: "manual",
    increment: 0,
    backupExerciseId: null,
  };
}

export interface StarterPlanPreset {
  id: string;
  tag: string;
  level: string;
  daysPerWeek: number;
  equipmentTags: string[];
  summary: string;
  plan: Plan;
}

export const starterPlans: readonly StarterPlanPreset[] = [
  {
    id: "ppl-3",
    tag: "经典肌肥大",
    level: "全阶段适用",
    daysPerWeek: 3,
    equipmentTags: ["barbell", "dumbbell", "cable", "machine"],
    summary: "推 / 拉 / 腿三天自然轮换，兼顾复合主项强度与单关节孤立雕琢，已配置替补动作。",
    plan: {
      name: "经典推拉腿三分化（PPL）",
      weeks: 8,
      schedule: "rotation",
      weekdays: [],
      source: "manual",
      parentId: null,
      rationale: "参考经典 Push / Pull / Legs 结构：按运动模式隔离推、拉与下肢肌群，主项采用双重渐进并在 6–15 次区间均衡刺激，单组累及部位恢复时间充足。",
      routines: [
        {
          id: "ppl_push",
          name: "推日 · 胸肩三头",
          exercises: [
            repsEx("bench-press", 4, 6, 8, { restSeconds: 120, backupExerciseId: "incline-dumbbell" }),
            repsEx("incline-dumbbell", 3, 8, 12, { restSeconds: 90, backupExerciseId: "push-up" }),
            repsEx("overhead-press", 3, 6, 10, { restSeconds: 90 }),
            repsEx("cable-fly", 3, 12, 15, { restSeconds: 60, increment: 1.25 }),
            repsEx("lateral-raise", 3, 12, 15, { restSeconds: 60, increment: 1 }),
            repsEx("triceps-pushdown", 3, 10, 15, { restSeconds: 60, increment: 1.25 }),
          ],
        },
        {
          id: "ppl_pull",
          name: "拉日 · 背部二头",
          exercises: [
            repsEx("pull-up", 4, 6, 10, { restSeconds: 120, backupExerciseId: "lat-pulldown" }),
            repsEx("barbell-row", 4, 8, 10, { restSeconds: 90, backupExerciseId: "seated-row" }),
            repsEx("seated-row", 3, 10, 12, { restSeconds: 90 }),
            repsEx("face-pull", 3, 12, 15, { restSeconds: 60, increment: 1.25, backupExerciseId: "reverse-fly" }),
            repsEx("barbell-curl", 3, 8, 12, { restSeconds: 60, increment: 1.25, backupExerciseId: "hammer-curl" }),
          ],
        },
        {
          id: "ppl_legs",
          name: "腿日 · 下肢核心",
          exercises: [
            repsEx("squat", 4, 6, 8, { restSeconds: 150, backupExerciseId: "leg-press" }),
            repsEx("romanian-deadlift", 3, 8, 10, { restSeconds: 120 }),
            repsEx("leg-press", 3, 10, 12, { restSeconds: 90, increment: 5 }),
            repsEx("leg-curl", 3, 10, 15, { restSeconds: 60, increment: 2.5 }),
            repsEx("hanging-knee-raise", 3, 10, 15, { restSeconds: 60, progression: "manual", increment: 0 }),
          ],
        },
      ],
    },
  },
  {
    id: "upper-lower-4",
    tag: "黄金平衡",
    level: "初中进阶",
    daysPerWeek: 4,
    equipmentTags: ["barbell", "dumbbell", "machine", "cable"],
    summary: "周一/周二/周四/周五高频双循环，每个大肌群每周 2 次高质量刺激，力量与围度并重。",
    plan: {
      name: "上下肢四分化（Upper / Lower）",
      weeks: 8,
      schedule: "weekdays",
      weekdays: [1, 2, 4, 5],
      source: "manual",
      parentId: null,
      rationale: "每周 4 练实现上下肢各自一周两练（高频低疲劳），A 日偏重低次数复合力量，B 日侧重中等次数肌肥大与对称细节，兼顾休息日恢复窗口。",
      routines: [
        {
          id: "ul_upper_a",
          name: "上肢 A · 推拉主项",
          exercises: [
            repsEx("bench-press", 4, 5, 8, { restSeconds: 120, backupExerciseId: "exdb_0289" }),
            repsEx("barbell-row", 4, 6, 8, { restSeconds: 120, backupExerciseId: "exdb_0293" }),
            repsEx("overhead-press", 3, 8, 10, { restSeconds: 90 }),
            repsEx("lat-pulldown", 3, 10, 12, { restSeconds: 90 }),
            repsEx("face-pull", 3, 12, 15, { restSeconds: 60, increment: 1.25 }),
          ],
        },
        {
          id: "ul_lower_a",
          name: "下肢 A · 深蹲主导",
          exercises: [
            repsEx("squat", 4, 5, 8, { restSeconds: 150, backupExerciseId: "exdb_1760" }),
            repsEx("romanian-deadlift", 3, 8, 10, { restSeconds: 120 }),
            repsEx("leg-press", 3, 10, 12, { restSeconds: 90, increment: 5 }),
            repsEx("leg-curl", 3, 10, 12, { restSeconds: 60 }),
            timedEx("plank", 3, 45, 60),
          ],
        },
        {
          id: "ul_upper_b",
          name: "上肢 B · 肌肥大强化",
          exercises: [
            repsEx("incline-dumbbell", 4, 8, 12, { restSeconds: 90 }),
            repsEx("seated-row", 4, 8, 12, { restSeconds: 90 }),
            repsEx("lateral-raise", 4, 12, 15, { restSeconds: 60, increment: 1 }),
            repsEx("barbell-curl", 3, 10, 12, { restSeconds: 60, increment: 1.25 }),
            repsEx("triceps-pushdown", 3, 10, 12, { restSeconds: 60, increment: 1.25 }),
          ],
        },
        {
          id: "ul_lower_b",
          name: "下肢 B · 硬拉主导",
          exercises: [
            repsEx("exdb_0032", 3, 5, 6, { restSeconds: 150, increment: 2.5, backupExerciseId: "romanian-deadlift" }),
            repsEx("exdb_0336", 3, 10, 12, { restSeconds: 90 }),
            repsEx("leg-curl", 3, 10, 15, { restSeconds: 60 }),
            repsEx("leg-press", 3, 12, 15, { restSeconds: 90, increment: 5 }),
            repsEx("hanging-knee-raise", 3, 12, 15, { restSeconds: 60, progression: "manual", increment: 0 }),
          ],
        },
      ],
    },
  },
  {
    id: "full-body-3",
    tag: "高效入门",
    level: "每周 3 练",
    daysPerWeek: 3,
    equipmentTags: ["barbell", "dumbbell", "machine"],
    summary: "周一/周三/周五隔天全身训练，每次覆盖推/拉/蹲/髋四维动作模式，容错率极高。",
    plan: {
      name: "全身力量三分化（Full Body）",
      weeks: 8,
      schedule: "weekdays",
      weekdays: [1, 3, 5],
      source: "manual",
      parentId: null,
      rationale: "全身三分化适合时间紧凑的训练者：每次训练后均带 48 小时系统恢复窗口，每周三大动作模式均能获得 3 次神经与动作学习巩固。",
      routines: [
        {
          id: "fb_a",
          name: "全身 A · 深蹲卧推",
          exercises: [
            repsEx("squat", 3, 6, 8, { restSeconds: 150, backupExerciseId: "exdb_1760" }),
            repsEx("bench-press", 3, 8, 10, { restSeconds: 120, backupExerciseId: "incline-dumbbell" }),
            repsEx("barbell-row", 3, 8, 10, { restSeconds: 90 }),
            repsEx("lateral-raise", 3, 12, 15, { restSeconds: 60, increment: 1 }),
            timedEx("plank", 3, 45, 60),
          ],
        },
        {
          id: "fb_b",
          name: "全身 B · 硬拉推举",
          exercises: [
            repsEx("exdb_0032", 3, 5, 6, { restSeconds: 150, backupExerciseId: "romanian-deadlift" }),
            repsEx("overhead-press", 3, 6, 10, { restSeconds: 120 }),
            repsEx("lat-pulldown", 3, 8, 12, { restSeconds: 90, backupExerciseId: "pull-up" }),
            repsEx("hammer-curl", 3, 10, 12, { restSeconds: 60, increment: 1.25 }),
            repsEx("dead-bug", 3, 10, 12, { restSeconds: 60, progression: "manual", increment: 0 }),
          ],
        },
        {
          id: "fb_c",
          name: "全身 C · 腿举上斜",
          exercises: [
            repsEx("leg-press", 3, 10, 12, { restSeconds: 120, increment: 5 }),
            repsEx("incline-dumbbell", 3, 8, 12, { restSeconds: 90 }),
            repsEx("seated-row", 3, 10, 12, { restSeconds: 90 }),
            repsEx("triceps-pushdown", 3, 10, 15, { restSeconds: 60, increment: 1.25 }),
            repsEx("crunch", 3, 15, 20, { restSeconds: 60, progression: "manual", increment: 0 }),
          ],
        },
      ],
    },
  },
  {
    id: "greyskull-5x5",
    tag: "线性力量",
    level: "力量进阶",
    daysPerWeek: 3,
    equipmentTags: ["barbell", "bodyweight"],
    summary: "内置 Greyskull LP AMRAP 自动渐进规则：达标常规加重、末组翻倍爆发×2、失利自动 -10% 减载。",
    plan: {
      name: "经典线性力量（Greyskull / 5×5）",
      weeks: 12,
      schedule: "rotation",
      weekdays: [],
      source: "manual",
      parentId: null,
      rationale: "采用 Greyskull LP 核心线性机制：围绕深蹲、卧推、肩推、杠铃划船与硬拉五大复合动作，末组全力 AMRAP；完成 5 次稳步加重，冲至 ≥10 次触发双倍加重，失利自动 -10% 重置冲刺。",
      routines: [
        {
          id: "gslp_a",
          name: "力量 A · 深蹲 / 卧推 / 划船",
          exercises: [
            repsEx("squat", 3, 5, 5, { restSeconds: 180, progression: "greyskull", increment: 2.5 }),
            repsEx("bench-press", 3, 5, 5, { restSeconds: 150, progression: "greyskull", increment: 2.5 }),
            repsEx("barbell-row", 3, 5, 5, { restSeconds: 120, progression: "greyskull", increment: 2.5 }),
            repsEx("face-pull", 2, 12, 15, { restSeconds: 60, progression: "double", increment: 1.25 }),
          ],
        },
        {
          id: "gslp_b",
          name: "力量 B · 深蹲 / 推举 / 硬拉",
          exercises: [
            repsEx("squat", 3, 5, 5, { restSeconds: 180, progression: "greyskull", increment: 2.5 }),
            repsEx("overhead-press", 3, 5, 5, { restSeconds: 150, progression: "greyskull", increment: 1.25 }),
            repsEx("exdb_0032", 1, 5, 5, { restSeconds: 180, progression: "greyskull", increment: 5 }),
            repsEx("barbell-curl", 2, 10, 12, { restSeconds: 60, progression: "double", increment: 1.25 }),
          ],
        },
      ],
    },
  },
  {
    id: "dumbbell-home-3",
    tag: "居家无架",
    level: "仅需哑铃",
    daysPerWeek: 3,
    equipmentTags: ["dumbbell", "bodyweight"],
    summary: "仅靠一对可调哑铃即可完成的全身三分化方案，无深蹲架或龙门架限制，适合居家高效训练。",
    plan: {
      name: "居家哑铃全身计划",
      weeks: 6,
      schedule: "rotation",
      weekdays: [],
      source: "manual",
      parentId: null,
      rationale: "专为居家哑铃与自重环境编排：避开杠铃与大型固定器械限制，利用高脚杯深蹲、哑铃卧推、哑铃划船与单侧弓步保持完整力量曲线与双边均衡。",
      routines: [
        {
          id: "home_a",
          name: "居家 A · 推胸蹲腿",
          exercises: [
            repsEx("exdb_1760", 3, 10, 15, { restSeconds: 90, backupExerciseId: "bodyweight-squat" }),
            repsEx("exdb_0289", 3, 8, 12, { restSeconds: 90, backupExerciseId: "push-up" }),
            repsEx("exdb_0293", 3, 10, 12, { restSeconds: 90 }),
            repsEx("lateral-raise", 3, 12, 15, { restSeconds: 60, increment: 1 }),
            timedEx("plank", 3, 45, 60),
          ],
        },
        {
          id: "home_b",
          name: "居家 B · 后链划船",
          exercises: [
            repsEx("exdb_0300", 3, 10, 12, { restSeconds: 120 }),
            repsEx("incline-dumbbell", 3, 10, 12, { restSeconds: 90 }),
            repsEx("reverse-fly", 3, 12, 15, { restSeconds: 60, increment: 1 }),
            repsEx("hammer-curl", 3, 10, 12, { restSeconds: 60, increment: 1 }),
            repsEx("dead-bug", 3, 10, 12, { restSeconds: 60, progression: "manual", increment: 0 }),
          ],
        },
        {
          id: "home_c",
          name: "居家 C · 单侧稳态",
          exercises: [
            repsEx("exdb_0336", 3, 10, 12, { restSeconds: 90 }),
            repsEx("push-up", 3, 10, 20, { restSeconds: 75, progression: "manual", increment: 0 }),
            repsEx("exdb_0293", 3, 10, 15, { restSeconds: 90 }),
            repsEx("overhead-extension", 3, 10, 15, { restSeconds: 60, increment: 1 }),
            repsEx("crunch", 3, 15, 20, { restSeconds: 60, progression: "manual", increment: 0 }),
          ],
        },
      ],
    },
  },
];
