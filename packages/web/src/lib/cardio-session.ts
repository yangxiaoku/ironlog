import { localDate, type AppleWorkoutAnnotationInput } from "@ironlog/shared";
import { getAppleCardioPreset, type AppleCardioPreset, type AppleCardioPresetId } from "./apple-fitness";
import type { FeelingKey } from "./domain";
import { elapsedAt, formatClock, pauseAt, type WorkoutTiming } from "./haptics-audio";

export const CARDIO_SESSION_EVENT = "ironlog-cardio-session-change";
export const CARDIO_TARGET_MINUTES_OPTIONS = [null, 20, 30, 45, 60] as const;

export interface CardioLap {
  id: string;
  index: number;
  splitSeconds: number;
  cumulativeSeconds: number;
  recordedAt: string;
}

export interface PendingCardioSave {
  opId: string;
  payload: Record<string, unknown>;
  sentAt: string;
}

export interface LiveCardioSession {
  id: string;
  presetId: AppleCardioPresetId;
  label: string;
  appleWorkoutLabel: string;
  activityType: string;
  environment: "indoor" | "outdoor";
  startedAt: string;
  timing: WorkoutTiming;
  targetMinutes: number | null;
  laps: CardioLap[];
  distanceKm: string;
  feeling: FeelingKey | null;
  notes: string;
  finishedAt?: string;
  appleSyncRequestedAt?: string;
  pendingSave?: PendingCardioSave;
}

const ACTIVITY_METS: Record<string, number> = {
  running: 9.2,
  cycling: 7.5,
  stairClimbing: 8.8,
  elliptical: 6.2,
  rowing: 7.8,
  swimming: 8.3,
  highIntensityIntervalTraining: 9.5,
  jumpRope: 10.5,
  walking: 4.0,
  hiking: 6.0,
  mixedCardio: 7.0,
};

export function cardioSessionStorageKey(userId: string): string {
  return `ironlog-web-cardio-session:${userId}`;
}

function dispatchCardioSessionChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(CARDIO_SESSION_EVENT));
  } catch {}
}

function makeSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cardio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidTiming(val: unknown): val is WorkoutTiming {
  if (!val || typeof val !== "object") return false;
  const t = val as Record<string, unknown>;
  const elapsedOk = typeof t.elapsedSeconds === "number" && Number.isFinite(t.elapsedSeconds) && t.elapsedSeconds >= 0;
  const runningOk = t.runningSince === null || (typeof t.runningSince === "string" && Number.isFinite(Date.parse(t.runningSince)));
  return elapsedOk && runningOk;
}

export function readCardioSession(userId: string): LiveCardioSession | null {
  if (!userId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cardioSessionStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LiveCardioSession>;
    const preset = getAppleCardioPreset(parsed.presetId);
    if (!preset || !isValidTiming(parsed.timing) || typeof parsed.startedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.startedAt))) {
      return null;
    }
    const laps: CardioLap[] = Array.isArray(parsed.laps)
      ? parsed.laps
          .filter(
            (lap): lap is CardioLap =>
              Boolean(lap && typeof lap === "object") &&
              typeof lap.splitSeconds === "number" &&
              typeof lap.cumulativeSeconds === "number",
          )
          .map((lap, idx) => ({
            id: typeof lap.id === "string" && lap.id ? lap.id : `lap-${idx + 1}`,
            index: idx + 1,
            splitSeconds: Math.max(0, Math.round(lap.splitSeconds)),
            cumulativeSeconds: Math.max(0, Math.round(lap.cumulativeSeconds)),
            recordedAt: typeof lap.recordedAt === "string" ? lap.recordedAt : parsed.startedAt!,
          }))
      : [];
    return {
      id: typeof parsed.id === "string" && parsed.id ? parsed.id : makeSessionId(),
      presetId: preset.id,
      label: typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim() : preset.label,
      appleWorkoutLabel:
        typeof parsed.appleWorkoutLabel === "string" && parsed.appleWorkoutLabel.trim()
          ? parsed.appleWorkoutLabel.trim()
          : preset.appleWorkoutLabel,
      activityType: typeof parsed.activityType === "string" && parsed.activityType ? parsed.activityType : preset.activityType,
      environment: parsed.environment === "outdoor" || parsed.environment === "indoor" ? parsed.environment : preset.environment,
      startedAt: parsed.startedAt,
      timing: {
        elapsedSeconds: Math.max(0, Math.floor(parsed.timing.elapsedSeconds)),
        runningSince: parsed.timing.runningSince,
      },
      targetMinutes:
        typeof parsed.targetMinutes === "number" && Number.isFinite(parsed.targetMinutes) && parsed.targetMinutes > 0
          ? Math.round(parsed.targetMinutes)
          : null,
      laps,
      distanceKm: typeof parsed.distanceKm === "string" ? parsed.distanceKm : "",
      feeling:
        parsed.feeling === "easy" || parsed.feeling === "balanced" || parsed.feeling === "fatigued"
          ? parsed.feeling
          : null,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      finishedAt: typeof parsed.finishedAt === "string" && Number.isFinite(Date.parse(parsed.finishedAt)) ? parsed.finishedAt : undefined,
      appleSyncRequestedAt: typeof parsed.appleSyncRequestedAt === "string" && Number.isFinite(Date.parse(parsed.appleSyncRequestedAt))
        ? parsed.appleSyncRequestedAt : undefined,
      pendingSave:
        parsed.pendingSave &&
        typeof parsed.pendingSave === "object" &&
        typeof parsed.pendingSave.opId === "string" &&
        parsed.pendingSave.payload &&
        typeof parsed.pendingSave.payload === "object"
          ? parsed.pendingSave
          : undefined,
    };
  } catch {
    return null;
  }
}

export function saveCardioSession(userId: string, session: LiveCardioSession): boolean {
  if (!userId || typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(cardioSessionStorageKey(userId), JSON.stringify(session));
    dispatchCardioSessionChange();
    return true;
  } catch {
    return false;
  }
}

export function clearCardioSession(userId: string): void {
  if (!userId || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(cardioSessionStorageKey(userId));
    dispatchCardioSessionChange();
  } catch {}
}

export function createCardioSession(
  preset: AppleCardioPreset,
  options: { now?: number; targetMinutes?: number | null } = {},
): LiveCardioSession {
  const nowIso = new Date(options.now ?? Date.now()).toISOString();
  return {
    id: makeSessionId(),
    presetId: preset.id,
    label: preset.label,
    appleWorkoutLabel: preset.appleWorkoutLabel,
    activityType: preset.activityType,
    environment: preset.environment,
    startedAt: nowIso,
    timing: {
      elapsedSeconds: 0,
      runningSince: nowIso,
    },
    targetMinutes: options.targetMinutes ?? null,
    laps: [],
    distanceKm: "",
    feeling: null,
    notes: "",
  };
}

export function startCardioSession(
  userId: string,
  preset: AppleCardioPreset,
  options: { now?: number; targetMinutes?: number | null } = {},
): LiveCardioSession | null {
  const existing = readCardioSession(userId);
  if (existing) return existing;
  const session = createCardioSession(preset, options);
  return saveCardioSession(userId, session) ? session : null;
}

export function toggleCardioSessionPause(session: LiveCardioSession, now = Date.now()): LiveCardioSession {
  if (session.timing.runningSince) {
    return {
      ...session,
      timing: pauseAt(session.timing, now),
    };
  }
  return {
    ...session,
    finishedAt: undefined,
    appleSyncRequestedAt: undefined,
    timing: {
      elapsedSeconds: session.timing.elapsedSeconds,
      runningSince: new Date(now).toISOString(),
    },
  };
}

export function finishCardioTiming(session: LiveCardioSession, now = Date.now()): LiveCardioSession {
  return session.finishedAt ? session : {
    ...session,
    timing: pauseAt(session.timing, now),
    finishedAt: new Date(now).toISOString(),
  };
}

export function requestCardioAppleSync(userId: string, session: LiveCardioSession, now = Date.now()): boolean {
  return saveCardioSession(userId, {
    ...finishCardioTiming(session, now),
    appleSyncRequestedAt: new Date(now).toISOString(),
  });
}

function canonicalCardioActivity(rawType: string): { base: string; inferredEnv?: "indoor" | "outdoor" } {
  const trimmed = rawType.trim();
  const localized: Record<string, { base: string; inferredEnv?: "indoor" | "outdoor" }> = {
    "户外跑步": { base: "running", inferredEnv: "outdoor" },
    "戶外跑步": { base: "running", inferredEnv: "outdoor" },
    "室内跑步": { base: "running", inferredEnv: "indoor" },
    "室內跑步": { base: "running", inferredEnv: "indoor" },
    "跑步": { base: "running" },
    "户外骑行": { base: "cycling", inferredEnv: "outdoor" },
    "室内骑行": { base: "cycling", inferredEnv: "indoor" },
    "骑行": { base: "cycling" },
    "户外步行": { base: "walking", inferredEnv: "outdoor" },
    "室内步行": { base: "walking", inferredEnv: "indoor" },
    "步行": { base: "walking" },
  };
  if (Object.hasOwn(localized, trimmed)) return localized[trimmed]!;
  const code = trimmed.toLowerCase().replace(/^hkworkoutactivitytype/, "").replace(/[-_\s]/g, "");
  const prefixMatch = /^(indoor|outdoor)(running|walking|cycling)$/.exec(code);
  if (prefixMatch) {
    return { base: prefixMatch[2]!, inferredEnv: prefixMatch[1] as "indoor" | "outdoor" };
  }
  const suffixMatch = /^(running|walking|cycling)(indoor|outdoor)$/.exec(code);
  if (suffixMatch) {
    return { base: suffixMatch[1]!, inferredEnv: suffixMatch[2] as "indoor" | "outdoor" };
  }
  return { base: code };
}

export function matchesCardioAppleWorkout(session: LiveCardioSession, workout: {
  activityType: string; environment?: string; startedAt: string; endedAt: string;
}): boolean {
  if (!session.finishedAt || !session.appleSyncRequestedAt) return false;
  const sessionNorm = canonicalCardioActivity(session.activityType);
  const workoutNorm = canonicalCardioActivity(workout.activityType);
  const effectiveWorkoutEnv =
    workout.environment && workout.environment !== "unknown"
      ? workout.environment
      : workoutNorm.inferredEnv;
  const effectiveSessionEnv = session.environment ?? sessionNorm.inferredEnv;
  return workoutNorm.base === sessionNorm.base &&
    (effectiveWorkoutEnv == null || effectiveSessionEnv == null || effectiveWorkoutEnv === effectiveSessionEnv) &&
    Math.abs(Date.parse(workout.startedAt) - Date.parse(session.startedAt)) <= 120_000 &&
    Date.parse(workout.endedAt) >= Date.parse(session.finishedAt) - 120_000 &&
    Date.parse(workout.endedAt) <= Date.parse(session.appleSyncRequestedAt) + 120_000;
}

/**
 * Strict distance parser that normalizes comma decimal separators ("5,5" -> 5.5) and rejects malformed text (#79).
 */
export function parseCardioDistanceKm(raw: string): { valid: boolean; valueKm: number | null; normalized: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true, valueKm: null, normalized: "" };
  const normalized = trimmed.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return { valid: false, valueKm: null, normalized: "" };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > 500) {
    return { valid: false, valueKm: null, normalized: "" };
  }
  const rounded = Math.round(value * 100) / 100;
  return { valid: true, valueKm: rounded, normalized: String(rounded) };
}

export function buildCardioAppleAnnotation(session: LiveCardioSession): AppleWorkoutAnnotationInput {
  const notes = session.notes.trim();
  const parsedDist = parseCardioDistanceKm(session.distanceKm);
  const distanceKm = parsedDist.valid ? parsedDist.normalized : "";
  const lapSeconds = session.laps.map((lap) => lap.splitSeconds);
  return { sessionId: session.id, notes, distanceKm, feeling: session.feeling, lapSeconds };
}

export function buildCardioWorkoutMutation(
  session: LiveCardioSession,
  now = Date.now(),
  options?: { weightKg?: number; opId?: string; baseVersion?: number },
) {
  const finished = finishCardioTiming(session, now);
  const totalSec = Math.max(1, finished.timing.elapsedSeconds);
  const endedAt = finished.finishedAt!;
  const parsedDist = parseCardioDistanceKm(finished.distanceKm);
  const normalizedDistStr = parsedDist.valid ? parsedDist.normalized : "";
  const distanceMeters = parsedDist.valueKm != null ? Math.round(parsedDist.valueKm * 1000) : null;
  const pace = formatCardioPaceOrSpeed(finished.activityType, totalSec, normalizedDistStr);
  const estimatedKcal = estimateCardioCalories(finished.activityType, totalSec, options?.weightKg ?? 70);
  const laps = finished.laps.map((lap) => `#${lap.index} ${formatClock(lap.splitSeconds)}`).join(" / ");
  const notes = [
    normalizedDistStr && `距离：${normalizedDistStr} km`,
    pace && `${pace.label}：${pace.value}`,
    laps && `分段：${laps}`,
    finished.notes.trim(),
  ].filter(Boolean).join(" · ").slice(0, 4000);
  const id = `cardio-${finished.id}`;
  return {
    id,
    opId: options?.opId ?? `${id}-save`,
    baseVersion: options?.baseVersion ?? 0,
    deleted: false,
    kind: "workout" as const,
    data: {
      title: finished.label,
      date: localDate(Date.parse(finished.startedAt)),
      startedAt: finished.startedAt,
      endedAt,
      status: "completed" as const,
      source: "manual" as const,
      timing: finished.timing,
      feeling: finished.feeling,
      notes,
      cardioMeta: {
        activityType: finished.activityType,
        environment: finished.environment,
        distanceMeters,
        estimatedKcal,
        lapSeconds: finished.laps.map((l) => l.splitSeconds),
      },
      exercises: [{
        id: `${id}-exercise`,
        exerciseId: `cardio-${finished.presetId}`,
        restSeconds: 0,
        snapshot: {
          name: finished.label, muscle: "cardio", equipment: "bodyweight", mode: "timed", volumeMultiplier: 1,
        },
        sets: [{
          id: `${id}-set`, type: "normal", weight: 0, reps: 0, seconds: Math.min(totalSec, 86400),
          completed: true, completedAt: endedAt, rir: null,
        }],
      }],
    },
  };
}

export function recordCardioLap(session: LiveCardioSession, now = Date.now()): LiveCardioSession {
  const cumulativeSeconds = elapsedAt(session.timing, now);
  const prevTotal = session.laps.at(-1)?.cumulativeSeconds ?? 0;
  const splitSeconds = Math.max(0, cumulativeSeconds - prevTotal);
  // #80: Never append a 0-second lap when no new elapsed time occurred since the previous lap (e.g., while paused).
  if (splitSeconds <= 0) return session;
  const nextLap: CardioLap = {
    id: `lap-${session.laps.length + 1}-${now}`,
    index: session.laps.length + 1,
    splitSeconds,
    cumulativeSeconds,
    recordedAt: new Date(now).toISOString(),
  };
  return {
    ...session,
    laps: [...session.laps, nextLap],
  };
}

export function estimateCardioCalories(activityType: string, elapsedSeconds: number, weightKg = 70): number {
  if (elapsedSeconds <= 0) return 0;
  const safeWeight = Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 350 ? weightKg : 70;
  const met = ACTIVITY_METS[activityType] ?? 7.0;
  const hours = elapsedSeconds / 3600;
  return Math.round(met * safeWeight * hours);
}

export function formatCardioPaceOrSpeed(
  activityType: string,
  elapsedSeconds: number,
  distanceKmRaw: string,
): { label: string; value: string } | null {
  const parsed = parseCardioDistanceKm(distanceKmRaw);
  const km = parsed.valueKm;
  if (!parsed.valid || km == null || km <= 0 || elapsedSeconds <= 0) return null;
  if (activityType === "cycling") {
    const kmh = km / (elapsedSeconds / 3600);
    if (!Number.isFinite(kmh) || kmh <= 0 || kmh > 120) return null;
    return { label: "均速", value: `${kmh.toFixed(1)} km/h` };
  }
  const secPerKm = elapsedSeconds / km;
  if (!Number.isFinite(secPerKm) || secPerKm < 60 || secPerKm > 3600) return null;
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  const adjustedMins = secs === 60 ? mins + 1 : mins;
  const adjustedSecs = secs === 60 ? 0 : secs;
  return {
    label: "配速",
    value: `${adjustedMins}'${String(adjustedSecs).padStart(2, "0")}"/km`,
  };
}

export function formatStartClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
