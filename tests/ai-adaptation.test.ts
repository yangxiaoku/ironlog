import { test } from "node:test";
import assert from "node:assert/strict";
import { workoutSchema } from "@ironlog/shared";
import type { Workout, WorkoutAdaptation } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";

function fixture() {
  const db = openDatabase(":memory:");
  const prompts: string[] = [];
  let answer: unknown = {
    summary: "减少余下训练量",
    changes: [
      {
        exerciseRowId: "bench",
        reason: "按剩余时间保留一组",
        patch: { weight: 60, remainingSets: 1 },
      },
    ],
  };
  let transition: (() => void) | undefined;
  const fake: typeof fetch = async (_url, options) => {
    prompts.push(String(options?.body));
    transition?.();
    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) } }],
    });
  };
  const app = createApp(
    db,
    {
      ai: {
        baseUrl: "https://model.example/v1",
        model: "test",
        apiKey: "private-test-key",
      },
    },
    fake,
  );
  const user = app.auth.login("workout-owner");
  const other = app.auth.login("other-person");
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
          { id: "done", type: "normal", weight: 80, reps: 8, completed: true },
          { id: "open", type: "normal", weight: 80, reps: 8, completed: false },
        ],
      },
      {
        id: "finished-row",
        exerciseId: "squat",
        restSeconds: 90,
        sets: [
          {
            id: "squat-done",
            type: "normal",
            weight: 60,
            reps: 8,
            completed: true,
          },
        ],
      },
    ],
  });
  app.store.mutate(user.userId, {
    kind: "workout",
    id: "workout",
    opId: "start",
    baseVersion: 0,
    deleted: false,
    data: workout,
  });
  const request = (token = user.token) =>
    app.app.request("/api/ai/adapt-workout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workoutId: "workout",
        text: "只剩20分钟，请调整剩余组",
      }),
    });
  function edit(mutator: (value: Workout) => void) {
    const record = app.store.get(user.userId, "workout", "workout")!;
    const data = record.data as Workout;
    mutator(data);
    app.store.mutate(user.userId, {
      kind: "workout",
      id: "workout",
      opId: `edit_${record.version}`,
      baseVersion: record.version,
      deleted: false,
      data,
    });
  }
  return {
    ...app,
    db,
    prompts,
    user,
    other,
    request,
    edit,
    answer: (value: unknown) => {
      answer = value;
    },
    duringRequest: (callback: () => void) => {
      transition = callback;
    },
  };
}

test("AI训练调整返回可确认的基准和修改项，实际完成内容保留原记录", async () => {
  const f = fixture();
  try {
    const before = structuredClone(
      f.store.get(f.user.userId, "workout", "workout"),
    );
    const response = await f.request();
    assert.equal(response.status, 200);
    const proposal = (await response.json()) as WorkoutAdaptation;
    assert.equal(proposal.workoutId, "workout");
    assert.equal(proposal.baseVersion, 1);
    assert.equal(proposal.changes[0]?.before.openSets.length, 1);
    assert.equal(proposal.changes[0]?.before.openSets[0]?.id, "open");
    assert.equal(proposal.changes[0]?.patch.weight, 60);
    assert.deepEqual(f.store.get(f.user.userId, "workout", "workout"), before);
    assert.ok(
      f.prompts.every(
        (prompt) =>
          !prompt.includes(f.user.userId) &&
          !prompt.includes(f.user.token) &&
          !prompt.includes("private-test-key"),
      ),
    );
  } finally {
    f.db.close();
  }
});

test("训练调整按用户隔离，针对已完成动作和重复动作的模型输出被拒绝", async () => {
  const f = fixture();
  try {
    assert.equal((await f.request(f.other.token)).status, 404);
    assert.equal(f.prompts.length, 0);
    f.answer({
      summary: "调整",
      changes: [
        {
          exerciseRowId: "finished-row",
          reason: "修改",
          patch: { weight: 40 },
        },
      ],
    });
    assert.equal((await f.request()).status, 503);
    f.answer({
      summary: "调整",
      changes: Array.from({ length: 2 }, () => ({
        exerciseRowId: "bench",
        reason: "减少训练",
        patch: { weight: 60 },
      })),
    });
    assert.equal((await f.request()).status, 503);
    assert.equal(f.store.get(f.user.userId, "workout", "workout")?.version, 1);
  } finally {
    f.db.close();
  }
});

test("模型处理中目标组被完成时返回冲突，其他动作的修改仍然兼容", async () => {
  const f = fixture();
  try {
    f.duringRequest(() =>
      f.edit((workout) => {
        workout.exercises[0]!.sets[1]!.completed = true;
      }),
    );
    const stale = await f.request();
    assert.equal(stale.status, 409);
    assert.equal(
      (f.store.get(f.user.userId, "workout", "workout")?.data as Workout)
        .exercises[0]?.sets[1]?.completed,
      true,
    );
  } finally {
    f.db.close();
  }
  const other = fixture();
  try {
    other.duringRequest(() =>
      other.edit((workout) => {
        workout.exercises[1]!.sets[0]!.weight = 55;
      }),
    );
    const response = await other.request();
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as WorkoutAdaptation).baseVersion, 2);
  } finally {
    other.db.close();
  }
});

test("训练结束后停止生成调整，并允许模型说明当前安排无需变化", async () => {
  const f = fixture();
  try {
    f.answer({
      summary: "当前安排已经符合剩余时间，可以按原计划继续。",
      changes: [],
    });
    const unchanged = await f.request();
    assert.equal(unchanged.status, 200);
    assert.equal(
      ((await unchanged.json()) as WorkoutAdaptation).changes.length,
      0,
    );
    f.edit((workout) => {
      workout.status = "completed";
      workout.endedAt = "2026-11-14T02:00:00Z";
    });
    assert.equal((await f.request()).status, 409);
    assert.equal(f.prompts.length, 1);
  } finally {
    f.db.close();
  }
});
