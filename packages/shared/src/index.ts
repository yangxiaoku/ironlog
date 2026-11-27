import { z } from "zod";
import { equipmentNames, exerciseCategoryNames, muscleNames } from "./catalogue.js";
export * from "./logic.js";
export * from "./catalogue.js";
export * from "./adaptation.js";
export * from "./exercise-localization.js";
export * from "./energy.js";
export * from "./timing.js";
export * from "./nutrition.js";
export * from "./goals.js";
export * from "./open-gym-catalogue.js";
export * from "./catalogue-version.js";
export * from "./planning.js";
export * from "./science-analytics.js";
export * from "./apple-workout-annotation.js";
export * from "./backup-limits.js";
export * from "./classic-strength.js";
export * from "./muscle-map.js";
export type * from "./catalogue-api.js";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const date = z.iso.date();
const shortText = z.string().trim().min(1).max(120);
const nonnegative = z.number().finite().min(0).max(100000);

export const muscleSchema = z.enum(Object.keys(muscleNames) as (keyof typeof muscleNames)[]);
export const exerciseSchema = z.object({
  id,
  name: shortText,
  englishName: z.string().max(120),
  aliases: z.array(shortText).max(20),
  muscle: muscleSchema,
  secondaryMuscles: z.array(muscleSchema).max(5),
  equipment: z.enum(Object.keys(equipmentNames) as (keyof typeof equipmentNames)[]),
  category: z.enum(Object.keys(exerciseCategoryNames) as (keyof typeof exerciseCategoryNames)[]).optional(),
  mode: z.enum(["reps", "timed", "assisted"]),
  volumeMultiplier: z.number().min(1).max(2),
  instructions: z.array(z.string().max(300)).min(1).max(16),
  description: z.string().trim().min(1).max(400).optional(),
  mistakes: z.array(z.string().max(300)).max(8),
  custom: z.boolean().default(true),
  source: z
    .object({
      repository: z.string(),
      revision: z.string(),
      id: z.string(),
      license: z.string(),
      url: z.string().regex(/^https?:\/\//),
    })
    .optional(),
});
export type Exercise = z.infer<typeof exerciseSchema>;
export const exerciseSnapshotSchema = exerciseSchema.pick({
  name: true,
  muscle: true,
  equipment: true,
  mode: true,
  volumeMultiplier: true,
});

export const weightUnitSchema = z.enum(["kg", "lb"]);
export type WeightUnit = z.infer<typeof weightUnitSchema>;

export const setSchema = z.object({
  id,
  type: z.enum(["normal", "warmup", "failure", "drop", "rest_pause"]),
  weight: nonnegative,
  reps: z.number().int().min(0).max(1000),
  seconds: z.number().int().min(0).max(86400).default(0),
  completed: z.boolean(),
  completedAt: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.iso.datetime({ offset: true }).optional(),
  ),
  rir: z.number().int().min(0).max(10).nullable().default(null),
  note: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().trim().max(200).optional(),
  ),
});
export const sessionExerciseSchema = z.object({
  id,
  exerciseId: id,
  targetIndex: z.number().int().min(0).max(99).nullable().optional(),
  supersetGroup: z.string().trim().max(16).nullable().optional(),
  weightUnit: weightUnitSchema.optional(),
  restSeconds: z.number().int().min(0).max(900),
  snapshot: exerciseSnapshotSchema.nullable().default(null),
  sets: z.array(setSchema).max(100),
});

export const workoutAdjustmentPatchSchema = z
  .object({
    exerciseId: id.optional(),
    weight: nonnegative.optional(),
    reps: z.number().int().min(1).max(1000).optional(),
    seconds: z.number().int().min(1).max(86400).optional(),
    restSeconds: z.number().int().min(0).max(900).optional(),
    remainingSets: z.number().int().min(0).max(100).optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    {
      message: "调整需要至少一个修改项",
    },
  );
export const workoutAdjustmentRequestSchema = z.object({
  exerciseRowId: id,
  reason: z.string().trim().min(1).max(2000),
  patch: workoutAdjustmentPatchSchema,
});
export const workoutAdjustmentSchema = workoutAdjustmentRequestSchema.extend({
  before: z.object({
    exerciseId: id,
    snapshot: exerciseSnapshotSchema.nullable().optional(),
    restSeconds: z.number().int().min(0).max(900),
    openSets: z
      .array(
        setSchema.refine((set) => !set.completed, {
          message: "调整基准需要使用待完成组",
        }),
      )
      .min(1)
      .max(100),
  }),
});
export const workoutAdaptationSchema = z.object({
  id,
  workoutId: id,
  baseVersion: z.number().int().min(0),
  createdAt: z.iso.datetime({ offset: true }),
  summary: z.string().trim().min(1).max(4000),
  source: z.enum(["ai", "manual", "agent"]).default("ai"),
  changes: z.array(workoutAdjustmentSchema).max(6),
});
export type WorkoutAdjustment = z.infer<typeof workoutAdjustmentSchema>;
export type WorkoutAdaptation = z.infer<typeof workoutAdaptationSchema>;

export const workoutSchema = z
  .object({
    title: shortText,
    date,
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }).nullable(),
    timing: z.preprocess(
      (v) => (v === null ? undefined : v),
      z.object({
        elapsedSeconds: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        runningSince: z.iso.datetime({ offset: true }).nullable(),
      }).optional(),
    ),
    durationUnknown: z.boolean().optional(),
    status: z.enum(["active", "completed", "cancelled"]),
    notes: z.string().max(4000).default(""),
    feeling: z.enum(["fatigued", "balanced", "easy"]).nullable().default(null),
    source: z.preprocess(
      (v) => (v === "plan" || v === "template" || v === "scheduled" || v === null || v === "" ? "manual" : v),
      z.enum(["manual", "ai", "agent"]).default("manual"),
    ),
    rawPrompt: z.preprocess((v) => (v === null ? "" : v), z.string().max(4000).default("")),
    planId: id.nullable().default(null),
    planVersion: z.number().int().positive().nullable().default(null),
    routineId: id.nullable().default(null),
    targetSnapshot: z
      .lazy(() => routineSchema)
      .nullable()
      .default(null),
    exercises: z.array(sessionExerciseSchema).max(100),
    restEndsAt: z.number().nullable().default(null),
    restStartedAt: z.number().int().nonnegative().nullish(),
    adjustments: z.preprocess((v) => (v === null ? [] : v), z.array(workoutAdaptationSchema).max(100).default([])),
  })
  .superRefine((value, ctx) => {
    const ids = value.exercises.flatMap((item) => [
      item.id,
      ...item.sets.map((set) => set.id),
    ]);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "动作与组 ID 必须唯一" });
    if (value.status === "completed" && !value.endedAt)
      ctx.addIssue({ code: "custom", message: "完成训练需要结束时间" });
    if (
      value.endedAt &&
      Date.parse(value.endedAt) < Date.parse(value.startedAt)
    )
      ctx.addIssue({ code: "custom", message: "结束时间不能早于开始时间" });
  });
export type Workout = z.infer<typeof workoutSchema>;

export const dietSchema = z.object({
  date,
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  name: shortText,
  calories: nonnegative,
  protein: nonnegative,
  carbs: nonnegative,
  fat: nonnegative,
  source: z.enum(["manual", "ai", "copy"]).default("manual"),
  rawPrompt: z.string().max(4000).default(""),
});
export type Diet = z.infer<typeof dietSchema>;
export const nutritionDaySchema = z.object({ date, complete: z.boolean(), fingerprint: z.string().optional() });
export type NutritionDay = z.infer<typeof nutritionDaySchema>;
export const mealTemplateSchema = z.object({
  name: shortText,
  foods: z.array(dietSchema.omit({ date: true, meal: true })).min(1).max(30),
});
export type MealTemplate = z.infer<typeof mealTemplateSchema>;
export const weightSchema = z.object({
  date,
  weight: z.number().min(1).max(500),
  bodyFat: z.number().min(0).max(100).nullable().default(null),
});
export type Weight = z.infer<typeof weightSchema>;
export const energyProfileSchema = z.object({
  heightCm: z.number().finite().min(50).max(250),
  weightKg: z.number().finite().min(1).max(500),
  weightDate: date.nullable(),
  birthDate: date,
  sex: z.enum(["male", "female"]),
  activityFactor: z.number().finite().min(1.4).max(2.5),
  context: z.enum(["general", "pregnant", "breastfeeding"]),
});
export type EnergyProfile = z.infer<typeof energyProfileSchema>;
export const calorieEstimateSchema = z.object({
  method: z.literal("mifflin-st-jeor-1990"),
  asOf: date,
  inputs: energyProfileSchema,
});
export type CalorieEstimate = z.infer<typeof calorieEstimateSchema>;
export const goalSnapshotSchema = z.object({
  date,
  calories: z.number().positive(),
  protein: nonnegative,
  carbs: nonnegative,
  fat: nonnegative,
  daysPerWeek: z.number().int().min(1).max(7),
  targetWeight: z.number().positive().nullable(),
});
const workoutPrefsBase = {
  soundOn: z.boolean(),
  hapticsOn: z.boolean(),
  screenAwake: z.boolean(),
  notifyRest: z.boolean(),
  showRir: z.boolean(),
  autoSyncSubsequent: z.boolean(),
  autoPrefillLast: z.boolean(),
  autoStartRestTimer: z.boolean(),
  autoAdvanceExercise: z.boolean(),
  warmupRestSeconds: z.number().int().min(0).max(300),
  restAdjustStep: z.number().int().min(5).max(120),
  weightStepKg: z.number().min(0.25).max(20),
  barWeight: z.number().min(0).max(100),
  enabledPlates: z.array(z.number().positive().max(100)).min(1).max(20),
  showPlateMath: z.boolean(),
  warmupScheme: z.enum(["light", "standard", "heavy"]),
  soundStyle: z.enum(["chime", "marimba", "bell"]),
  appleFitnessAutoLaunch: z.boolean(),
  appleStrengthLaunch: z.enum(["hub", "shortcut", "fitness_app", "off"]),
  appleCardioLaunch: z.enum(["hub", "shortcut", "fitness_app", "off"]),
  appleHubShortcutName: z.string().trim().min(1).max(80),
  appleStrengthShortcutName: z.string().trim().min(1).max(80),
  appleCardioShortcutName: z.string().trim().min(1).max(80),
  appleAutoSyncOnFinish: z.boolean(),
  deloadMode: z.boolean(),
  deloadWeightPct: z.number().int().min(50).max(95),
  deloadSetsPct: z.number().int().min(25).max(100),
  workoutLayout: z.enum(["card", "compact", "focus"]),
  collapseCompletedExercises: z.boolean(),
  voiceRestCues: z.boolean(),
  platePairs: z.record(z.string(), z.number().int().min(0).max(20)),
};

export const workoutPrefsPatchSchema = z.object(workoutPrefsBase).partial();

export const workoutPrefsSchema = z.object({
  soundOn: workoutPrefsBase.soundOn.default(true),
  hapticsOn: workoutPrefsBase.hapticsOn.default(true),
  screenAwake: workoutPrefsBase.screenAwake.default(false),
  notifyRest: workoutPrefsBase.notifyRest.default(false),
  showRir: workoutPrefsBase.showRir.default(false),
  autoSyncSubsequent: workoutPrefsBase.autoSyncSubsequent.default(true),
  autoPrefillLast: workoutPrefsBase.autoPrefillLast.default(true),
  autoStartRestTimer: workoutPrefsBase.autoStartRestTimer.default(true),
  autoAdvanceExercise: workoutPrefsBase.autoAdvanceExercise.default(true),
  warmupRestSeconds: workoutPrefsBase.warmupRestSeconds.default(45),
  restAdjustStep: workoutPrefsBase.restAdjustStep.default(15),
  weightStepKg: workoutPrefsBase.weightStepKg.default(2.5),
  barWeight: workoutPrefsBase.barWeight.default(20),
  enabledPlates: workoutPrefsBase.enabledPlates.default([25, 20, 15, 10, 5, 2.5, 1.25]),
  showPlateMath: workoutPrefsBase.showPlateMath.default(true),
  warmupScheme: workoutPrefsBase.warmupScheme.default("standard"),
  soundStyle: workoutPrefsBase.soundStyle.default("chime"),
  appleFitnessAutoLaunch: workoutPrefsBase.appleFitnessAutoLaunch.default(false),
  appleStrengthLaunch: workoutPrefsBase.appleStrengthLaunch.default("hub"),
  appleCardioLaunch: workoutPrefsBase.appleCardioLaunch.default("hub"),
  appleHubShortcutName: workoutPrefsBase.appleHubShortcutName.default("铁记-通用-Apple健康全能联动"),
  appleStrengthShortcutName: workoutPrefsBase.appleStrengthShortcutName.default("铁记开始力量"),
  appleCardioShortcutName: workoutPrefsBase.appleCardioShortcutName.default("铁记开始有氧"),
  appleAutoSyncOnFinish: workoutPrefsBase.appleAutoSyncOnFinish.default(false),
  deloadMode: workoutPrefsBase.deloadMode.default(false),
  deloadWeightPct: workoutPrefsBase.deloadWeightPct.default(80),
  deloadSetsPct: workoutPrefsBase.deloadSetsPct.default(50),
  workoutLayout: workoutPrefsBase.workoutLayout.default("card"),
  collapseCompletedExercises: workoutPrefsBase.collapseCompletedExercises.default(false),
  voiceRestCues: workoutPrefsBase.voiceRestCues.default(false),
  platePairs: workoutPrefsBase.platePairs.optional(),
});
export type WorkoutPrefs = z.infer<typeof workoutPrefsSchema>;

export const quickFoodSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: shortText,
  baseGrams: z.number().finite().positive().max(10000).default(100),
  unit: z.string().trim().min(1).max(16).default("g"),
  calories: nonnegative,
  protein: nonnegative,
  carbs: nonnegative,
  fat: nonnegative,
});
export type QuickFood = z.infer<typeof quickFoodSchema>;

export const equipmentProfileSchema = z.object({
  id,
  name: shortText,
  equipment: z.array(z.string().max(100)).max(30).default(["barbell", "dumbbell", "machine"]),
  barWeight: z.number().min(0).max(100).default(20),
  enabledPlates: z.array(z.number().positive().max(100)).min(1).max(20).default([25, 20, 15, 10, 5, 2.5, 1.25]),
  platePairs: z.record(z.string(), z.number().int().min(0).max(20)).optional(),
  dumbbellMinKg: z.number().min(0).max(100).optional(),
  dumbbellMaxKg: z.number().min(0).max(150).optional(),
  dumbbellStepKg: z.number().min(0.5).max(10).optional(),
});
export type EquipmentProfile = z.infer<typeof equipmentProfileSchema>;

export const profileSchema = z.object({
  calories: z.number().min(1).max(20000).default(2200),
  protein: nonnegative.default(150),
  carbs: nonnegative.default(220),
  fat: nonnegative.default(65),
  waterGoalMl: z.number().int().min(500).max(10000).default(2000),
  targetWeight: z.number().min(1).max(500).nullable().default(null),
  restSeconds: z.number().int().min(0).max(900).default(90),
  goal: z.string().max(1000).default(""),
  experience: z.string().max(500).default(""),
  daysPerWeek: z.number().int().min(1).max(7).default(3),
  minutesPerSession: z.number().int().min(10).max(240).default(45),
  equipment: z
    .array(z.string().max(100))
    .max(30)
    .default(["barbell", "dumbbell", "machine"]),
  limitations: z.string().max(1000).default(""),
  energyProfile: energyProfileSchema.nullable().default(null),
  calorieEstimate: calorieEstimateSchema.nullable().default(null),
  goalHistory: z.array(goalSnapshotSchema).optional(),
  workoutPrefs: workoutPrefsSchema.optional(),
  quickFoods: z.array(quickFoodSchema).max(60).optional(),
  equipmentProfiles: z.array(equipmentProfileSchema).max(6).optional(),
  activeEquipmentProfileId: id.nullable().optional(),
});
export type Profile = z.infer<typeof profileSchema>;

export const plannedExerciseSchema =
  z
    .object({
      exerciseId: id,
      sets: z.number().int().min(1).max(100),
      repsMin: z.number().int().min(1).max(1000),
      repsMax: z.number().int().min(1).max(1000),
      weight: nonnegative.nullable(),
      seconds: z.number().int().min(0).max(86400).default(0),
      restSeconds: z.number().int().min(0).max(900),
      targetRir: z.number().int().min(0).max(10).default(2),
      progression: z.enum(["double", "triple", "linear", "greyskull", "manual"]).default("double"),
      setsMax: z.number().int().min(1).max(20).optional(),
      deloadMissThreshold: z.number().int().min(2).max(5).optional(),
      increment: z.number().min(0).max(20).default(2.5),
      backupExerciseId: id.nullable().default(null),
      supersetGroup: z.string().trim().max(16).nullable().optional(),
      weightUnit: weightUnitSchema.optional(),
    })
    .refine((value) => value.repsMax >= value.repsMin, {
      message: "次数上限不能低于下限",
    });
export const scheduledDaySchema = z
  .object({
    date,
    mode: z.enum(["workout", "rest"]),
    title: z.string().trim().max(120).default(""),
    planId: id.nullable().default(null),
    routineId: id.nullable().default(null),
    templateId: id.nullable().default(null),
    notes: z.string().max(1000).default(""),
    exercises: z.array(plannedExerciseSchema).max(100).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "workout" && !value.title.trim() && !value.exercises.length) {
      ctx.addIssue({ code: "custom", message: "排定的训练日需要名称或至少一个动作" });
    }
    if (value.mode === "workout" && value.exercises.some((item) => item.backupExerciseId === item.exerciseId)) {
      ctx.addIssue({ code: "custom", message: "备用动作需要与原动作不同" });
    }
  });
export type ScheduledDay = z.infer<typeof scheduledDaySchema>;
export const routineSchema = z.object({
  id,
  name: shortText,
  isDeload: z.boolean().optional(),
  exercises: z.array(plannedExerciseSchema).min(1).max(100),
});
export const planSchema = z
  .object({
    name: shortText,
    weeks: z.number().int().min(1).max(52),
    schedule: z.enum(["rotation", "weekdays"]),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    routines: z.array(routineSchema).min(1).max(7),
    rationale: z.string().min(1).max(8000),
    source: z.enum(["manual", "ai", "agent"]).default("manual"),
    parentId: id.nullable().default(null),
  })
  .superRefine((plan, ctx) => {
    if (
      new Set(plan.routines.map((routine) => routine.id)).size !==
      plan.routines.length
    )
      ctx.addIssue({ code: "custom", message: "训练日 ID 重复" });
    if (
      plan.schedule === "weekdays" &&
      (plan.weekdays.length !== plan.routines.length ||
        new Set(plan.weekdays).size !== plan.weekdays.length)
    )
      ctx.addIssue({ code: "custom", message: "每个训练日需要对应唯一的星期" });
  });
export type Plan = z.infer<typeof planSchema>;
export type Routine = z.infer<typeof routineSchema>;
export const entityKindSchema = z.enum([
  "workout",
  "diet",
  "mealTemplate",
  "nutritionDay",
  "weight",
  "profile",
  "exercise",
  "favorite",
  "template",
  "plan",
  "scheduledDay",
]);
export type EntityKind = z.infer<typeof entityKindSchema>;
export const schemas = {
  workout: workoutSchema,
  diet: dietSchema,
  mealTemplate: mealTemplateSchema,
  nutritionDay: nutritionDaySchema,
  weight: weightSchema,
  profile: profileSchema,
  exercise: exerciseSchema,
  favorite: z.object({ exerciseId: id }),
  template: routineSchema,
  plan: planSchema,
  scheduledDay: scheduledDaySchema,
};
export interface StoredRecord {
  id: string;
  kind: EntityKind;
  version: number;
  deleted: boolean;
  data: unknown;
  updatedAt: string;
}
export const mutationSchema = z.object({
  opId: id,
  id,
  kind: entityKindSchema,
  baseVersion: z.number().int().min(0),
  deleted: z.boolean().default(false),
  data: z.unknown(),
});
export type Mutation = z.infer<typeof mutationSchema>;
export interface MutationResult {
  opId: string;
  status: "applied" | "conflict";
  record: StoredRecord | null;
}
export * from "./starter-plans.js";
export type { SleepReport, SleepReportDay } from "./sleep-report.js";
