import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
    metrics: ["steps", "sleepSamples", "hrvMs"],
  });
  makeUniversalChecks(dailyNoCreds, ["/api/integrations/apple-health/daily"]);

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
    metrics: ["steps", "sleepSamples", "hrvMs"],
    useImportQuestions: true,
  });

  assert.equal(hubUniversal.filename, `${DEFAULT_APPLE_HUB_SHORTCUT_NAME}.shortcut`);
  assert.equal(hubUniversal.shortcutName, DEFAULT_APPLE_HUB_SHORTCUT_NAME);
  assert.equal(hubUniversal.windowMinutes, 45);
  assert.equal(hubUniversal.metricCount, 3);
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
  for (const label of ["开始传统力量", "打开有氧健身", "结束训练并同步心率热量", "同步今日健康数据"]) {
    assert.ok(hubUniversal.xml.includes(`<string>${label}</string>`), `contains menu item ${label}`);
  }
  for (const mode of ["strength", "cardio", "end", "daily"]) {
    assert.ok(
      hubUniversal.xml.includes(`<key>WFConditionalActionString</key>\n\t\t\t\t<string>${mode}</string>`),
      `contains conditional route for ${mode}`,
    );
  }
  assert.ok(hubUniversal.xml.includes("is.workflow.actions.openurl"));
  assert.ok(hubUniversal.xml.includes("<string>fitnessapp://</string>"));

  // Magic variable endpoints & headers
  assert.ok(hubUniversal.xml.includes("<string>Bearer &#xFFFC;</string>"));
  for (const p of [
    "/api/integrations/apple-health/events",
    "/api/integrations/apple-health/events/active?activityType=traditionalStrengthTraining",
    "/api/integrations/apple-health/workouts",
    "/api/integrations/apple-health/daily",
  ]) {
    assert.ok(hubUniversal.xml.includes(`<string>&#xFFFC;${p}</string>`), `contains magic path ${p}`);
  }

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
});
