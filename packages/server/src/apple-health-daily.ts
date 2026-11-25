import type Database from "better-sqlite3";
import { localDate, type Weight } from "@ironlog/shared";
import { z } from "zod";
import type { Db } from "./db.js";
import { DomainError, type Store } from "./store.js";

type Stmt = Database.Statement<unknown[], unknown>;
const dailyStmtCache = new WeakMap<Db, { read: Stmt; write: Stmt; list: Stmt }>();
function dailyStatements(db: Db) {
  let cached = dailyStmtCache.get(db);
  if (!cached) {
    cached = {
      read: db.prepare("SELECT date, updated_at AS updatedAt, data FROM apple_health_daily WHERE user_id=? AND date=?"),
      write: db.prepare(`INSERT INTO apple_health_daily VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data`),
      list: db.prepare("SELECT date, updated_at AS updatedAt, data FROM apple_health_daily WHERE user_id=? AND date>=? AND date<=? ORDER BY date ASC"),
    };
    dailyStmtCache.set(db, cached);
  }
  return cached;
}

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MISSING_TOKENS = new Set(["", "null", "undefined", "unknown", "unavailable", "none", "n/a", "nan", "—", "-"]);

export function isEnabledHealthFlag(value: unknown) {
  return value === true || value === 1 || value === "true" || value === "1";
}

export interface DailyHealthSnapshot {
  date: string;
  updatedAt: string;
  source: "shortcut" | "home_assistant" | "manual";
  // Activity & expenditure (cumulative since midnight)
  steps?: number;
  activeEnergyKcal?: number;
  restingEnergyKcal?: number;
  totalEnergyKcal?: number;
  distanceKm?: number;
  flightsClimbed?: number;
  exerciseMinutes?: number;
  standHours?: number;
  mindfulMinutes?: number;
  // Sleep & recovery
  sleepMinutes?: number;
  sleepDeepMinutes?: number;
  sleepRemMinutes?: number;
  sleepCoreMinutes?: number;
  sleepAwakeMinutes?: number;
  sleepInBedMinutes?: number;
  sleepEfficiencyPct?: number;
  sleepStartAt?: string;
  sleepEndAt?: string;
  // Body composition
  weightKg?: number;
  weightDate?: string;
  bodyFatPct?: number;
  bodyFatDate?: string;
  leanBodyMassKg?: number;
  bmi?: number;
  waistCm?: number;
  // Vitals & readiness
  heartRateBpm?: number;
  restingHeartRateBpm?: number;
  hrvMs?: number;
  vo2Max?: number;
  bloodOxygenPct?: number;
  respiratoryRate?: number;
  bodyTempC?: number;
  // Hydration & nutrition snapshot
  waterMl?: number;
  dietaryEnergyKcal?: number;
  dietaryProteinG?: number;
  dietaryCarbsG?: number;
  dietaryFatG?: number;
  // Internal tracking for safe automatic weight backfill (never overwrites user manual edits)
  syncedWeightValue?: number;
  syncedBodyFatValue?: number;
  syncedSleepObservations?: SleepObservation[];
}

const CUMULATIVE_KEYS: Array<keyof DailyHealthSnapshot> = [
  "steps",
  "activeEnergyKcal",
  "restingEnergyKcal",
  "distanceKm",
  "flightsClimbed",
  "exerciseMinutes",
  "standHours",
  "mindfulMinutes",
  "sleepMinutes",
  "sleepDeepMinutes",
  "sleepRemMinutes",
  "sleepCoreMinutes",
  "sleepAwakeMinutes",
  "sleepInBedMinutes",
  "waterMl",
  "dietaryEnergyKcal",
  "dietaryProteinG",
  "dietaryCarbsG",
  "dietaryFatG",
];

const shortcutSumMetrics = {
  steps: { label: "步数", max: 300_000, integer: true },
  activeEnergyKcal: { label: "活动能量", max: 20_000, digits: 1 },
  restingEnergyKcal: { label: "静息能量", max: 20_000, digits: 1 },
  distanceKm: { label: "距离", max: 500, digits: 2 },
  flightsClimbed: { label: "爬楼层数", max: 5_000, integer: true },
  waterMl: { label: "饮水量", max: 30_000, integer: true },
  dietaryEnergyKcal: { label: "膳食热量", max: 30_000, integer: true },
  dietaryProteinG: { label: "膳食蛋白质", max: 2_000, digits: 1 },
  dietaryCarbsG: { label: "膳食碳水", max: 3_000, digits: 1 },
  dietaryFatG: { label: "膳食脂肪", max: 2_000, digits: 1 },
};
const shortcutLatestMetrics = [
  "leanBodyMassKg", "bmi", "waistCm", "heartRateBpm", "restingHeartRateBpm",
  "hrvMs", "vo2Max", "bloodOxygenPct", "respiratoryRate",
] as const;

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Parse loosely formatted numeric values produced by Apple Shortcuts / HealthKit
 * (e.g. "75.2 kg", "18.5%", "1,234", or empty/missing placeholders like ""/"unknown").
 */
export function parseTolerantNumber(
  raw: unknown,
  fieldLabel: string,
  { min = 0, max = 1_000_000, integer = false, digits = 2 }: {
    min?: number; max?: number; integer?: boolean; digits?: number;
  } = {},
): number | undefined {
  if (raw === undefined || raw === null || raw === false) return undefined;
  let num: number;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    num = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (MISSING_TOKENS.has(trimmed.toLowerCase())) return undefined;
    const cleaned = trimmed.replace(/,/g, "");
    const match = /^([+-]?\d+(?:\.\d+)?)(?:\s*[A-Za-z\u4e00-\u9fff%/°℃·μ()（）-]+)?$/.exec(cleaned);
    if (!match) return undefined;
    num = Number(match[1]);
    if (!Number.isFinite(num)) return undefined;
  } else {
    return undefined;
  }
  if (num < min || num > max) {
    throw new DomainError(`${fieldLabel}数值超出有效范围 (${min}–${max})`, 400);
  }
  return integer ? Math.round(num) : roundTo(num, digits);
}

/** Parse percentage fields while normalizing Apple Health's optional 0..1 fraction convention. */
function parsePercentage(raw: unknown, label: string, minPct = 1, maxPct = 100): number | undefined {
  const value = parseTolerantNumber(raw, label, { min: 0, max: maxPct, digits: 4 });
  if (value === undefined) return undefined;
  const scaled = value > 0 && value <= 1 ? roundTo(value * 100, 1) : roundTo(value, 1);
  if (scaled < minPct || scaled > maxPct) {
    throw new DomainError(`${label}百分比超出有效范围 (${minPct}%–${maxPct}%)`, 400);
  }
  return scaled;
}

const strictIsoInstant = z.iso.datetime({ offset: true });

/** Parse standard ISO instants plus common localized Apple Shortcuts date outputs. */
export function parseFlexibleInstant(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value > 1e9 ? value * 1000 : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;
  if (/^\d{10,13}$/.test(text)) {
    const num = Number(text);
    const ms = text.length >= 13 ? num : num * 1000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  // Normalize compact offsets like "+0800", "GMT+08:00", "GMT+8", or "31GMT+8"
  text = text.replace(/(?:GMT|UTC)\s*([+-]\d{1,2})(?::?(\d{2}))?$/i, (_, h: string, m?: string) =>
    `${h[0]}${h.slice(1).padStart(2, "0")}:${m ?? "00"}`,
  );
  text = text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

  const isoCandidate = text.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, "$1T$2");
  if (strictIsoInstant.safeParse(isoCandidate).success) {
    return new Date(isoCandidate).toISOString();
  }

  const cjk = isoCandidate.match(
    /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s*(?:星期[一二三四五六日天]|周[一二三四五六日天])|\s+at)?(?:\s+|T)(凌晨|早上|上午|中午|下午|晚上|AM|PM)?\s*(\d{1,2})[时:](\d{2})(?:[分:](\d{2})(?:\.\d+)?秒?)?\s*(AM|PM|Z|[+-]\d{2}:\d{2})?$/i,
  );
  if (cjk) {
    const year = Number(cjk[1]);
    const month = Number(cjk[2]);
    const day = Number(cjk[3]);
    let hour = Number(cjk[5]);
    const minute = Number(cjk[6]);
    const second = Number(cjk[7] ?? 0);
    const mer = (cjk[4] ?? (cjk[8] === "AM" || cjk[8] === "PM" ? cjk[8] : "")).toUpperCase();
    const tz = cjk[8] && cjk[8] !== "AM" && cjk[8] !== "PM" ? cjk[8] : null;
    if (mer === "下午" || mer === "晚上" || mer === "PM" || (mer === "中午" && hour < 12)) {
      if (hour < 12) hour += 12;
    } else if ((mer === "上午" || mer === "早上" || mer === "凌晨" || mer === "AM") && hour === 12) {
      hour = 0;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    const probe = new Date(year, month - 1, day, hour, minute, second);
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
    if (tz) {
      const isoWithTz = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${tz}`;
      return strictIsoInstant.safeParse(isoWithTz).success ? new Date(isoWithTz).toISOString() : null;
    }
    return probe.toISOString();
  }

  // Time-only shortcuts output (e.g. "23:47", "23:47:12", "下午11:47") resolved against today
  const timeOnly = text.match(/^(凌晨|早上|上午|中午|下午|晚上|AM|PM)?\s*(\d{1,2})[时:](\d{2})(?:[分:](\d{2})秒?)?\s*(AM|PM)?$/i);
  if (timeOnly) {
    let hour = Number(timeOnly[2]);
    const minute = Number(timeOnly[3]);
    const second = Number(timeOnly[4] ?? 0);
    const mer = (timeOnly[1] ?? timeOnly[5] ?? "").toUpperCase();
    if (mer === "下午" || mer === "晚上" || mer === "PM" || (mer === "中午" && hour < 12)) {
      if (hour < 12) hour += 12;
    } else if ((mer === "上午" || mer === "早上" || mer === "凌晨" || mer === "AM") && hour === 12) {
      hour = 0;
    }
    if (hour <= 23 && minute <= 59 && second <= 59) {
      const d = new Date();
      d.setHours(hour, minute, second, 0);
      return d.toISOString();
    }
  }

  if (/\d{1,2}:\d{2}/.test(text)) {
    const cleaned = text.replace(/\bat\b/i, " ").trim();
    const ms = Date.parse(cleaned);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }

  return null;
}

/** Resolve an optional ISO date or datetime into a UTC+08 calendar date (`YYYY-MM-DD`). */
function parseMeasuredDate(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || MISSING_TOKENS.has(trimmed.toLowerCase())) return undefined;
  if (ISO_DATE_RE.test(trimmed)) return trimmed;
  const directMs = Date.parse(trimmed);
  if (Number.isFinite(directMs)) return localDate(directMs);
  const flex = parseFlexibleInstant(trimmed);
  return flex ? localDate(Date.parse(flex)) : undefined;
}

type SleepStage = "deep" | "rem" | "core" | "asleep" | "awake" | "inBed";
type Interval = [number, number];
type SleepObservation = { stage: SleepStage; interval: Interval } | { stage: SleepStage; minutes: number };

function isAsleepStage(stage: SleepStage) {
  return stage !== "awake" && stage !== "inBed";
}
// Raw values from HKCategoryValueSleepAnalysis.
const healthKitSleepStages: readonly SleepStage[] = ["inBed", "asleep", "awake", "core", "deep", "rem"];

function normalizeSleepStage(raw: string | number): SleepStage | null {
  const value = String(raw).trim().toLowerCase();
  if (/^[0-5]$/.test(value)) return healthKitSleepStages[Number(value)] ?? null;
  const token = value.replace(/[\s_-]+/g, "");
  if (!token) return null;
  if (token === "deep" || token.includes("deep") || token.includes("深睡") || token.includes("深度睡眠")) return "deep";
  if (token === "rem" || token === "asleeprem" || token.includes("快速眼动") || token.includes("快速动眼") ||
      token.includes("快速眼動") || token.includes("快速動眼")) return "rem";
  if (token === "core" || token.includes("light") || token.includes("核心") || token.includes("浅睡") || token.includes("浅度睡眠")) return "core";
  if (token === "awake" || token.includes("清醒")) return "awake";
  if (token === "inbed" || token.includes("卧床") || token.includes("在床")) return "inBed";
  if (token === "asleep" || token.includes("asleep") || token.includes("已入睡") || token.includes("睡眠中") || token === "睡眠" || token.includes("unspecified")) return "asleep";
  return null;
}

/** Merge overlapping millisecond intervals and return total duration in rounded minutes. */
export function mergeIntervalsMinutes(intervals: Interval[]): number {
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let totalMs = 0;
  let [curStart, curEnd] = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i]!;
    if (start <= curEnd) {
      if (end > curEnd) curEnd = end;
    } else {
      totalMs += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  totalMs += curEnd - curStart;
  return Math.round(totalMs / 60_000);
}

export interface SleepSummary {
  sleepMinutes?: number;
  sleepDeepMinutes?: number;
  sleepRemMinutes?: number;
  sleepCoreMinutes?: number;
  sleepAwakeMinutes?: number;
  sleepInBedMinutes?: number;
  sleepEfficiencyPct?: number;
  sleepStartAt?: string;
  sleepEndAt?: string;
}

const SLEEP_SUMMARY_KEYS: ReadonlyArray<keyof SleepSummary> = [
  "sleepMinutes", "sleepDeepMinutes", "sleepRemMinutes", "sleepCoreMinutes", "sleepAwakeMinutes",
  "sleepInBedMinutes", "sleepEfficiencyPct", "sleepStartAt", "sleepEndAt",
];

/**
 * Parse a sleep sample duration extracted from Apple Shortcuts "Duration" property
 * (seconds, localized duration text such as "1小时20分钟" / "15 min", or "HH:MM:SS")
 * into fractional minutes.
 */
function parseSleepDurationMinutes(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 && raw <= 86_400 ? raw / 60 : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || MISSING_TOKENS.has(trimmed.toLowerCase())) return null;

  const hms = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (hms) {
    const mins = Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60;
    return mins > 0 && mins <= 1440 ? mins : null;
  }

  const unitRe = /(\d+(?:\.\d+)?)\s*(小时|hours?|hrs?|分钟|minutes?|mins?|秒钟|seconds?|secs?|时|分|秒|[hms](?![a-z]))/gi;
  let totalMin = 0;
  let matchedUnits = false;
  for (const match of trimmed.matchAll(unitRe)) {
    if (!match[1] || !match[2]) continue;
    matchedUnits = true;
    const val = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(val) || val < 0) continue;
    if (unit.startsWith("小") || unit === "时" || unit.startsWith("h")) totalMin += val * 60;
    else if (unit.startsWith("秒") || unit.startsWith("s")) totalMin += val / 60;
    else totalMin += val;
  }
  if (matchedUnits) return totalMin > 0 && totalMin <= 1440 ? totalMin : null;

  const seconds = parseTolerantNumber(trimmed, "睡眠时长", { min: 0, max: 86_400 });
  return seconds != null && seconds > 0 ? seconds / 60 : null;
}

function parseSleepStamp(raw: string): number {
  const direct = Date.parse(raw.trim());
  if (Number.isFinite(direct)) return direct;
  const flex = parseFlexibleInstant(raw);
  return flex ? Date.parse(flex) : NaN;
}

/**
 * Deduplicate overlapping HealthKit sleep sample intervals from Apple Watch / iPhone
 * and compute asleep total, stage breakdown, sleep window, and efficiency.
 */
function sampleRows(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : [];
}

function shortcutTotalsByDate(raw: unknown, from: string, through: string, label: string, max: number) {
  const totals = new Map<string, number>();
  for (const line of sampleRows(raw)) {
    if (typeof line !== "string") continue;
    const [stamp, value] = line.split("|");
    const date = parseMeasuredDate(stamp);
    if (!date || date < from || date > through) continue;
    try {
      const amount = parseTolerantNumber(value, label, { max, digits: 6 });
      if (amount !== undefined) totals.set(date, (totals.get(date) ?? 0) + amount);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  return totals;
}

function readSleepObservations(raw: unknown): SleepObservation[] {
  const observations: SleepObservation[] = [];
  for (const item of sampleRows(raw)) {
    let stageRaw: unknown;
    let startRaw: string | undefined;
    let endRaw: string | undefined;
    let durationRaw: unknown;
    let explicitDurationMin: number | null = null;

    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed || MISSING_TOKENS.has(trimmed.toLowerCase())) continue;
      const parts = trimmed.split(/[|\t]/);
      if (parts.length < 3) continue;
      [stageRaw, startRaw, endRaw, durationRaw] = parts;
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      stageRaw = obj.stage ?? obj.value;
      startRaw = typeof obj.startedAt === "string" ? obj.startedAt : typeof obj.startDate === "string" ? obj.startDate : undefined;
      endRaw = typeof obj.endedAt === "string" ? obj.endedAt : typeof obj.endDate === "string" ? obj.endDate : undefined;
      durationRaw = obj.durationSeconds ?? obj.durationSec ?? obj.duration;
      if (typeof obj.durationMinutes === "number" && Number.isFinite(obj.durationMinutes) && obj.durationMinutes > 0) {
        explicitDurationMin = obj.durationMinutes;
      }
    }
    if (typeof stageRaw !== "string" && typeof stageRaw !== "number") continue;
    const stage = normalizeSleepStage(stageRaw);
    if (!stage) continue;

    const startMs = startRaw ? parseSleepStamp(startRaw) : NaN;
    const endMs = endRaw ? parseSleepStamp(endRaw) : NaN;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      // Skip clearly corrupt chunks longer than 24 hours.
      if (endMs - startMs > DAY_MS) continue;
      observations.push({ stage, interval: [startMs, endMs] });
      continue;
    }

    // Fallback: if Start/End timestamps could not be formatted/parsed, accumulate Shortcuts Duration.
    const durMin = explicitDurationMin ?? parseSleepDurationMinutes(durationRaw);
    if (durMin != null && durMin > 0 && durMin <= 1440) {
      observations.push({ stage, minutes: durMin });
    }
  }

  return observations;
}

const SLEEP_SESSION_GAP_MS = 2 * 3_600_000;
const MIN_MAIN_SLEEP_MINUTES = 180;

function timedSleepSessions(observations: SleepObservation[]) {
  const timed = observations
    .filter((observation): observation is Extract<SleepObservation, { interval: Interval }> => "interval" in observation)
    .sort((first, second) => first.interval[0] - second.interval[0]);
  const sessions: { observations: typeof timed; start: number; end: number }[] = [];
  for (const observation of timed) {
    const [start, end] = observation.interval;
    const session = sessions.at(-1);
    if (!session || start > session.end + SLEEP_SESSION_GAP_MS) {
      sessions.push({ observations: [observation], start, end });
    } else {
      session.observations.push(observation);
      session.end = Math.max(session.end, end);
    }
  }
  return sessions;
}

function splitTimedSleepByDate(observations: SleepObservation[]) {
  const byDate = new Map<string, SleepObservation[]>();
  for (const session of timedSleepSessions(observations)) {
    const lastAsleepEnd = session.observations.reduce(
      (end, { stage, interval }) => isAsleepStage(stage) ? Math.max(end, interval[1]) : end,
      -Infinity,
    );
    const wakeDate = localDate(Number.isFinite(lastAsleepEnd) ? lastAsleepEnd : session.end);
    const list = byDate.get(wakeDate) ?? [];
    byDate.set(wakeDate, list.concat(session.observations));
  }
  return byDate;
}

export function timedSleepProfile(entry: DailyHealthSnapshot) {
  const asleep = (entry.syncedSleepObservations ?? []).filter(
    (item): item is Extract<SleepObservation, { interval: Interval }> =>
      "interval" in item && isAsleepStage(item.stage)
      && Number.isFinite(item.interval[0]) && Number.isFinite(item.interval[1])
      && item.interval[1] > item.interval[0],
  );
  if (asleep.length === 0) return null;
  const minutes = mergeIntervalsMinutes(asleep.map(({ interval }) => interval));
  const main = timedSleepSessions(asleep)
    .filter(({ end }) => localDate(end) === entry.date)
    .map((session) => ({
      ...session,
      minutes: mergeIntervalsMinutes(session.observations.map(({ interval }) => interval)),
    }))
    .filter(({ minutes }) => minutes >= MIN_MAIN_SLEEP_MINUTES)
    .sort((a, b) => b.minutes - a.minutes || a.start - b.start)[0];
  const summary = summarizeSleep(asleep);
  const stages = {
    core: summary.sleepCoreMinutes ?? null,
    deep: summary.sleepDeepMinutes ?? null,
    rem: summary.sleepRemMinutes ?? null,
  };
  const staged = mergeIntervalsMinutes(asleep.filter(({ stage }) => stage !== "asleep").map(({ interval }) => interval));
  const stageTotal = (stages.core ?? 0) + (stages.deep ?? 0) + (stages.rem ?? 0);
  return {
    minutes,
    window: main ? { startAt: new Date(main.start).toISOString(), endAt: new Date(main.end).toISOString() } : null,
    stages: stageTotal > staged + 1 ? null : stages,
  };
}

export function parseSleepSamples(raw: unknown, date?: string): SleepSummary {
  return summarizeSleep(readSleepObservations(raw), date);
}

function summarizeSleep(observations: SleepObservation[], date?: string): SleepSummary {
  let scoped = observations;
  if (date) {
    const byDate = splitTimedSleepByDate(observations);
    if (byDate.size > 0) {
      const matched = byDate.get(date);
      if (!matched?.length) return {};
      const untimed = observations.filter((observation) => !("interval" in observation));
      scoped = [...matched, ...untimed];
    }
  }

  const buckets: Record<SleepStage, Interval[]> = {
    deep: [], rem: [], core: [], asleep: [], awake: [], inBed: [],
  };
  const fallbackMinutes: Record<SleepStage, number> = {
    deep: 0, rem: 0, core: 0, asleep: 0, awake: 0, inBed: 0,
  };
  let earliest = Infinity;
  let latest = -Infinity;
  for (const observation of scoped) {
    if ("interval" in observation) {
      buckets[observation.stage].push(observation.interval);
      earliest = Math.min(earliest, observation.interval[0]);
      latest = Math.max(latest, observation.interval[1]);
    } else {
      fallbackMinutes[observation.stage] += observation.minutes;
    }
  }

  const deepMin = mergeIntervalsMinutes(buckets.deep) + Math.round(fallbackMinutes.deep);
  const remMin = mergeIntervalsMinutes(buckets.rem) + Math.round(fallbackMinutes.rem);
  const coreMin = mergeIntervalsMinutes(buckets.core) + Math.round(fallbackMinutes.core);
  const awakeMin = mergeIntervalsMinutes(buckets.awake) + Math.round(fallbackMinutes.awake);
  const inBedMin = mergeIntervalsMinutes(buckets.inBed) + Math.round(fallbackMinutes.inBed);
  const asleepIntervals = [...buckets.deep, ...buckets.rem, ...buckets.core, ...buckets.asleep];
  const fallbackAsleep = fallbackMinutes.deep + fallbackMinutes.rem + fallbackMinutes.core + fallbackMinutes.asleep;
  const asleepMin = mergeIntervalsMinutes(asleepIntervals) + Math.round(fallbackAsleep);
  if (asleepMin <= 0 && awakeMin <= 0 && inBedMin <= 0 && !Number.isFinite(earliest)) return {};

  const out: SleepSummary = {};
  if (asleepMin > 0) out.sleepMinutes = asleepMin;
  if (deepMin > 0) out.sleepDeepMinutes = deepMin;
  if (remMin > 0) out.sleepRemMinutes = remMin;
  if (coreMin > 0) out.sleepCoreMinutes = coreMin;
  if (awakeMin > 0) out.sleepAwakeMinutes = awakeMin;
  if (inBedMin > 0) out.sleepInBedMinutes = inBedMin;
  if (asleepMin > 0 && (inBedMin > 0 || awakeMin > 0)) {
    const windowMin = Math.max(asleepMin, inBedMin || asleepMin + awakeMin);
    out.sleepEfficiencyPct = Math.min(100, Math.round((asleepMin / windowMin) * 100));
  }
  if (Number.isFinite(earliest) && Number.isFinite(latest)) {
    out.sleepStartAt = new Date(earliest).toISOString();
    out.sleepEndAt = new Date(latest).toISOString();
  }
  return out;
}

function sleepObservationsByDate(raw: unknown, from: string, through: string, untimedTargetDate?: string) {
  const observations = readSleepObservations(raw);
  const byDate = splitTimedSleepByDate(observations);
  const out = new Map<string, SleepObservation[]>();
  for (const [date, list] of byDate) {
    if (date < from || date > through) continue;
    out.set(date, [...list]);
  }
  if (untimedTargetDate && untimedTargetDate >= from && untimedTargetDate <= through) {
    const untimed = observations.filter((observation) => !("interval" in observation));
    if (untimed.length > 0) {
      const existing = out.get(untimedTargetDate) ?? [];
      out.set(untimedTargetDate, [...existing, ...untimed]);
    }
  }
  return out;
}

function mergeSleepObservationLists(
  existingObs: SleepObservation[] | undefined,
  incomingObs: SleepObservation[],
): SleepObservation[] {
  if (!existingObs?.length) return incomingObs;
  const timedMap = new Map<string, SleepObservation>();
  for (const obs of [...existingObs, ...incomingObs]) {
    if ("interval" in obs) {
      timedMap.set(`${obs.stage}:${obs.interval[0]}:${obs.interval[1]}`, obs);
    }
  }
  const stages: SleepStage[] = ["deep", "rem", "core", "asleep", "awake", "inBed"];
  const untimedMerged: SleepObservation[] = [];
  for (const stage of stages) {
    const prevSum = existingObs
      .filter((o): o is Extract<SleepObservation, { minutes: number }> => !("interval" in o) && o.stage === stage)
      .reduce((sum, o) => sum + o.minutes, 0);
    const nextSum = incomingObs
      .filter((o): o is Extract<SleepObservation, { minutes: number }> => !("interval" in o) && o.stage === stage)
      .reduce((sum, o) => sum + o.minutes, 0);
    const best = Math.max(prevSum, nextSum);
    if (best > 0) untimedMerged.push({ stage, minutes: best });
  }
  return [...timedMap.values(), ...untimedMerged];
}

const sourceEnum = z.enum(["shortcut", "home_assistant", "manual"]);

function resolveTargetDate(raw: Record<string, unknown>, today: string): string {
  const fromDate = parseMeasuredDate(raw.date);
  if (fromDate) {
    if (fromDate < "1902-01-01" || fromDate > localDate(Date.now() + DAY_MS)) {
      throw new DomainError("同步日期超出允许范围", 400);
    }
    return fromDate;
  }
  const fromOccurred = parseMeasuredDate(raw.occurredAt);
  if (fromOccurred) return fromOccurred;
  return today;
}

function readRow(db: Db, userId: string, date: string): DailyHealthSnapshot | null {
  const row = dailyStatements(db).read.get(userId, date) as { date: string; updatedAt: string; data: string } | undefined;
  if (!row) return null;
  return { ...(JSON.parse(row.data) as DailyHealthSnapshot), date: row.date, updatedAt: row.updatedAt };
}

function writeRow(db: Db, userId: string, date: string, snapshot: DailyHealthSnapshot) {
  dailyStatements(db).write.run(userId, date, snapshot.updatedAt, JSON.stringify(snapshot));
}

function maybeSyncWeightRecord(
  store: Store,
  userId: string,
  targetDate: string,
  weightKg: number | undefined,
  bodyFatPct: number | undefined,
  prevSyncedWeight: number | undefined,
  prevSyncedBodyFat: number | undefined,
): boolean {
  if (weightKg == null) return false;
  const id = `weight_${targetDate}`;
  const existing = store.get(userId, "weight", id);
  const existingData = existing && !existing.deleted ? existing.data as Weight : null;

  // Never clobber a manual user weight record on that day unless it equals our prior Apple sync.
  if (existingData && prevSyncedWeight == null) return false;
  if (existingData && prevSyncedWeight != null && existingData.weight !== prevSyncedWeight) return false;

  const nextBodyFat = bodyFatPct ?? (existingData?.bodyFat ?? prevSyncedBodyFat ?? null);
  if (existingData && existingData.weight === weightKg && (existingData.bodyFat ?? null) === nextBodyFat) {
    return false;
  }

  store.mutate(userId, {
    kind: "weight",
    id,
    opId: `ahw_${targetDate.replace(/-/g, "")}_${Date.now()}`,
    baseVersion: existing?.version ?? 0,
    deleted: false,
    data: {
      date: targetDate,
      weight: weightKg,
      bodyFat: nextBodyFat,
    },
  });
  return true;
}

/**
 * Normalize and persist a full Apple Health daily telemetry payload into `apple_health_daily`,
 * deduplicate Sleep intervals, and safely backfill body weight/fat records.
 */
export function upsertDailyHealth(
  store: Store,
  userId: string,
  rawPayload: unknown,
  { dryRun = false }: { dryRun?: boolean } = {},
) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new DomainError("请提交 JSON 对象格式的健康数据", 400);
  }
  const input = ((rawPayload as Record<string, unknown>).daily &&
    typeof (rawPayload as Record<string, unknown>).daily === "object"
    ? (rawPayload as Record<string, unknown>).daily
    : rawPayload) as Record<string, unknown>;

  const today = localDate();
  const date = resolveTargetDate(input, today);
  const threeDaySync = String(input.shortcutGenVersion) === "3";
  const firstDate = localDate(Date.parse(`${date}T00:00:00+08:00`) - 2 * DAY_MS);
  const historical = new Map<string, Partial<DailyHealthSnapshot>>();
  function patchForDate(day: string) {
    if (day === date) return parsed;
    if (!historical.has(day)) historical.set(day, {});
    return historical.get(day)!;
  }
  const replace = isEnabledHealthFlag(input.replace);
  const sourceParse = sourceEnum.safeParse(input.source);
  const source: DailyHealthSnapshot["source"] = sourceParse.success ? sourceParse.data : "shortcut";
  const nowIso = new Date().toISOString();

  // Extract & validate all domains tolerantly
  const parsed: Partial<DailyHealthSnapshot> = {
    exerciseMinutes: parseTolerantNumber(input.exerciseMinutes, "锻炼时长", { min: 0, max: 1440, integer: true }),
    standHours: parseTolerantNumber(input.standHours, "站立小时", { min: 0, max: 24, integer: true }),
    mindfulMinutes: parseTolerantNumber(input.mindfulMinutes, "正念时长", { min: 0, max: 1440, integer: true }),
    weightKg: parseTolerantNumber(input.weightKg, "体重", { min: 1, max: 500, digits: 2 }),
    bodyFatPct: parsePercentage(input.bodyFatPct, "体脂率", 1, 80),
    leanBodyMassKg: parseTolerantNumber(input.leanBodyMassKg, "瘦体重", { min: 1, max: 400, digits: 2 }),
    bmi: parseTolerantNumber(input.bmi, "BMI", { min: 5, max: 100, digits: 1 }),
    waistCm: (() => {
      const raw = parseTolerantNumber(input.waistCm, "腰围", { min: 0.3, max: 300, digits: 3 });
      if (raw === undefined) return undefined;
      const cm = raw <= 3 ? roundTo(raw * 100, 1) : roundTo(raw, 1);
      if (cm < 30 || cm > 300) throw new DomainError("腰围数值超出有效范围 (30–300 cm)", 400);
      return cm;
    })(),
    heartRateBpm: parseTolerantNumber(input.heartRateBpm, "心率", { min: 20, max: 300, integer: true }),
    restingHeartRateBpm: parseTolerantNumber(input.restingHeartRateBpm, "静息心率", { min: 20, max: 220, integer: true }),
    hrvMs: parseTolerantNumber(input.hrvMs, "心率变异性 HRV", { min: 1, max: 500, digits: 1 }),
    vo2Max: parseTolerantNumber(input.vo2Max, "最大摄氧量 VO2 Max", { min: 5, max: 120, digits: 1 }),
    bloodOxygenPct: parsePercentage(input.bloodOxygenPct, "血氧饱和度", 50, 100),
    respiratoryRate: parseTolerantNumber(input.respiratoryRate, "呼吸频率", { min: 4, max: 80, digits: 1 }),
    bodyTempC: parseTolerantNumber(input.bodyTempC, "体温", { min: 30, max: 45, digits: 2 }),
  };
  for (const key of Object.keys(shortcutSumMetrics) as (keyof typeof shortcutSumMetrics)[]) {
    const metric = shortcutSumMetrics[key];
    parsed[key] = parseTolerantNumber(input[key], metric.label, metric);
    if (!threeDaySync) continue;
    for (const [sampleDate, total] of shortcutTotalsByDate(input[`${key}Samples`], firstDate, date, metric.label, metric.max)) {
      if (total <= metric.max) patchForDate(sampleDate)[key] = parseTolerantNumber(total, metric.label, metric);
    }
  }
  if (parsed.distanceKm === undefined) {
    const meters = parseTolerantNumber(input.distanceMeters, "距离(米)", { max: 500_000, digits: 1 });
    if (meters !== undefined) parsed.distanceKm = roundTo(meters / 1000, 2);
  }
  if (parsed.waterMl === undefined) {
    const liters = parseTolerantNumber(input.waterL, "饮水量(L)", { max: 30, digits: 3 });
    if (liters !== undefined) parsed.waterMl = Math.round(liters * 1000);
  }
  if (threeDaySync) {
    for (const key of shortcutLatestMetrics) {
      const value = parsed[key];
      if (value === undefined) continue;
      const measuredDate = parseMeasuredDate(input[`${key}MeasuredAt`]);
      delete parsed[key];
      if (measuredDate && measuredDate >= firstDate && measuredDate <= date) patchForDate(measuredDate)[key] = value;
    }
  }

  // Merge Sleep either from structured sleepMinutes or raw sample intervals,
  // splitting multi-night HealthKit sleep ranges by wake-up date for both v2 and v3 shortcuts.
  const sleepObsMap = sleepObservationsByDate(
    input.sleepSamples,
    firstDate,
    date,
    threeDaySync ? undefined : date,
  );
  for (const [sleepDate, obsList] of sleepObsMap) {
    const summary = summarizeSleep(obsList);
    if (Object.keys(summary).length > 0) {
      Object.assign(patchForDate(sleepDate), summary, { syncedSleepObservations: obsList });
    }
  }
  const directSleep: SleepSummary = {
    sleepMinutes: parseTolerantNumber(input.sleepMinutes, "睡眠时长", { min: 0, max: 1440, integer: true }),
    sleepDeepMinutes: parseTolerantNumber(input.sleepDeepMinutes, "深睡时长", { min: 0, max: 1440, integer: true }),
    sleepRemMinutes: parseTolerantNumber(input.sleepRemMinutes, "REM 时长", { min: 0, max: 1440, integer: true }),
    sleepCoreMinutes: parseTolerantNumber(input.sleepCoreMinutes, "核心睡眠时长", { min: 0, max: 1440, integer: true }),
    sleepAwakeMinutes: parseTolerantNumber(input.sleepAwakeMinutes, "清醒时长", { min: 0, max: 1440, integer: true }),
    sleepInBedMinutes: parseTolerantNumber(input.sleepInBedMinutes, "卧床时长", { min: 0, max: 1440, integer: true }),
    sleepEfficiencyPct: parsePercentage(input.sleepEfficiencyPct, "睡眠效率", 1, 100),
  };
  for (const [k, v] of Object.entries(directSleep)) {
    if (v !== undefined) (parsed as Record<string, unknown>)[k] = v;
  }

  function measurementDate(raw: unknown, value: number | undefined) {
    const day = parseMeasuredDate(raw);
    if (threeDaySync) return day && day >= firstDate && day <= date ? day : undefined;
    return day ?? (value !== undefined ? date : undefined);
  }
  const weightDate = measurementDate(input.weightMeasuredAt, parsed.weightKg);
  const bodyFatDate = measurementDate(input.bodyFatMeasuredAt, parsed.bodyFatPct);
  const weightKg = threeDaySync && !weightDate ? undefined : parsed.weightKg;
  const bodyFatPct = threeDaySync && !bodyFatDate ? undefined : parsed.bodyFatPct;
  if (threeDaySync) {
    delete parsed.weightKg;
    delete parsed.bodyFatPct;
    if (weightDate && weightKg !== undefined) Object.assign(patchForDate(weightDate), { weightKg, weightDate });
    if (bodyFatDate && bodyFatPct !== undefined) Object.assign(patchForDate(bodyFatDate), { bodyFatPct, bodyFatDate });
  } else {
    if (weightDate) parsed.weightDate = weightDate;
    if (bodyFatDate) parsed.bodyFatDate = bodyFatDate;
  }

  const computeMerged = (existing: DailyHealthSnapshot | null, forDate: string, patch: Partial<DailyHealthSnapshot>,
    replaceDay = replace): DailyHealthSnapshot => {
    const next: DailyHealthSnapshot = replaceDay || !existing
      ? { date: forDate, updatedAt: nowIso, source }
      : { ...existing, date: forDate, updatedAt: nowIso, source };

    let effectivePatch = patch;
    if (!replaceDay && existing && patch.syncedSleepObservations?.length) {
      const mergedObs = mergeSleepObservationLists(existing.syncedSleepObservations, patch.syncedSleepObservations);
      const mergedSummary = summarizeSleep(mergedObs);
      effectivePatch = {
        ...patch,
        ...mergedSummary,
        syncedSleepObservations: mergedObs,
      };
    }

    for (const [k, value] of Object.entries(effectivePatch)) {
      if (value === undefined) continue;
      if (!replaceDay && existing && CUMULATIVE_KEYS.includes(k as keyof DailyHealthSnapshot) && typeof value === "number") {
        const prev = existing[k as keyof DailyHealthSnapshot];
        (next as unknown as Record<string, unknown>)[k] = typeof prev === "number" ? Math.max(prev, value) : value;
      } else if (!replaceDay && existing && k === "sleepStartAt" && typeof value === "string" && typeof existing.sleepStartAt === "string") {
        next.sleepStartAt = Date.parse(existing.sleepStartAt) <= Date.parse(value) ? existing.sleepStartAt : value;
      } else if (!replaceDay && existing && k === "sleepEndAt" && typeof value === "string" && typeof existing.sleepEndAt === "string") {
        next.sleepEndAt = Date.parse(existing.sleepEndAt) >= Date.parse(value) ? existing.sleepEndAt : value;
      } else {
        (next as unknown as Record<string, unknown>)[k] = value;
      }
    }
    if (next.sleepMinutes && (next.sleepInBedMinutes || next.sleepAwakeMinutes)) {
      const windowMin = Math.max(next.sleepMinutes, next.sleepInBedMinutes || next.sleepMinutes + (next.sleepAwakeMinutes ?? 0));
      next.sleepEfficiencyPct = Math.min(100, Math.round((next.sleepMinutes / windowMin) * 100));
    }
    if (next.activeEnergyKcal != null && next.restingEnergyKcal != null) {
      next.totalEnergyKcal = roundTo(next.activeEnergyKcal + next.restingEnergyKcal, 1);
    } else if (next.activeEnergyKcal != null) {
      next.totalEnergyKcal = next.activeEnergyKcal;
    }
    return next;
  };

  if (dryRun) {
    const preview = publicDailySnapshot(computeMerged(readRow(store.db, userId, date), date, parsed));
    const history = [...historical].map(([day, patch]) =>
      publicDailySnapshot(computeMerged(readRow(store.db, userId, day), day, patch, false)),
    );
    return { ok: true, dryRun: true, date, daily: preview, history, weightSynced: false };
  }

  return store.db.transaction(() => {
    const existingMain = readRow(store.db, userId, date);
    const mergedMain = computeMerged(existingMain, date, parsed);

    let weightSynced = false;
    // Route weight & bodyFat back to their actual measured date if measured earlier than today.
    const actualWeightDate = weightDate ?? date;
    const actualFatForWeight = bodyFatDate === actualWeightDate ? bodyFatPct : undefined;

    if (actualWeightDate === date) {
      weightSynced = maybeSyncWeightRecord(
        store,
        userId,
        date,
        weightKg,
        actualFatForWeight ?? (threeDaySync ? undefined : bodyFatPct),
        existingMain?.syncedWeightValue,
        existingMain?.syncedBodyFatValue,
      );
      if (weightSynced && weightKg != null) {
        mergedMain.syncedWeightValue = weightKg;
        if ((actualFatForWeight ?? (threeDaySync ? undefined : bodyFatPct)) != null) {
          mergedMain.syncedBodyFatValue = actualFatForWeight ?? (threeDaySync ? undefined : bodyFatPct);
        }
      }
    } else if (weightKg != null) {
      const existingWeightDay = readRow(store.db, userId, actualWeightDate);
      const mergedWeightDay = computeMerged(existingWeightDay, actualWeightDate, {
        weightKg,
        weightDate: actualWeightDate,
        ...(actualFatForWeight != null ? { bodyFatPct: actualFatForWeight, bodyFatDate: actualWeightDate } : {}),
      }, threeDaySync ? false : replace);
      weightSynced = maybeSyncWeightRecord(
        store,
        userId,
        actualWeightDate,
        weightKg,
        actualFatForWeight,
        existingWeightDay?.syncedWeightValue,
        existingWeightDay?.syncedBodyFatValue,
      );
      if (weightSynced) {
        mergedWeightDay.syncedWeightValue = weightKg;
        if (actualFatForWeight != null) mergedWeightDay.syncedBodyFatValue = actualFatForWeight;
      }
      writeRow(store.db, userId, actualWeightDate, mergedWeightDay);
    }

    for (const [day, patch] of historical) {
      writeRow(store.db, userId, day, computeMerged(readRow(store.db, userId, day), day, patch, false));
    }
    if (!threeDaySync || Object.values(parsed).some((value) => value !== undefined)) {
      writeRow(store.db, userId, date, mergedMain);
    }
    return { ok: true, dryRun: false, date, daily: publicDailySnapshot(mergedMain), weightSynced };
  }).immediate();
}

export function publicDailySnapshot(snapshot: DailyHealthSnapshot): DailyHealthSnapshot {
  const { syncedWeightValue: _w, syncedBodyFatValue: _f, syncedSleepObservations: _s, ...rest } = snapshot;
  return rest;
}

export function getDailyHealth(db: Db, userId: string, date: string): DailyHealthSnapshot | null {
  const row = readRow(db, userId, date);
  return row ? publicDailySnapshot(row) : null;
}

export function listDailyHealth(db: Db, userId: string, from: string, through: string): DailyHealthSnapshot[] {
  return listDailyHealthSnapshots(db, userId, from, through).map(publicDailySnapshot);
}

export function listDailyHealthSnapshots(db: Db, userId: string, from: string, through: string): DailyHealthSnapshot[] {
  const rows = dailyStatements(db).list.all(userId, from, through) as { date: string; updatedAt: string; data: string }[];
  return rows.map(({ date, updatedAt, data }) => ({ ...(JSON.parse(data) as DailyHealthSnapshot), date, updatedAt }));
}

export function alignSleepSnapshots(snapshots: DailyHealthSnapshot[]): DailyHealthSnapshot[] {
  const byDate = new Map(snapshots.map((snapshot) => [snapshot.date, snapshot]));
  const moved = new Map<string, { observations: SleepObservation[]; source: DailyHealthSnapshot }>();

  const withSleep = (snapshot: DailyHealthSnapshot, observations: SleepObservation[]) => {
    const next = { ...snapshot, syncedSleepObservations: observations };
    for (const key of SLEEP_SUMMARY_KEYS) delete next[key];
    return Object.assign(next, summarizeSleep(observations));
  };

  // Old uploads could assign a night to the date when its awake or in-bed sample ended.
  for (const snapshot of snapshots) {
    const groups = splitTimedSleepByDate(snapshot.syncedSleepObservations ?? []);
    let movedSleep = false;
    for (const [date, observations] of groups) {
      if (date === snapshot.date || !observations.some(({ stage }) => isAsleepStage(stage))) continue;
      const group = moved.get(date);
      if (group) group.observations.push(...observations);
      else moved.set(date, { observations: [...observations], source: snapshot });
      movedSleep = true;
    }
    if (movedSleep) {
      const remaining = withSleep(snapshot, groups.get(snapshot.date) ?? []);
      const { date, updatedAt, source, syncedSleepObservations, ...metrics } = remaining;
      if (Object.values(metrics).some((value) => value != null)) byDate.set(date, remaining);
      else byDate.delete(date);
    }
  }

  for (const [date, { observations, source }] of moved) {
    const existing = byDate.get(date) ?? { date, updatedAt: source.updatedAt, source: source.source };
    const merged = mergeSleepObservationLists(existing.syncedSleepObservations, observations);
    byDate.set(date, withSleep(existing, merged));
  }
  return [...byDate.values()].sort((first, second) => first.date.localeCompare(second.date));
}

export interface MetricSummary {
  count: number;
  latest: number;
  latestDate: string;
  first: number;
  delta: number | null;
  avg: number;
  min: number;
  max: number;
}

type StatusTone = "sweet" | "caution" | "danger";

export interface DailyHealthAnalyticsOptions {
  heightCm?: number | null;
  sex?: "male" | "female";
  through?: string;
}

function shiftIsoDate(date: string, deltaDays: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

function buildWeeklyComparison(entries: DailyHealthSnapshot[], throughDate?: string) {
  const anchor = throughDate ?? entries.at(-1)?.date ?? localDate();
  const rStart = shiftIsoDate(anchor, -6);
  const pStart = shiftIsoDate(anchor, -13);
  const pEnd = shiftIsoDate(anchor, -7);
  const recentEntries = entries.filter((e) => e.date >= rStart && e.date <= anchor);
  const prevEntries = entries.filter((e) => e.date >= pStart && e.date <= pEnd);

  const avgOf = (list: DailyHealthSnapshot[], key: keyof DailyHealthSnapshot, digits = 1) => {
    const vals = list.map((e) => e[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!vals.length) return null;
    return roundTo(vals.reduce((s, v) => s + v, 0) / vals.length, digits);
  };
  const compareMetric = (key: keyof DailyHealthSnapshot, label: string, unit: string, digits = 1) => {
    const current = avgOf(recentEntries, key, digits);
    const previous = avgOf(prevEntries, key, digits);
    if (current == null && previous == null) return null;
    return {
      key,
      label,
      unit,
      current,
      previous,
      delta: current != null && previous != null ? roundTo(current - previous, digits) : null,
    };
  };

  const metrics = [
    compareMetric("weightKg", "7日均体重", "kg", 2),
    compareMetric("restingHeartRateBpm", "7日静息心率", "bpm", 0),
    compareMetric("hrvMs", "7日 HRV", "ms", 1),
    compareMetric("steps", "7日均步数", "步", 0),
    compareMetric("activeEnergyKcal", "7日活动能量", "kcal", 0),
    compareMetric("sleepMinutes", "7日均睡眠", "分钟", 0),
  ].filter(Boolean);

  return {
    recentWindow: { from: rStart, through: anchor, daysWithData: recentEntries.length },
    previousWindow: { from: pStart, through: pEnd, daysWithData: prevEntries.length },
    hasPreviousBaseline: prevEntries.length > 0,
    metrics,
  };
}

function buildActivityReport(entries: DailyHealthSnapshot[], stats: Record<string, MetricSummary | null>) {
  const latest = entries.at(-1) ?? null;
  const steps = stats.steps;
  const dist = stats.distanceKm;
  const active = stats.activeEnergyKcal;
  const resting = stats.restingEnergyKcal;
  const flights = stats.flightsClimbed;
  const latestSteps = latest?.steps ?? steps?.latest ?? null;
  const latestDist = latest?.distanceKm ?? dist?.latest ?? null;
  const strideCm = latestSteps != null && latestSteps >= 100 && latestDist != null && latestDist > 0
    ? roundTo((latestDist * 100_000) / latestSteps, 1)
    : null;

  let activityTierLabel = "待同步日常活动";
  if (latestSteps != null) {
    activityTierLabel = latestSteps < 300
      ? "今日刚起步 (<300 步)"
      : latestSteps < 3000
        ? "轻度基础活动 (<3,000 步)"
        : latestSteps < 7500
          ? "日常中等活动 (3,000–7,499 步)"
          : latestSteps < 10000
            ? "日常活跃达标 (7,500+ 步)"
            : "高活力移动日 (≥10,000 步)";
  }

  return {
    hasData: [steps, dist, active, resting, flights].some(Boolean),
    latestSteps,
    latestDistanceKm: latestDist,
    latestActiveEnergyKcal: latest?.activeEnergyKcal ?? active?.latest ?? null,
    latestFlightsClimbed: latest?.flightsClimbed ?? flights?.latest ?? null,
    avgSteps: steps?.avg ?? null,
    avgDistanceKm: dist?.avg ?? null,
    avgActiveEnergyKcal: active?.avg ?? null,
    strideCm,
    activityTierLabel,
  };
}

const T_CRITICAL_TABLE: Record<number, readonly [number, number, number]> = {
  // [p < 0.10, p < 0.05, p < 0.01] two-tailed Student's t critical values
  2: [2.920, 4.303, 9.925],
  3: [2.353, 3.182, 5.841],
  4: [2.132, 2.776, 4.604],
  5: [2.015, 2.571, 4.032],
  6: [1.943, 2.447, 3.707],
  7: [1.895, 2.365, 3.499],
  8: [1.860, 2.306, 3.355],
  9: [1.833, 2.262, 3.250],
  10: [1.812, 2.228, 3.169],
  11: [1.796, 2.201, 3.106],
  12: [1.782, 2.179, 3.055],
  13: [1.771, 2.160, 3.012],
  14: [1.761, 2.145, 2.977],
  15: [1.753, 2.131, 2.947],
  16: [1.746, 2.120, 2.921],
  17: [1.740, 2.110, 2.898],
  18: [1.734, 2.101, 2.878],
  19: [1.729, 2.093, 2.861],
  20: [1.725, 2.086, 2.845],
};

function getTCriticals(df: number): readonly [number, number, number] {
  const cached = T_CRITICAL_TABLE[df];
  if (cached) return cached;
  // Cornish-Fisher approximation for df > 20
  const approx = (z: number) => z + (z ** 3 + z) / (4 * df);
  return [approx(1.6449), approx(1.9600), approx(2.5758)];
}

/** Computes Pearson correlation along with unrounded r for exact Student's t testing. */
function pearsonCorrelationStats(pairs: Array<[number, number]>): { r: number; rawR: number } | null {
  if (pairs.length < 4) return null;
  const n = pairs.length;
  let sumX = 0, sumY = 0;
  for (const [x, y] of pairs) { sumX += x; sumY += y; }
  const meanX = sumX / n, meanY = sumY / n;
  let num = 0, denX = 0, denY = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX, dy = y - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (!den) return null;
  const rawR = num / den;
  return { r: roundTo(rawR, 2), rawR };
}

function buildCorrelations(entries: DailyHealthSnapshot[]) {
  const candidates: Array<{ xKey: keyof DailyHealthSnapshot; yKey: keyof DailyHealthSnapshot; label: string }> = [
    { xKey: "sleepMinutes", yKey: "hrvMs", label: "睡眠时长 vs HRV 恢复" },
    { xKey: "sleepMinutes", yKey: "restingHeartRateBpm", label: "睡眠时长 vs 静息心率" },
    { xKey: "steps", yKey: "activeEnergyKcal", label: "日常步数 vs 活动消耗" },
    { xKey: "weightKg", yKey: "waistCm", label: "体重变化 vs 腰围变化" },
  ];
  return candidates.flatMap(({ xKey, yKey, label }) => {
    const pairs = entries
      .map((e) => [e[xKey], e[yKey]] as [unknown, unknown])
      .filter((pair): pair is [number, number] => typeof pair[0] === "number" && typeof pair[1] === "number");
    const stats = pearsonCorrelationStats(pairs);
    if (!stats || Math.abs(stats.r) < 0.45) return [];

    const n = pairs.length;
    const df = n - 2;
    const absR = Math.min(0.9999, Math.abs(stats.rawR));
    const tStat = absR >= 0.9999 ? 99.9 : roundTo(absR * Math.sqrt(df / (1 - absR * absR)), 2);
    const [tCrit10, tCrit05, tCrit01] = getTCriticals(df);
    if (tStat < tCrit10) return [];

    const pLabel = tStat >= tCrit01 ? "p < 0.01" : tStat >= tCrit05 ? "p < 0.05" : "p < 0.10 趋势";
    const strength = Math.abs(stats.r) >= 0.7 ? "强相关" : "中等相关";
    const direction = stats.r > 0 ? "正相关" : "负相关";
    return [{
      label,
      r: stats.r,
      sampleDays: n,
      tStat,
      pLabel,
      note: `${strength} (${direction} r=${stats.r}, t=${tStat}, ${pLabel})`,
    }];
  });
}

function summarizeMetric(entries: DailyHealthSnapshot[], key: keyof DailyHealthSnapshot, digits = 1): MetricSummary | null {
  let count = 0;
  let firstVal = 0;
  let lastVal = 0;
  let lastDate = "";
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const entry of entries) {
    const val = entry[key];
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    if (count === 0) firstVal = val;
    lastVal = val;
    lastDate = entry.date;
    count++;
    sum += val;
    if (val < min) min = val;
    if (val > max) max = val;
  }
  if (!count) return null;
  return {
    count,
    latest: roundTo(lastVal, digits),
    latestDate: lastDate,
    first: roundTo(firstVal, digits),
    delta: count >= 2 ? roundTo(lastVal - firstVal, digits) : null,
    avg: roundTo(sum / count, digits),
    min: roundTo(min, digits),
    max: roundTo(max, digits),
  };
}

function buildBodyCompositionReport(
  latestBody: {
    weightKg: { date: string; value: number } | null;
    bodyFatPct: { date: string; value: number } | null;
    leanBodyMassKg: { date: string; value: number } | null;
    bmi: { date: string; value: number } | null;
    waistCm: { date: string; value: number } | null;
  },
  deltas: Record<string, MetricSummary | null>,
  options: DailyHealthAnalyticsOptions,
  entries: DailyHealthSnapshot[] = [],
) {
  const sex: "male" | "female" = options.sex === "female" ? "female" : "male";
  const weightKg = latestBody.weightKg?.value ?? null;
  const bodyFatPct = latestBody.bodyFatPct?.value ?? null;
  const directLean = latestBody.leanBodyMassKg?.value ?? null;
  const leanBodyMassKg = directLean ?? (weightKg != null && bodyFatPct != null ? roundTo(weightKg * (1 - bodyFatPct / 100), 2) : null);
  const fatMassKg = weightKg != null && leanBodyMassKg != null
    ? roundTo(Math.max(0, weightKg - leanBodyMassKg), 2)
    : weightKg != null && bodyFatPct != null
      ? roundTo((weightKg * bodyFatPct) / 100, 2)
      : null;
  const leanSharePct = weightKg && leanBodyMassKg != null ? roundTo((leanBodyMassKg / weightKg) * 100, 1) : null;

  const profileHeight = typeof options.heightCm === "number" && options.heightCm >= 100 && options.heightCm <= 250
    ? options.heightCm
    : null;
  const rawBmi = latestBody.bmi?.value ?? null;
  const heightCm = profileHeight != null
    ? roundTo(profileHeight, 1)
    : weightKg != null && rawBmi != null && rawBmi > 0
      ? roundTo(Math.sqrt(weightKg / rawBmi) * 100, 1)
      : null;
  const heightSource = profileHeight != null ? "profile" : heightCm != null ? "bmi_inferred" : null;
  const heightM = heightCm != null ? heightCm / 100 : null;
  const bmi = rawBmi ?? (weightKg != null && heightM ? roundTo(weightKg / (heightM * heightM), 1) : null);

  let bmiStatus: { label: string; tone: StatusTone } | null = null;
  if (bmi != null) {
    bmiStatus = bmi < 18.5
      ? { label: "偏低 (<18.5)", tone: "caution" }
      : bmi < 24.0
        ? { label: "正常 (18.5–23.9)", tone: "sweet" }
        : bmi < 28.0
          ? { label: "超重区间 (24–27.9)", tone: "caution" }
          : { label: "肥胖区间 (≥28)", tone: "danger" };
  }

  let ffmi: number | null = null;
  let normalizedFfmi: number | null = null;
  let ffmiStatus: { label: string; tone: StatusTone } | null = null;
  if (leanBodyMassKg != null && heightM) {
    ffmi = roundTo(leanBodyMassKg / (heightM * heightM), 1);
    normalizedFfmi = roundTo(ffmi + 6.1 * (1.8 - heightM), 1);
    const thresholds = sex === "female" ? [14.5, 16.5, 18.0] : [18.0, 20.0, 22.0];
    ffmiStatus = ffmi < thresholds[0]!
      ? { label: "肌量偏薄", tone: "caution" }
      : ffmi < thresholds[1]!
        ? { label: "健康基础", tone: "sweet" }
        : ffmi < thresholds[2]!
          ? { label: "力量进阶", tone: "sweet" }
          : { label: "高阶肌量", tone: "sweet" };
  }

  const waistCm = latestBody.waistCm?.value ?? null;
  let waistStatus: { label: string; tone: StatusTone } | null = null;
  if (waistCm != null) {
    const highCut = sex === "female" ? 85 : 90;
    const midCut = sex === "female" ? 80 : 85;
    waistStatus = waistCm >= highCut
      ? { label: `临界/腹型提示 (≥${highCut} cm)`, tone: "caution" }
      : waistCm >= midCut
        ? { label: `接近上限 (${midCut}–${highCut - 0.1} cm)`, tone: "caution" }
        : { label: "中心脂肪控制良好", tone: "sweet" };
  }

  let whtr: number | null = null;
  let whtrStatus: { label: string; tone: StatusTone } | null = null;
  if (waistCm != null && heightCm) {
    whtr = roundTo(waistCm / heightCm, 3);
    whtrStatus = whtr < 0.5
      ? { label: "理想 (<0.50)", tone: "sweet" }
      : whtr < 0.55
        ? { label: "轻度偏高 (0.50–0.55)", tone: "caution" }
        : { label: "中心风险偏高 (≥0.55)", tone: "danger" };
  }

  const hasAny = [weightKg, bodyFatPct, leanBodyMassKg, bmi, waistCm].some((v) => v != null);
  const insights: string[] = [];
  if (hasAny) {
    if (weightKg != null && leanBodyMassKg != null && fatMassKg != null && bodyFatPct != null) {
      insights.push(`当前体重 ${weightKg} kg 中包含约 ${leanBodyMassKg} kg 瘦体重（${leanSharePct}%）与 ${fatMassKg} kg 体脂肪（${bodyFatPct}%）。`);
    }
    if (ffmi != null && heightCm != null) {
      const srcNote = heightSource === "bmi_inferred" ? `按估算身高约 ${heightCm} cm ` : `按身高 ${heightCm} cm `;
      insights.push(`${srcNote}对比你的瘦体重，肌肉储备处于「${ffmiStatus?.label}」水平。`);
    }
    if (whtr != null && waistCm != null) {
      insights.push(
        whtr >= 0.5
          ? `目前腰围 ${waistCm} cm（稍微偏圆一点），保持力量训练并适当少吃点热量，肚子会瘦得比较明显。`
          : `腰围 ${waistCm} cm，控制在很理想的范围内，内脏脂肪很少。`,
      );
    } else if (bmi != null && bmi >= 24 && ffmi != null && ffmi >= 18.5) {
      insights.push(`虽然按身高体重算偏重一点，但你的肌肉底子很扎实，结合体脂率和腰围来看比单看体重准确得多。`);
    }
    if (deltas.weightKg?.delta != null) {
      insights.push(`这段时间体重净变化 ${deltas.weightKg.delta > 0 ? "+" : ""}${deltas.weightKg.delta} kg（${deltas.weightKg.first} → ${deltas.weightKg.latest} kg）。`);
    }
  }

  let metabolic: {
    bmrKatchMcArdleKcal: number;
    sedentaryTdeeKcal: number;
    trainingTdeeKcal: number;
    recompCutTargetKcal: number;
    proteinTargetG: number;
    appleRestingAvgKcal: number | null;
    measuredVsPredictedPct: number | null;
  } | null = null;
  if (leanBodyMassKg != null) {
    const bmrKatchMcArdleKcal = Math.round(370 + 21.6 * leanBodyMassKg);
    const sedentaryTdeeKcal = Math.round(bmrKatchMcArdleKcal * 1.35);
    const trainingTdeeKcal = Math.round(bmrKatchMcArdleKcal * 1.55);
    const recompCutTargetKcal = Math.max(1200, trainingTdeeKcal - 400);
    const proteinTargetG = Math.max(
      weightKg != null ? Math.round(weightKg * 1.6) : 0,
      Math.round(leanBodyMassKg * 2.1),
    );
    // Compare only finished 24h calendar days against full-day BMR to avoid false midday deficit alarms
    const currentDay = localDate();
    const completedResting = entries
      .filter((e) => e.date < currentDay && typeof e.restingEnergyKcal === "number" && e.restingEnergyKcal > 0)
      .map((e) => e.restingEnergyKcal!);
    const appleRestingAvgKcal = completedResting.length > 0
      ? Math.round(completedResting.reduce((s, v) => s + v, 0) / completedResting.length)
      : null;
    const measuredVsPredictedPct = appleRestingAvgKcal != null && bmrKatchMcArdleKcal > 0
      ? roundTo(((appleRestingAvgKcal - bmrKatchMcArdleKcal) / bmrKatchMcArdleKcal) * 100, 1)
      : null;
    metabolic = {
      bmrKatchMcArdleKcal,
      sedentaryTdeeKcal,
      trainingTdeeKcal,
      recompCutTargetKcal,
      proteinTargetG,
      appleRestingAvgKcal,
      measuredVsPredictedPct,
    };
    if (appleRestingAvgKcal != null && measuredVsPredictedPct != null) {
      if (measuredVsPredictedPct < -10) {
        insights.push(`手表测得近期静息消耗约 ${appleRestingAvgKcal} kcal，比按身材推算的低了 ${Math.abs(measuredVsPredictedPct)}%，提示可能出现轻度热适应（代谢变省），偶尔可以安排一天吃回正常热量。`);
      } else if (measuredVsPredictedPct > 10) {
        insights.push(`手表测得近期静息消耗约 ${appleRestingAvgKcal} kcal，比公式估算还高 +${measuredVsPredictedPct}%，基础消耗挺活跃。`);
      } else {
        insights.push(`手表测得静息消耗（${appleRestingAvgKcal} kcal）与按肌肉量估算值（${bmrKatchMcArdleKcal} kcal）很接近，热量目标可信度很高。`);
      }
    } else if (deltas.restingEnergyKcal?.latest != null && completedResting.length === 0) {
      insights.push(`今日至今累计静息消耗约 ${Math.round(deltas.restingEnergyKcal.latest)} kcal（满整天后自动对照全天基础代谢）。`);
    }
  }

  const targetWaistCm = heightCm != null
    ? Math.floor(heightCm * 0.5)
    : (sex === "female" ? 80 : 85);
  const recompositionMilestones: {
    targetFatPct: number;
    label: string;
    targetWeightKg: number;
    fatToLoseKg: number;
    estWeeks: number;
    weeklyFatRateKg: number;
  }[] = [];
  if (leanBodyMassKg != null && weightKg != null && bodyFatPct != null) {
    // Helms (2014) bodyweight-scaled cut pacing (~0.6%/week) rather than a flat kg/week constant
    const weeklyFatRateKg = roundTo(Math.max(0.25, weightKg * 0.006), 2);
    const tiers = sex === "female"
      ? [{ pct: 26, label: "标准健美线 (26%)" }, { pct: 22, label: "运动清晰线 (22%)" }]
      : [{ pct: 20, label: "健康减脂线 (20%)" }, { pct: 15, label: "清晰腹肌线 (15%)" }];
    for (const tier of tiers) {
      if (bodyFatPct <= tier.pct + 0.3) continue;
      const targetWeightKg = roundTo(leanBodyMassKg / (1 - tier.pct / 100), 1);
      const fatToLoseKg = roundTo(Math.max(0.1, weightKg - targetWeightKg), 1);
      const estWeeks = Math.max(1, Math.round(fatToLoseKg / weeklyFatRateKg));
      recompositionMilestones.push({
        targetFatPct: tier.pct,
        label: tier.label,
        targetWeightKg,
        fatToLoseKg,
        estWeeks,
        weeklyFatRateKg,
      });
    }
  }
  const recomposition = hasAny && (recompositionMilestones.length > 0 || waistCm != null)
    ? {
        targetWaistCm,
        waistDeltaCm: waistCm != null ? roundTo(waistCm - targetWaistCm, 1) : null,
        milestones: recompositionMilestones,
      }
    : null;

  return {
    hasData: hasAny,
    weightKg,
    bodyFatPct,
    leanBodyMassKg,
    fatMassKg,
    leanSharePct,
    bmi,
    bmiStatus,
    waistCm,
    waistStatus,
    heightCm,
    heightSource,
    ffmi,
    normalizedFfmi,
    ffmiStatus,
    whtr,
    whtrStatus,
    metabolic,
    recomposition,
    measuredAt: {
      weightDate: latestBody.weightKg?.date ?? null,
      bodyFatDate: latestBody.bodyFatPct?.date ?? null,
      waistDate: latestBody.waistCm?.date ?? null,
    },
    insights,
  };
}

/** Computes sample mean and Bessel-corrected sample standard deviation when >= 3 points exist. */
function computeSampleMeanAndSd(values: number[]): { mean: number; sd: number } | null {
  if (values.length < 3) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

function buildRecoveryReport(entries: DailyHealthSnapshot[], stats: Record<string, MetricSummary | null>) {
  const baselineMode = entries.length >= 3 ? "personal_baseline" : "single_day_reference";
  type RangeBand = { min: number; max: number; optMin: number; optMax: number };
  type SignalItem = {
    key: string;
    label: string;
    value: number;
    unit: string;
    date: string;
    statusLabel: string;
    tone: StatusTone;
    score: number;
    weight: number;
    detail: string;
    zScore?: number | null;
    lnValue?: number | null;
    swcHalfSd?: number | null;
    rangeBand: RangeBand;
  };
  const signals: SignalItem[] = [];

  const rhr = stats.restingHeartRateBpm;
  if (rhr) {
    let score = 82;
    let tone: StatusTone = "sweet";
    let statusLabel = "恢复稳态";
    let detail = "正常静息心率区间 (55–69 bpm)";
    let zScore: number | null = null;
    let swcHalfSd: number | null = null;

    if (baselineMode === "personal_baseline") {
      const rhrVals = entries
        .map((e) => e.restingHeartRateBpm)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
      const dist = computeSampleMeanAndSd(rhrVals);
      const diff = roundTo(rhr.latest - rhr.avg, 1);

      if (dist && dist.sd >= 0.5) {
        zScore = roundTo((rhr.latest - dist.mean) / dist.sd, 2);
        swcHalfSd = roundTo(dist.sd * 0.5, 1);
        detail = `平时均值 ${rhr.avg} bpm，今天 ${diff > 0 ? "高 " + diff : diff < 0 ? "低 " + Math.abs(diff) : "持平"} bpm`;
        if (zScore <= 0.5) {
          score = zScore < -0.5 ? 95 : 90;
          tone = "sweet";
          statusLabel = zScore < -0.5 ? "恢复比平时还好" : "和平时一样稳";
        } else if (zScore <= 1.2) {
          score = 72;
          tone = "caution";
          statusLabel = "比平时略偏高";
        } else {
          score = 48;
          tone = "danger";
          statusLabel = "心率明显偏高";
        }
      } else {
        detail = `平时均值 ${rhr.avg} bpm (${diff >= 0 ? "+" : ""}${diff})`;
        if (diff <= 1.5) { score = 92; tone = "sweet"; statusLabel = "恢复稳定"; }
        else if (diff <= 4.5) { score = 72; tone = "caution"; statusLabel = "略微偏高"; }
        else { score = 48; tone = "danger"; statusLabel = "明显偏高"; }
      }
    } else if (rhr.latest < 60) {
      score = 94; statusLabel = "心肺底子很好"; detail = "静息心率 <60 bpm，有氧基础佳";
    } else if (rhr.latest >= 80) {
      score = 52; tone = "danger"; statusLabel = "偏高提醒休息"; detail = "≥80 bpm，留意休息与补水";
    } else if (rhr.latest >= 70) {
      score = 72; tone = "caution"; statusLabel = "稍微偏高"; detail = "70–79 bpm 区间";
    }
    signals.push({
      key: "restingHeartRateBpm", label: "静息心率", value: rhr.latest, unit: "bpm", date: rhr.latestDate,
      statusLabel, tone, score, weight: 30, detail, zScore, swcHalfSd,
      rangeBand: { min: 45, max: 95, optMin: 50, optMax: 69 },
    });
  }

  const hrv = stats.hrvMs;
  let hrvLnZScore: number | null = null;
  let lnHrvLatest: number | null = null;
  let lnHrvMean: number | null = null;
  let lnHrvSwc: number | null = null;
  if (hrv) {
    let score = 78;
    let tone: StatusTone = "sweet";
    let statusLabel = "状态稳定";
    let detail = "单日参考（连续同步 3 天后按个人平时水平对比）";
    lnHrvLatest = hrv.latest > 0 ? roundTo(Math.log(hrv.latest), 2) : null;

    if (baselineMode === "personal_baseline" && hrv.avg > 0 && hrv.latest > 0) {
      // Plews et al. (2013): log-transformed ln(rMSSD) reduces skew; SWC = +-0.5 SD
      const lnVals = entries
        .map((e) => e.hrvMs)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
        .map((v) => Math.log(v));
      const lnDist = computeSampleMeanAndSd(lnVals);
      const rawLnLatest = Math.log(hrv.latest);

      if (lnDist && lnDist.sd >= 0.02) {
        hrvLnZScore = roundTo((rawLnLatest - lnDist.mean) / lnDist.sd, 2);
        lnHrvMean = roundTo(lnDist.mean, 2);
        lnHrvSwc = roundTo(lnDist.sd * 0.5, 2);
        detail = `近期平时约 ${hrv.avg} ms，今日${hrvLnZScore > 0.5 ? "恢复明显好于平时" : hrvLnZScore >= -0.5 ? "处于平时稳定水平" : "比平时偏低"}`;
        if (hrvLnZScore >= -0.5) {
          score = hrvLnZScore > 0.5 ? 95 : 90;
          tone = "sweet";
          statusLabel = hrvLnZScore > 0.5 ? "恢复更有活力" : "稳态可练";
        } else if (hrvLnZScore >= -1.2) {
          score = 70;
          tone = "caution";
          statusLabel = "恢复略偏低";
        } else {
          score = 46;
          tone = "danger";
          statusLabel = "疲劳偏高";
        }
      } else {
        const pct = roundTo(((hrv.latest - hrv.avg) / hrv.avg) * 100, 1);
        detail = `近期平时约 ${hrv.avg} ms (${pct >= 0 ? "+" : ""}${pct}%)`;
        if (pct >= -5) { score = 92; tone = "sweet"; statusLabel = "恢复充沛"; }
        else if (pct >= -15) { score = 70; tone = "caution"; statusLabel = "略低于平时"; }
        else { score = 46; tone = "danger"; statusLabel = "疲劳偏高"; }
      }
    } else if (hrv.latest >= 50) {
      score = 92; tone = "sweet"; statusLabel = "恢复充沛";
    } else if (hrv.latest < 22) {
      score = 50; tone = "danger"; statusLabel = "身体较紧绷";
    } else if (hrv.latest < 35) {
      score = 68; tone = "caution"; statusLabel = "中等偏低";
    } else {
      score = 78; tone = "sweet"; statusLabel = "常规稳态";
    }
    signals.push({
      key: "hrvMs", label: "恢复活力 HRV", value: hrv.latest, unit: "ms", date: hrv.latestDate,
      statusLabel, tone, score, weight: 30, detail, zScore: hrvLnZScore, lnValue: lnHrvLatest, swcHalfSd: lnHrvSwc,
      rangeBand: { min: 15, max: Math.max(90, Math.ceil(hrv.latest + 15)), optMin: 35, optMax: 85 },
    });
  }

  const spo2 = stats.bloodOxygenPct;
  if (spo2) {
    const tone: StatusTone = spo2.latest >= 95 ? "sweet" : spo2.latest >= 92 ? "caution" : "danger";
    const statusLabel = spo2.latest >= 96 ? "氧合优良" : spo2.latest >= 95 ? "正常区间" : spo2.latest >= 92 ? "临界偏低" : "低氧提醒";
    const score = spo2.latest >= 96 ? 94 : spo2.latest >= 95 ? 84 : spo2.latest >= 92 ? 62 : 40;
    signals.push({
      key: "bloodOxygenPct", label: "血氧饱和度 SpO2", value: spo2.latest, unit: "%", date: spo2.latestDate,
      statusLabel, tone, score, weight: 10, detail: "正常成人参考 ≥95%",
      rangeBand: { min: 90, max: 100, optMin: 95, optMax: 100 },
    });
  }

  const resp = stats.respiratoryRate;
  if (resp) {
    // Apple Watch samples respiratory rate primarily during sleep, where 10.0-18.0 /min is normal adult range.
    const inCalm = resp.latest >= 10 && resp.latest <= 18;
    const inNorm = resp.latest >= 9 && resp.latest <= 20;
    const tone: StatusTone = inCalm ? "sweet" : inNorm ? "caution" : "danger";
    const statusLabel = inCalm ? "睡眠呼吸平稳" : inNorm ? "正常临界" : "节律偏离";
    const score = inCalm ? 92 : inNorm ? 76 : 52;
    signals.push({
      key: "respiratoryRate", label: "睡眠/静息呼吸", value: resp.latest, unit: "/分", date: resp.latestDate,
      statusLabel, tone, score, weight: 10, detail: "睡眠/静息参考 10–18 次/分",
      rangeBand: { min: 8, max: 24, optMin: 10, optMax: 18 },
    });
  }

  const sleep = stats.sleepMinutes;
  let latestSleepEntry: DailyHealthSnapshot | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (typeof entry.sleepMinutes === "number" && entry.sleepMinutes > 0) {
      latestSleepEntry = entry;
      break;
    }
  }
  if (sleep) {
    const hours = roundTo(sleep.latest / 60, 1);
    const tone: StatusTone = sleep.latest >= 420 ? "sweet" : sleep.latest >= 360 ? "caution" : "danger";
    const statusLabel = sleep.latest >= 420 ? "睡眠充足 (≥7h)" : sleep.latest >= 360 ? "轻度不足 (6–7h)" : "睡眠偏短 (<6h)";
    const score = sleep.latest >= 450 ? 94 : sleep.latest >= 420 ? 86 : sleep.latest >= 360 ? 68 : 46;
    const stageParts: string[] = [];
    if (latestSleepEntry?.sleepDeepMinutes != null) stageParts.push(`深睡 ${latestSleepEntry.sleepDeepMinutes}m`);
    if (latestSleepEntry?.sleepRemMinutes != null) stageParts.push(`REM ${latestSleepEntry.sleepRemMinutes}m`);
    if (stats.sleepEfficiencyPct) stageParts.push(`效率 ${stats.sleepEfficiencyPct.latest}%`);
    signals.push({
      key: "sleepMinutes", label: "睡眠时长", value: hours, unit: "h", date: sleep.latestDate,
      statusLabel, tone, score, weight: 20, detail: stageParts.length > 0 ? stageParts.join(" · ") : "夜间恢复",
      rangeBand: { min: 4, max: 10, optMin: 7, optMax: 9 },
    });
  }

  const weightSum = signals.reduce((s, item) => s + item.weight, 0);
  const readinessScore = weightSum > 0
    ? Math.round(signals.reduce((s, item) => s + item.score * item.weight, 0) / weightSum)
    : null;
  const readinessTone: StatusTone = readinessScore == null ? "caution"
    : readinessScore >= 80 ? "sweet"
      : readinessScore >= 62 ? "caution" : "danger";
  const readinessLabel = readinessScore == null ? "待同步恢复指标"
    : readinessScore >= 85 ? "恢复充沛 · 适合常规/进阶强度"
      : readinessScore >= 70 ? "状态平稳 · 正常按计划训练"
        : readinessScore >= 55 ? "恢复一般 · 控制RPE或总组数"
          : "疲劳信号偏强 · 建议主动恢复";

  const hrLatest = stats.heartRateBpm;
  const cardiacSpread = hrLatest && rhr ? roundTo(hrLatest.latest - rhr.latest, 0) : null;
  // Autonomic balance index: ln(rMSSD) / RHR * 100 (higher reflects greater vagal tone per beat)
  const autonomicBalanceRatio = hrv && hrv.latest > 0 && rhr && rhr.latest > 0
    ? roundTo((Math.log(hrv.latest) / rhr.latest) * 100, 2)
    : null;
  const lnHrvBaseline = lnHrvLatest != null
    ? { latest: lnHrvLatest, mean: lnHrvMean, swcHalfSd: lnHrvSwc, zScore: hrvLnZScore }
    : null;

  const insights: string[] = [];
  if (signals.length > 0) {
    if (baselineMode === "single_day_reference") {
      insights.push(`已记录首份体征档案（当前 ${entries.length} 天数据）。每个人平时心率和 HRV 差异很大，连续同步 3 天后会自动按你自己的习惯水平来对比。`);
    } else {
      insights.push(`已自动参考你最近 ${entries.length} 天的个人平时水平来评估今天是否疲劳。`);
    }
    if (hrvLnZScore != null) {
      insights.push(
        hrvLnZScore < -1.2
          ? "心率变异性比平时明显偏低，说明身体还有累积疲劳，今天建议放轻一点重量。"
          : hrvLnZScore > 0.5
            ? "身体恢复得比平时还要好，精力很足，今天按计划冲一冲完全没问题。"
            : "自主神经恢复在平时正常波动范围内，状态比较稳定。",
      );
    }
    if (hrLatest && rhr && cardiacSpread != null) {
      insights.push(`最近即时心率 ${hrLatest.latest} bpm，比静息心率 ${rhr.latest} bpm 高 ${cardiacSpread >= 0 ? "+" : ""}${cardiacSpread} bpm${cardiacSpread <= 25 ? "，日常静息状态平稳" : ""}。`);
    }
    if (latestSleepEntry?.sleepMinutes != null) {
      const totalMin = latestSleepEntry.sleepMinutes;
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const durText = `${h}小时${m > 0 ? `${String(m).padStart(2, "0")}分` : ""}`;
      const deep = latestSleepEntry.sleepDeepMinutes ?? 0;
      const rem = latestSleepEntry.sleepRemMinutes ?? 0;
      const restorativePct = deep + rem > 0 ? Math.round(((deep + rem) / totalMin) * 100) : null;
      const stageNote = restorativePct != null ? `（深睡 ${deep}分 + REM ${rem}分，深度恢复期占 ${restorativePct}%）` : "";
      let bedNote = "";
      if (latestSleepEntry.sleepStartAt) {
        const startMs = Date.parse(latestSleepEntry.sleepStartAt);
        if (Number.isFinite(startMs)) {
          const hkDate = new Date(startMs + 8 * 3_600_000);
          const bedH = hkDate.getUTCHours();
          const bedM = hkDate.getUTCMinutes();
          const bedClock = `${String(bedH).padStart(2, "0")}:${String(bedM).padStart(2, "0")}`;
          if (bedH >= 1 && bedH < 6) {
            bedNote = `；昨晚 ${bedClock} 入睡偏晚，尽量往 00:30 前调整更利于前半夜深睡分泌`;
          }
        }
      }
      const avgNote = sleep && sleep.count >= 2
        ? `，近 ${sleep.count} 晚平均 ${Math.floor(sleep.avg / 60)}小时${String(Math.round(sleep.avg % 60)).padStart(2, "0")}分`
        : "";
      insights.push(`最近一晚实睡 ${durText}${stageNote}${avgNote}${bedNote}。`);
    }
    if (resp && spo2) {
      insights.push(`血氧 ${spo2.latest}%、睡眠呼吸 ${resp.latest} 次/分，心肺基础指标平稳。`);
    }
  }

  return {
    hasData: signals.length > 0 || hrLatest != null || stats.vo2Max != null,
    readinessScore,
    readinessTone,
    readinessLabel,
    baselineMode,
    autonomicBalanceRatio,
    lnHrvBaseline,
    signals,
    heartRateLatest: hrLatest ? { value: hrLatest.latest, date: hrLatest.latestDate, spreadFromRhr: cardiacSpread } : null,
    vo2MaxLatest: stats.vo2Max ? { value: stats.vo2Max.latest, date: stats.vo2Max.latestDate } : null,
    insights,
  };
}

export function summarizeDailyHealth(entries: DailyHealthSnapshot[], options: DailyHealthAnalyticsOptions = {}) {
  const stats = {
    steps: summarizeMetric(entries, "steps", 0),
    activeEnergyKcal: summarizeMetric(entries, "activeEnergyKcal", 0),
    restingEnergyKcal: summarizeMetric(entries, "restingEnergyKcal", 0),
    totalEnergyKcal: summarizeMetric(entries, "totalEnergyKcal", 0),
    distanceKm: summarizeMetric(entries, "distanceKm", 2),
    flightsClimbed: summarizeMetric(entries, "flightsClimbed", 0),
    sleepMinutes: summarizeMetric(entries, "sleepMinutes", 0),
    sleepEfficiencyPct: summarizeMetric(entries, "sleepEfficiencyPct", 0),
    weightKg: summarizeMetric(entries, "weightKg", 2),
    bodyFatPct: summarizeMetric(entries, "bodyFatPct", 1),
    leanBodyMassKg: summarizeMetric(entries, "leanBodyMassKg", 2),
    bmi: summarizeMetric(entries, "bmi", 1),
    waistCm: summarizeMetric(entries, "waistCm", 1),
    heartRateBpm: summarizeMetric(entries, "heartRateBpm", 0),
    restingHeartRateBpm: summarizeMetric(entries, "restingHeartRateBpm", 0),
    hrvMs: summarizeMetric(entries, "hrvMs", 1),
    vo2Max: summarizeMetric(entries, "vo2Max", 1),
    bloodOxygenPct: summarizeMetric(entries, "bloodOxygenPct", 1),
    respiratoryRate: summarizeMetric(entries, "respiratoryRate", 1),
    waterMl: summarizeMetric(entries, "waterMl", 0),
    dietaryEnergyKcal: summarizeMetric(entries, "dietaryEnergyKcal", 0),
    dietaryProteinG: summarizeMetric(entries, "dietaryProteinG", 1),
  };

  const COVERAGE_LABELS: [keyof DailyHealthSnapshot, string, string][] = [
    ["steps", "步数", "活动"],
    ["activeEnergyKcal", "活动能量", "活动"],
    ["restingEnergyKcal", "静息能量", "活动"],
    ["distanceKm", "距离", "活动"],
    ["flightsClimbed", "楼层", "活动"],
    ["sleepMinutes", "睡眠", "心肺"],
    ["weightKg", "体重", "体成分"],
    ["bodyFatPct", "体脂率", "体成分"],
    ["leanBodyMassKg", "瘦体重", "体成分"],
    ["bmi", "BMI", "体成分"],
    ["waistCm", "腰围", "体成分"],
    ["restingHeartRateBpm", "静息心率", "心肺"],
    ["heartRateBpm", "即时心率", "心肺"],
    ["hrvMs", "HRV", "心肺"],
    ["vo2Max", "VO2 Max", "心肺"],
    ["bloodOxygenPct", "血氧", "心肺"],
    ["respiratoryRate", "呼吸频率", "心肺"],
    ["waterMl", "饮水", "营养"],
    ["dietaryEnergyKcal", "膳食能量", "营养"],
    ["dietaryProteinG", "蛋白质", "营养"],
    ["dietaryCarbsG", "碳水", "营养"],
    ["dietaryFatG", "总脂肪", "营养"],
  ];

  const latestBody: {
    weightKg: { date: string; value: number } | null;
    bodyFatPct: { date: string; value: number } | null;
    leanBodyMassKg: { date: string; value: number } | null;
    bmi: { date: string; value: number } | null;
    waistCm: { date: string; value: number } | null;
  } = {
    weightKg: null,
    bodyFatPct: null,
    leanBodyMassKg: null,
    bmi: null,
    waistCm: null,
  };
  const syncedKeySet = new Set<keyof DailyHealthSnapshot>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (latestBody.weightKg === null && entry.weightKg != null) {
      latestBody.weightKg = { date: entry.date, value: entry.weightKg };
    }
    if (latestBody.bodyFatPct === null && entry.bodyFatPct != null) {
      latestBody.bodyFatPct = { date: entry.date, value: entry.bodyFatPct };
    }
    if (latestBody.leanBodyMassKg === null && entry.leanBodyMassKg != null) {
      latestBody.leanBodyMassKg = { date: entry.date, value: entry.leanBodyMassKg };
    }
    if (latestBody.bmi === null && entry.bmi != null) {
      latestBody.bmi = { date: entry.date, value: entry.bmi };
    }
    if (latestBody.waistCm === null && entry.waistCm != null) {
      latestBody.waistCm = { date: entry.date, value: entry.waistCm };
    }
    if (syncedKeySet.size < COVERAGE_LABELS.length) {
      for (const [key] of COVERAGE_LABELS) {
        if (entry[key] != null) syncedKeySet.add(key);
      }
    }
  }

  const syncedMetrics = COVERAGE_LABELS
    .filter(([k]) => syncedKeySet.has(k))
    .map(([key, label, category]) => ({ key, label, category }));
  const missingMetrics = COVERAGE_LABELS
    .filter(([k]) => !syncedKeySet.has(k))
    .map(([key, label, category]) => ({ key, label, category }));
  const categoryOrder = ["体成分", "心肺", "活动", "营养"];
  const categoryProgress = categoryOrder.map((category) => {
    const items = COVERAGE_LABELS.filter(([, , cat]) => cat === category);
    const synced = items.filter(([k]) => syncedKeySet.has(k)).length;
    return { category, synced, total: items.length };
  });

  return {
    daysWithData: entries.length,
    latest: entries.at(-1) ?? null,
    averages: {
      steps: stats.steps?.avg ?? null,
      activeEnergyKcal: stats.activeEnergyKcal?.avg ?? null,
      restingEnergyKcal: stats.restingEnergyKcal?.avg ?? null,
      totalEnergyKcal: stats.totalEnergyKcal?.avg ?? null,
      distanceKm: stats.distanceKm?.avg ?? null,
      sleepMinutes: stats.sleepMinutes?.avg ?? null,
      sleepEfficiencyPct: stats.sleepEfficiencyPct?.avg ?? null,
      restingHeartRateBpm: stats.restingHeartRateBpm?.avg ?? null,
      heartRateBpm: stats.heartRateBpm?.avg ?? null,
      hrvMs: stats.hrvMs?.avg ?? null,
      vo2Max: stats.vo2Max?.avg ?? null,
      bloodOxygenPct: stats.bloodOxygenPct?.avg ?? null,
      respiratoryRate: stats.respiratoryRate?.avg ?? null,
      waterMl: stats.waterMl?.avg ?? null,
    },
    deltas: stats,
    latestBody,
    bodyReport: buildBodyCompositionReport(latestBody, stats, options, entries),
    recoveryReport: buildRecoveryReport(entries, stats),
    activityReport: buildActivityReport(entries, stats),
    correlations: buildCorrelations(entries),
    weeklyComparison: buildWeeklyComparison(entries, options.through),
    coverageSummary: {
      syncedCount: syncedMetrics.length,
      totalCount: COVERAGE_LABELS.length,
      syncedMetrics,
      missingMetrics,
      categoryProgress,
    },
    series: entries,
  };
}
