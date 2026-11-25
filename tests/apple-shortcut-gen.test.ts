import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLE_HEALTH_AUTO_METRICS,
  APPLE_HEALTH_DAILY_GROUPS,
  APPLE_HEALTH_DEFAULT_METRICS,
  APPLE_SHORTCUT_HEALTH_LOCALES,
  APPLE_SHORTCUT_SPORTS,
  assessServerOrigin,
  buildIronlogDailyHealthShortcut,
  buildIronlogEventShortcut,
  buildIronlogRecentWorkoutShortcut,
  buildMacSignCommand,
  normalizeServerOrigin,
} from "../web/src/shortcut-gen.js";

/** Verify basic XML plist structural integrity (<plist><dict>, balanced tags, alternating <key>/value inside <dict>). */
function assertValidPlistStructure(xml: string) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<!DOCTYPE plist PUBLIC"));
  assert.ok(xml.includes('<plist version="1.0">'));

  const tagRe = /<\/?([A-Za-z0-9_-]+)(?:\s+[^>]*)?\/?>/g;
  const stack: Array<{ tag: string; expectingValue?: boolean; itemCount?: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml))) {
    const full = match[0];
    const tag = match[1];
    if (full.endsWith("/>")) {
      const parent = stack[stack.length - 1];
      if (parent?.tag === "dict") {
        assert.equal(parent.expectingValue, true, `Self-closing <${tag}/> unexpected where <key> expected`);
        parent.expectingValue = false;
        parent.itemCount = (parent.itemCount ?? 0) + 1;
      }
      continue;
    }
    if (full.startsWith("</")) {
      const top = stack.pop();
      assert.ok(top, `Unexpected closing </${tag}>`);
      assert.equal(top.tag, tag, `Mismatched closing tag </${tag}> for <${top.tag}>`);
      if (tag === "dict") {
        assert.notEqual(top.expectingValue, true, "Plist <dict> ended after a <key> without a value");
      }
      continue;
    }
    if (tag === "plist") {
      stack.push({ tag });
      continue;
    }
    const parent = stack[stack.length - 1];
    if (parent?.tag === "dict") {
      if (tag === "key") {
        assert.notEqual(parent.expectingValue, true, "Two consecutive <key> tags inside <dict>");
        parent.expectingValue = true;
      } else {
        assert.equal(parent.expectingValue, true, `Value <${tag}> inside <dict> missing preceding <key>`);
        parent.expectingValue = false;
        parent.itemCount = (parent.itemCount ?? 0) + 1;
      }
    }
    if (tag === "dict" || tag === "array" || tag === "string" || tag === "integer" || tag === "key") {
      stack.push({ tag, expectingValue: tag === "dict" ? false : undefined, itemCount: 0 });
    }
  }
  assert.equal(stack.length, 0, `Unclosed XML tags remaining: ${JSON.stringify(stack)}`);
}

test("buildIronlogEventShortcut 生成结构完整的 Apple Shortcuts XML plist 与参数", () => {
  const dateUuid = "11111111-1111-4111-8111-111111111111";
  const reqUuid = "22222222-2222-4222-8222-222222222222";
  const start = buildIronlogEventShortcut({
    event: "start",
    serverOrigin: "https://ironlog.example.com/",
    token: "ih_testToken_123456",
    activityType: "traditionalStrengthTraining",
    uuids: { date: dateUuid, request: reqUuid },
  });

  assert.equal(start.filename, "铁记-开始-传统力量训练.shortcut");
  assert.equal(start.endpoint, "https://ironlog.example.com/api/integrations/apple-health/events");
  assertValidPlistStructure(start.xml);

  assert.ok(!start.xml.includes("is.workflow.actions.format.date"));
  assert.ok(start.xml.includes("<string>WFDateFormatVariableAggrandizement</string>"));
  assert.ok(start.xml.includes("<string>ISO 8601</string>"));
  assert.ok(start.xml.includes("<key>WFISO8601IncludeTime</key>"));
  assert.ok(start.xml.includes("<string>is.workflow.actions.downloadurl</string>"));
  assert.ok(start.xml.includes("<string>https://ironlog.example.com/api/integrations/apple-health/events</string>"));
  assert.ok(start.xml.includes("<string>Bearer ih_testToken_123456</string>"));
  assert.ok(start.xml.includes("<integer>3</integer>"));
  assert.ok(start.xml.includes("<string>schemaVersion</string>"));
  assert.ok(start.xml.includes("<string>&#xFFFC;</string>"));
  assert.ok(start.xml.includes(`<string>${dateUuid}</string>`));
  assert.ok(start.xml.includes("<string>indoor</string>"));

  const end = buildIronlogEventShortcut({
    event: "end",
    serverOrigin: "https://ironlog.example.com/subpath/",
    token: "ih_testToken_123456",
    activityType: "running",
  });
  assert.equal(end.filename, "铁记-结束-跑步.shortcut");
  assert.equal(end.endpoint, "https://ironlog.example.com/subpath/api/integrations/apple-health/events");
  assertValidPlistStructure(end.xml);
  assert.ok(end.xml.includes("<string>outdoor</string>"));
  assert.ok(end.xml.includes("<string>end</string>"));
});

test("buildIronlogEventShortcut 严格校验入参并转义特殊 XML 字符", () => {
  const escaped = buildIronlogEventShortcut({
    event: "start",
    serverOrigin: "https://fit.example.com:8443",
    token: "ih_a<b&c>\"",
    activityType: "cycling",
    environment: "indoor",
  });
  assertValidPlistStructure(escaped.xml);
  assert.ok(escaped.xml.includes("<string>Bearer ih_a&lt;b&amp;c&gt;&quot;</string>"));

  assert.throws(() => buildIronlogEventShortcut({ event: "pause" as "start", serverOrigin: "https://a.com", token: "ih_1" }));
  assert.throws(() => buildIronlogEventShortcut({ event: "start", serverOrigin: "ftp://a.com", token: "ih_1" }));
  assert.throws(() => buildIronlogEventShortcut({ event: "start", serverOrigin: "https://a.com", token: "bad token" }));
  assert.throws(() => buildIronlogEventShortcut({ event: "start", serverOrigin: "https://a.com", token: "ih_1", activityType: "123bad" }));
  assert.throws(() => buildIronlogEventShortcut({ event: "start", serverOrigin: "https://a.com", token: "ih_1", environment: "space" }));
});

test("normalizeServerOrigin 与 assessServerOrigin 正确识别本地地址与公网 HTTPS", () => {
  assert.equal(normalizeServerOrigin(" https://gym.example.com/// "), "https://gym.example.com");
  const loopback = assessServerOrigin("http://127.0.0.1:4177");
  assert.equal(loopback.valid, true);
  assert.equal(loopback.isLoopback, true);
  assert.match(loopback.warning, /iPhone 无法直连 localhost/);

  const httpRemote = assessServerOrigin("http://192.168.1.20:4177");
  assert.equal(httpRemote.valid, true);
  assert.equal(httpRemote.isLoopback, false);
  assert.equal(httpRemote.isPlainHttp, true);
  assert.match(httpRemote.warning, /HTTPS/);

  const httpsRemote = assessServerOrigin("https://ironlog.example.com");
  assert.equal(httpsRemote.valid, true);
  assert.equal(httpsRemote.warning, "");

  const macCmd = buildMacSignCommand();
  assert.ok(macCmd.includes("plutil -convert binary1"));
  assert.ok(macCmd.includes("shortcuts sign --mode anyone"));
  assert.ok(APPLE_SHORTCUT_SPORTS.length >= 9);
  assert.equal(APPLE_HEALTH_DAILY_GROUPS.length, 5);
  assert.ok("zh-Hans" in APPLE_SHORTCUT_HEALTH_LOCALES);
  assert.ok("en" in APPLE_SHORTCUT_HEALTH_LOCALES);
});

test("buildIronlogDailyHealthShortcut 生成近 1 天查询并携带按日归档所需的日期", () => {
  let seq = 0;
  const daily = buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dailyToken_123456",
    uuidFactory: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  });

  assert.equal(daily.filename, "铁记-每日全量健康同步.shortcut");
  assert.equal(daily.endpoint, "https://ironlog.example.com/api/integrations/apple-health/daily");
  assert.equal(daily.locale, "zh-Hans");
  assert.equal(daily.metricCount, 21);
  assertValidPlistStructure(daily.xml);

  // Health filters and date-stamped HealthKit samples.
  for (const needle of [
    "is.workflow.actions.filter.health.quantity",
    "is.workflow.actions.properties.health.quantity",
    "is.workflow.actions.statistics",
    "is.workflow.actions.conditional",
    "is.workflow.actions.repeat.each",
    "is.workflow.actions.setvariable",
    "WFStringSubstitutableState",
    "<key>WFContentPredicateBoundedDate</key>\n\t\t\t\t\t\t<false/>",
    "<key>Operator</key>\n\t\t\t\t\t\t\t\t\t<integer>1002</integer>",
    "<key>Operator</key>\n\t\t\t\t\t\t\t\t\t<integer>1001</integer>",
    "<key>Number</key>\n\t\t\t\t\t\t\t\t\t\t<integer>1</integer>",
    "<key>Unit</key>\n\t\t\t\t\t\t\t\t\t\t<integer>16</integer>",
    "<key>WFContentItemLimitNumber</key>\n\t\t\t\t<integer>1</integer>",
    "<string>Steps</string>",
    "<string>count</string>",
    "<string>Active Calories</string>",
    "<string>Resting Calories</string>",
    "<string>Walking + Running Distance</string>",
    "<string>Flights Climbed</string>",
    "<string>Sleep</string>",
    "<string>Weight</string>",
    "<string>Body Fat Percentage</string>",
    "<string>Lean Body Mass</string>",
    "<string>Body Mass Index</string>",
    "<string>Waist Circumference</string>",
    "<string>Resting Heart Rate</string>",
    "<string>Heart Rate Variability</string>",
    "<string>Oxygen Saturation</string>",
    "<string>Water</string>",
    "<string>Dietary Calories</string>",
    "<string>Protein</string>",
    "v_sleepSamples",
    "v_steps",
    "v_activeEnergyKcal",
    "heartRateBpmMeasuredAt",
    "weightMeasuredAt",
    "bodyFatMeasuredAt",
    "Bearer ih_dailyToken_123456",
  ]) {
    assert.ok(daily.xml.includes(needle), `Expected generated daily shortcut XML to contain ${needle}`);
  }

  // Must use canonical HealthKit keys, Operator 1002 ("is today") for dailySum (Hour for Steps, Day for others),
  // and relative 1-day Operator 1001 for sleep/latest metrics
  assert.ok(!daily.xml.includes("<integer>1000</integer>"));
  assert.ok(!daily.xml.includes("<key>WFContentPredicateBoundedDate</key>\n\t\t\t\t\t\t<true/>"));
  assert.ok(daily.xml.includes("<key>WFHKSampleFilteringGroupBy</key>\n\t\t\t\t<string>Hour</string>"));
  assert.ok(daily.xml.includes("<key>WFHKSampleFilteringGroupBy</key>\n\t\t\t\t<string>Day</string>"));
  assert.ok(!daily.xml.includes("<string>步数</string>"));
  assert.ok(!daily.xml.includes("<string>体重</string>"));
  assert.ok(!daily.xml.includes("<string>Cardio Fitness</string>"));
  assert.ok(!daily.xml.includes("<string>VO2 Max</string>"));
  assert.ok(!daily.xml.includes("<string>Blood Oxygen</string>"));
  assert.ok(!daily.xml.includes("<string>Resting Energy</string>"));
  assert.ok(!daily.xml.includes("<string>Dietary Energy</string>"));
  assert.ok(!daily.xml.includes("stepsSamples"));
  assert.ok(!daily.xml.includes("activeEnergyKcalSamples"));

  // Optional English locale remains valid and emits identical canonical keys
  const english = buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dailyToken_123456",
    locale: "en",
  });
  assert.equal(english.locale, "en");
  assertValidPlistStructure(english.xml);
  for (const needle of ["<string>Steps</string>", "<string>Water</string>", "<string>Protein</string>", "<string>Resting Calories</string>", "<string>Dietary Calories</string>"]) {
    assert.ok(english.xml.includes(needle), `Expected English shortcut XML to contain ${needle}`);
  }

  // Subset group filtering, empty-group validation, and invalid locale rejection
  const subset = buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dailyToken_123456",
    groups: ["sleep", "body"],
  });
  assert.equal(subset.metricCount, 6);
  assertValidPlistStructure(subset.xml);
  assert.ok(!subset.xml.includes("<string>Steps</string>"));
  assert.ok(!subset.xml.includes("WFHKSampleFilteringGroupBy"));
  assert.throws(() => buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dailyToken_123456",
    groups: ["nonexistent"],
  }));
  assert.throws(() => buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dailyToken_123456",
    locale: "fr" as "zh-Hans",
  }));
});


test("buildIronlogEventShortcut end 默认延迟并查询开放训练时长以采集窗口热量、心率与距离", () => {
  const endRunning = buildIronlogEventShortcut({
    event: "end",
    serverOrigin: "https://ironlog.example.com",
    token: "ih_endToken_123456",
    activityType: "running",
    locale: "zh-Hans",
  });
  assert.equal(endRunning.filename, "铁记-结束-跑步.shortcut");
  assertValidPlistStructure(endRunning.xml);
  assert.ok(endRunning.xml.includes("<string>is.workflow.actions.delay</string>"));
  assert.ok(endRunning.xml.includes("https://ironlog.example.com/api/integrations/apple-health/events/active?activityType=running"));
  assert.ok(endRunning.xml.includes("<string>elapsedMinutes</string>"));
  assert.ok(endRunning.xml.includes("<string>is.workflow.actions.adjustdate</string>"));
  assert.ok(endRunning.xml.includes("<integer>1003</integer>"));
  assert.ok(endRunning.xml.includes("<key>AnotherDate</key>"));
  assert.ok(endRunning.xml.includes("<key>WFContentPredicateBoundedDate</key>\n\t\t\t\t\t\t<false/>"));
  assert.ok(!endRunning.xml.includes("<integer>64</integer>"), "Find Health Samples must not use Unit 64 (Minutes)");
  assert.ok(endRunning.xml.includes("<string>Active Calories</string>"));
  assert.ok(endRunning.xml.includes("<string>Walking + Running Distance</string>"));
  assert.ok(endRunning.xml.includes("<string>Heart Rate</string>"));
  assert.ok(endRunning.xml.includes("<string>is.workflow.actions.statistics</string>"));
  assert.ok(endRunning.xml.includes("<string>is.workflow.actions.count</string>"));
  const statAndCountBlocks = [
    ...endRunning.xml.matchAll(
      /<string>is\.workflow\.actions\.(?:statistics|count)<\/string>[\s\S]*?<key>WFWorkflowActionParameters<\/key>\s*<dict>([\s\S]*?)\n\t\t\t<\/dict>/g,
    ),
  ];
  assert.ok(statAndCountBlocks.length >= 2);
  for (const m of statAndCountBlocks) {
    assert.ok(m[1]!.includes("<key>Input</key>"));
    assert.ok(!m[1]!.includes("<key>WFInput</key>"), "statistics/count actions must not emit duplicate WFInput");
  }
  assert.ok(endRunning.xml.includes("https://ironlog.example.com/api/integrations/apple-health/events"));

  const minimalEnd = buildIronlogEventShortcut({
    event: "end",
    serverOrigin: "https://ironlog.example.com",
    token: "ih_endToken_123456",
    activityType: "stairClimbing",
    collectMetrics: false,
  });
  assertValidPlistStructure(minimalEnd.xml);
  assert.ok(!minimalEnd.xml.includes("is.workflow.actions.delay"));
  assert.ok(!minimalEnd.xml.includes("events/active"));
});

test("buildIronlogRecentWorkoutShortcut 支持全运动类型单条直传并正确区分距离样本与中英文", () => {
  const stair = buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_recentToken_123456",
    activityType: "stairClimbing",
    windowMinutes: 30,
    locale: "zh-Hans",
  });
  assert.equal(stair.filename, "铁记-结束直传-爬楼机.shortcut");
  assert.equal(stair.endpoint, "https://ironlog.example.com/api/integrations/apple-health/workouts");
  assertValidPlistStructure(stair.xml);
  assert.ok(stair.xml.includes("<string>is.workflow.actions.delay</string>"));
  assert.ok(stair.xml.includes("<string>is.workflow.actions.adjustdate</string>"));
  assert.ok(stair.xml.includes("<string>Subtract</string>"));
  assert.ok(stair.xml.includes("<key>Magnitude</key>\n\t\t\t\t\t\t<string>30</string>"));
  assert.ok(stair.xml.includes("<string>Minutes</string>"));
  assert.ok(stair.xml.includes("<string>trigger</string>"));
  assert.ok(stair.xml.includes("<string>event_elapsed</string>"));
  assert.ok(stair.xml.includes("<string>stairClimbing</string>"));
  assert.ok(stair.xml.includes("<string>Active Calories</string>"));
  assert.ok(stair.xml.includes("<string>Heart Rate</string>"));
  assert.ok(!stair.xml.includes("<string>Walking + Running Distance</string>"));
  assert.ok(!stair.xml.includes("<string>distanceKm</string>"));

  const runEn = buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_recentToken_123456",
    activityType: "running",
    windowMinutes: 60,
    locale: "en",
  });
  assertValidPlistStructure(runEn.xml);
  assert.ok(runEn.xml.includes("<string>Active Calories</string>"));
  assert.ok(runEn.xml.includes("<string>Walking + Running Distance</string>"));
  assert.ok(runEn.xml.includes("<string>Heart Rate</string>"));
  assert.ok(runEn.xml.includes("<string>distanceKm</string>"));
  assert.ok(runEn.xml.includes("<key>Magnitude</key>\n\t\t\t\t\t\t<string>60</string>"));

  const cycling = buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_recentToken_123456",
    activityType: "cycling",
  });
  assert.ok(cycling.xml.includes("<string>Cycling Distance</string>"));
  assert.ok(cycling.xml.includes("<string>distanceKm</string>"));

  const swimming = buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_recentToken_123456",
    activityType: "swimming",
  });
  assert.ok(swimming.xml.includes("<string>Swimming Distance</string>"));
  assert.ok(swimming.xml.includes("<string>distanceMeters</string>"));

  assert.throws(() => buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_recentToken_123456",
    windowMinutes: 2,
  }));
  assert.throws(() => buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_recentToken_123456",
    windowMinutes: 45,
    locale: "jp" as "zh-Hans",
  }));
});


test("全部快捷指令均采用内联 WFDateFormatVariableAggrandizement 格式化 ISO 8601 且不再依赖 format.date", () => {
  const start = buildIronlogEventShortcut({
    event: "start",
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dateToken_123456",
  });
  const end = buildIronlogEventShortcut({
    event: "end",
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dateToken_123456",
    activityType: "mixedCardio",
  });
  const recent = buildIronlogRecentWorkoutShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dateToken_123456",
  });
  const daily = buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_dateToken_123456",
  });

  for (const xml of [start.xml, end.xml, recent.xml, daily.xml]) {
    assertValidPlistStructure(xml);
    assert.ok(xml.includes("<string>is.workflow.actions.date</string>"));
    assert.ok(xml.includes("<string>Current Date</string>"));
    assert.ok(!xml.includes("<string>CurrentDate</string>"));
    assert.ok(!xml.includes("is.workflow.actions.format.date"), "shortcuts must use inline Aggrandizements instead of format.date");
    assert.ok(xml.includes("<string>WFDateFormatVariableAggrandizement</string>"));
    assert.ok(xml.includes("<string>ISO 8601</string>"));
    assert.ok(xml.includes("<key>WFISO8601IncludeTime</key>"));
  }

  assert.ok(daily.xml.includes("<string>Duration</string>"));
  assert.ok(daily.xml.includes("&#xFFFC;|&#xFFFC;|&#xFFFC;|&#xFFFC;"));
  assert.ok(daily.xml.includes("<string>shortcutGenVersion</string>"));
  assert.ok(daily.xml.includes("<string>3</string>"));
});


test("buildIronlogDailyHealthShortcut 支持按单指标精确筛选生成以避开 iOS 空指标弹窗", () => {
  const custom = buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_metricToken_123456",
    metrics: ["steps", "activeEnergyKcal", "weightKg"],
  });
  assert.equal(custom.metricCount, 3);
  assertValidPlistStructure(custom.xml);
  assert.ok(custom.xml.includes("<string>Steps</string>"));
  assert.ok(custom.xml.includes("<string>Active Calories</string>"));
  assert.ok(custom.xml.includes("<string>Weight</string>"));
  assert.ok(!custom.xml.includes("<string>Waist Circumference</string>"));
  assert.ok(!custom.xml.includes("<string>Water</string>"));
  assert.ok(!custom.xml.includes("<string>Sleep</string>"));

  assert.throws(() => buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_metricToken_123456",
    metrics: [],
  }));
});

test("默认防弹窗预设与自动体征全项预设排除高易空手录/凌晨空指标", () => {
  assert.equal(APPLE_HEALTH_DEFAULT_METRICS.length, 4);
  assert.ok(!APPLE_HEALTH_DEFAULT_METRICS.includes("restingEnergyKcal"));
  assert.equal(APPLE_HEALTH_AUTO_METRICS.length, 13);
  const excluded = [
    "restingEnergyKcal",
    "waistCm",
    "vo2Max",
    "bloodOxygenPct",
    "waterMl",
    "dietaryEnergyKcal",
    "dietaryProteinG",
    "dietaryCarbsG",
    "dietaryFatG",
  ];
  for (const key of excluded) {
    assert.ok(!APPLE_HEALTH_AUTO_METRICS.includes(key), `Auto preset must exclude ${key}`);
  }
  const autoBuilt = buildIronlogDailyHealthShortcut({
    serverOrigin: "https://ironlog.example.com",
    token: "ih_autoToken_123456",
    metrics: APPLE_HEALTH_AUTO_METRICS,
  });
  assert.equal(autoBuilt.metricCount, 13);
  assertValidPlistStructure(autoBuilt.xml);
});
