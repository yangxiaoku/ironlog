import { apiFetch, type ApiFetchOptions } from "./api";

export interface CachedEntry<T = unknown> {
  data: T;
  epoch: number;
  fetchedAt: number;
}

export interface QueryCacheHooks {
  getUserId?: () => string;
  getDataEpoch?: () => number;
}

interface PendingQuery {
  userId: string;
  cacheKey: string;
  promise: Promise<unknown>;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_ENTRIES_PER_USER = 120;

let hooks: QueryCacheHooks = {};
const store = new Map<string, Map<string, CachedEntry>>();
const inFlight = new Map<string, PendingQuery>();

export function configureQueryCache(nextHooks: QueryCacheHooks): void {
  hooks = nextHooks;
}

function resolveUser(userId?: string): string {
  return userId ?? hooks.getUserId?.() ?? "";
}

function resolveEpoch(epoch?: number): number {
  return epoch ?? hooks.getDataEpoch?.() ?? 0;
}

function userBucket(userId: string): Map<string, CachedEntry> {
  let bucket = store.get(userId);
  if (!bucket) {
    bucket = new Map();
    store.set(userId, bucket);
  }
  return bucket;
}

export function peekQuery<T = unknown>(cacheKey: string, userId?: string): CachedEntry<T> | undefined {
  const uid = resolveUser(userId);
  return store.get(uid)?.get(cacheKey) as CachedEntry<T> | undefined;
}

export function isEntryFresh(
  entry: CachedEntry | undefined,
  currentEpoch: number,
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now(),
): boolean {
  if (!entry) return false;
  if (entry.epoch !== currentEpoch) return false;
  return now - entry.fetchedAt <= ttlMs;
}

export function writeQueryCache<T>(
  cacheKey: string,
  data: T,
  { userId, epoch }: { userId?: string; epoch?: number } = {},
): CachedEntry<T> {
  const uid = resolveUser(userId);
  const ep = resolveEpoch(epoch);
  const bucket = userBucket(uid);
  const existing = bucket.get(cacheKey) as CachedEntry<T> | undefined;
  if (existing && existing.epoch > ep) {
    return existing;
  }
  if (bucket.has(cacheKey)) bucket.delete(cacheKey);
  const entry: CachedEntry<T> = { data, epoch: ep, fetchedAt: Date.now() };
  bucket.set(cacheKey, entry);
  while (bucket.size > MAX_ENTRIES_PER_USER) {
    const oldest = bucket.keys().next().value;
    if (oldest === undefined) break;
    bucket.delete(oldest);
  }
  return entry;
}

export async function cachedQuery<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  {
    ttlMs = DEFAULT_TTL_MS,
    userId,
    epoch,
    force = false,
  }: {
    ttlMs?: number;
    userId?: string;
    epoch?: number;
    force?: boolean;
  } = {},
): Promise<T> {
  const uid = resolveUser(userId);
  const ep = resolveEpoch(epoch);
  const existing = peekQuery<T>(cacheKey, uid);
  if (!force && isEntryFresh(existing, ep, ttlMs)) {
    return existing!.data;
  }

  const flightKey = JSON.stringify([uid, ep, cacheKey]);
  const pending = inFlight.get(flightKey);
  if (pending) return pending.promise as Promise<T>;

  const request: Promise<T> = new Promise<T>((resolve) => resolve(fetcher()))
    .then((data) => {
      if (inFlight.get(flightKey) === flight) {
        writeQueryCache(cacheKey, data, { userId: uid, epoch: ep });
      }
      return data;
    })
    .finally(() => {
      if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey);
    });
  const flight: PendingQuery = { userId: uid, cacheKey, promise: request };
  inFlight.set(flightKey, flight);
  return request;
}

export function cachedApiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions & {
    cacheKey?: string;
    ttlMs?: number;
    userId?: string;
    epoch?: number;
    force?: boolean;
  } = {},
): Promise<T> {
  const { cacheKey = path, ttlMs = DEFAULT_TTL_MS, userId, epoch, force = false, ...apiOpts } = options;
  return cachedQuery<T>(cacheKey, () => apiFetch<T>(path, apiOpts), { ttlMs, userId, epoch, force });
}

export function invalidateQueryCache(userId?: string, keyPrefix?: string): void {
  if (userId === undefined) {
    store.clear();
    inFlight.clear();
    return;
  }
  for (const [key, flight] of inFlight) {
    if (flight.userId === userId && (!keyPrefix || flight.cacheKey.startsWith(keyPrefix))) {
      inFlight.delete(key);
    }
  }
  if (!keyPrefix) {
    store.delete(userId);
    return;
  }
  const bucket = store.get(userId);
  if (!bucket) return;
  for (const key of bucket.keys()) {
    if (key.startsWith(keyPrefix)) bucket.delete(key);
  }
}
