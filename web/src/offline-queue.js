/** Build storage key for per-account offline mutation queue. */
export function queueStorageKey(userId) {
  return userId ? "ironlog-offline-queue:" + userId : "";
}

/** Determine whether an error represents a transient network/connectivity failure rather than an HTTP status error. */
export function isNetworkError(err) {
  if (typeof err?.status === "number" && err.status > 0) return false;
  return true;
}

/** Read queued mutations safely from Storage. */
export function readQueue(storage, userId) {
  const key = queueStorageKey(userId);
  if (!storage || !key) return [];
  try {
    const raw = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item) => item && typeof item.opId === "string" && item.path) : [];
  } catch {
    return [];
  }
}

/** Persist queued mutations safely to Storage. */
export function writeQueue(storage, userId, items) {
  const key = queueStorageKey(userId);
  if (!storage || !key) return;
  try {
    if (!items.length) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(items));
  } catch {}
}

/** Clear all queued offline mutations for an account. */
export function clearQueue(storage, userId) {
  const key = queueStorageKey(userId);
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {}
}

/** Enqueue a mutation in FIFO order, replacing any existing entry with the same opId. */
export function enqueueMutation(storage, userId, item) {
  if (!item?.opId || !item?.path) return readQueue(storage, userId).length;
  const list = readQueue(storage, userId).filter((existing) => existing.opId !== item.opId);
  list.push({
    opId: item.opId,
    path: item.path,
    method: item.method ?? "POST",
    body: item.body,
    label: item.label ?? "记录",
    queuedAt: item.queuedAt ?? new Date().toISOString(),
  });
  writeQueue(storage, userId, list);
  return list.length;
}

/** Sequentially replay queued mutations in FIFO order with idempotent opId payloads. */
export async function flushQueue(storage, userId, sendFn) {
  let queue = readQueue(storage, userId);
  let synced = 0;
  const dropped = [];

  while (queue.length > 0) {
    const head = queue[0];
    try {
      await sendFn(head.path, { method: head.method ?? "POST", body: head.body });
      synced++;
      queue = readQueue(storage, userId).filter((item) => item.opId !== head.opId);
      writeQueue(storage, userId, queue);
    } catch (err) {
      if (isNetworkError(err)) {
        return { synced, remaining: queue.length, stoppedOffline: true, authRequired: false, dropped };
      }
      if (err.status === 401) {
        return { synced, remaining: queue.length, stoppedOffline: false, authRequired: true, dropped };
      }
      if (err.status >= 400 && err.status < 500) {
        dropped.push({ item: head, status: err.status, message: err.message ?? "同步冲突" });
        queue = readQueue(storage, userId).filter((item) => item.opId !== head.opId);
        writeQueue(storage, userId, queue);
        continue;
      }
      return { synced, remaining: queue.length, stoppedOffline: false, authRequired: false, dropped };
    }
  }

  return { synced, remaining: 0, stoppedOffline: false, authRequired: false, dropped };
}
