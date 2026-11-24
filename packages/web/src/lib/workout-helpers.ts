export const soundPreference = "ironlog-web-rest-sound";
export const screenPreference = "ironlog-web-workout-screen";
export const rirPreference = "ironlog-web-show-rir";
export const dialPreference = "ironlog-web-auto-rest-dial";
export const notifyPreference = "ironlog-web-rest-notify";
export const barPreference = "ironlog-web-bar-weight";
export const platesPreference = "ironlog-web-plates";
export const autoSyncPreference = "ironlog-web-auto-sync-subsequent";
export const autoPrefillPreference = "ironlog-web-auto-prefill-last";
export const autoStartRestPreference = "ironlog-web-auto-start-rest";
export const autoAdvancePreference = "ironlog-web-auto-advance-exercise";
export const warmupRestPreference = "ironlog-web-warmup-rest-seconds";
export const restStepPreference = "ironlog-web-rest-step-seconds";
export const weightStepPreference = "ironlog-web-weight-step-kg";
export const hapticsPreference = "ironlog-web-haptics";
export const plateMathPreference = "ironlog-web-show-plate-math";
export const warmupSchemePreference = "ironlog-web-warmup-scheme";

export const WORKOUT_PREFS_EVENT = "ironlog:workout-prefs-changed";
export const PROFILE_VERSION_EVENT = "ironlog:profile-version";

export const ALL_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] as const;
export const DEFAULT_ENABLED_PLATES: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25];
export const WEIGHT_STEP_PRESETS = [0.5, 1, 1.25, 2.5, 5] as const;
export const WARMUP_REST_PRESETS = [0, 30, 45, 60] as const;
export const REST_STEP_PRESETS = [10, 15, 30] as const;

export type WarmupScheme = "light" | "standard" | "heavy";

export const WARMUP_SCHEMES: ReadonlyArray<{
  id: WarmupScheme;
  label: string;
  desc: string;
  steps: ReadonlyArray<readonly [number, number]>;
}> = [
  {
    id: "light",
    label: "2 组快速热身",
    desc: "50%×8 · 75%×4",
    steps: [
      [0.5, 8],
      [0.75, 4],
    ],
  },
  {
    id: "standard",
    label: "3 组经典渐进",
    desc: "50%×8 · 70%×5 · 85%×2",
    steps: [
      [0.5, 8],
      [0.7, 5],
      [0.85, 2],
    ],
  },
  {
    id: "heavy",
    label: "4 组大重量坡度",
    desc: "40%×8 · 60%×5 · 75%×3 · 88%×1",
    steps: [
      [0.4, 8],
      [0.6, 5],
      [0.75, 3],
      [0.88, 1],
    ],
  },
];

export const BAR_PRESETS: ReadonlyArray<readonly [number, string]> = [
  [20, "20kg杆"],
  [15, "15kg杆"],
  [10, "10kg曲杆"],
  [25, "25kg六角"],
  [0, "0kg纯挂片"],
];

export interface WorkoutPreferences {
  soundOn: boolean;
  hapticsOn: boolean;
  screenAwake: boolean;
  notifyRest: boolean;
  showRir: boolean;
  autoSyncSubsequent: boolean;
  autoPrefillLast: boolean;
  autoStartRestTimer: boolean;
  autoAdvanceExercise: boolean;
  warmupRestSeconds: number;
  restAdjustStep: number;
  weightStepKg: number;
  barWeight: number;
  enabledPlates: number[];
  showPlateMath: boolean;
  warmupScheme: WarmupScheme;
}

export const DEFAULT_WORKOUT_PREFERENCES: WorkoutPreferences = {
  soundOn: true,
  hapticsOn: true,
  screenAwake: false,
  notifyRest: false,
  showRir: false,
  autoSyncSubsequent: true,
  autoPrefillLast: true,
  autoStartRestTimer: true,
  autoAdvanceExercise: true,
  warmupRestSeconds: 45,
  restAdjustStep: 15,
  weightStepKg: 2.5,
  barWeight: 20,
  enabledPlates: [...DEFAULT_ENABLED_PLATES],
  showPlateMath: true,
  warmupScheme: "standard",
};

function readBoolPrefValue(key: string, defaultOn: boolean): boolean {
  if (typeof localStorage === "undefined") return defaultOn;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultOn;
    if (raw === "on" || raw === "1" || raw === "true") return true;
    if (raw === "off" || raw === "0" || raw === "false") return false;
    return defaultOn;
  } catch {
    return defaultOn;
  }
}

function readAllowedNumberPref(key: string, allowed: readonly number[], fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && allowed.includes(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readBarWeightPref(): number {
  if (typeof localStorage === "undefined") return DEFAULT_WORKOUT_PREFERENCES.barWeight;
  try {
    const raw = localStorage.getItem(barPreference);
    if (raw == null) return DEFAULT_WORKOUT_PREFERENCES.barWeight;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_WORKOUT_PREFERENCES.barWeight;
  } catch {
    return DEFAULT_WORKOUT_PREFERENCES.barWeight;
  }
}

function readEnabledPlatesPref(): number[] {
  if (typeof localStorage === "undefined") return [...DEFAULT_ENABLED_PLATES];
  try {
    const raw = JSON.parse(localStorage.getItem(platesPreference) ?? "null");
    if (Array.isArray(raw)) {
      const valid = [...new Set(raw.map(Number).filter((p) => (ALL_PLATES as readonly number[]).includes(p)))].sort(
        (a, b) => b - a,
      );
      if (valid.length > 0) return valid;
    }
  } catch {}
  return [...DEFAULT_ENABLED_PLATES];
}

function readWarmupSchemePref(): WarmupScheme {
  if (typeof localStorage === "undefined") return DEFAULT_WORKOUT_PREFERENCES.warmupScheme;
  try {
    const raw = localStorage.getItem(warmupSchemePreference);
    if (raw === "light" || raw === "standard" || raw === "heavy") return raw;
  } catch {}
  return DEFAULT_WORKOUT_PREFERENCES.warmupScheme;
}

/**
 * Safely reads unified in-session workout preferences with validated defaults.
 */
export function readWorkoutPreferences(): WorkoutPreferences {
  return {
    soundOn: readBoolPrefValue(soundPreference, DEFAULT_WORKOUT_PREFERENCES.soundOn),
    hapticsOn: readBoolPrefValue(hapticsPreference, DEFAULT_WORKOUT_PREFERENCES.hapticsOn),
    screenAwake: readBoolPrefValue(screenPreference, DEFAULT_WORKOUT_PREFERENCES.screenAwake),
    notifyRest: readBoolPrefValue(notifyPreference, DEFAULT_WORKOUT_PREFERENCES.notifyRest),
    showRir: readBoolPrefValue(rirPreference, DEFAULT_WORKOUT_PREFERENCES.showRir),
    autoSyncSubsequent: readBoolPrefValue(autoSyncPreference, DEFAULT_WORKOUT_PREFERENCES.autoSyncSubsequent),
    autoPrefillLast: readBoolPrefValue(autoPrefillPreference, DEFAULT_WORKOUT_PREFERENCES.autoPrefillLast),
    autoStartRestTimer: readBoolPrefValue(autoStartRestPreference, DEFAULT_WORKOUT_PREFERENCES.autoStartRestTimer),
    autoAdvanceExercise: readBoolPrefValue(autoAdvancePreference, DEFAULT_WORKOUT_PREFERENCES.autoAdvanceExercise),
    warmupRestSeconds: readAllowedNumberPref(
      warmupRestPreference,
      WARMUP_REST_PRESETS,
      DEFAULT_WORKOUT_PREFERENCES.warmupRestSeconds,
    ),
    restAdjustStep: readAllowedNumberPref(
      restStepPreference,
      REST_STEP_PRESETS,
      DEFAULT_WORKOUT_PREFERENCES.restAdjustStep,
    ),
    weightStepKg: readAllowedNumberPref(
      weightStepPreference,
      WEIGHT_STEP_PRESETS,
      DEFAULT_WORKOUT_PREFERENCES.weightStepKg,
    ),
    barWeight: readBarWeightPref(),
    enabledPlates: readEnabledPlatesPref(),
    showPlateMath: readBoolPrefValue(plateMathPreference, DEFAULT_WORKOUT_PREFERENCES.showPlateMath),
    warmupScheme: readWarmupSchemePref(),
  };
}

type WorkoutPrefsSyncPusher = (prefs: WorkoutPreferences) => Promise<void> | void;

let syncPusher: WorkoutPrefsSyncPusher | null = null;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Registers or clears the cloud sync handler invoked (debounced) after local workout preference updates.
 */
export function configureWorkoutPrefsSync(pusher: WorkoutPrefsSyncPusher | null): void {
  syncPusher = pusher;
  if (!pusher && syncDebounceTimer != null) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
}

function scheduleWorkoutPrefsSync(): void {
  if (!syncPusher) return;
  if (syncDebounceTimer != null) clearTimeout(syncDebounceTimer);
  const pusher = syncPusher;
  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = null;
    try {
      void Promise.resolve(pusher(readWorkoutPreferences())).catch(() => {});
    } catch {}
  }, 400);
}

function persistSinglePreference<K extends keyof WorkoutPreferences>(
  key: K,
  value: WorkoutPreferences[K],
): void {
  if (typeof localStorage === "undefined") return;
  try {
    switch (key) {
      case "soundOn":
        localStorage.setItem(soundPreference, value ? "on" : "off");
        break;
      case "hapticsOn":
        localStorage.setItem(hapticsPreference, value ? "1" : "0");
        break;
      case "screenAwake":
        localStorage.setItem(screenPreference, value ? "on" : "off");
        break;
      case "notifyRest":
        localStorage.setItem(notifyPreference, value ? "on" : "off");
        break;
      case "showRir":
        localStorage.setItem(rirPreference, value ? "on" : "off");
        break;
      case "autoSyncSubsequent":
        localStorage.setItem(autoSyncPreference, value ? "on" : "off");
        break;
      case "autoPrefillLast":
        localStorage.setItem(autoPrefillPreference, value ? "on" : "off");
        break;
      case "autoStartRestTimer":
        localStorage.setItem(autoStartRestPreference, value ? "on" : "off");
        break;
      case "autoAdvanceExercise":
        localStorage.setItem(autoAdvancePreference, value ? "on" : "off");
        break;
      case "showPlateMath":
        localStorage.setItem(plateMathPreference, value ? "on" : "off");
        break;
      case "warmupRestSeconds":
        localStorage.setItem(warmupRestPreference, String(value));
        break;
      case "restAdjustStep":
        localStorage.setItem(restStepPreference, String(value));
        break;
      case "weightStepKg":
        localStorage.setItem(weightStepPreference, String(value));
        break;
      case "barWeight":
        localStorage.setItem(barPreference, String(value));
        break;
      case "enabledPlates": {
        const list = Array.isArray(value)
          ? [...new Set(value.map(Number).filter((p) => (ALL_PLATES as readonly number[]).includes(p)))].sort(
              (a, b) => b - a,
            )
          : [...DEFAULT_ENABLED_PLATES];
        localStorage.setItem(
          platesPreference,
          JSON.stringify(list.length ? list : [...DEFAULT_ENABLED_PLATES]),
        );
        break;
      }
      case "warmupScheme":
        localStorage.setItem(warmupSchemePreference, String(value));
        break;
    }
  } catch {}
}

/**
 * Persists a single workout preference key, notifies local listeners, and queues cloud sync.
 */
export function writeWorkoutPreference<K extends keyof WorkoutPreferences>(
  key: K,
  value: WorkoutPreferences[K],
): void {
  persistSinglePreference(key, value);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WORKOUT_PREFS_EVENT));
  }
  scheduleWorkoutPrefsSync();
}

/**
 * Applies remote profile workout preferences locally without triggering a redundant push back.
 */
export function applyRemoteWorkoutPreferences(
  remote: Partial<WorkoutPreferences> | null | undefined,
): WorkoutPreferences {
  if (!remote || typeof remote !== "object") return readWorkoutPreferences();
  const boolKeys = [
    "soundOn",
    "hapticsOn",
    "screenAwake",
    "notifyRest",
    "showRir",
    "autoSyncSubsequent",
    "autoPrefillLast",
    "autoStartRestTimer",
    "autoAdvanceExercise",
    "showPlateMath",
  ] as const;
  for (const key of boolKeys) {
    if (typeof remote[key] === "boolean") persistSinglePreference(key, remote[key]!);
  }
  if (
    typeof remote.warmupRestSeconds === "number" &&
    (WARMUP_REST_PRESETS as readonly number[]).includes(remote.warmupRestSeconds)
  ) {
    persistSinglePreference("warmupRestSeconds", remote.warmupRestSeconds);
  }
  if (
    typeof remote.restAdjustStep === "number" &&
    (REST_STEP_PRESETS as readonly number[]).includes(remote.restAdjustStep)
  ) {
    persistSinglePreference("restAdjustStep", remote.restAdjustStep);
  }
  if (
    typeof remote.weightStepKg === "number" &&
    (WEIGHT_STEP_PRESETS as readonly number[]).includes(remote.weightStepKg)
  ) {
    persistSinglePreference("weightStepKg", remote.weightStepKg);
  }
  if (typeof remote.barWeight === "number" && Number.isFinite(remote.barWeight) && remote.barWeight >= 0 && remote.barWeight <= 100) {
    persistSinglePreference("barWeight", remote.barWeight);
  }
  if (Array.isArray(remote.enabledPlates)) {
    const valid = [...new Set(remote.enabledPlates.map(Number).filter((p) => (ALL_PLATES as readonly number[]).includes(p)))].sort(
      (a, b) => b - a,
    );
    if (valid.length > 0) persistSinglePreference("enabledPlates", valid);
  }
  if (remote.warmupScheme === "light" || remote.warmupScheme === "standard" || remote.warmupScheme === "heavy") {
    persistSinglePreference("warmupScheme", remote.warmupScheme);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WORKOUT_PREFS_EVENT));
  }
  return readWorkoutPreferences();
}

export interface SetFieldPatch {
  weight?: number;
  reps?: number;
  seconds?: number;
}

/**
 * Applies a set field update and, when enabled on working sets, cascades changes
 * to subsequent incomplete working sets without touching completed or warmup sets.
 */
export function applySetFieldUpdate<
  T extends { weight: number; reps: number; seconds: number; completed: boolean; type?: string },
>(
  sets: readonly T[],
  setIdx: number,
  patch: SetFieldPatch,
  options: { autoSyncSubsequent?: boolean } = {},
): T[] {
  const next = sets.map((s) => ({ ...s }));
  const current = next[setIdx];
  if (!current) return next;

  const definedPatch: SetFieldPatch = {};
  if (patch.weight !== undefined) definedPatch.weight = patch.weight;
  if (patch.reps !== undefined) definedPatch.reps = patch.reps;
  if (patch.seconds !== undefined) definedPatch.seconds = patch.seconds;

  Object.assign(current, definedPatch);

  const shouldCascade = (options.autoSyncSubsequent ?? true) && current.type !== "warmup";
  if (shouldCascade) {
    for (let j = setIdx + 1; j < next.length; j++) {
      const target = next[j];
      if (!target || target.completed || target.type === "warmup") continue;
      Object.assign(target, definedPatch);
    }
  }
  return next;
}

/**
 * Generates warmup set prescriptions snapped to configured bar weight and plate inventory.
 */
export function buildWarmupSetsPlan(
  workingWeight: number,
  isBarbell: boolean,
  barWeight = 20,
  enabledPlates: readonly number[] = DEFAULT_ENABLED_PLATES,
  scheme: WarmupScheme = "standard",
): Array<{ weight: number; reps: number }> {
  const def = WARMUP_SCHEMES.find((s) => s.id === scheme) ?? WARMUP_SCHEMES[1]!;
  return def.steps.map(([pct, reps]) => ({
    weight: snapWarmupWeight(workingWeight * pct, isBarbell, barWeight, enabledPlates),
    reps,
  }));
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PlateBreakdownResult {
  valid: boolean;
  bar: number;
  perSide: number;
  plates: number[];
  remainder: number;
  achievable: boolean;
}

export function plateBreakdown(
  totalWeight: number,
  barWeight = 20,
  availablePlates: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25],
): PlateBreakdownResult {
  const weight = Number(totalWeight);
  const rawBar = Number(barWeight);
  const bar = Number.isFinite(rawBar) && rawBar >= 0 ? rawBar : 20;
  if (!Number.isFinite(weight) || weight <= bar || weight > 5000) {
    return { valid: false, bar, perSide: 0, plates: [], remainder: 0, achievable: true };
  }
  const perSide = round2((weight - bar) / 2);
  let remaining = perSide;
  const fallback = [25, 20, 15, 10, 5, 2.5, 1.25];
  const sortedPlates = [
    ...new Set(
      (availablePlates.length ? availablePlates : fallback)
        .map(Number)
        .filter((p) => Number.isFinite(p) && p > 0),
    ),
  ].sort((a, b) => b - a);
  const plates: number[] = [];
  for (const plate of sortedPlates) {
    while (plates.length < 64 && remaining + 1e-6 >= plate) {
      plates.push(plate);
      remaining = round2(remaining - plate);
    }
    if (plates.length >= 64) break;
  }
  return { valid: true, bar, perSide, plates, remainder: remaining, achievable: remaining <= 0.01 };
}

export function plateDeltaLabel(
  prevWeight: number,
  curWeight: number,
  barWeight = 20,
  enabledPlates: readonly number[] = ALL_PLATES,
): string {
  if (!(prevWeight > barWeight) || !(curWeight > barWeight) || prevWeight === curWeight) return "";
  const prevCalc = plateBreakdown(prevWeight, barWeight, enabledPlates);
  const curCalc = plateBreakdown(curWeight, barWeight, enabledPlates);
  if (!prevCalc.valid || !curCalc.valid) return "";
  const counts = new Map<number, number>();
  for (const p of curCalc.plates) counts.set(p, (counts.get(p) ?? 0) + 1);
  for (const p of prevCalc.plates) counts.set(p, (counts.get(p) ?? 0) - 1);
  const parts: string[] = [];
  for (const w of [...counts.keys()].sort((a, b) => a - b)) {
    const diff = counts.get(w) ?? 0;
    for (let k = 0; k < Math.abs(diff); k++) parts.push(`${diff < 0 ? "-" : "+"}${w}`);
  }
  return parts.join(" ");
}

export function snapWarmupWeight(
  target: number,
  isBarbell: boolean,
  barWeight = 20,
  enabledPlates: readonly number[] = ALL_PLATES,
): number {
  if (isBarbell) {
    if (target <= barWeight) return barWeight;
    const calc = plateBreakdown(target, barWeight, enabledPlates);
    if (!calc.valid) return barWeight;
    return Math.max(barWeight, round2(calc.bar + 2 * (calc.perSide - calc.remainder)));
  }
  const step = target < 15 ? 1 : 2.5;
  return Math.max(step, Math.round(target / step) * step);
}
