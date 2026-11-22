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

  assert.deepEqual(result, { synced: 2, remaining: 0, stoppedOffline: false, authRequired: false, dropped: [] });
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

test("401 鉴权过期保留队列不丢弃，409 冲突仅跳过冲突项并继续同步后续记录", async () => {
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

  // 409 冲突剔除并继续同步 op-valid
  const flushedIds = [];
  const conflictRes = await flushQueue(storage, userId, async (_path, opts) => {
    if (opts.body.id === "old") throw Object.assign(new Error("版本冲突"), { status: 409 });
    flushedIds.push(opts.body.id);
  });
  assert.equal(conflictRes.synced, 1);
  assert.equal(conflictRes.remaining, 0);
  assert.equal(conflictRes.dropped.length, 1);
  assert.equal(conflictRes.dropped[0].item.opId, "op-conflict");
  assert.deepEqual(flushedIds, ["fresh"]);

  clearQueue(storage, userId);
  assert.equal(readQueue(storage, userId).length, 0);
});
