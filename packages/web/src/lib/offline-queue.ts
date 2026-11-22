export interface OfflineMutation {
  opId: string;
  path: string;
  method?: string;
  body?: unknown;
  label?: string;
  queuedAt?: string;
}

export interface DroppedMutation {
  item: OfflineMutation;
  status: number;
  message: string;
}

export interface FlushResult {
  synced: number;
  remaining: number;
  stoppedOffline: boolean;
  authRequired: boolean;
  dropped: DroppedMutation[];
}

export function queueStorageKey(userId: string): string {
  return userId ? `ironlog-offline-queue:${userId}` : "";
}

export function isNetworkError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status > 0) return false;
  return true;
}

export function readQueue(storage: Storage | null | undefined, userId: string): OfflineMutation[] {
  const key = queueStorageKey(userId);
  if (!storage || !key) return [];
  try {
    const raw: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter(
          (item): item is OfflineMutation =>
            Boolean(item && typeof item.opId === "string" && typeof item.path === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

export function writeQueue(storage: Storage | null | undefined, userId: string, items: OfflineMutation[]): void {
  const key = queueStorageKey(userId);
  if (!storage || !key) return;
  try {
    if (!items.length) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(items));
  } catch {}
}

export function clearQueue(storage: Storage | null | undefined, userId: string): void {
  const key = queueStorageKey(userId);
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {}
}

export function enqueueMutation(
  storage: Storage | null | undefined,
  userId: string,
  item: OfflineMutation,
): number {
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

export type SendMutationFn = (
  path: string,
  opts: { method: string; body?: unknown },
) => Promise<unknown>;

export async function flushQueue(
  storage: Storage | null | undefined,
  userId: string,
  sendFn: SendMutationFn,
): Promise<FlushResult> {
  let queue = readQueue(storage, userId);
  let synced = 0;
  const dropped: DroppedMutation[] = [];

  while (queue.length > 0) {
    const head = queue[0]!;
    try {
      await sendFn(head.path, { method: head.method ?? "POST", body: head.body });
      synced++;
      queue = readQueue(storage, userId).filter((item) => item.opId !== head.opId);
      writeQueue(storage, userId, queue);
    } catch (err) {
      if (isNetworkError(err)) {
        return { synced, remaining: queue.length, stoppedOffline: true, authRequired: false, dropped };
      }
      const status = Number((err as { status?: unknown }).status ?? 0);
      const message = String((err as { message?: unknown }).message ?? "同步冲突");
      if (status === 401) {
        return { synced, remaining: queue.length, stoppedOffline: false, authRequired: true, dropped };
      }
      if (status >= 400 && status < 500) {
        dropped.push({ item: head, status, message });
        queue = readQueue(storage, userId).filter((item) => item.opId !== head.opId);
        writeQueue(storage, userId, queue);
        continue;
      }
      return { synced, remaining: queue.length, stoppedOffline: false, authRequired: false, dropped };
    }
  }

  return { synced, remaining: 0, stoppedOffline: false, authRequired: false, dropped };
}
