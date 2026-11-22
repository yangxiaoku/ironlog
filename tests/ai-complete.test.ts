import { test } from "node:test";
import assert from "node:assert/strict";
import { workoutSchema } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { createDemoAiTransport } from "../packages/server/src/ai-demo.js";
import { openDatabase } from "../packages/server/src/db.js";
import { seedWebDemo } from "../packages/server/src/web-demo.js";

test("AI 完整链路：状态接口、JSON 容错、中文排序、全部 5 项演示引擎与训中调整应用", async () => {
  const db = openDatabase(":memory:");
  try {
    // 1. 演示模式 AI 引擎端到端联调
    const { app, auth, store } = createApp(
      db,
      {
        ai: {
          baseUrl: "https://demo.invalid/v1",
          model: "ironlog-demo-coach",
          apiKey: "demo-session",
          mode: "demo",
        },
      },
      createDemoAiTransport(),
    );
    const token = seedWebDemo(store, auth);
    const userId = auth.identify(token);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const statusRes = await app.request("/api/ai/status", { headers });
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      ready: boolean;
      mode: string;
      model: string | null;
      baseUrlHost: string | null;
      capabilities: string[];
    };
    assert.equal(statusJson.ready, true);
    assert.equal(statusJson.mode, "demo");
    assert.equal(statusJson.model, "ironlog-demo-coach");
    assert.equal(statusJson.baseUrlHost, null);
    assert.deepEqual(statusJson.capabilities, ["diet", "workout", "plan", "review", "adapt"]);

    // parse-diet
    const dietRes = await app.request("/api/ai/parse-diet", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "200g 鸡胸肉、一碗米饭、1个鸡蛋", date: "2026-11-20", meal: "lunch" }),
    });
    assert.equal(dietRes.status, 200);
    const { foods } = (await dietRes.json()) as { foods: { name: string; calories: number; protein: number }[] };
    assert.equal(foods.length, 3);
    assert.ok(foods[0]!.protein > 50);

    // parse-workout
    const wkRes = await app.request("/api/ai/parse-workout", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "平板杠铃卧推 80kg 4组x8次", date: "2026-11-20" }),
    });
    assert.equal(wkRes.status, 200);
    const { workout } = (await wkRes.json()) as { workout: { exercises: { exerciseId: string; sets: unknown[] }[] } };
    assert.ok(workout.exercises.length >= 1);
    assert.equal(workout.exercises[0]!.sets.length, 4);

    // review
    const reviewRes = await app.request("/api/ai/review", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "总结最近训练与体重表现" }),
    });
    assert.equal(reviewRes.status, 200);
    const { summary } = (await reviewRes.json()) as { summary: string };
    assert.match(summary, /训练复盘/);
    assert.match(summary, /kcal/);

    // adapt-workout + apply atomic flow
    const activeWorkoutId = "live-adapt-test";
    const activeData = workoutSchema.parse({
      title: "推胸日",
      date: "2026-11-20",
      startedAt: "2026-11-20T07:00:00Z",
      endedAt: null,
      status: "active",
      exercises: [
        {
          id: "row-bench",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [
            { id: "s1", type: "normal", weight: 80, reps: 8, completed: true },
            { id: "s2", type: "normal", weight: 80, reps: 8, completed: false },
            { id: "s3", type: "normal", weight: 80, reps: 8, completed: false },
          ],
        },
      ],
    });
    store.mutate(userId, {
      kind: "workout",
      id: activeWorkoutId,
      opId: "create-live",
      baseVersion: 0,
      deleted: false,
      data: activeData,
    });

    const adaptRes = await app.request("/api/ai/adapt-workout", {
      method: "POST",
      headers,
      body: JSON.stringify({ workoutId: activeWorkoutId, text: "感到疲劳，需要减重" }),
    });
    assert.equal(adaptRes.status, 200);
    const proposal = (await adaptRes.json()) as {
      id: string;
      workoutId: string;
      baseVersion: number;
      changes: { exerciseRowId: string; patch: { weight?: number } }[];
    };
    assert.equal(proposal.changes.length, 1);
    assert.ok((proposal.changes[0]!.patch.weight ?? 80) < 80);

    const applyRes = await app.request("/api/ai/adapt-workout/apply", {
      method: "POST",
      headers,
      body: JSON.stringify({
        workoutId: activeWorkoutId,
        proposal,
        selectedRowIds: [proposal.changes[0]!.exerciseRowId],
      }),
    });
    assert.equal(applyRes.status, 200);
    const applied = (await applyRes.json()) as {
      record: { version: number; data: { exercises: { sets: { completed: boolean; weight: number }[] }[]; adjustments: unknown[] } };
    };
    assert.equal(applied.record.data.exercises[0]!.sets[0]!.completed, true);
    assert.equal(applied.record.data.exercises[0]!.sets[0]!.weight, 80);
    assert.ok(applied.record.data.exercises[0]!.sets[1]!.weight < 80);
    assert.equal(applied.record.data.adjustments.length, 1);

    // Idempotent replay succeeds without duplicating adjustments
    const replayRes = await app.request("/api/ai/adapt-workout/apply", {
      method: "POST",
      headers,
      body: JSON.stringify({
        workoutId: activeWorkoutId,
        proposal,
        selectedRowIds: [proposal.changes[0]!.exerciseRowId],
      }),
    });
    assert.equal(replayRes.status, 200);
    const replayed = (await replayRes.json()) as typeof applied;
    assert.equal(replayed.record.data.adjustments.length, 1);

    // Conflict check if stale proposal with different ID runs against outdated baseVersion
    const staleProposal = { ...proposal, id: "other-proposal" };
    const conflictRes = await app.request("/api/ai/adapt-workout/apply", {
      method: "POST",
      headers,
      body: JSON.stringify({
        workoutId: activeWorkoutId,
        proposal: staleProposal,
        selectedRowIds: [proposal.changes[0]!.exerciseRowId],
      }),
    });
    assert.equal(conflictRes.status, 409);
  } finally {
    db.close();
  }
});

test("AI 响应兼容 Markdown 代码块包裹与未配置状态返回", async () => {
  const db = openDatabase(":memory:");
  try {
    const fencedTransport: typeof fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content:
                '以下是建议：\n```json\n{"summary":"近 7 天训练节奏稳定，蛋白质达标率较高。"}\n```',
            },
          },
        ],
      });
    const liveApp = createApp(
      db,
      {
        ai: {
          baseUrl: "https://api.example.com/v1",
          model: "custom-model",
          apiKey: "secret-key",
          mode: "live",
        },
      },
      fencedTransport,
    );
    const user = liveApp.auth.login("fenced-user");
    const headers = { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" };

    const status = (await (await liveApp.app.request("/api/ai/status", { headers })).json()) as {
      ready: boolean;
      mode: string;
      baseUrlHost: string | null;
      model: string;
    };
    assert.equal(status.ready, true);
    assert.equal(status.mode, "live");
    assert.equal(status.baseUrlHost, "api.example.com");
    assert.equal(JSON.stringify(status).includes("secret-key"), false);

    const review = await liveApp.app.request("/api/ai/review", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "总结表现" }),
    });
    assert.equal(review.status, 200);
    assert.match(((await review.json()) as { summary: string }).summary, /蛋白质达标/);

    // Unconfigured fallback preserves explicit unconfigured state
    const bare = createApp(db);
    const bareUser = bare.auth.login("bare-user");
    const bareStatus = (await (
      await bare.app.request("/api/ai/status", { headers: { Authorization: `Bearer ${bareUser.token}` } })
    ).json()) as { ready: boolean; mode: string; model: null; baseUrlHost: null };
    assert.deepEqual(bareStatus, {
      ready: false,
      mode: "unconfigured",
      model: null,
      baseUrlHost: null,
      inputModes: ["text"],
      capabilities: ["diet", "workout", "plan", "review", "adapt"],
    });
  } finally {
    db.close();
  }
});
