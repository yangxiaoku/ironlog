import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";

test("AI饮食只返回待确认项，计划保存草稿，模型密钥保留在后端", async () => {
  const db = openDatabase(":memory:");
  const prompts: string[] = [];
  const fake: typeof fetch = async (_url, options) => {
    prompts.push(String(options?.body));
    const payload = JSON.parse(String(options?.body));
    const system = payload.messages[0].content as string;
    const content = system.includes("饮食记录助手")
      ? {
          foods: [
            {
              name: "鸡胸肉 200g",
              calories: 330,
              protein: 62,
              carbs: 0,
              fat: 7,
            },
          ],
        }
      : {
          name: "AI三日计划",
          weeks: 4,
          schedule: "rotation",
          rationale: "近28天没有训练记录，先建立基础计划。",
          routines: [
            {
              id: "a",
              name: "全身",
              exercises: [
                {
                  exerciseId: "squat",
                  sets: 3,
                  repsMin: 8,
                  repsMax: 12,
                  weight: null,
                  restSeconds: 120,
                },
              ],
            },
          ],
        };
    return Response.json({
      choices: [{ message: { content: JSON.stringify(content) } }],
    });
  };
  const { app, auth, store } = createApp(
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
  const user = auth.login("ai-test");
  const headers = {
    Authorization: `Bearer ${user.token}`,
    "Content-Type": "application/json",
  };
  try {
    const diet = await app.request("/api/ai/parse-diet", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "午餐200克鸡胸肉" }),
    });
    assert.equal(diet.status, 200);
    assert.equal(store.list(user.userId, "diet").length, 0);
    const plan = await app.request("/api/ai/plan", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "每周三天，每次45分钟" }),
    });
    assert.equal(plan.status, 201);
    assert.equal(store.list(user.userId, "plan").length, 1);
    assert.equal(store.activePlan(user.userId), null);
    assert.ok(
      prompts.every(
        (prompt) =>
          !prompt.includes("private-test-key") &&
          !prompt.includes(user.token) &&
          !prompt.includes(user.userId),
      ),
    );
  } finally {
    db.close();
  }
});

test("AI结构错误返回可重试提示并保留已有计划", async () => {
  const db = openDatabase(":memory:");
  const invalid: typeof fetch = async () =>
    Response.json({
      choices: [{ message: { content: '{"name":"缺少动作"}' } }],
    });
  const { app, auth, store } = createApp(
    db,
    {
      ai: {
        baseUrl: "https://model.example/v1",
        model: "test",
        apiKey: "test",
      },
    },
    invalid,
  );
  const user = auth.login("invalid-ai");
  try {
    const response = await app.request("/api/ai/plan", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "制定计划" }),
    });
    assert.equal(response.status, 503);
    assert.equal(store.list(user.userId, "plan").length, 0);
    assert.match(((await response.json()) as { error: string }).error, /校验/);
  } finally {
    db.close();
  }
});
