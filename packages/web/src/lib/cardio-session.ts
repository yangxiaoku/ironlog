import { getAppleCardioPreset, type AppleCardioPreset, type AppleCardioPresetId } from "./apple-fitness";
import type { FeelingKey } from "./domain";
import { elapsedAt, pauseAt, type WorkoutTiming } from "./haptics-audio";

export const CARDIO_SESSION_EVENT = "ironlog-cardio-session-change";
export const CARDIO_TARGET_MINUTES_OPTIONS = [null, 20, 30, 45, 60] as const;

export interface CardioLap {
  id: string;
  index: number;
  splitSeconds: number;
  cumulativeSeconds: number;
  recordedAt: string;
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
    if (!preset || !isValidTiming(parsed.timing) || typeof parsed.startedAt !== "string") {
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
    };
  } catch {
    return null;
  }
}

export function saveCardioSession(userId: string, session: LiveCardioSession): void {
  if (!userId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(cardioSessionStorageKey(userId), JSON.stringify(session));
    dispatchCardioSessionChange();
  } catch {}
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
): LiveCardioSession {
  const session = createCardioSession(preset, options);
  saveCardioSession(userId, session);
  return session;
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
    timing: {
      elapsedSeconds: session.timing.elapsedSeconds,
      runningSince: new Date(now).toISOString(),
    },
  };
}

export function recordCardioLap(session: LiveCardioSession, now = Date.now()): LiveCardioSession {
  const cumulativeSeconds = elapsedAt(session.timing, now);
  const prevTotal = session.laps.at(-1)?.cumulativeSeconds ?? 0;
  const splitSeconds = Math.max(0, cumulativeSeconds - prevTotal);
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
  const met = ACTIVITY_METS[activityType] ?? 7.0;
  const hours = elapsedSeconds / 3600;
  return Math.round(met * weightKg * hours);
}

export function formatCardioPaceOrSpeed(
  activityType: string,
  elapsedSeconds: number,
  distanceKmRaw: string,
): { label: string; value: string } | null {
  const km = Number.parseFloat(distanceKmRaw.trim());
  if (!Number.isFinite(km) || km <= 0 || elapsedSeconds <= 0) return null;
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
