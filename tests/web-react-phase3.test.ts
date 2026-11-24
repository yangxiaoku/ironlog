import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { mountWebAssets } from "../packages/server/src/web-assets.ts";
import { filterVisibleBadges, selectOverviewBadges, type BadgeItem, type BadgeSummary } from "../packages/web/src/lib/badges.ts";
import {
  cachedQuery,
  invalidateQueryCache,
  peekQuery,
} from "../packages/web/src/lib/query-cache.ts";
import {
  APPLE_HEALTH_DAILY_GROUPS,
  APPLE_SHORTCUT_SPORTS,
  assessServerOrigin,
  buildIronlogDailyHealthShortcut,
  buildIronlogEventShortcut,
  buildIronlogRecentWorkoutShortcut,
  buildMacSignCommand,
  normalizeServerOrigin,
} from "../packages/web/src/lib/shortcut-gen.ts";

test("packages/web/src/lib/shortcut-gen generates valid Apple Shortcut plists and assesses origins", () => {
  assert.equal(APPLE_SHORTCUT_SPORTS.length, 16);
  assert.equal(APPLE_HEALTH_DAILY_GROUPS.length, 5);
  assert.equal(normalizeServerOrigin("https://iron.example.com/"), "https://iron.example.com");

  const publicOrigin = assessServerOrigin("https://iron.example.com/");
  assert.equal(publicOrigin.valid, true);
  assert.equal(publicOrigin.isLoopback, false);
  assert.equal(publicOrigin.isPlainHttp, false);
  assert.equal(publicOrigin.warning, "");

  const localOrigin = assessServerOrigin("http://localhost:3000");
  assert.equal(localOrigin.valid, true);
  assert.equal(localOrigin.isLoopback, true);
  assert.equal(localOrigin.isPlainHttp, true);
  assert.ok(localOrigin.warning.length > 0);

  const evt = buildIronlogEventShortcut({
    event: "start",
    serverOrigin: "https://iron.example.com",
    token: "tok_test_12345678",
    activityType: "running",
  });
  assert.ok(evt.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(evt.xml.includes("https://iron.example.com/api/integrations/apple-health/events"));
  assert.ok(evt.xml.includes("Bearer tok_test_12345678"));

  const recent = buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://iron.example.com",
    token: "tok_test_12345678",
    windowMinutes: 45,
  });
  assert.ok(recent.xml.includes("https://iron.example.com/api/integrations/apple-health/workouts"));
  assert.equal(recent.windowMinutes, 45);

  const daily = buildIronlogDailyHealthShortcut({
    serverOrigin: "https://iron.example.com",
    token: "tok_test_12345678",
    metrics: ["steps", "sleepSamples", "hrvMs"],
  });
  assert.ok(daily.xml.includes("https://iron.example.com/api/integrations/apple-health/daily"));
  assert.ok(buildMacSignCommand().includes("shortcuts sign"));
});

test("packages/web/src/lib/badges filters Apple badges when disconnected and orders overview picks", () => {
  const makeBadge = (partial: Partial<BadgeItem> & { id: string }): BadgeItem => ({
    title: partial.id,
    subtitle: "",
    rule: "",
    category: "consistency",
    categoryLabel: "坚持习惯",
    tier: "standard",
    unlocked: false,
    unlockedAt: null,
    progress: 0,
    current: 0,
    target: 1,
    unit: "次",
    ...partial,
  });

  const summary: BadgeSummary = {
    earnedCount: 2,
    totalCount: 4,
    categories: [
      { key: "consistency", label: "坚持习惯", earned: 2, total: 2 },
      { key: "apple", label: "Apple 健康", earned: 0, total: 2 },
    ],
    badges: [
      makeBadge({ id: "first-workout", unlocked: true, progress: 1 }),
      makeBadge({ id: "streak-7", unlocked: true, progress: 1 }),
      makeBadge({ id: "apple-sync", category: "apple", unlocked: false, progress: 0.4 }),
      makeBadge({ id: "apple-unlocked", category: "apple", unlocked: true, progress: 1 }),
    ],
  };

  const hiddenApple = filterVisibleBadges(summary, false);
  assert.equal(hiddenApple.totalCount, 3);
  assert.ok(!hiddenApple.badges.some((b) => b.id === "apple-sync"));
  assert.ok(hiddenApple.badges.some((b) => b.id === "apple-unlocked"));

  const overview = selectOverviewBadges(summary, ["streak-7"]);
  assert.equal(overview[0]?.id, "streak-7");
});

test("mountWebAssets serves React build from packages/web/dist by default and supports legacy fallback", async () => {
  const app = new Hono<{ Variables: { userId: string } }>();
  mountWebAssets(app);

  const prevLegacy = process.env.IRONLOG_WEB_LEGACY;
  delete process.env.IRONLOG_WEB_LEGACY;

  try {
    const htmlRes = await app.request("/app/");
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers.get("Content-Type") ?? "", /text\/html/);
    assert.equal(htmlRes.headers.get("Cache-Control"), "no-cache");
    assert.match(htmlRes.headers.get("Content-Security-Policy") ?? "", /worker-src 'self'/);

    const html = await htmlRes.text();
    const assetMatch = html.match(/\/app\/(assets\/[A-Za-z0-9._-]+\.js)/);
    assert.ok(assetMatch, "React index.html should reference a hashed /app/assets/*.js bundle");

    const jsRes = await app.request(`/app/${assetMatch[1]}`);
    assert.equal(jsRes.status, 200);
    assert.match(jsRes.headers.get("Content-Type") ?? "", /text\/javascript/);
    assert.equal(jsRes.headers.get("Cache-Control"), "public, max-age=31536000, immutable");

    const manifestRes = await app.request("/app/manifest.webmanifest");
    assert.equal(manifestRes.status, 200);
    assert.equal(manifestRes.headers.get("Content-Type"), "application/manifest+json");

    const swRes = await app.request("/app/sw.js");
    assert.equal(swRes.status, 200);

    const iconRes = await app.request("/app/icon-192.png");
    assert.equal(iconRes.status, 200);
    assert.match(iconRes.headers.get("Cache-Control") ?? "", /max-age=86400/);

    const traversalRes = await app.request("/app/../package.json");
    assert.equal(traversalRes.status, 404);

    process.env.IRONLOG_WEB_LEGACY = "true";
    const legacyHtmlExists = existsSync(resolve(process.cwd(), "web/dist/index.html"));
    const legacyRes = await app.request("/app/");
    if (legacyHtmlExists) {
      assert.equal(legacyRes.status, 200);
      const legacyHtml = await legacyRes.text();
      assert.ok(legacyHtml.includes("./app.js"));
    } else {
      assert.equal(legacyRes.status, 503);
    }
  } finally {
    if (prevLegacy === undefined) delete process.env.IRONLOG_WEB_LEGACY;
    else process.env.IRONLOG_WEB_LEGACY = prevLegacy;
  }
});

test("packages/web/src/lib/query-cache deduplicates in-flight fetches, honors epoch invalidation, and clears on logout", async () => {
  invalidateQueryCache();
  let calls = 0;
  let resolveSlow!: (value: { count: number }) => void;
  const slowFetcher = () => {
    calls++;
    return new Promise<{ count: number }>((res) => {
      resolveSlow = res;
    });
  };

  const p1 = cachedQuery("/api/web/test-stats", slowFetcher, { userId: "u_cache", epoch: 1 });
  const p2 = cachedQuery("/api/web/test-stats", slowFetcher, { userId: "u_cache", epoch: 1 });
  assert.equal(calls, 1, "concurrent calls on same user & epoch should coalesce");
  resolveSlow({ count: 42 });

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, { count: 42 });
  assert.deepEqual(r2, { count: 42 });

  const hit = await cachedQuery("/api/web/test-stats", async () => {
    calls++;
    return { count: 99 };
  }, { userId: "u_cache", epoch: 1 });
  assert.equal(calls, 1, "fresh cache hit within epoch & TTL must skip fetcher");
  assert.deepEqual(hit, { count: 42 });

  const refreshed = await cachedQuery("/api/web/test-stats", async () => {
    calls++;
    return { count: 43 };
  }, { userId: "u_cache", epoch: 2 });
  assert.equal(calls, 2, "bumped dataEpoch should trigger fresh fetch");
  assert.deepEqual(refreshed, { count: 43 });

  invalidateQueryCache("u_cache");
  assert.equal(peekQuery("/api/web/test-stats", "u_cache"), undefined);
});
