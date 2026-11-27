import {
  DEFAULT_APPLE_CARDIO_SHORTCUT,
  DEFAULT_APPLE_HUB_SHORTCUT,
  DEFAULT_APPLE_STRENGTH_SHORTCUT,
  readWorkoutPreferences,
  type AppleFitnessLaunchMode,
  type WorkoutPreferences,
} from "./workout-helpers";

export type AppleFitnessKind = "strength" | "cardio";
export type AppleStrengthPresetId = "traditional_strength" | "functional_strength" | "core_training";
export type AppleCardioPresetId =
  | "outdoor_run"
  | "indoor_run"
  | "outdoor_cycle"
  | "indoor_cycle"
  | "stair_climbing"
  | "elliptical"
  | "rowing"
  | "swimming"
  | "hiit"
  | "jump_rope"
  | "outdoor_walk"
  | "hiking"
  | "mixed_cardio";

export interface AppleStrengthPreset {
  id: AppleStrengthPresetId;
  label: string;
  appleWorkoutLabel: string;
  activityType: string;
  environment: "indoor";
  subtitle: string;
}

export const APPLE_STRENGTH_PRESETS: ReadonlyArray<AppleStrengthPreset> = [
  {
    id: "traditional_strength",
    label: "传统力量训练",
    appleWorkoutLabel: "传统力量训练",
    activityType: "traditionalStrengthTraining",
    environment: "indoor",
    subtitle: "自由重量 / 固定器械",
  },
  {
    id: "functional_strength",
    label: "功能性力量",
    appleWorkoutLabel: "功能性力量训练",
    activityType: "functionalStrengthTraining",
    environment: "indoor",
    subtitle: "壶铃 / 徒手 / 复合",
  },
  {
    id: "core_training",
    label: "核心训练",
    appleWorkoutLabel: "核心训练",
    activityType: "coreTraining",
    environment: "indoor",
    subtitle: "腹肌 / 稳定核心",
  },
];

export interface AppleCardioPreset {
  id: AppleCardioPresetId;
  label: string;
  appleWorkoutLabel: string;
  activityType: string;
  environment: "indoor" | "outdoor";
  subtitle: string;
}

export const APPLE_CARDIO_PRESETS: ReadonlyArray<AppleCardioPreset> = [
  {
    id: "outdoor_run",
    label: "户外跑步",
    appleWorkoutLabel: "户外跑步",
    activityType: "running",
    environment: "outdoor",
    subtitle: "室外 · 配速/距离",
  },
  {
    id: "indoor_run",
    label: "室内跑步",
    appleWorkoutLabel: "室内跑步",
    activityType: "running",
    environment: "indoor",
    subtitle: "跑步机 · 室内",
  },
  {
    id: "outdoor_cycle",
    label: "户外骑行",
    appleWorkoutLabel: "户外单车",
    activityType: "cycling",
    environment: "outdoor",
    subtitle: "室外 · 骑行距离",
  },
  {
    id: "indoor_cycle",
    label: "室内单车",
    appleWorkoutLabel: "室内单车",
    activityType: "cycling",
    environment: "indoor",
    subtitle: "动感/功率单车",
  },
  {
    id: "stair_climbing",
    label: "爬楼机",
    appleWorkoutLabel: "踏步机",
    activityType: "stairClimbing",
    environment: "indoor",
    subtitle: "室内 · 爬楼机",
  },
  {
    id: "elliptical",
    label: "椭圆机",
    appleWorkoutLabel: "椭圆机",
    activityType: "elliptical",
    environment: "indoor",
    subtitle: "室内 · 低冲击",
  },
  {
    id: "rowing",
    label: "划船机",
    appleWorkoutLabel: "划船机",
    activityType: "rowing",
    environment: "indoor",
    subtitle: "室内 · 全身有氧",
  },
  {
    id: "swimming",
    label: "游泳",
    appleWorkoutLabel: "泳池游泳",
    activityType: "swimming",
    environment: "indoor",
    subtitle: "泳池 · 泳距",
  },
  {
    id: "hiit",
    label: "HIIT",
    appleWorkoutLabel: "高强度间歇训练",
    activityType: "highIntensityIntervalTraining",
    environment: "indoor",
    subtitle: "间歇爆发",
  },
  {
    id: "jump_rope",
    label: "跳绳",
    appleWorkoutLabel: "跳绳",
    activityType: "jumpRope",
    environment: "indoor",
    subtitle: "室内/室外",
  },
  {
    id: "outdoor_walk",
    label: "户外步行",
    appleWorkoutLabel: "户外步行",
    activityType: "walking",
    environment: "outdoor",
    subtitle: "室外 · 快走/散步",
  },
  {
    id: "hiking",
    label: "徒步",
    appleWorkoutLabel: "徒步",
    activityType: "hiking",
    environment: "outdoor",
    subtitle: "室外 · 爬升/越野",
  },
  {
    id: "mixed_cardio",
    label: "混合有氧",
    appleWorkoutLabel: "混合有氧",
    activityType: "mixedCardio",
    environment: "indoor",
    subtitle: "综合有氧",
  },
];

export type AppleHubAction =
  | "strength"
  | "strength:functional"
  | "strength:core"
  | "cardio"
  | "cardio:run"
  | "cardio:cycle"
  | "cardio:walk"
  | `cardio:${AppleCardioPresetId}`
  | "end"
  | "daily";

export function getAppleStrengthPreset(id: string | null | undefined): AppleStrengthPreset | null {
  if (!id) return null;
  return APPLE_STRENGTH_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Resolves the iOS Shortcut name for a chosen strength preset while preserving `铁记开始力量` compatibility.
 */
export function resolveStrengthShortcutName(preset: AppleStrengthPreset, baseShortcutName?: string): string {
  const base = (baseShortcutName ?? "").trim().slice(0, 80) || DEFAULT_APPLE_STRENGTH_SHORTCUT;
  if (base.includes("{sport}")) {
    return base.replaceAll("{sport}", preset.label).slice(0, 80);
  }
  if (preset.id === "traditional_strength") {
    return base;
  }
  return `${base}-${preset.label}`.slice(0, 80);
}

export const LAST_CARDIO_PRESET_KEY = "ironlog-web-last-cardio-preset";
export const APPLE_FITNESS_APP_URL = "fitnessapp://";
export const APPLE_CREATE_SHORTCUT_URL = "shortcuts://create-shortcut";

const CARDIO_HINT_RE =
  /有氧|跑步|慢跑|骑行|单车|游泳|划船|椭圆机|爬坡|爬楼|跳绳|快走|徒步|hiit|cardio|run|jog|cycling|bike|swim|row|elliptical/i;

export function getAppleCardioPreset(id: string | null | undefined): AppleCardioPreset | null {
  if (!id) return null;
  return APPLE_CARDIO_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function readLastCardioPreset(): AppleCardioPresetId | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_CARDIO_PRESET_KEY);
    return getAppleCardioPreset(raw)?.id ?? null;
  } catch {
    return null;
  }
}

export function writeLastCardioPreset(id: AppleCardioPresetId): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_CARDIO_PRESET_KEY, id);
  } catch {}
}

/**
 * Matches workout title and exercises to a specific Apple Fitness cardio preset when identifiable.
 */
export function inferAppleCardioPreset(
  exercises?: ReadonlyArray<{ snapshot?: { mode?: string; name?: string } | null }>,
  title = "",
): AppleCardioPreset | null {
  const combined = [title, ...(exercises ?? []).map((ex) => ex.snapshot?.name ?? "")]
    .join(" ")
    .trim();
  if (!combined) return null;

  let matchedId: AppleCardioPresetId | null = null;
  if (/跑步机|室内跑|treadmill|indoor.?run/i.test(combined)) {
    matchedId = "indoor_run";
  } else if (/跑步|慢跑|户外跑|run|jog/i.test(combined)) {
    matchedId = "outdoor_run";
  } else if (/动感单车|室内单车|功率单车|纺车|spin|indoor.?cycl/i.test(combined)) {
    matchedId = "indoor_cycle";
  } else if (/骑行|单车|自行车|cycling|bike/i.test(combined)) {
    matchedId = "outdoor_cycle";
  } else if (/爬楼|踏步机|stair/i.test(combined)) {
    matchedId = "stair_climbing";
  } else if (/椭圆机|elliptical/i.test(combined)) {
    matchedId = "elliptical";
  } else if (/划船|row/i.test(combined)) {
    matchedId = "rowing";
  } else if (/游泳|swim/i.test(combined)) {
    matchedId = "swimming";
  } else if (/hiit|高强度间歇|间歇/i.test(combined)) {
    matchedId = "hiit";
  } else if (/跳绳|jump.?rope/i.test(combined)) {
    matchedId = "jump_rope";
  } else if (/徒步|登山|hik/i.test(combined)) {
    matchedId = "hiking";
  } else if (/快走|步行|散步|walk/i.test(combined)) {
    matchedId = "outdoor_walk";
  } else if (/混合有氧|mixed.?cardio/i.test(combined)) {
    matchedId = "mixed_cardio";
  }

  return getAppleCardioPreset(matchedId);
}

/**
 * Resolves the per-sport iOS Shortcut name for a chosen cardio preset.
 */
export function resolveCardioShortcutName(preset: AppleCardioPreset, baseShortcutName?: string): string {
  const base = (baseShortcutName ?? "").trim().slice(0, 80) || DEFAULT_APPLE_CARDIO_SHORTCUT;
  if (base.includes("{sport}")) {
    return base.replaceAll("{sport}", preset.label).slice(0, 80);
  }
  return `${base}-${preset.label}`.slice(0, 80);
}

/**
 * Returns true on iPhone, iPad, or iPod (including iPadOS desktop-mode Safari).
 */
export function isAppleMobileDevice(
  ua = typeof navigator !== "undefined" ? navigator.userAgent : "",
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
  maxTouchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0,
): boolean {
  return /iP(hone|ad|od)/i.test(ua || "") || (platform === "MacIntel" && maxTouchPoints > 1);
}

/**
 * Classifies a workout session as strength or cardio for Apple Fitness launch routing.
 */
export function inferAppleFitnessKind(
  exercises?: ReadonlyArray<{ snapshot?: { mode?: string; name?: string } | null }>,
  title = "",
): AppleFitnessKind {
  const titleLooksCardio = CARDIO_HINT_RE.test(title);
  if (exercises?.length) {
    const allTimed = exercises.every((ex) => ex.snapshot?.mode === "timed");
    const anyCardioName = exercises.some((ex) => CARDIO_HINT_RE.test(ex.snapshot?.name ?? ""));
    return allTimed && (titleLooksCardio || anyCardioName) ? "cardio" : "strength";
  }
  return titleLooksCardio ? "cardio" : "strength";
}

/**
 * Builds the smart URL deep-link invoking Ironlog's unified all-in-one iOS Shortcut with action input.
 */
export function buildAppleHubActionUrl(
  action: AppleHubAction,
  prefs: Pick<WorkoutPreferences, "appleHubShortcutName">,
): string {
  const name = prefs.appleHubShortcutName.trim().slice(0, 80) || DEFAULT_APPLE_HUB_SHORTCUT;
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(action)}`;
}

/**
 * Builds the iOS deep-link URL (`shortcuts://run-shortcut?...` or `fitnessapp://`) for launching Apple Fitness.
 */
export function buildAppleFitnessLaunchUrl(
  kind: AppleFitnessKind,
  prefs: Pick<
    WorkoutPreferences,
    "appleStrengthLaunch" | "appleCardioLaunch" | "appleStrengthShortcutName" | "appleCardioShortcutName"
  > & { appleHubShortcutName?: string },
  forceMode?: AppleFitnessLaunchMode,
): string | null {
  const mode = forceMode ?? (kind === "strength" ? prefs.appleStrengthLaunch : prefs.appleCardioLaunch);
  if (mode === "off") return null;
  if (mode === "fitness_app") return APPLE_FITNESS_APP_URL;
  if (mode === "hub") {
    return buildAppleHubActionUrl(kind, {
      appleHubShortcutName: prefs.appleHubShortcutName ?? DEFAULT_APPLE_HUB_SHORTCUT,
    });
  }

  const fallbackName = kind === "strength" ? DEFAULT_APPLE_STRENGTH_SHORTCUT : DEFAULT_APPLE_CARDIO_SHORTCUT;
  const rawName = kind === "strength" ? prefs.appleStrengthShortcutName : prefs.appleCardioShortcutName;
  const name = rawName.trim().slice(0, 80) || fallbackName;
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}

/**
 * Builds the iOS deep-link URL (`shortcuts://run-shortcut?...` or `fitnessapp://`) for a chosen strength preset.
 */
export function buildAppleStrengthLaunchUrl(
  presetId: AppleStrengthPresetId,
  prefs: Pick<WorkoutPreferences, "appleStrengthLaunch" | "appleStrengthShortcutName"> & {
    appleHubShortcutName?: string;
  },
  forceMode?: AppleFitnessLaunchMode,
): string | null {
  const preset = getAppleStrengthPreset(presetId) ?? APPLE_STRENGTH_PRESETS[0]!;
  const mode = forceMode ?? prefs.appleStrengthLaunch;
  if (mode === "off") return null;
  if (mode === "fitness_app") return APPLE_FITNESS_APP_URL;
  if (mode === "hub") {
    const action: AppleHubAction =
      preset.id === "traditional_strength"
        ? "strength"
        : preset.id === "functional_strength"
          ? "strength:functional"
          : "strength:core";
    return buildAppleHubActionUrl(action, {
      appleHubShortcutName: prefs.appleHubShortcutName ?? DEFAULT_APPLE_HUB_SHORTCUT,
    });
  }
  const name = resolveStrengthShortcutName(preset, prefs.appleStrengthShortcutName);
  if (preset.id === "traditional_strength") {
    return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
  }
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(preset.id)}`;
}

/**
 * Builds the iOS deep-link URL (`shortcuts://run-shortcut?...` or `fitnessapp://`) for a chosen cardio preset.
 */
export function buildAppleCardioLaunchUrl(
  presetId: AppleCardioPresetId,
  prefs: Pick<WorkoutPreferences, "appleCardioLaunch" | "appleCardioShortcutName"> & {
    appleHubShortcutName?: string;
  },
  forceMode?: AppleFitnessLaunchMode,
): string | null {
  const preset = getAppleCardioPreset(presetId) ?? APPLE_CARDIO_PRESETS[0]!;
  const mode = forceMode ?? prefs.appleCardioLaunch;
  if (mode === "off") return null;
  if (mode === "fitness_app") return APPLE_FITNESS_APP_URL;
  if (mode === "hub") {
    return buildAppleHubActionUrl(`cardio:${preset.id}`, {
      appleHubShortcutName: prefs.appleHubShortcutName ?? DEFAULT_APPLE_HUB_SHORTCUT,
    });
  }
  const name = resolveCardioShortcutName(preset, prefs.appleCardioShortcutName);
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(preset.id)}`;
}

function launchIosUrlScheme(url: string): void {
  if (typeof document !== "undefined" && document.body) {
    try {
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => link.remove(), 400);
      return;
    } catch {}
  }
  try {
    window.location.href = url;
  } catch {}
}

/**
 * Launches Apple Fitness (or a matching iOS Shortcut) synchronously on iOS inside a user gesture.
 */
export function triggerAppleFitnessLaunch(
  kind: AppleFitnessKind,
  options: {
    prefs?: WorkoutPreferences;
    forceMode?: AppleFitnessLaunchMode;
    notify?: (msg: string) => void;
    silentNonIos?: boolean;
  } = {},
): { launched: boolean; url: string | null } {
  const prefs = options.prefs ?? readWorkoutPreferences();
  const url = buildAppleFitnessLaunchUrl(kind, prefs, options.forceMode);
  if (!url) {
    if (!options.silentNonIos) {
      options.notify?.("Apple 健身跳转已关闭，可在设置中开启");
    }
    return { launched: false, url: null };
  }
  if (typeof window === "undefined" || !isAppleMobileDevice()) {
    if (!options.silentNonIos) {
      options.notify?.("Apple 健身 / 快捷指令跳转仅支持在 iPhone / iPad 上使用");
    }
    return { launched: false, url };
  }
  launchIosUrlScheme(url);
  return { launched: true, url };
}

/**
 * Remembers and launches Apple Fitness (or the matched iOS Shortcut) for a chosen cardio preset synchronously.
 */
export function triggerAppleCardioLaunch(
  presetId: AppleCardioPresetId,
  options: {
    prefs?: WorkoutPreferences;
    forceMode?: AppleFitnessLaunchMode;
    notify?: (msg: string) => void;
    silentNonIos?: boolean;
  } = {},
): { launched: boolean; url: string | null; preset: AppleCardioPreset } {
  const preset = getAppleCardioPreset(presetId) ?? APPLE_CARDIO_PRESETS[0]!;
  writeLastCardioPreset(preset.id);
  const prefs = options.prefs ?? readWorkoutPreferences();
  const url = buildAppleCardioLaunchUrl(preset.id, prefs, options.forceMode);
  if (!url) {
    if (!options.silentNonIos) {
      options.notify?.("Apple 有氧跳转已关闭，可在设置中开启");
    }
    return { launched: false, url: null, preset };
  }
  if (typeof window === "undefined" || !isAppleMobileDevice()) {
    if (!options.silentNonIos) {
      options.notify?.("Apple 健身 / 快捷指令跳转仅支持在 iPhone / iPad 上使用");
    }
    return { launched: false, url, preset };
  }
  launchIosUrlScheme(url);
  return { launched: true, url, preset };
}

/**
 * Launches Apple Fitness (or the matched iOS Shortcut) for a chosen strength preset synchronously on iOS.
 */
export function triggerAppleStrengthLaunch(
  presetId: AppleStrengthPresetId,
  options: {
    prefs?: WorkoutPreferences;
    forceMode?: AppleFitnessLaunchMode;
    notify?: (msg: string) => void;
    silentNonIos?: boolean;
  } = {},
): { launched: boolean; url: string | null; preset: AppleStrengthPreset } {
  const preset = getAppleStrengthPreset(presetId) ?? APPLE_STRENGTH_PRESETS[0]!;
  const prefs = options.prefs ?? readWorkoutPreferences();
  const url = buildAppleStrengthLaunchUrl(preset.id, prefs, options.forceMode);
  if (!url) {
    if (!options.silentNonIos) {
      options.notify?.("Apple 力量跳转已关闭，可在设置中开启");
    }
    return { launched: false, url: null, preset };
  }
  if (typeof window === "undefined" || !isAppleMobileDevice()) {
    if (!options.silentNonIos) {
      options.notify?.("Apple 健身 / 快捷指令跳转仅支持在 iPhone / iPad 上使用");
    }
    return { launched: false, url, preset };
  }
  launchIosUrlScheme(url);
  return { launched: true, url, preset };
}

/**
 * Triggers a specific mode (`strength` | `cardio` | `end` | `daily`) on the unified all-in-one iOS Shortcut.
 */
export function triggerAppleHubAction(
  action: AppleHubAction,
  options: {
    prefs?: WorkoutPreferences;
    notify?: (msg: string) => void;
    silentNonIos?: boolean;
  } = {},
): { launched: boolean; url: string } {
  const prefs = options.prefs ?? readWorkoutPreferences();
  const url = buildAppleHubActionUrl(action, prefs);
  if (typeof window === "undefined" || !isAppleMobileDevice()) {
    if (!options.silentNonIos) {
      options.notify?.("Apple 健康全能快捷指令仅支持在 iPhone / iPad 上使用");
    }
    return { launched: false, url };
  }
  launchIosUrlScheme(url);
  return { launched: true, url };
}

/**
 * Opens Apple Shortcuts editor on iOS so users can create their 1-step Start Workout shortcut quickly.
 */
export function openAppleShortcutCreator(notify?: (msg: string) => void): boolean {
  if (typeof window === "undefined" || !isAppleMobileDevice()) {
    notify?.("请在 iPhone / iPad 上打开「快捷指令」App 新建");
    return false;
  }
  window.location.href = APPLE_CREATE_SHORTCUT_URL;
  return true;
}
