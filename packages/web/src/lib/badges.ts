export type BadgeTier = "standard" | "milestone" | "prestige";

export interface BadgeItem {
  id: string;
  title: string;
  subtitle: string;
  rule: string;
  category: string;
  categoryLabel: string;
  tier: BadgeTier;
  unlocked: boolean;
  unlockedAt?: string | null;
  progress: number;
  current: number;
  target: number;
  unit: string;
}

export interface BadgeCategory {
  key: string;
  label: string;
  earned: number;
  total: number;
}

export interface BadgeSummary {
  earnedCount: number;
  totalCount: number;
  categories: BadgeCategory[];
  badges: BadgeItem[];
}

export const BADGE_TIER_LABELS: Record<BadgeTier, string> = {
  standard: "基础",
  milestone: "里程碑",
  prestige: "荣耀",
};

export function filterVisibleBadges(summary: BadgeSummary, appleHealthConnected = true): BadgeSummary {
  if (!summary || appleHealthConnected) return summary;
  const visibleBadges = (summary.badges ?? []).filter((b) => b.unlocked || !String(b.id ?? "").startsWith("apple-"));
  const cats = (summary.categories ?? [])
    .map((cat) => {
      const items = visibleBadges.filter((b) => b.category === cat.key);
      return { ...cat, total: items.length, earned: items.filter((b) => b.unlocked).length };
    })
    .filter((cat) => cat.total > 0);
  return {
    ...summary,
    badges: visibleBadges,
    categories: cats,
    totalCount: visibleBadges.length,
    earnedCount: visibleBadges.filter((b) => b.unlocked).length,
  };
}

export function pinnedBadgesKey(userId: string): string {
  return `ironlog-pinned-badges:${userId || "anon"}`;
}

export function formatBadgeProgressPct(badge: Pick<BadgeItem, "unlocked" | "progress">): string {
  if (badge.unlocked) return "100%";
  const pct = Math.max(0, Math.min(99.9, badge.progress * 100));
  if (pct >= 99) {
    const floored = Math.floor(pct * 10) / 10;
    return `${Math.min(99.9, floored)}%`;
  }
  return `${Math.min(99, Math.round(pct))}%`;
}

export function getPinnedBadges(userId: string, storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined): string[] {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(pinnedBadgesKey(userId)) || "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function togglePinnedBadgeResult(
  userId: string,
  badgeId: string,
  options?: { replaceId?: string; storage?: Storage },
): { ok: boolean; pinned: string[]; replacedId: string | null } {
  const storage = options?.storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  const cur = getPinnedBadges(userId, storage);
  const idx = cur.indexOf(badgeId);
  let next: string[];
  let replacedId: string | null = null;
  if (idx >= 0) {
    next = cur.filter((id) => id !== badgeId);
  } else if (cur.length >= 3) {
    const toRemove = options?.replaceId && cur.includes(options.replaceId) ? options.replaceId : cur[0]!;
    replacedId = toRemove;
    next = [...cur.filter((id) => id !== toRemove), badgeId];
  } else {
    next = [...cur, badgeId];
  }
  if (!storage) {
    return { ok: false, pinned: cur, replacedId: null };
  }
  try {
    storage.setItem(pinnedBadgesKey(userId), JSON.stringify(next));
    return { ok: true, pinned: next, replacedId };
  } catch {
    return { ok: false, pinned: cur, replacedId: null };
  }
}

export function togglePinnedBadge(
  userId: string,
  badgeId: string,
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): string[] {
  return togglePinnedBadgeResult(userId, badgeId, { storage }).pinned;
}

export function selectOverviewBadges(summary: BadgeSummary, pinnedIds: string[]): BadgeItem[] {
  const unlocked = summary.badges.filter((item) => item.unlocked);
  const byId = new Map(unlocked.map((b) => [b.id, b]));
  const pinned = pinnedIds.map((id) => byId.get(id)).filter((b): b is BadgeItem => Boolean(b));
  const pinnedSet = new Set(pinned.map((b) => b.id));
  const otherUnlocked = unlocked.filter((b) => !pinnedSet.has(b.id)).slice(-4).reverse();
  const orderedUnlocked = [...pinned, ...otherUnlocked];
  const chasing = summary.badges.filter((item) => !item.unlocked).sort((a, b) => b.progress - a.progress);
  return [
    ...orderedUnlocked.slice(0, 4),
    ...chasing.slice(0, Math.max(0, 6 - Math.min(4, orderedUnlocked.length))),
  ].slice(0, 6);
}
