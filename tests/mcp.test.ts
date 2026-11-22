import { test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";

test("真实MCP客户端连接、列工具、查询上下文与创建应用计划", async () => {
  const db = openDatabase(":memory:");
  const { app, auth, store } = createApp(db);
  const session = auth.login("mcp-test");
  let ready: (port: number) => void;
  const started = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const http = serve(
    { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
    (info) => ready(info.port),
  );
  const port = await started;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["packages/mcp/dist/index.js"],
    cwd: process.cwd(),
    env: {
      IRONLOG_URL: `http://127.0.0.1:${port}`,
      IRONLOG_TOKEN: session.token,
    },
  });
  const client = new Client({
    name: "ironlog-integration-test",
    version: "1.0.0",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 8);
    const searched = await client.callTool({
      name: "list_exercises",
      arguments: { q: "酒杯 深蹲" },
    });
    assert.equal(searched.isError, undefined);
    const exerciseContent = searched.content as {
      type: string;
      text: string;
    }[];
    const exercises = JSON.parse(exerciseContent[0]!.text) as {
      id: string;
      name: string;
    }[];
    assert.equal(exercises[0]?.id, "exdb_1760");
    assert.equal(exercises[0]?.name, "哑铃高脚杯深蹲");
    const context = await client.callTool({
      name: "get_training_context",
      arguments: {},
    });
    assert.equal(context.isError, undefined);
    const plan = {
      name: "Agent计划",
      weeks: 4,
      schedule: "rotation",
      rationale: "根据每周三天安排",
      routines: [
        {
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
        },
      ],
    };
    const draft = await client.callTool({
      name: "create_plan_draft",
      arguments: { plan },
    });
    assert.equal(draft.isError, undefined);
    const content = draft.content as { type: string; text: string }[];
    const saved = JSON.parse(content[0]!.text) as {
      record: { id: string; version: number };
    };
    const applied = await client.callTool({
      name: "apply_plan",
      arguments: { ...saved.record, expectedRevision: 0 },
    });
    assert.equal(applied.isError, undefined);
    assert.equal(store.activePlan(session.userId)?.data.name, "Agent计划");
    const invalid = await client.callTool({
      name: "create_plan_draft",
      arguments: {
        plan: {
          ...plan,
          routines: [
            {
              id: "a",
              name: "未知",
              exercises: [
                { ...plan.routines[0]!.exercises[0], exerciseId: "unknown" },
              ],
            },
          ],
        },
      },
    });
    assert.equal(invalid.isError, true);
    const workout = {
      title: "Agent补录",
      date: "2026-11-14",
      startedAt: "2026-11-14T09:00:00Z",
      endedAt: "2026-11-14T10:00:00Z",
      status: "completed",
      exercises: [
        {
          id: "row",
          exerciseId: "bench-press",
          restSeconds: 90,
          sets: [
            { id: "set", type: "normal", weight: 40, reps: 8, completed: true },
          ],
        },
      ],
    };
    const arguments_ = {
      recordId: "agent-workout",
      operationId: "agent-operation",
      workout,
    };
    const logged = await client.callTool({
      name: "log_workout",
      arguments: arguments_,
    });
    assert.equal(logged.isError, undefined);
    const retried = await client.callTool({
      name: "log_workout",
      arguments: arguments_,
    });
    assert.equal(retried.isError, undefined);
    const workouts = store.list(session.userId, "workout");
    assert.equal(workouts.length, 1);
    assert.equal((workouts[0]!.data as { source: string }).source, "agent");
  } finally {
    await client.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    db.close();
  }
});
