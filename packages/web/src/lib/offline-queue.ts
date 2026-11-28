export interface OfflineMutation {
  opId: string;
  path: string;
  method?: string;
  body?: unknown;
  label?: string;
  queuedAt?: string;
  failure?: { status: number; message: string };
}

export interface FlushResult {
  synced: number;
  remaining: number;
  stoppedOffline: boolean;
  authRequired: boolean;
  transientFailure?: boolean;
  blocked: OfflineMutation[];
  storageError: boolean;
}

type QueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function queueStorageKey(userId: string): string {
  return userId ? `ironlog-offline-queue:${userId}` : "";
}

export function getOfflineStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; }
  catch { return null; }
}

export function isNetworkError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status > 0) return false;
  return true;
}

function loadQueue(storage: QueueStorage | null | undefined, userId: string): OfflineMutation[] {
  const key = queueStorageKey(userId);
  if (!storage || !key) throw new Error("本地同步队列不可用");
  const raw: unknown = JSON.parse(storage.getItem(key) ?? "[]");
  if (!Array.isArray(raw)) throw new Error("本地同步队列格式不正确");
  return raw.filter((item): item is OfflineMutation =>
    Boolean(item && typeof item.opId === "string" && typeof item.path === "string"));
}

export function readQueue(storage: QueueStorage | null | undefined, userId: string): OfflineMutation[] {
  try {
    return loadQueue(storage, userId);
  } catch {
    return [];
  }
}

function writeQueue(storage: QueueStorage | null | undefined, userId: string, items: OfflineMutation[]): void {
  const key = queueStorageKey(userId);
  if (!storage || !key) throw new Error("本地同步队列不可用");
  if (!items.length) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(items));
}

export function clearQueue(storage: QueueStorage | null | undefined, userId: string): void {
  const key = queueStorageKey(userId);
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {}
}

export interface ClearFailedResult {
  removed: number;
  remainingPending: number;
  remainingBlocked: number;
  storageError: boolean;
}

export function clearFailedMutationsByIds(
  storage: QueueStorage | null | undefined,
  userId: string,
  targetOpIds?: string[],
): ClearFailedResult {
  const key = queueStorageKey(userId);
  if (!storage || !key) {
    return { removed: 0, remainingPending: 0, remainingBlocked: 0, storageError: true };
  }
  try {
    const current = loadQueue(storage, userId);
    const targetSet = targetOpIds ? new Set(targetOpIds) : null;
    const kept = current.filter((item) => {
      if (!item.failure) return true;
      if (targetSet && !targetSet.has(item.opId)) return true;
      return false;
    });
    const removed = current.length - kept.length;
    if (removed > 0) writeQueue(storage, userId, kept);
    const remainingBlocked = kept.filter((item) => Boolean(item.failure)).length;
    return {
      removed,
      remainingPending: kept.length - remainingBlocked,
      remainingBlocked,
      storageError: false,
    };
  } catch {
    const fallback = readQueue(storage, userId);
    const remainingBlocked = fallback.filter((item) => Boolean(item.failure)).length;
    return {
      removed: 0,
      remainingPending: fallback.length - remainingBlocked,
      remainingBlocked,
      storageError: true,
    };
  }
}

export function clearFailedMutations(
  storage: QueueStorage | null | undefined,
  userId: string,
  targetOpIds?: string[],
): number {
  return clearFailedMutationsByIds(storage, userId, targetOpIds).removed;
}

function recordCoalesceKey(item: Pick<OfflineMutation, "path" | "method" | "body">): string | null {
  if (item.path !== "/api/records" || (item.method ?? "POST").toUpperCase() !== "POST") return null;
  const body = item.body as { kind?: unknown; id?: unknown; deleted?: unknown } | null;
  if (!body || typeof body !== "object") return null;
  if (body.kind === "weight" && typeof body.id === "string" && body.id && body.deleted !== true) {
    return `weight:${body.id}`;
  }
  return null;
}

export function findPendingRecordMutation(
  storage: QueueStorage | null | undefined,
  userId: string,
  kind: string,
  id: string,
): OfflineMutation | null {
  const items = readQueue(storage, userId);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.failure || item.path !== "/api/records") continue;
    const body = item.body as { kind?: unknown; id?: unknown; deleted?: unknown } | null;
    if (body && body.kind === kind && body.id === id && body.deleted !== true) {
      return item;
    }
  }
  return null;
}

export function removePendingRecordMutation(
  storage: QueueStorage | null | undefined,
  userId: string,
  kind: string,
  id: string,
): void {
  const key = queueStorageKey(userId);
  if (!storage || !key) return;
  try {
    const current = loadQueue(storage, userId);
    const next = current.filter((item) => {
      if (item.failure || item.path !== "/api/records") return true;
      const body = item.body as { kind?: unknown; id?: unknown; deleted?: unknown } | null;
      return !(body && body.kind === kind && body.id === id && body.deleted !== true);
    });
    if (next.length !== current.length) writeQueue(storage, userId, next);
  } catch {}
}

export function enqueueMutation(
  storage: QueueStorage | null | undefined,
  userId: string,
  item: OfflineMutation,
): number | null {
  if (!item?.opId || !item?.path) return null;
  try {
    const coalesceKey = recordCoalesceKey(item);
    const existingList = loadQueue(storage, userId);
    let preservedBaseVersion: number | undefined;
    const list = existingList.filter((existing) => {
      if (existing.opId === item.opId) return false;
      // #246: Coalesce unsent offline edits to the same weight record on the same device while preserving the original observed baseVersion
      if (coalesceKey && !existing.failure && recordCoalesceKey(existing) === coalesceKey) {
        const existingBody = existing.body as { baseVersion?: unknown } | null;
        if (typeof existingBody?.baseVersion === "number" && preservedBaseVersion === undefined) {
          preservedBaseVersion = existingBody.baseVersion;
        }
        return false;
      }
      return true;
    });
    let nextBody = item.body;
    if (
      preservedBaseVersion !== undefined &&
      nextBody &&
      typeof nextBody === "object" &&
      !Array.isArray(nextBody)
    ) {
      nextBody = { ...(nextBody as Record<string, unknown>), baseVersion: preservedBaseVersion };
    }
    list.push({
      opId: item.opId,
      path: item.path,
      method: item.method ?? "POST",
      body: nextBody,
      label: item.label ?? "记录",
      queuedAt: item.queuedAt ?? new Date().toISOString(),
    });
    writeQueue(storage, userId, list);
    return list.length;
  } catch {
    return null;
  }
}

export type SendMutationFn = (
  path: string,
  opts: { method: string; body?: unknown },
) => Promise<unknown>;

export async function flushQueue(
  storage: QueueStorage | null | undefined,
  userId: string,
  sendFn: SendMutationFn,
): Promise<FlushResult> {
  let queue: OfflineMutation[] = [];
  let synced = 0;
  const result = (flags: Partial<FlushResult> = {}): FlushResult => ({
    synced, remaining: queue.length, blocked: queue.filter((item) => item.failure),
    stoppedOffline: false, authRequired: false, storageError: false, ...flags,
  });
  try {
    const attemptedOpIds = new Set<string>();
    while (true) {
      queue = loadQueue(storage, userId);
      const head = queue.find((item) => !item.failure && !attemptedOpIds.has(item.opId));
      if (!head) break;
      attemptedOpIds.add(head.opId);
      const sameItem = (item: OfflineMutation) => item.opId === head.opId && JSON.stringify(item) === JSON.stringify(head);
      let failure: OfflineMutation["failure"];
      try {
        await sendFn(head.path, { method: head.method ?? "POST", body: head.body });
      } catch (err) {
        queue = loadQueue(storage, userId);
        if (isNetworkError(err)) return result({ stoppedOffline: true });
        const status = Number((err as { status?: unknown }).status ?? 0);
        if (status === 401) return result({ authRequired: true });
        if (status === 408 || status === 425 || status === 429 || status >= 500) {
          return result({ transientFailure: true });
        }
        failure = { status, message: String((err as { message?: unknown }).message ?? "同步未完成") };
      }
      queue = loadQueue(storage, userId);
      const next = queue.flatMap((item) => sameItem(item) ? (failure ? [{ ...item, failure }] : []) : [item]);
      writeQueue(storage, userId, next);
      queue = next;
      if (!failure) synced++;
    }
    queue = loadQueue(storage, userId);
    return result();
  } catch {
    return result({ storageError: true });
  }
}
