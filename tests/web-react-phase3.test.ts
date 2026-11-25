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
import { enqueueMutation, readQueue } from "../packages/web/src/lib/offline-queue.ts";

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
  assert.ok(dailyNoCreds.xml.includes("<key>Number</key>\n\t\t\t\t\t\t\t\t\t\t<integer>1</integer>"));
  assert.ok(dailyNoCreds.xml.includes("<key>Unit</key>\n\t\t\t\t\t\t\t\t\t\t<integer>16</integer>"));
  assert.ok(!dailyNoCreds.xml.includes("<integer>1002</integer>"));
  assert.ok(!dailyNoCreds.xml.includes("<string>VO2 Max</string>"));
  assert.ok(!dailyNoCreds.xml.includes("<string>Cardio Fitness</string>"));
  assert.ok(dailyNoCreds.xml.includes("<string>Oxygen Saturation</string>"));
  assert.ok(!dailyNoCreds.xml.includes("<string>Blood Oxygen</string>"));
  assert.ok(dailyNoCreds.xml.includes("<key>WFHKSampleFilteringGroupBy</key>\n\t\t\t\t<string>Day</string>"));

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
  assert.ok(hubUniversal.xml.includes("<key>Number</key>\n\t\t\t\t\t\t\t\t\t\t<integer>1</integer>"));
  assert.ok(hubUniversal.xml.includes("<key>Unit</key>\n\t\t\t\t\t\t\t\t\t\t<integer>16</integer>"));
  assert.ok(!hubUniversal.xml.includes("<integer>1002</integer>"));
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
  for (const label of ["开始传统力量", "打开有氧健身", "结束训练并同步心率热量", "同步今日健康数据", "选择有氧方式"]) {
    assert.ok(hubUniversal.xml.includes(`<string>${label}</string>`), `contains menu item ${label}`);
  }
  for (const mode of ["strength", "strength:functional", "strength:core", "cardio", "cardio:indoor_run", "cardio:stair_climbing", "end", "daily"]) {
    assert.ok(
      hubUniversal.xml.includes(`<key>WFConditionalActionString</key>\n\t\t\t\t<string>${mode}</string>`),
      `contains conditional route for ${mode}`,
    );
  }
  assert.ok(hubUniversal.xml.includes("【传统力量训练】"));
  const startWorkoutCount = (hubUniversal.xml.match(/<string>is\.workflow\.actions\.workout\.start<\/string>/g) ?? []).length;
  assert.equal(startWorkoutCount, 16, `expected Start Workout in all 16 launch routes, got ${startWorkoutCount}`);
  assert.ok(hubUniversal.xml.includes("<key>BundleIdentifier</key>\n\t\t\t\t\t<string>com.apple.SessionTrackerApp</string>"));
  assert.ok(hubUniversal.xml.includes("<string>functionalStrengthTraining</string>"));
  assert.ok(hubUniversal.xml.includes("<string>coreTraining</string>"));
  assert.ok(hubUniversal.xml.includes("<string>stairClimbing</string>"));
  assert.ok(hubUniversal.xml.includes("<string>running</string>"));
  const openAppCount = (hubUniversal.xml.match(/<string>is\.workflow\.actions\.openapp<\/string>/g) ?? []).length;
  assert.ok(openAppCount >= 17, `expected openapp in all 16 launch routes + fallback menu, got ${openAppCount}`);
  assert.ok(hubUniversal.xml.includes("<key>WFSelectedApp</key>"));
  assert.ok(hubUniversal.xml.includes("<key>BundleIdentifier</key>\n\t\t\t\t\t<string>com.apple.Fitness</string>"));
  assert.ok(hubUniversal.xml.includes("<key>WFAppIdentifier</key>\n\t\t\t\t<string>com.apple.Fitness</string>"));
  assert.ok(!hubUniversal.xml.includes("fitnessapp://"));
  assert.ok(hubUniversal.xml.includes("<key>WFHKSampleFilteringGroupBy</key>\n\t\t\t\t<string>Day</string>"));
  assert.ok(hubUniversal.xml.includes("<key>Magnitude</key>\n\t\t\t\t\t\t<string>45</string>"));

  // Magic variable endpoints & headers
  assert.ok(hubUniversal.xml.includes("<string>Bearer &#xFFFC;</string>"));
  for (const p of [
    "/api/integrations/apple-health/events",
    "/api/integrations/apple-health/events/active?activityType=traditionalStrengthTraining",
    "/api/integrations/apple-health/events/active?activityType=any",
    "/api/integrations/apple-health/workouts",
    "/api/integrations/apple-health/daily",
  ]) {
    assert.ok(hubUniversal.xml.includes(`<string>&#xFFFC;${p}</string>`), `contains magic path ${p}`);
  }
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
  assert.ok(hubPrefilled.xml.includes(`${secretOrigin}/api/integrations/apple-health/workouts`));
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
  assert.match(modal, /buildIronlogDailyHealthShortcut/);
  assert.match(modal, /buildIronlogRecentWorkoutShortcut/);
  assert.match(modal, /buildIronlogEventShortcut/);

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
  assert.match(planModals, /className="preview-apple-row"/);
  assert.match(planModals, /className="preview-apple-modes"/);
  assert.match(editor, /buildAppleFitnessLaunchUrl/);

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

test("Cardio modality picker connects QuickRecordSheet, WorkoutView, SettingsView, WorkoutEditorModal, and CardioLauncherModal", () => {
  const quickSheet = readFileSync(resolve(process.cwd(), "packages/web/src/components/QuickRecordSheet.tsx"), "utf8");
  const workoutView = readFileSync(resolve(process.cwd(), "packages/web/src/views/WorkoutView.tsx"), "utf8");
  const settingsView = readFileSync(resolve(process.cwd(), "packages/web/src/views/SettingsView.tsx"), "utf8");
  const workoutModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutEditorModal.tsx"), "utf8");
  const cardioModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/apple/CardioLauncherModal.tsx"), "utf8");

  assert.match(quickSheet, /openCardioLauncherModal/);
  assert.match(workoutView, /openCardioLauncherModal/);
  assert.match(settingsView, /openCardioLauncherModal/);
  assert.match(settingsView, /按项目直开/);
  assert.match(workoutModal, /inferAppleCardioPreset/);
  assert.match(workoutModal, /triggerAppleCardioLaunch/);
  assert.match(workoutModal, /openCardioLauncherModal/);
  assert.match(cardioModal, /APPLE_CARDIO_PRESETS/);
  assert.match(cardioModal, /APPLE_STRENGTH_PRESETS/);
  assert.match(cardioModal, /resolveCardioShortcutName/);
  assert.match(cardioModal, /resolveStrengthShortcutName/);
  assert.match(cardioModal, /triggerAppleCardioLaunch/);
  assert.match(cardioModal, /triggerAppleStrengthLaunch/);

  const planModals = readFileSync(resolve(process.cwd(), "packages/web/src/components/plan/PlanModals.tsx"), "utf8");
  const reportModal = readFileSync(resolve(process.cwd(), "packages/web/src/components/workout/WorkoutReportModal.tsx"), "utf8");
  assert.match(settingsView, /openStrengthLauncherModal/);
  assert.match(settingsView, /appleAutoSyncOnFinish/);
  assert.match(workoutModal, /openStrengthLauncherModal/);
  assert.match(workoutModal, /\/api\/integrations\/apple-health\/session-start/);
  assert.match(workoutModal, /triggerAppleHubAction\("end"/);
  assert.match(reportModal, /visibilitychange/);
  assert.match(planModals, /openStrengthLauncherModal/);
  assert.match(planModals, /openCardioLauncherModal/);
});
