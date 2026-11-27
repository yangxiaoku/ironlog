import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { mountWebAssets } from "../packages/server/src/web-assets.ts";
import { configureApi } from "../packages/web/src/lib/api.ts";
import { filterVisibleBadges, selectOverviewBadges, type BadgeItem, type BadgeSummary } from "../packages/web/src/lib/badges.ts";
import {
  cachedQuery,
  invalidateQueryCache,
  peekQuery,
} from "../packages/web/src/lib/query-cache.ts";
import {
  APPLE_HEALTH_DAILY_GROUPS,
  APPLE_SHORTCUT_SPORTS,
  DEFAULT_APPLE_HUB_SHORTCUT_NAME,
  assessServerOrigin,
  buildIronlogDailyHealthShortcut,
  buildIronlogEventShortcut,
  buildIronlogRecentWorkoutShortcut,
  buildIronlogUnifiedAppleHubShortcut,
  buildMacSignCommand,
  encodeShortcutXmlToBase64,
  normalizeServerOrigin,
} from "../packages/web/src/lib/shortcut-gen.ts";
import { useAuthStore } from "../packages/web/src/store/useAuthStore.ts";
import { useUiStore } from "../packages/web/src/store/useUiStore.ts";
import { clearFailedMutations, enqueueMutation, flushQueue, readQueue } from "../packages/web/src/lib/offline-queue.ts";
import { resolveSupersetTransition } from "../packages/web/src/lib/workout-helpers.ts";
import { getAppleCardioPreset } from "../packages/web/src/lib/apple-fitness.ts";
import {
  clearCardioSession,
  createCardioSession,
  estimateCardioCalories,
  formatCardioPaceOrSpeed,
  matchesCardioAppleWorkout,
  readCardioSession,
  recordCardioLap,
  requestCardioAppleSync,
  startCardioSession,
  toggleCardioSessionPause,
} from "../packages/web/src/lib/cardio-session.ts";
import { elapsedAt } from "../packages/web/src/lib/haptics-audio.ts";
import { compactWorkoutTag, fullWorkoutTag } from "../packages/web/src/lib/calendar-label.ts";

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
  assert.equal(Buffer.from(evt.base64, "base64").toString("utf8"), evt.xml);
});

function assertBalancedPlistContainers(xml: string) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<!DOCTYPE plist PUBLIC"));
  assert.ok(xml.includes('<plist version="1.0">'));
  const stack: string[] = [];
  const tagRe = /<\/?([A-Za-z0-9_-]+)(?:\s+[^>]*)?\/?>/g;
  for (const match of xml.matchAll(tagRe)) {
    const token = match[0];
    const tag = match[1]!;
    if (token.startsWith("<?") || token.startsWith("<!") || token.endsWith("/>")) continue;
    if (token.startsWith("</")) {
      const open = stack.pop();
      assert.equal(open, tag, `mismatched closing </${tag}> (expected </${open ?? "none"}>)`);
    } else {
      stack.push(tag);
    }
  }
  assert.deepEqual(stack, [], "all XML plist tags balanced");
}

test("packages/web/src/lib/shortcut-gen generates token-free universal shortcuts with WFWorkflowImportQuestions and Base64", () => {
  const secretToken = "tok_should_never_leak_999";
  const secretOrigin = "https://secret-vps.example.com";

  const makeUniversalChecks = (
    built: { filename: string; xml: string; base64: string; endpoint: string },
    expectedPaths: string[],
  ) => {
    assert.ok(built.filename.startsWith("铁记-通用-"));
    assert.ok(!built.xml.includes(secretToken), `${built.filename} must not embed literal token`);
    assert.ok(!built.xml.includes(secretOrigin), `${built.filename} must not embed literal origin`);
    assertBalancedPlistContainers(built.xml);

    // Must contain WFWorkflowImportQuestions pointing to action index 1 and 2 WFTextActionText
    assert.ok(built.xml.includes("<key>WFWorkflowImportQuestions</key>"));
    assert.ok(built.xml.includes("<key>ActionIndex</key>\n\t\t\t<integer>1</integer>"));
    assert.ok(built.xml.includes("<key>ActionIndex</key>\n\t\t\t<integer>2</integer>"));
    assert.ok(built.xml.includes("<key>ParameterKey</key>\n\t\t\t<string>WFTextActionText</string>"));
    const actionIds = [...built.xml.matchAll(/<key>WFWorkflowActionIdentifier<\/key>\s*<string>([^<]+)<\/string>/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(
      actionIds.slice(0, 3),
      ["is.workflow.actions.comment", "is.workflow.actions.gettext", "is.workflow.actions.gettext"],
      `${built.filename} places origin & token gettext actions at exact indices 1 and 2`,
    );

    // Must wire magic variable Bearer &#xFFFC; at range {7, 1} and URL at range {0, 1}
    assert.ok(built.xml.includes("<string>Bearer &#xFFFC;</string>"));
    assert.ok(built.xml.includes("<key>{7, 1}</key>"));
    assert.ok(built.xml.includes("<key>{0, 1}</key>"));
    for (const p of expectedPaths) {
      assert.ok(built.xml.includes(`<string>&#xFFFC;${p}</string>`), `${built.filename} contains magic URL path ${p}`);
    }

    // UTF-8 Base64 round-trip matches exact XML
    assert.equal(built.base64, encodeShortcutXmlToBase64(built.xml));
    assert.equal(Buffer.from(built.base64, "base64").toString("utf8"), built.xml);
  };

  // Can omit serverOrigin & token completely
  const dailyNoCreds = buildIronlogDailyHealthShortcut({
    useImportQuestions: true,
    metrics: ["steps", "sleepSamples", "hrvMs", "bloodOxygenPct"],
  });
  makeUniversalChecks(dailyNoCreds, ["/api/integrations/apple-health/daily"]);
  assert.ok(dailyNoCreds.xml.includes("<key>WFContentPredicateBoundedDate</key>\n\t\t\t\t\t\t<false/>"));
  assert.ok(dailyNoCreds.xml.includes("<key>Operator</key>\n\t\t\t\t\t\t\t\t\t<integer>1001</integer>"));
  assert.ok(dailyNoCreds.xml.includes("<key>Number</key>\n\t\t\t\t\t\t\t\t\t\t<string>1</string>"));
  assert.ok(dailyNoCreds.xml.includes("<key>Unit</key>\n\t\t\t\t\t\t\t\t\t\t<integer>16</integer>"));
  assert.ok(!dailyNoCreds.xml.includes("<integer>1002</integer>"));
  assert.ok(!dailyNoCreds.xml.includes("<string>VO2 Max</string>"));
  assert.ok(!dailyNoCreds.xml.includes("<string>Cardio Fitness</string>"));
  assert.ok(dailyNoCreds.xml.includes("<string>Oxygen Saturation</string>"));
  assert.ok(!dailyNoCreds.xml.includes("<string>Blood Oxygen</string>"));
  assert.ok(dailyNoCreds.xml.includes("<key>WFHKSampleFilteringGroupBy</key>\n\t\t\t\t<string>Hour</string>"));

  // Passing serverOrigin & token in universal mode STILL strips them cleanly
  const recent = buildIronlogRecentWorkoutShortcut({
    serverOrigin: secretOrigin,
    token: secretToken,
    activityType: "running",
    windowMinutes: 30,
    useImportQuestions: true,
  });
  makeUniversalChecks(recent, ["/api/integrations/apple-health/workouts"]);

  const evtStart = buildIronlogEventShortcut({
    event: "start",
    serverOrigin: secretOrigin,
    token: secretToken,
    useImportQuestions: true,
  });
  makeUniversalChecks(evtStart, ["/api/integrations/apple-health/events"]);

  const evtEnd = buildIronlogEventShortcut({
    event: "end",
    serverOrigin: secretOrigin,
    token: secretToken,
    activityType: "traditionalStrengthTraining",
    useImportQuestions: true,
  });
  makeUniversalChecks(evtEnd, [
    "/api/integrations/apple-health/events/active?activityType=traditionalStrengthTraining",
    "/api/integrations/apple-health/events",
  ]);
});

test("packages/web/src/lib/shortcut-gen generates unified all-in-one Apple Health smart hub shortcut", () => {
  const secretToken = "tok_hub_secret_888";
  const secretOrigin = "https://hub-secret.example.com";

  const hubUniversal = buildIronlogUnifiedAppleHubShortcut({
    serverOrigin: secretOrigin,
    token: secretToken,
    activityType: "traditionalStrengthTraining",
    windowMinutes: 45,
    metrics: ["steps", "restingEnergyKcal", "dietaryEnergyKcal", "sleepSamples", "hrvMs", "bloodOxygenPct"],
    useImportQuestions: true,
  });

  assert.equal(hubUniversal.filename, `${DEFAULT_APPLE_HUB_SHORTCUT_NAME}.shortcut`);
  assert.equal(hubUniversal.shortcutName, DEFAULT_APPLE_HUB_SHORTCUT_NAME);
  assert.equal(hubUniversal.windowMinutes, 45);
  assert.equal(hubUniversal.metricCount, 6);
  assert.ok(hubUniversal.xml.includes("<key>WFContentPredicateBoundedDate</key>\n\t\t\t\t\t\t<false/>"));
  assert.ok(hubUniversal.xml.includes("<key>Operator</key>\n\t\t\t\t\t\t\t\t\t<integer>1001</integer>"));
  assert.ok(hubUniversal.xml.includes("<key>Number</key>\n\t\t\t\t\t\t\t\t\t\t<string>1</string>"));
  assert.ok(hubUniversal.xml.includes("<key>Unit</key>\n\t\t\t\t\t\t\t\t\t\t<integer>16</integer>"));
  assert.ok(!hubUniversal.xml.includes("<integer>1002</integer>"));
  assert.ok(hubUniversal.xml.includes("<key>WFHKSampleFilteringGroupBy</key>\n\t\t\t\t<string>Hour</string>"));
  assert.ok(hubUniversal.xml.includes("<string>Resting Calories</string>"));
  assert.ok(!hubUniversal.xml.includes("<string>Resting Energy</string>"));
  assert.ok(hubUniversal.xml.includes("<string>Dietary Calories</string>"));
  assert.ok(!hubUniversal.xml.includes("<string>Dietary Energy</string>"));
  assert.ok(!hubUniversal.xml.includes("<string>VO2 Max</string>"));
  assert.ok(!hubUniversal.xml.includes("<string>Cardio Fitness</string>"));
  assert.ok(hubUniversal.xml.includes("<string>Oxygen Saturation</string>"));
  assert.ok(!hubUniversal.xml.includes("<string>Blood Oxygen</string>"));
  assert.ok(!hubUniversal.xml.includes(secretToken), "universal hub shortcut must not embed literal token");
  assert.ok(!hubUniversal.xml.includes(secretOrigin), "universal hub shortcut must not embed literal origin");
  assertBalancedPlistContainers(hubUniversal.xml);

  // Supports Shortcut Input + ImportQuestions at exact indices 1 and 2
  assert.ok(hubUniversal.xml.includes("<key>WFWorkflowHasShortcutInputVariables</key>\n\t<true/>"));
  assert.ok(hubUniversal.xml.includes("<key>ActionIndex</key>\n\t\t\t<integer>1</integer>"));
  assert.ok(hubUniversal.xml.includes("<key>ActionIndex</key>\n\t\t\t<integer>2</integer>"));
  const actionIds = [...hubUniversal.xml.matchAll(/<key>WFWorkflowActionIdentifier<\/key>\s*<string>([^<]+)<\/string>/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(actionIds.slice(0, 3), [
    "is.workflow.actions.comment",
    "is.workflow.actions.gettext",
    "is.workflow.actions.gettext",
  ]);

  // Menu fallback + ExtensionInput conditional routing
  assert.ok(hubUniversal.xml.includes("<string>ExtensionInput</string>"));
  assert.ok(hubUniversal.xml.includes("is.workflow.actions.choosefrommenu"));
  for (const label of ["上报传统力量开始", "上报有氧开始", "结束训练并同步心率热量", "同步今日健康数据", "选择有氧方式"]) {
    assert.ok(hubUniversal.xml.includes(`<string>${label}</string>`), `contains menu item ${label}`);
  }
  for (const mode of ["strength", "strength:functional", "strength:core", "cardio", "cardio:indoor_run", "cardio:stair_climbing", "end", "daily"]) {
    assert.ok(
      hubUniversal.xml.includes(`<key>WFConditionalActionString</key>\n\t\t\t\t<string>${mode}</string>`),
      `contains conditional route for ${mode}`,
    );
  }
  const startWorkoutCount = (hubUniversal.xml.match(/<string>is\.workflow\.actions\.workout\.start<\/string>/g) ?? []).length;
  assert.equal(startWorkoutCount, 0, `expected 0 Start Workout actions in silent mode, got ${startWorkoutCount}`);
  assert.ok(!hubUniversal.xml.includes("com.apple.SessionTrackerApp"));
  assert.ok(hubUniversal.xml.includes("[v2026.11.27-r13]"));
  assert.ok(hubUniversal.xml.includes("<key>WFWorkflowClientVersion</key>\n\t<string>5203.0.1</string>"));
  assert.ok(hubUniversal.xml.includes("<string>is.workflow.actions.nothing</string>"));
  assert.ok(hubUniversal.xml.includes("<string>functionalStrengthTraining</string>"));
  assert.ok(hubUniversal.xml.includes("<string>coreTraining</string>"));
  assert.ok(hubUniversal.xml.includes("<string>stairClimbing</string>"));
  assert.ok(hubUniversal.xml.includes("<string>running</string>"));
  const openAppCount = (hubUniversal.xml.match(/<string>is\.workflow\.actions\.openapp<\/string>/g) ?? []).length;
  assert.equal(openAppCount, 0, `expected 0 openapp actions in silent mode, got ${openAppCount}`);
  assert.ok(!hubUniversal.xml.includes("com.apple.Fitness"));
  assert.ok(!hubUniversal.xml.includes("fitnessapp://"));
  assert.ok(hubUniversal.xml.includes("<key>WFHKSampleFilteringGroupBy</key>\n\t\t\t\t<string>Day</string>"));
  const endWorkoutCount = (hubUniversal.xml.match(/<string>is\.workflow\.actions\.workout\.end<\/string>/g) ?? []).length;
  assert.equal(endWorkoutCount, 0, `expected 0 End Workout actions in silent mode, got ${endWorkoutCount}`);
  assert.ok(!hubUniversal.xml.includes("<key>Magnitude</key>\n\t\t\t\t\t\t<string>45</string>"), "hub end branch must not fabricate 45-min fallback workout");

  // Magic variable endpoints & headers
  assert.ok(hubUniversal.xml.includes("<string>Bearer &#xFFFC;</string>"));
  for (const p of [
    "/api/integrations/apple-health/events",
    "/api/integrations/apple-health/events/active?activityType=traditionalStrengthTraining",
    "/api/integrations/apple-health/events/active?activityType=any&amp;closeShort=1",
    "/api/integrations/apple-health/daily",
  ]) {
    assert.ok(hubUniversal.xml.includes(`<string>&#xFFFC;${p}</string>`), `contains magic path ${p}`);
  }
  assert.ok(!hubUniversal.xml.includes("/api/integrations/apple-health/workouts"), "hub shortcut must not upload synthetic fallback workouts");
  assert.ok(hubUniversal.xml.includes("<string>distanceMode</string>"));
  assert.ok(hubUniversal.xml.includes("<string>Walking + Running Distance</string>"));
  assert.ok(hubUniversal.xml.includes("<string>Cycling Distance</string>"));
  assert.ok(hubUniversal.xml.includes("<string>Swimming Distance</string>"));

  assert.equal(hubUniversal.base64, encodeShortcutXmlToBase64(hubUniversal.xml));
  assert.equal(Buffer.from(hubUniversal.base64, "base64").toString("utf8"), hubUniversal.xml);

  // Pre-filled mode embeds exact URLs & Bearer token cleanly
  const hubPrefilled = buildIronlogUnifiedAppleHubShortcut({
    serverOrigin: secretOrigin,
    token: secretToken,
    metrics: ["steps"],
    useImportQuestions: false,
  });
  assert.equal(hubPrefilled.filename, "铁记-Apple健康全能联动.shortcut");
  assertBalancedPlistContainers(hubPrefilled.xml);
  assert.ok(hubPrefilled.xml.includes("<key>WFWorkflowHasShortcutInputVariables</key>\n\t<true/>"));
  assert.ok(hubPrefilled.xml.includes("<key>WFWorkflowImportQuestions</key>\n\t<array/>"));
  assert.ok(hubPrefilled.xml.includes(`Bearer ${secretToken}`));
  assert.ok(hubPrefilled.xml.includes(`${secretOrigin}/api/integrations/apple-health/events`));
  assert.ok(!hubPrefilled.xml.includes(`${secretOrigin}/api/integrations/apple-health/workouts`));
  assert.ok(hubPrefilled.xml.includes(`${secretOrigin}/api/integrations/apple-health/daily`));
  assert.equal(Buffer.from(hubPrefilled.base64, "base64").toString("utf8"), hubPrefilled.xml);
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

test("query-cache invalidation detaches old requests and preserves unrelated requests", async () => {
  invalidateQueryCache();
  const options = { userId: "audit-owner", epoch: 1 };
  const key = "/api/web/analytics?days=30";
  let finishOld!: (value: string) => void;
  let finishNew!: (value: string) => void;
  let finishOther!: (value: string) => void;
  const old = cachedQuery(key, () => new Promise((resolve) => { finishOld = resolve; }), options);
  const other = cachedQuery("/api/web/other", () => new Promise((resolve) => { finishOther = resolve; }), options);

  invalidateQueryCache(options.userId, "/api/web/analytics");
  const latest = cachedQuery(key, () => new Promise((resolve) => { finishNew = resolve; }), options);
  finishOld("old");
  assert.equal(await old, "old");
  assert.equal(peekQuery(key, options.userId), undefined);
  const deduplicated = cachedQuery(key, async () => "duplicate", options);
  finishNew("latest");
  finishOther("other");
  assert.equal(await latest, "latest");
  assert.equal(await deduplicated, "latest");
  assert.equal(await other, "other");
  assert.equal(peekQuery(key, options.userId)?.data, "latest");
  assert.equal(peekQuery("/api/web/other", options.userId)?.data, "other");
});

test("browser login takes priority over the local demo and survives reload", async (t) => {
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { hostname: "127.0.0.1" } });
  t.after(() => {
    if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
    else Reflect.deleteProperty(globalThis, "location");
    configureApi({});
    useAuthStore.setState(useAuthStore.getInitialState(), true);
  });
  configureApi({
    getDemoToken: () => useAuthStore.getState().demoToken,
    getUserId: () => useAuthStore.getState().userId,
  });
  let hasSession = true;
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, options?: RequestInit) => {
    requests.push(input);
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("X-Ironlog-Account"), null);
    if (input === "/auth/web/login") {
      assert.equal(headers.get("Authorization"), null);
      hasSession = true;
      return Response.json({ userId: "owner-account" });
    }
    if (input === "/auth/web-demo") return Response.json({ token: "fixture-demo-token" });
    assert.equal(input, "/api/me");
    if (headers.get("Authorization") === "Bearer fixture-demo-token") return Response.json({ userId: "demo-account" });
    return hasSession ? Response.json({ userId: "owner-account" }) : Response.json({ error: "请先登录" }, { status: 401 });
  });

  await useAuthStore.getState().bootstrap();
  assert.deepEqual(requests, ["/api/me"]);
  assert.equal(useAuthStore.getState().userId, "owner-account");
  assert.equal(useAuthStore.getState().demo, false);

  useAuthStore.setState(useAuthStore.getInitialState(), true);
  hasSession = false;
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().userId, "demo-account");
  assert.equal(useAuthStore.getState().demo, true);
  await useAuthStore.getState().authenticate("login", "owner", "example1234");
  assert.equal(useAuthStore.getState().userId, "owner-account");
  assert.equal(useAuthStore.getState().demoToken, "");
});

test("offline replay stops before sending another item after switching accounts", async (t) => {
  const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  t.after(() => {
    if (localDescriptor) Object.defineProperty(globalThis, "localStorage", localDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (onlineDescriptor) Object.defineProperty(navigator, "onLine", onlineDescriptor);
    else Reflect.deleteProperty(navigator, "onLine");
    useAuthStore.setState(useAuthStore.getInitialState(), true);
    useUiStore.setState(useUiStore.getInitialState(), true);
  });
  useAuthStore.setState({ userId: "old-account", demoToken: "" });
  enqueueMutation(storage, "old-account", { opId: "item-one", path: "/api/records", body: { id: "old" } });
  enqueueMutation(storage, "old-account", { opId: "item-two", path: "/api/records", body: { id: "unsent" } });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const sent: string[] = [];
  t.mock.method(globalThis, "fetch", async (_path: string, opts?: RequestInit) => {
    sent.push(new Headers(opts?.headers).get("X-Ironlog-Account") ?? "");
    await pending;
    return Response.json({ ok: true });
  });
  const flushing = useUiStore.getState().syncOfflineQueue("old-account");
  useAuthStore.setState({ userId: "new-account" });
  release();
  await flushing;
  assert.deepEqual(sent, ["old-account"]);
  assert.equal(readQueue(storage, "old-account")[0]?.opId, "item-two");
  assert.deepEqual(readQueue(storage, "new-account"), []);
});

test("packages/web/src/styles/ironlog.css fixes mobile MoreSheet horizontal overflow and 2x2 footer clipping", () => {
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");
  assert.match(css, /\.more-sheet-body[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.more-shortcuts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(
    css,
    /\.more-foot\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(css, /dialog\.mobile-sheet\s*\{[\s\S]*?max-height:\s*88dvh;[\s\S]*?overflow-x:\s*hidden;/);
});

test("packages/web/src/styles/ironlog.css defines cohesive Settings accordions, 2x2 grids, segments, and scoped mobile headers", () => {
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");
  assert.match(css, /\.settings-content\s+\.segments\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(css, /\.settings-accordion\s*\{[\s\S]*?border-radius:\s*12px;/);
  assert.match(css, /\.settings-quick-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.settings-backup-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.panel-head\s+\.heading-actions\s*\{[\s\S]*?width:\s*auto;[\s\S]*?display:\s*inline-flex;/);
  assert.match(css, /\.shortcut-action-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.settings-content\s+\.settings-form\s*>\s*\.form-section:first-child\s*\{[\s\S]*?border-top:\s*0;/);
  assert.match(css, /\.diet-toolbar-actions\s*>\s*:last-child:nth-child\(odd\)\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
  assert.match(css, /\.workout-apple-chip\s*\{[\s\S]*?display:\s*inline-flex;/);
  assert.match(css, /\.analytics-subnav\s+\.segments\s*\{[\s\S]*?grid-auto-flow:\s*column;/);
});

test("AnalyticsView and OverviewView expose statistics categories and a dedicated sleep report", () => {
  const analytics = readFileSync(resolve(process.cwd(), "packages/web/src/views/AnalyticsView.tsx"), "utf8");
  const overview = readFileSync(resolve(process.cwd(), "packages/web/src/views/OverviewView.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  assert.match(analytics, /\["sleep", "睡眠"\]/);
  assert.match(analytics, /<SleepReportPanel\b/);
  assert.match(analytics, /type ReportCategory = "all" \| "training" \| "progress" \| "apple";/);
  assert.match(analytics, /className=\{`kpi-card kpi-card-btn/);
  for (const label of ["负荷恢复", "肌群力量", "体态饮食", "睡眠", "周期报表"]) {
    assert.ok(analytics.includes(label), `expected analytics category ${label}`);
  }
  const bodyIdx = analytics.indexOf('{activeSection === "body" ? (');
  const reportIdx = analytics.indexOf('{activeSection === "reports" ? (');
  const physioIdx = analytics.indexOf('id="panel-nutrition-physio"');
  assert.ok(bodyIdx > 0 && reportIdx > bodyIdx && physioIdx > bodyIdx && physioIdx < reportIdx);

  assert.match(overview, /className="overview-stats-cats"/);
  assert.match(overview, /is-single-panel/);
  assert.match(overview, /navigate\("analytics"\)/);

  assert.match(css, /\.kpi-card-btn\s*\{/);
  assert.match(css, /\.report-cat-bar,\s*[\r\n]+\.overview-stats-cats\s*\{/);
  assert.match(css, /\.analytics-deck > \.analytics-panel:only-child,/);
  assert.match(css, /\.dashboard\.is-single-panel\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
});

test("AppShell, OverviewView, DietView, and WorkoutView preserve all features with clean hierarchy and Bento CSS", () => {
  const shell = readFileSync(resolve(process.cwd(), "packages/web/src/components/AppShell.tsx"), "utf8");
  const overview = readFileSync(resolve(process.cwd(), "packages/web/src/views/OverviewView.tsx"), "utf8");
  const diet = readFileSync(resolve(process.cwd(), "packages/web/src/views/DietView.tsx"), "utf8");
  const workout = readFileSync(resolve(process.cwd(), "packages/web/src/views/WorkoutView.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  assert.match(shell, /className="primary-button sidebar-quick-cta"/);
  assert.match(shell, /className="nav-group-label"/);
  assert.match(shell, /MOBILE_TABS/);

  assert.match(overview, /today-cta-pill/);
  assert.match(overview, /day\.nutrition\.protein/);
  assert.match(overview, /is-two-panel/);
  assert.match(overview, /is-single-panel/);

  assert.match(diet, /className="diet-budget-strip"/);
  assert.match(diet, /className="food-macro-sub"/);

  assert.match(workout, /className=\{`pr-wall-card/);
  assert.match(workout, /className="workout-row-exercises"/);

  assert.match(css, /\.sidebar-quick-cta\s*\{/);
  assert.match(css, /\.today-cta-pill\s*\{/);
  assert.match(css, /\.diet-budget-strip\s*\{/);
  assert.match(css, /\.diet-summary\s*\{[\s\S]*?position:\s*sticky;/);
  assert.match(css, /\.dashboard:not\(\.is-two-panel\):not\(\.is-single-panel\) > #panel-weight/);
  assert.match(css, /\.pr-wall-grid\s*\{[\s\S]*?grid-auto-flow:\s*column;/);
});

test("DeviceSetupModal implements a 5-step guided setup wizard without removing export or signing tools", () => {
  const modal = readFileSync(resolve(process.cwd(), "packages/web/src/components/apple/AppleHealthModals.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  assert.match(modal, /type WizardStep = 1 \| 2 \| 3 \| 4 \| 5;/);
  assert.match(modal, /className="shortcut-wizard-stepper"/);
  assert.match(modal, /className="shortcut-wizard-foot"/);
  assert.match(modal, /shortcut-cred-card/);
  assert.match(modal, /triggerAppleHubAction\("daily"/);
  assert.match(modal, /https:\/\/sign\.shortcuty\.app/);
  assert.match(modal, /https:\/\/routinehub\.co/);
  assert.match(modal, /buildMacSignCommand/);
  assert.match(modal, /buildIronlogUnifiedAppleHubShortcut/);
  assert.match(modal, /buildIronlogAutomationShortcut/);
  assert.doesNotMatch(modal, /单独导出单项快捷指令/);

  assert.match(css, /\.shortcut-wizard-stepper\s*\{/);
  assert.match(css, /\.shortcut-wizard-foot\s*\{/);
  assert.match(css, /\.shortcut-cred-card\s*\{/);
  assert.match(css, /\.shortcut-verify-status\s*\{/);
});

test("WorkoutEditorModal fixes plan source validation, implements single-exercise swipe pager, and ensures Apple launch", () => {
  const editor = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const appleFitness = readFileSync(resolve(process.cwd(), "packages/web/src/lib/apple-fitness.ts"), "utf8");
  const planModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/plan/PlanModals.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  assert.match(editor, /function normalizeWorkoutSource/);
  assert.ok(!editor.includes('source: "plan"'), "must never emit invalid workout source 'plan'");
  assert.match(editor, /useState<"single" \| "all">/);
  assert.match(editor, /className="workout-swipe-stage"/);
  assert.match(editor, /className="workout-pager-bar"/);
  assert.match(editor, /下一个动作/);
  assert.match(editor, /className="session-menu-overlay workout-finish-overlay"/);
  assert.match(editor, /completeAllPending/);

  assert.match(appleFitness, /function launchIosUrlScheme/);
  assert.match(appleFitness, /window\.location\.href\s*=\s*url/);
  assert.doesNotMatch(appleFitness, /link\.style\.display\s*=\s*"none"/);
  assert.doesNotMatch(planModals, /className="preview-apple-row"/);
  assert.doesNotMatch(planModals, /className="preview-apple-modes"/);
  assert.match(editor, /buildAppleHubActionUrl/);

  assert.match(css, /\.workout-pager-bar\s*\{/);
  assert.match(css, /\.workout-finish-overlay\s/);
  assert.match(css, /\.workout-swipe-stage\s*\{/);
  assert.match(css, /\.set-row\.is-next\s*\{/);
});

test("AppShell renders LiveWorkoutBar inside .frame flow without floating overlay or crowded topbar draft pill", () => {
  const shell = readFileSync(resolve(process.cwd(), "packages/web/src/components/AppShell.tsx"), "utf8");
  const liveBar = readFileSync(resolve(process.cwd(), "packages/web/src/components/LiveWorkoutBar.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  const frameIdx = shell.indexOf('<div className="frame">');
  const liveBarIdx = shell.indexOf("<LiveWorkoutBar />", frameIdx);
  const mainIdx = shell.indexOf('<main id="content"', frameIdx);
  assert.ok(frameIdx > 0 && liveBarIdx > frameIdx && mainIdx > liveBarIdx);
  assert.ok(!shell.includes("live-resume-pill"), "AppShell topbar must not emit redundant live-resume-pill");
  assert.match(liveBar, /live-workout-bar-discard/);

  const barRule = css.match(/\.live-workout-bar\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(barRule, /position:\s*relative;/);
  assert.doesNotMatch(barRule, /position:\s*fixed;/);
});

test("PWA uses autoUpdate, apiFetch surfaces Zod details, and WorkoutEditorModal sanitizes payload fields", () => {
  const viteConfig = readFileSync(resolve(process.cwd(), "packages/web/vite.config.ts"), "utf8");
  const mainTsx = readFileSync(resolve(process.cwd(), "packages/web/src/main.tsx"), "utf8");
  const apiTs = readFileSync(resolve(process.cwd(), "packages/web/src/lib/api.ts"), "utf8");
  const editor = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const planModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/plan/PlanModals.tsx"), "utf8");

  assert.match(viteConfig, /registerType:\s*"autoUpdate"/);
  assert.match(viteConfig, /skipWaiting:\s*true/);
  assert.match(viteConfig, /clientsClaim:\s*true/);
  assert.match(mainTsx, /visibilitychange/);
  assert.match(mainTsx, /randomUUID/);

  assert.match(apiTs, /detailPath/);
  assert.match(apiTs, /detailMsg/);

  assert.match(editor, /function sanitizeTargetSnapshot/);
  assert.match(editor, /function sanitizeExerciseSnapshot/);
  assert.match(editor, /takeUniqueId/);
  assert.match(planModals, /function safeUuid/);
});

test("WorkoutEditorModal highlights active jump circle, preserves finished active ring, and auto-scrolls dot", () => {
  const editor = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  assert.match(editor, /is-active/);
  assert.match(editor, /aria-current=\{isCurrent \? "step" : undefined\}/);
  assert.match(editor, /jumpRefs\.current\[safeExIdx\]\?\.scrollIntoView/);

  assert.match(css, /\.jump-circle\.is-active/);
  assert.match(css, /\.jump-circle\.finished\.is-active/);
  assert.match(css, /justify-content:\s*center;/);
  assert.match(css, /background:\s*var\(--red\);/);
});

test("De-AI refinement removes viewfinder brackets & OpenGym label, isolates guest auth, gates AI buttons, and keeps MatrixText", () => {
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");
  const shell = readFileSync(resolve(process.cwd(), "packages/web/src/components/AppShell.tsx"), "utf8");
  const authStore = readFileSync(resolve(process.cwd(), "packages/web/src/store/useAuthStore.ts"), "utf8");
  const editor = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const overview = readFileSync(resolve(process.cwd(), "packages/web/src/views/OverviewView.tsx"), "utf8");
  const workout = readFileSync(resolve(process.cwd(), "packages/web/src/views/WorkoutView.tsx"), "utf8");
  const diet = readFileSync(resolve(process.cwd(), "packages/web/src/views/DietView.tsx"), "utf8");
  const plan = readFileSync(resolve(process.cwd(), "packages/web/src/views/PlanView.tsx"), "utf8");
  const badges = readFileSync(resolve(process.cwd(), "packages/web/src/views/BadgesView.tsx"), "utf8");
  const calendar = readFileSync(resolve(process.cwd(), "packages/web/src/views/CalendarView.tsx"), "utf8");
  const exercises = readFileSync(resolve(process.cwd(), "packages/web/src/views/ExercisesView.tsx"), "utf8");
  const tabs = readFileSync(resolve(process.cwd(), "packages/web/src/components/WorkspaceTabs.tsx"), "utf8");
  const quickSheet = readFileSync(resolve(process.cwd(), "packages/web/src/components/QuickRecordSheet.tsx"), "utf8");
  const reportModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutReportModal.tsx"), "utf8");

  assert.match(css, /--bg:\s*#09090b/);
  assert.match(css, /--surface:\s*#111216/);
  assert.match(css, /\.guest-shell\s*\{/);
  assert.match(css, /\.top \.quick-record-pill\s*\{/);

  assert.match(shell, /isGuestAuth/);
  assert.match(shell, /className="guest-shell"/);
  assert.match(authStore, /aiReady/);
  assert.ok(!editor.includes("OpenGym 预设"), "internal OpenGym preset label must be removed");

  for (const [name, content] of [
    ["OverviewView", overview],
    ["PlanView", plan],
    ["BadgesView", badges],
    ["CalendarView", calendar],
    ["ExercisesView", exercises],
    ["WorkspaceTabs", tabs],
  ] as const) {
    assert.ok(!content.includes("vf-c"), `${name} must not emit viewfinder corner brackets`);
  }

  assert.ok(!overview.includes("hero-sublink"), "Overview hero must not duplicate today workout sublink");
  assert.ok(!workout.includes("openAiWorkoutModal"), "WorkoutView hero should not expose standalone AI button");
  assert.ok(!diet.includes("openAiDietModal"), "DietView toolbar should not expose standalone AI button");
  assert.match(quickSheet, /aiReady/);
  assert.match(reportModal, /aiReady \?/);
  assert.match(overview, /MatrixText/);
  assert.match(diet, /MatrixText/);
});

test("Mobile PWA ergonomics sync theme-color, auto-select numeric inputs, add per-set ref chip, and animate swipe card", () => {
  const html = readFileSync(resolve(process.cwd(), "packages/web/index.html"), "utf8");
  const viteConfig = readFileSync(resolve(process.cwd(), "packages/web/vite.config.ts"), "utf8");
  const uiStore = readFileSync(resolve(process.cwd(), "packages/web/src/store/useUiStore.ts"), "utf8");
  const editor = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  assert.match(html, /meta name="theme-color" content="#09090b"/);
  assert.match(viteConfig, /background_color:\s*"#09090b"/);
  assert.match(viteConfig, /theme_color:\s*"#09090b"/);
  assert.match(uiStore, /theme === "light" \? "#f6f6f3" : "#09090b"/);

  assert.match(editor, /e\.currentTarget\.select\(\)/);
  assert.match(editor, /className="set-ref-chip"/);
  assert.match(css, /\.set-ref-chip\s*\{/);
  assert.match(css, /@keyframes workoutCardIn/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("Complete feature & analytics pack connects 180/365d views, diet scaler, inline cues, progressive prefill, deload mode, and new dashboards", () => {
  const useAnalyticsTs = readFileSync(resolve(process.cwd(), "packages/web/src/hooks/useAnalytics.ts"), "utf8");
  const analyticsView = readFileSync(resolve(process.cwd(), "packages/web/src/views/AnalyticsView.tsx"), "utf8");
  const dietModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/diet/DietEditorModal.tsx"), "utf8");
  const workoutModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const planView = readFileSync(resolve(process.cwd(), "packages/web/src/views/PlanView.tsx"), "utf8");
  const planModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/plan/PlanModals.tsx"), "utf8");
  const sleepPanel = readFileSync(resolve(process.cwd(), "packages/web/src/components/SleepReportPanel.tsx"), "utf8");

  assert.match(useAnalyticsTs, /180,\s*365/);
  assert.doesNotMatch(sleepPanel, /timeZone:\s*"Asia\/Hong_Kong"/);

  assert.match(dietModal, /\/api\/web\/profile\/quick-foods/);
  assert.match(dietModal, /className="diet-scaler-bar"/);
  assert.match(dietModal, /存为常用单品/);

  assert.match(workoutModal, /\/api\/web\/exercise-notes/);
  assert.match(workoutModal, /className="ex-apply-prog"/);
  assert.match(workoutModal, /className="deload-banner"/);

  assert.match(planView, /deload-card/);
  assert.match(planModals, /applyDeloadToTarget/);

  assert.match(analyticsView, /panel-sleep-training/);
  assert.match(analyticsView, /panel-plan-adherence/);
  assert.match(analyticsView, /panel-who-cardio/);
  assert.match(analyticsView, /panel-plateaus/);
  assert.match(analyticsView, /panel-rep-max/);
  assert.match(analyticsView, /panel-nutrition-daily/);
  assert.match(analyticsView, /panel-body-measurements/);
  assert.match(analyticsView, /key=\{`\$\{p\.date\}-\$\{i\}`\}/);
});

test("Audit fixes harden diet upsert rollback, assisted ref/prog math, draft conflict guard, and logout reset", () => {
  const dietModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/diet/DietEditorModal.tsx"), "utf8");
  const workoutModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const openers = readFileSync(resolve(process.cwd(), "packages/web/src/lib/record-openers.tsx"), "utf8");
  const authStore = readFileSync(resolve(process.cwd(), "packages/web/src/store/useAuthStore.ts"), "utf8");
  const appShell = readFileSync(resolve(process.cwd(), "packages/web/src/components/AppShell.tsx"), "utf8");

  assert.match(dietModal, /\{\s*upsert:\s*item\s*\}/);
  assert.match(dietModal, /\{\s*removeId:\s*q\.id\s*\}/);
  assert.match(dietModal, /hasUnit:\s*boolean/);

  assert.match(workoutModal, /const isAssisted = mode === "assisted"/);
  assert.match(workoutModal, /s\.type === "warmup"/);
  assert.match(workoutModal, /updateSet\(\s*exIdx,/);
  assert.match(workoutModal, /persistDraftRef\.current\(\)/);
  assert.match(workoutModal, /baseVersion:/);

  assert.match(openers, /替换进行中的训练草稿/);
  assert.match(openers, /parsed\.baseVersion/);
  assert.match(authStore, /resetLocalWorkoutPreferences\(\)/);
  assert.match(appShell, /清空冲突条目/);
});

test("Watch-first Apple Health UI exposes one-tap automation copy panel and removes legacy launch clutter", () => {
  const quickSheet = readFileSync(resolve(process.cwd(), "packages/web/src/components/QuickRecordSheet.tsx"), "utf8");
  const workoutView = readFileSync(resolve(process.cwd(), "packages/web/src/views/WorkoutView.tsx"), "utf8");
  const settingsView = readFileSync(resolve(process.cwd(), "packages/web/src/views/SettingsView.tsx"), "utf8");
  const workoutModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const appleModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/apple/AppleHealthModals.tsx"), "utf8");
  const cardioModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/apple/CardioLauncherModal.tsx"), "utf8");
  const planModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/plan/PlanModals.tsx"), "utf8");
  const reportModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutReportModal.tsx"), "utf8");

  // One-tap automation copy panel & live sync status card are exported and embedded
  const overviewView = readFileSync(resolve(process.cwd(), "packages/web/src/views/OverviewView.tsx"), "utf8");
  const recordOpeners = readFileSync(resolve(process.cwd(), "packages/web/src/lib/record-openers.tsx"), "utf8");
  const clipboard = readFileSync(resolve(process.cwd(), "packages/web/src/lib/clipboard.ts"), "utf8");

  assert.match(appleModals, /export function AppleAutomationCopyPanel/);
  assert.match(appleModals, /export function AppleSyncStatusCard/);
  assert.match(appleModals, /APPLE_AUTOMATION_SHORTCUT_PRESETS/);
  assert.match(appleModals, /buildIronlogAutomationShortcut/);
  assert.match(settingsView, /<AppleAutomationCopyPanel/);
  assert.match(settingsView, /<AppleSyncStatusCard/);
  assert.match(settingsView, /iPhone 自动化快捷指令/);
  assert.match(overviewView, /\/api\/integrations\/apple-health\/status/);
  assert.match(overviewView, /apple-live-banner/);
  assert.match(clipboard, /contentEditable/);
  assert.match(clipboard, /createRange/);

  // Legacy launch buttons and multi-mode toggles are removed across the app
  assert.doesNotMatch(recordOpeners, /triggerAppleFitnessLaunch/);
  assert.doesNotMatch(recordOpeners, /triggerAppleCardioLaunch/);
  assert.doesNotMatch(quickSheet, /openCardioLauncherModal/);
  assert.doesNotMatch(quickSheet, /有氧运动（Apple 健身）/);
  assert.doesNotMatch(workoutView, /openCardioLauncherModal/);
  assert.doesNotMatch(workoutView, /Apple 有氧/);
  assert.doesNotMatch(settingsView, /openCardioLauncherModal/);
  assert.doesNotMatch(settingsView, /openStrengthLauncherModal/);
  assert.doesNotMatch(settingsView, /按项目直开/);
  assert.doesNotMatch(settingsView, /直接打开苹果健身 App/);
  assert.doesNotMatch(planModals, /开练同步拉起 Apple 健身/);
  assert.doesNotMatch(planModals, /openStrengthLauncherModal/);
  assert.doesNotMatch(planModals, /openCardioLauncherModal/);
  assert.doesNotMatch(workoutModal, /开练自动跳转 Apple 健身/);
  assert.doesNotMatch(workoutModal, /\/api\/integrations\/apple-health\/session-start/);
  assert.doesNotMatch(workoutModal, /openCardioLauncherModal/);
  assert.doesNotMatch(workoutModal, /openStrengthLauncherModal/);

  // Manual fallback and report visibility + short-poll refresh remain intact
  assert.match(workoutModal, /triggerAppleHubAction\("end"/);
  assert.match(reportModal, /visibilitychange/);
  assert.match(reportModal, /setInterval/);
  assert.match(cardioModal, /APPLE_CARDIO_PRESETS/);
  assert.match(cardioModal, /APPLE_STRENGTH_PRESETS/);
});

test("Live cardio session supports background wall-clock timing, laps, pace, calories, and Shortcut end binding", () => {
  const storeMap = new Map<string, string>();
  const prevStorage = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => storeMap.get(k) ?? null,
    setItem: (k: string, v: string) => { storeMap.set(k, v); },
    removeItem: (k: string) => { storeMap.delete(k); },
    clear: () => { storeMap.clear(); },
  };
  try {
    const runPreset = getAppleCardioPreset("outdoor_run")!;
    const t0 = Date.parse("2026-11-25T10:00:00.000Z");
    const started = startCardioSession("u-cardio", runPreset, { now: t0, targetMinutes: 30 });
    assert.ok(started);
    assert.equal(started.presetId, "outdoor_run");
    assert.equal(started.targetMinutes, 30);
    assert.equal(startCardioSession("u-cardio", getAppleCardioPreset("indoor_run")!)?.id, started.id);

    // Simulating background/locked screen for 12m 30s without any timer ticks
    const reloaded = readCardioSession("u-cardio");
    assert.ok(reloaded);
    const t1 = t0 + 750_000;
    assert.equal(elapsedAt(reloaded.timing, t1), 750);

    // Record lap at 12:30, pause for 2 minutes, resume and advance another 5 minutes
    const lapped = recordCardioLap(reloaded, t1);
    assert.equal(lapped.laps.length, 1);
    assert.equal(lapped.laps[0]!.splitSeconds, 750);

    const paused = toggleCardioSessionPause(lapped, t1);
    assert.equal(paused.timing.runningSince, null);
    assert.equal(elapsedAt(paused.timing, t1 + 120_000), 750);

    const resumed = toggleCardioSessionPause(paused, t1 + 120_000);
    assert.ok(resumed.timing.runningSince);
    const t2 = t1 + 120_000 + 300_000;
    assert.equal(elapsedAt(resumed.timing, t2), 1050);

    const lap2 = recordCardioLap(resumed, t2);
    assert.equal(lap2.laps.length, 2);
    assert.equal(lap2.laps[1]!.splitSeconds, 300);
    assert.equal(lap2.laps[1]!.cumulativeSeconds, 1050);

    // Pace, cycling speed, and calorie estimates
    assert.deepEqual(formatCardioPaceOrSpeed("running", 1500, "5"), { label: "配速", value: "5'00\"/km" });
    assert.deepEqual(formatCardioPaceOrSpeed("cycling", 1800, "12"), { label: "均速", value: "24.0 km/h" });
    assert.ok(estimateCardioCalories("running", 1800) > 250);

    assert.equal(requestCardioAppleSync("u-cardio", lap2, t2), true);
    const pending = readCardioSession("u-cardio")!;
    assert.equal(elapsedAt(pending.timing, t2 + 60_000), 1050);
    const corresponding = {
      activityType: "running", environment: "outdoor", startedAt: pending.startedAt,
      endedAt: new Date(t2 + 5000).toISOString(),
    };
    assert.equal(matchesCardioAppleWorkout(pending, corresponding), true);
    assert.equal(matchesCardioAppleWorkout(pending, { ...corresponding, environment: "indoor" }), false);
    assert.equal(matchesCardioAppleWorkout(pending, { ...corresponding, endedAt: new Date(t2 - 300_000).toISOString() }), false);
    assert.equal(toggleCardioSessionPause(pending, t2 + 5000).appleSyncRequestedAt, undefined);
    clearCardioSession("u-cardio");
    assert.equal(readCardioSession("u-cardio"), null);

    // Sanity check createCardioSession defaults
    const pure = createCardioSession(runPreset, { now: t0 });
    assert.equal(pure.targetMinutes, null);
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as Record<string, unknown>).localStorage;
    } else {
      (globalThis as Record<string, unknown>).localStorage = prevStorage;
    }
  }

  // Structural verification of CardioSessionModal, CardioLauncherModal, LiveWorkoutBar, and record-openers
  const sessionModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/apple/CardioSessionModal.tsx"), "utf8");
  const launcherModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/apple/CardioLauncherModal.tsx"), "utf8");
  const liveBar = readFileSync(resolve(process.cwd(), "packages/web/src/components/LiveWorkoutBar.tsx"), "utf8");
  const openers = readFileSync(resolve(process.cwd(), "packages/web/src/lib/record-openers.tsx"), "utf8");

  assert.match(sessionModal, /buildAppleHubActionUrl\("end"/);
  assert.match(sessionModal, /visibilitychange/);
  assert.match(sessionModal, /pageshow/);
  assert.match(sessionModal, /结束有氧并同步 Apple Watch/);
  assert.match(sessionModal, /后台计时/);
  assert.match(launcherModal, /startCardioSession/);
  assert.match(launcherModal, /onStartedCardio/);
  assert.match(liveBar, /readCardioSession/);
  assert.match(liveBar, /openCardioSessionModal/);
  assert.match(liveBar, /buildAppleHubActionUrl\("end"/);
  assert.match(openers, /openCardioSessionModal/);
});

test("日历截断以完整字符计数，并限制带中点的长标签", () => {
  assert.equal(fullWorkoutTag("Tempo run!"), "Tempo run!");
  assert.equal(fullWorkoutTag("Tempo run!!"), "Tempo run!");
  assert.equal(fullWorkoutTag("123456789🏃‍♀️ club"), "123456789🏃‍♀️");
  assert.equal(fullWorkoutTag("很长的腿部训练·深蹲和硬拉"), "很长·深蹲");
  assert.equal(compactWorkoutTag("🏃‍♀️晨跑"), "🏃‍♀️晨");
});

test("清除登录状态保留原账号的有氧、力量草稿和离线队列", () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousAuth = useAuthStore.getState();
  const active = "test-logout-owner";
  const other = "test-other-account";
  const strengthKey = `ironlog-web-draft:${active}:new`;
  const cardioKey = `ironlog-web-cardio-session:${active}`;
  const queueKey = `ironlog-offline-queue:${active}`;
  const storage = {
    [strengthKey]: "strength-draft",
    [cardioKey]: "cardio-draft",
    [queueKey]: "[]",
    getItem(key: string) { return (this as Record<string, unknown>)[key] ?? null; },
    removeItem(key: string) { delete (this as Record<string, unknown>)[key]; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  try {
    useAuthStore.setState({ userId: active });
    useAuthStore.getState().clearUser();
    assert.equal(useAuthStore.getState().userId, "");
    assert.equal(storage.getItem(strengthKey), "strength-draft");
    assert.equal(storage.getItem(cardioKey), "cardio-draft");
    assert.equal(storage.getItem(queueKey), "[]");
    assert.equal(readCardioSession(other), null);
  } finally {
    useAuthStore.setState(previousAuth);
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("退出失败保留登录状态，成功回执后才清理", async () => {
  const originalFetch = globalThis.fetch;
  const previousAuth = useAuthStore.getState();
  const account = { userId: "logout-audit", demo: false, username: "logout-audit" };
  let status = 503;
  globalThis.fetch = async () => Response.json({ ok: status === 200 }, { status });
  try {
    useAuthStore.setState(account);
    await assert.rejects(useAuthStore.getState().logout(), /尚未确认退出/);
    assert.equal(useAuthStore.getState().userId, account.userId);
    status = 200;
    await useAuthStore.getState().logout();
    assert.equal(useAuthStore.getState().userId, "");
  } finally {
    globalThis.fetch = originalFetch;
    useAuthStore.setState(previousAuth);
  }
});

test("Batch 1 P0 fixes: clearFailedMutations preserves healthy items, offline cold-start preserves session, and UI guards exist", async () => {
  const storeMap = new Map<string, string>();
  const mockStorage: Storage = {
    get length() { return storeMap.size; },
    clear: () => storeMap.clear(),
    getItem: (k: string) => storeMap.get(k) ?? null,
    key: (i: number) => [...storeMap.keys()][i] ?? null,
    removeItem: (k: string) => { storeMap.delete(k); },
    setItem: (k: string, v: string) => { storeMap.set(k, v); },
  };
  const uid = "batch1-user";
  enqueueMutation(mockStorage, uid, { opId: "op-bad", path: "/api/records", body: { id: "1" }, label: "冲突项" });
  enqueueMutation(mockStorage, uid, { opId: "op-good", path: "/api/records", body: { id: "2" }, label: "正常项" });
  await flushQueue(mockStorage, uid, async (_path, opts) => {
    const id = (opts.body as { id?: string })?.id;
    if (id === "1") throw Object.assign(new Error("版本冲突"), { status: 409 });
    throw new TypeError("offline");
  });
  const before = readQueue(mockStorage, uid);
  assert.equal(before.length, 2);
  assert.ok(before.find((i) => i.opId === "op-bad")?.failure);
  assert.ok(!before.find((i) => i.opId === "op-good")?.failure);

  const removed = clearFailedMutations(mockStorage, uid);
  assert.equal(removed, 1);
  const after = readQueue(mockStorage, uid);
  assert.deepEqual(after.map((i) => i.opId), ["op-good"]);

  // Offline cold-start preserves cached session instead of kicking user to AuthScreen
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalFetch = globalThis.fetch;
  const previousAuth = useAuthStore.getState();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: mockStorage });
  try {
    useAuthStore.setState({ demo: false, userId: "", username: "", booted: false, offlineBoot: false });
    useAuthStore.getState().applyAccountMeta({ userId: "offline-u1", username: "gymrat", appleHealthConnected: true });
    useAuthStore.setState({ userId: "", username: "", booted: false, offlineBoot: false });
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await useAuthStore.getState().bootstrap();
    assert.equal(useAuthStore.getState().userId, "offline-u1");
    assert.equal(useAuthStore.getState().offlineBoot, true);
    assert.equal(useAuthStore.getState().booted, true);
  } finally {
    globalThis.fetch = originalFetch;
    useAuthStore.setState(previousAuth);
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }

  // Contract checks for remaining Batch 1 fixes
  const weightView = readFileSync(resolve(process.cwd(), "packages/web/src/views/WeightView.tsx"), "utf8");
  const measureModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/weight/MeasurementModal.tsx"), "utf8");
  const dayDossier = readFileSync(resolve(process.cwd(), "packages/web/src/components/calendar/DayDossier.tsx"), "utf8");
  const overviewView = readFileSync(resolve(process.cwd(), "packages/web/src/views/OverviewView.tsx"), "utf8");
  const analyticsView = readFileSync(resolve(process.cwd(), "packages/web/src/views/AnalyticsView.tsx"), "utf8");
  const appleModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/apple/AppleHealthModals.tsx"), "utf8");
  const appShell = readFileSync(resolve(process.cwd(), "packages/web/src/components/AppShell.tsx"), "utf8");

  assert.match(weightView, /todayMeasurement/);
  assert.match(measureModal, /handleDateChange/);
  assert.match(measureModal, /已自动载入/);
  assert.doesNotMatch(dayDossier, /baseVersion:\s*0\s*\}/);
  assert.match(dayDossier, /override\?\.version/);
  assert.match(appShell, /clearFailedMutations/);
  assert.match(overviewView, /latestAppleToday/);
  assert.match(analyticsView, /targetGoalMode/);
  assert.match(analyticsView, /确认同步饮食目标/);
  assert.match(appleModals, /\/api\/integrations\/apple-health\/active-session/);
  assert.match(appleModals, /删除此条记录/);
  assert.match(appleModals, /写体感与备注/);
});

test("Batch 2 P1 upgrades: superset auto-alternation defers rest until round completes, and live workout ergonomics are wired", () => {
  const mkSets = (completedFlags: boolean[]) => completedFlags.map((completed) => ({ completed }));
  const ssExercises = [
    { supersetGroup: "A", sets: mkSets([false, false]) },
    { supersetGroup: "A", sets: mkSets([false, false]) },
    { supersetGroup: null, sets: mkSets([false]) },
  ];

  // A1 done -> jump to B1 without starting rest
  const t1 = resolveSupersetTransition(ssExercises, 0, 0);
  assert.deepEqual(t1, { inSuperset: true, shouldStartRest: false, nextExerciseIdx: 1, reason: "next_partner" });

  // After A1 is complete, completing B1 finishes round 1 -> start rest & loop back to A (idx 0)
  ssExercises[0]!.sets[0]!.completed = true;
  const t2 = resolveSupersetTransition(ssExercises, 1, 0);
  assert.deepEqual(t2, { inSuperset: true, shouldStartRest: true, nextExerciseIdx: 0, reason: "round_complete_loop" });

  // Round 2: A2 done -> jump to B2 without rest
  ssExercises[1]!.sets[0]!.completed = true;
  const t3 = resolveSupersetTransition(ssExercises, 0, 1);
  assert.deepEqual(t3, { inSuperset: true, shouldStartRest: false, nextExerciseIdx: 1, reason: "next_partner" });

  // B2 done -> entire superset complete -> start rest
  ssExercises[0]!.sets[1]!.completed = true;
  const t4 = resolveSupersetTransition(ssExercises, 1, 1);
  assert.deepEqual(t4, { inSuperset: true, shouldStartRest: true, nextExerciseIdx: null, reason: "superset_complete" });

  // Non-superset exercise -> normal rest behavior
  const tSingle = resolveSupersetTransition(ssExercises, 2, 0);
  assert.deepEqual(tSingle, { inSuperset: false, shouldStartRest: true, nextExerciseIdx: null, reason: "single" });

  // Contract checks for Batch 2 files
  const editor = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const picker = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/ExercisePickerModal.tsx"), "utf8");
  const liveBar = readFileSync(resolve(process.cwd(), "packages/web/src/components/LiveWorkoutBar.tsx"), "utf8");
  const planModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/plan/PlanModals.tsx"), "utf8");
  const workoutView = readFileSync(resolve(process.cwd(), "packages/web/src/views/WorkoutView.tsx"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "packages/web/src/styles/ironlog.css"), "utf8");

  assert.match(editor, /resolveSupersetTransition/);
  assert.match(editor, /manualDurationMin/);
  assert.match(editor, /一键补勾剩余/);
  assert.match(editor, /swapToBackupExercise/);
  assert.match(editor, /set-undo-bar/);
  assert.match(picker, /multiple/);
  assert.match(picker, /handleLoadMore/);
  assert.match(picker, /openCustomExerciseModal/);
  assert.match(liveBar, /handleTogglePauseRest/);
  assert.match(liveBar, /handleSkipRest/);
  assert.match(planModals, /backupExerciseId/);
  assert.match(workoutView, /丢弃未保存训练草稿/);
  assert.match(css, /\.live-workout-bar-stack\s*\{[^}]*position:\s*sticky;/);
});

test("Batch 3 P2 polish: diet save-and-continue, water -250ml/unmark, draft edit/delete, weight ranges, password/nav/share fixes", () => {
  const dietModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/diet/DietEditorModal.tsx"), "utf8");
  const dietView = readFileSync(resolve(process.cwd(), "packages/web/src/views/DietView.tsx"), "utf8");
  const weightModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/weight/WeightEditorModal.tsx"), "utf8");
  const weightView = readFileSync(resolve(process.cwd(), "packages/web/src/views/WeightView.tsx"), "utf8");
  const planModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/plan/PlanModals.tsx"), "utf8");
  const authScreen = readFileSync(resolve(process.cwd(), "packages/web/src/components/AuthScreen.tsx"), "utf8");
  const appShell = readFileSync(resolve(process.cwd(), "packages/web/src/components/AppShell.tsx"), "utf8");
  const cmdk = readFileSync(resolve(process.cwd(), "packages/web/src/components/CommandPaletteModal.tsx"), "utf8");
  const exercisesView = readFileSync(resolve(process.cwd(), "packages/web/src/views/ExercisesView.tsx"), "utf8");
  const shareCard = readFileSync(resolve(process.cwd(), "packages/web/src/lib/share-card.ts"), "utf8");
  const shareModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/share/ShareCardModal.tsx"), "utf8");
  const analyticsView = readFileSync(resolve(process.cwd(), "packages/web/src/views/AnalyticsView.tsx"), "utf8");

  assert.match(dietModal, /保存并继续/);
  assert.match(dietModal, /移除常用单品/);
  assert.match(dietModal, /PROFILE_VERSION_EVENT/);
  assert.match(dietView, /-250ml/);
  assert.match(dietView, /取消标记/);
  assert.match(dietView, /\/api\/web\/profile\/water-goal/);
  assert.match(weightModal, /前天/);
  assert.match(weightModal, /toFixed\(2\)/);
  assert.match(weightView, /chartRange/);
  assert.match(weightView, /180天/);
  assert.match(planModals, /编辑草稿/);
  assert.match(planModals, /删除草稿/);
  assert.match(authScreen, /showPassword/);
  assert.doesNotMatch(authScreen, /\[A-Za-z0-9\]\{10,128\}/);
  assert.match(appShell, /view === target/);
  assert.match(cmdk, /userId && aiReady/);
  assert.match(cmdk, /customExercises/);
  assert.match(cmdk, /\.slice\(0, 30\)/);
  assert.match(exercisesView, /setMuscle\(muscle === k \? "" : k\)/);
  assert.match(exercisesView, /继续向后检索更多动作/);
  const sleepPanel = readFileSync(resolve(process.cwd(), "packages/web/src/components/SleepReportPanel.tsx"), "utf8");
  const settingsView = readFileSync(resolve(process.cwd(), "packages/web/src/views/SettingsView.tsx"), "utf8");

  assert.match(shareCard, /effectiveToday/);
  assert.match(shareModal, /长按上方海报/);
  assert.match(analyticsView, /\^\[=\+\\-@\\t\\r\]/);
  assert.match(analyticsView, /onPointerDown/);
  assert.match(dietView, /customWaterOpen/);
  assert.match(settingsView, /showPwd/);
  assert.match(appShell, /!online \|\| offlineBoot/);
  assert.match(sleepPanel, /pageSize/);
});
