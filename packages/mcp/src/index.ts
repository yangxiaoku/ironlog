import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { planSchema, workoutSchema } from "@ironlog/shared";

const pendingDraftOpIds = new Map<string, string>();

const baseUrl = process.env.IRONLOG_URL ?? "http://127.0.0.1:8080";
const token = process.env.IRONLOG_TOKEN;
if (!token) throw new Error("请设置 IRONLOG_TOKEN");
const server = new McpServer({ name: "ironlog", version: "0.1.0" });
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  // #129: Handle non-JSON error pages (e.g., 502 Bad Gateway HTML) gracefully without uncaught SyntaxError.
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  let parsed: unknown = null;
  if (text.trim()) {
    if (contentType.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
  }
  if (!response.ok) {
    const err = Object.assign(
      new Error(
        parsed != null
          ? JSON.stringify(parsed)
          : `HTTP ${response.status}: ${text.slice(0, 200) || response.statusText}`,
      ),
      { status: response.status },
    );
    throw err;
  }
  return { content: [{ type: "text" as const, text: parsed != null ? JSON.stringify(parsed) : text }] };
}
server.registerTool(
  "get_training_context",
  {
    description: "读取本人近28天训练、每日营养、体重、目标和当前计划",
    inputSchema: {},
  },
  () => request("/api/context"),
);
server.registerTool(
  "list_exercises",
  {
    description: "按名称、肌群、器械和动作类型分页查找动作与教学。使用 offset 继续查询",
    inputSchema: {
      q: z.string().optional(),
      muscle: z.string().optional(),
      equipment: z.string().optional(),
      category: z.string().optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(30),
    },
  },
  (input) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value));
    return request(`/api/exercises?${query}`);
  },
);
server.registerTool(
  "get_active_plan",
  { description: "获取当前应用的训练计划和修订号", inputSchema: {} },
  () => request("/api/plans/active"),
);
server.registerTool(
  "create_plan_draft",
  {
    description: "创建可在手机预览的计划草稿，source 使用 agent；重试时可复用 operationId 防止重复创建",
    inputSchema: {
      plan: planSchema,
      operationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
    },
  },
  async ({ plan, operationId }) => {
    const payload = { ...plan, source: "agent" as const };
    if (operationId) {
      return request("/api/plans/drafts", "POST", { ...payload, opId: operationId });
    }
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    let opId = pendingDraftOpIds.get(fingerprint);
    if (!opId) {
      opId = `mcp_draft_${randomUUID()}`;
      pendingDraftOpIds.set(fingerprint, opId);
    }
    try {
      const res = await request("/api/plans/drafts", "POST", { ...payload, opId });
      pendingDraftOpIds.delete(fingerprint);
      return res;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status != null && status >= 400 && status < 500) {
        pendingDraftOpIds.delete(fingerprint);
      }
      throw err;
    }
  },
);
server.registerTool(
  "revise_plan_draft",
  {
    description: "以已有版本为基准修改计划草稿，需要附上完整计划及调整原因",
    inputSchema: {
      id: z.string(),
      baseVersion: z.number().int().positive(),
      operationId: z.string(),
      plan: planSchema,
    },
  },
  ({ id, baseVersion, operationId, plan }) =>
    request("/api/records", "POST", {
      opId: operationId,
      id,
      kind: "plan",
      baseVersion,
      deleted: false,
      data: { ...plan, source: "agent" },
    }),
);
server.registerTool(
  "apply_plan",
  {
    description:
      "应用已预览的计划版本，expectedRevision 来自 get_active_plan，无当前计划时使用0",
    inputSchema: {
      id: z.string(),
      version: z.number().int().positive(),
      expectedRevision: z.number().int().min(0),
    },
  },
  (input) => request("/api/plans/apply", "POST", input),
);
server.registerTool(
  "log_workout",
  {
    description: "写入本人训练记录，recordId 和 operationId 应在重试时复用",
    inputSchema: {
      recordId: z.string(),
      operationId: z.string(),
      baseVersion: z.number().int().min(0).default(0),
      workout: workoutSchema,
    },
  },
  ({ recordId, operationId, baseVersion, workout }) =>
    request("/api/records", "POST", {
      opId: operationId,
      id: recordId,
      kind: "workout",
      baseVersion,
      deleted: false,
      data: { ...workout, source: "agent" },
    }),
);
server.registerTool(
  "get_today",
  {
    description: "获取指定日期的营养与训练概览",
    inputSchema: { date: z.iso.date().optional() },
  },
  ({ date }) => request(`/api/stats${date ? `?date=${date}` : ""}`),
);
await server.connect(new StdioServerTransport());
