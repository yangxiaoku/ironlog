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

export function enqueueMutation(
  storage: QueueStorage | null | undefined,
  userId: string,
  item: OfflineMutation,
): number | null {
  if (!item?.opId || !item?.path) return null;
  try {
    const list = loadQueue(storage, userId).filter((existing) => existing.opId !== item.opId);
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
    queue = loadQueue(storage, userId);
    for (const head of queue.filter((item) => !item.failure)) {
      const sameItem = (item: OfflineMutation) => item.opId === head.opId && JSON.stringify(item) === JSON.stringify(head);
      queue = loadQueue(storage, userId);
      if (!queue.some(sameItem)) continue;
      let failure: OfflineMutation["failure"];
      try {
        await sendFn(head.path, { method: head.method ?? "POST", body: head.body });
      } catch (err) {
        queue = loadQueue(storage, userId);
        if (isNetworkError(err)) return result({ stoppedOffline: true });
        const status = Number((err as { status?: unknown }).status ?? 0);
        if (status === 401) return result({ authRequired: true });
        if (status === 408 || status === 425 || status === 429 || status >= 500) return result();
        failure = { status, message: String((err as { message?: unknown }).message ?? "同步未完成") };
      }
      queue = loadQueue(storage, userId);
      const next = queue.flatMap((item) => sameItem(item) ? (failure ? [{ ...item, failure }] : []) : [item]);
      writeQueue(storage, userId, next);
      queue = next;
      if (!failure) synced++;
    }
    return result();
  } catch {
    return result({ storageError: true });
  }
}
