import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workoutSchema,
  workoutAdaptationSchema,
  exerciseCatalogue,
  unfinishedSets,
  applyWorkoutAdaptation,
  exerciseSnapshot,
} from "@ironlog/shared";
import type { Workout, WorkoutAdaptation } from "@ironlog/shared";

function fixture() {
  const workout = workoutSchema.parse({
    title: "推胸日",
    date: "2026-11-14",
    startedAt: "2026-11-14T01:00:00Z",
    endedAt: null,
    status: "active",
    exercises: [
      {
        id: "bench",
        exerciseId: "bench-press",
        restSeconds: 90,
        sets: [
          {
            id: "open_a",
            type: "normal",
            weight: 80,
            reps: 8,
            completed: false,
          },
          {
            id: "finished",
            type: "normal",
            weight: 80,
            reps: 8,
            completed: true,
            rir: 2,
          },
          {
            id: "open_b",
            type: "normal",
            weight: 80,
            reps: 8,
            completed: false,
          },
        ],
      },
    ],
  });
  let serial = 0;
  const createId = () => `new_${++serial}`;
  const proposal = (patch: WorkoutAdaptation["changes"][number]["patch"]) =>
    workoutAdaptationSchema.parse({
      id: "proposal",
      workoutId: "workout",
      baseVersion: 1,
      createdAt: "2026-11-14T01:10:00Z",
      summary: "调整剩余训练",
      changes: [
        {
          exerciseRowId: "bench",
          reason: "按今天的时间与器械调整",
          patch,
          before: {
            exerciseId: "bench-press",
            restSeconds: 90,
            openSets: unfinishedSets(workout.exercises[0]!),
          },
        },
      ],
    });
  return { workout, proposal, createId };
}

test("调整剩余重量和休息时保持完成组数值与位置，原对象不受修改", () => {
  const { workout, proposal, createId } = fixture();
  const original = structuredClone(workout);
  const result = applyWorkoutAdaptation(
    workout,
    proposal({ weight: 60, restSeconds: 120 }),
    ["bench"],
    exerciseCatalogue,
    createId,
  );
  assert.deepEqual(
    result.exercises[0]!.sets.map((set) => set.id),
    ["open_a", "finished", "open_b"],
  );
  assert.deepEqual(
    result.exercises[0]!.sets[1],
    original.exercises[0]!.sets[1],
  );
  assert.equal(result.exercises[0]!.sets[0]?.weight, 60);
  assert.equal(result.exercises[0]!.restSeconds, 120);
  assert.equal(
    result.adjustments[0]?.changes[0]?.before.openSets[0]?.weight,
    80,
  );
  assert.deepEqual(workout, original);
});

test("部分完成后替换动作，原动作保留完成组，新动作接续剩余组", () => {
  const { workout, proposal, createId } = fixture();
  const result = applyWorkoutAdaptation(
    workout,
    proposal({ exerciseId: "incline-dumbbell", weight: 20, reps: 10 }),
    ["bench"],
    exerciseCatalogue,
    createId,
  );
  assert.equal(result.exercises.length, 2);
  assert.equal(result.exercises[0]?.exerciseId, "bench-press");
  assert.deepEqual(result.exercises[0]?.sets, [workout.exercises[0]!.sets[1]]);
  assert.equal(result.exercises[1]?.exerciseId, "incline-dumbbell");
  assert.equal(result.exercises[1]?.snapshot?.volumeMultiplier, 2);
  assert.deepEqual(
    result.exercises[1]?.sets.map((set) => set.id),
    ["open_a", "open_b"],
  );
  assert.ok(
    result.exercises[1]?.sets.every(
      (set) => !set.completed && set.weight === 20,
    ),
  );
});

test("过时调整与重复动作调整整体拒绝，其他动作进度可继续保留", () => {
  const { workout, proposal, createId } = fixture();
  const pending = proposal({ weight: 60 });
  workout.exercises[0]!.sets[0]!.completed = true;
  const before = structuredClone(workout);
  assert.throws(
    () =>
      applyWorkoutAdaptation(
        workout,
        pending,
        ["bench"],
        exerciseCatalogue,
        createId,
      ),
    /已变化/,
  );
  assert.deepEqual(workout, before);
  const other = fixture();
  const duplicate = other.proposal({ weight: 60 });
  duplicate.changes.push(duplicate.changes[0]!);
  assert.throws(
    () =>
      applyWorkoutAdaptation(
        other.workout,
        duplicate,
        ["bench"],
        exerciseCatalogue,
        createId,
      ),
    /重复/,
  );
});

test("跳过剩余组保留完成记录，增加新组生成独立ID并清空实际用力反馈", () => {
  const { workout, proposal, createId } = fixture();
  const skipped = applyWorkoutAdaptation(
    workout,
    proposal({ remainingSets: 0 }),
    ["bench"],
    exerciseCatalogue,
    createId,
  );
  assert.deepEqual(
    skipped.exercises[0]?.sets.map((set) => set.id),
    ["finished"],
  );
  const extra = applyWorkoutAdaptation(
    workout,
    proposal({ remainingSets: 3 }),
    ["bench"],
    exerciseCatalogue,
    createId,
  );
  assert.equal(extra.exercises[0]?.sets.length, 4);
  assert.equal(extra.exercises[0]?.sets[3]?.rir, null);
  assert.equal(new Set(extra.exercises[0]?.sets.map((set) => set.id)).size, 4);
});

test("建议按选择项应用，重复提交保持同一调整记录，结束训练后拒绝新建议", () => {
  const { workout, proposal, createId } = fixture();
  const pending = proposal({ weight: 60 });
  const other = structuredClone(workout.exercises[0]!);
  other.id = "other";
  other.sets = other.sets.map((set) => ({ ...set, id: `other_${set.id}` }));
  workout.exercises.push(other);
  pending.changes.push({
    ...pending.changes[0]!,
    exerciseRowId: "other",
    before: {
      exerciseId: other.exerciseId,
      restSeconds: other.restSeconds,
      openSets: unfinishedSets(other),
    },
  });
  const result = applyWorkoutAdaptation(
    workout,
    pending,
    ["bench"],
    exerciseCatalogue,
    createId,
  );
  assert.deepEqual(result.exercises[1], other);
  assert.equal(result.adjustments[0]?.changes.length, 1);
  assert.deepEqual(
    applyWorkoutAdaptation(
      result,
      pending,
      ["bench"],
      exerciseCatalogue,
      createId,
    ),
    result,
  );
  workout.status = "completed";
  assert.throws(
    () =>
      applyWorkoutAdaptation(
        workout,
        pending,
        ["bench"],
        exerciseCatalogue,
        createId,
      ),
    /已结束/,
  );
});

test("训练调整沿用会话保存的动作口径，动作归档后仍可修改剩余重量", () => {
  const { workout, proposal, createId } = fixture();
  const snapshot = exerciseSnapshot(
    exerciseCatalogue.find((exercise) => exercise.id === "bench-press")!,
  );
  workout.exercises[0]!.snapshot = snapshot;
  const pending = proposal({ weight: 60 });
  pending.changes[0]!.before.snapshot = {
    volumeMultiplier: snapshot.volumeMultiplier,
    mode: snapshot.mode,
    equipment: snapshot.equipment,
    muscle: snapshot.muscle,
    name: snapshot.name,
  };
  const result = applyWorkoutAdaptation(
    workout,
    pending,
    ["bench"],
    [],
    createId,
  );
  assert.equal(result.exercises[0]?.sets[0]?.weight, 60);
  assert.equal(result.exercises[0]?.snapshot?.mode, "reps");
});

test("建议生成后改变重量计算口径时需要重新获取建议", () => {
  const { workout, proposal, createId } = fixture();
  workout.exercises[0]!.snapshot = exerciseSnapshot(
    exerciseCatalogue.find((exercise) => exercise.id === "bench-press")!,
  );
  const pending = proposal({ weight: 60 });
  pending.changes[0]!.before.snapshot = structuredClone(
    workout.exercises[0]!.snapshot,
  );
  workout.exercises[0]!.snapshot!.volumeMultiplier = 2;
  assert.throws(
    () =>
      applyWorkoutAdaptation(
        workout,
        pending,
        ["bench"],
        exerciseCatalogue,
        createId,
      ),
    /已变化/,
  );
});

test("未知动作、缺少替换重量和无有效时间的计时替换给出错误", () => {
  const { workout, proposal, createId } = fixture();
  assert.throws(
    () =>
      applyWorkoutAdaptation(
        workout,
        proposal({ exerciseId: "unknown", weight: 20 }),
        ["bench"],
        exerciseCatalogue,
        createId,
      ),
    /不可用/,
  );
  assert.throws(
    () =>
      applyWorkoutAdaptation(
        workout,
        proposal({ exerciseId: "incline-dumbbell" }),
        ["bench"],
        exerciseCatalogue,
        createId,
      ),
    /明确新的重量/,
  );
  assert.throws(
    () =>
      applyWorkoutAdaptation(
        workout,
        proposal({ exerciseId: "plank", weight: 0 }),
        ["bench"],
        exerciseCatalogue,
        createId,
      ),
    /持续时间/,
  );
});
