/**
 * Generates pre-configured Apple Shortcuts XML property lists (.shortcut)
 * that post workout start/end events and full daily HealthKit telemetry
 * directly to Ironlog's Apple Health API.
 * Unsigned XML plists are converted and signed on macOS via `plutil` + `shortcuts sign`.
 */

export const APPLE_SHORTCUT_SPORTS = [
  { activityType: "traditionalStrengthTraining", label: "传统力量训练", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "functionalStrengthTraining", label: "功能性力量", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "coreTraining", label: "核心训练", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "running", label: "跑步", defaultEnvironment: "outdoor", hasDistance: true, distanceMode: "foot" },
  { activityType: "cycling", label: "骑行", defaultEnvironment: "outdoor", hasDistance: true, distanceMode: "cycling" },
  { activityType: "walking", label: "步行", defaultEnvironment: "outdoor", hasDistance: true, distanceMode: "foot" },
  { activityType: "hiking", label: "徒步", defaultEnvironment: "outdoor", hasDistance: true, distanceMode: "foot" },
  { activityType: "stairClimbing", label: "爬楼机", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "stairs", label: "爬楼梯", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "elliptical", label: "椭圆机", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "rowing", label: "划船机", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "swimming", label: "游泳", defaultEnvironment: "indoor", hasDistance: true, distanceMode: "swimming" },
  { activityType: "highIntensityIntervalTraining", label: "高强度间歇", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "jumpRope", label: "跳绳", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "mixedCardio", label: "混合有氧", defaultEnvironment: "indoor", hasDistance: false },
  { activityType: "yoga", label: "瑜伽", defaultEnvironment: "indoor", hasDistance: false },
];

export const APPLE_SHORTCUT_ENVIRONMENTS = {
  indoor: "室内 (indoor)",
  outdoor: "室外 (outdoor)",
  unknown: "未指定 (unknown)",
};

export const APPLE_SHORTCUT_HEALTH_LOCALES = {
  "zh-Hans": "简体中文（iPhone 默认）",
  en: "English（英文系统）",
};

export const APPLE_SHORTCUT_RECENT_WINDOWS = {
  20: "最近 20 分钟（短时HIIT/跳绳）",
  30: "最近 30 分钟（快走/爬楼机）",
  45: "最近 45 分钟（力量/综合推荐）",
  60: "最近 60 分钟（标准有氧/跑步）",
  90: "最近 90 分钟（长训/骑行/徒步）",
};

export const APPLE_HEALTH_DAILY_GROUPS = [
  {
    id: "activity",
    label: "日常活动与消耗",
    description: "步数、活动能量、静息能量、步行 + 跑步距离、已爬楼层",
    metrics: [
      { key: "steps", typeLabel: "步数", typeLabelEn: "Steps", unit: "count", mode: "dailySum", jsonKey: "steps" },
      { key: "activeEnergyKcal", typeLabel: "活动能量", typeLabelEn: "Active Calories", unit: "kcal", mode: "dailySum", jsonKey: "activeEnergyKcal" },
      { key: "restingEnergyKcal", typeLabel: "静息能量", typeLabelEn: "Resting Calories", unit: "kcal", mode: "dailySum", jsonKey: "restingEnergyKcal", emptyHint: "凌晨易空" },
      { key: "distanceKm", typeLabel: "步行 + 跑步距离", typeLabelEn: "Walking + Running Distance", unit: "km", mode: "dailySum", jsonKey: "distanceKm" },
      { key: "flightsClimbed", typeLabel: "已爬楼层", typeLabelEn: "Flights Climbed", unit: "count", mode: "dailySum", jsonKey: "flightsClimbed" },
    ],
  },
  {
    id: "sleep",
    label: "睡眠分期与效率",
    description: "近 1 天的深睡、核心、REM、清醒与卧床，按结束日期归档",
    metrics: [
      { key: "sleepSamples", typeLabel: "睡眠", typeLabelEn: "Sleep", mode: "sleepIntervals", jsonKey: "sleepSamples" },
    ],
  },
  {
    id: "body",
    label: "体重、体脂与围度",
    description: "近 1 天的最新体重、体脂率、去脂体重、BMI 和腰围",
    metrics: [
      { key: "weightKg", typeLabel: "体重", typeLabelEn: "Weight", unit: "kg", mode: "latest", jsonKey: "weightKg", measuredAtKey: "weightMeasuredAt" },
      { key: "bodyFatPct", typeLabel: "体脂率", typeLabelEn: "Body Fat Percentage", unit: null, mode: "latest", jsonKey: "bodyFatPct", measuredAtKey: "bodyFatMeasuredAt" },
      { key: "leanBodyMassKg", typeLabel: "去脂体重", typeLabelEn: "Lean Body Mass", unit: "kg", mode: "latest", jsonKey: "leanBodyMassKg" },
      { key: "bmi", typeLabel: "身体质量指数", typeLabelEn: "Body Mass Index", unit: null, mode: "latest", jsonKey: "bmi" },
      { key: "waistCm", typeLabel: "腰围", typeLabelEn: "Waist Circumference", unit: "cm", mode: "latest", jsonKey: "waistCm", emptyHint: "需手录" },
    ],
  },
  {
    id: "vitals",
    label: "心肺与恢复体征",
    description: "静息心率、心率、心率变异性、血氧、呼吸频率",
    metrics: [
      { key: "restingHeartRateBpm", typeLabel: "静息心率", typeLabelEn: "Resting Heart Rate", unit: null, mode: "latest", jsonKey: "restingHeartRateBpm" },
      { key: "heartRateBpm", typeLabel: "心率", typeLabelEn: "Heart Rate", unit: null, mode: "latest", jsonKey: "heartRateBpm" },
      { key: "hrvMs", typeLabel: "心率变异性", typeLabelEn: "Heart Rate Variability", unit: "ms", mode: "latest", jsonKey: "hrvMs" },
      { key: "bloodOxygenPct", typeLabel: "血氧", typeLabelEn: "Oxygen Saturation", unit: null, mode: "latest", jsonKey: "bloodOxygenPct", emptyHint: "需测过" },
      { key: "respiratoryRate", typeLabel: "呼吸频率", typeLabelEn: "Respiratory Rate", unit: null, mode: "latest", jsonKey: "respiratoryRate" },
    ],
  },
  {
    id: "nutrition",
    label: "饮水与膳食营养",
    description: "Apple 健康记录的每日水、膳食能量、蛋白质、碳水化合物及总脂肪",
    metrics: [
      { key: "waterMl", typeLabel: "水", typeLabelEn: "Water", unit: "mL", mode: "dailySum", jsonKey: "waterMl", emptyHint: "需手录" },
      { key: "dietaryEnergyKcal", typeLabel: "膳食能量", typeLabelEn: "Dietary Calories", unit: "kcal", mode: "dailySum", jsonKey: "dietaryEnergyKcal", emptyHint: "需手录" },
      { key: "dietaryProteinG", typeLabel: "蛋白质", typeLabelEn: "Protein", unit: "g", mode: "dailySum", jsonKey: "dietaryProteinG", emptyHint: "需手录" },
      { key: "dietaryCarbsG", typeLabel: "碳水化合物", typeLabelEn: "Carbohydrates", unit: "g", mode: "dailySum", jsonKey: "dietaryCarbsG", emptyHint: "需手录" },
      { key: "dietaryFatG", typeLabel: "总脂肪", typeLabelEn: "Total Fat", unit: "g", mode: "dailySum", jsonKey: "dietaryFatG", emptyHint: "需手录" },
    ],
  },
];

export const APPLE_HEALTH_DEFAULT_METRICS = ["steps", "activeEnergyKcal", "distanceKm", "heartRateBpm"];
export const APPLE_HEALTH_WATCH_METRICS = [
  "steps",
  "activeEnergyKcal",
  "restingEnergyKcal",
  "distanceKm",
  "sleepSamples",
  "heartRateBpm",
  "restingHeartRateBpm",
  "hrvMs",
];
export const APPLE_HEALTH_AUTO_METRICS = [
  "steps",
  "activeEnergyKcal",
  "distanceKm",
  "flightsClimbed",
  "sleepSamples",
  "weightKg",
  "bodyFatPct",
  "leanBodyMassKg",
  "bmi",
  "restingHeartRateBpm",
  "heartRateBpm",
  "hrvMs",
  "respiratoryRate",
];

const ACTIVITY_TYPE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const VALID_EVENTS = new Set(["start", "end"]);
const VALID_ENVIRONMENTS = new Set(Object.keys(APPLE_SHORTCUT_ENVIRONMENTS));
const VALID_DAILY_GROUPS = new Set(APPLE_HEALTH_DAILY_GROUPS.map((g) => g.id));

/** Escape special characters for XML text nodes. */
export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]);
}

/** Generate an uppercase UUID suitable for Apple Shortcuts action links. */
function makeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateToken(token) {
  const clean = String(token ?? "").trim();
  if (!clean || /\s/.test(clean)) throw new Error("设备令牌缺失或格式无效");
  return clean;
}

/**
 * Validate and normalize an Ironlog base URL (origin + optional subpath).
 * Rejects non-HTTP(S) schemes and strips query/hash/trailing slash.
 */
export function normalizeServerOrigin(rawOrigin) {
  const trimmed = String(rawOrigin ?? "").trim();
  if (!trimmed) throw new Error("请输入铁记服务器地址");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("服务器地址格式无效，请以 https:// 或 http:// 开头");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("服务器地址仅支持 https:// 或 http:// 协议");
  }
  const basePath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
  return `${parsed.origin}${basePath}`;
}

/** Return reachability diagnostics for using the origin from an iPhone Shortcut. */
export function assessServerOrigin(rawOrigin) {
  let normalized;
  try {
    normalized = normalizeServerOrigin(rawOrigin);
  } catch (error) {
    return { valid: false, normalized: "", isLoopback: false, isPlainHttp: false, warning: error.message };
  }
  const { hostname, protocol } = new URL(normalized);
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  const isPlainHttp = protocol === "http:";
  const warning = isLoopback
    ? "当前为本机测试地址，iPhone 无法直连 localhost。真机导入前请改填公网 HTTPS 域名或 Tailscale 地址。"
    : isPlainHttp
      ? "当前为明文 HTTP 地址，公网环境建议部署 HTTPS 反向代理以保证 iPhone 稳定同步。"
      : "";
  return { valid: true, normalized, isLoopback, isPlainHttp, warning };
}

function indentBlock(xml, tabs) {
  const pad = "\t".repeat(tabs);
  return xml.split("\n").map((line) => `${pad}${line}`).join("\n");
}

const ISO_DATE_AGGRANDIZEMENTS = Object.freeze([
  Object.freeze({
    Type: "WFDateFormatVariableAggrandizement",
    WFDateFormatStyle: "ISO 8601",
    WFISO8601IncludeTime: true,
  }),
]);

function attachmentEntryXml(entry, indent) {
  const pad = "\t".repeat(indent);
  const aggrXml = entry.aggrandizements?.length
    ? `${pad}\t<key>Aggrandizements</key>\n`
      + `${pad}\t<array>\n`
      + entry.aggrandizements.map((ag) => (
        `${pad}\t\t<dict>\n`
        + Object.entries(ag).map(([k, v]) => {
          const valTag = typeof v === "boolean"
            ? (v ? "<true/>" : "<false/>")
            : `<string>${escapeXml(String(v))}</string>`;
          return `${pad}\t\t\t<key>${escapeXml(k)}</key>\n${pad}\t\t\t${valTag}`;
        }).join("\n")
        + `\n${pad}\t\t</dict>`
      )).join("\n")
      + `\n${pad}\t</array>\n`
    : "";
  if (entry.varName) {
    return `${pad}<dict>\n`
      + aggrXml
      + `${pad}\t<key>Type</key>\n`
      + `${pad}\t<string>Variable</string>\n`
      + `${pad}\t<key>VariableName</key>\n`
      + `${pad}\t<string>${escapeXml(entry.varName)}</string>\n`
      + `${pad}</dict>`;
  }
  return `${pad}<dict>\n`
    + aggrXml
    + `${pad}\t<key>OutputName</key>\n`
    + `${pad}\t<string>${escapeXml(entry.outputName)}</string>\n`
    + `${pad}\t<key>OutputUUID</key>\n`
    + `${pad}\t<string>${escapeXml(entry.outputUuid)}</string>\n`
    + `${pad}\t<key>Type</key>\n`
    + `${pad}\t<string>ActionOutput</string>\n`
    + `${pad}</dict>`;
}

/** Render a WFTextTokenString dictionary wrapper supporting static strings, single token, or template attachments. */
function tokenStringXml({ text = "", outputAttachment = null, varAttachment = null, multiRawText = null, rawAttachments = null }) {
  let inner;
  if (multiRawText != null && rawAttachments?.length) {
    const entries = rawAttachments.map(({ range, entry }) =>
      `\t\t\t\t<key>${escapeXml(range)}</key>\n${attachmentEntryXml(entry, 4)}`).join("\n");
    inner = `\t\t\t<key>attachmentsByRange</key>\n`
      + `\t\t\t<dict>\n`
      + `${entries}\n`
      + `\t\t\t</dict>\n`
      + `\t\t\t<key>string</key>\n`
      + `\t\t\t<string>${multiRawText}</string>\n`;
  } else if (outputAttachment || varAttachment) {
    const entry = varAttachment
      ? (typeof varAttachment === "string"
        ? { varName: varAttachment }
        : { varName: varAttachment.name, aggrandizements: varAttachment.aggrandizements })
      : {
          outputName: outputAttachment.name,
          outputUuid: outputAttachment.uuid,
          aggrandizements: outputAttachment.aggrandizements,
        };
    inner = `\t\t\t<key>attachmentsByRange</key>\n`
      + `\t\t\t<dict>\n`
      + `\t\t\t\t<key>{0, 1}</key>\n`
      + `${attachmentEntryXml(entry, 4)}\n`
      + `\t\t\t</dict>\n`
      + `\t\t\t<key>string</key>\n`
      + `\t\t\t<string>&#xFFFC;</string>\n`;
  } else {
    inner = `\t\t\t<key>string</key>\n`
      + `\t\t\t<string>${escapeXml(text)}</string>\n`;
  }
  return `<dict>\n`
    + `\t<key>Value</key>\n`
    + `\t<dict>\n`
    + inner
    + `\t</dict>\n`
    + `\t<key>WFSerializationType</key>\n`
    + `\t<string>WFTextTokenString</string>\n`
    + `</dict>`;
}

/** @param {any[]} items @param {number} indent */
function dictionaryFieldXml(items, indent) {
  const pad = "\t".repeat(indent);
  const serializedItems = items.map(({ key, value, itemType = 0, outputAttachment = null, varAttachment = null }) => {
    const keyXml = indentBlock(tokenStringXml({ text: key }), indent + 4);
    const valXml = indentBlock(tokenStringXml({ text: value, outputAttachment, varAttachment }), indent + 4);
    return `${pad}\t\t\t<dict>\n`
      + `${pad}\t\t\t\t<key>WFItemType</key>\n`
      + `${pad}\t\t\t\t<integer>${itemType}</integer>\n`
      + `${pad}\t\t\t\t<key>WFKey</key>\n`
      + `${keyXml}\n`
      + `${pad}\t\t\t\t<key>WFValue</key>\n`
      + `${valXml}\n`
      + `${pad}\t\t\t</dict>`;
  }).join("\n");

  return `${pad}<dict>\n`
    + `${pad}\t<key>Value</key>\n`
    + `${pad}\t<dict>\n`
    + `${pad}\t\t<key>WFDictionaryFieldValueItems</key>\n`
    + `${pad}\t\t<array>\n`
    + `${serializedItems}\n`
    + `${pad}\t\t</array>\n`
    + `${pad}\t</dict>\n`
    + `${pad}\t<key>WFSerializationType</key>\n`
    + `${pad}\t<string>WFDictionaryFieldValue</string>\n`
    + `${pad}</dict>`;
}

function actionBlockXml(identifier, paramsBody) {
  return [
    "\t\t<dict>",
    "\t\t\t<key>WFWorkflowActionIdentifier</key>",
    `\t\t\t<string>${identifier}</string>`,
    "\t\t\t<key>WFWorkflowActionParameters</key>",
    "\t\t\t<dict>",
    paramsBody,
    "\t\t\t</dict>",
    "\t\t</dict>",
  ].join("\n");
}

function commentActionXml(text) {
  return actionBlockXml(
    "is.workflow.actions.comment",
    `\t\t\t\t<key>WFCommentActionText</key>\n\t\t\t\t<string>${escapeXml(text)}</string>`,
  );
}

function currentDateActionXml({ uuid }) {
  return actionBlockXml("is.workflow.actions.date", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFDateActionMode</key>",
    "\t\t\t\t<string>Current Date</string>",
  ].join("\n"));
}

function downloadJsonActionXml({ uuid, endpoint, token, bodyItems = null, method = "POST" }) {
  const headerItems = [{ key: "Authorization", value: `Bearer ${token}` }];
  if (method !== "GET" && bodyItems) headerItems.push({ key: "Content-Type", value: "application/json" });
  const headersXml = dictionaryFieldXml(headerItems, 4);
  const params = [
    "\t\t\t\t<key>ShowHeaders</key>",
    "\t\t\t\t<true/>",
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFHTTPHeaders</key>",
    headersXml,
    "\t\t\t\t<key>WFHTTPMethod</key>",
    `\t\t\t\t<string>${escapeXml(method)}</string>`,
    "\t\t\t\t<key>WFURL</key>",
    `\t\t\t\t<string>${escapeXml(endpoint)}</string>`,
  ];
  if (method !== "GET" && bodyItems) {
    params.splice(
      4,
      0,
      "\t\t\t\t<key>WFHTTPBodyType</key>",
      "\t\t\t\t<string>JSON</string>",
    );
    params.push(
      "\t\t\t\t<key>WFJSONValues</key>",
      dictionaryFieldXml(bodyItems, 4),
    );
  }
  return actionBlockXml("is.workflow.actions.downloadurl", params.join("\n"));
}

function actionOutputAttachmentXml({ outputUuid, outputName, indent = 5 }) {
  const pad = "\t".repeat(indent);
  return [
    `${pad}<dict>`,
    `${pad}\t<key>Value</key>`,
    `${pad}\t<dict>`,
    `${pad}\t\t<key>OutputName</key>`,
    `${pad}\t\t<string>${escapeXml(outputName)}</string>`,
    `${pad}\t\t<key>OutputUUID</key>`,
    `${pad}\t\t<string>${escapeXml(outputUuid)}</string>`,
    `${pad}\t\t<key>Type</key>`,
    `${pad}\t\t<string>ActionOutput</string>`,
    `${pad}\t</dict>`,
    `${pad}\t<key>WFSerializationType</key>`,
    `${pad}\t<string>WFTextTokenAttachment</string>`,
    `${pad}</dict>`,
  ].join("\n");
}

function delayActionXml(seconds = 5) {
  return actionBlockXml("is.workflow.actions.delay", `\t\t\t\t<key>WFDelayTime</key>\n\t\t\t\t<integer>${seconds}</integer>`);
}

function getDictionaryValueActionXml({ uuid, key, inputUuid, inputName = "Contents of URL" }) {
  return actionBlockXml("is.workflow.actions.getvalueforkey", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFDictionaryKey</key>",
    `\t\t\t\t<string>${escapeXml(key)}</string>`,
    "\t\t\t\t<key>WFInput</key>",
    actionOutputAttachmentXml({ outputUuid: inputUuid, outputName: inputName, indent: 4 }),
  ].join("\n"));
}

function adjustDateSubtractMinutesActionXml({
  uuid,
  minutes = null,
  minutesUuid = null,
  minutesOutputName = "Dictionary Value",
  inputUuid,
  inputName = "Date",
}) {
  const magnitudeXml = minutesUuid
    ? [
        "\t\t\t\t\t\t<key>Magnitude</key>",
        actionOutputAttachmentXml({ outputUuid: minutesUuid, outputName: minutesOutputName, indent: 6 }),
      ].join("\n")
    : [
        "\t\t\t\t\t\t<key>Magnitude</key>",
        `\t\t\t\t\t\t<string>${escapeXml(String(minutes))}</string>`,
      ].join("\n");
  return actionBlockXml("is.workflow.actions.adjustdate", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFAdjustOperation</key>",
    "\t\t\t\t<string>Subtract</string>",
    "\t\t\t\t<key>WFDate</key>",
    actionOutputAttachmentXml({ outputUuid: inputUuid, outputName: inputName, indent: 4 }),
    "\t\t\t\t<key>WFDuration</key>",
    "\t\t\t\t<dict>",
    "\t\t\t\t\t<key>Value</key>",
    "\t\t\t\t\t<dict>",
    magnitudeXml,
    "\t\t\t\t\t\t<key>Unit</key>",
    "\t\t\t\t\t\t<string>Minutes</string>",
    "\t\t\t\t\t</dict>",
    "\t\t\t\t\t<key>WFSerializationType</key>",
    "\t\t\t\t\t<string>WFQuantityFieldValue</string>",
    "\t\t\t\t</dict>",
  ].join("\n"));
}

function adjustDateStartOfDayActionXml({ uuid, inputUuid, inputName = "Date" }) {
  return actionBlockXml("is.workflow.actions.adjustdate", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFAdjustOperation</key>",
    "\t\t\t\t<string>Get Start of Day</string>",
    "\t\t\t\t<key>WFDate</key>",
    actionOutputAttachmentXml({ outputUuid: inputUuid, outputName: inputName, indent: 4 }),
  ].join("\n"));
}

function findHealthSampleActionXml({
  uuid,
  typeLabel,
  unit = null,
  groupBy = null,
  dateFilter,
  sortOrder = "Latest First",
  limit = null,
}) {
  let dateTemplate;
  const dateProp = dateFilter.byEndDate ? "End Date" : "Start Date";
  if (dateFilter.kind === "betweenDates") {
    dateTemplate = [
      "\t\t\t\t\t\t\t\t<dict>",
      "\t\t\t\t\t\t\t\t\t<key>Bounded</key>",
      "\t\t\t\t\t\t\t\t\t<true/>",
      "\t\t\t\t\t\t\t\t\t<key>Operator</key>",
      "\t\t\t\t\t\t\t\t\t<integer>1003</integer>",
      "\t\t\t\t\t\t\t\t\t<key>Property</key>",
      `\t\t\t\t\t\t\t\t\t<string>${dateProp}</string>`,
      "\t\t\t\t\t\t\t\t\t<key>Removable</key>",
      "\t\t\t\t\t\t\t\t\t<false/>",
      "\t\t\t\t\t\t\t\t\t<key>Values</key>",
      "\t\t\t\t\t\t\t\t\t<dict>",
      "\t\t\t\t\t\t\t\t\t\t<key>Date</key>",
      actionOutputAttachmentXml({
        outputUuid: dateFilter.startDateUuid,
        outputName: dateFilter.startDateOutputName ?? "Adjusted Date",
        indent: 10,
      }),
      "\t\t\t\t\t\t\t\t\t\t<key>AnotherDate</key>",
      actionOutputAttachmentXml({
        outputUuid: dateFilter.endDateUuid,
        outputName: dateFilter.endDateOutputName ?? "Date",
        indent: 10,
      }),
      "\t\t\t\t\t\t\t\t\t</dict>",
      "\t\t\t\t\t\t\t\t</dict>",
    ];
  } else if (dateFilter.kind === "today") {
    dateTemplate = [
      "\t\t\t\t\t\t\t\t<dict>",
      "\t\t\t\t\t\t\t\t\t<key>Bounded</key>",
      "\t\t\t\t\t\t\t\t\t<true/>",
      "\t\t\t\t\t\t\t\t\t<key>Operator</key>",
      "\t\t\t\t\t\t\t\t\t<integer>1002</integer>",
      "\t\t\t\t\t\t\t\t\t<key>Property</key>",
      `\t\t\t\t\t\t\t\t\t<string>${dateProp}</string>`,
      "\t\t\t\t\t\t\t\t\t<key>Removable</key>",
      "\t\t\t\t\t\t\t\t\t<false/>",
      "\t\t\t\t\t\t\t\t\t<key>Values</key>",
      "\t\t\t\t\t\t\t\t\t<dict/>",
      "\t\t\t\t\t\t\t\t</dict>",
    ];
  } else {
    const unitCode = 16;
    const amount = dateFilter.days;
    dateTemplate = [
      "\t\t\t\t\t\t\t\t<dict>",
      "\t\t\t\t\t\t\t\t\t<key>Bounded</key>",
      "\t\t\t\t\t\t\t\t\t<true/>",
      "\t\t\t\t\t\t\t\t\t<key>Operator</key>",
      "\t\t\t\t\t\t\t\t\t<integer>1001</integer>",
      "\t\t\t\t\t\t\t\t\t<key>Property</key>",
      `\t\t\t\t\t\t\t\t\t<string>${dateProp}</string>`,
      "\t\t\t\t\t\t\t\t\t<key>Removable</key>",
      "\t\t\t\t\t\t\t\t\t<false/>",
      "\t\t\t\t\t\t\t\t\t<key>Values</key>",
      "\t\t\t\t\t\t\t\t\t<dict>",
      "\t\t\t\t\t\t\t\t\t\t<key>Number</key>",
      `\t\t\t\t\t\t\t\t\t\t<string>${escapeXml(String(amount))}</string>`,
      "\t\t\t\t\t\t\t\t\t\t<key>Unit</key>",
      `\t\t\t\t\t\t\t\t\t\t<integer>${unitCode}</integer>`,
      "\t\t\t\t\t\t\t\t\t</dict>",
      "\t\t\t\t\t\t\t\t</dict>",
    ];
  }

  const params = [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFContentItemFilter</key>",
    "\t\t\t\t<dict>",
    "\t\t\t\t\t<key>Value</key>",
    "\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t<key>WFActionParameterFilterPrefix</key>",
    "\t\t\t\t\t\t<integer>1</integer>",
    "\t\t\t\t\t\t<key>WFActionParameterFilterTemplates</key>",
    "\t\t\t\t\t\t<array>",
    "\t\t\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t\t\t<key>Bounded</key>",
    "\t\t\t\t\t\t\t\t<true/>",
    "\t\t\t\t\t\t\t\t<key>Operator</key>",
    "\t\t\t\t\t\t\t\t<integer>4</integer>",
    "\t\t\t\t\t\t\t\t<key>Property</key>",
    "\t\t\t\t\t\t\t\t<string>Type</string>",
    "\t\t\t\t\t\t\t\t<key>Removable</key>",
    "\t\t\t\t\t\t\t\t<false/>",
    "\t\t\t\t\t\t\t\t<key>Values</key>",
    "\t\t\t\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t\t\t\t<key>Enumeration</key>",
    "\t\t\t\t\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t\t\t\t\t<key>Value</key>",
    `\t\t\t\t\t\t\t\t\t\t<string>${escapeXml(typeLabel)}</string>`,
    "\t\t\t\t\t\t\t\t\t\t<key>WFSerializationType</key>",
    "\t\t\t\t\t\t\t\t\t\t<string>WFStringSubstitutableState</string>",
    "\t\t\t\t\t\t\t\t\t</dict>",
    "\t\t\t\t\t\t\t\t</dict>",
    "\t\t\t\t\t\t\t</dict>",
    ...dateTemplate,
    "\t\t\t\t\t\t</array>",
    "\t\t\t\t\t\t<key>WFContentPredicateBoundedDate</key>",
    "\t\t\t\t\t\t<true/>",
    "\t\t\t\t\t</dict>",
    "\t\t\t\t\t<key>WFSerializationType</key>",
    "\t\t\t\t\t<string>WFContentPredicateTableTemplate</string>",
    "\t\t\t\t</dict>",
    "\t\t\t\t<key>WFContentItemSortOrder</key>",
    `\t\t\t\t<string>${escapeXml(sortOrder)}</string>`,
    "\t\t\t\t<key>WFContentItemSortProperty</key>",
    "\t\t\t\t<string>Start Date</string>",
  ];

  if (limit != null) {
    params.push(
      "\t\t\t\t<key>WFContentItemLimitEnabled</key>",
      "\t\t\t\t<true/>",
      "\t\t\t\t<key>WFContentItemLimitNumber</key>",
      `\t\t\t\t<integer>${limit}</integer>`,
    );
  } else {
    params.push("\t\t\t\t<key>WFContentItemLimitEnabled</key>", "\t\t\t\t<false/>");
  }
  if (unit) params.push("\t\t\t\t<key>WFHKSampleFilteringUnit</key>", `\t\t\t\t<string>${escapeXml(unit)}</string>`);
  if (groupBy) params.push("\t\t\t\t<key>WFHKSampleFilteringGroupBy</key>", `\t\t\t\t<string>${escapeXml(groupBy)}</string>`);

  return actionBlockXml("is.workflow.actions.filter.health.quantity", params.join("\n"));
}

function calculateStatisticsActionXml({ uuid, operation = "Sum", inputUuid, inputName = "Value" }) {
  const inputXml = actionOutputAttachmentXml({ outputUuid: inputUuid, outputName: inputName, indent: 4 });
  return actionBlockXml("is.workflow.actions.statistics", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>Input</key>",
    inputXml,
    "\t\t\t\t<key>WFStatisticsOperation</key>",
    `\t\t\t\t<string>${escapeXml(operation)}</string>`,
  ].join("\n"));
}

function countItemsActionXml({ uuid, inputUuid, inputName = "Value" }) {
  const inputXml = actionOutputAttachmentXml({ outputUuid: inputUuid, outputName: inputName, indent: 4 });
  return actionBlockXml("is.workflow.actions.count", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>Input</key>",
    inputXml,
    "\t\t\t\t<key>WFCountType</key>",
    "\t\t\t\t<string>Items</string>",
  ].join("\n"));
}

function getHealthDetailActionXml({ uuid, propertyName, inputUuid = null, repeatItem = false }) {
  const inputBlock = repeatItem
    ? [
        "\t\t\t\t<key>WFInput</key>",
        "\t\t\t\t<dict>",
        "\t\t\t\t\t<key>Value</key>",
        "\t\t\t\t\t<dict>",
        "\t\t\t\t\t\t<key>Type</key>",
        "\t\t\t\t\t\t<string>Variable</string>",
        "\t\t\t\t\t\t<key>VariableName</key>",
        "\t\t\t\t\t\t<string>Repeat Item</string>",
        "\t\t\t\t\t</dict>",
        "\t\t\t\t\t<key>WFSerializationType</key>",
        "\t\t\t\t\t<string>WFTextTokenAttachment</string>",
        "\t\t\t\t</dict>",
      ]
    : [
        "\t\t\t\t<key>WFInput</key>",
        "\t\t\t\t<dict>",
        "\t\t\t\t\t<key>Value</key>",
        "\t\t\t\t\t<dict>",
        "\t\t\t\t\t\t<key>OutputName</key>",
        "\t\t\t\t\t\t<string>Health Samples</string>",
        "\t\t\t\t\t\t<key>OutputUUID</key>",
        `\t\t\t\t\t\t<string>${escapeXml(inputUuid)}</string>`,
        "\t\t\t\t\t\t<key>Type</key>",
        "\t\t\t\t\t\t<string>ActionOutput</string>",
        "\t\t\t\t\t</dict>",
        "\t\t\t\t\t<key>WFSerializationType</key>",
        "\t\t\t\t\t<string>WFTextTokenAttachment</string>",
        "\t\t\t\t</dict>",
      ];

  return actionBlockXml("is.workflow.actions.properties.health.quantity", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFContentItemPropertyName</key>",
    `\t\t\t\t<string>${escapeXml(propertyName)}</string>`,
    ...inputBlock,
  ].join("\n"));
}

function setVariableActionXml({ variableName, inputUuid, inputName = "Value" }) {
  return actionBlockXml("is.workflow.actions.setvariable", [
    "\t\t\t\t<key>WFInput</key>",
    "\t\t\t\t<dict>",
    "\t\t\t\t\t<key>Value</key>",
    "\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t<key>OutputName</key>",
    `\t\t\t\t\t\t<string>${escapeXml(inputName)}</string>`,
    "\t\t\t\t\t\t<key>OutputUUID</key>",
    `\t\t\t\t\t\t<string>${escapeXml(inputUuid)}</string>`,
    "\t\t\t\t\t\t<key>Type</key>",
    "\t\t\t\t\t\t<string>ActionOutput</string>",
    "\t\t\t\t\t</dict>",
    "\t\t\t\t\t<key>WFSerializationType</key>",
    "\t\t\t\t\t<string>WFTextTokenAttachment</string>",
    "\t\t\t\t</dict>",
    "\t\t\t\t<key>WFVariableName</key>",
    `\t\t\t\t<string>${escapeXml(variableName)}</string>`,
  ].join("\n"));
}

function healthSampleRowsActions({ uuidFactory, inputUuid, variableName, columns }) {
  const repeatGroup = uuidFactory();
  const repeatEnd = uuidFactory();
  const detailActions = [];
  const attachments = columns.map((propertyName, index) => {
    const uuid = uuidFactory();
    detailActions.push(getHealthDetailActionXml({ uuid, propertyName, repeatItem: true }));
    return {
      range: `{${index * 2}, 1}`,
      entry: { outputName: propertyName, outputUuid: uuid,
        aggrandizements: propertyName.endsWith("Date") ? ISO_DATE_AGGRANDIZEMENTS : undefined },
    };
  });
  const repeatAction = (mode, uuid, input = []) => actionBlockXml("is.workflow.actions.repeat.each", [
    "\t\t\t\t<key>GroupingIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(repeatGroup)}</string>`,
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFControlFlowMode</key>",
    `\t\t\t\t<integer>${mode}</integer>`,
    ...input,
  ].join("\n"));
  return [
    repeatAction(0, uuidFactory(), [
      "\t\t\t\t<key>WFInput</key>",
      actionOutputAttachmentXml({ outputUuid: inputUuid, outputName: "Health Samples", indent: 4 }),
    ]),
    ...detailActions,
    actionBlockXml("is.workflow.actions.gettext", [
      "\t\t\t\t<key>UUID</key>",
      `\t\t\t\t<string>${escapeXml(uuidFactory())}</string>`,
      "\t\t\t\t<key>WFTextActionText</key>",
      indentBlock(tokenStringXml({
        multiRawText: columns.map(() => "&#xFFFC;").join("|"),
        rawAttachments: attachments,
      }), 4),
    ].join("\n")),
    repeatAction(2, repeatEnd),
    setVariableActionXml({ variableName, inputUuid: repeatEnd, inputName: "Repeat Results" }),
  ];
}

function conditionalHasValueBlock({ groupUuid, inputUuid, inputName = "Health Samples", bodyActions }) {
  const openIf = actionBlockXml("is.workflow.actions.conditional", [
    "\t\t\t\t<key>GroupingIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
    "\t\t\t\t<key>WFCondition</key>",
    "\t\t\t\t<integer>100</integer>",
    "\t\t\t\t<key>WFControlFlowMode</key>",
    "\t\t\t\t<integer>0</integer>",
    "\t\t\t\t<key>WFInput</key>",
    "\t\t\t\t<dict>",
    "\t\t\t\t\t<key>Type</key>",
    "\t\t\t\t\t<string>Variable</string>",
    "\t\t\t\t\t<key>Variable</key>",
    "\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t<key>Value</key>",
    "\t\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t\t<key>OutputName</key>",
    `\t\t\t\t\t\t\t<string>${escapeXml(inputName)}</string>`,
    "\t\t\t\t\t\t\t<key>OutputUUID</key>",
    `\t\t\t\t\t\t\t<string>${escapeXml(inputUuid)}</string>`,
    "\t\t\t\t\t\t\t<key>Type</key>",
    "\t\t\t\t\t\t\t<string>ActionOutput</string>",
    "\t\t\t\t\t\t</dict>",
    "\t\t\t\t\t\t<key>WFSerializationType</key>",
    "\t\t\t\t\t\t<string>WFTextTokenAttachment</string>",
    "\t\t\t\t\t</dict>",
    "\t\t\t\t</dict>",
  ].join("\n"));

  const closeIf = actionBlockXml("is.workflow.actions.conditional", [
    "\t\t\t\t<key>GroupingIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
    "\t\t\t\t<key>WFControlFlowMode</key>",
    "\t\t\t\t<integer>2</integer>",
  ].join("\n"));

  return [openIf, ...bodyActions, closeIf];
}

function wrapShortcutPlist(actionBlocks) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>WFWorkflowActions</key>",
    "\t<array>",
    ...actionBlocks,
    "\t</array>",
    "\t<key>WFWorkflowClientVersion</key>",
    "\t<string>2700.0.4</string>",
    "\t<key>WFWorkflowHasShortcutInputVariables</key>",
    "\t<false/>",
    "\t<key>WFWorkflowIcon</key>",
    "\t<dict>",
    "\t\t<key>WFWorkflowIconGlyphNumber</key>",
    "\t\t<integer>61440</integer>",
    "\t\t<key>WFWorkflowIconStartColor</key>",
    "\t\t<integer>431817727</integer>",
    "\t</dict>",
    "\t<key>WFWorkflowImportQuestions</key>",
    "\t<array/>",
    "\t<key>WFWorkflowInputContentItemClasses</key>",
    "\t<array>",
    "\t\t<string>WFStringContentItem</string>",
    "\t</array>",
    "\t<key>WFWorkflowMinimumClientVersion</key>",
    "\t<integer>900</integer>",
    "\t<key>WFWorkflowMinimumClientVersionString</key>",
    "\t<string>900</string>",
    "\t<key>WFWorkflowOutputContentItemClasses</key>",
    "\t<array/>",
    "\t<key>WFWorkflowTypes</key>",
    "\t<array/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

const DISTANCE_SAMPLE_SPECS = {
  foot: { zh: "步行 + 跑步距离", en: "Walking + Running Distance", unit: "km", jsonKey: "distanceKm", varName: "v_distanceKm" },
  cycling: { zh: "骑行距离", en: "Cycling Distance", unit: "km", jsonKey: "distanceKm", varName: "v_distanceKm" },
  swimming: { zh: "游泳距离", en: "Swimming Distance", unit: "m", jsonKey: "distanceMeters", varName: "v_distanceMeters" },
};

function resolveShortcutLocale(locale = "zh-Hans") {
  if (!Object.hasOwn(APPLE_SHORTCUT_HEALTH_LOCALES, locale)) {
    throw new Error("快捷指令语言仅支持 zh-Hans 或 en");
  }
  return locale;
}

function resolveWorkoutConfig({ serverOrigin, token, activityType, environment, locale }) {
  if (!ACTIVITY_TYPE_RE.test(String(activityType ?? ""))) {
    throw new Error("运动类型标识不合法");
  }
  const sport = APPLE_SHORTCUT_SPORTS.find((item) => item.activityType === activityType) ?? null;
  const resolvedEnv = environment ?? sport?.defaultEnvironment ?? "unknown";
  if (!VALID_ENVIRONMENTS.has(resolvedEnv)) {
    throw new Error("运动环境必须为 indoor、outdoor 或 unknown");
  }
  const resolvedLocale = resolveShortcutLocale(locale);
  const cleanToken = validateToken(token);
  const base = normalizeServerOrigin(serverOrigin);
  const distanceSpec = sport?.hasDistance && sport.distanceMode ? DISTANCE_SAMPLE_SPECS[sport.distanceMode] ?? null : null;
  return { sport, sportLabel: sport?.label ?? activityType, resolvedEnv, resolvedLocale, cleanToken, base, distanceSpec };
}

/** @param {{ uuidFactory: () => string, dateFilter: any, distanceSpec?: any, locale?: string }} opts */
function buildWorkoutWindowMetricsActions({ uuidFactory, dateFilter, distanceSpec = null, locale = "zh-Hans" }) {
  void locale;
  const actions = [];
  /** @type {any[]} */
  const bodyItems = [
    { key: "energyKind", value: "window_estimate" },
    { key: "heartRateMethod", value: "window_samples" },
  ];

  // 1. Active energy sum across the workout window
  const findEnergyUuid = uuidFactory();
  const energyValUuid = uuidFactory();
  const energySumUuid = uuidFactory();
  actions.push(findHealthSampleActionXml({
    uuid: findEnergyUuid,
    typeLabel: "Active Calories",
    unit: "kcal",
    dateFilter,
    sortOrder: "Latest First",
    limit: null,
  }));
  actions.push(...conditionalHasValueBlock({
    groupUuid: uuidFactory(),
    inputUuid: findEnergyUuid,
    bodyActions: [
      getHealthDetailActionXml({ uuid: energyValUuid, propertyName: "Value", inputUuid: findEnergyUuid }),
      calculateStatisticsActionXml({ uuid: energySumUuid, operation: "Sum", inputUuid: energyValUuid, inputName: "Value" }),
      setVariableActionXml({ variableName: "v_activeEnergyKcal", inputUuid: energySumUuid, inputName: "Sum" }),
    ],
  }));
  bodyItems.push({ key: "activeEnergyKcal", varAttachment: "v_activeEnergyKcal" });

  // 2. Optional distance sum for distance-tracked sports
  if (distanceSpec) {
    const findDistUuid = uuidFactory();
    const distValUuid = uuidFactory();
    const distSumUuid = uuidFactory();
    actions.push(findHealthSampleActionXml({
      uuid: findDistUuid,
      typeLabel: distanceSpec.en,
      unit: distanceSpec.unit,
      dateFilter,
      sortOrder: "Latest First",
      limit: null,
    }));
    actions.push(...conditionalHasValueBlock({
      groupUuid: uuidFactory(),
      inputUuid: findDistUuid,
      bodyActions: [
        getHealthDetailActionXml({ uuid: distValUuid, propertyName: "Value", inputUuid: findDistUuid }),
        calculateStatisticsActionXml({ uuid: distSumUuid, operation: "Sum", inputUuid: distValUuid, inputName: "Value" }),
        setVariableActionXml({ variableName: distanceSpec.varName, inputUuid: distSumUuid, inputName: "Sum" }),
      ],
    }));
    bodyItems.push({ key: distanceSpec.jsonKey, varAttachment: distanceSpec.varName });
  }

  // 3. Heart rate avg / min / max / count across the workout window
  const findHrUuid = uuidFactory();
  const hrValUuid = uuidFactory();
  const hrAvgUuid = uuidFactory();
  const hrMinUuid = uuidFactory();
  const hrMaxUuid = uuidFactory();
  const hrCountUuid = uuidFactory();
  actions.push(findHealthSampleActionXml({
    uuid: findHrUuid,
    typeLabel: "Heart Rate",
    unit: null,
    dateFilter,
    sortOrder: "Latest First",
    limit: null,
  }));
  actions.push(...conditionalHasValueBlock({
    groupUuid: uuidFactory(),
    inputUuid: findHrUuid,
    bodyActions: [
      getHealthDetailActionXml({ uuid: hrValUuid, propertyName: "Value", inputUuid: findHrUuid }),
      calculateStatisticsActionXml({ uuid: hrAvgUuid, operation: "Average", inputUuid: hrValUuid, inputName: "Value" }),
      setVariableActionXml({ variableName: "v_hrAvg", inputUuid: hrAvgUuid, inputName: "Average" }),
      calculateStatisticsActionXml({ uuid: hrMinUuid, operation: "Minimum", inputUuid: hrValUuid, inputName: "Value" }),
      setVariableActionXml({ variableName: "v_hrMin", inputUuid: hrMinUuid, inputName: "Minimum" }),
      calculateStatisticsActionXml({ uuid: hrMaxUuid, operation: "Maximum", inputUuid: hrValUuid, inputName: "Value" }),
      setVariableActionXml({ variableName: "v_hrMax", inputUuid: hrMaxUuid, inputName: "Maximum" }),
      countItemsActionXml({ uuid: hrCountUuid, inputUuid: findHrUuid, inputName: "Health Samples" }),
      setVariableActionXml({ variableName: "v_hrCount", inputUuid: hrCountUuid, inputName: "Count" }),
    ],
  }));
  bodyItems.push(
    { key: "avgBpm", varAttachment: "v_hrAvg" },
    { key: "minBpm", varAttachment: "v_hrMin" },
    { key: "maxBpm", varAttachment: "v_hrMax" },
    { key: "heartRateSamples", varAttachment: "v_hrCount" },
  );

  return { actions, bodyItems };
}

/**
 * Build an unsigned XML plist `.shortcut` payload for an Apple Watch workout start or end trigger.
 * On `end` (with `collectMetrics !== false`), waits 5s for Watch-to-iPhone Health sync, fetches
 * `elapsedMinutes` from `GET /api/integrations/apple-health/events/active`, and collects window
 * calories, heart rate, and optional distance alongside the `end` event.
 * Output targets `POST <serverOrigin>/api/integrations/apple-health/events`.
 */
export function buildIronlogEventShortcut({
  event = undefined,
  serverOrigin = undefined,
  token = undefined,
  activityType = "traditionalStrengthTraining",
  environment = undefined,
  collectMetrics = true,
  locale = "zh-Hans",
  uuids = undefined,
  uuidFactory = makeUuid,
} = {}) {
  if (!VALID_EVENTS.has(event)) throw new Error("event 必须为 start 或 end");
  const {
    sportLabel,
    resolvedEnv,
    resolvedLocale,
    cleanToken,
    base,
    distanceSpec,
  } = resolveWorkoutConfig({ serverOrigin, token, activityType, environment, locale });

  const endpoint = `${base}/api/integrations/apple-health/events`;
  const dateUuid = uuids?.date ?? uuidFactory();
  const requestUuid = uuids?.request ?? uuidFactory();
  const eventLabel = event === "start" ? "开始" : "结束";
  const filename = `铁记-${eventLabel}-${sportLabel}.shortcut`;

  if (event === "start" || collectMetrics === false) {
    const commentText = [
      `铁记（Ironlog）自动上报：Apple Watch ${sportLabel}（${eventLabel}）`,
      `目标接口：${endpoint}`,
      `绑定方式：iPhone「快捷指令 → 自动化 → + → Apple Watch 体能训练（${eventLabel}时 · 立即运行）」选择本快捷指令。`,
    ].join("\n");

    const xml = wrapShortcutPlist([
      commentActionXml(commentText),
      currentDateActionXml({ uuid: dateUuid }),
      downloadJsonActionXml({
        uuid: requestUuid,
        endpoint,
        token: cleanToken,
        bodyItems: [
          { key: "schemaVersion", value: "1", itemType: 3 },
          { key: "event", value: event },
          { key: "activityType", value: activityType },
          { key: "environment", value: resolvedEnv },
          { key: "occurredAt", outputAttachment: { name: "Date", uuid: dateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
        ],
      }),
    ]);

    return { filename, shortcutName: filename.replace(/\.shortcut$/, ""), endpoint, xml };
  }

  const activeEndpoint = `${base}/api/integrations/apple-health/events/active?activityType=${encodeURIComponent(activityType)}`;
  const activeReqUuid = uuidFactory();
  const elapsedValUuid = uuidFactory();
  const startRawUuid = uuidFactory();
  const metrics = buildWorkoutWindowMetricsActions({
    uuidFactory,
    dateFilter: {
      kind: "betweenDates",
      startDateUuid: startRawUuid,
      startDateOutputName: "Adjusted Date",
      endDateUuid: dateUuid,
      endDateOutputName: "Date",
    },
    locale: resolvedLocale,
    distanceSpec,
  });

  const commentText = [
    `铁记（Ironlog）自动上报：Apple Watch ${sportLabel}（${eventLabel} · 含热量/心率${distanceSpec ? "/距离" : ""}）`,
    `目标接口：${endpoint}`,
    `绑定方式：iPhone「快捷指令 → 自动化 → + → Apple Watch 体能训练（结束时 · 立即运行）」选择本快捷指令，需先配对同名「开始」自动化。`,
  ].join("\n");

  const xml = wrapShortcutPlist([
    commentActionXml(commentText),
    delayActionXml(5),
    currentDateActionXml({ uuid: dateUuid }),
    downloadJsonActionXml({
      uuid: activeReqUuid,
      endpoint: activeEndpoint,
      token: cleanToken,
      method: "GET",
    }),
    getDictionaryValueActionXml({
      uuid: elapsedValUuid,
      key: "elapsedMinutes",
      inputUuid: activeReqUuid,
      inputName: "Contents of URL",
    }),
    ...conditionalHasValueBlock({
      groupUuid: uuidFactory(),
      inputUuid: elapsedValUuid,
      inputName: "Dictionary Value",
      bodyActions: [
        adjustDateSubtractMinutesActionXml({
          uuid: startRawUuid,
          minutesUuid: elapsedValUuid,
          minutesOutputName: "Dictionary Value",
          inputUuid: dateUuid,
          inputName: "Date",
        }),
        ...metrics.actions,
      ],
    }),
    downloadJsonActionXml({
      uuid: requestUuid,
      endpoint,
      token: cleanToken,
      bodyItems: [
        { key: "schemaVersion", value: "1", itemType: 3 },
        { key: "event", value: "end" },
        { key: "activityType", value: activityType },
        { key: "environment", value: resolvedEnv },
        { key: "occurredAt", outputAttachment: { name: "Date", uuid: dateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
        ...metrics.bodyItems,
      ],
    }),
  ]);

  return {
    filename,
    shortcutName: filename.replace(/\.shortcut$/, ""),
    endpoint,
    locale: resolvedLocale,
    xml,
  };
}

/**
 * Build a zero-pair, single-automation post-workout Apple Shortcut that waits 5s for
 * Apple Watch HealthKit sync, captures recent calories / heart rate / distance over the
 * configured lookback window, and posts directly to `POST /api/integrations/apple-health/workouts`.
 */
export function buildIronlogRecentWorkoutShortcut({
  serverOrigin = undefined,
  token = undefined,
  activityType = "traditionalStrengthTraining",
  environment = undefined,
  windowMinutes = 45,
  locale = "zh-Hans",
  uuidFactory = makeUuid,
} = {}) {
  const resolvedMinutes = Number(windowMinutes);
  if (!Number.isInteger(resolvedMinutes) || resolvedMinutes < 5 || resolvedMinutes > 360) {
    throw new Error("回溯窗口时长需在 5 到 360 分钟之间");
  }
  const {
    sportLabel,
    resolvedEnv,
    resolvedLocale,
    cleanToken,
    base,
    distanceSpec,
  } = resolveWorkoutConfig({ serverOrigin, token, activityType, environment, locale });

  const endpoint = `${base}/api/integrations/apple-health/workouts`;
  const filename = `铁记-结束直传-${sportLabel}.shortcut`;
  const nowDateUuid = uuidFactory();
  const startRawUuid = uuidFactory();
  const requestUuid = uuidFactory();
  const metrics = buildWorkoutWindowMetricsActions({
    uuidFactory,
    dateFilter: {
      kind: "betweenDates",
      startDateUuid: startRawUuid,
      startDateOutputName: "Adjusted Date",
      endDateUuid: nowDateUuid,
      endDateOutputName: "Date",
    },
    locale: resolvedLocale,
    distanceSpec,
  });

  const commentText = [
    `铁记（Ironlog）单条全自动直传：${sportLabel}（免配「开始」自动化，回溯最近 ${resolvedMinutes} 分钟）`,
    `目标接口：${endpoint}`,
    `绑定方式：iPhone「快捷指令 → 自动化 → + → Apple Watch 体能训练（结束任何体能训练 / ${sportLabel} · 立即运行）」选择本快捷指令即可；如单次训练更长/更短，可在下方动作里微调 ${resolvedMinutes} 分钟窗口。`,
  ].join("\n");

  const xml = wrapShortcutPlist([
    commentActionXml(commentText),
    delayActionXml(5),
    currentDateActionXml({ uuid: nowDateUuid }),
    adjustDateSubtractMinutesActionXml({ uuid: startRawUuid, minutes: resolvedMinutes, inputUuid: nowDateUuid, inputName: "Date" }),
    ...metrics.actions,
    downloadJsonActionXml({
      uuid: requestUuid,
      endpoint,
      token: cleanToken,
      bodyItems: [
        { key: "schemaVersion", value: "1", itemType: 3 },
        { key: "source", value: "shortcut" },
        { key: "captureMethod", value: "trigger" },
        { key: "durationKind", value: "event_elapsed" },
        { key: "activityType", value: activityType },
        { key: "environment", value: resolvedEnv },
        { key: "startedAt", outputAttachment: { name: "Adjusted Date", uuid: startRawUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
        { key: "endedAt", outputAttachment: { name: "Date", uuid: nowDateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
        { key: "durationMinutes", value: String(resolvedMinutes), itemType: 3 },
        ...metrics.bodyItems,
      ],
    }),
  ]);

  return {
    filename,
    shortcutName: filename.replace(/\.shortcut$/, ""),
    endpoint,
    locale: resolvedLocale,
    windowMinutes: resolvedMinutes,
    xml,
  };
}

/**
 * Build a comprehensive all-in-one Apple Health daily sync `.shortcut` plist covering
 * sleep stages, weight, body fat %, lean mass, BMI, waist, daily steps/energy/distance/flights,
 * heart rate, resting HR, HRV, VO2 Max, SpO2, respiratory rate, water, and nutrition snapshots.
 */
export function buildIronlogDailyHealthShortcut({
  serverOrigin = undefined,
  token = undefined,
  groups = APPLE_HEALTH_DAILY_GROUPS.map((g) => g.id),
  metrics = null,
  locale = "zh-Hans",
  uuidFactory = makeUuid,
} = {}) {
  const resolvedLocale = resolveShortcutLocale(locale);
  const cleanToken = validateToken(token);
  const base = normalizeServerOrigin(serverOrigin);
  const endpoint = `${base}/api/integrations/apple-health/daily`;

  let activeGroups;
  let selectedGroups;
  let selectedMetrics;
  if (Array.isArray(metrics)) {
    const metricSet = new Set(metrics);
    selectedMetrics = APPLE_HEALTH_DAILY_GROUPS.flatMap((g) => g.metrics).filter((m) => metricSet.has(m.key));
    if (!selectedMetrics.length) throw new Error("请至少选择一项健康指标");
    activeGroups = APPLE_HEALTH_DAILY_GROUPS.filter((g) => g.metrics.some((m) => metricSet.has(m.key)));
    selectedGroups = activeGroups.map((g) => g.id);
  } else {
    selectedGroups = [...new Set(groups)].filter((id) => VALID_DAILY_GROUPS.has(id));
    if (!selectedGroups.length) throw new Error("请至少选择一类健康数据");
    activeGroups = APPLE_HEALTH_DAILY_GROUPS.filter((g) => selectedGroups.includes(g.id));
    selectedMetrics = activeGroups.flatMap((g) => g.metrics);
  }
  const groupNames = activeGroups.map((g) => g.label).join("、");
  const filename = "铁记-每日全量健康同步.shortcut";

  const commentText = [
    `铁记（Ironlog）每日 Apple 健康同步：${groupNames}（共 ${selectedMetrics.length} 项）`,
    `目标接口：${endpoint}`,
    `提示：① 首次运行请在 iPhone「健康 App → 头像 → 隐私 → App → 快捷指令」打开已选指标权限；② 若某项健康数据最近无记录，iOS 快捷指令会弹窗「未找到样本」，建议只在网页端勾选你平时确实有数据的指标。`,
  ].join("\n");

  const actions = [commentActionXml(commentText)];
  /** @type {any[]} */
  const jsonBodyItems = [
    { key: "schemaVersion", value: "1", itemType: 3 },
    { key: "shortcutGenVersion", value: "3" },
    { key: "source", value: "shortcut" },
  ];
  // Format Current Date inline via WFDateFormatVariableAggrandizement instead of calling
  // is.workflow.actions.format.date, which can evaluate to "" on some iOS builds.
  const rawNowUuid = uuidFactory();
  const todayStartUuid = uuidFactory();
  const dayAgoUuid = uuidFactory();
  actions.push(currentDateActionXml({ uuid: rawNowUuid }));
  actions.push(adjustDateStartOfDayActionXml({
    uuid: todayStartUuid,
    inputUuid: rawNowUuid,
    inputName: "Date",
  }));
  actions.push(adjustDateSubtractMinutesActionXml({
    uuid: dayAgoUuid,
    minutes: 1440,
    inputUuid: rawNowUuid,
    inputName: "Date",
  }));
  jsonBodyItems.push({
    key: "occurredAt",
    outputAttachment: { name: "Date", uuid: rawNowUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS },
  });

  const todayWindowFilter = {
    kind: "betweenDates",
    startDateUuid: todayStartUuid,
    startDateOutputName: "Adjusted Date",
    endDateUuid: rawNowUuid,
    endDateOutputName: "Date",
  };
  const explicitWindowFilter = {
    kind: "betweenDates",
    startDateUuid: dayAgoUuid,
    startDateOutputName: "Adjusted Date",
    endDateUuid: rawNowUuid,
    endDateOutputName: "Date",
  };

  for (const metric of selectedMetrics) {
    const findUuid = uuidFactory();
    const variableName = `v_${metric.key}`;
    const isSleep = metric.mode === "sleepIntervals";
    const latest = metric.mode === "latest";
    const isDailySum = metric.mode === "dailySum";
    actions.push(findHealthSampleActionXml({
      uuid: findUuid,
      typeLabel: metric.typeLabelEn,
      unit: metric.unit ?? null,
      groupBy: isDailySum ? "Day" : null,
      dateFilter: isDailySum
        ? todayWindowFilter
        : { ...explicitWindowFilter, byEndDate: isSleep },
      sortOrder: isSleep ? "Oldest First" : "Latest First",
      limit: latest ? 1 : null,
    }));

    let bodyActions;
    if (latest) {
      const valueUuid = uuidFactory();
      const dateUuid = uuidFactory();
      const dateKey = metric.measuredAtKey ?? `${metric.jsonKey}MeasuredAt`;
      const dateVariable = `v_${dateKey}`;
      bodyActions = [
        getHealthDetailActionXml({ uuid: valueUuid, propertyName: "Value", inputUuid: findUuid }),
        setVariableActionXml({ variableName, inputUuid: valueUuid, inputName: "Value" }),
        getHealthDetailActionXml({ uuid: dateUuid, propertyName: "Start Date", inputUuid: findUuid }),
        setVariableActionXml({ variableName: dateVariable, inputUuid: dateUuid, inputName: "Start Date" }),
      ];
      jsonBodyItems.push(
        { key: metric.jsonKey, varAttachment: variableName },
        { key: dateKey, varAttachment: { name: dateVariable, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
      );
    } else if (isDailySum) {
      const valueUuid = uuidFactory();
      const sumUuid = uuidFactory();
      bodyActions = [
        getHealthDetailActionXml({ uuid: valueUuid, propertyName: "Value", inputUuid: findUuid }),
        calculateStatisticsActionXml({ uuid: sumUuid, operation: "Sum", inputUuid: valueUuid, inputName: "Value" }),
        setVariableActionXml({ variableName, inputUuid: sumUuid, inputName: "Sum" }),
      ];
      jsonBodyItems.push({ key: metric.jsonKey, varAttachment: variableName });
    } else {
      bodyActions = healthSampleRowsActions({
        uuidFactory,
        inputUuid: findUuid,
        variableName,
        columns: ["Value", "Start Date", "End Date", "Duration"],
      });
      jsonBodyItems.push({ key: metric.jsonKey, varAttachment: variableName });
    }

    actions.push(...conditionalHasValueBlock({
      groupUuid: uuidFactory(),
      inputUuid: findUuid,
      bodyActions,
    }));
  }

  actions.push(downloadJsonActionXml({
    uuid: uuidFactory(),
    endpoint,
    token: cleanToken,
    bodyItems: jsonBodyItems,
  }));

  return {
    filename,
    shortcutName: filename.replace(/\.shortcut$/, ""),
    endpoint,
    locale: resolvedLocale,
    metricCount: selectedMetrics.length,
    groups: selectedGroups,
    xml: wrapShortcutPlist(actions),
  };
}

/**
 * Build a zsh/bash-compatible macOS Terminal one-liner that converts downloaded
 * Ironlog XML `.shortcut` files into binary plists and signs them with `shortcuts sign`.
 */
export function buildMacSignCommand() {
  return "mkdir -p ~/Downloads/ironlog-signed && find ~/Downloads -maxdepth 1 -name '铁记-*.shortcut' -exec sh -c 'for f; do b=$(basename \"$f\"); plutil -convert binary1 \"$f\" -o \"/tmp/$b\" && shortcuts sign --mode anyone --input \"/tmp/$b\" --output \"$HOME/Downloads/ironlog-signed/$b\" && rm -f \"/tmp/$b\"; done' sh {} + && open ~/Downloads/ironlog-signed";
}
