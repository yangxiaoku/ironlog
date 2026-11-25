import { randomUUID } from "node:crypto";
import {
  entityKindSchema,
  exerciseSchema,
  planSchema,
  schemas,
  validatePlanExercises,
  validateRecordIdentity,
  type EntityKind,
  type Exercise,
  type Mutation,
  type MutationResult,
  type Plan,
  type Routine,
  type ScheduledDay,
  type StoredRecord,
  type Workout,
} from "@ironlog/shared";
import type Database from "better-sqlite3";
import type { Db } from "./db.js";
import { serverCatalogue } from "./catalogue.js";
import { appleWorkoutIdentity } from "./apple-workout-identity.js";
import { sleepObservationsSchema } from "./sleep-observations.js";

interface Row {
  id: string;
  kind: EntityKind;
  version: number;
  deleted: number;
  data: string;
  updated_at: string;
  seq?: number;
}
function decode(row: Row): StoredRecord {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    deleted: Boolean(row.deleted),
    data: JSON.parse(row.data),
    updatedAt: row.updated_at,
  };
}

function backupInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}

function newerBackupRecord(incomingAt: string | null, existingAt: string) {
  if (!incomingAt) return false;
  const existing = backupInstant(existingAt);
  return existing == null || incomingAt > existing;
}

function backupRecordKey({ kind, id }: Pick<StoredRecord, "kind" | "id">) {
  return `${kind}:${id}`;
}

function deletionIdentityData({ kind, id }: Pick<StoredRecord, "kind" | "id">) {
  switch (kind) {
    case "exercise":
    case "template":
      return { id };
    case "weight":
      return { date: id.slice("weight_".length) };
    case "nutritionDay":
      return { date: id.slice("nutritionDay_".length) };
    case "scheduledDay":
      return { date: id.slice("schedule_".length) };
    default:
      return {};
  }
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 503 = 400,
  ) {
    super(message);
  }
}

type Stmt = Database.Statement<unknown[], unknown>;

const serverCatalogueMap: ReadonlyMap<string, Exercise> = new Map(
  serverCatalogue.map((exercise) => [exercise.id, exercise]),
);

class LayeredExerciseMap implements ReadonlyMap<string, Exercise> {
  constructor(
    private readonly base: ReadonlyMap<string, Exercise>,
    private readonly overlay: ReadonlyMap<string, Exercise>,
  ) {}

  get size(): number {
    let count = this.base.size;
    for (const key of this.overlay.keys()) {
      if (!this.base.has(key)) count++;
    }
    return count;
  }

  has(key: string): boolean {
    return this.overlay.has(key) || this.base.has(key);
  }

  get(key: string): Exercise | undefined {
    return this.overlay.get(key) ?? this.base.get(key);
  }

  forEach(
    callbackfn: (value: Exercise, key: string, map: ReadonlyMap<string, Exercise>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.entries()) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  *entries(): MapIterator<[string, Exercise]> {
    for (const [key, value] of this.base) {
      yield [key, this.overlay.get(key) ?? value];
    }
    for (const [key, value] of this.overlay) {
      if (!this.base.has(key)) yield [key, value];
    }
    return undefined;
  }

  *keys(): MapIterator<string> {
    for (const [key] of this.entries()) yield key;
    return undefined;
  }

  *values(): MapIterator<Exercise> {
    for (const [, value] of this.entries()) yield value;
    return undefined;
  }

  [Symbol.iterator](): MapIterator<[string, Exercise]> {
    return this.entries();
  }
}

export class Store {
  private readonly stmtGet: Stmt;
  private readonly stmtListActive: Stmt;
  private readonly stmtListAll: Stmt;
  private readonly stmtLatestSeq: Stmt;
  private readonly listCache = new Map<string, { seq: number; records: StoredRecord[] }>();
  private readonly stmtOperation: Stmt;
  private readonly stmtUpsertRecord: Stmt;
  private readonly stmtInsertChange: Stmt;
  private readonly stmtInsertOp: Stmt;
  private readonly stmtPull: Stmt;
  private readonly stmtActivePlan: Stmt;
  private readonly stmtPlanVersion: Stmt;
  private readonly stmtPlanActivations: Stmt;
  private readonly stmtPlanRevisionFloor: Stmt;
  private readonly stmtSavePlanRevisionFloor: Stmt;
  private readonly stmtInsertPlanVersion: Stmt;
  private readonly stmtUpsertActivePlan: Stmt;
  private readonly stmtInsertPlanActivation: Stmt;
  private readonly stmtExportRecords: Stmt;
  private readonly stmtExportPlanVersions: Stmt;
  private readonly stmtExportExerciseNotes: Stmt;
  private readonly stmtExportMeasurements: Stmt;
  private readonly stmtExportAppleDaily: Stmt;
  private readonly stmtExportAppleWorkouts: Stmt;

  constructor(public db: Db) {
    this.stmtGet = db.prepare("SELECT * FROM records WHERE user_id = ? AND kind = ? AND id = ?");
    this.stmtListActive = db.prepare("SELECT * FROM records WHERE user_id = ? AND kind = ? AND deleted = 0 ORDER BY updated_at, id");
    this.stmtListAll = db.prepare("SELECT * FROM records WHERE user_id = ? AND kind = ? ORDER BY updated_at, id");
    this.stmtLatestSeq = db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE user_id = ?");
    this.stmtOperation = db.prepare("SELECT request, result FROM operations WHERE user_id = ? AND op_id = ?");
    this.stmtUpsertRecord = db.prepare(
      `INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, kind, id) DO UPDATE SET version=excluded.version, deleted=excluded.deleted, data=excluded.data, updated_at=excluded.updated_at`,
    );
    this.stmtInsertChange = db.prepare(
      "INSERT INTO changes(user_id,kind,id,version,deleted,data,updated_at) VALUES (?,?,?,?,?,?,?)",
    );
    this.stmtInsertOp = db.prepare("INSERT INTO operations VALUES (?,?,?,?)");
    this.stmtPull = db.prepare("SELECT * FROM changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?");
    this.stmtActivePlan = db.prepare("SELECT * FROM active_plans WHERE user_id = ?");
    this.stmtPlanVersion = db.prepare("SELECT data FROM plan_versions WHERE user_id = ? AND id = ? AND version = ?");
    this.stmtPlanActivations = db.prepare(
      `SELECT a.plan_id AS id, a.version, a.updated_at AS updatedAt, v.data
       FROM plan_activations a JOIN plan_versions v
         ON v.user_id=a.user_id AND v.id=a.plan_id AND v.version=a.version
       WHERE a.user_id=? ORDER BY a.revision`,
    );
    this.stmtPlanRevisionFloor = db.prepare("SELECT revision FROM plan_revision_floor WHERE user_id = ?");
    this.stmtSavePlanRevisionFloor = db.prepare(
      `INSERT INTO plan_revision_floor VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET revision=MAX(plan_revision_floor.revision, excluded.revision)`,
    );
    this.stmtInsertPlanVersion = db.prepare("INSERT OR IGNORE INTO plan_versions VALUES (?,?,?,?,?)");
    this.stmtUpsertActivePlan = db.prepare(
      `INSERT INTO active_plans VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
        plan_id=excluded.plan_id, version=excluded.version, revision=excluded.revision, updated_at=excluded.updated_at`,
    );
    this.stmtInsertPlanActivation = db.prepare("INSERT INTO plan_activations VALUES (?,?,?,?,?)");
    this.stmtExportRecords = db.prepare("SELECT * FROM records WHERE user_id=?");
    this.stmtExportPlanVersions = db.prepare("SELECT id,version,data,created_at FROM plan_versions WHERE user_id=?");
    this.stmtExportExerciseNotes = db.prepare("SELECT exercise_id AS exerciseId, note, updated_at AS updatedAt FROM exercise_notes WHERE user_id=? AND note <> '' ORDER BY exercise_id");
    this.stmtExportMeasurements = db.prepare(
      `SELECT date, waist_cm AS waistCm, chest_cm AS chestCm, arm_cm AS armCm,
              thigh_cm AS thighCm, hip_cm AS hipCm, notes, updated_at AS updatedAt
       FROM body_measurements WHERE user_id=? ORDER BY date DESC`,
    );
    this.stmtExportAppleDaily = db.prepare("SELECT date, updated_at AS updatedAt, data FROM apple_health_daily WHERE user_id=? ORDER BY date DESC");
    this.stmtExportAppleWorkouts = db.prepare(
      "SELECT id, identity_key AS identityKey, received_at AS receivedAt, ended_at AS endedAt, data FROM apple_health_workouts WHERE user_id=? ORDER BY ended_at DESC, id",
    );
  }

  get(userId: string, kind: EntityKind, id: string): StoredRecord | null {
    const row = this.stmtGet.get(userId, kind, id) as Row | undefined;
    return row ? decode(row) : null;
  }

  list(
    userId: string,
    kind: EntityKind,
    includeDeleted = false,
  ): StoredRecord[] {
    const { seq } = this.stmtLatestSeq.get(userId) as { seq: number };
    const key = `${userId}\0${kind}\0${includeDeleted ? 1 : 0}`;
    const cached = this.listCache.get(key);
    if (cached && cached.seq === seq) {
      this.listCache.delete(key);
      this.listCache.set(key, cached);
      return cached.records.slice();
    }
    const stmt = includeDeleted ? this.stmtListAll : this.stmtListActive;
    const records = (stmt.all(userId, kind) as Row[]).map(decode);
    if (this.listCache.size >= 128) this.listCache.delete(this.listCache.keys().next().value!);
    this.listCache.set(key, { seq, records });
    return records.slice();
  }

  catalogue(userId: string, includeDeleted = false): Exercise[] {
    const custom: Exercise[] = [];
    for (const record of this.list(userId, "exercise", includeDeleted)) {
      const parsed = exerciseSchema.safeParse(record.data);
      if (!parsed.success) continue;
      custom.push({
        ...parsed.data,
        custom: true,
        source: undefined,
      });
    }
    return [...serverCatalogue, ...custom];
  }

  catalogueMap(userId: string, includeDeleted = false): ReadonlyMap<string, Exercise> {
    const custom = this.list(userId, "exercise", includeDeleted);
    if (!custom.length) return serverCatalogueMap;
    const overlay = new Map<string, Exercise>();
    for (const record of custom) {
      const parsed = exerciseSchema.safeParse(record.data);
      if (!parsed.success) continue;
      const exercise: Exercise = {
        ...parsed.data,
        custom: true,
        source: undefined,
      };
      overlay.set(exercise.id, exercise);
    }
    return new LayeredExerciseMap(serverCatalogueMap, overlay);
  }

  operation(userId: string, opId: string) {
    return this.stmtOperation.get(userId, opId) as { request: string; result: string } | undefined;
  }

  mutate(userId: string, mutation: Mutation): MutationResult {
    return this.db.transaction(() => {
      const request = JSON.stringify(mutation);
      const saved = this.operation(userId, mutation.opId);
      if (saved) {
        if (saved.request !== request)
          throw new DomainError("操作 ID 已用于其他请求", 409);
        return JSON.parse(saved.result) as MutationResult;
      }
      const current = this.get(userId, mutation.kind, mutation.id);
      if ((current?.version ?? 0) !== mutation.baseVersion) {
        return {
          opId: mutation.opId,
          status: "conflict" as const,
          record: current,
        };
      }
      let data =
        mutation.deleted && current
          ? current.data
          : schemas[mutation.kind].parse(mutation.data);
      if (mutation.kind === "exercise")
        data = { ...(data as Exercise), custom: true, source: undefined };
      if (mutation.kind === "workout" && !mutation.deleted) {
        const catalogueById = this.catalogueMap(userId, true);
        for (const item of (data as Workout).exercises) {
          const exercise = catalogueById.get(item.exerciseId);
          if (!item.snapshot && exercise)
            item.snapshot = {
              name: exercise.name,
              muscle: exercise.muscle,
              equipment: exercise.equipment,
              mode: exercise.mode,
              volumeMultiplier: exercise.volumeMultiplier,
            };
        }
      }
      this.validate(userId, mutation.kind, mutation.id, data, mutation.deleted);
      const updatedAt = new Date().toISOString();
      const version = (current?.version ?? 0) + 1;
      const encoded = JSON.stringify(data);
      this.stmtUpsertRecord.run(
        userId,
        mutation.kind,
        mutation.id,
        version,
        Number(mutation.deleted),
        encoded,
        updatedAt,
      );
      this.stmtInsertChange.run(
        userId,
        mutation.kind,
        mutation.id,
        version,
        Number(mutation.deleted),
        encoded,
        updatedAt,
      );
      const result: MutationResult = {
        opId: mutation.opId,
        status: "applied",
        record: {
          id: mutation.id,
          kind: mutation.kind,
          version,
          deleted: mutation.deleted,
          data,
          updatedAt,
        },
      };
      this.stmtInsertOp.run(userId, mutation.opId, request, JSON.stringify(result));
      return result;
    })();
  }

  private validate(
    userId: string,
    kind: EntityKind,
    id: string,
    data: unknown,
    deleted: boolean,
  ) {
    if (kind === "exercise" && serverCatalogueMap.has(id))
      throw new DomainError("自定义动作 ID 与内置动作重复");
    try {
      validateRecordIdentity({ kind, id, data });
    } catch (error) {
      throw new DomainError(error instanceof Error ? error.message : "记录 ID 无效");
    }
    if (deleted) return;
    if (kind === "plan" || kind === "template") {
      this.validatePlan(data as Plan, this.catalogueMap(userId));
    } else if (kind === "scheduledDay" && (data as ScheduledDay).mode === "workout") {
      this.validatePlan({ exercises: (data as ScheduledDay).exercises }, this.catalogueMap(userId));
    } else if (kind === "workout") {
      const catalogue = this.catalogueMap(userId);
      if (
        (data as Workout).exercises.some(
          (item) => !catalogue.has(item.exerciseId) && !item.snapshot,
        )
      )
        throw new DomainError("训练包含未知动作");
    } else if (
      kind === "favorite" &&
      !this.catalogueMap(userId).has((data as { exerciseId: string }).exerciseId)
    ) {
      throw new DomainError("收藏动作不存在");
    }
  }

  private validatePlan(
    plan: Plan | { exercises: Routine["exercises"] },
    catalogue: readonly Exercise[] | ReadonlyMap<string, Exercise>,
  ) {
    try {
      validatePlanExercises(plan, catalogue);
    } catch (error) {
      throw new DomainError(
        error instanceof Error ? error.message : "计划动作无效",
      );
    }
  }

  pull(userId: string, after: number, limit = 200) {
    const rows = this.stmtPull.all(userId, after, limit + 1) as Row[];
    const page = rows.slice(0, limit);
    return {
      records: page.map(decode),
      cursor: page.at(-1)?.seq ?? after,
      hasMore: rows.length > limit,
    };
  }

  activePlan(userId: string) {
    const row = this.stmtActivePlan.get(userId) as
      | {
          plan_id: string;
          version: number;
          revision: number;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    const snapshot = this.stmtPlanVersion.get(userId, row.plan_id, row.version) as { data: string };
    return {
      id: row.plan_id,
      version: row.version,
      revision: row.revision,
      updatedAt: row.updated_at,
      data: JSON.parse(snapshot.data) as Plan,
    };
  }

  planSchedule(userId: string) {
    const active = this.activePlan(userId);
    if (!active) return null;
    const rows = this.stmtPlanActivations.all(userId) as { id: string; version: number; updatedAt: string; data: string }[];
    return { ...active, history: rows.map((row) => ({ ...row, data: JSON.parse(row.data) as Plan })) };
  }

  private planRevisionFloor(userId: string) {
    return (this.stmtPlanRevisionFloor.get(userId) as { revision: number } | undefined)?.revision ?? 0;
  }

  applyPlan(
    userId: string,
    id: string,
    version: number,
    expectedRevision: number,
    historical = false,
  ) {
    return this.db.transaction(() => {
      const active = this.activePlan(userId);
      if ((active?.revision ?? 0) !== expectedRevision)
        throw new DomainError("当前计划已变化，请刷新后重试", 409);
      const current = this.get(userId, "plan", id);
      let data: Plan;
      if (historical) {
        const row = this.stmtPlanVersion.get(userId, id, version) as { data: string } | undefined;
        if (!row) throw new DomainError("历史计划版本不存在", 404);
        data = JSON.parse(row.data) as Plan;
      } else {
        if (!current || current.deleted)
          throw new DomainError("计划草稿不存在", 404);
        if (current.version !== version)
          throw new DomainError("计划草稿已变化，请重新预览", 409);
        data = current.data as Plan;
      }
      this.validatePlan(data, this.catalogueMap(userId));
      const now = new Date().toISOString();
      const revision = Math.max(expectedRevision, this.planRevisionFloor(userId)) + 1;
      this.stmtInsertPlanVersion.run(userId, id, version, JSON.stringify(data), now);
      this.stmtUpsertActivePlan.run(userId, id, version, revision, now);
      this.stmtInsertPlanActivation.run(userId, id, version, revision, now);
      return this.planSchedule(userId);
    })();
  }

  createDraft(userId: string, plan: Plan) {
    return this.mutate(userId, {
      opId: randomUUID(),
      id: randomUUID(),
      kind: "plan",
      baseVersion: 0,
      deleted: false,
      data: plan,
    });
  }

  export(userId: string) {
    const records = (this.stmtExportRecords.all(userId) as Row[]).map(decode);
    const versions = this.stmtExportPlanVersions.all(userId) as {
      id: string;
      version: number;
      data: string;
      created_at: string;
    }[];
    const exerciseNotes = this.stmtExportExerciseNotes.all(userId) as {
      exerciseId: string;
      note: string;
      updatedAt: string;
    }[];
    const bodyMeasurements = this.stmtExportMeasurements.all(userId) as {
      date: string;
      waistCm: number | null;
      chestCm: number | null;
      armCm: number | null;
      thighCm: number | null;
      hipCm: number | null;
      notes: string;
      updatedAt: string;
    }[];
    const appleDailyRows = this.stmtExportAppleDaily.all(userId) as {
      date: string;
      updatedAt: string;
      data: string;
    }[];
    const appleHealthDaily = appleDailyRows.map((row) => {
      const parsed = JSON.parse(row.data) as Record<string, unknown>;
      const { syncedWeightValue: _w, syncedBodyFatValue: _f, syncedSleepObservations, ...rest } = parsed;
      const observations = Array.isArray(syncedSleepObservations) ? syncedSleepObservations.flatMap((sample) => {
        const parsed = sleepObservationsSchema.element.safeParse(sample);
        return parsed.success ? [parsed.data] : [];
      }) : [];
      return {
        ...rest, date: row.date, updatedAt: row.updatedAt,
        ...(observations.length ? { sleepObservations: observations } : {}),
      };
    });
    const appleWorkoutRows = this.stmtExportAppleWorkouts.all(userId) as {
      id: string;
      identityKey: string;
      receivedAt: string;
      endedAt: string;
      data: string;
    }[];
    const appleHealthWorkouts = appleWorkoutRows.map((row) => ({
      id: row.id,
      identityKey: row.identityKey,
      receivedAt: row.receivedAt,
      ...(JSON.parse(row.data) as Record<string, unknown>),
    }));
    return {
      format: "ironlog",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      records,
      planVersions: versions.map((row) => ({
        ...row,
        data: JSON.parse(row.data),
      })),
      activePlan: this.planSchedule(userId),
      exerciseNotes,
      bodyMeasurements,
      appleHealthDaily,
      appleHealthWorkouts,
    };
  }

  restoreBackup(
    userId: string,
    rawPayload: unknown,
    options: { mode?: "preview" | "commit"; strategy?: "merge" | "replace" } = {},
  ) {
    const mode = options.mode ?? "preview";
    const strategy = options.strategy ?? "merge";
    let parsed: unknown = rawPayload;
    if (typeof rawPayload === "string") {
      try {
        parsed = JSON.parse(rawPayload);
      } catch {
        throw new DomainError("备份文件不是有效的 JSON 格式", 400);
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new DomainError("备份文件格式无效", 400);
    }
    const parsedObj = parsed as Record<string, unknown>;

    if (!Array.isArray(parsedObj.records) || (parsedObj.format != null && parsedObj.format !== "ironlog")) {
      throw new DomainError("备份文件缺少铁记记录清单", 400);
    }
    if (parsedObj.schemaVersion != null && parsedObj.schemaVersion !== 1) {
      throw new DomainError("暂不支持此版本的铁记备份", 400);
    }
    if (strategy === "replace" && (parsedObj.format !== "ironlog" || parsedObj.schemaVersion !== 1)) {
      throw new DomainError("覆盖恢复需要铁记导出的完整备份", 400);
    }
    if (strategy === "replace" && ["planVersions", "exerciseNotes", "bodyMeasurements", "appleHealthDaily", "appleHealthWorkouts"]
      .some((key) => !Array.isArray(parsedObj[key]))) {
      throw new DomainError("覆盖恢复需要包含全部数据分类的完整备份", 400);
    }

    const rawRecords = Array.isArray(parsedObj.records) ? (parsedObj.records as Record<string, unknown>[]) : [];
    const rawPlanVersions = Array.isArray(parsedObj.planVersions) ? (parsedObj.planVersions as Record<string, unknown>[]) : [];
    const rawActivePlan = parsedObj.activePlan && typeof parsedObj.activePlan === "object" && !Array.isArray(parsedObj.activePlan)
      ? (parsedObj.activePlan as Record<string, unknown>)
      : null;
    const rawNotes = Array.isArray(parsedObj.exerciseNotes) ? (parsedObj.exerciseNotes as Record<string, unknown>[]) : [];
    const rawMeasurements = Array.isArray(parsedObj.bodyMeasurements) ? (parsedObj.bodyMeasurements as Record<string, unknown>[]) : [];
    const rawAppleDaily = Array.isArray(parsedObj.appleHealthDaily) ? (parsedObj.appleHealthDaily as Record<string, unknown>[]) : [];
    const rawAppleWorkouts = Array.isArray(parsedObj.appleHealthWorkouts) ? (parsedObj.appleHealthWorkouts as Record<string, unknown>[]) : [];

    const now = new Date().toISOString();
    const dailyHealthRows = rawAppleDaily.flatMap((item) => {
      if (typeof item?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return [];
      const { date, updatedAt, sleepObservations, syncedSleepObservations: _s,
        syncedWeightValue: _w, syncedBodyFatValue: _f, ...metrics } = item;
      const observations = sleepObservationsSchema.safeParse(sleepObservations ?? []);
      if (!observations.success) throw new DomainError(`备份中 ${date} 的睡眠样本格式无效`, 400);
      return [{ date, updatedAt: backupInstant(updatedAt), metrics, observations: observations.data }];
    });

    // Sort records so custom exercises are validated/restored first, then plans/templates, then workouts/others
    const kindOrder: Record<string, number> = {
      exercise: 0,
      food: 1,
      profile: 2,
      plan: 3,
      template: 4,
      scheduledDay: 5,
      workout: 6,
      diet: 7,
      nutritionDay: 8,
      weight: 9,
      favorite: 10,
      foodFavorite: 11,
      mealTemplate: 12,
    };
    const sortedRecords = [...rawRecords].sort(
      (a, b) => (kindOrder[String(a?.kind ?? "")] ?? 99) - (kindOrder[String(b?.kind ?? "")] ?? 99),
    );

    interface PreparedRecord {
      id: string;
      kind: EntityKind;
      version: number;
      deleted: boolean;
      data: unknown;
      updatedAt: string;
      sourceUpdatedAt: string | null;
    }

    const validRecords: PreparedRecord[] = [];
    const seenRecords = new Set<string>();
    const previewCustomOverlay = new Map<string, Exercise>();

    for (const item of sortedRecords) {
      const kindRes = entityKindSchema.safeParse(item?.kind);
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      if (!id || !kindRes.success) {
        if (strategy === "replace") throw new DomainError("备份中含有无效记录，无法覆盖恢复", 400);
        continue;
      }
      const kind = kindRes.data;
      const key = backupRecordKey({ kind, id });
      if (seenRecords.has(key)) throw new DomainError(`备份中记录 ${key} 重复`, 400);
      seenRecords.add(key);
      const deleted = item.deleted === true || item.deleted === 1;
      const version = typeof item.version === "number" && Number.isSafeInteger(item.version)
        && item.version >= 1 && item.version < Number.MAX_SAFE_INTEGER ? item.version : 1;
      const sourceUpdatedAt = backupInstant(item.updatedAt);
      const updatedAt = sourceUpdatedAt ?? now;

      const parsedData = schemas[kind].safeParse(item.data);
      if (!parsedData.success && !deleted) {
        throw new DomainError(`备份中记录 ${kind}:${id} 数据结构无效`, 400);
      }
      let data: unknown = parsedData.success ? parsedData.data : item.data;
      if (kind === "exercise" && !deleted && data && typeof data === "object") {
        const ex: Exercise = { ...(data as Exercise), custom: true, source: undefined };
        data = ex;
        if (serverCatalogueMap.has(id)) {
          throw new DomainError(`自定义动作 ID (${id}) 与内置动作冲突`, 400);
        }
        previewCustomOverlay.set(id, ex);
      }

      try {
        validateRecordIdentity({ kind, id, data });
      } catch (err) {
        throw new DomainError(err instanceof Error ? err.message : `记录 ${kind}:${id} ID 校验失败`, 400);
      }

      if (!deleted && mode === "preview") {
        const baseCat = strategy === "replace" ? serverCatalogueMap : this.catalogueMap(userId);
        const previewCat = new LayeredExerciseMap(baseCat, previewCustomOverlay);
        if (kind === "plan" || kind === "template") {
          this.validatePlan(data as Plan, previewCat);
        } else if (kind === "scheduledDay" && (data as ScheduledDay).mode === "workout") {
          this.validatePlan({ exercises: (data as ScheduledDay).exercises }, previewCat);
        }
      }

      validRecords.push({ id, kind, version, deleted, data, updatedAt, sourceUpdatedAt });
    }

    const counts = {
      workouts: validRecords.filter((r) => r.kind === "workout" && !r.deleted).length,
      diets: validRecords.filter((r) => r.kind === "diet" && !r.deleted).length,
      weights: validRecords.filter((r) => r.kind === "weight" && !r.deleted).length,
      plans: validRecords.filter((r) => r.kind === "plan" && !r.deleted).length,
      templates: validRecords.filter((r) => r.kind === "template" && !r.deleted).length,
      customExercises: validRecords.filter((r) => r.kind === "exercise" && !r.deleted).length,
      measurements: rawMeasurements.length,
      exerciseNotes: rawNotes.length,
      appleDaily: dailyHealthRows.length,
      appleWorkouts: rawAppleWorkouts.length,
      totalRecords: validRecords.length,
    };

    if (mode === "preview") {
      let toImport = 0;
      let toUpdate = 0;
      let unchanged = 0;
      for (const rec of validRecords) {
        const existing = this.get(userId, rec.kind, rec.id);
        if (!existing) toImport++;
        else if (strategy === "replace" || newerBackupRecord(rec.sourceUpdatedAt, existing.updatedAt)) toUpdate++;
        else unchanged++;
      }
      return {
        mode: "preview" as const,
        strategy,
        exportedAt: typeof parsedObj.exportedAt === "string" ? parsedObj.exportedAt : null,
        counts,
        diff: { toImport, toUpdate, unchanged },
      };
    }

    // Commit inside atomic SQLite transaction
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    this.db.transaction(() => {
      const writeRestored = (record: StoredRecord) => {
        const args = [userId, record.kind, record.id, record.version, Number(record.deleted), JSON.stringify(record.data), record.updatedAt];
        this.stmtUpsertRecord.run(...args);
        this.stmtInsertChange.run(...args);
        this.listCache.clear();
      };
      type RecordRevision = Pick<StoredRecord, "kind" | "id" | "version">;
      const priorRecords = new Map<string, RecordRevision>();
      if (strategy === "replace") {
        const activeRevision = this.activePlan(userId)?.revision ?? 0;
        if (activeRevision > 0) this.stmtSavePlanRevisionFloor.run(userId, activeRevision);
        const revisions = this.db.prepare("SELECT kind, id, version FROM records WHERE user_id = ?").all(userId) as RecordRevision[];
        for (const record of revisions) {
          priorRecords.set(backupRecordKey(record), record);
        }
        this.db.prepare(
          "UPDATE apple_health_events SET workout_id = NULL WHERE device_id IN (SELECT id FROM apple_health_devices WHERE user_id = ?)",
        ).run(userId);
        this.db.prepare("DELETE FROM apple_health_receipts WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM apple_health_workouts WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM apple_health_daily WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM body_measurements WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM exercise_notes WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM plan_activations WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM active_plans WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM plan_versions WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM operations WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM changes WHERE user_id = ?").run(userId);
        this.db.prepare("DELETE FROM records WHERE user_id = ?").run(userId);
        this.listCache.clear();
      }

      for (const rec of validRecords) {
        const key = backupRecordKey(rec);
        const existing = strategy === "merge" ? this.get(userId, rec.kind, rec.id) : null;
        if (existing && !newerBackupRecord(rec.sourceUpdatedAt, existing.updatedAt)) {
          skippedCount++;
          continue;
        }
        const previous = priorRecords.get(key) ?? existing;
        priorRecords.delete(key);
        this.validate(userId, rec.kind, rec.id, rec.data, rec.deleted);
        const version = strategy === "replace"
          ? Math.max(previous?.version ?? 0, rec.version) + 1
          : Math.max((previous?.version ?? 0) + 1, rec.version);
        writeRestored({ ...rec, version });
        if (previous) updatedCount++;
        else importedCount++;
      }

      for (const previous of priorRecords.values()) {
        // A deletion must still reach clients that synced before the replacement. Keep identity only.
        writeRestored({
          ...previous, version: previous.version + 1, deleted: true,
          data: deletionIdentityData(previous), updatedAt: now,
        });
      }

      // Restore planVersions
      for (const pv of rawPlanVersions) {
        if (!pv || typeof pv !== "object") continue;
        const pid = typeof pv.id === "string" ? pv.id : "";
        const pver = typeof pv.version === "number" && pv.version >= 1 ? Math.floor(pv.version) : 1;
        const pcreated = typeof pv.created_at === "string"
          ? pv.created_at
          : typeof pv.createdAt === "string" ? pv.createdAt : now;
        const parsedPlan = planSchema.safeParse(pv.data);
        if (pid && parsedPlan.success) {
          this.stmtInsertPlanVersion.run(userId, pid, pver, JSON.stringify(parsedPlan.data), pcreated);
        }
      }

      // Restore activePlan if present
      if (rawActivePlan && typeof rawActivePlan.id === "string") {
        const parsedActiveData = planSchema.safeParse(rawActivePlan.data);
        if (parsedActiveData.success && (strategy === "replace" || !this.activePlan(userId))) {
          const aid = rawActivePlan.id;
          const aver = typeof rawActivePlan.version === "number" && rawActivePlan.version >= 1 ? Math.floor(rawActivePlan.version) : 1;
          const rawRevision = rawActivePlan.revision;
          const arev = typeof rawRevision === "number" && Number.isSafeInteger(rawRevision)
            && rawRevision >= 1 && rawRevision < Number.MAX_SAFE_INTEGER ? rawRevision : 1;
          const aupdated = backupInstant(rawActivePlan.updatedAt) ?? now;
          this.stmtInsertPlanVersion.run(userId, aid, aver, JSON.stringify(parsedActiveData.data), aupdated);
          const history = (Array.isArray(rawActivePlan.history) ? rawActivePlan.history as Record<string, unknown>[] : [])
            .flatMap((entry) => {
              const id = typeof entry?.id === "string" ? entry.id : "";
              const version = typeof entry?.version === "number" && Number.isSafeInteger(entry.version) && entry.version >= 1 ? entry.version : 1;
              const data = planSchema.safeParse(entry?.data);
              return id && data.success
                ? [{ id, version, updatedAt: backupInstant(entry.updatedAt) ?? aupdated, data: data.data }]
                : [];
            });
          const last = history.at(-1);
          if (last?.id === aid && last.version === aver && last.updatedAt === aupdated) history.pop();
          const floor = this.planRevisionFloor(userId);
          const finalRev = Math.max(arev, history.length + 1, floor + 1);
          history.forEach((entry, index) => {
            this.stmtInsertPlanVersion.run(userId, entry.id, entry.version, JSON.stringify(entry.data), entry.updatedAt);
            this.stmtInsertPlanActivation.run(userId, entry.id, entry.version, index + 1, entry.updatedAt);
          });
          this.stmtUpsertActivePlan.run(userId, aid, aver, finalRev, aupdated);
          this.stmtInsertPlanActivation.run(userId, aid, aver, finalRev, aupdated);
        }
      }

      // Restore exerciseNotes
      const stmtUpsertNote = this.db.prepare(
        `INSERT INTO exercise_notes VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, exercise_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
         WHERE ? AND (julianday(exercise_notes.updated_at) IS NULL OR julianday(excluded.updated_at) > julianday(exercise_notes.updated_at))`,
      );
      for (const noteItem of rawNotes) {
        const exId = typeof noteItem?.exerciseId === "string" ? noteItem.exerciseId.trim() : "";
        const note = typeof noteItem?.note === "string" ? noteItem.note : "";
        const upAt = backupInstant(noteItem?.updatedAt);
        if (exId && note) stmtUpsertNote.run(userId, exId, note, upAt ?? now, Number(upAt != null));
      }

      // Restore bodyMeasurements
      const stmtUpsertMeas = this.db.prepare(
        `INSERT INTO body_measurements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           waist_cm = excluded.waist_cm, chest_cm = excluded.chest_cm, arm_cm = excluded.arm_cm,
           thigh_cm = excluded.thigh_cm, hip_cm = excluded.hip_cm, notes = excluded.notes, updated_at = excluded.updated_at
         WHERE ? AND (julianday(body_measurements.updated_at) IS NULL OR julianday(excluded.updated_at) > julianday(body_measurements.updated_at))`,
      );
      const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      for (const m of rawMeasurements) {
        const date = typeof m?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : "";
        if (!date) continue;
        const upAt = backupInstant(m.updatedAt);
        stmtUpsertMeas.run(
          userId,
          date,
          numOrNull(m.waistCm),
          numOrNull(m.chestCm),
          numOrNull(m.armCm),
          numOrNull(m.thighCm),
          numOrNull(m.hipCm),
          typeof m.notes === "string" ? m.notes : "",
          upAt ?? now,
          Number(upAt != null),
        );
      }

      // Restore appleHealthDaily
      const stmtDailyByDate = this.db.prepare("SELECT updated_at, data FROM apple_health_daily WHERE user_id = ? AND date = ?");
      const stmtUpsertDaily = this.db.prepare(
        `INSERT INTO apple_health_daily VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
      );
      for (const { date, updatedAt, metrics, observations } of dailyHealthRows) {
        const existing = stmtDailyByDate.get(userId, date) as { updated_at: string; data: string } | undefined;
        const saved = existing ? JSON.parse(existing.data) as Record<string, unknown> : {};
        const savedSleep = sleepObservationsSchema.safeParse(saved.syncedSleepObservations);
        const currentObservations = savedSleep.success ? savedSleep.data : [];
        const useIncoming = !existing || newerBackupRecord(updatedAt, existing.updated_at);
        const backfillSleep = !currentObservations.length && observations.length > 0;
        if (!useIncoming && !backfillSleep) continue;
        const next: Record<string, unknown> = useIncoming ? { ...saved, ...metrics, date } : { ...saved };
        const samples = (useIncoming || backfillSleep) && observations.length > 0 ? observations : currentObservations;
        if (samples.length) next.syncedSleepObservations = samples;
        stmtUpsertDaily.run(userId, date, useIncoming ? updatedAt ?? now : existing!.updated_at, JSON.stringify(next));
      }

      // Restore appleHealthWorkouts
      const stmtAppleById = this.db.prepare("SELECT id, received_at FROM apple_health_workouts WHERE user_id = ? AND id = ?");
      const stmtAppleByIdentity = this.db.prepare("SELECT id, received_at FROM apple_health_workouts WHERE user_id = ? AND identity_key = ?");
      const stmtAppleIdInUse = this.db.prepare("SELECT 1 FROM apple_health_workouts WHERE id = ?");
      const stmtInsertApple = this.db.prepare("INSERT INTO apple_health_workouts VALUES (?, ?, ?, ?, ?, ?)");
      const stmtUpdateApple = this.db.prepare("UPDATE apple_health_workouts SET ended_at = ?, received_at = ?, data = ? WHERE user_id = ? AND id = ?");
      for (const w of rawAppleWorkouts) {
        if (!w || typeof w !== "object") continue;
        const inputId = typeof w.id === "string" ? w.id.trim() : "";
        const endedAt = backupInstant(w.endedAt);
        const startedAt = backupInstant(w.startedAt);
        if (!endedAt || !startedAt || startedAt >= endedAt || typeof w.activityType !== "string" || !w.activityType.trim()) continue;
        const receivedAt = backupInstant(w.receivedAt);
        const externalId = w.externalWorkoutId ?? w.externalId;
        const identity = {
          externalWorkoutId: typeof externalId === "string" && externalId.trim() ? externalId.trim() : null,
          activityType: w.activityType,
          startedAt,
          endedAt,
        };
        const rawIdentityKey = typeof w.identityKey === "string" ? w.identityKey.trim() : "";
        const identityKey = rawIdentityKey || appleWorkoutIdentity(identity);
        const { id: _id, receivedAt: _rec, identityKey: _ikey, ...rawPayload } = w;
        const sanitizeNonneg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
        const rawHr = rawPayload.heartRate as Record<string, unknown> | null | undefined;
        const cleanHr = rawHr && typeof rawHr === "object"
          ? {
              ...(sanitizeNonneg(rawHr.avgBpm) != null ? { avgBpm: sanitizeNonneg(rawHr.avgBpm) } : {}),
              ...(sanitizeNonneg(rawHr.minBpm) != null ? { minBpm: sanitizeNonneg(rawHr.minBpm) } : {}),
              ...(sanitizeNonneg(rawHr.maxBpm) != null ? { maxBpm: sanitizeNonneg(rawHr.maxBpm) } : {}),
              ...(rawHr.sampleCount != null && Number.isInteger(rawHr.sampleCount) && Number(rawHr.sampleCount) > 0
                ? { sampleCount: Number(rawHr.sampleCount) }
                : {}),
              ...(rawHr.method === "workout_statistics" || rawHr.method === "window_samples"
                ? { method: rawHr.method }
                : {}),
            }
          : null;
        const cleanDuration = sanitizeNonneg(rawPayload.durationSeconds);
        const cleanEnergy = sanitizeNonneg(rawPayload.activeEnergyKcal);
        const cleanDistance = sanitizeNonneg(rawPayload.distanceMeters);
        const workoutPayload = {
          ...rawPayload,
          ...(cleanDuration != null ? { durationSeconds: Math.round(cleanDuration) } : { durationSeconds: undefined }),
          ...(cleanEnergy != null ? { activeEnergyKcal: cleanEnergy } : { activeEnergyKcal: undefined }),
          ...(cleanDistance != null ? { distanceMeters: cleanDistance } : { distanceMeters: undefined }),
          ...(cleanHr && Object.keys(cleanHr).length > 0 ? { heartRate: cleanHr } : { heartRate: undefined }),
        };
        const existing = (stmtAppleByIdentity.get(userId, identityKey) ?? (
          inputId ? stmtAppleById.get(userId, inputId) : undefined
        )) as { id: string; received_at: string } | undefined;
        const data = JSON.stringify({ ...workoutPayload, ...identity });
        if (existing) {
          if (newerBackupRecord(receivedAt, existing.received_at))
            stmtUpdateApple.run(endedAt, receivedAt, data, userId, existing.id);
        } else {
          const id = inputId && !stmtAppleIdInUse.get(inputId) ? inputId : randomUUID();
          stmtInsertApple.run(id, userId, identityKey, endedAt, receivedAt ?? now, data);
        }
      }

      this.listCache.clear();
    }).immediate();

    return {
      mode: "commit" as const,
      strategy,
      exportedAt: typeof parsedObj.exportedAt === "string" ? parsedObj.exportedAt : null,
      counts,
      imported: importedCount,
      updated: updatedCount,
      skipped: skippedCount,
    };
  }
}
