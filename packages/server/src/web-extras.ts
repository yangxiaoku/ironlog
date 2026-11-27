import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  estimatedOneRepMax,
  isValidWorkSet,
  localDate,
  workoutDurationSeconds,
  type Diet,
  type Exercise,
  type Weight,
  type Workout,
} from "@ironlog/shared";
import type { Db } from "./db.js";
import { DomainError, type Store } from "./store.js";
import type { DailyHealthSnapshot } from "./apple-health-daily.js";

const LB_TO_KG = 0.45359237;

function toKg(weight: number, unit?: "kg" | "lb"): number {
  return unit === "lb" ? weight * LB_TO_KG : weight;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export const exerciseNoteInput = z.object({
  note: z.string().max(500),
});

export function listExerciseNotes(db: Db, userId: string): Record<string, { note: string; updatedAt: string }> {
  const rows = db
    .prepare("SELECT exercise_id AS exerciseId, note, updated_at AS updatedAt FROM exercise_notes WHERE user_id=? AND note <> ''")
    .all(userId) as Array<{ exerciseId: string; note: string; updatedAt: string }>;
  const map: Record<string, { note: string; updatedAt: string }> = {};
  for (const row of rows) map[row.exerciseId] = { note: row.note, updatedAt: row.updatedAt };
  return map;
}

export function saveExerciseNote(db: Db, userId: string, exerciseId: string, rawNote: string) {
  const note = rawNote.trim();
  if (!note) {
    db.prepare("DELETE FROM exercise_notes WHERE user_id=? AND exercise_id=?").run(userId, exerciseId);
    return { exerciseId, note: "", updatedAt: null };
  }
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO exercise_notes (user_id, exercise_id, note, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, exercise_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`,
  ).run(userId, exerciseId, note, updatedAt);
  return { exerciseId, note, updatedAt };
}

export function getExerciseHistory(store: Store, userId: string, exerciseId: string) {
  const catalogue = store.catalogueMap(userId, true);
  const baseExercise = catalogue.get(exerciseId) ?? null;
  let resolvedName = baseExercise?.name ?? exerciseId;
  let resolvedMode = baseExercise?.mode ?? "reps";

  const noteRow = store.db
    .prepare("SELECT note FROM exercise_notes WHERE user_id=? AND exercise_id=?")
    .get(userId, exerciseId) as { note: string } | undefined;

  const sessions: Array<{
    workoutId: string;
    date: string;
    endedAtMs: number;
    title: string;
    weightUnit: "kg" | "lb";
    topWeight: number | null;
    topReps: number | null;
    estimated1rm: number | null;
    bestSeconds: number | null;
    workSets: number;
    volume: number;
    sets: Array<{ type: string; weight: number; weightUnit: "kg" | "lb"; weightKg: number; reps: number; seconds: number; rir: number | null }>;
  }> = [];

  for (const record of store.list(userId, "workout")) {
    const workout = record.data as Workout;
    if (workout.status !== "completed") continue;
    const matching = workout.exercises.filter((row) => row.exerciseId === exerciseId);
    if (!matching.length) continue;

    for (const row of matching) {
      const exMeta = row.snapshot ?? baseExercise;
      if (row.snapshot?.name && resolvedName === exerciseId) resolvedName = row.snapshot.name;
      if (exMeta?.mode) resolvedMode = exMeta.mode;

      const mode = exMeta?.mode ?? "reps";
      const mult = exMeta?.volumeMultiplier ?? 1;
      const rowUnit: "kg" | "lb" = row.weightUnit === "lb" ? "lb" : "kg";
      const validSets = row.sets.filter((s) => isValidWorkSet(s, mode));
      if (!validSets.length) continue;

      let topWeight: number | null = null;
      let topReps: number | null = null;
      let best1rm = 0;
      let bestSeconds: number | null = null;
      let volume = 0;

      for (const s of validSets) {
        if (mode === "timed") {
          if (bestSeconds === null || s.seconds > bestSeconds) bestSeconds = s.seconds;
          continue;
        }
        const weightKg = toKg(s.weight, rowUnit);
        if (weightKg > 0 && s.reps > 0) {
          volume += weightKg * s.reps * mult;
        }
        if (mode === "assisted") {
          if (topWeight === null || weightKg < topWeight) {
            topWeight = weightKg;
            topReps = s.reps;
          }
          continue;
        }
        const effectiveReps =
          s.rir != null && Number.isFinite(s.rir) && s.rir >= 0 && s.rir <= 4 ? s.reps + s.rir : s.reps;
        const est = weightKg > 0 && effectiveReps > 0 ? estimatedOneRepMax(weightKg, Math.min(effectiveReps, 12)) : 0;
        if (est > best1rm) best1rm = est;
        if (
          topWeight === null ||
          weightKg > topWeight ||
          (weightKg === topWeight && s.reps > (topReps ?? 0))
        ) {
          topWeight = weightKg;
          topReps = s.reps;
        }
      }

      const endedAtMs = Date.parse(workout.endedAt ?? workout.startedAt) || 0;
      sessions.push({
        workoutId: record.id,
        date: workout.date,
        endedAtMs,
        title: workout.title,
        weightUnit: rowUnit,
        topWeight: topWeight !== null ? round2(topWeight) : null,
        topReps,
        estimated1rm: best1rm > 0 ? round1(best1rm) : null,
        bestSeconds,
        workSets: validSets.length,
        volume: Math.round(volume),
        sets: validSets.map((s) => ({
          type: s.type,
          weight: s.weight,
          weightUnit: rowUnit,
          weightKg: round2(toKg(s.weight, rowUnit)),
          reps: s.reps,
          seconds: s.seconds,
          rir: s.rir ?? null,
        })),
      });
    }
  }

  sessions.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : b.endedAtMs - a.endedAtMs));

  return {
    exerciseId,
    name: resolvedName,
    mode: resolvedMode,
    note: noteRow?.note ?? "",
    sessions: sessions.slice(0, 12).map(({ endedAtMs: _ignored, ...rest }) => rest),
  };
}

export function getTrainedExercisesSummary(store: Store, userId: string) {
  const catalogue = store.catalogueMap(userId, true);
  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      englishName: string;
      muscle: Exercise["muscle"];
      equipment: Exercise["equipment"];
      mode: Exercise["mode"];
      custom: boolean;
      workoutIds: Set<string>;
      totalWorkSets: number;
      lastDate: string;
      bestWeight: number | null;
      best1rm: number | null;
      bestHold: number | null;
      bestAssistance: number | null;
    }
  >();

  for (const record of store.list(userId, "workout")) {
    const workout = record.data as Workout;
    if (workout.status !== "completed") continue;
    for (const row of workout.exercises) {
      const catEx = catalogue.get(row.exerciseId);
      const exMeta = row.snapshot ?? catEx;
      const mode: Exercise["mode"] = exMeta?.mode ?? "reps";
      const validSets = row.sets.filter((s) => isValidWorkSet(s, mode));
      if (!validSets.length) continue;

      let acc = byId.get(row.exerciseId);
      if (!acc) {
        acc = {
          id: row.exerciseId,
          name: catEx?.name ?? row.snapshot?.name ?? row.exerciseId,
          englishName: catEx?.englishName ?? "",
          muscle: (catEx?.muscle ?? row.snapshot?.muscle ?? "chest") as Exercise["muscle"],
          equipment: (catEx?.equipment ?? row.snapshot?.equipment ?? "barbell") as Exercise["equipment"],
          mode,
          custom: catEx?.custom ?? row.exerciseId.startsWith("imp_") ?? false,
          workoutIds: new Set<string>(),
          totalWorkSets: 0,
          lastDate: workout.date,
          bestWeight: null,
          best1rm: null,
          bestHold: null,
          bestAssistance: null,
        };
        byId.set(row.exerciseId, acc);
      }
      acc.workoutIds.add(record.id);
      acc.totalWorkSets += validSets.length;
      if (workout.date > acc.lastDate) acc.lastDate = workout.date;

      const rowUnit: "kg" | "lb" = row.weightUnit === "lb" ? "lb" : "kg";
      for (const s of validSets) {
        if (mode === "timed") {
          if (acc.bestHold === null || s.seconds > acc.bestHold) acc.bestHold = s.seconds;
          continue;
        }
        const rawKg = toKg(s.weight, rowUnit);
        if (mode === "assisted") {
          const assistKg = round2(rawKg);
          if (acc.bestAssistance === null || assistKg < acc.bestAssistance) {
            acc.bestAssistance = assistKg;
          }
          continue;
        }
        if (rawKg > 0 && s.reps > 0) {
          const w = round2(rawKg);
          if (acc.bestWeight === null || w > acc.bestWeight) acc.bestWeight = w;
          const effReps = s.rir != null && Number.isFinite(s.rir) && s.rir >= 0 && s.rir <= 4
            ? s.reps + s.rir
            : s.reps;
          const est = round1(estimatedOneRepMax(rawKg, Math.min(effReps, 12)));
          if (est > 0 && (acc.best1rm === null || est > acc.best1rm)) acc.best1rm = est;
        }
      }
    }
  }

  const items = [...byId.values()]
    .map(({ workoutIds, ...rest }) => ({
      ...rest,
      sessionsCount: workoutIds.size,
    }))
    .sort((a, b) =>
      (b.lastDate < a.lastDate ? -1 : b.lastDate > a.lastDate ? 1 : 0) ||
      b.sessionsCount - a.sessionsCount ||
      a.name.localeCompare(b.name, "zh-Hans-CN"),
    );

  return { total: items.length, items };
}

const measurementBaseSchema = z.object({
  waistCm: z.number().min(30).max(250).nullable().optional(),
  chestCm: z.number().min(40).max(250).nullable().optional(),
  armCm: z.number().min(15).max(100).nullable().optional(),
  thighCm: z.number().min(25).max(150).nullable().optional(),
  hipCm: z.number().min(40).max(250).nullable().optional(),
  notes: z.string().trim().max(300).optional(),
});

export const measurementInput = z.object({
  date: z.iso.date(),
  waistCm: z.number().min(30).max(250).nullable().optional(),
  chestCm: z.number().min(40).max(250).nullable().optional(),
  armCm: z.number().min(15).max(100).nullable().optional(),
  thighCm: z.number().min(25).max(150).nullable().optional(),
  hipCm: z.number().min(40).max(250).nullable().optional(),
  notes: z.string().trim().max(300).optional(),
  expectedUpdatedAt: z.string().nullable().optional(),
  base: measurementBaseSchema.optional(),
});

export interface BodyMeasurementRow {
  date: string;
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  hipCm: number | null;
  notes: string;
  updatedAt: string;
}

export class MeasurementConflictError extends DomainError {
  constructor(
    message: string,
    public readonly current: BodyMeasurementRow | null,
  ) {
    super(message, 409);
  }
}

export function listMeasurements(db: Db, userId: string): BodyMeasurementRow[] {
  return db
    .prepare(
      `SELECT date, waist_cm AS waistCm, chest_cm AS chestCm, arm_cm AS armCm,
              thigh_cm AS thighCm, hip_cm AS hipCm, notes, updated_at AS updatedAt
       FROM body_measurements WHERE user_id=? ORDER BY date DESC`,
    )
    .all(userId) as BodyMeasurementRow[];
}

const MEASUREMENT_NUM_KEYS = ["waistCm", "chestCm", "armCm", "thighCm", "hipCm"] as const;

export function saveMeasurement(
  db: Db,
  userId: string,
  input: z.infer<typeof measurementInput>,
): BodyMeasurementRow {
  if (input.date > localDate()) {
    throw new DomainError("测量日期不能晚于今天", 400);
  }
  return db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT date, waist_cm AS waistCm, chest_cm AS chestCm, arm_cm AS armCm,
                thigh_cm AS thighCm, hip_cm AS hipCm, notes, updated_at AS updatedAt
         FROM body_measurements WHERE user_id=? AND date=?`,
      )
      .get(userId, input.date) as BodyMeasurementRow | undefined;

    if (input.expectedUpdatedAt !== undefined && (existing?.updatedAt ?? null) !== input.expectedUpdatedAt) {
      // Allow automatic merge ONLY when caller sends dirty fields + their original `base` values
      // and none of those fields were touched on the server since the client loaded the row.
      let canMergeNonOverlapping = Boolean(existing && input.base);
      if (canMergeNonOverlapping && existing && input.base) {
        let checkedAny = false;
        for (const k of MEASUREMENT_NUM_KEYS) {
          if (input[k] !== undefined) {
            checkedAny = true;
            const baseVal = input.base[k] != null ? round1(input.base[k]!) : null;
            if (input.base[k] === undefined || existing[k] !== baseVal) {
              canMergeNonOverlapping = false;
              break;
            }
          }
        }
        if (canMergeNonOverlapping && input.notes !== undefined) {
          checkedAny = true;
          if (input.base.notes === undefined || (existing.notes ?? "") !== input.base.notes) {
            canMergeNonOverlapping = false;
          }
        }
        if (!checkedAny) canMergeNonOverlapping = false;
      }
      if (!canMergeNonOverlapping) {
        throw new MeasurementConflictError(
          "该日期的围度已在其他设备更新，请刷新查看最新数据后再保存",
          existing ?? null,
        );
      }
    }

    const resolveNum = (k: (typeof MEASUREMENT_NUM_KEYS)[number]): number | null => {
      if (input[k] !== undefined) return input[k] != null ? round1(input[k]!) : null;
      return existing ? existing[k] : null;
    };
    const updatedAt = new Date().toISOString();
    const row: BodyMeasurementRow = {
      date: input.date,
      waistCm: resolveNum("waistCm"),
      chestCm: resolveNum("chestCm"),
      armCm: resolveNum("armCm"),
      thighCm: resolveNum("thighCm"),
      hipCm: resolveNum("hipCm"),
      notes: input.notes !== undefined ? input.notes : (existing?.notes ?? ""),
      updatedAt,
    };
    if (!MEASUREMENT_NUM_KEYS.some((k) => row[k] != null)) {
      throw new DomainError("请至少填写一项围度数据", 400);
    }
    db.prepare(
      `INSERT INTO body_measurements (user_id, date, waist_cm, chest_cm, arm_cm, thigh_cm, hip_cm, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         waist_cm=excluded.waist_cm, chest_cm=excluded.chest_cm, arm_cm=excluded.arm_cm,
         thigh_cm=excluded.thigh_cm, hip_cm=excluded.hip_cm, notes=excluded.notes, updated_at=excluded.updated_at`,
    ).run(userId, row.date, row.waistCm, row.chestCm, row.armCm, row.thighCm, row.hipCm, row.notes, row.updatedAt);
    return row;
  }).immediate();
}

export function deleteMeasurement(db: Db, userId: string, date: string) {
  db.prepare("DELETE FROM body_measurements WHERE user_id=? AND date=?").run(userId, date);
  return { ok: true };
}

// ===== 3.2 Progress Photos =====
export const progressPhotoInput = z.object({
  opId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  date: z.iso.date(),
  pose: z.enum(["front", "side", "back", "free"]).default("front"),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
  imageData: z
    .string()
    .min(32, "图片数据为空")
    .max(1_000_000, "图片压缩后仍超过上限（最大约 700KB）")
    .refine((v) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "仅支持 JPEG / PNG / WebP 图片数据"),
  note: z.string().trim().max(200).default(""),
});

export interface ProgressPhotoRow {
  id: string;
  date: string;
  pose: "front" | "side" | "back" | "free";
  mime: string;
  imageData: string;
  note: string;
  createdAt: string;
}

export function listProgressPhotos(db: Db, userId: string): ProgressPhotoRow[] {
  return db
    .prepare(
      `SELECT id, date, pose, mime, image_data AS imageData, note, created_at AS createdAt
       FROM progress_photos WHERE user_id=? ORDER BY date DESC, created_at DESC LIMIT 60`,
    )
    .all(userId) as ProgressPhotoRow[];
}

export function saveProgressPhoto(
  db: Db,
  userId: string,
  input: z.infer<typeof progressPhotoInput>,
): ProgressPhotoRow {
  if (input.date > localDate()) {
    throw new DomainError("照片日期不能晚于今天", 400);
  }
  return db.transaction(() => {
    const opKey = input.opId ? `photo:${input.opId}` : null;
    const requestPayload = opKey
      ? JSON.stringify({
          kind: "progressPhoto",
          date: input.date,
          pose: input.pose,
          mime: input.mime,
          note: input.note ?? "",
          imageHash: createHash("sha256").update(input.imageData).digest("hex"),
        })
      : null;

    if (opKey && requestPayload) {
      const saved = db
        .prepare("SELECT request, result FROM operations WHERE user_id=? AND op_id=?")
        .get(userId, opKey) as { request: string; result: string } | undefined;
      if (saved) {
        if (saved.request !== requestPayload) {
          throw new DomainError("重复操作 ID 与原始上传内容不一致", 409);
        }
        const meta = JSON.parse(saved.result) as { id: string; createdAt: string };
        const existingPhoto = db
          .prepare(
            `SELECT id, date, pose, mime, image_data AS imageData, note, created_at AS createdAt
             FROM progress_photos WHERE user_id=? AND id=?`,
          )
          .get(userId, meta.id) as ProgressPhotoRow | undefined;
        if (existingPhoto) return existingPhoto;
        return {
          id: meta.id,
          date: input.date,
          pose: input.pose,
          mime: input.mime,
          imageData: input.imageData,
          note: input.note ?? "",
          createdAt: meta.createdAt,
        };
      }
    }

    const existingCount = (
      db.prepare("SELECT COUNT(*) AS cnt FROM progress_photos WHERE user_id=?").get(userId) as { cnt: number }
    ).cnt;
    if (existingCount >= 60) {
      throw new DomainError("体态照片已达 60 张上限，请先删除旧照片再上传", 400);
    }
    const id = `photo_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO progress_photos (id, user_id, date, pose, mime, image_data, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, input.date, input.pose, input.mime, input.imageData, input.note ?? "", createdAt);
    if (opKey && requestPayload) {
      db.prepare("INSERT INTO operations (user_id, op_id, request, result) VALUES (?, ?, ?, ?)").run(
        userId,
        opKey,
        requestPayload,
        JSON.stringify({ id, createdAt }),
      );
    }
    return {
      id,
      date: input.date,
      pose: input.pose,
      mime: input.mime,
      imageData: input.imageData,
      note: input.note ?? "",
      createdAt,
    };
  }).immediate();
}

export function deleteProgressPhoto(db: Db, userId: string, id: string) {
  const res = db.prepare("DELETE FROM progress_photos WHERE user_id=? AND id=?").run(userId, id);
  if (!res.changes) throw new DomainError("找不到该体态照片", 404);
  return { ok: true };
}

export const waterUpdateInput = z
  .object({
    date: z.iso.date(),
    deltaMl: z.number().int().min(-15000).max(15000).optional(),
    setMl: z.number().int().min(0).max(15000).optional(),
    opId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  })
  .refine((v) => v.deltaMl !== undefined || v.setMl !== undefined, {
    message: "缺少饮水量参数",
  });

export function updateDailyWater(
  db: Db,
  userId: string,
  input: z.infer<typeof waterUpdateInput>,
): { date: string; waterMl: number } {
  if (input.date > localDate()) {
    throw new DomainError("只能记录今天或之前的饮水量", 400);
  }
  return db.transaction(() => {
    const requestPayload = input.opId
      ? JSON.stringify({
          kind: "water",
          date: input.date,
          deltaMl: input.deltaMl ?? null,
          setMl: input.setMl ?? null,
        })
      : null;
    const opKey = input.opId ? `water:${input.opId}` : null;
    if (opKey && requestPayload) {
      const saved = db
        .prepare("SELECT request, result FROM operations WHERE user_id=? AND op_id=?")
        .get(userId, opKey) as { request: string; result: string } | undefined;
      if (saved) {
        if (saved.request !== requestPayload) {
          throw new DomainError("操作 ID 已用于其他请求", 409);
        }
        return JSON.parse(saved.result) as { date: string; waterMl: number };
      }
    }

    const rawRow = db
      .prepare("SELECT data FROM apple_health_daily WHERE user_id=? AND date=?")
      .get(userId, input.date) as { data: string } | undefined;
    const existing = rawRow ? (JSON.parse(rawRow.data) as DailyHealthSnapshot) : null;
    const current = existing?.waterMl ?? 0;
    const rawNext = input.setMl !== undefined ? input.setMl : current + (input.deltaMl ?? 0);
    const nextMl = Math.max(0, Math.min(15000, Math.round(rawNext)));
    const updatedAt = new Date().toISOString();
    const preservedAppleMl =
      existing?.waterAppleSyncedMl !== undefined
        ? existing.waterAppleSyncedMl
        : existing && existing.waterSource !== "manual" && typeof existing.waterMl === "number"
          ? existing.waterMl
          : undefined;
    const merged: DailyHealthSnapshot = {
      ...(existing ?? { date: input.date, updatedAt, source: "manual" }),
      date: input.date,
      updatedAt,
      waterMl: nextMl,
      waterSource: "manual",
      waterUpdatedAt: updatedAt,
      ...(preservedAppleMl !== undefined ? { waterAppleSyncedMl: preservedAppleMl } : {}),
    };
    db.prepare(
      `INSERT INTO apple_health_daily (user_id, date, updated_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data`,
    ).run(userId, input.date, updatedAt, JSON.stringify(merged));
    const outcome = { date: input.date, waterMl: nextMl };
    if (opKey && requestPayload) {
      db.prepare("INSERT INTO operations (user_id, op_id, request, result) VALUES (?, ?, ?, ?)").run(
        userId,
        opKey,
        requestPayload,
        JSON.stringify(outcome),
      );
    }
    return outcome;
  }).immediate();
}

export const csvExportKind = z.enum(["workouts", "diet", "weight", "measurements"]);

const SET_TYPE_LABELS: Record<string, string> = {
  normal: "常规",
  warmup: "热身",
  failure: "力竭",
  drop: "递减",
  rest_pause: "休停",
};

const FEELING_LABELS: Record<string, string> = {
  easy: "轻松",
  balanced: "均衡",
  fatigued: "疲惫",
};

const MEAL_LABELS: Record<string, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "是" : "否";
  let str = String(value);
  // Neutralize spreadsheet formula injection (including leading whitespace bypass) while preserving plain negative numbers
  if ((/^[\s\u0000-\u001f]*[=+\-@]/.test(str) || /^[\t\r]/.test(str)) && !/^-?\d+(\.\d+)?$/.test(str.trim())) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function encodeCsvRows(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

export function buildWebCsv(
  store: Store,
  userId: string,
  kind: z.infer<typeof csvExportKind>,
): { filename: string; content: string } {
  const filename = `ironlog-${kind}-${localDate()}.csv`;
  const catalogue = kind === "workouts" ? store.catalogueMap(userId, true) : null;

  if (kind === "workouts") {
    const headers = [
      "日期",
      "训练标题",
      "时长(分钟)",
      "体感",
      "动作",
      "超级组",
      "组号",
      "组类型",
      "重量(kg)",
      "次数",
      "时长(秒)",
      "RIR",
      "已完成",
      "容量(kg)",
      "开始时间",
      "训练ID",
      "重量单位",
      "原始重量",
    ];
    const rows: unknown[][] = [];
    const workouts = store
      .list(userId, "workout")
      .map((r) => ({ id: r.id, w: r.data as Workout }))
      .filter(({ w }) => w.status === "completed")
      .sort((a, b) =>
        b.w.date.localeCompare(a.w.date) ||
        (Date.parse(b.w.endedAt ?? b.w.startedAt) || 0) - (Date.parse(a.w.endedAt ?? a.w.startedAt) || 0),
      );

    for (const { id: workoutId, w } of workouts) {
      const secs = workoutDurationSeconds(w);
      const mins = secs != null ? round1(secs / 60) : "";
      const feeling = w.feeling ? (FEELING_LABELS[w.feeling] ?? w.feeling) : "";
      for (const ex of w.exercises) {
        const meta = ex.snapshot ?? catalogue?.get(ex.exerciseId);
        const name = meta?.name ?? ex.exerciseId;
        const mult = meta?.volumeMultiplier ?? 1;
        const mode = meta?.mode ?? "reps";
        const unit: "kg" | "lb" = ex.weightUnit === "lb" ? "lb" : "kg";
        ex.sets.forEach((s, idx) => {
          const weightKg = round2(toKg(s.weight, unit));
          const isWork = isValidWorkSet(s, mode);
          const vol = isWork && mode === "reps" && weightKg > 0 && s.reps > 0
            ? round1(weightKg * s.reps * mult)
            : 0;
          rows.push([
            w.date,
            w.title,
            mins,
            feeling,
            name,
            ex.supersetGroup ?? "",
            idx + 1,
            SET_TYPE_LABELS[s.type] ?? s.type,
            weightKg,
            s.reps,
            s.seconds,
            s.rir ?? "",
            s.completed,
            vol,
            w.startedAt,
            workoutId,
            unit,
            s.weight,
          ]);
        });
      }
    }
    return { filename, content: encodeCsvRows(headers, rows) };
  }

  if (kind === "diet") {
    const headers = ["日期", "餐次", "食物名称", "热量(kcal)", "蛋白质(g)", "碳水(g)", "脂肪(g)"];
    const diets = store
      .list(userId, "diet")
      .map((r) => r.data as Diet)
      .sort((a, b) => b.date.localeCompare(a.date));
    const rows = diets.map((d) => [
      d.date,
      MEAL_LABELS[d.meal] ?? d.meal,
      d.name,
      d.calories,
      d.protein,
      d.carbs,
      d.fat,
    ]);
    return { filename, content: encodeCsvRows(headers, rows) };
  }

  if (kind === "weight") {
    const headers = ["日期", "体重(kg)", "体脂率(%)"];
    const weights = store
      .list(userId, "weight")
      .map((r) => r.data as Weight)
      .sort((a, b) => b.date.localeCompare(a.date));
    const rows = weights.map((w) => [w.date, w.weight, w.bodyFat ?? ""]);
    return { filename, content: encodeCsvRows(headers, rows) };
  }

  const headers = ["日期", "腰围(cm)", "胸围(cm)", "臂围(cm)", "大腿围(cm)", "臀围(cm)", "备注"];
  const measurements = listMeasurements(store.db, userId);
  const rows = measurements.map((m) => [
    m.date,
    m.waistCm ?? "",
    m.chestCm ?? "",
    m.armCm ?? "",
    m.thighCm ?? "",
    m.hipCm ?? "",
    m.notes,
  ]);
  return { filename, content: encodeCsvRows(headers, rows) };
}
