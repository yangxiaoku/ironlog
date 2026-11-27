export type MuscleKey = "chest" | "back" | "legs" | "shoulders" | "arms" | "core" | "cardio";
export type EquipmentKey =
  | "barbell"
  | "dumbbell"
  | "cable"
  | "machine"
  | "bodyweight"
  | "kettlebell"
  | "band"
  | "weighted";
export type FeelingKey = "easy" | "balanced" | "fatigued";
export type MealKey = "breakfast" | "lunch" | "dinner" | "snack";
export type SetType = "normal" | "warmup" | "failure" | "drop" | "rest_pause";
export type ExerciseMode = "reps" | "timed" | "assisted";
export type LoadMetricKey = "volume" | "sets" | "workouts" | "seconds";
export type PeriodDays = 7 | 30 | 90 | 365;

export const MUSCLES: Record<MuscleKey, string> = {
  chest: "胸部",
  back: "背部",
  legs: "腿部",
  shoulders: "肩部",
  arms: "手臂",
  core: "核心",
  cardio: "有氧",
};

export const EQUIPMENT: Record<EquipmentKey, string> = {
  barbell: "杠铃",
  dumbbell: "哑铃",
  cable: "绳索",
  machine: "器械",
  bodyweight: "自重",
  kettlebell: "壶铃",
  band: "弹力带",
  weighted: "额外负重",
};

export const FEELINGS: Record<FeelingKey, string> = {
  easy: "轻松",
  balanced: "均衡",
  fatigued: "疲惫",
};

export const MEALS: Record<MealKey, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

export const SET_TYPES: Record<SetType, { label: string; short: string }> = {
  normal: { label: "常规", short: "" },
  warmup: { label: "热身", short: "W" },
  failure: { label: "力竭", short: "F" },
  drop: { label: "递减", short: "D" },
  rest_pause: { label: "休停", short: "R" },
};

export const INTERVALS: Array<{ value: PeriodDays; label: string }> = [
  { value: 7, label: "7 天" },
  { value: 30, label: "30 天" },
  { value: 90, label: "90 天" },
  { value: 365, label: "1 年" },
];

export const MEASUREMENT_SPECS: ReadonlyArray<readonly [keyof MeasurementValues, string, number, number]> = [
  ["waistCm", "腰围", 30, 250],
  ["chestCm", "胸围", 40, 250],
  ["armCm", "臂围", 15, 100],
  ["thighCm", "大腿围", 25, 150],
  ["hipCm", "臀围", 40, 250],
];

export interface MeasurementValues {
  waistCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  hipCm: number | null;
}

export interface MeasurementEntry extends MeasurementValues {
  date: string;
  notes?: string | null;
  updatedAt?: string;
}

export interface RecordEnvelope<T> {
  id: string;
  kind: string;
  version: number;
  deleted: boolean;
  updatedAt: string;
  data: T;
}

export interface ExerciseSnapshot {
  name: string;
  muscle: MuscleKey;
  equipment: EquipmentKey;
  mode: ExerciseMode;
  volumeMultiplier: number;
}

export interface WorkoutSet {
  id: string;
  type: SetType;
  weight: number;
  reps: number;
  seconds: number;
  completed: boolean;
  completedAt?: string;
  rir: number | null;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  targetIndex?: number | null;
  supersetGroup?: string | null;
  restSeconds: number;
  snapshot?: ExerciseSnapshot | null;
  backupExerciseId?: string | null;
  backupExerciseName?: string | null;
  sets: WorkoutSet[];
}

export interface WorkoutData {
  date: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "completed" | "cancelled";
  durationUnknown?: boolean;
  notes?: string;
  feeling?: FeelingKey | null;
  source?: string;
  rawPrompt?: string;
  planId?: string | null;
  planVersion?: number | null;
  routineId?: string | null;
  targetSnapshot?: unknown;
  adjustments?: unknown[];
  exercises: WorkoutExercise[];
  timing?: { elapsedSeconds: number; runningSince: string | null } | null;
  restEndsAt?: number | null;
  restStartedAt?: number | null;
}

export interface DietData {
  date: string;
  meal: MealKey;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source?: string;
  rawPrompt?: string;
}

export interface MealTemplateFood {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source?: string;
  rawPrompt?: string;
}

export interface MealTemplateData {
  name: string;
  foods: MealTemplateFood[];
}

export interface WeightData {
  date: string;
  weight: number;
  bodyFat?: number | null;
}

export interface FavoriteData {
  exerciseId: string;
}

export interface QuickFoodItem {
  id: string;
  name: string;
  baseGrams: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ProfileGoals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  waterGoalMl?: number;
  daysPerWeek: number;
  restSeconds: number;
  targetWeight: number | null;
  equipment?: EquipmentKey[];
  energyProfile?: {
    heightCm: number;
    weightKg: number;
    weightDate: string;
    birthDate: string;
    sex: "male" | "female";
    context: string;
    activityFactor: number;
  } | null;
  workoutPrefs?: {
    soundOn?: boolean;
    hapticsOn?: boolean;
    screenAwake?: boolean;
    notifyRest?: boolean;
    showRir?: boolean;
    autoSyncSubsequent?: boolean;
    autoPrefillLast?: boolean;
    autoStartRestTimer?: boolean;
    autoAdvanceExercise?: boolean;
    warmupRestSeconds?: number;
    restAdjustStep?: number;
    weightStepKg?: number;
    barWeight?: number;
    enabledPlates?: number[];
    showPlateMath?: boolean;
    warmupScheme?: "light" | "standard" | "heavy";
    soundStyle?: "chime" | "marimba" | "bell";
    appleFitnessAutoLaunch?: boolean;
    appleStrengthLaunch?: "hub" | "shortcut" | "fitness_app" | "off";
    appleCardioLaunch?: "hub" | "shortcut" | "fitness_app" | "off";
    appleHubShortcutName?: string;
    appleStrengthShortcutName?: string;
    appleCardioShortcutName?: string;
    appleAutoSyncOnFinish?: boolean;
    deloadMode?: boolean;
    deloadWeightPct?: number;
    deloadSetsPct?: number;
  };
  quickFoods?: QuickFoodItem[];
}

export interface OverviewStatsResponse {
  from: string;
  through: string;
  today: string;
  period: PeriodDays;
  goals?: ProfileGoals;
  totals: {
    workouts: number;
    activities?: number;
    volume: number;
    sets: number;
    timedWorkouts?: number;
    seconds: number;
    activeDays?: number;
  };
  previous: {
    workouts: number;
    activities?: number;
    volume: number;
    sets: number;
    seconds: number;
  };
  daily: Array<{
    date: string;
    volume: number;
    sets: number;
    workouts: number;
    addedApple?: number;
    seconds: number;
    complete?: boolean;
  }>;
  activity: Array<{ date: string; active: boolean }>;
  recent: Array<{
    id: string;
    title: string;
    date: string;
    duration: number | null;
    feeling?: FeelingKey | null;
    sets: number;
    volume: number;
  }>;
  weights: Array<{ date: string; weight: number; average?: number | null }>;
  muscles: Array<{ key: MuscleKey; name: string; sets: number }>;
  muscleStatus?: Array<{
    key: MuscleKey;
    name: string;
    fatiguePct: number;
    recoveryPct: number;
    status: "fatigued" | "recovering" | "ready" | "detrained";
    statusLabel: string;
    lastTrainedDate: string | null;
    daysSinceLast: number | null;
    recent7dSets: number;
  }>;
}

export interface TodayResponse {
  date: string;
  active?: { id: string; title: string; done: number; total: number; from?: string } | null;
  planned?: { id: string; date: string; name: string; exercises: number; source?: string } | null;
  completed?: number;
  restToday?: boolean;
  weight?: number | null;
  waterMl?: number;
  daysPerWeek?: number;
  restSeconds?: number;
  nutrition: {
    count: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    target: number;
    proteinTarget: number;
    complete?: boolean;
  };
}

export interface WorkoutReportResponse {
  id: string;
  title: string;
  date: string;
  feeling?: FeelingKey | null;
  notes?: string | null;
  planId?: string | null;
  routineId?: string | null;
  canSyncToActivePlan?: boolean;
  activePlanRevision?: number;
  duration: number | null;
  sets: number;
  volume: number;
  muscleSets: Array<{ key: MuscleKey; sets: number }>;
  previousComparison?: {
    workoutId: string;
    date: string;
    title: string;
    volumeDelta: number;
    volumePct: number | null;
    setsDelta: number;
  } | null;
  exercises: Array<{
    id: string;
    exerciseId: string;
    name: string;
    mode: ExerciseMode;
    supersetGroup?: string | null;
    completed: Array<{
      type: SetType;
      weight: number;
      reps: number;
      seconds: number;
      rir: number | null;
    }>;
    volume: number;
  }>;
  records: Array<{
    key: string;
    name: string;
    improvements: Array<{
      metric: "weight" | "oneRepMax" | "hold" | "assistance";
      previous: number;
      current: number;
    }>;
  }>;
}

export interface ExerciseIllustrationFrame {
  path: string;
  caption?: string;
}

export interface ExerciseIllustration {
  gifPath?: string | null;
  frames?: ExerciseIllustrationFrame[];
  author?: string;
  license?: string;
  licenseUrl?: string;
  sourceUrl?: string;
}

export interface CatalogueExercise {
  id: string;
  name: string;
  englishName?: string;
  aliases?: string[];
  muscle: MuscleKey;
  secondaryMuscles?: MuscleKey[];
  equipment: EquipmentKey;
  mode: ExerciseMode;
  category?: string;
  volumeMultiplier: number;
  instructions?: string[];
  description?: string;
  mistakes?: string[];
  custom?: boolean;
  thumbnail?: string | null;
  illustration?: ExerciseIllustration | null;
  source?: {
    name?: string;
    url?: string;
    author?: string;
    license?: string;
  } | null;
}

export type ProgressionRule = "double" | "linear" | "greyskull" | "manual";

export interface PlannedExercise {
  exerciseId: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  weight: number | null;
  seconds: number;
  restSeconds: number;
  targetRir: number;
  progression: ProgressionRule;
  increment: number;
  backupExerciseId?: string | null;
  supersetGroup?: string | null;
}

export interface PlanRoutine {
  id: string;
  name: string;
  exercises: PlannedExercise[];
}

export interface PlanData {
  name: string;
  weeks: number;
  schedule?: "rotation" | "weekdays";
  weekdays?: number[];
  rationale?: string;
  source?: string;
  parentId?: string | null;
  routines: PlanRoutine[];
}

export interface TrainedExerciseSummary {
  id: string;
  name: string;
  englishName: string;
  muscle: MuscleKey;
  equipment: EquipmentKey;
  mode: ExerciseMode;
  custom: boolean;
  sessionsCount: number;
  totalWorkSets: number;
  lastDate: string;
  bestWeight: number | null;
  best1rm: number | null;
  bestHold: number | null;
  bestAssistance: number | null;
}

export interface ExerciseReferenceSet {
  weight: number;
  reps: number;
  seconds: number;
}

export interface ExerciseReferenceEntry {
  id: string;
  sets: Array<ExerciseReferenceSet | null>;
}

export function shiftDateStr(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(delta));
  return d.toISOString().slice(0, 10);
}

export function estimated1RM(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

export function workoutSeconds(data: WorkoutData): number | null {
  if (data.durationUnknown && data.status === "completed") return null;
  const end = Date.parse(data.endedAt ?? "");
  if (data.timing) {
    const since = data.timing.runningSince ? Date.parse(data.timing.runningSince) : NaN;
    return (
      data.timing.elapsedSeconds +
      (Number.isFinite(since) && Number.isFinite(end) ? Math.max(0, Math.floor((end - since) / 1000)) : 0)
    );
  }
  const start = Date.parse(data.startedAt ?? "");
  return Number.isFinite(end) && Number.isFinite(start) && data.source !== "ai"
    ? Math.max(0, (end - start) / 1000)
    : null;
}

export function summarizeWorkoutRecord(data: WorkoutData): { sets: number; volume: number } {
  let sets = 0;
  let vol = 0;
  for (const row of data.exercises ?? []) {
    const mode = row.snapshot?.mode ?? "reps";
    const mult = row.snapshot?.volumeMultiplier ?? 1;
    for (const entry of row.sets ?? []) {
      if (!entry.completed || entry.type === "warmup") continue;
      sets++;
      if (mode === "reps" && entry.weight > 0 && entry.reps > 0) {
        vol += entry.weight * entry.reps * mult;
      }
    }
  }
  return { sets, volume: Math.round(vol * 10) / 10 };
}

export function workoutDraftKey(userId: string, recordId?: string): string {
  return `ironlog-web-draft:${userId}:${recordId || "new"}`;
}

export function findLocalWorkoutDraft(userId: string): { key: string; raw: string } | null {
  if (!userId || typeof localStorage === "undefined") return null;
  const exactKey = workoutDraftKey(userId, undefined);
  const direct = localStorage.getItem(exactKey);
  if (direct) return { key: exactKey, raw: direct };
  const prefix = `ironlog-web-draft:${userId}:`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      const val = localStorage.getItem(k);
      if (val) return { key: k, raw: val };
    }
  }
  return null;
}
