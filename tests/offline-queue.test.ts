import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearQueue,
  enqueueMutation,
  flushQueue,
  isNetworkError,
  readQueue,
} from "../web/src/offline-queue.js";

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

test("isNetworkError 区分网络中断与 HTTP 状态码错误", () => {
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkError(new DOMException("The operation was aborted", "TimeoutError")), true);
  assert.equal(isNetworkError({ status: 400, message: "Bad Request" }), false);
  assert.equal(isNetworkError({ status: 401, message: "Unauthorized" }), false);
  assert.equal(isNetworkError({ status: 409, message: "Conflict" }), false);
  assert.equal(isNetworkError({ status: 503, message: "Service Unavailable" }), false);
});

test("离线写队列支持 FIFO 入队、按 opId 去重与按序完整回放", async () => {
  const storage = memoryStorage();
  const userId = "usr_1";

  enqueueMutation(storage, userId, { opId: "op-1", path: "/api/records", body: { id: "r1", seq: 1 }, label: "饮食记录" });
  enqueueMutation(storage, userId, { opId: "op-2", path: "/api/records", body: { id: "r2", seq: 2 }, label: "体重记录" });
  // 相同 opId 去重覆盖更新
  assert.equal(
    enqueueMutation(storage, userId, { opId: "op-1", path: "/api/records", body: { id: "r1", seq: 9 }, label: "饮食记录" }),
    2,
  );

  const sent = [];
  const result = await flushQueue(storage, userId, async (path, opts) => {
    sent.push({ path, id: opts.body.id, seq: opts.body.seq });
  });

  assert.deepEqual(result, { synced: 2, remaining: 0, stoppedOffline: false, authRequired: false, blocked: [], storageError: false });
  assert.deepEqual(sent, [
    { path: "/api/records", id: "r2", seq: 2 },
    { path: "/api/records", id: "r1", seq: 9 },
  ]);
  assert.equal(readQueue(storage, userId).length, 0);
});

test("弱网重放遇断网立即保留剩余队列，恢复网络后继续完成同步", async () => {
  const storage = memoryStorage();
  const userId = "usr_2";

  enqueueMutation(storage, userId, { opId: "op-a", path: "/api/records", body: { id: "a" } });
  enqueueMutation(storage, userId, { opId: "op-b", path: "/api/records", body: { id: "b" } });
  enqueueMutation(storage, userId, { opId: "op-c", path: "/api/records", body: { id: "c" } });

  let calls = 0;
  const firstAttempt = await flushQueue(storage, userId, async (_path, opts) => {
    calls++;
    if (calls === 2) throw new TypeError("Failed to fetch");
    return opts;
  });

  assert.equal(firstAttempt.synced, 1);
  assert.equal(firstAttempt.remaining, 2);
  assert.equal(firstAttempt.stoppedOffline, true);
  assert.deepEqual(readQueue(storage, userId).map((x) => x.opId), ["op-b", "op-c"]);

  const resumedIds = [];
  const secondAttempt = await flushQueue(storage, userId, async (_path, opts) => {
    resumedIds.push(opts.body.id);
  });

  assert.equal(secondAttempt.synced, 2);
  assert.equal(secondAttempt.remaining, 0);
  assert.deepEqual(resumedIds, ["b", "c"]);
});

test("401 保留队列，409 保留冲突内容并继续同步后续记录", async () => {
  const storage = memoryStorage();
  const userId = "usr_3";

  enqueueMutation(storage, userId, { opId: "op-conflict", path: "/api/records", body: { id: "old" }, label: "旧记录" });
  enqueueMutation(storage, userId, { opId: "op-valid", path: "/api/records", body: { id: "fresh" }, label: "新训练" });

  // 401 保护：不丢失任何待上传项
  const authRes = await flushQueue(storage, userId, async () => {
    throw Object.assign(new Error("未登录"), { status: 401 });
  });
  assert.equal(authRes.authRequired, true);
  assert.equal(authRes.remaining, 2);
  assert.equal(readQueue(storage, userId).length, 2);

  // 409 冲突留在本机并继续同步 op-valid
  const flushedIds = [];
  const conflictRes = await flushQueue(storage, userId, async (_path, opts) => {
    if (opts.body.id === "old") throw Object.assign(new Error("版本冲突"), { status: 409 });
    flushedIds.push(opts.body.id);
  });
  assert.equal(conflictRes.synced, 1);
  assert.equal(conflictRes.remaining, 1);
  assert.equal(conflictRes.blocked.length, 1);
  assert.equal(conflictRes.blocked[0]?.opId, "op-conflict");
  assert.equal(conflictRes.blocked[0]?.failure?.status, 409);
  assert.deepEqual(readQueue(storage, userId)[0]?.body, { id: "old" });
  assert.deepEqual(flushedIds, ["fresh"]);
  const after = await flushQueue(storage, userId, async () => assert.fail("冲突项不应自动重发"));
  assert.equal(after.blocked.length, 1);

  clearQueue(storage, userId);
  assert.equal(readQueue(storage, userId).length, 0);
});

test("离线队列写满时报告失败，服务器限流和本地移除失败时保留记录", async () => {
  const item = { opId: "offline-save", path: "/api/records", body: { id: "workout" } };
  const storage = memoryStorage();
  const full = { ...storage, setItem() { throw new Error("quota"); } };
  assert.equal(enqueueMutation(full, "owner", item), null);
  assert.equal(readQueue(storage, "owner").length, 0);
  assert.equal(enqueueMutation(storage, "owner", item), 1);
  const limited = await flushQueue(storage, "owner", async () => { throw Object.assign(new Error("rate limited"), { status: 429 }); });
  assert.equal(limited.remaining, 1);
  assert.deepEqual(limited.blocked, []);
  const locked = { ...storage, removeItem() { throw new Error("quota"); } };
  const after = await flushQueue(locked, "owner", async () => {});
  assert.equal(after.storageError, true);
  assert.equal(after.remaining, 1);
  assert.equal(readQueue(storage, "owner")[0]?.opId, item.opId);
});
