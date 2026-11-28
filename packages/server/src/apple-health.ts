import { createHash, randomBytes, randomUUID } from "node:crypto";
import { latestAppleWorkoutAnnotation, type AppleWorkoutAnnotation, type AppleWorkoutAnnotationInput } from "@ironlog/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import { parseFlexibleInstant, parseTolerantNumber } from "./apple-health-daily.js";
import { appleWorkoutIdentity, canonicalAppleActivityType } from "./apple-workout-identity.js";
export { parseFlexibleInstant };
import type { Db } from "./db.js";
import { DomainError } from "./store.js";

type Stmt = Database.Statement<unknown[], unknown>;

const dayMs = 86_400_000;
const MIN_TRIGGER_WORKOUT_SECONDS = 180;
const MAX_TRIGGER_WORKOUT_SECONDS = 6 * 3600;
const MAX_WINDOW_KCAL_PER_MIN = 35;
const WEB_STRENGTH_TYPES = new Set(["traditionalstrengthtraining", "functionalstrengthtraining", "coretraining"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const strictIsoInstant = z.iso.datetime({ offset: true });

const EXPLICIT_ISO_LIKE_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/;

function resolveEventInstantOrNow(rawValue: unknown): unknown {
  const parsed = parseFlexibleInstant(rawValue);
  if (parsed) return parsed;
  if (typeof rawValue === "string" && EXPLICIT_ISO_LIKE_RE.test(rawValue.trim())) return rawValue;
  return new Date().toISOString();
}

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const activityType = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/);
const environment = z.enum(["indoor", "outdoor", "unknown"]).default("unknown");
const inputId = z.string().trim().min(1).max(128).nullish();
const bpm = z.number().positive().max(300).nullish();
const heartRate = z.object({
  avgBpm: bpm, minBpm: bpm, maxBpm: bpm,
  sampleCount: z.number().int().positive().max(1_000_000).nullish(),
  method: z.enum(["workout_statistics", "window_samples"]).nullish(),
}).nullish().refine((value) => {
  if (!value) return true;
  const { minBpm, avgBpm, maxBpm } = value;
  return (minBpm == null || maxBpm == null || minBpm <= maxBpm) &&
    (minBpm == null || avgBpm == null || minBpm <= avgBpm) &&
    (maxBpm == null || avgBpm == null || avgBpm <= maxBpm);
}, "心率范围不正确");
const metrics = {
  activeEnergyKcal: z.number().min(0).max(20_000).nullish(),
  energyKind: z.enum(["workout", "window_estimate"]).nullish(),
  distanceMeters: z.number().min(0).max(2_000_000).nullish(),
  heartRate,
};
const timeZone = z.string().min(1).max(64).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
}, "时区需要使用 IANA 标识");

/** Normalize optional tolerant shortcut fields (strings with localized units or blanks) into standard workout metrics. */
function normalizeShortcutMetrics(
  raw: Record<string, unknown>,
  { isEvent = false }: { isEvent?: boolean } = {},
) {
  const activeEnergyKcal = typeof raw.activeEnergyKcal === "number"
    ? raw.activeEnergyKcal
    : parseTolerantNumber(raw.activeEnergyKcal, "活动能量", { min: 0, max: 20_000, digits: 1 });
  const rawMeters = typeof raw.distanceMeters === "number"
    ? raw.distanceMeters
    : parseTolerantNumber(raw.distanceMeters, "训练距离", { min: 0, max: 2_000_000, digits: 1 });
  const km = parseTolerantNumber(raw.distanceKm, "训练距离", { min: 0, max: 2_000, digits: 3 });
  const distanceMeters = rawMeters ?? (km != null ? Math.round(km * 1000) : undefined);

  let nextHeartRate = raw.heartRate;
  if (nextHeartRate === undefined || nextHeartRate === null) {
    const avgBpm = parseTolerantNumber(raw.avgBpm, "平均心率", { min: 20, max: 300, integer: true });
    const minBpm = parseTolerantNumber(raw.minBpm, "最低心率", { min: 20, max: 300, integer: true });
    const maxBpm = parseTolerantNumber(raw.maxBpm, "最高心率", { min: 20, max: 300, integer: true });
    const sampleCount = parseTolerantNumber(raw.heartRateSamples, "心率样本数", { min: 1, max: 1_000_000, integer: true });
    if (avgBpm != null || minBpm != null || maxBpm != null) {
      nextHeartRate = {
        ...(avgBpm != null ? { avgBpm } : {}),
        ...(minBpm != null ? { minBpm } : {}),
        ...(maxBpm != null ? { maxBpm } : {}),
        ...(sampleCount != null ? { sampleCount } : {}),
        method: raw.heartRateMethod === "workout_statistics" ? "workout_statistics" : "window_samples",
      };
    }
  }
  const rawDurationSec = typeof raw.durationSeconds === "number"
    ? raw.durationSeconds
    : parseTolerantNumber(raw.durationSeconds, "训练时长", { min: 1, max: 7 * 86400, integer: true });
  const durationMins = parseTolerantNumber(raw.durationMinutes, "训练时长", { min: 0.1, max: 7 * 1440, digits: 2 });
  const durationSeconds = rawDurationSec ?? (durationMins != null ? Math.round(durationMins * 60) : undefined);

  const normalized: Record<string, unknown> = { ...raw };
  if (String(raw.schemaVersion ?? "").trim() === "1") normalized.schemaVersion = 1;
  if (typeof raw.activityType === "string") normalized.activityType = raw.activityType.trim();
  if (typeof raw.event === "string") normalized.event = raw.event.trim().toLowerCase();
  if (raw.environment === "" || raw.environment === null) delete normalized.environment;
  if (raw.timeZone === "" || raw.timeZone === null) delete normalized.timeZone;
  if (raw.energyKind === "" || raw.energyKind === null) delete normalized.energyKind;
  if (raw.durationKind === "" || raw.durationKind === null) delete normalized.durationKind;

  if (isEvent) {
    normalized.occurredAt = resolveEventInstantOrNow(raw.occurredAt);
  } else if (raw.source === "shortcut") {
    if (raw.captureMethod === "trigger") {
      const ended = resolveEventInstantOrNow(raw.endedAt);
      normalized.endedAt = ended;
      const parsedStart = parseFlexibleInstant(raw.startedAt);
      if (parsedStart) {
        normalized.startedAt = parsedStart;
      } else if (!(typeof raw.startedAt === "string" && EXPLICIT_ISO_LIKE_RE.test(raw.startedAt.trim()))) {
        const endMs = typeof ended === "string" ? Date.parse(ended) : Date.now();
        const fallbackSec = typeof durationSeconds === "number" && durationSeconds > 0 ? durationSeconds : 45 * 60;
        normalized.startedAt = new Date(endMs - fallbackSec * 1000).toISOString();
      }
    } else {
      for (const key of ["occurredAt", "startedAt", "endedAt"] as const) {
        const parsed = parseFlexibleInstant(raw[key]);
        if (parsed) normalized[key] = parsed;
      }
    }
  }
  if (durationSeconds !== undefined) normalized.durationSeconds = durationSeconds;
  else if (raw.durationSeconds !== null) delete normalized.durationSeconds;
  delete normalized.durationMinutes;
  if (activeEnergyKcal !== undefined) normalized.activeEnergyKcal = activeEnergyKcal;
  else if (raw.activeEnergyKcal !== null) delete normalized.activeEnergyKcal;
  if (distanceMeters !== undefined) normalized.distanceMeters = distanceMeters;
  else if (raw.distanceMeters !== null) delete normalized.distanceMeters;
  delete normalized.distanceKm;
  if (nextHeartRate !== undefined) normalized.heartRate = nextHeartRate;
  else if (raw.heartRate !== null) delete normalized.heartRate;
  return normalized;
}

export const appleWorkoutInput = z.preprocess(
  (value) => (value && typeof value === "object" && !Array.isArray(value)
    ? normalizeShortcutMetrics(value as Record<string, unknown>) : value),
  z.object({
    schemaVersion: z.literal(1),
    captureMethod: z.enum(["workout", "trigger"]),
    externalWorkoutId: inputId,
    clientSessionId: inputId,
    activityType, environment,
    startedAt: instant, endedAt: instant,
    timeZone: timeZone.nullish(),
    durationSeconds: z.number().int().positive().max(7 * 86400).nullish(),
    durationKind: z.enum(["workout_active", "event_elapsed"]).nullish(),
    ...metrics,
  }).refine((value) => {
    const elapsed = (Date.parse(value.endedAt) - Date.parse(value.startedAt)) / 1000;
    return elapsed > 0 && elapsed <= 7 * 86400 &&
      (value.durationSeconds == null || value.durationSeconds <= Math.ceil(elapsed)) &&
      (value.captureMethod === "workout" || value.durationKind !== "workout_active");
  }, "训练起止时间或时长不正确"),
);

export const appleEventInput = z.preprocess(
  (value) => (value && typeof value === "object" && !Array.isArray(value)
    ? normalizeShortcutMetrics(value as Record<string, unknown>, { isEvent: true }) : value),
  z.object({
    schemaVersion: z.literal(1),
    event: z.enum(["start", "end"]),
    activityType, environment,
    occurredAt: instant,
    timeZone: timeZone.nullish(),
    ...metrics,
  }),
);
export type AppleWorkoutInput = z.infer<typeof appleWorkoutInput>;
export type AppleWorkoutData = AppleWorkoutInput & { annotation?: AppleWorkoutAnnotation };
type EventInput = z.infer<typeof appleEventInput>;
export const appleWebSessionStartInput = z.object({
  activityType,
  environment,
  startedAt: z.iso.datetime({ offset: true }).optional(),
  onlyIfIdle: z.boolean().optional(),
});

function inferDistanceMode(rawType: string): "foot" | "cycling" | "swimming" | "" {
  const key = rawType.trim().toLowerCase();
  if (key === "running" || key === "walking" || key === "hiking") return "foot";
  if (key === "cycling") return "cycling";
  if (key === "swimming") return "swimming";
  return "";
}

type Device = { id: string; userId: string };

function mergeHeartRate(first: AppleWorkoutInput["heartRate"], second: AppleWorkoutInput["heartRate"]) {
  if (!first || !second) return first ?? second;
  if (first.method && second.method && first.method !== second.method)
    return second.method === "workout_statistics" ? second : first;

  const merged = heartRate.safeParse({
    avgBpm: first.avgBpm ?? second.avgBpm,
    minBpm: first.minBpm ?? second.minBpm,
    maxBpm: first.maxBpm ?? second.maxBpm,
    sampleCount: first.sampleCount ?? second.sampleCount,
    method: first.method ?? second.method,
  });
  return merged.success ? merged.data : first;
}

export function mergeAppleMeasurements(primary: AppleWorkoutData, fallback: AppleWorkoutData): AppleWorkoutData {
  const elapsed = Math.ceil((Date.parse(primary.endedAt) - Date.parse(primary.startedAt)) / 1000);
  const durationFromFallback = fallback.durationSeconds != null && fallback.durationSeconds <= elapsed &&
    (primary.durationSeconds == null || (fallback.durationKind === "workout_active" && primary.durationKind !== "workout_active"));
  const energyFromFallback = fallback.activeEnergyKcal != null &&
    (primary.activeEnergyKcal == null || (fallback.energyKind === "workout" && primary.energyKind !== "workout"));
  const duration = durationFromFallback ? fallback : primary;
  const energy = energyFromFallback ? fallback : primary;
  // A source tag can supplement an equal value without relabeling a different measurement.
  return {
    ...primary,
    environment: primary.environment === "unknown" ? fallback.environment : primary.environment,
    timeZone: primary.timeZone ?? fallback.timeZone,
    durationSeconds: duration.durationSeconds,
    durationKind: duration.durationKind ?? (duration.durationSeconds != null && primary.durationSeconds === fallback.durationSeconds
      ? (durationFromFallback ? primary.durationKind : fallback.durationKind) : undefined),
    activeEnergyKcal: energy.activeEnergyKcal,
    energyKind: energy.energyKind ?? (energy.activeEnergyKcal != null && primary.activeEnergyKcal === fallback.activeEnergyKcal
      ? (energyFromFallback ? primary.energyKind : fallback.energyKind) : undefined),
    distanceMeters: primary.distanceMeters ?? fallback.distanceMeters,
    heartRate: mergeHeartRate(primary.heartRate, fallback.heartRate),
    annotation: latestAppleWorkoutAnnotation(primary.annotation, fallback.annotation),
  };
}

const APPLE_TELEMETRY_KEYS = [
  "steps", "activeEnergyKcal", "restingEnergyKcal", "totalEnergyKcal",
  "distanceKm", "flightsClimbed", "exerciseMinutes", "standHours", "mindfulMinutes",
  "sleepMinutes", "sleepDeepMinutes", "sleepRemMinutes", "sleepCoreMinutes", "sleepInBedMinutes",
  "weightKg", "bodyFatPct", "leanBodyMassKg", "bmi", "waistCm",
  "heartRateBpm", "restingHeartRateBpm", "hrvMs", "vo2Max", "bloodOxygenPct", "respiratoryRate",
] as const;

export class AnnotationConflictError extends DomainError {
  constructor(
    message: string,
    public readonly current: AppleWorkoutAnnotation | null,
  ) {
    super(message, 409);
  }
}

export class AppleHealth {
  private uploadMinute = 0;
  private readonly uploads = new Map<string, number>();
  private readonly stmtInsertDevice: Stmt;
  private readonly stmtIdentifyDevice: Stmt;
  private readonly stmtActiveDeviceIds: Stmt;
  private readonly stmtListDevices: Stmt;
  private readonly stmtRevokeDevice: Stmt;
  private readonly stmtHasDevice: Stmt;
  private readonly stmtHasWorkout: Stmt;
  private readonly stmtListDailyData: Stmt;
  private readonly stmtLatestDaily: Stmt;
  private readonly stmtRecentWorkouts: Stmt;
  private readonly stmtLatestWorkout: Stmt;
  private readonly stmtLatestActiveUserEvent: Stmt;
  private readonly stmtGetEvent: Stmt;
  private readonly stmtGetLatestActiveEvent: Stmt;
  private readonly stmtGetEventFull: Stmt;
  private readonly stmtCloseEventNull: Stmt;
  private readonly stmtCloseDanglingEvents: Stmt;
  private readonly stmtUpsertEventStart: Stmt;
  private readonly stmtCloseEventWithWorkout: Stmt;
  private readonly stmtGetReceipt: Stmt;
  private readonly stmtGetWorkoutByIdentity: Stmt;
  private readonly stmtGetWorkoutById: Stmt;
  private readonly stmtInsertWorkout: Stmt;
  private readonly stmtUpdateWorkoutData: Stmt;
  private readonly stmtDeleteWorkout: Stmt;
  private readonly stmtInsertDeletedIdentity: Stmt;
  private readonly stmtIsDeletedIdentity: Stmt;
  private readonly stmtClearWorkoutReceipts: Stmt;
  private readonly stmtUnlinkEventWorkout: Stmt;
  private readonly stmtClearUserActiveEvents: Stmt;
  private readonly stmtCloseLaunchGroupEvents: Stmt;
  private readonly stmtGetLatestDeviceEvent: Stmt;
  private readonly stmtInsertReceipt: Stmt;

  constructor(private db: Db) {
    this.stmtInsertDevice = db.prepare("INSERT INTO apple_health_devices VALUES (?, ?, ?, ?, ?, ?, NULL)");
    this.stmtIdentifyDevice = db.prepare(`SELECT id, user_id AS userId FROM apple_health_devices
      WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`);
    this.stmtActiveDeviceIds = db.prepare(`SELECT id FROM apple_health_devices
      WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC`);
    this.stmtListDevices = db.prepare(`SELECT id, label, created_at AS createdAt, expires_at AS expiresAt
      FROM apple_health_devices WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC`);
    this.stmtRevokeDevice = db.prepare("UPDATE apple_health_devices SET revoked_at=? WHERE user_id=? AND id=? AND revoked_at IS NULL");
    this.stmtHasDevice = db.prepare("SELECT 1 FROM apple_health_devices WHERE user_id=? AND revoked_at IS NULL LIMIT 1");
    this.stmtHasWorkout = db.prepare("SELECT 1 FROM apple_health_workouts WHERE user_id=? LIMIT 1");
    this.stmtListDailyData = db.prepare("SELECT data FROM apple_health_daily WHERE user_id=? ORDER BY date DESC LIMIT 60");
    this.stmtLatestDaily = db.prepare(`SELECT date, updated_at AS updatedAt, data
      FROM apple_health_daily WHERE user_id=? ORDER BY updated_at DESC, date DESC LIMIT 60`);
    this.stmtRecentWorkouts = db.prepare(`SELECT id, data, received_at AS receivedAt FROM apple_health_workouts
      WHERE user_id=? ORDER BY ended_at DESC, id LIMIT 30`);
    this.stmtLatestWorkout = db.prepare(`SELECT id, ended_at AS endedAt, received_at AS receivedAt, data
      FROM apple_health_workouts WHERE user_id=? ORDER BY received_at DESC, ended_at DESC LIMIT 1`);
    this.stmtLatestActiveUserEvent = db.prepare(`SELECT e.activity_type AS activityType, e.started_at AS startedAt,
      e.started_environment AS environment, d.label AS deviceLabel
      FROM apple_health_events e
      JOIN apple_health_devices d ON d.id = e.device_id
      WHERE d.user_id=? AND d.revoked_at IS NULL AND (e.ended_at IS NULL OR e.started_at > e.ended_at)
      ORDER BY e.started_at DESC LIMIT 1`);
    this.stmtGetEvent = db.prepare(`SELECT started_at AS startedAt, started_environment AS environment,
      ended_at AS endedAt FROM apple_health_events WHERE device_id=? AND activity_type=?`);
    this.stmtGetLatestActiveEvent = db.prepare(`SELECT activity_type AS activityType, started_at AS startedAt,
      started_environment AS environment, ended_at AS endedAt
      FROM apple_health_events
      WHERE device_id=? AND (ended_at IS NULL OR started_at > ended_at)
      ORDER BY started_at DESC LIMIT 1`);
    this.stmtGetLatestDeviceEvent = db.prepare(`SELECT started_at AS startedAt, ended_at AS endedAt
      FROM apple_health_events
      WHERE device_id=? AND (ended_at IS NULL OR started_at > ended_at OR workout_id IS NOT NULL)
      ORDER BY started_at DESC LIMIT 1`);
    this.stmtGetEventFull = db.prepare(`SELECT started_at AS startedAt, started_environment AS environment,
        ended_at AS endedAt, workout_id AS workoutId, launch_group_id AS launchGroupId
        FROM apple_health_events WHERE device_id=? AND activity_type=?`);
    this.stmtCloseEventNull = db.prepare("UPDATE apple_health_events SET ended_at=?, workout_id=NULL WHERE device_id=? AND activity_type=?");
    this.stmtCloseDanglingEvents = db.prepare(`UPDATE apple_health_events SET ended_at=?, workout_id=NULL
          WHERE device_id=? AND activity_type<>? AND (ended_at IS NULL OR started_at > ended_at) AND started_at <= ?`);
    this.stmtUpsertEventStart = db.prepare(`INSERT INTO apple_health_events (device_id, activity_type, started_at, started_environment, ended_at, workout_id, launch_group_id)
            VALUES (?, ?, ?, ?, NULL, NULL, ?)
            ON CONFLICT(device_id, activity_type) DO UPDATE SET
              started_at=excluded.started_at, started_environment=excluded.started_environment,
              ended_at=NULL, workout_id=NULL, launch_group_id=excluded.launch_group_id`);
    this.stmtCloseEventWithWorkout = db.prepare("UPDATE apple_health_events SET ended_at=?, workout_id=? WHERE device_id=? AND activity_type=?");
    this.stmtCloseLaunchGroupEvents = db.prepare(
      "UPDATE apple_health_events SET ended_at=?, workout_id=? WHERE launch_group_id=? AND activity_type=? AND (ended_at IS NULL OR started_at > ended_at)",
    );
    this.stmtGetReceipt = db.prepare("SELECT digest, workout_id AS workoutId FROM apple_health_receipts WHERE user_id=? AND request_key=?");
    this.stmtGetWorkoutByIdentity = db.prepare("SELECT id, data FROM apple_health_workouts WHERE user_id=? AND identity_key=?");
    this.stmtGetWorkoutById = db.prepare("SELECT identity_key AS identityKey, data FROM apple_health_workouts WHERE user_id=? AND id=?");
    this.stmtInsertWorkout = db.prepare("INSERT INTO apple_health_workouts VALUES (?, ?, ?, ?, ?, ?)");
    this.stmtUpdateWorkoutData = db.prepare("UPDATE apple_health_workouts SET data=? WHERE id=?");
    this.stmtDeleteWorkout = db.prepare("DELETE FROM apple_health_workouts WHERE user_id=? AND id=?");
    this.stmtInsertDeletedIdentity = db.prepare(
      "INSERT OR REPLACE INTO apple_health_deleted (user_id, identity_key, deleted_at) VALUES (?, ?, ?)",
    );
    this.stmtIsDeletedIdentity = db.prepare(
      "SELECT deleted_at AS deletedAt FROM apple_health_deleted WHERE user_id=? AND identity_key=?",
    );
    this.stmtClearWorkoutReceipts = db.prepare("DELETE FROM apple_health_receipts WHERE user_id=? AND workout_id=?");
    this.stmtUnlinkEventWorkout = db.prepare("UPDATE apple_health_events SET workout_id=NULL WHERE workout_id=?");
    this.stmtClearUserActiveEvents = db.prepare(`UPDATE apple_health_events SET ended_at=?, workout_id=NULL
      WHERE device_id IN (SELECT id FROM apple_health_devices WHERE user_id=?)
        AND (ended_at IS NULL OR started_at > ended_at)`);
    this.stmtInsertReceipt = db.prepare("INSERT INTO apple_health_receipts VALUES (?, ?, ?, ?)");
  }

  issue(userId: string, label: string) {
    const id = randomUUID();
    const token = `ih_${randomBytes(32).toString("base64url")}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3650 * dayMs).toISOString();
    this.stmtInsertDevice.run(id, userId, hash(token), label, createdAt, expiresAt);
    return { id, token, label, createdAt, expiresAt };
  }

  identify(token?: string): Device {
    if (!token || !/^ih_[A-Za-z0-9_-]{43}$/.test(token))
      throw new DomainError("请提供 Apple 健康上传令牌", 401);
    const device = this.stmtIdentifyDevice.get(hash(token), new Date().toISOString()) as Device | undefined;
    if (!device) throw new DomainError("Apple 健康上传令牌已失效", 401);
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.uploadMinute) {
      this.uploadMinute = minute;
      this.uploads.clear();
    }
    const count = this.uploads.get(device.id) ?? 0;
    if (count >= 60) throw new DomainError("上传过于频繁，请稍后重试", 429);
    this.uploads.set(device.id, count + 1);
    return device;
  }

  devices(userId: string) {
    return this.stmtListDevices.all(userId);
  }

  revoke(userId: string, id: string) {
    this.stmtRevokeDevice.run(new Date().toISOString(), userId, id);
  }

  hasConnection(userId: string): boolean {
    if (this.stmtHasDevice.get(userId) || this.stmtHasWorkout.get(userId)) return true;
    const rows = this.stmtListDailyData.all(userId) as { data: string }[];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data) as Record<string, unknown>;
        if ((parsed.source && parsed.source !== "manual") || APPLE_TELEMETRY_KEYS.some((key) => parsed[key] != null)) {
          return true;
        }
      } catch {
        // Skip malformed daily row
      }
    }
    return false;
  }

  workouts(userId: string) {
    const rows = this.stmtRecentWorkouts.all(userId) as
      { id: string; data: string; receivedAt: string }[];
    return rows.map(({ id, receivedAt, data }) => ({ id, receivedAt, ...JSON.parse(data) as AppleWorkoutData }));
  }

  syncStatus(
    userId: string,
    describeActivity: (activityType: string, environment?: string) => string = (type) => type,
  ) {
    const activeRow = this.stmtLatestActiveUserEvent.get(userId) as {
      activityType: string;
      startedAt: string;
      environment: AppleWorkoutInput["environment"];
      deviceLabel: string;
    } | undefined;
    let activeSession: {
      activityType: string;
      title: string;
      environment: AppleWorkoutInput["environment"];
      startedAt: string;
      elapsedMinutes: number;
      deviceLabel: string;
    } | null = null;
    if (activeRow) {
      const elapsedSeconds = Math.floor((Date.now() - Date.parse(activeRow.startedAt)) / 1000);
      if (Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0 && elapsedSeconds <= MAX_TRIGGER_WORKOUT_SECONDS) {
        activeSession = {
          activityType: activeRow.activityType,
          title: describeActivity(activeRow.activityType, activeRow.environment),
          environment: activeRow.environment,
          startedAt: activeRow.startedAt,
          elapsedMinutes: Math.max(1, Math.floor(elapsedSeconds / 60)),
          deviceLabel: activeRow.deviceLabel,
        };
      }
    }

    const workoutRow = this.stmtLatestWorkout.get(userId) as {
      id: string;
      endedAt: string;
      receivedAt: string;
      data: string;
    } | undefined;
    let lastWorkout: {
      id: string;
      title: string;
      activityType: string;
      environment: AppleWorkoutInput["environment"];
      startedAt: string;
      endedAt: string;
      receivedAt: string;
      durationSeconds: number | null;
      activeEnergyKcal: number | null;
      avgBpm: number | null;
    } | null = null;
    if (workoutRow) {
      try {
        const parsed = JSON.parse(workoutRow.data) as AppleWorkoutData;
        lastWorkout = {
          id: workoutRow.id,
          title: describeActivity(parsed.activityType, parsed.environment),
          activityType: parsed.activityType,
          environment: parsed.environment,
          startedAt: parsed.startedAt,
          endedAt: workoutRow.endedAt,
          receivedAt: workoutRow.receivedAt,
          durationSeconds: parsed.durationSeconds ?? null,
          activeEnergyKcal: parsed.activeEnergyKcal ?? null,
          avgBpm: parsed.heartRate?.avgBpm ?? null,
        };
      } catch {}
    }

    // Only consider rows that actually received an Apple device/shortcut sync, never purely manual water entries (#75)
    const dailyRows = this.stmtLatestDaily.all(userId) as Array<{
      date: string;
      updatedAt: string;
      data: string;
    }>;
    let lastDaily: {
      date: string;
      updatedAt: string;
      steps: number | null;
      sleepMinutes: number | null;
      activeEnergyKcal: number | null;
      restingHeartRateBpm: number | null;
    } | null = null;
    let bestDeviceSyncAt = "";
    for (const dailyRow of dailyRows) {
      try {
        const parsed = JSON.parse(dailyRow.data) as Record<string, unknown>;
        const explicitDeviceAt = typeof parsed.deviceSyncedAt === "string" ? parsed.deviceSyncedAt : null;
        const legacyDeviceSync =
          !explicitDeviceAt &&
          parsed.source !== "manual" &&
          Object.keys(parsed).some((k) =>
            ![
              "date",
              "updatedAt",
              "source",
              "waterMl",
              "waterSource",
              "waterUpdatedAt",
              "waterAppleSyncedMl",
            ].includes(k),
          );
        const effectiveSyncedAt = explicitDeviceAt ?? (legacyDeviceSync ? dailyRow.updatedAt : null);
        if (!effectiveSyncedAt) continue;
        if (!lastDaily || effectiveSyncedAt > bestDeviceSyncAt || (effectiveSyncedAt === bestDeviceSyncAt && dailyRow.date > lastDaily.date)) {
          bestDeviceSyncAt = effectiveSyncedAt;
          const num = (k: string) => (typeof parsed[k] === "number" && Number.isFinite(parsed[k] as number) ? (parsed[k] as number) : null);
          lastDaily = {
            date: dailyRow.date,
            updatedAt: effectiveSyncedAt,
            steps: num("steps"),
            sleepMinutes: num("sleepMinutes"),
            activeEnergyKcal: num("activeEnergyKcal"),
            restingHeartRateBpm: num("restingHeartRateBpm"),
          };
        }
      } catch {}
    }

    return { activeSession, lastWorkout, lastDaily };
  }

  saveWorkoutAnnotation(userId: string, id: string, input: AppleWorkoutAnnotationInput) {
    return this.db.transaction(() => {
      const row = this.stmtGetWorkoutById.get(userId, id) as { identityKey: string; data: string } | undefined;
      if (!row) throw new DomainError("找不到对应的 Apple 训练", 404);
      const data = JSON.parse(row.data) as AppleWorkoutData;
      const existing = data.annotation;
      const existingIsCardioSession = Boolean(
        existing &&
          (existing.source === "cardio_session" ||
            (existing.source !== "manual" && existing.sessionId && !existing.sessionId.startsWith("apple_"))),
      );
      const incomingIsManual =
        input.source === "manual" ||
        (!input.sessionId && input.source !== "cardio_session") ||
        Boolean(input.sessionId?.startsWith("apple_"));
      const incomingSource: "manual" | "cardio_session" = incomingIsManual ? "manual" : "cardio_session";

      // #73: Only reject when TWO DIFFERENT confirmed cardio sessions try to claim the same Apple workout.
      // Manual detail edits never block a confirmed web cardio session from attaching its laps & feeling!
      if (
        existing &&
        existingIsCardioSession &&
        incomingSource === "cardio_session" &&
        input.sessionId &&
        existing.sessionId !== input.sessionId
      ) {
        throw new DomainError("这条 Apple 训练已有另一场计时的备注", 409);
      }

      // #72: Multi-device optimistic concurrency & non-overlapping dirty-field merge
      if (input.expectedUpdatedAt !== undefined && (existing?.updatedAt ?? null) !== input.expectedUpdatedAt) {
        let canMerge = Boolean(existing && input.base);
        if (canMerge && existing && input.base) {
          let checked = false;
          if (input.notes !== undefined) {
            checked = true;
            if (input.base.notes === undefined || existing.notes !== input.base.notes) canMerge = false;
          }
          if (canMerge && input.feeling !== undefined) {
            checked = true;
            if (input.base.feeling === undefined || existing.feeling !== input.base.feeling) canMerge = false;
          }
          if (canMerge && input.distanceKm !== undefined) {
            checked = true;
            if (input.base.distanceKm === undefined || existing.distanceKm !== input.base.distanceKm) canMerge = false;
          }
          if (canMerge && input.lapSeconds !== undefined) {
            checked = true;
            if (
              input.base.lapSeconds === undefined ||
              JSON.stringify(existing.lapSeconds) !== JSON.stringify(input.base.lapSeconds)
            ) {
              canMerge = false;
            }
          }
          if (!checked) canMerge = false;
        }
        if (!canMerge) {
          throw new AnnotationConflictError(
            "该条训练备注已在其他设备更新，请刷新核对后再保存",
            existing ?? null,
          );
        }
      }

      let nextAnnotation: AppleWorkoutAnnotation;
      if (existing && !existingIsCardioSession && incomingSource === "cardio_session") {
        // Confirmed web cardio session attaching onto a workout that already had a manual note (#73):
        // preserve manual note/distance unless cardio session provides its own, and attach laps & sessionId!
        const mergedNotes = input.notes?.trim()
          ? existing.notes.trim() && existing.notes.trim() !== input.notes.trim()
            ? `${existing.notes.trim()}\n${input.notes.trim()}`
            : input.notes.trim()
          : existing.notes;
        nextAnnotation = {
          sessionId: input.sessionId!,
          source: "cardio_session",
          notes: mergedNotes,
          feeling: input.feeling ?? existing.feeling ?? null,
          distanceKm: input.distanceKm?.trim() ? input.distanceKm.trim() : existing.distanceKm,
          lapSeconds: input.lapSeconds?.length ? input.lapSeconds : existing.lapSeconds,
          updatedAt: new Date().toISOString(),
        };
      } else {
        const mergedSessionId =
          incomingSource === "cardio_session"
            ? input.sessionId!
            : existing?.sessionId || input.sessionId || `manual_${id}`;
        const mergedSource: "manual" | "cardio_session" =
          existingIsCardioSession || incomingSource === "cardio_session" ? "cardio_session" : "manual";
        const includeSource = mergedSource === "manual" || input.source !== undefined || existing?.source !== undefined;
        const candidate: Omit<AppleWorkoutAnnotation, "updatedAt"> = {
          sessionId: mergedSessionId,
          ...(includeSource ? { source: mergedSource } : {}),
          notes: input.notes !== undefined ? input.notes : (existing?.notes ?? ""),
          feeling: input.feeling !== undefined ? input.feeling : (existing?.feeling ?? null),
          distanceKm: input.distanceKm !== undefined ? input.distanceKm : (existing?.distanceKm ?? ""),
          lapSeconds: input.lapSeconds !== undefined ? input.lapSeconds : (existing?.lapSeconds ?? []),
        };
        if (existing) {
          const { updatedAt: _u, ...savedCore } = existing;
          if (
            savedCore.sessionId === candidate.sessionId &&
            (savedCore.source ?? (existingIsCardioSession ? "cardio_session" : "manual")) === mergedSource &&
            savedCore.notes === candidate.notes &&
            savedCore.feeling === candidate.feeling &&
            savedCore.distanceKm === candidate.distanceKm &&
            JSON.stringify(savedCore.lapSeconds) === JSON.stringify(candidate.lapSeconds)
          ) {
            return { ok: true, annotation: existing };
          }
        }
        nextAnnotation = { ...candidate, updatedAt: new Date().toISOString() };
      }

      this.stmtUpdateWorkoutData.run(JSON.stringify({ ...data, annotation: nextAnnotation }), id);
      return { ok: true, annotation: nextAnnotation };
    }).immediate();
  }

  deleteWorkout(userId: string, id: string) {
    return this.db.transaction(() => {
      const row = this.stmtGetWorkoutById.get(userId, id) as { identityKey: string; data: string } | undefined;
      if (!row) throw new DomainError("找不到对应的 Apple 训练", 404);
      const primary = JSON.parse(row.data) as AppleWorkoutData;
      const primaryKey = canonicalAppleActivityType(primary.activityType);
      const primaryStart = Date.parse(primary.startedAt);
      const primaryEnd = Date.parse(primary.endedAt);
      const primaryDur = primaryEnd - primaryStart;

      // #241: Also delete & tombstone companion merged rows (e.g. hidden Shortcut trigger or deduped upload for the same session)
      const allRows = this.db
        .prepare("SELECT id, identity_key AS identityKey, data FROM apple_health_workouts WHERE user_id = ?")
        .all(userId) as Array<{ id: string; identityKey: string; data: string }>;
      const targets: Array<{ id: string; identityKey: string }> = [{ id, identityKey: row.identityKey }];
      for (const other of allRows) {
        if (other.id === id) continue;
        let otherData: AppleWorkoutData;
        try {
          otherData = JSON.parse(other.data) as AppleWorkoutData;
        } catch {
          continue;
        }
        if (canonicalAppleActivityType(otherData.activityType) !== primaryKey) continue;
        if (
          otherData.environment !== primary.environment &&
          otherData.environment !== "unknown" &&
          primary.environment !== "unknown"
        ) {
          continue;
        }
        const otherStart = Date.parse(otherData.startedAt);
        const otherEnd = Date.parse(otherData.endedAt);
        const otherDur = otherEnd - otherStart;
        if (!Number.isFinite(otherStart) || !Number.isFinite(otherEnd) || otherDur <= 0 || primaryDur <= 0) continue;
        if (Math.abs(otherStart - primaryStart) > 120_000 || Math.abs(otherEnd - primaryEnd) > 120_000) continue;
        const shared = Math.min(primaryEnd, otherEnd) - Math.max(primaryStart, otherStart);
        if (shared < 0.8 * Math.min(primaryDur, otherDur) || shared < 0.55 * Math.max(primaryDur, otherDur)) continue;
        const isTriggerPair = otherData.captureMethod !== primary.captureMethod;
        const isDedupedDirect =
          otherData.captureMethod === primary.captureMethod &&
          (!otherData.externalWorkoutId || !primary.externalWorkoutId);
        if (isTriggerPair || isDedupedDirect) {
          targets.push({ id: other.id, identityKey: other.identityKey });
        }
      }

      const deletedAt = new Date().toISOString();
      for (const target of targets) {
        this.stmtInsertDeletedIdentity.run(userId, target.identityKey, deletedAt);
        this.stmtClearWorkoutReceipts.run(userId, target.id);
        this.stmtUnlinkEventWorkout.run(target.id);
        this.stmtDeleteWorkout.run(userId, target.id);
      }
      return { ok: true as const, deletedCount: targets.length };
    }).immediate();
  }

  clearActiveSessions(userId: string) {
    const info = this.stmtClearUserActiveEvents.run(new Date().toISOString(), userId) as { changes: number };
    return { ok: true as const, cleared: info.changes };
  }

  ingest(device: Device, workout: AppleWorkoutInput, key?: string) {
    this.checkFuture(workout.endedAt);
    return this.db.transaction(() => this.save(device.userId, appleWorkoutIdentity(workout, device.id), workout, key)).immediate();
  }

  importWorkouts(userId: string, workouts: AppleWorkoutInput[]) {
    const totals = { imported: 0, updated: 0, duplicate: 0 };
    if (!workouts.length) return totals;
    return this.db.transaction(() => {
      for (const workout of workouts) {
        this.checkFuture(workout.endedAt);
        const identity = appleWorkoutIdentity(workout);
        totals[this.save(userId, identity, workout).ingestStatus]++;
      }
      return totals;
    }).immediate();
  }

  activeEvent(device: Device, rawActivityType?: string, options?: { closeShort?: boolean }) {
    const parsed = activityType.safeParse(String(rawActivityType ?? "").trim());
    if (!parsed.success) throw new DomainError("运动类型标识不合法", 400);
    const type = parsed.data.toLowerCase();
    if (type === "any") {
      const row = this.stmtGetLatestActiveEvent.get(device.id) as
        { activityType: string; startedAt: string; environment: AppleWorkoutInput["environment"]; endedAt: string | null } | undefined;
      if (!row || (row.endedAt && row.startedAt <= row.endedAt)) {
        return { ok: true as const, found: false as const, activityType: "any" };
      }
      const elapsedSeconds = Math.floor((Date.now() - Date.parse(row.startedAt)) / 1000);
      if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > MAX_TRIGGER_WORKOUT_SECONDS) {
        this.stmtCloseEventNull.run(row.startedAt, device.id, row.activityType.toLowerCase());
        return { ok: true as const, found: false as const, expired: true as const, activityType: row.activityType };
      }
      if (elapsedSeconds < MIN_TRIGGER_WORKOUT_SECONDS) {
        if (options?.closeShort) {
          this.stmtCloseEventNull.run(new Date().toISOString(), device.id, row.activityType.toLowerCase());
        }
        return {
          ok: true as const,
          found: false as const,
          tooShort: true as const,
          ...(options?.closeShort ? { closed: true as const } : {}),
          durationSeconds: elapsedSeconds,
          activityType: row.activityType,
        };
      }
      const elapsedMinutes = Math.max(1, Math.min(360, Math.ceil(elapsedSeconds / 60)));
      return {
        ok: true as const,
        found: true as const,
        activityType: row.activityType,
        environment: row.environment,
        startedAt: row.startedAt,
        elapsedMinutes,
        distanceMode: inferDistanceMode(row.activityType),
      };
    }
    const row = this.stmtGetEvent.get(device.id, type) as
      { startedAt: string; environment: AppleWorkoutInput["environment"]; endedAt: string | null } | undefined;
    if (!row || (row.endedAt && row.startedAt <= row.endedAt)) {
      return { ok: true as const, found: false as const, activityType: parsed.data };
    }
    const elapsedSeconds = Math.floor((Date.now() - Date.parse(row.startedAt)) / 1000);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > MAX_TRIGGER_WORKOUT_SECONDS) {
      this.stmtCloseEventNull.run(row.startedAt, device.id, type);
      return { ok: true as const, found: false as const, expired: true as const, activityType: parsed.data };
    }
    if (elapsedSeconds < MIN_TRIGGER_WORKOUT_SECONDS) {
      return {
        ok: true as const,
        found: false as const,
        tooShort: true as const,
        durationSeconds: elapsedSeconds,
        activityType: parsed.data,
      };
    }
    const elapsedMinutes = Math.max(1, Math.min(360, Math.ceil(elapsedSeconds / 60)));
    return {
      ok: true as const,
      found: true as const,
      activityType: parsed.data,
      environment: row.environment,
      startedAt: row.startedAt,
      elapsedMinutes,
      distanceMode: inferDistanceMode(parsed.data),
    };
  }

  recordWebSessionStart(userId: string, input: z.infer<typeof appleWebSessionStartInput>) {
    const type = input.activityType.toLowerCase();
    const normalizedType = type.replace(/^hkworkoutactivitytype/, "").replace(/[-_]/g, "");
    if (!WEB_STRENGTH_TYPES.has(normalizedType)) return { ok: true as const, recorded: 0 };
    const startedIso = input.startedAt ? new Date(input.startedAt).toISOString() : new Date().toISOString();
    this.checkFuture(startedIso);
    const nowIso = new Date().toISOString();
    const ageSeconds = (Date.now() - Date.parse(startedIso)) / 1000;
    if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_TRIGGER_WORKOUT_SECONDS) {
      return { ok: true as const, recorded: 0 };
    }
    return this.db.transaction(() => {
      const devices = this.stmtActiveDeviceIds.all(userId, nowIso) as { id: string }[];
      const launchGroupId = randomUUID();
      let recorded = 0;
      for (const dev of devices) {
        if (input.onlyIfIdle) {
          const active = this.stmtGetLatestActiveEvent.get(dev.id) as
            | { activityType: string; startedAt: string; endedAt: string | null }
            | undefined;
          if (active && (!active.endedAt || active.startedAt > active.endedAt)) {
            const elapsed = (Date.now() - Date.parse(active.startedAt)) / 1000;
            if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= MAX_TRIGGER_WORKOUT_SECONDS) {
              continue;
            }
          }
        }
        this.stmtCloseDanglingEvents.run(startedIso, dev.id, type, startedIso);
        this.stmtUpsertEventStart.run(dev.id, type, startedIso, input.environment, launchGroupId);
        recorded += 1;
      }
      return { ok: true as const, recorded };
    }).immediate();
  }

  event(device: Device, event: EventInput) {
    this.checkFuture(event.occurredAt);
    const type = event.activityType.toLowerCase();
    return this.db.transaction(() => {
      const row = this.stmtGetEventFull.get(device.id, type) as {
        startedAt: string;
        environment: AppleWorkoutInput["environment"];
        endedAt: string | null;
        workoutId: string | null;
        launchGroupId: string | null;
      } | undefined;
      if (event.event === "start") {
        // #22: Reject late-arriving older start events so they never reactivate a ghost workout behind a newer session.
        const latestAny = this.stmtGetLatestDeviceEvent.get(device.id) as { startedAt: string; endedAt: string | null } | undefined;
        if (latestAny && event.occurredAt < latestAny.startedAt) {
          return { ingestStatus: "ignored" as const, reason: "stale_start" as const };
        }
        // Auto-close any dangling unended start event of a different activity on the same device.
        this.stmtCloseDanglingEvents.run(event.occurredAt, device.id, type, event.occurredAt);
        if (!row || (event.occurredAt > row.startedAt && (!row.endedAt || event.occurredAt > row.endedAt)))
          this.stmtUpsertEventStart.run(device.id, type, event.occurredAt, event.environment, null);
        return { ingestStatus: "started" as const };
      }
      if (row && row.endedAt === event.occurredAt && row.startedAt <= row.endedAt)
        return row.workoutId
          ? { ingestStatus: "duplicate" as const, workoutId: row.workoutId }
          : { ingestStatus: "ignored" as const, reason: "duplicate_end" as const };
      if (!row || (row.endedAt && row.startedAt <= row.endedAt))
        throw new DomainError("未找到同类训练的开始事件", 409);
      const elapsed = Math.floor((Date.parse(event.occurredAt) - Date.parse(row.startedAt)) / 1000);
      if (elapsed <= 0)
        throw new DomainError("找不到有效的训练起始时间", 409);
      if (elapsed > MAX_TRIGGER_WORKOUT_SECONDS) {
        this.stmtCloseEventNull.run(event.occurredAt, device.id, type);
        return {
          ingestStatus: "ignored" as const,
          reason: "expired_start" as const,
          durationSeconds: elapsed,
        };
      }
      if (elapsed < MIN_TRIGGER_WORKOUT_SECONDS) {
        this.stmtCloseEventNull.run(event.occurredAt, device.id, type);
        return {
          ingestStatus: "ignored" as const,
          reason: "too_short" as const,
          durationSeconds: elapsed,
        };
      }
      if (row.environment !== "unknown" && event.environment !== "unknown" && row.environment !== event.environment)
        throw new DomainError("训练开始与结束的室内外设置不一致", 409);
      const maxPlausibleKcal = Math.max(60, (elapsed / 60) * MAX_WINDOW_KCAL_PER_MIN);
      const safeActiveEnergyKcal = event.energyKind === "window_estimate" &&
        event.activeEnergyKcal != null &&
        event.activeEnergyKcal > maxPlausibleKcal
        ? undefined
        : event.activeEnergyKcal;
      const workout = appleWorkoutInput.parse({
        schemaVersion: 1, captureMethod: "trigger", activityType: event.activityType,
        environment: event.environment === "unknown" ? row.environment : event.environment,
        startedAt: row.startedAt, endedAt: event.occurredAt, timeZone: event.timeZone,
        durationSeconds: elapsed, durationKind: "event_elapsed",
        activeEnergyKcal: safeActiveEnergyKcal, energyKind: safeActiveEnergyKcal != null ? event.energyKind : undefined,
        distanceMeters: event.distanceMeters, heartRate: event.heartRate,
      });
      // #23: Multi-device end reports from one shared web launch collapse into one workout identity.
      const eventIdentity = row.launchGroupId
        ? `web-event:${row.launchGroupId}:${canonicalAppleActivityType(type)}:${row.startedAt}`
        : `event:${device.id}:${type}:${row.startedAt}`;
      const result = this.save(device.userId, eventIdentity, workout);
      this.stmtCloseEventWithWorkout.run(event.occurredAt, result.workoutId, device.id, type);
      if (row.launchGroupId) {
        this.stmtCloseLaunchGroupEvents.run(event.occurredAt, result.workoutId, row.launchGroupId, type);
      }
      return result;
    }).immediate();
  }

  private checkFuture(instant: string) {
    if (Date.parse(instant) > Date.now() + 300_000)
      throw new DomainError("训练时间超过当前时间", 400);
  }

  private save(userId: string, identity: string, workout: AppleWorkoutInput, requestKey?: string) {
    const payload = JSON.stringify(workout);
    const digest = hash(payload);
    if (requestKey) {
      const receipt = this.stmtGetReceipt.get(userId, requestKey) as { digest: string; workoutId: string } | undefined;
      if (receipt) {
        if (receipt.digest !== digest) throw new DomainError("同一上传编号对应不同训练数据", 409);
        return { ingestStatus: "duplicate" as const, workoutId: receipt.workoutId };
      }
    }
    // #24: Respect explicit user deletion tombstone for this identity so re-uploading does not resurrect deleted workouts.
    const deletedTombstone = this.stmtIsDeletedIdentity.get(userId, identity) as { deletedAt: string } | undefined;
    if (deletedTombstone) {
      return { ingestStatus: "duplicate" as const, workoutId: null, deleted: true as const };
    }
    const existing = this.stmtGetWorkoutByIdentity.get(userId, identity) as { id: string; data: string } | undefined;
    const previous = existing ? JSON.parse(existing.data) as AppleWorkoutData : null;
    if (previous) {
      // #25: Canonicalize activityType aliases (e.g. traditional_strength_training vs traditionalStrengthTraining)
      if (
        previous.startedAt !== workout.startedAt ||
        previous.endedAt !== workout.endedAt ||
        canonicalAppleActivityType(previous.activityType) !== canonicalAppleActivityType(workout.activityType)
      ) {
        throw new DomainError("训练标识已用于另一条记录", 409);
      }
    }
    const workoutId = existing?.id ?? randomUUID();
    let updated = false;
    if (!previous) {
      this.stmtInsertWorkout.run(workoutId, userId, identity, workout.endedAt, new Date().toISOString(), payload);
    } else {
      const upgrade = previous.captureMethod === "trigger" && workout.captureMethod === "workout";
      const enriched = appleWorkoutInput.parse(upgrade
        ? mergeAppleMeasurements(workout, previous) : mergeAppleMeasurements(previous, workout));
      const data = JSON.stringify({ ...enriched, annotation: previous.annotation });
      updated = existing!.data !== data;
      if (updated) this.stmtUpdateWorkoutData.run(data, workoutId);
    }
    if (requestKey)
      this.stmtInsertReceipt.run(userId, requestKey, digest, workoutId);
    return {
      ingestStatus: updated ? "updated" as const : existing ? "duplicate" as const : "imported" as const,
      workoutId,
    };
  }
}
