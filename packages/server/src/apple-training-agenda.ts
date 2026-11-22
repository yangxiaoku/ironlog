import type Database from "better-sqlite3";
import {
  getExerciseCategory, isValidWorkSet, localDate, planCycle, recommendInCycle,
  type Exercise, type PlanCompletion, type Routine, type Workout,
} from "@ironlog/shared";
import { z } from "zod";
import { mergeAppleMeasurements, type AppleWorkoutInput } from "./apple-health.js";
import type { Db } from "./db.js";
import { DomainError, type Store } from "./store.js";

type Stmt = Database.Statement<unknown[], unknown>;
const canonicalUploadsStmtCache = new WeakMap<Db, Stmt>();
function canonicalUploadsStmt(db: Db): Stmt {
  let stmt = canonicalUploadsStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT id, data FROM apple_health_workouts
      WHERE user_id=? AND ended_at<? ORDER BY ended_at,id`);
    canonicalUploadsStmtCache.set(db, stmt);
  }
  return stmt;
}

const DAY = 86400000;
type Family = "resistance" | "cardio" | "other";
type Activity = { family: Family; key: string; title: string };
const kinds: Record<string, Activity> = {};
for (const [family, key, title, aliases] of [
  ["resistance", "traditionalstrengthtraining", "传统力量训练", "traditionalstrength strengthtraining weighttraining"],
  ["resistance", "functionalstrengthtraining", "功能性力量训练", "functionalstrength"],
  ["other", "coretraining", "核心训练", "coretraining"],
  ["cardio", "running", "跑步", "run indoorrunning outdoorrunning treadmill"],
  ["cardio", "walking", "步行", "walk indoorwalking outdoorwalking"],
  ["cardio", "cycling", "骑行", "bike indoorcycling outdoorcycling handcycling"],
  ["cardio", "stairclimbing", "踏步机", "stairstepper stairmaster stepmachine"],
  ["cardio", "stairs", "爬楼梯", "stairs stairwalking"],
  ["cardio", "elliptical", "椭圆机", "elliptical"],
  ["cardio", "rowing", "划船", "rowing indoorrowing"],
  ["cardio", "swimming", "游泳", "swimming openwaterswimming poolswimming"],
  ["cardio", "jumprope", "跳绳", "jumprope skipping"],
  ["cardio", "hiking", "徒步", "hike hiking"],
  ["cardio", "mixedcardio", "混合有氧", "mixedmetaboliccardiotraining"],
  ["cardio", "highintensityintervaltraining", "高强度间歇训练", "hiit"],
  ["other", "crosstraining", "交叉训练", "crosstraining"],
  ["other", "yoga", "瑜伽", "yoga"],
  ["other", "pilates", "普拉提", "pilates"],
  ["other", "dance", "舞蹈", "dance dancingsocial socialdance"],
  ["other", "flexibility", "柔韧性训练", "flexibility stretching"],
  ["other", "tennis", "网球", "tennis"],
  ["other", "badminton", "羽毛球", "badminton"],
  ["other", "basketball", "篮球", "basketball"],
  ["other", "soccer", "足球", "soccer football"],
  ["other", "cooldown", "放松整理", "cooldown preparationandrecovery"],
] as const) {
  for (const code of [key, ...aliases.split(" ")]) kinds[code] = { family, key, title };
}
const normalize = (code: string) => code.toLowerCase().replace(/^hkworkoutactivitytype/, "").replace(/[-_]/g, "");

function identifyActivity(data: AppleWorkoutInput): Activity {
  const code = normalize(data.activityType);
  const kind = Object.hasOwn(kinds, code) ? kinds[code]! : { family: "other" as const, key: code, title: "其他运动" };
  if (!["running", "walking", "cycling"].includes(kind.key)) return kind;
  const prefix = data.environment === "outdoor" || code.startsWith("outdoor") ? "户外" :
    data.environment === "indoor" || code.startsWith("indoor") ? "室内" : "";
  return { ...kind, title: prefix + kind.title };
}

const resistance = new Set(["strength", "calisthenics", "olympic", "isometric", "plyometrics"]);
const accessory = new Set(["mobility", "stretching"]);
const cardioKinds: [RegExp, string][] = [
  [/\bwalking\b|步行|慢走|走路|健走/i, "walking"],
  [/\bhiking\b|徒步/i, "hiking"],
  [/\b(running|jogging|treadmill)\b|跑步|慢跑/i, "running"],
  [/\b(cycling|bike|bicycle)\b|单车|骑行|自行车/i, "cycling"],
  [/\b(elliptical)\b|椭圆机/i, "elliptical"],
  [/\bstair\s*(climbing|stepper|master)\b|踏步机|楼梯机/i, "stairclimbing"],
  [/\b(stairs|staircase)\b|爬楼梯/i, "stairs"],
  [/\browing\b|划船机/i, "rowing"],
  [/\bswimming\b|游泳/i, "swimming"],
  [/\b(jump rope|skipping rope)\b|跳绳/i, "jumprope"],
  [/\bhiit\b|高强度间歇/i, "highintensityintervaltraining"],
];
type TrainingKind = { family: Family; cardio: Set<string> };

function trainingKind(exercises: (Exercise | null | undefined)[]): TrainingKind {
  const families = new Set<Family>();
  const cardio = new Set<string>();
  for (const exercise of exercises) {
    if (!exercise) { families.add("other"); continue; }
    const category = getExerciseCategory(exercise);
    if (accessory.has(category)) continue;
    if (resistance.has(category)) families.add("resistance");
    else if (category === "cardio") {
      families.add("cardio");
      const name = [exercise.englishName, exercise.name].join(" ");
      const type = cardioKinds.find(([pattern]) => pattern.test(name))?.[1];
      if (type) cardio.add(type);
    } else families.add("other");
  }
  return { family: families.size === 1 ? [...families][0]! : "other", cardio };
}

function compatible(activity: Activity, planned: TrainingKind, allowGenericCardio: boolean) {
  if (activity.family === "other" || planned.family !== activity.family) return false;
  if (activity.family === "resistance") return true;
  return planned.cardio.size > 0 ? planned.cardio.size === 1 && planned.cardio.has(activity.key) : allowGenericCardio;
}

type Uploaded = AppleWorkoutInput & { id: string; date: string; activity: Activity };
type Manual = { id: string; workout: Workout; kind: TrainingKind };
export type ApplePlanMatch = { planId: string; planVersion: number | null; routineId: string; name: string };
export type AppleAgendaItem = Uploaded & { manualWorkoutId: string | null; plan: ApplePlanMatch | null };

function startOf(date: string) { return Date.parse(date + "T00:00:00+08:00"); }
function overlapping(
  first: { startedAt: string; endedAt: string | null },
  second: { startedAt: string; endedAt: string | null },
) {
  if (!first.endedAt || !second.endedAt) return false;
  const startA = Date.parse(first.startedAt), endA = Date.parse(first.endedAt);
  const startB = Date.parse(second.startedAt), endB = Date.parse(second.endedAt);
  const a = endA - startA, b = endB - startB;
  const shared = Math.min(endA, endB) - Math.max(startA, startB);
  return a > 0 && b > 0 && shared >= 0.8 * Math.min(a, b) && shared >= 0.55 * Math.max(a, b);
}

function sameSourceWorkout(a: Uploaded, b: Uploaded) {
  return a.activity.key === b.activity.key && (a.environment === b.environment ||
    a.environment === "unknown" || b.environment === "unknown") &&
    Math.abs(Date.parse(a.startedAt) - Date.parse(b.startedAt)) <= 120000 &&
    Math.abs(Date.parse(a.endedAt) - Date.parse(b.endedAt)) <= 120000 && overlapping(a, b);
}

function canonicalUploads(store: Store, userId: string, through: string): Uploaded[] {
  const limit = new Date(startOf(through) + 8 * DAY).toISOString();
  const records = canonicalUploadsStmt(store.db).all(userId, limit) as { id: string; data: string }[];
  const rows = records.map(({ id, data }) => {
    const workout = JSON.parse(data) as AppleWorkoutInput;
    return { id, ...workout, date: localDate(Date.parse(workout.startedAt)), activity: identifyActivity(workout) };
  });
  const direct = rows.filter((row) => row.captureMethod === "workout");
  const byDate = new Map<string, Uploaded[]>();
  for (const row of direct) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date)!.push(row);
  }
  const unpaired = [];
  for (const row of rows) {
    if (row.captureMethod !== "trigger") continue;
    const instant = Date.parse(row.startedAt);
    const candidates = new Set([localDate(instant - 120000), row.date, localDate(instant + 120000)]);
    const matches = [...candidates].flatMap((date) => byDate.get(date) ?? []).filter((item) => sameSourceWorkout(item, row));
    if (matches.length !== 1) { unpaired.push(row); continue; }
    // Prefer the full training sample, with trigger estimates only filling missing fields.
    const sample = matches[0]!;
    const merged = mergeAppleMeasurements(sample, row);
    Object.assign(sample, merged, { activity: identifyActivity(merged) });
  }
  return [...direct, ...unpaired].filter((row) => row.date <= through)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}

function routineKind(routine: Routine, catalogue: ReadonlyMap<string, Exercise>) {
  return trainingKind(routine.exercises.map((row) => catalogue.get(row.exerciseId)));
}

export function projectAppleTraining(
  store: Store,
  userId: string,
  through = localDate(),
  knownExercises?: ReadonlyMap<string, Exercise>,
  knownWorkouts?: readonly { id: string; workout: Workout }[],
) {
  const records = knownWorkouts
    ? knownWorkouts.filter(({ workout }) => workout.status === "completed" && workout.date <= through)
    : store.list(userId, "workout").flatMap(({ id, data }) => {
        const workout = data as Workout;
        if (workout.status !== "completed" || workout.date > through) return [];
        return [{ id, workout }];
      });
  const completionHistory: PlanCompletion[] = records.map(({ workout }) => workout);
  const uploads = canonicalUploads(store, userId, through);
  const agenda: AppleAgendaItem[] = [];
  if (!uploads.length) return { entries: agenda, completionHistory };
  const catalogue = knownExercises ?? store.catalogueMap(userId, true);
  const planHistory = [...(store.planSchedule(userId)?.history ?? [])].reverse();
  const routineKindCache = new Map<Routine, TrainingKind>();
  const cachedRoutineKind = (routine: Routine) => {
    let kind = routineKindCache.get(routine);
    if (!kind) {
      kind = routineKind(routine, catalogue);
      routineKindCache.set(routine, kind);
    }
    return kind;
  };
  const byDay = new Map<string, Manual[]>();
  for (const record of records) {
    if (!byDay.has(record.workout.date)) byDay.set(record.workout.date, []);
    const performed = record.workout.exercises.flatMap((row) => {
      const known = catalogue.get(row.exerciseId);
      if (!row.sets.some((set) => isValidWorkSet(set, row.snapshot?.mode ?? known?.mode))) return [];
      if (!row.snapshot) return [known];
      if (known) return [{ ...known, ...row.snapshot }];
      return [{ id: row.exerciseId, englishName: "", aliases: [], instructions: [], mistakes: [],
        secondaryMuscles: [], custom: true, ...row.snapshot }];
    });
    byDay.get(record.workout.date)!.push({ ...record, kind: trainingKind(performed) });
  }
  const possible = new Map<string, Manual[]>();
  const useCount = new Map<string, number>();
  for (const row of uploads) {
    const joined = (byDay.get(row.date) ?? []).filter((record) =>
      compatible(row.activity, record.kind, false) && overlapping(row, record.workout));
    possible.set(row.id, joined);
    for (const item of joined) useCount.set(item.id, (useCount.get(item.id) ?? 0) + 1);
  }
  const claimed = new Set<string>();
  for (const row of uploads) {
    const matches = possible.get(row.id)!;
    const manual = matches.length === 1 && useCount.get(matches[0]!.id) === 1 ? matches[0]! : null;
    const activation = planHistory.find((plan) => !!plan.updatedAt && plan.updatedAt <= row.startedAt);
    let matchedPlan: ApplePlanMatch | null = null;
    if (activation && !planCycle(activation, row.date)?.expired) {
      const { id, version, data } = activation;
      const dayKey = `${row.date}:${id}:${version ?? ""}`;
      const sameVersion = (workout: Workout) => workout.planId === id &&
        (workout.planVersion == null || workout.planVersion === version);
      const linkedRoutine = manual && sameVersion(manual.workout)
        ? data.routines.find((routine) => routine.id === manual.workout.routineId) : undefined;
      const existingPlanLink = manual?.workout.planId != null;
      const planned = !existingPlanLink && !claimed.has(dayKey)
        ? recommendInCycle(activation, completionHistory.filter((workout) => workout.date < row.date), row.date)
        : null;
      const routine = linkedRoutine ?? (planned?.date === row.date ? planned.routine : null);
      const alreadyLogged = !linkedRoutine && routine && (byDay.get(row.date) ?? []).some(({ workout }) =>
        sameVersion(workout) && workout.routineId === routine.id);
      const provenExercise = !manual || !!linkedRoutine || (routine && manual.workout.exercises.some((performed) =>
        performed.sets.some((set) => isValidWorkSet(set, performed.snapshot?.mode)) &&
        routine.exercises.some((target) => target.exerciseId === performed.exerciseId)));
      if (routine && !alreadyLogged && provenExercise && compatible(row.activity, cachedRoutineKind(routine), true)) {
        matchedPlan = { planId: id, planVersion: version ?? null, routineId: routine.id, name: routine.name };
        claimed.add(dayKey);
        if (!linkedRoutine) completionHistory.push({
          title: routine.name, date: row.date, startedAt: row.startedAt, endedAt: row.endedAt,
          status: "completed", planId: id, routineId: routine.id,
        });
      }
    }
    agenda.push({ ...row, manualWorkoutId: manual?.id ?? null, plan: matchedPlan });
  }
  return { entries: agenda, completionHistory };
}

export const agendaQuery = z.object({ from: z.iso.date(), through: z.iso.date() });
export function publicAppleActivity(item: AppleAgendaItem) {
  const { id, date, activity, activityType, startedAt, endedAt, durationSeconds, durationKind,
    activeEnergyKcal, energyKind, distanceMeters, heartRate, manualWorkoutId, plan } = item;
  return { id, date, title: activity.title, family: activity.family, activityType, startedAt, endedAt,
    durationSeconds: durationSeconds ?? null, durationKind: durationKind ?? null, activeEnergyKcal: activeEnergyKcal ?? null,
    energyKind: energyKind ?? null, distanceMeters: distanceMeters ?? null, heartRate: heartRate ?? null, manualWorkoutId, plan };
}
export function listAppleTraining(store: Store, userId: string, query: z.infer<typeof agendaQuery>) {
  if (query.from > query.through || query.through > localDate() ||
      startOf(query.through) - startOf(query.from) > 365 * DAY) throw new DomainError("选择最多 366 天的有效日期范围");
  return projectAppleTraining(store, userId, query.through).entries.filter(({ date }) => date >= query.from).map(publicAppleActivity);
}
