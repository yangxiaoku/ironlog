export const soundPreference = "ironlog-web-rest-sound";
export const soundStylePreference = "ironlog-web-rest-sound-style";
export const appleFitnessAutoLaunchPreference = "ironlog-web-apple-fitness-auto";
export const appleStrengthLaunchPreference = "ironlog-web-apple-strength-mode";
export const appleCardioLaunchPreference = "ironlog-web-apple-cardio-mode";
export const appleHubShortcutPreference = "ironlog-web-apple-hub-shortcut";
export const appleStrengthShortcutPreference = "ironlog-web-apple-strength-shortcut";
export const appleCardioShortcutPreference = "ironlog-web-apple-cardio-shortcut";
export const appleAutoSyncOnFinishPreference = "ironlog-web-apple-auto-sync-finish";
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
export const deloadModePreference = "ironlog-web-deload-mode";
export const deloadWeightPctPreference = "ironlog-web-deload-weight-pct";
export const deloadSetsPctPreference = "ironlog-web-deload-sets-pct";
export const workoutLayoutPreference = "ironlog-web-workout-layout";
export const collapseCompletedPreference = "ironlog-web-collapse-completed";
export const voiceRestCuesPreference = "ironlog-web-voice-rest-cues";
export const platePairsPreference = "ironlog-web-plate-pairs";
export const hiddenModulesPreference = "ironlog-web-hidden-modules";
export const demoDisplayModePreference = "ironlog-web-demo-display";

export type DemoDisplayMode = "small" | "large" | "hidden";
export const DEMO_DISPLAY_PRESETS: ReadonlyArray<{ id: DemoDisplayMode; label: string }> = [
  { id: "small", label: "缩略动图" },
  { id: "large", label: "大图示范" },
  { id: "hidden", label: "隐藏示范" },
];

export type HiddenModuleKey = "diet" | "sleep" | "badges" | "ai" | "plateMath" | "rir";
export const MODULAR_UI_OPTIONS: ReadonlyArray<{ id: HiddenModuleKey; label: string; desc: string }> = [
  { id: "diet", label: "饮食与营养", desc: "隐藏底部/侧栏饮食入口（保留已有数据）" },
  { id: "sleep", label: "睡眠报告", desc: "隐藏分析页睡眠专题页签" },
  { id: "badges", label: "成就勋章", desc: "隐藏勋章墙入口" },
  { id: "ai", label: "AI 助手", desc: "隐藏 AI 计划/复盘/调整快捷按钮" },
  { id: "plateMath", label: "杠铃配片", desc: "隐藏训中杠铃片配重计算" },
  { id: "rir", label: "RIR 强度", desc: "隐藏训中 RIR 储备次数列" },
];

export const WORKOUT_PREFS_EVENT = "ironlog:workout-prefs-changed";
export const PROFILE_VERSION_EVENT = "ironlog:profile-version";

export const ALL_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] as const;
export const DEFAULT_ENABLED_PLATES: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25];
export const WEIGHT_STEP_PRESETS = [0.5, 1, 1.25, 2.5, 5] as const;
export const WARMUP_REST_PRESETS = [0, 30, 45, 60] as const;
export const REST_STEP_PRESETS = [10, 15, 30] as const;

export type WarmupScheme = "light" | "standard" | "heavy";
export type RestSoundStyle = "chime" | "marimba" | "bell";
export type WorkoutLayoutMode = "card" | "compact" | "focus";
export type AppleFitnessLaunchMode = "hub" | "shortcut" | "fitness_app" | "off";

export const WORKOUT_LAYOUT_PRESETS: ReadonlyArray<{ id: WorkoutLayoutMode; label: string; desc: string }> = [
  { id: "card", label: "标准卡片", desc: "完整展示目标、上次记录与配片" },
  { id: "compact", label: "紧凑列表", desc: "高密度组行，一屏总览多组" },
  { id: "focus", label: "专注单动作", desc: "大字大触控区，单手极速录组" },
];

export interface EquipmentProfilePreset {
  id: string;
  name: string;
  equipment: Array<"barbell" | "dumbbell" | "cable" | "machine" | "bodyweight" | "kettlebell" | "band" | "weighted">;
  barWeight: number;
  enabledPlates: number[];
  platePairs?: Record<string, number>;
  dumbbellMinKg?: number;
  dumbbellMaxKg?: number;
  dumbbellStepKg?: number;
}

export const DEFAULT_EQUIPMENT_PROFILES: readonly EquipmentProfilePreset[] = [
  {
    id: "gym_commercial",
    name: "商业健身房",
    equipment: ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "weighted"],
    barWeight: 20,
    enabledPlates: [25, 20, 15, 10, 5, 2.5, 1.25],
    platePairs: { "25": 4, "20": 4, "15": 2, "10": 4, "5": 4, "2.5": 2, "1.25": 2 },
    dumbbellMinKg: 2,
    dumbbellMaxKg: 50,
    dumbbellStepKg: 2,
  },
  {
    id: "home_compact",
    name: "居家训练",
    equipment: ["dumbbell", "bodyweight", "band"],
    barWeight: 10,
    enabledPlates: [10, 5, 2.5, 1.25],
    platePairs: { "10": 2, "5": 2, "2.5": 2, "1.25": 2 },
    dumbbellMinKg: 2,
    dumbbellMaxKg: 24,
    dumbbellStepKg: 2,
  },
];

export const DEFAULT_APPLE_HUB_SHORTCUT = "铁记-通用-Apple健康全能联动";
export const DEFAULT_APPLE_STRENGTH_SHORTCUT = "铁记开始力量";
export const DEFAULT_APPLE_CARDIO_SHORTCUT = "铁记开始有氧";

export const REST_SOUND_PRESETS: ReadonlyArray<{ id: RestSoundStyle; label: string }> = [
  { id: "chime", label: "柔和风铃" },
  { id: "marimba", label: "暖木马林巴" },
  { id: "bell", label: "清透轻铃" },
];

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
  soundStyle: RestSoundStyle;
  appleFitnessAutoLaunch: boolean;
  appleStrengthLaunch: AppleFitnessLaunchMode;
  appleCardioLaunch: AppleFitnessLaunchMode;
  appleHubShortcutName: string;
  appleStrengthShortcutName: string;
  appleCardioShortcutName: string;
  appleAutoSyncOnFinish: boolean;
  deloadMode: boolean;
  deloadWeightPct: number;
  deloadSetsPct: number;
  workoutLayout: WorkoutLayoutMode;
  collapseCompletedExercises: boolean;
  voiceRestCues: boolean;
  platePairs?: Record<string, number>;
  hiddenModules?: HiddenModuleKey[];
  demoDisplayMode?: DemoDisplayMode;
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
  soundStyle: "chime",
  appleFitnessAutoLaunch: false,
  appleStrengthLaunch: "hub",
  appleCardioLaunch: "hub",
  appleHubShortcutName: DEFAULT_APPLE_HUB_SHORTCUT,
  appleStrengthShortcutName: DEFAULT_APPLE_STRENGTH_SHORTCUT,
  appleCardioShortcutName: DEFAULT_APPLE_CARDIO_SHORTCUT,
  appleAutoSyncOnFinish: false,
  deloadMode: false,
  deloadWeightPct: 80,
  deloadSetsPct: 50,
  workoutLayout: "card",
  collapseCompletedExercises: false,
  voiceRestCues: false,
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

function readSoundStylePref(): RestSoundStyle {
  if (typeof localStorage === "undefined") return DEFAULT_WORKOUT_PREFERENCES.soundStyle;
  try {
    const raw = localStorage.getItem(soundStylePreference);
    if (raw === "chime" || raw === "marimba" || raw === "bell") return raw;
  } catch {}
  return DEFAULT_WORKOUT_PREFERENCES.soundStyle;
}

function isAppleLaunchMode(raw: unknown): raw is AppleFitnessLaunchMode {
  return raw === "hub" || raw === "shortcut" || raw === "fitness_app" || raw === "off";
}

function readAppleLaunchModePref(key: string, fallback: AppleFitnessLaunchMode): AppleFitnessLaunchMode {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (isAppleLaunchMode(raw)) return raw;
  } catch {}
  return fallback;
}

function sanitizeShortcutName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim().slice(0, 80);
  return trimmed || fallback;
}

function readShortcutNamePref(key: string, fallback: string): string {
  if (typeof localStorage === "undefined") return fallback;
  try {
    return sanitizeShortcutName(localStorage.getItem(key), fallback);
  } catch {}
  return fallback;
}

function readIntRangePref(key: string, min: number, max: number, fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  } catch {}
  return fallback;
}

function readWorkoutLayoutPref(): WorkoutLayoutMode {
  if (typeof localStorage === "undefined") return DEFAULT_WORKOUT_PREFERENCES.workoutLayout;
  try {
    const raw = localStorage.getItem(workoutLayoutPreference);
    if (raw === "card" || raw === "compact" || raw === "focus") return raw;
  } catch {}
  return DEFAULT_WORKOUT_PREFERENCES.workoutLayout;
}

function readPlatePairsPref(): Record<string, number> | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = JSON.parse(localStorage.getItem(platePairsPreference) ?? "null");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n >= 0 && n <= 20) clean[k] = n;
      }
      if (Object.keys(clean).length) return clean;
    }
  } catch {}
  return undefined;
}

function readHiddenModulesPref(): HiddenModuleKey[] | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = JSON.parse(localStorage.getItem(hiddenModulesPreference) ?? "null");
    if (Array.isArray(raw)) {
      const valid = [...new Set(raw.filter((x): x is HiddenModuleKey =>
        ["diet", "sleep", "badges", "ai", "plateMath", "rir"].includes(String(x)),
      ))];
      if (valid.length) return valid;
    }
  } catch {}
  return undefined;
}

function readDemoDisplayModePref(): DemoDisplayMode | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(demoDisplayModePreference);
    if (raw === "small" || raw === "large" || raw === "hidden") return raw;
  } catch {}
  return undefined;
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
    soundStyle: readSoundStylePref(),
    appleFitnessAutoLaunch: readBoolPrefValue(
      appleFitnessAutoLaunchPreference,
      DEFAULT_WORKOUT_PREFERENCES.appleFitnessAutoLaunch,
    ),
    appleStrengthLaunch: readAppleLaunchModePref(
      appleStrengthLaunchPreference,
      DEFAULT_WORKOUT_PREFERENCES.appleStrengthLaunch,
    ),
    appleCardioLaunch: readAppleLaunchModePref(
      appleCardioLaunchPreference,
      DEFAULT_WORKOUT_PREFERENCES.appleCardioLaunch,
    ),
    appleHubShortcutName: readShortcutNamePref(
      appleHubShortcutPreference,
      DEFAULT_APPLE_HUB_SHORTCUT,
    ),
    appleStrengthShortcutName: readShortcutNamePref(
      appleStrengthShortcutPreference,
      DEFAULT_APPLE_STRENGTH_SHORTCUT,
    ),
    appleCardioShortcutName: readShortcutNamePref(
      appleCardioShortcutPreference,
      DEFAULT_APPLE_CARDIO_SHORTCUT,
    ),
    appleAutoSyncOnFinish: readBoolPrefValue(
      appleAutoSyncOnFinishPreference,
      DEFAULT_WORKOUT_PREFERENCES.appleAutoSyncOnFinish,
    ),
    deloadMode: readBoolPrefValue(deloadModePreference, DEFAULT_WORKOUT_PREFERENCES.deloadMode),
    deloadWeightPct: readIntRangePref(
      deloadWeightPctPreference,
      50,
      95,
      DEFAULT_WORKOUT_PREFERENCES.deloadWeightPct,
    ),
    deloadSetsPct: readIntRangePref(
      deloadSetsPctPreference,
      25,
      100,
      DEFAULT_WORKOUT_PREFERENCES.deloadSetsPct,
    ),
    workoutLayout: readWorkoutLayoutPref(),
    collapseCompletedExercises: readBoolPrefValue(
      collapseCompletedPreference,
      DEFAULT_WORKOUT_PREFERENCES.collapseCompletedExercises,
    ),
    voiceRestCues: readBoolPrefValue(
      voiceRestCuesPreference,
      DEFAULT_WORKOUT_PREFERENCES.voiceRestCues,
    ),
    ...(() => {
      const pairs = readPlatePairsPref();
      const hidden = readHiddenModulesPref();
      const demoMode = readDemoDisplayModePref();
      return {
        ...(pairs ? { platePairs: pairs } : {}),
        ...(hidden ? { hiddenModules: hidden } : {}),
        ...(demoMode ? { demoDisplayMode: demoMode } : {}),
      };
    })(),
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
      case "soundStyle":
        localStorage.setItem(soundStylePreference, String(value));
        break;
      case "appleFitnessAutoLaunch":
        localStorage.setItem(appleFitnessAutoLaunchPreference, value ? "on" : "off");
        break;
      case "appleStrengthLaunch":
        localStorage.setItem(appleStrengthLaunchPreference, String(value));
        break;
      case "appleCardioLaunch":
        localStorage.setItem(appleCardioLaunchPreference, String(value));
        break;
      case "appleHubShortcutName":
        localStorage.setItem(
          appleHubShortcutPreference,
          sanitizeShortcutName(value, DEFAULT_APPLE_HUB_SHORTCUT),
        );
        break;
      case "appleStrengthShortcutName":
        localStorage.setItem(
          appleStrengthShortcutPreference,
          sanitizeShortcutName(value, DEFAULT_APPLE_STRENGTH_SHORTCUT),
        );
        break;
      case "appleCardioShortcutName":
        localStorage.setItem(
          appleCardioShortcutPreference,
          sanitizeShortcutName(value, DEFAULT_APPLE_CARDIO_SHORTCUT),
        );
        break;
      case "appleAutoSyncOnFinish":
        localStorage.setItem(appleAutoSyncOnFinishPreference, value ? "on" : "off");
        break;
      case "deloadMode":
        localStorage.setItem(deloadModePreference, value ? "on" : "off");
        break;
      case "deloadWeightPct":
        localStorage.setItem(
          deloadWeightPctPreference,
          String(Math.max(50, Math.min(95, Math.round(Number(value) || 80)))),
        );
        break;
      case "deloadSetsPct":
        localStorage.setItem(
          deloadSetsPctPreference,
          String(Math.max(25, Math.min(100, Math.round(Number(value) || 50)))),
        );
        break;
      case "workoutLayout":
        localStorage.setItem(workoutLayoutPreference, String(value));
        break;
      case "collapseCompletedExercises":
        localStorage.setItem(collapseCompletedPreference, value ? "on" : "off");
        break;
      case "voiceRestCues":
        localStorage.setItem(voiceRestCuesPreference, value ? "on" : "off");
        break;
      case "platePairs":
        if (value && typeof value === "object" && Object.keys(value).length) {
          localStorage.setItem(platePairsPreference, JSON.stringify(value));
        } else {
          localStorage.removeItem(platePairsPreference);
        }
        break;
      case "hiddenModules":
        if (Array.isArray(value) && value.length) {
          localStorage.setItem(hiddenModulesPreference, JSON.stringify(value));
        } else {
          localStorage.removeItem(hiddenModulesPreference);
        }
        break;
      case "demoDisplayMode":
        if (value === "small" || value === "large" || value === "hidden") {
          localStorage.setItem(demoDisplayModePreference, value);
        } else {
          localStorage.removeItem(demoDisplayModePreference);
        }
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
    "appleFitnessAutoLaunch",
    "appleAutoSyncOnFinish",
    "deloadMode",
    "collapseCompletedExercises",
    "voiceRestCues",
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
  if (remote.soundStyle === "chime" || remote.soundStyle === "marimba" || remote.soundStyle === "bell") {
    persistSinglePreference("soundStyle", remote.soundStyle);
  }
  if (isAppleLaunchMode(remote.appleStrengthLaunch)) {
    persistSinglePreference("appleStrengthLaunch", remote.appleStrengthLaunch);
  }
  if (isAppleLaunchMode(remote.appleCardioLaunch)) {
    persistSinglePreference("appleCardioLaunch", remote.appleCardioLaunch);
  }
  if (typeof remote.appleHubShortcutName === "string") {
    const cleaned = remote.appleHubShortcutName.trim().slice(0, 80);
    if (cleaned) persistSinglePreference("appleHubShortcutName", cleaned);
  }
  if (typeof remote.appleStrengthShortcutName === "string") {
    const cleaned = remote.appleStrengthShortcutName.trim().slice(0, 80);
    if (cleaned) persistSinglePreference("appleStrengthShortcutName", cleaned);
  }
  if (typeof remote.appleCardioShortcutName === "string") {
    const cleaned = remote.appleCardioShortcutName.trim().slice(0, 80);
    if (cleaned) persistSinglePreference("appleCardioShortcutName", cleaned);
  }
  if (typeof remote.deloadWeightPct === "number" && Number.isFinite(remote.deloadWeightPct)) {
    const clamped = Math.max(50, Math.min(95, Math.round(remote.deloadWeightPct)));
    persistSinglePreference("deloadWeightPct", clamped);
  }
  if (typeof remote.deloadSetsPct === "number" && Number.isFinite(remote.deloadSetsPct)) {
    const clamped = Math.max(25, Math.min(100, Math.round(remote.deloadSetsPct)));
    persistSinglePreference("deloadSetsPct", clamped);
  }
  if (remote.workoutLayout === "card" || remote.workoutLayout === "compact" || remote.workoutLayout === "focus") {
    persistSinglePreference("workoutLayout", remote.workoutLayout);
  }
  if (remote.platePairs && typeof remote.platePairs === "object") {
    persistSinglePreference("platePairs", remote.platePairs);
  }
  if (Array.isArray(remote.hiddenModules)) {
    persistSinglePreference("hiddenModules", remote.hiddenModules);
  }
  if (remote.demoDisplayMode === "small" || remote.demoDisplayMode === "large" || remote.demoDisplayMode === "hidden") {
    persistSinglePreference("demoDisplayMode", remote.demoDisplayMode);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WORKOUT_PREFS_EVENT));
  }
  return readWorkoutPreferences();
}

const ALL_WORKOUT_PREF_KEYS = [
  soundPreference,
  soundStylePreference,
  screenPreference,
  rirPreference,
  dialPreference,
  notifyPreference,
  barPreference,
  platesPreference,
  autoSyncPreference,
  autoPrefillPreference,
  autoStartRestPreference,
  autoAdvancePreference,
  warmupRestPreference,
  restStepPreference,
  weightStepPreference,
  hapticsPreference,
  plateMathPreference,
  warmupSchemePreference,
  appleFitnessAutoLaunchPreference,
  appleStrengthLaunchPreference,
  appleCardioLaunchPreference,
  appleHubShortcutPreference,
  appleStrengthShortcutPreference,
  appleCardioShortcutPreference,
  appleAutoSyncOnFinishPreference,
  deloadModePreference,
  deloadWeightPctPreference,
  deloadSetsPctPreference,
  workoutLayoutPreference,
  collapseCompletedPreference,
  voiceRestCuesPreference,
  platePairsPreference,
  hiddenModulesPreference,
  demoDisplayModePreference,
] as const;

/**
 * Clears all persisted local workout preferences and cancels pending cloud syncs (e.g. on logout).
 */
export function resetLocalWorkoutPreferences(): void {
  if (syncDebounceTimer != null) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
  if (typeof localStorage !== "undefined") {
    for (const key of ALL_WORKOUT_PREF_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WORKOUT_PREFS_EVENT));
  }
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

const PLATE_DP_SCALE = 4; // 0.25 kg resolution
const PLATE_MAX_COUNT = 64;
const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

function sanitizeAvailablePlates(availablePlates: readonly number[]): number[] {
  const source = availablePlates.length ? availablePlates : DEFAULT_PLATES;
  return [...new Set(source.map(Number).filter((p) => Number.isFinite(p) && p > 0))].sort((a, b) => b - a);
}

function areQuarterMultiples(plates: readonly number[]): boolean {
  return plates.every((p) => Math.abs(p * PLATE_DP_SCALE - Math.round(p * PLATE_DP_SCALE)) < 1e-4);
}

function runPlateDp(
  maxUnits: number,
  plateUnits: readonly number[],
  maxPlates = PLATE_MAX_COUNT,
): { dpCount: Uint8Array; dpChoice: Int16Array } {
  const dpCount = new Uint8Array(maxUnits + 1).fill(255);
  const dpChoice = new Int16Array(maxUnits + 1).fill(-1);
  dpCount[0] = 0;

  for (let u = 1; u <= maxUnits; u++) {
    for (let i = 0; i < plateUnits.length; i++) {
      const pu = plateUnits[i]!;
      if (pu <= 0 || pu > u) continue;
      const prev = dpCount[u - pu]!;
      if (prev === 255) continue;
      const cand = prev + 1;
      // Strict `<` with descending plateUnits preserves heavier-plates-first tie-breaking.
      if (cand <= maxPlates && cand < dpCount[u]!) {
        dpCount[u] = cand;
        dpChoice[u] = i;
      }
    }
  }
  return { dpCount, dpChoice };
}

function runBoundedPlateDp(
  maxUnits: number,
  plateUnits: readonly number[],
  plateLimits: readonly number[],
  maxPlates = PLATE_MAX_COUNT,
): { bestU: number; plates: number[] } {
  // Expand available single-side plates (capped by pair inventory) and run 0/1 knapsack minimizing plate count.
  const expanded: Array<{ unit: number; idx: number }> = [];
  for (let i = 0; i < plateUnits.length; i++) {
    const cap = Math.max(0, Math.min(maxPlates, plateLimits[i] ?? maxPlates));
    const maxUseful = plateUnits[i]! > 0 ? Math.min(cap, Math.floor(maxUnits / plateUnits[i]!)) : 0;
    for (let k = 0; k < maxUseful; k++) {
      expanded.push({ unit: plateUnits[i]!, idx: i });
    }
  }
  const dpCount = new Uint8Array(maxUnits + 1).fill(255);
  const dpPrevU = new Int16Array(maxUnits + 1).fill(-1);
  const dpPicked = new Int16Array(maxUnits + 1).fill(-1);
  dpCount[0] = 0;

  for (let e = 0; e < expanded.length; e++) {
    const item = expanded[e]!;
    for (let u = maxUnits; u >= item.unit; u--) {
      const prev = dpCount[u - item.unit]!;
      if (prev === 255) continue;
      const cand = prev + 1;
      if (cand <= maxPlates && cand < dpCount[u]!) {
        dpCount[u] = cand;
        dpPrevU[u] = u - item.unit;
        dpPicked[u] = item.idx;
      }
    }
  }

  let bestU = 0;
  for (let u = maxUnits; u >= 0; u--) {
    if (dpCount[u]! <= maxPlates) {
      bestU = u;
      break;
    }
  }

  const pickedIdx: number[] = [];
  let cur = bestU;
  while (cur > 0) {
    const idx = dpPicked[cur]!;
    if (idx < 0) break;
    pickedIdx.push(idx);
    cur = dpPrevU[cur]!;
  }
  return { bestU, plates: pickedIdx };
}

export function plateBreakdown(
  totalWeight: number,
  barWeight = 20,
  availablePlates: readonly number[] = DEFAULT_PLATES,
  platePairs?: Record<string, number>,
): PlateBreakdownResult {
  const weight = Number(totalWeight);
  const rawBar = Number(barWeight);
  const bar = Number.isFinite(rawBar) && rawBar >= 0 ? rawBar : 20;
  if (!Number.isFinite(weight) || weight <= bar || weight > 5000) {
    return { valid: false, bar, perSide: 0, plates: [], remainder: 0, achievable: true };
  }
  const perSide = round2((weight - bar) / 2);
  const hasPairLimits = Boolean(platePairs && Object.keys(platePairs).length > 0);
  const sortedPlates = sanitizeAvailablePlates(availablePlates).filter((p) => {
    if (!hasPairLimits) return true;
    const cap = platePairs![String(p)];
    return cap === undefined ? true : cap > 0;
  });

  if (sortedPlates.length && perSide <= 500 && areQuarterMultiples(sortedPlates)) {
    const targetUnits = Math.max(0, Math.floor(perSide * PLATE_DP_SCALE + 1e-6));
    const plateUnits = sortedPlates.map((p) => Math.round(p * PLATE_DP_SCALE));

    if (hasPairLimits) {
      const limits = sortedPlates.map((p) => {
        const cap = platePairs![String(p)];
        return cap === undefined ? PLATE_MAX_COUNT : Math.max(0, Math.round(cap));
      });
      const { bestU, plates: pickedIndices } = runBoundedPlateDp(targetUnits, plateUnits, limits, PLATE_MAX_COUNT);
      const plates = pickedIndices.map((idx) => sortedPlates[idx]!).sort((a, b) => b - a);
      const remainder = Math.max(0, round2(perSide - bestU / PLATE_DP_SCALE));
      return { valid: true, bar, perSide, plates, remainder, achievable: remainder <= 0.01 };
    }

    const { dpCount, dpChoice } = runPlateDp(targetUnits, plateUnits, PLATE_MAX_COUNT);

    let bestU = 0;
    for (let u = targetUnits; u >= 0; u--) {
      if (dpCount[u]! <= PLATE_MAX_COUNT) {
        bestU = u;
        break;
      }
    }

    const plates: number[] = [];
    for (let u = bestU; u > 0; ) {
      const idx = dpChoice[u]!;
      if (idx < 0) break;
      const plate = sortedPlates[idx]!;
      plates.push(plate);
      u -= plateUnits[idx]!;
    }
    plates.sort((a, b) => b - a);
    const remainder = Math.max(0, round2(perSide - bestU / PLATE_DP_SCALE));
    return { valid: true, bar, perSide, plates, remainder, achievable: remainder <= 0.01 };
  }

  let remaining = perSide;
  const plates: number[] = [];
  for (const plate of sortedPlates) {
    const cap = hasPairLimits && platePairs![String(plate)] !== undefined ? platePairs![String(plate)]! : PLATE_MAX_COUNT;
    let used = 0;
    while (used < cap && plates.length < PLATE_MAX_COUNT && remaining + 1e-6 >= plate) {
      plates.push(plate);
      used++;
      remaining = round2(remaining - plate);
    }
    if (plates.length >= PLATE_MAX_COUNT) break;
  }
  return { valid: true, bar, perSide, plates, remainder: remaining, achievable: remaining <= 0.01 };
}

export function plateDeltaLabel(
  prevWeight: number,
  curWeight: number,
  barWeight = 20,
  enabledPlates: readonly number[] = ALL_PLATES,
  platePairs?: Record<string, number>,
): string {
  if (!(prevWeight > barWeight) || !(curWeight > barWeight) || prevWeight === curWeight) return "";
  const prevCalc = plateBreakdown(prevWeight, barWeight, enabledPlates, platePairs);
  const curCalc = plateBreakdown(curWeight, barWeight, enabledPlates, platePairs);
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
    if (!Number.isFinite(target) || target <= barWeight) return barWeight;
    const calc = plateBreakdown(target, barWeight, enabledPlates);
    if (!calc.valid) return barWeight;
    const below = Math.max(barWeight, round2(calc.bar + 2 * (calc.perSide - calc.remainder)));
    if (calc.achievable) return below;

    const sortedPlates = sanitizeAvailablePlates(enabledPlates);
    const smallestPlate = sortedPlates.at(-1) ?? 0;
    if (smallestPlate > 0 && calc.perSide <= 500 && areQuarterMultiples(sortedPlates)) {
      const minUnits = Math.max(0, Math.ceil(calc.perSide * PLATE_DP_SCALE - 1e-6));
      const maxUnits = Math.min(2000, Math.ceil((calc.perSide + smallestPlate) * PLATE_DP_SCALE) + 1);
      if (maxUnits >= minUnits) {
        const plateUnits = sortedPlates.map((p) => Math.round(p * PLATE_DP_SCALE));
        const { dpCount } = runPlateDp(maxUnits, plateUnits, PLATE_MAX_COUNT);
        for (let u = minUnits; u <= maxUnits; u++) {
          if (dpCount[u]! <= PLATE_MAX_COUNT) {
            const above = round2(calc.bar + (u / PLATE_DP_SCALE) * 2);
            if (Math.abs(above - target) + 1e-6 < Math.abs(target - below)) {
              return above;
            }
            break;
          }
        }
      }
    }
    return below;
  }
  const step = target < 15 ? 1 : 2.5;
  return Math.max(step, Math.round(target / step) * step);
}

/**
 * Scales routine target sets and weights cleanly for Deload Week mode.
 */
export function applyDeloadToTarget(
  sets: number,
  weight: number,
  mode: string,
  weightStepKg = 2.5,
  weightPct = 80,
  setsPct = 50,
): { sets: number; weight: number } {
  const scaledSets = Math.max(1, Math.round((sets * Math.max(25, Math.min(100, setsPct))) / 100));
  if (mode === "timed" || weight <= 0) {
    return { sets: scaledSets, weight };
  }
  const step = weightStepKg > 0 ? weightStepKg : 2.5;
  const ratio = Math.max(50, Math.min(95, weightPct)) / 100;
  if (mode === "assisted") {
    const rawAssist = weight / ratio;
    const snappedAssist = Math.max(weight, Math.round(rawAssist / step) * step);
    return { sets: scaledSets, weight: round2(snappedAssist) };
  }
  const rawWeight = weight * ratio;
  const floorWeight = Math.min(weight, step);
  const snapped = Math.max(floorWeight, Math.round(rawWeight / step) * step);
  return { sets: scaledSets, weight: round2(snapped) };
}

export interface SupersetTransitionResult {
  inSuperset: boolean;
  shouldStartRest: boolean;
  nextExerciseIdx: number | null;
  reason: "next_partner" | "round_complete_loop" | "superset_complete" | "single";
}

/**
 * Resolves live superset alternation and deferred rest timing when a set is marked complete.
 * Rest is deferred until the last partner in the current round finishes; then loops back to the first incomplete partner.
 */
export function resolveSupersetTransition(
  exercises: ReadonlyArray<{
    supersetGroup?: string | null;
    sets: ReadonlyArray<{ completed: boolean }>;
  }>,
  exIdx: number,
  setIdx: number,
): SupersetTransitionResult {
  const current = exercises[exIdx];
  const group = current?.supersetGroup?.trim();
  if (!current || !group) {
    return { inSuperset: false, shouldStartRest: true, nextExerciseIdx: null, reason: "single" };
  }
  const memberIndices: number[] = [];
  for (let i = 0; i < exercises.length; i++) {
    if (exercises[i]?.supersetGroup?.trim() === group) memberIndices.push(i);
  }
  if (memberIndices.length < 2) {
    return { inSuperset: false, shouldStartRest: true, nextExerciseIdx: null, reason: "single" };
  }

  const stats = memberIndices.map((idx) => {
    const sets = exercises[idx]!.sets;
    let done = 0;
    let hasIncomplete = false;
    for (let j = 0; j < sets.length; j++) {
      const completed = idx === exIdx && j === setIdx ? true : Boolean(sets[j]?.completed);
      if (completed) done += 1;
      else hasIncomplete = true;
    }
    return { idx, done, hasIncomplete };
  });

  const curPos = memberIndices.indexOf(exIdx);
  const curDone = stats[curPos]!.done;

  // Check partners after current exercise in the same round that still have fewer completed sets than current.
  for (let step = 1; step < memberIndices.length; step++) {
    const pos = (curPos + step) % memberIndices.length;
    const candidate = stats[pos]!;
    if (candidate.hasIncomplete && candidate.done < curDone) {
      return {
        inSuperset: true,
        shouldStartRest: false,
        nextExerciseIdx: candidate.idx,
        reason: "next_partner",
      };
    }
  }

  // Round finished: start rest and loop back to the first partner in the group that still has incomplete sets.
  const nextRoundPartner = stats.find((s) => s.hasIncomplete);
  if (nextRoundPartner) {
    return {
      inSuperset: true,
      shouldStartRest: true,
      nextExerciseIdx: nextRoundPartner.idx,
      reason: "round_complete_loop",
    };
  }

  return {
    inSuperset: true,
    shouldStartRest: true,
    nextExerciseIdx: null,
    reason: "superset_complete",
  };
}
