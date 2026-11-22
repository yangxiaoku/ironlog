import { exerciseCatalogue, localDate, nutritionFingerprint, type Mutation } from "@ironlog/shared";
import type { Auth } from "./auth.js";
import { shiftDay } from "./web-statistics.js";
import type { Store } from "./store.js";

const routines = [
  { title: "推 · 胸肩三头", ids: ["bench-press", "incline-dumbbell", "lateral-raise", "triceps-pushdown"], weights: [57.5, 20, 7.5, 22.5] },
  { title: "拉 · 背和二头", ids: ["barbell-row", "lat-pulldown", "hammer-curl", "reverse-fly"], weights: [45, 45, 10, 7.5] },
  { title: "腿 · 下肢力量", ids: ["squat", "leg-press", "leg-curl", "romanian-deadlift"], weights: [65, 110, 30, 55] },
];
function isolateRealHealthFromDemoUser(store: Store, auth: Auth, demoUserId: string) {
  const hasRealDaily = store.db
    .prepare("SELECT 1 FROM apple_health_daily WHERE user_id=? LIMIT 1")
    .get(demoUserId);
  const hasRealWorkouts = store.db
    .prepare("SELECT 1 FROM apple_health_workouts WHERE user_id=? AND id NOT LIKE 'demo_%' LIMIT 1")
    .get(demoUserId);
  if (!hasRealDaily && !hasRealWorkouts) return;

  store.db.transaction(() => {
    const isolated = auth.login("real-health-owner");
    if (isolated.userId === demoUserId) return;

    const dailyRows = store.db
      .prepare("SELECT date, updated_at AS updatedAt, data FROM apple_health_daily WHERE user_id=?")
      .all(demoUserId) as Array<{ date: string; updatedAt: string; data: string }>;
    const upsertDaily = store.db.prepare(
      `INSERT INTO apple_health_daily (user_id, date, updated_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data`,
    );
    for (const row of dailyRows) {
      upsertDaily.run(isolated.userId, row.date, row.updatedAt, row.data);
    }
    store.db.prepare("DELETE FROM apple_health_daily WHERE user_id=?").run(demoUserId);

    store.db
      .prepare("UPDATE apple_health_devices SET user_id=? WHERE user_id=?")
      .run(isolated.userId, demoUserId);
    store.db
      .prepare("UPDATE apple_health_workouts SET user_id=? WHERE user_id=? AND id NOT LIKE 'demo_%'")
      .run(isolated.userId, demoUserId);
    store.db
      .prepare("UPDATE OR IGNORE apple_health_receipts SET user_id=? WHERE user_id=?")
      .run(isolated.userId, demoUserId);
    store.db
      .prepare("DELETE FROM apple_health_receipts WHERE user_id=?")
      .run(demoUserId);

    // Restore any demo weight records that were overwritten by Apple Health daily weight sync
    const today = localDate();
    for (let offset = 71; offset >= 0; offset--) {
      const date = shiftDay(today, -offset);
      const id = "weight_" + date;
      const existing = store.get(demoUserId, "weight", id);
      if (offset % 3 === 1) {
        if (existing && !existing.deleted) {
          store.mutate(demoUserId, {
            kind: "weight",
            id,
            opId: `demo_clean_${id}_${Date.now()}`,
            baseVersion: existing.version,
            deleted: true,
            data: existing.data,
          });
        }
      } else {
        const kg = Math.round((75.4 + offset * 0.028 + Math.sin(offset * 1.3) * 0.34) * 10) / 10;
        const data = existing?.data as { weight?: number; bodyFat?: number | null } | undefined;
        if (existing && !existing.deleted && (data?.weight !== kg || data?.bodyFat != null)) {
          store.mutate(demoUserId, {
            kind: "weight",
            id,
            opId: `demo_restore_${id}_${Date.now()}`,
            baseVersion: existing.version,
            deleted: false,
            data: { date, weight: kg },
          });
        }
      }
    }
  }).immediate();
}

export function seedWebDemo(store: Store, auth: Auth) {
  const { userId, token } = auth.login("preview-only");
  isolateRealHealthFromDemoUser(store, auth, userId);
  if (store.db.prepare("SELECT 1 FROM active_plans WHERE user_id=? LIMIT 1").get(userId)) {
    return token;
  }
  const today = localDate();
  const save = (kind: Mutation["kind"], id: string, data: unknown) =>
    store.mutate(userId, { kind, id, data, opId: "demo_" + id, baseVersion: 0, deleted: false });
  save("profile", "settings", { targetWeight: 74, calories: 2250, protein: 145, daysPerWeek: 4 });
  const plan = store.createDraft(userId, {
    name: "推 · 拉 · 腿", weeks: 6, schedule: "rotation", weekdays: [],
    routines: routines.map((routine, index) => ({
      id: "routine_" + index, name: routine.title, exercises: routine.ids.map((exerciseId, i) => ({
        exerciseId, sets: 3, repsMin: 8, repsMax: 12, weight: routine.weights[i]!,
        seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null,
      })),
    })),
    rationale: "推、拉、腿轮换安排，适合作为三天训练的记录模板。", source: "manual", parentId: null,
  });
  store.applyPlan(userId, plan.record!.id, plan.record!.version, 0);
  let session = 0;
  for (let offset = 95; offset >= 0; offset--) {
    const date = shiftDay(today, -offset);
    const weekly = [[0, 2, 4], [1, 3, 6], [0, 3, 5], [1, 2, 5], [0, 2, 4, 6]][Math.floor(offset / 7) % 5]!;
    if (weekly.includes(offset % 7) || (offset < 49 && offset % 17 === 5)) {
      const routine = routines[offset === 0 ? 0 : session % routines.length]!;
      const length = 38 + ((session * 11) % 26);
      const startedAt = new Date(date + "T18:15:00+08:00");
      const exercises = routine.ids.flatMap((exerciseId, index) => {
        const exercise = exerciseCatalogue.find((item) => item.id === exerciseId);
        if (!exercise) return [];
        const weight = Math.max(2.5, routine.weights[index]! + Math.floor((93 - offset) / 14) * (index ? 1.25 : 2.5));
        return [{
          id: "row_" + index, exerciseId, restSeconds: 90, sets: Array.from({ length: 3 }, (_, set) => ({
            id: `set_${index}_${set}`, type: "normal", weight, reps: (index === 0 ? 8 : 10) - (set === 2 ? 1 : 0),
            seconds: 0, completed: true,
          })),
        }];
      });
      save("workout", "demo_session_" + session, {
        date, title: routine.title, status: "completed", startedAt: startedAt.toISOString(),
        endedAt: new Date(startedAt.getTime() + length * 60000).toISOString(),
        feeling: session % 7 === 0 ? "fatigued" : session % 5 === 0 ? "easy" : "balanced", exercises,
      });
      if (offset < 75 && offset % 4 !== 1) {
        const item = {
          schemaVersion: 1, captureMethod: "workout", activityType: "traditionalStrengthTraining",
          startedAt: startedAt.toISOString(), endedAt: new Date(startedAt.getTime() + length * 60000).toISOString(),
          durationSeconds: length * 60, durationKind: "workout_active",
          activeEnergyKcal: 180 + (session * 31) % 170, energyKind: "workout",
          heartRate: { avgBpm: 102 + session % 20, minBpm: 74 + session % 10, maxBpm: 142 + session % 25 },
        };
        store.db.prepare("INSERT INTO apple_health_workouts VALUES (?,?,?,?,?,?)")
          .run("demo_apple_" + session, userId, "demo_" + session, item.endedAt, item.endedAt, JSON.stringify(item));
      }
      session++;
    }
    if (offset < 72 && offset % 3 !== 1) {
      const kg = Math.round((75.4 + offset * 0.028 + Math.sin(offset * 1.3) * 0.34) * 10) / 10;
      save("weight", "weight_" + date, { date, weight: kg });
    }
    if (offset < 58 && offset % 8 !== 3) {
      const base = (offset * 37) % 160;
      const entries = [
        ["breakfast", "燕麦、牛奶和鸡蛋", 510, 29, 64, 15],
        ["lunch", "牛肉米饭和西兰花", 715 + base, 49, 90, 24],
        ["dinner", "鸡胸肉、土豆和时蔬", 640 + base * 0.5, 53, 72, 21],
        ["snack", "希腊酸奶和香蕉", 226, 17, 32, 3],
      ] as const;
      for (const [meal, name, calories, protein, carbs, fat] of entries)
        if (offset % 9 !== 4 || meal === "breakfast" || meal === "lunch")
          save("diet", `demo_${date}_${meal}`, { date, meal, name, calories, protein, carbs, fat });
      if (offset % 9 !== 4)
        save("nutritionDay", "nutritionDay_" + date, { date, complete: true,
          fingerprint: nutritionFingerprint(date, store.list(userId, "diet")) });
    }
  }
  const sampleRun = {
    schemaVersion: 1, captureMethod: "workout", activityType: "running", environment: "outdoor",
    startedAt: new Date(today + "T07:10:00+08:00").toISOString(),
    endedAt: new Date(today + "T07:37:00+08:00").toISOString(),
    durationSeconds: 1620, durationKind: "workout_active", activeEnergyKcal: 219, energyKind: "workout",
    distanceMeters: 4100, heartRate: { avgBpm: 132, minBpm: 97, maxBpm: 152 },
  };
  store.db.prepare("INSERT INTO apple_health_workouts VALUES (?,?,?,?,?,?)")
    .run("demo_outdoor_run", userId, "demo_outdoor_run", sampleRun.endedAt, sampleRun.endedAt, JSON.stringify(sampleRun));
  return token;
}
