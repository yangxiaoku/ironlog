import { randomUUID } from "node:crypto";

interface FoodEntry {
  keywords: string[];
  name: string;
  baseGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const commonFoods: FoodEntry[] = [
  { keywords: ["鸡胸", "鸡肉"], name: "煎鸡胸肉", baseGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  { keywords: ["牛肉", "牛排", "牛腩"], name: "瘦牛肉", baseGrams: 100, calories: 210, protein: 26, carbs: 0, fat: 11 },
  { keywords: ["三文鱼", "鱼"], name: "香煎三文鱼", baseGrams: 100, calories: 206, protein: 22, carbs: 0, fat: 12 },
  { keywords: ["鸡蛋", "水煮蛋", "煎蛋", "蛋"], name: "水煮鸡蛋", baseGrams: 55, calories: 78, protein: 6.5, carbs: 0.6, fat: 5.5 },
  { keywords: ["米饭", "白饭", "糙米饭", "杂粮饭"], name: "米饭", baseGrams: 100, calories: 116, protein: 2.6, carbs: 25.6, fat: 0.3 },
  { keywords: ["燕麦", "麦片"], name: "燕麦片", baseGrams: 50, calories: 185, protein: 6.5, carbs: 33, fat: 3.2 },
  { keywords: ["全麦面包", "吐司", "面包"], name: "全麦面包", baseGrams: 60, calories: 150, protein: 6, carbs: 27, fat: 2 },
  { keywords: ["牛奶", "脱脂奶", "纯牛奶"], name: "牛奶", baseGrams: 250, calories: 135, protein: 8.5, carbs: 12, fat: 5 },
  { keywords: ["酸奶", "希腊酸奶"], name: "无糖希腊酸奶", baseGrams: 150, calories: 115, protein: 14, carbs: 6, fat: 3.5 },
  { keywords: ["蛋白粉", "乳清"], name: "乳清蛋白粉", baseGrams: 30, calories: 120, protein: 24, carbs: 2.5, fat: 1.5 },
  { keywords: ["香蕉"], name: "香蕉", baseGrams: 120, calories: 105, protein: 1.3, carbs: 27, fat: 0.3 },
  { keywords: ["红薯", "紫薯", "土豆"], name: "蒸薯类", baseGrams: 150, calories: 130, protein: 2.4, carbs: 30, fat: 0.2 },
  { keywords: ["西兰花", "蔬菜", "生菜", "青菜", "时蔬"], name: "清炒/白灼时蔬", baseGrams: 150, calories: 52, protein: 3.8, carbs: 8, fat: 1 },
  { keywords: ["拿铁", "美式", "咖啡"], name: "冰美式/拿铁", baseGrams: 350, calories: 95, protein: 5, carbs: 8, fat: 4.5 },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

function parseDemoDiet(text: string) {
  const segments = text.split(/[，,、；;。\n+]+/).map((s) => s.trim()).filter(Boolean);
  const foods: { name: string; calories: number; protein: number; carbs: number; fat: number }[] = [];

  for (const segment of segments) {
    const match = commonFoods.find((item) => item.keywords.some((kw) => segment.includes(kw)));
    const gramsMatch = segment.match(/(\d+(?:\.\d+)?)\s*(?:g|克|ml|毫升)/i);
    const countMatch = segment.match(/(\d+(?:\.\d+)?)\s*(?:个|颗|片|杯|勺|碗|份)/);
    if (match) {
      let ratio = 1;
      if (gramsMatch) {
        ratio = Number(gramsMatch[1]) / match.baseGrams;
      } else if (countMatch) {
        ratio = Number(countMatch[1]) * (match.name.includes("米饭") ? 1.5 : 1);
      }
      ratio = Math.max(0.25, Math.min(8, ratio));
      foods.push({
        name: segment,
        calories: Math.round(match.calories * ratio),
        protein: round1(match.protein * ratio),
        carbs: round1(match.carbs * ratio),
        fat: round1(match.fat * ratio),
      });
    }
  }

  if (!foods.length) {
    for (const segment of segments.slice(0, 4)) {
      foods.push({
        name: segment,
        calories: 320,
        protein: 22,
        carbs: 34,
        fat: 9,
      });
    }
  }

  return { foods: foods.slice(0, 12) };
}

function parseDemoWorkout(text: string, exercises: { id: string; name: string; englishName?: string; aliases?: string[]; equipment: string; mode: string }[]) {
  const clauses = text.split(/[，,；;。\n]+/).map((s) => s.trim()).filter(Boolean);
  const rows: unknown[] = [];

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const hit = exercises.find((ex) =>
      [ex.name, ex.englishName ?? "", ...(ex.aliases ?? [])]
        .filter(Boolean)
        .some((name) => lower.includes(name.toLowerCase())),
    ) ?? exercises.find((ex) =>
      ex.name.length >= 2 && (clause.includes(ex.name.slice(0, 2)) || clause.includes(ex.name.slice(-2))),
    );
    if (!hit) continue;

    const weightMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:kg|公斤|k)/i);
    const setsRepsMatch = clause.match(/(\d+)\s*[×xX*组]\s*(\d+)/);
    const setsOnlyMatch = clause.match(/(\d+)\s*组/);
    const repsOnlyMatch = clause.match(/(\d+)\s*(?:次|下)/);
    const secMatch = clause.match(/(\d+)\s*秒/);
    const minMatch = clause.match(/(\d+(?:\.\d+)?)\s*分钟/);

    const weight = weightMatch ? Number(weightMatch[1]) : hit.equipment === "bodyweight" ? 0 : 40;
    const setCount = Math.max(1, Math.min(12, Number(setsRepsMatch?.[1] ?? setsOnlyMatch?.[1] ?? 3)));
    const reps = hit.mode === "timed" ? 0 : Math.max(1, Number(setsRepsMatch?.[2] ?? repsOnlyMatch?.[1] ?? 8));
    const seconds = hit.mode === "timed"
      ? Math.max(10, Number(secMatch?.[1] ?? (minMatch ? Math.round(Number(minMatch[1]) * 60) : 45)))
      : 0;

    rows.push({
      id: randomUUID(),
      exerciseId: hit.id,
      restSeconds: 90,
      sets: Array.from({ length: setCount }, () => ({
        id: randomUUID(),
        type: "normal",
        weight,
        reps,
        seconds,
        completed: true,
        rir: null,
      })),
    });
  }

  if (!rows.length && exercises[0]) {
    const fallback = exercises[0];
    rows.push({
      id: randomUUID(),
      exerciseId: fallback.id,
      restSeconds: 90,
      sets: Array.from({ length: 3 }, () => ({
        id: randomUUID(),
        type: "normal",
        weight: fallback.equipment === "bodyweight" ? 0 : 40,
        reps: fallback.mode === "timed" ? 0 : 10,
        seconds: fallback.mode === "timed" ? 45 : 0,
        completed: true,
        rir: null,
      })),
    });
  }

  const titleHint = text.includes("胸") ? "推胸训练" : text.includes("背") ? "背部力量" : text.includes("腿") ? "下肢力量" : "AI 解析训练";
  return { title: titleHint, exercises: rows };
}

function parseDemoPlan(payload: {
  request: string;
  parentPlan?: { name?: string };
  context?: { workouts?: unknown[]; profile?: { daysPerWeek?: number; calories?: number; equipment?: string[] } };
  exercises: { id: string; name: string; muscle: string; equipment: string; mode: string }[];
}) {
  const req = payload.request ?? "";
  const isFourDay = /4\s*天|四天|上下肢/.test(req) || (!/3\s*天|三天/.test(req) && (payload.context?.profile?.daysPerWeek ?? 3) >= 4);
  const pick = (muscle: string, count: number) => {
    const matches = payload.exercises.filter((e) => e.muscle === muscle && e.mode !== "timed");
    return matches.slice(0, count).map((e) => ({
      exerciseId: e.id,
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      weight: null,
      seconds: 0,
      restSeconds: 90,
      targetRir: 2,
      progression: "double",
      increment: 2.5,
      backupExerciseId: null,
    }));
  };

  const pushEx = [...pick("chest", 2), ...pick("shoulders", 1), ...pick("arms", 1)];
  const pullEx = [...pick("back", 3), ...pick("arms", 1)];
  const legEx = [...pick("legs", 3), ...pick("core", 1)];

  const routines = isFourDay
    ? [
        { id: "upper_a", name: "上肢推力与肩", exercises: pushEx },
        { id: "lower_a", name: "下肢蹲推主导", exercises: legEx },
        { id: "upper_b", name: "上肢拉力与臂", exercises: pullEx },
        { id: "lower_b", name: "下肢后链与核心", exercises: [...pick("legs", 2), ...pick("back", 1), ...pick("core", 1)] },
      ]
    : [
        { id: "push_day", name: "推 · 胸肩三头", exercises: pushEx },
        { id: "pull_day", name: "拉 · 背与二头", exercises: pullEx },
        { id: "leg_day", name: "腿 · 下肢与核心", exercises: legEx },
      ];

  const validRoutines = routines
    .map((r) => ({ ...r, exercises: r.exercises.length ? r.exercises : payload.exercises.slice(0, 2).map((e) => ({
      exerciseId: e.id, sets: 3, repsMin: 8, repsMax: 12, weight: null, seconds: e.mode === "timed" ? 45 : 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null,
    })) }))
    .filter((r) => r.exercises.length > 0);

  const count = payload.context?.workouts?.length ?? 0;
  const baseTitle = payload.parentPlan?.name ? `${payload.parentPlan.name} · 进阶` : isFourDay ? "AI 上下肢四天分化" : "AI 推拉腿三天循环";
  return {
    name: baseTitle,
    weeks: 6,
    schedule: "rotation",
    weekdays: [],
    routines: validRoutines,
    rationale: `基于近期 ${count} 条真实训练记录与偏好（每周 ${isFourDay ? 4 : 3} 练，目标热量 ${payload.context?.profile?.calories ?? 2250} kcal）生成${payload.parentPlan ? "迭代方案" : "初始周期草案"}：结合「${req.slice(0, 48)}」的诉求，控制复合动作 RIR 2 以兼顾渐进超负荷与恢复节奏。`,
  };
}

function parseDemoReview(payload: {
  question: string;
  date: string;
  context?: {
    workouts?: { date: string; title: string; feeling?: string | null; exercises?: { sets: { completed: boolean; weight: number; reps: number }[] }[] }[];
    dailyNutrition?: Record<string, { calories: number; protein: number; carbs: number; fat: number }>;
    weights?: { date: string; weight: number }[];
    profile?: { calories?: number; protein?: number; targetWeight?: number | null };
    energy?: { status: string; totalDisplay?: number; weightDate?: string };
  };
}) {
  const ctx = payload.context ?? {};
  const workouts = ctx.workouts ?? [];
  const weights = ctx.weights ?? [];
  const nutritionDays = Object.values(ctx.dailyNutrition ?? {});
  const targetCal = ctx.profile?.calories ?? 2250;
  const latestWeight = weights.at(-1);
  const firstWeight = weights[0];
  const weightDiff = latestWeight && firstWeight ? round1(latestWeight.weight - firstWeight.weight) : null;
  const avgCal = nutritionDays.length ? Math.round(nutritionDays.reduce((s, d) => s + d.calories, 0) / nutritionDays.length) : null;
  const avgPro = nutritionDays.length ? round1(nutritionDays.reduce((s, d) => s + d.protein, 0) / nutritionDays.length) : null;

  const lines = [
    `【截至 ${payload.date} 综合训练复盘】`,
    `1. 训练执行与强度观察：近 28 天窗口内共记录 ${workouts.length} 次正式训练${workouts.length ? `（最近一次为 ${workouts.at(-1)?.date}「${workouts.at(-1)?.title}」）` : ""}。建议继续围绕核心复合动作保留 1–2 次储备次数（RIR），避免连续高疲劳叠加。`,
    nutritionDays.length
      ? `2. 营养摄入对比：近 28 天共有 ${nutritionDays.length} 天饮食记录，日均摄入 ${avgCal} kcal（目标 ${targetCal} kcal，差额 ${avgCal! - targetCal >= 0 ? "+" : ""}${avgCal! - targetCal} kcal），日均蛋白质 ${avgPro} g。`
      : `2. 营养摄入对比：近窗口饮食记录天数较少（目标 ${targetCal} kcal），建议连续记录 3–5 天饮食再校准热量缺口/盈余。`,
    latestWeight
      ? `3. 体重与目标趋势：最新称重 ${latestWeight.date} 为 ${latestWeight.weight} kg${weightDiff !== null ? `（区间变化 ${weightDiff >= 0 ? "+" : ""}${weightDiff} kg）` : ""}${ctx.profile?.targetWeight ? `，距离目标 ${ctx.profile.targetWeight} kg 还差 ${round1(Math.abs(latestWeight.weight - ctx.profile.targetWeight))} kg` : ""}。`
      : `3. 体重趋势：近期暂无称重样本，建议固定晨起空腹每周记录 3 次以上以消除水分波动。`,
    ctx.energy?.status === "ready"
      ? `4. 能量估算参考（${ctx.energy.weightDate} 身体资料）：预估日总消耗约 ${ctx.energy.totalDisplay} kcal（已含当前活动系数）。`
      : `4. 身体资料提示：尚未完善身高与活动系数，建议在「统计后台 → 训练与饮食」补充以获得更精准消耗参考。`,
    `5. 下一步建议（针对「${payload.question.slice(0, 40)}」）：优先保证每周至少 3–4 场规律抗阻，下一次主项卧推/深蹲可尝试先加 2.5 kg 或多推 1 次；若睡眠或体感疲惫，则主动减去 1 组辅助动作保持动作质量。`,
  ];
  return { summary: lines.join("\n\n") };
}

function parseDemoAdapt(payload: {
  request: string;
  workout: {
    exercises: {
      exerciseRowId: string;
      snapshot?: { name?: string; mode?: string };
      exerciseId: string;
      restSeconds: number;
      weightUnit?: "kg" | "lb";
      openSets: { weight: number; reps: number; seconds?: number }[];
    }[];
  };
  exercises: { id: string; name: string; mode: string }[];
}) {
  const req = payload.request ?? "";
  const isTimeShort = /时间|赶|精简|少|快|15|10/.test(req);
  const isFatigue = /累|疲|痛|重|降|减/.test(req);
  const isPush = /状态好|加重|冲|突破|轻/.test(req);

  const changes = payload.workout.exercises.slice(0, 4).map((row, idx) => {
    const firstOpen = row.openSets[0]!;
    const mode = row.snapshot?.mode ?? "reps";
    const remainingCount = row.openSets.length;

    if (isTimeShort) {
      const nextSets = idx === 0 ? Math.max(1, remainingCount - 1) : remainingCount > 1 ? 1 : remainingCount;
      return {
        exerciseRowId: row.exerciseRowId,
        reason: idx === 0 ? "保留主动作核心组数并缩短组间休息" : "压缩辅助动作余组，确保在限定时间内收尾",
        patch: {
          remainingSets: nextSets,
          restSeconds: Math.min(row.restSeconds, 60),
        },
      };
    }

    if (isPush && mode !== "timed") {
      // #182 (P1): Handle assisted mode inversely (less assistance = harder) and omit reps when firstOpen.reps < 1.
      const step = (row.weightUnit ?? "kg") === "lb" ? 5 : 2.5;
      const unitLbl = row.weightUnit ?? "kg";
      const nextWeight =
        mode === "assisted"
          ? firstOpen.weight > 0
            ? Math.max(0, Math.round((firstOpen.weight - step) * 2) / 2)
            : 0
          : firstOpen.weight > 0
            ? Math.round((firstOpen.weight + step) * 2) / 2
            : firstOpen.weight;
      return {
        exerciseRowId: row.exerciseRowId,
        reason:
          mode === "assisted"
            ? `体感充沛，将辅助配重下调 -${step} ${unitLbl} 提高动作强度`
            : `体感充沛，对未完成组微调递增 +${step} ${unitLbl} 冲击上限`,
        patch: {
          weight: nextWeight,
          weightUnit: row.weightUnit ?? "kg",
          ...(firstOpen.reps >= 1 ? { reps: firstOpen.reps } : {}),
        },
      };
    }

    if (isFatigue && mode !== "timed") {
      const step = (row.weightUnit ?? "kg") === "lb" ? 5 : 2.5;
      const unitLbl = row.weightUnit ?? "kg";
      const easedWeight =
        mode === "assisted"
          ? Math.max(step, Math.round(((firstOpen.weight || 0) * 1.15) / step) * step, Math.round(((firstOpen.weight || 0) + step) * 2) / 2)
          : firstOpen.weight > step * 2
            ? Math.max(step, Math.round((firstOpen.weight * 0.9) / step) * step)
            : firstOpen.weight;
      return {
        exerciseRowId: row.exerciseRowId,
        reason:
          mode === "assisted"
            ? `保留已完成刺激量，增加辅助配重至 ${easedWeight} ${unitLbl} 降低实际负重保证技术标准`
            : "保留已完成的刺激量，余下未完成组小幅降载约 10% 保证技术标准",
        patch: {
          weight: easedWeight,
          weightUnit: row.weightUnit ?? "kg",
          remainingSets: Math.max(1, remainingCount - (remainingCount > 2 ? 1 : 0)),
        },
      };
    }

    return {
      exerciseRowId: row.exerciseRowId,
      reason: "根据当前余量优化组间恢复节拍并保持有效容量",
      patch: {
        restSeconds: row.restSeconds > 90 ? 90 : 75,
      },
    };
  });

  const summary = isTimeShort
    ? "已按紧凑时间方案精简后续辅助组数，并将组间休息调整为 60 秒。"
    : isPush
      ? "为你上调了未完成工作组重量（+2.5 kg），已完成组记录保持不变。"
      : isFatigue
        ? "已适度下调后续未完成组负荷（约 10%）并控制总容量，避免代偿疲劳。"
        : "已为你优化余下训练组的休息节奏，确认勾选后即可直接应用。";

  return { summary, changes };
}

/** Deterministic local AI transport for loopback demo mode when real API keys are not set. */
export function createDemoAiTransport(): typeof fetch {
  return async (_url, options) => {
    const body = JSON.parse(String(options?.body ?? "{}")) as {
      messages?: { role: string; content: string }[];
    };
    const system = body.messages?.[0]?.content ?? "";
    const userPayload = JSON.parse(body.messages?.[1]?.content ?? "{}");

    let answer: unknown;
    if (system.includes("饮食记录助手")) answer = parseDemoDiet(userPayload.text ?? "");
    else if (system.includes("训练记录助手")) answer = parseDemoWorkout(userPayload.text ?? "", userPayload.exercises ?? []);
    else if (system.includes("训练计划助手")) answer = parseDemoPlan(userPayload);
    else if (system.includes("训练复盘助手")) answer = parseDemoReview(userPayload);
    else if (system.includes("训练中调整助手")) answer = parseDemoAdapt(userPayload);
    else answer = { error: "未知 AI 请求类型" };

    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) } }],
    });
  };
}
