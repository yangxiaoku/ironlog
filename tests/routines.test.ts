import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planSchema,
  routineSchema,
  workoutSchema,
  recommendRoutine,
  routineTargets,
  nextTarget,
  compareWorkouts,
  workoutMetrics,
  exerciseCatalogue,
} from "@ironlog/shared";

const routine = routineSchema.parse({
  id: "a",
  name: "推",
  exercises: [
    {
      exerciseId: "bench-press",
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      weight: 40,
      restSeconds: 90,
    },
  ],
});
const plan = planSchema.parse({
  name: "推拉腿",
  weeks: 4,
  schedule: "rotation",
  rationale: "轮换安排",
  routines: [
    routine,
    { ...routine, id: "b", name: "拉" },
    { ...routine, id: "c", name: "腿" },
  ],
});
function workout(
  routineId = "a",
  status: "active" | "completed" | "cancelled" = "completed",
  date = "2026-11-09",
) {
  return workoutSchema.parse({
    title: routineId,
    date,
    startedAt: `${date}T01:00:00Z`,
    endedAt: status === "active" ? null : `${date}T02:00:00Z`,
    status,
    planId: "plan",
    planVersion: 1,
    routineId,
    targetSnapshot: routine,
    exercises: [
      {
        id: "row",
        exerciseId: "bench-press",
        targetIndex: 0,
        restSeconds: 90,
        sets: Array.from({ length: 3 }, (_, index) => ({
          id: `set_${index}`,
          type: "normal",
          weight: 40,
          reps: 12,
          completed: true,
          rir: 2,
        })),
      },
    ],
  });
}

test("轮换按实际完成的训练接续，进行中、取消和未来记录保留原安排", () => {
  assert.equal(
    recommendRoutine("plan", plan, [], "2026-11-14")?.routine.id,
    "a",
  );
  const records = [
    workout("a"),
    workout("b", "completed", "2026-11-11"),
    workout("c", "cancelled", "2026-11-12"),
    workout("c", "active", "2026-11-14"),
    workout("c", "completed", "2026-11-15"),
  ];
  assert.equal(
    recommendRoutine("plan", plan, records, "2026-11-14")?.routine.id,
    "c",
  );
  records.push(workout("c", "completed", "2026-11-14"));
  assert.equal(
    recommendRoutine("plan", plan, records, "2026-11-14")?.routine.id,
    "a",
  );
  assert.equal(
    recommendRoutine("other-plan", plan, records, "2026-11-14")?.routine.id,
    "a",
  );
});

test("每周安排支持休息日、已完成当天、乱序星期和跨年", () => {
  const weekly = {
    ...plan,
    schedule: "weekdays" as const,
    weekdays: [5, 1, 3],
  };
  const today = recommendRoutine("plan", weekly, [], "2026-11-09");
  assert.equal(today?.routine.id, "b");
  assert.equal(today?.date, "2026-11-09");
  const next = recommendRoutine("plan", weekly, [workout("b")], "2026-11-09");
  assert.equal(next?.routine.id, "c");
  assert.equal(next?.date, "2026-11-11");
  assert.equal(
    recommendRoutine("plan", weekly, [], "2026-11-14")?.date,
    "2026-11-16",
  );
  const monday = { ...weekly, weekdays: [1], routines: [routine] };
  assert.equal(
    recommendRoutine("plan", monday, [], "2026-12-31")?.date,
    "2027-01-04",
  );
});

test("新计划和修改后的明确重量生效，已有同一训练的递增可接续", () => {
  const previous = workout();
  previous.exercises[0]!.sets.forEach((set) => {
    set.weight = 80;
  });
  assert.equal(
    routineTargets(routine, [previous], "new-plan", "2026-11-14")[0]?.weight,
    40,
  );
  assert.equal(
    routineTargets(routine, [previous], "plan", "2026-11-14")[0]?.weight,
    82.5,
  );
  const lighter = {
    ...routine,
    exercises: [{ ...routine.exercises[0]!, weight: 50 }],
  };
  assert.equal(
    routineTargets(lighter, [previous], "plan", "2026-11-14")[0]?.weight,
    50,
  );
});

test("首用模板参考其他训练的历史重量，递增使用同一模板的完成情况", () => {
  const previous = workout();
  previous.planId = null;
  previous.routineId = "other-routine";
  previous.exercises[0]!.sets.forEach((set) => {
    set.weight = 60;
  });
  const automatic = {
    ...routine,
    exercises: [{ ...routine.exercises[0]!, weight: null }],
  };
  assert.equal(
    routineTargets(automatic, [previous], null, "2026-11-14")[0]?.weight,
    60,
  );
  previous.routineId = routine.id;
  assert.equal(
    routineTargets(automatic, [previous], null, "2026-11-14")[0]?.weight,
    62.5,
  );
  previous.exercises[0]!.sets[2]!.completed = false;
  assert.equal(
    routineTargets(automatic, [previous], null, "2026-11-14")[0]?.weight,
    60,
  );
});

test("重复动作保留各自的目标位置，调整顺序后仍可查找对应历史", () => {
  const repeated = {
    ...routine,
    exercises: [
      routine.exercises[0]!,
      { ...routine.exercises[0]!, weight: 20 },
    ],
  };
  const previous = workout();
  previous.targetSnapshot = repeated;
  previous.exercises.push({
    ...previous.exercises[0]!,
    id: "second",
    targetIndex: 1,
    sets: previous.exercises[0]!.sets.map((set, index) => ({
      ...set,
      id: `second_${index}`,
      weight: 20,
    })),
  });
  previous.exercises.reverse();
  const targets = routineTargets(repeated, [previous], "plan", "2026-11-14");
  assert.equal(targets[0]?.weight, 42.5);
  assert.equal(targets[1]?.weight, 22.5);
});

test("辅助动作达标后减少辅助量，归零后保留次数进度", () => {
  const previous = workout();
  const row = previous.exercises[0]!;
  const exercise = { ...exerciseCatalogue.find((item) => item.id === row.exerciseId)!, mode: "assisted" as const };
  row.snapshot = exercise;
  const item = routine.exercises[0]!;
  const select = () => routineTargets(routine, [previous], "plan", "2026-11-14", [exercise])[0];
  assert.deepEqual(select(), { weight: 37.5, reps: 8, increased: true });
  row.sets.forEach((set) => { set.weight = 1; });
  assert.deepEqual(select(), { weight: 0, reps: 8, increased: true });
  row.sets.forEach((set) => { set.weight = 0; });
  assert.deepEqual(select(), { weight: 0, reps: 12, increased: false });
  row.sets.forEach((set) => { set.weight = 10; });
  row.sets[0]!.reps = 0;
  assert.deepEqual(select(), { weight: 10, reps: 12, increased: false });
  row.sets[0]!.weight = 20;
  row.sets[0]!.reps = 12;
  assert.deepEqual(select(), { weight: 10, reps: 12, increased: false });
  row.sets[0]!.weight = 10;
  row.snapshot = null;
  assert.deepEqual(select(), { weight: 7.5, reps: 8, increased: true });
  row.snapshot = { ...exercise, mode: "reps" };
  assert.deepEqual(select(), { weight: 40, reps: 8, increased: false });
  assert.deepEqual(nextTarget({ ...item, progression: "linear" }, row, "assisted"),
    { weight: 7.5, reps: 8, increased: true });
});

test("训练时间比较支持不同的小数秒格式", () => {
  const base = workout();
  assert.ok(
    workoutSchema.safeParse({
      ...base,
      startedAt: "2026-11-09T01:00:00Z",
      endedAt: "2026-11-09T01:00:00.000Z",
    }).success,
  );
  assert.equal(
    workoutSchema.safeParse({
      ...base,
      startedAt: "2026-11-09T01:00:00.100Z",
      endedAt: "2026-11-09T01:00:00Z",
    }).success,
    false,
  );
});

test("补录以训练日期接续轮换与递增，零次尝试不会产生重量纪录", () => {
  const older = workout("a", "completed", "2026-11-08");
  older.startedAt = "2026-11-14T01:00:00Z";
  older.endedAt = "2026-11-14T02:00:00Z";
  older.exercises[0]!.sets.forEach((set) => {
    set.weight = 100;
  });
  const recent = workout("b", "completed", "2026-11-11");
  assert.ok(compareWorkouts(older, recent) < 0);
  assert.equal(
    recommendRoutine("plan", plan, [recent, older], "2026-11-14")?.routine.id,
    "c",
  );
  const sameRoutine = workout("a", "completed", "2026-11-12");
  assert.equal(
    routineTargets(routine, [older, sameRoutine], "plan", "2026-11-14")[0]
      ?.weight,
    42.5,
  );
  const attempt = workout();
  attempt.exercises[0]!.sets.forEach((set) => {
    set.reps = 0;
    set.weight = 200;
  });
  const metrics = workoutMetrics(attempt, exerciseCatalogue);
  assert.equal(metrics.volume, 0);
  assert.equal(metrics.best["bench-press"], undefined);
});
