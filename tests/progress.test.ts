import { test } from "node:test";
import assert from "node:assert/strict";
import { exerciseCatalogue, workoutSchema, dietSchema, profileSchema, planSchema, type StoredRecord, type Workout } from "@ironlog/shared";
import { correctWorkoutDuration, durationFromMinutes, stopWorkoutTimer, toggleWorkoutTimer, workoutDurationSeconds, workoutInterruption } from "../packages/shared/src/timing.js";
import { goalsOn, trackGoals, planCycle, planOn, recommendInCycle } from "../packages/shared/src/goals.js";
import { nutritionDayComplete, nutritionFingerprint } from "../packages/shared/src/nutrition.js";

const now = Date.parse("2026-11-18T08:00:00Z");
const bench = exerciseCatalogue.find((exercise) => exercise.id === "bench-press")!;
function workout(date = "2026-11-18", weight = 50): Workout {
  return workoutSchema.parse({
    title: "训练", date, status: "completed", startedAt: `${date}T07:00:00Z`, endedAt: `${date}T08:00:00Z`,
    exercises: [{ id: "row", exerciseId: bench.id, restSeconds: 90, snapshot: bench,
      sets: [{ id: "set", type: "normal", weight, reps: 8, completed: true }] }],
  });
}
function record(id: string, data: unknown, kind: StoredRecord["kind"] = "workout"): StoredRecord {
  return { id, kind, data, version: 1, deleted: false, updatedAt: "2026-11-18T08:00:00Z" };
}

test("恢复提示区分短时离开、长时间中断、已暂停及最后完成组", () => {
  const active = { ...workout(), status: "active" as const, endedAt: null };
  active.exercises[0]!.sets[0]!.completedAt = "2026-11-18T07:10:00Z";
  const checkpoint = Date.parse("2026-11-18T07:15:00Z");
  assert.equal(workoutInterruption(active, checkpoint, now - 1000), null);
  assert.deepEqual(workoutInterruption(active, checkpoint, now), {
    cutoff: checkpoint, minutes: 45, lastSetAt: Date.parse("2026-11-18T07:10:00Z"),
  });
  assert.equal(workoutInterruption(toggleWorkoutTimer(active, now), checkpoint, now + 86400000), null);
  assert.equal(workoutDurationSeconds(stopWorkoutTimer(active, checkpoint), now), 900);
});

test("历史目标采用各日生效值，缺少版本的早期记录保留未知", () => {
  const old = profileSchema.parse({ calories: 1900, protein: 100 });
  const profile = trackGoals(old, { ...old, calories: 2300, protein: 160 }, "2026-11-18", "2026-11-17");
  assert.equal(goalsOn(profile, "2026-11-16"), null);
  assert.equal(goalsOn(profile, "2026-11-17")?.calories, 1900);
  assert.equal(goalsOn(profile, "2026-11-18")?.calories, 2300);
});

test("计划周期以应用日为起点，到期后停止推荐，续用不改早期安排", () => {
  const data = planSchema.parse({ name: "训练计划", weeks: 1, schedule: "rotation", rationale: "循环安排", routines: [{
    id: "a", name: "训练", exercises: [{ exerciseId: "bench-press", sets: 2, repsMin: 8, repsMax: 12, weight: 40, restSeconds: 90 }],
  }] });
  const first = { id: "cycle", version: 1, data, updatedAt: "2026-11-10T18:00:00Z" };
  const renewed = { ...first, updatedAt: "2026-11-18T01:00:00Z", history: [first] };
  renewed.history.push({ ...first, updatedAt: renewed.updatedAt });
  assert.equal(planCycle(first, "2026-11-17")?.end, "2026-11-17");
  assert.equal(planOn(renewed, "2026-11-14")?.updatedAt, first.updatedAt);
  assert.equal(planOn(renewed, "2026-11-18")?.updatedAt, renewed.updatedAt);
  assert.equal(recommendInCycle(first, [], "2026-11-18"), null);
});

test("暂停、重启恢复和时长修正沿用累计秒数，完成后时长冻结", () => {
  const active = { ...workout(), status: "active" as const, endedAt: null };
  assert.equal(workoutDurationSeconds(active, now), 3600);
  const paused = toggleWorkoutTimer(active, now);
  assert.equal(workoutDurationSeconds(paused, now + 86400000), 3600);
  const restored = JSON.parse(JSON.stringify(paused)) as Workout;
  const resumed = toggleWorkoutTimer(restored, now + 86400000);
  assert.equal(workoutDurationSeconds(resumed, now + 86405000), 3605);
  const corrected = correctWorkoutDuration(resumed, 1800, now + 86405000);
  assert.equal(workoutDurationSeconds(corrected, now + 86410000), 1805);
  const completed = { ...stopWorkoutTimer(corrected, now + 86410000), status: "completed" as const, endedAt: new Date(now + 86410000).toISOString() };
  assert.equal(workoutDurationSeconds(completed, now + 99999999), 1805);
  assert.equal(workoutDurationSeconds(correctWorkoutDuration(paused, 120, now), now + 50000), 120);
  assert.equal(workoutDurationSeconds({ ...workout(), source: "ai" }), null);
  assert.equal(workoutDurationSeconds(correctWorkoutDuration({ ...workout(), source: "ai" }, 120, now)), 120);
  assert.equal(workoutDurationSeconds(active, Date.parse(active.startedAt) - 1), 0);
});

test("分钟输入支持小数并拒绝特殊数字", () => {
  assert.equal(durationFromMinutes("12.5"), 750);
  assert.equal(durationFromMinutes(".5"), 30);
  for (const value of ["", " ", "-1", "Infinity", "1e3"]) assert.equal(durationFromMinutes(value), null);
});

test("饮食完整标记绑定食物内容，跨客户端增删改后失效，顺序与同步版本不影响确认", () => {
  const food = record("food", dietSchema.parse({ date: "2026-11-18", meal: "lunch", name: "米饭", calories: 300, protein: 10, carbs: 50, fat: 2 }), "diet");
  const marker = { date: "2026-11-18", complete: true, fingerprint: nutritionFingerprint("2026-11-18", [food]) };
  assert.equal(nutritionDayComplete(marker, [{ ...food, version: 99 }]), true);
  assert.equal(nutritionDayComplete(marker, [food, { ...food, id: "another" }]), false);
  assert.equal(nutritionDayComplete(marker, [{ ...food, data: { ...food.data as object, calories: 301 } }]), false);
  assert.equal(nutritionDayComplete(marker, [{ ...food, deleted: true }]), false);
  assert.equal(nutritionDayComplete({ date: marker.date, complete: true }, [food]), false);
  assert.equal(nutritionDayComplete({ ...marker, complete: false }, [food]), false);
  assert.equal(nutritionFingerprint(marker.date, [food, { ...food, id: "a" }]), nutritionFingerprint(marker.date, [{ ...food, id: "a" }, food]));
});
