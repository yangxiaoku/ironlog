import test from "node:test";
import assert from "node:assert/strict";
import {
  MEASUREMENT_SPECS,
  estimated1RM,
  shiftDateStr,
  summarizeWorkoutRecord,
  workoutSeconds,
  type WorkoutData,
} from "../packages/web/src/lib/domain.ts";

test("packages/web/src/lib domain helpers compute workout tonnage, e1RM, duration, and measurement specs", () => {
  assert.equal(shiftDateStr("2026-11-22", -1), "2026-11-21");
  assert.equal(shiftDateStr("2026-11-30", 1), "2026-12-01");

  assert.equal(estimated1RM(100, 1), 100);
  assert.equal(estimated1RM(100, 30), 200);
  assert.equal(estimated1RM(0, 8), 0);

  const sample: WorkoutData = {
    title: "推胸日",
    date: "2026-11-22",
    startedAt: "2026-11-22T09:00:00.000Z",
    endedAt: "2026-11-22T09:45:00.000Z",
    status: "completed",
    timing: { elapsedSeconds: 2400, runningSince: null },
    exercises: [
      {
        id: "ex1",
        exerciseId: "bench-press",
        restSeconds: 90,
        snapshot: {
          name: "杠铃卧推",
          muscle: "chest",
          equipment: "barbell",
          mode: "reps",
          volumeMultiplier: 1,
        },
        sets: [
          { id: "s1", type: "warmup", weight: 40, reps: 8, seconds: 0, completed: true, rir: null },
          { id: "s2", type: "normal", weight: 80, reps: 8, seconds: 0, completed: true, rir: 2 },
          { id: "s3", type: "normal", weight: 80, reps: 8, seconds: 0, completed: false, rir: null },
        ],
      },
    ],
  };

  const summary = summarizeWorkoutRecord(sample);
  assert.deepEqual(summary, { sets: 1, volume: 640 });
  assert.equal(workoutSeconds(sample), 2400);
  assert.equal(MEASUREMENT_SPECS.length, 5);
});
