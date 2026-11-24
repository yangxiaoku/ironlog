import {
  DEFAULT_APPLE_CARDIO_SHORTCUT,
  DEFAULT_APPLE_HUB_SHORTCUT,
  DEFAULT_APPLE_STRENGTH_SHORTCUT,
  readWorkoutPreferences,
  type AppleFitnessLaunchMode,
  type WorkoutPreferences,
} from "./workout-helpers";

export type AppleFitnessKind = "strength" | "cardio";
export type AppleHubAction = "strength" | "cardio" | "end" | "daily";

export const APPLE_FITNESS_APP_URL = "fitnessapp://";
export const APPLE_CREATE_SHORTCUT_URL = "shortcuts://create-shortcut";

const CARDIO_HINT_RE =
  /有氧|跑步|慢跑|骑行|单车|游泳|划船|椭圆机|爬坡|爬楼|跳绳|快走|徒步|hiit|cardio|run|jog|cycling|bike|swim|row|elliptical/i;

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
  window.location.href = url;
  return { launched: true, url };
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
  window.location.href = url;
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
