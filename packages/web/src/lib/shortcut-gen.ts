/**
 * Generates pre-configured Apple Shortcuts XML property lists (.shortcut)
 * that post workout start/end events and full daily HealthKit telemetry
 * directly to Ironlog's Apple Health API.
 */

export type ShortcutEnvironment = "indoor" | "outdoor" | "unknown";
export type ShortcutLocale = "zh-Hans" | "en";
export type DistanceMode = "foot" | "cycling" | "swimming";

export interface ShortcutSportDef {
  activityType: string;
  label: string;
  defaultEnvironment: ShortcutEnvironment;
  hasDistance: boolean;
  distanceMode?: DistanceMode;
}

export interface HealthDailyMetricDef {
  key: string;
  typeLabel: string;
  typeLabelEn: string;
  unit?: string | null;
  mode: "dailySum" | "sleepIntervals" | "latest";
  jsonKey: string;
  measuredAtKey?: string;
  emptyHint?: string;
}

export interface HealthDailyGroupDef {
  id: string;
  label: string;
  description: string;
  metrics: HealthDailyMetricDef[];
}

export const APPLE_SHORTCUT_SPORTS: ShortcutSportDef[] = [
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

export const APPLE_SHORTCUT_ENVIRONMENTS: Record<ShortcutEnvironment, string> = {
  indoor: "室内 (indoor)",
  outdoor: "室外 (outdoor)",
  unknown: "未指定 (unknown)",
};

export const APPLE_SHORTCUT_HEALTH_LOCALES: Record<ShortcutLocale, string> = {
  "zh-Hans": "简体中文（iPhone 默认）",
  en: "English（英文系统）",
};

export const APPLE_SHORTCUT_RECENT_WINDOWS: Record<number, string> = {
  20: "最近 20 分钟（短时HIIT/跳绳）",
  30: "最近 30 分钟（快走/爬楼机）",
  45: "最近 45 分钟（力量/综合推荐）",
  60: "最近 60 分钟（标准有氧/跑步）",
  90: "最近 90 分钟（长训/骑行/徒步）",
};

export const APPLE_HEALTH_DAILY_GROUPS: HealthDailyGroupDef[] = [
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

export const DEFAULT_APPLE_HUB_SHORTCUT_NAME = "铁记-通用-Apple健康全能联动";

const ACTIVITY_TYPE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const VALID_EVENTS = new Set(["start", "end"]);
const VALID_ENVIRONMENTS = new Set(Object.keys(APPLE_SHORTCUT_ENVIRONMENTS));
const VALID_DAILY_GROUPS = new Set(APPLE_HEALTH_DAILY_GROUPS.map((g) => g.id));

export function escapeXml(value: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (char) => map[char] ?? char);
}

function makeUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateToken(token: string | undefined): string {
  const clean = String(token ?? "").trim();
  if (!clean || /\s/.test(clean)) throw new Error("设备令牌缺失或格式无效");
  return clean;
}

export function normalizeServerOrigin(rawOrigin: string | undefined): string {
  const trimmed = String(rawOrigin ?? "").trim();
  if (!trimmed) throw new Error("请输入铁记服务器地址");
  let parsed: URL;
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

export interface ServerOriginAssessment {
  valid: boolean;
  normalized: string;
  isLoopback: boolean;
  isPlainHttp: boolean;
  warning: string;
}

export function assessServerOrigin(rawOrigin: string | undefined): ServerOriginAssessment {
  let normalized: string;
  try {
    normalized = normalizeServerOrigin(rawOrigin);
  } catch (error) {
    return {
      valid: false,
      normalized: "",
      isLoopback: false,
      isPlainHttp: false,
      warning: (error as Error).message,
    };
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

function indentBlock(xml: string, tabs: number): string {
  const pad = "\t".repeat(tabs);
  return xml.split("\n").map((line) => `${pad}${line}`).join("\n");
}

type Aggrandizement = Record<string, string | boolean>;

const ISO_DATE_AGGRANDIZEMENTS: ReadonlyArray<Aggrandizement> = Object.freeze([
  Object.freeze({
    Type: "WFDateFormatVariableAggrandizement",
    WFDateFormatStyle: "ISO 8601",
    WFISO8601IncludeTime: true,
  }),
]);

interface AttachmentEntry {
  varName?: string;
  outputName?: string;
  outputUuid?: string;
  extensionInput?: boolean;
  aggrandizements?: ReadonlyArray<Aggrandizement>;
}

function attachmentEntryXml(entry: AttachmentEntry, indent: number): string {
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
  if (entry.extensionInput) {
    return `${pad}<dict>\n`
      + aggrXml
      + `${pad}\t<key>Type</key>\n`
      + `${pad}\t<string>ExtensionInput</string>\n`
      + `${pad}</dict>`;
  }
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

interface OutputAttachmentRef {
  name: string;
  uuid: string;
  aggrandizements?: ReadonlyArray<Aggrandizement>;
}

type VarAttachmentRef = string | { name: string; aggrandizements?: ReadonlyArray<Aggrandizement> };

export interface ShortcutImportQuestion {
  actionIndex: number;
  parameterKey: string;
  defaultValue: string;
  text: string;
}

interface DictionaryFieldItem {
  key: string;
  value?: string;
  itemType?: number;
  outputAttachment?: OutputAttachmentRef | null;
  varAttachment?: VarAttachmentRef | null;
  multiRawText?: string | null;
  rawAttachments?: Array<{ range: string; entry: AttachmentEntry }> | null;
}

function tokenStringXml({
  text = "",
  outputAttachment = null,
  varAttachment = null,
  extensionInput = false,
  multiRawText = null,
  rawAttachments = null,
}: {
  text?: string;
  outputAttachment?: OutputAttachmentRef | null;
  varAttachment?: VarAttachmentRef | null;
  extensionInput?: boolean;
  multiRawText?: string | null;
  rawAttachments?: Array<{ range: string; entry: AttachmentEntry }> | null;
}): string {
  let inner: string;
  if (multiRawText != null && rawAttachments?.length) {
    const entries = rawAttachments.map(({ range, entry }) =>
      `\t\t\t\t<key>${escapeXml(range)}</key>\n${attachmentEntryXml(entry, 4)}`).join("\n");
    inner = `\t\t\t<key>attachmentsByRange</key>\n`
      + `\t\t\t<dict>\n`
      + `${entries}\n`
      + `\t\t\t</dict>\n`
      + `\t\t\t<key>string</key>\n`
      + `\t\t\t<string>${multiRawText}</string>\n`;
  } else if (outputAttachment || varAttachment || extensionInput) {
    const entry: AttachmentEntry = extensionInput
      ? { extensionInput: true }
      : varAttachment
        ? (typeof varAttachment === "string"
          ? { varName: varAttachment }
          : { varName: varAttachment.name, aggrandizements: varAttachment.aggrandizements })
        : {
            outputName: outputAttachment!.name,
            outputUuid: outputAttachment!.uuid,
            aggrandizements: outputAttachment!.aggrandizements,
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

function dictionaryFieldXml(items: DictionaryFieldItem[], indent: number): string {
  const pad = "\t".repeat(indent);
  const serializedItems = items.map(({ key, value = "", itemType = 0, outputAttachment = null, varAttachment = null, multiRawText = null, rawAttachments = null }) => {
    const keyXml = indentBlock(tokenStringXml({ text: key }), indent + 4);
    const valXml = indentBlock(tokenStringXml({ text: value, outputAttachment, varAttachment, multiRawText, rawAttachments }), indent + 4);
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

function actionBlockXml(identifier: string, paramsBody: string): string {
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

function commentActionXml(text: string): string {
  return actionBlockXml(
    "is.workflow.actions.comment",
    `\t\t\t\t<key>WFCommentActionText</key>\n\t\t\t\t<string>${escapeXml(text)}</string>`,
  );
}

function currentDateActionXml({ uuid }: { uuid: string }): string {
  return actionBlockXml("is.workflow.actions.date", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFDateActionMode</key>",
    "\t\t\t\t<string>Current Date</string>",
  ].join("\n"));
}

function textActionXml({
  uuid,
  text = "",
  extensionInput = false,
}: {
  uuid: string;
  text?: string;
  extensionInput?: boolean;
}): string {
  const textValueXml = extensionInput
    ? indentBlock(tokenStringXml({ extensionInput: true }), 4)
    : `\t\t\t\t<string>${escapeXml(text)}</string>`;
  return actionBlockXml("is.workflow.actions.gettext", [
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>WFTextActionText</key>",
    textValueXml,
  ].join("\n"));
}

function openAppActionXml(bundleIdentifier: string, appName: string): string {
  return actionBlockXml("is.workflow.actions.openapp", [
    "\t\t\t\t<key>WFAppIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(bundleIdentifier)}</string>`,
    "\t\t\t\t<key>WFAppName</key>",
    `\t\t\t\t<string>${escapeXml(appName)}</string>`,
    "\t\t\t\t<key>WFSelectedApp</key>",
    "\t\t\t\t<dict>",
    "\t\t\t\t\t<key>BundleIdentifier</key>",
    `\t\t\t\t\t<string>${escapeXml(bundleIdentifier)}</string>`,
    "\t\t\t\t\t<key>Name</key>",
    `\t\t\t\t\t<string>${escapeXml(appName)}</string>`,
    "\t\t\t\t</dict>",
  ].join("\n"));
}

function buildUniversalConfigPrelude(uuidFactory: () => string): {
  originUuid: string;
  tokenUuid: string;
  actions: string[];
  importQuestions: ShortcutImportQuestion[];
} {
  const originUuid = uuidFactory();
  const tokenUuid = uuidFactory();
  return {
    originUuid,
    tokenUuid,
    actions: [
      textActionXml({ uuid: originUuid, text: "" }),
      textActionXml({ uuid: tokenUuid, text: "" }),
    ],
    importQuestions: [
      {
        actionIndex: 1,
        parameterKey: "WFTextActionText",
        defaultValue: "",
        text: "请输入铁记服务器地址（例如 http://你的IP:8080 或 https://你的域名，末尾不要斜杠）",
      },
      {
        actionIndex: 2,
        parameterKey: "WFTextActionText",
        defaultValue: "",
        text: "请粘贴铁记设备上传令牌（在铁记网页「设置 → Apple 健康」复制，只填令牌本身，无需写 Bearer）",
      },
    ],
  };
}

export function encodeShortcutXmlToBase64(xml: string): string {
  const bytes = new TextEncoder().encode(xml);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function downloadJsonActionXml({
  uuid,
  endpoint = "",
  endpointPath,
  token = "",
  originUuid,
  tokenUuid,
  bodyItems = null,
  method = "POST",
}: {
  uuid: string;
  endpoint?: string;
  endpointPath?: string;
  token?: string;
  originUuid?: string;
  tokenUuid?: string;
  bodyItems?: DictionaryFieldItem[] | null;
  method?: "GET" | "POST";
}): string {
  const headerItems: DictionaryFieldItem[] = tokenUuid
    ? [
        {
          key: "Authorization",
          multiRawText: "Bearer &#xFFFC;",
          rawAttachments: [{ range: "{7, 1}", entry: { outputName: "Text", outputUuid: tokenUuid } }],
        },
      ]
    : [{ key: "Authorization", value: `Bearer ${token}` }];
  if (method !== "GET" && bodyItems) headerItems.push({ key: "Content-Type", value: "application/json" });
  const headersXml = dictionaryFieldXml(headerItems, 4);
  const urlValueXml = originUuid && endpointPath
    ? indentBlock(
        tokenStringXml({
          multiRawText: `&#xFFFC;${escapeXml(endpointPath)}`,
          rawAttachments: [{ range: "{0, 1}", entry: { outputName: "Text", outputUuid: originUuid } }],
        }),
        4,
      )
    : `\t\t\t\t<string>${escapeXml(endpoint)}</string>`;
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
    urlValueXml,
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

function actionOutputAttachmentXml({
  outputUuid,
  outputName,
  indent = 5,
}: {
  outputUuid: string;
  outputName: string;
  indent?: number;
}): string {
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

function delayActionXml(seconds = 5): string {
  return actionBlockXml(
    "is.workflow.actions.delay",
    `\t\t\t\t<key>WFDelayTime</key>\n\t\t\t\t<integer>${seconds}</integer>`,
  );
}

/**
 * Native Apple Watch "Start Workout" action (`is.workflow.actions.workout.start`)
 * targeting `com.apple.SessionTrackerApp` (verified against Apple iCloud plist client 3607.0.2
 * and iOS ToolKit v78 schema: `IntentAppDefinition`, `workoutName`, `isOpenEnded`, `WorkoutGoal`).
 * Setting `isOpenEnded = true` starts an Open Goal workout without prompting for a goal.
 */
function startWorkoutActionXml({
  uuid,
  workoutNameUuid,
  workoutNameOutputName = "Text",
}: {
  uuid: string;
  workoutNameUuid: string;
  workoutNameOutputName?: string;
}): string {
  return actionBlockXml("is.workflow.actions.workout.start", [
    "\t\t\t\t<key>IntentAppDefinition</key>",
    "\t\t\t\t<dict>",
    "\t\t\t\t\t<key>BundleIdentifier</key>",
    "\t\t\t\t\t<string>com.apple.SessionTrackerApp</string>",
    "\t\t\t\t</dict>",
    "\t\t\t\t<key>UUID</key>",
    `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
    "\t\t\t\t<key>isOpenEnded</key>",
    "\t\t\t\t<true/>",
    "\t\t\t\t<key>workoutName</key>",
    actionOutputAttachmentXml({ outputUuid: workoutNameUuid, outputName: workoutNameOutputName, indent: 4 }),
  ].join("\n"));
}

function resolveAppleWorkoutName(
  activityType: string,
  environment: ShortcutEnvironment,
  locale: ShortcutLocale,
): string {
  const en = locale === "en";
  switch (activityType) {
    case "traditionalStrengthTraining":
      return en ? "Traditional Strength Training" : "传统力量训练";
    case "functionalStrengthTraining":
      return en ? "Functional Strength Training" : "功能性力量训练";
    case "coreTraining":
      return en ? "Core Training" : "核心训练";
    case "running":
      return environment === "indoor"
        ? (en ? "Indoor Run" : "室内跑步")
        : (en ? "Outdoor Run" : "户外跑步");
    case "cycling":
      return environment === "indoor"
        ? (en ? "Indoor Cycle" : "室内单车")
        : (en ? "Outdoor Cycle" : "户外单车");
    case "walking":
      return environment === "indoor"
        ? (en ? "Indoor Walk" : "室内步行")
        : (en ? "Outdoor Walk" : "户外步行");
    case "stairClimbing":
      return en ? "Stair Stepper" : "踏步机";
    case "elliptical":
      return en ? "Elliptical" : "椭圆机";
    case "rowing":
      return en ? "Rower" : "划船机";
    case "swimming":
      return environment === "outdoor"
        ? (en ? "Open Water Swim" : "开放水域游泳")
        : (en ? "Pool Swim" : "泳池游泳");
    case "highIntensityIntervalTraining":
      return en ? "High Intensity Interval Training" : "高强度间歇训练";
    case "jumpRope":
      return en ? "Jump Rope" : "跳绳";
    case "hiking":
      return en ? "Hiking" : "徒步";
    case "mixedCardio":
      return en ? "Mixed Cardio" : "混合有氧";
    case "crossTraining":
      return en ? "Cross Training" : "交叉训练";
    default:
      return en ? "Other" : "其他";
  }
}

function getDictionaryValueActionXml({
  uuid,
  key,
  inputUuid,
  inputName = "Contents of URL",
}: {
  uuid: string;
  key: string;
  inputUuid: string;
  inputName?: string;
}): string {
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
}: {
  uuid: string;
  minutes?: number | null;
  minutesUuid?: string | null;
  minutesOutputName?: string;
  inputUuid: string;
  inputName?: string;
}): string {
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

type DateFilterSpec =
  | {
      kind: "betweenDates";
      startDateUuid: string;
      startDateOutputName?: string;
      endDateUuid: string;
      endDateOutputName?: string;
      byEndDate?: boolean;
    }
  | {
      kind: "today";
      byEndDate?: boolean;
    }
  | {
      kind: "lastDays";
      days: number;
      byEndDate?: boolean;
    };

function findHealthSampleActionXml({
  uuid,
  typeLabel,
  unit = null,
  groupBy = null,
  dateFilter,
  sortOrder = "Latest First",
  limit = null,
}: {
  uuid: string;
  typeLabel: string;
  unit?: string | null;
  groupBy?: "Minute" | "Hour" | "Day" | "Week" | "Month" | "Year" | null;
  dateFilter: DateFilterSpec;
  sortOrder?: "Latest First" | "Oldest First";
  limit?: number | null;
}): string {
  let dateTemplate: string[];
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
    // Verified byte-for-byte against Apple's real iOS 26.2 Find Health Samples export:
    // Operator 1002 ("Start Date is today") with default Number="7" + Unit=16 + BoundedDate=false.
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
      "\t\t\t\t\t\t\t\t\t<dict>",
      "\t\t\t\t\t\t\t\t\t\t<key>Number</key>",
      "\t\t\t\t\t\t\t\t\t\t<string>7</string>",
      "\t\t\t\t\t\t\t\t\t\t<key>Unit</key>",
      "\t\t\t\t\t\t\t\t\t\t<integer>16</integer>",
      "\t\t\t\t\t\t\t\t\t</dict>",
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
      `\t\t\t\t\t\t\t\t\t\t<integer>${Math.max(1, Math.round(amount))}</integer>`,
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
    "\t\t\t\t\t\t<false/>",
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
  if (groupBy) {
    params.push(
      "\t\t\t\t<key>WFHKSampleFilteringFillMissing</key>",
      "\t\t\t\t<false/>",
      "\t\t\t\t<key>WFHKSampleFilteringGroupBy</key>",
      `\t\t\t\t<string>${escapeXml(groupBy)}</string>`,
    );
  }

  return actionBlockXml("is.workflow.actions.filter.health.quantity", params.join("\n"));
}

function calculateStatisticsActionXml({
  uuid,
  operation = "Sum",
  inputUuid,
  inputName = "Value",
}: {
  uuid: string;
  operation?: "Sum" | "Average" | "Minimum" | "Maximum";
  inputUuid: string;
  inputName?: string;
}): string {
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

function countItemsActionXml({
  uuid,
  inputUuid,
  inputName = "Value",
}: {
  uuid: string;
  inputUuid: string;
  inputName?: string;
}): string {
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

function getHealthDetailActionXml({
  uuid,
  propertyName,
  inputUuid = null,
  repeatItem = false,
}: {
  uuid: string;
  propertyName: string;
  inputUuid?: string | null;
  repeatItem?: boolean;
}): string {
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

function setVariableActionXml({
  variableName,
  inputUuid,
  inputName = "Value",
}: {
  variableName: string;
  inputUuid: string;
  inputName?: string;
}): string {
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

function healthSampleRowsActions({
  uuidFactory,
  inputUuid,
  variableName,
  columns,
}: {
  uuidFactory: () => string;
  inputUuid: string;
  variableName: string;
  columns: string[];
}): string[] {
  const repeatGroup = uuidFactory();
  const repeatEnd = uuidFactory();
  const detailActions: string[] = [];
  const attachments = columns.map((propertyName, index) => {
    const uuid = uuidFactory();
    detailActions.push(getHealthDetailActionXml({ uuid, propertyName, repeatItem: true }));
    return {
      range: `{${index * 2}, 1}`,
      entry: {
        outputName: propertyName,
        outputUuid: uuid,
        aggrandizements: propertyName.endsWith("Date") ? ISO_DATE_AGGRANDIZEMENTS : undefined,
      },
    };
  });
  const repeatAction = (mode: number, uuid: string, input: string[] = []) =>
    actionBlockXml(
      "is.workflow.actions.repeat.each",
      [
        "\t\t\t\t<key>GroupingIdentifier</key>",
        `\t\t\t\t<string>${escapeXml(repeatGroup)}</string>`,
        "\t\t\t\t<key>UUID</key>",
        `\t\t\t\t<string>${escapeXml(uuid)}</string>`,
        "\t\t\t\t<key>WFControlFlowMode</key>",
        `\t\t\t\t<integer>${mode}</integer>`,
        ...input,
      ].join("\n"),
    );
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
      indentBlock(
        tokenStringXml({
          multiRawText: columns.map(() => "&#xFFFC;").join("|"),
          rawAttachments: attachments,
        }),
        4,
      ),
    ].join("\n")),
    repeatAction(2, repeatEnd),
    setVariableActionXml({ variableName, inputUuid: repeatEnd, inputName: "Repeat Results" }),
  ];
}

type ConditionalInputSpec =
  | { kind: "output"; outputUuid: string; outputName: string }
  | { kind: "variable"; variableName: string }
  | { kind: "extensionInput" };

function conditionalBlock({
  groupUuid,
  input,
  condition,
  equalsText = "",
  bodyActions,
  otherwiseActions = [],
}: {
  groupUuid: string;
  input: ConditionalInputSpec;
  condition: 100 | 4;
  equalsText?: string;
  bodyActions: string[];
  otherwiseActions?: string[];
}): string[] {
  const entry: AttachmentEntry = input.kind === "extensionInput"
    ? { extensionInput: true }
    : input.kind === "variable"
      ? { varName: input.variableName }
      : { outputName: input.outputName, outputUuid: input.outputUuid };

  const openParams = [
    "\t\t\t\t<key>GroupingIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
    "\t\t\t\t<key>WFCondition</key>",
    `\t\t\t\t<integer>${condition}</integer>`,
    ...(condition === 4
      ? [
          "\t\t\t\t<key>WFConditionalActionString</key>",
          `\t\t\t\t<string>${escapeXml(equalsText)}</string>`,
        ]
      : []),
    "\t\t\t\t<key>WFControlFlowMode</key>",
    "\t\t\t\t<integer>0</integer>",
    "\t\t\t\t<key>WFInput</key>",
    "\t\t\t\t<dict>",
    "\t\t\t\t\t<key>Type</key>",
    "\t\t\t\t\t<string>Variable</string>",
    "\t\t\t\t\t<key>Variable</key>",
    "\t\t\t\t\t<dict>",
    "\t\t\t\t\t\t<key>Value</key>",
    attachmentEntryXml(entry, 6),
    "\t\t\t\t\t\t<key>WFSerializationType</key>",
    "\t\t\t\t\t\t<string>WFTextTokenAttachment</string>",
    "\t\t\t\t\t</dict>",
    "\t\t\t\t</dict>",
  ];

  const openIf = actionBlockXml("is.workflow.actions.conditional", openParams.join("\n"));
  const middleIf = otherwiseActions.length
    ? [
        actionBlockXml("is.workflow.actions.conditional", [
          "\t\t\t\t<key>GroupingIdentifier</key>",
          `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
          "\t\t\t\t<key>WFControlFlowMode</key>",
          "\t\t\t\t<integer>1</integer>",
        ].join("\n")),
        ...otherwiseActions,
      ]
    : [];

  const closeIf = actionBlockXml("is.workflow.actions.conditional", [
    "\t\t\t\t<key>GroupingIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
    "\t\t\t\t<key>WFControlFlowMode</key>",
    "\t\t\t\t<integer>2</integer>",
  ].join("\n"));

  return [openIf, ...bodyActions, ...middleIf, closeIf];
}

function conditionalHasValueBlock({
  groupUuid,
  inputUuid,
  inputName = "Health Samples",
  bodyActions,
}: {
  groupUuid: string;
  inputUuid: string;
  inputName?: string;
  bodyActions: string[];
}): string[] {
  return conditionalBlock({
    groupUuid,
    input: { kind: "output", outputUuid: inputUuid, outputName: inputName },
    condition: 100,
    bodyActions,
  });
}

function chooseFromMenuBlock({
  groupUuid,
  prompt,
  items,
}: {
  groupUuid: string;
  prompt: string;
  items: Array<{ title: string; actions: string[] }>;
}): string[] {
  const openMenu = actionBlockXml("is.workflow.actions.choosefrommenu", [
    "\t\t\t\t<key>GroupingIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
    "\t\t\t\t<key>WFControlFlowMode</key>",
    "\t\t\t\t<integer>0</integer>",
    "\t\t\t\t<key>WFMenuItems</key>",
    "\t\t\t\t<array>",
    ...items.map((item) => `\t\t\t\t\t<string>${escapeXml(item.title)}</string>`),
    "\t\t\t\t</array>",
    "\t\t\t\t<key>WFMenuPrompt</key>",
    `\t\t\t\t<string>${escapeXml(prompt)}</string>`,
  ].join("\n"));

  const branches = items.flatMap((item) => [
    actionBlockXml("is.workflow.actions.choosefrommenu", [
      "\t\t\t\t<key>GroupingIdentifier</key>",
      `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
      "\t\t\t\t<key>WFControlFlowMode</key>",
      "\t\t\t\t<integer>1</integer>",
      "\t\t\t\t<key>WFMenuItemTitle</key>",
      `\t\t\t\t<string>${escapeXml(item.title)}</string>`,
    ].join("\n")),
    ...item.actions,
  ]);

  const closeMenu = actionBlockXml("is.workflow.actions.choosefrommenu", [
    "\t\t\t\t<key>GroupingIdentifier</key>",
    `\t\t\t\t<string>${escapeXml(groupUuid)}</string>`,
    "\t\t\t\t<key>WFControlFlowMode</key>",
    "\t\t\t\t<integer>2</integer>",
  ].join("\n"));

  return [openMenu, ...branches, closeMenu];
}

function wrapShortcutPlist(
  actionBlocks: string[],
  importQuestions: ShortcutImportQuestion[] = [],
  options: { hasShortcutInputVariables?: boolean } = {},
): string {
  const hasInputVarsTag = options.hasShortcutInputVariables ? "\t<true/>" : "\t<false/>";
  const importQuestionsLines = importQuestions.length
    ? [
        "\t<key>WFWorkflowImportQuestions</key>",
        "\t<array>",
        ...importQuestions.flatMap((q) => [
          "\t\t<dict>",
          "\t\t\t<key>ActionIndex</key>",
          `\t\t\t<integer>${q.actionIndex}</integer>`,
          "\t\t\t<key>Category</key>",
          "\t\t\t<string>Parameter</string>",
          "\t\t\t<key>DefaultValue</key>",
          `\t\t\t<string>${escapeXml(q.defaultValue)}</string>`,
          "\t\t\t<key>ParameterKey</key>",
          `\t\t\t<string>${escapeXml(q.parameterKey)}</string>`,
          "\t\t\t<key>Text</key>",
          `\t\t\t<string>${escapeXml(q.text)}</string>`,
          "\t\t</dict>",
        ]),
        "\t</array>",
      ]
    : [
        "\t<key>WFWorkflowImportQuestions</key>",
        "\t<array/>",
      ];

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
    hasInputVarsTag,
    "\t<key>WFWorkflowIcon</key>",
    "\t<dict>",
    "\t\t<key>WFWorkflowIconGlyphNumber</key>",
    "\t\t<integer>61440</integer>",
    "\t\t<key>WFWorkflowIconStartColor</key>",
    "\t\t<integer>431817727</integer>",
    "\t</dict>",
    ...importQuestionsLines,
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

interface DistanceSampleSpec {
  zh: string;
  en: string;
  unit: string;
  jsonKey: string;
  varName: string;
}

const DISTANCE_SAMPLE_SPECS: Record<DistanceMode, DistanceSampleSpec> = {
  foot: { zh: "步行 + 跑步距离", en: "Walking + Running Distance", unit: "km", jsonKey: "distanceKm", varName: "v_distanceKm" },
  cycling: { zh: "骑行距离", en: "Cycling Distance", unit: "km", jsonKey: "distanceKm", varName: "v_distanceKm" },
  swimming: { zh: "游泳距离", en: "Swimming Distance", unit: "m", jsonKey: "distanceMeters", varName: "v_distanceMeters" },
};

function resolveShortcutLocale(locale: string = "zh-Hans"): ShortcutLocale {
  if (!Object.prototype.hasOwnProperty.call(APPLE_SHORTCUT_HEALTH_LOCALES, locale)) {
    throw new Error("快捷指令语言仅支持 zh-Hans 或 en");
  }
  return locale as ShortcutLocale;
}

function resolveWorkoutConfig({
  serverOrigin,
  token,
  activityType,
  environment,
  locale,
  useImportQuestions = false,
}: {
  serverOrigin?: string;
  token?: string;
  activityType: string;
  environment?: string;
  locale: string;
  useImportQuestions?: boolean;
}) {
  if (!ACTIVITY_TYPE_RE.test(String(activityType ?? ""))) {
    throw new Error("运动类型标识不合法");
  }
  const sport = APPLE_SHORTCUT_SPORTS.find((item) => item.activityType === activityType) ?? null;
  const resolvedEnv = environment ?? sport?.defaultEnvironment ?? "unknown";
  if (!VALID_ENVIRONMENTS.has(resolvedEnv)) {
    throw new Error("运动环境必须为 indoor、outdoor 或 unknown");
  }
  const resolvedLocale = resolveShortcutLocale(locale);
  const cleanToken = useImportQuestions ? "" : validateToken(token);
  const base = useImportQuestions ? "" : normalizeServerOrigin(serverOrigin);
  const distanceSpec = sport?.hasDistance && sport.distanceMode ? DISTANCE_SAMPLE_SPECS[sport.distanceMode] ?? null : null;
  return {
    sport,
    sportLabel: sport?.label ?? activityType,
    resolvedEnv: resolvedEnv as ShortcutEnvironment,
    resolvedLocale,
    cleanToken,
    base,
    distanceSpec,
  };
}

function buildWorkoutWindowMetricsActions({
  uuidFactory,
  dateFilter,
  distanceSpec = null,
}: {
  uuidFactory: () => string;
  dateFilter: DateFilterSpec;
  distanceSpec?: DistanceSampleSpec | null;
}) {
  const actions: string[] = [];
  const bodyItems: DictionaryFieldItem[] = [
    { key: "energyKind", value: "window_estimate" },
    { key: "heartRateMethod", value: "window_samples" },
  ];

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

export function buildIronlogEventShortcut({
  event,
  serverOrigin,
  token,
  activityType = "traditionalStrengthTraining",
  environment,
  collectMetrics = true,
  locale = "zh-Hans",
  useImportQuestions = false,
  uuids,
  uuidFactory = makeUuid,
}: {
  event?: "start" | "end";
  serverOrigin?: string;
  token?: string;
  activityType?: string;
  environment?: string;
  collectMetrics?: boolean;
  locale?: string;
  useImportQuestions?: boolean;
  uuids?: { date?: string; request?: string };
  uuidFactory?: () => string;
} = {}) {
  if (!event || !VALID_EVENTS.has(event)) throw new Error("event 必须为 start 或 end");
  const {
    sportLabel,
    resolvedEnv,
    resolvedLocale,
    cleanToken,
    base,
    distanceSpec,
  } = resolveWorkoutConfig({ serverOrigin, token, activityType, environment, locale, useImportQuestions });

  const endpointPath = "/api/integrations/apple-health/events";
  const endpoint = useImportQuestions ? `<导入时填写>${endpointPath}` : `${base}${endpointPath}`;
  const prelude = useImportQuestions ? buildUniversalConfigPrelude(uuidFactory) : null;
  const dateUuid = uuids?.date ?? uuidFactory();
  const requestUuid = uuids?.request ?? uuidFactory();
  const eventLabel = event === "start" ? "开始" : "结束";
  const filename = useImportQuestions
    ? `铁记-通用-${eventLabel}-${sportLabel}.shortcut`
    : `铁记-${eventLabel}-${sportLabel}.shortcut`;

  if (event === "start" || collectMetrics === false) {
    const commentText = [
      `铁记（Ironlog）自动上报：Apple Watch ${sportLabel}（${eventLabel}）`,
      `目标接口：${endpoint}`,
      `绑定方式：iPhone「快捷指令 → 自动化 → + → Apple Watch 体能训练（${eventLabel}时 · 立即运行）」选择本快捷指令。`,
    ].join("\n");

    const xml = wrapShortcutPlist(
      [
        commentActionXml(commentText),
        ...(prelude ? prelude.actions : []),
        currentDateActionXml({ uuid: dateUuid }),
        downloadJsonActionXml({
          uuid: requestUuid,
          endpoint,
          endpointPath: prelude ? endpointPath : undefined,
          token: cleanToken,
          originUuid: prelude?.originUuid,
          tokenUuid: prelude?.tokenUuid,
          bodyItems: [
            { key: "schemaVersion", value: "1", itemType: 3 },
            { key: "event", value: event },
            { key: "activityType", value: activityType },
            { key: "environment", value: resolvedEnv },
            { key: "occurredAt", outputAttachment: { name: "Date", uuid: dateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
          ],
        }),
      ],
      prelude?.importQuestions ?? [],
    );

    return {
      filename,
      shortcutName: filename.replace(/\.shortcut$/, ""),
      endpoint,
      locale: resolvedLocale,
      xml,
      base64: encodeShortcutXmlToBase64(xml),
    };
  }

  const activeEndpointPath = `/api/integrations/apple-health/events/active?activityType=${encodeURIComponent(activityType)}`;
  const activeEndpoint = `${base}${activeEndpointPath}`;
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
    distanceSpec,
  });

  const commentText = [
    `铁记（Ironlog）自动上报：Apple Watch ${sportLabel}（${eventLabel} · 含热量/心率${distanceSpec ? "/距离" : ""}）`,
    `目标接口：${endpoint}`,
    `绑定方式：iPhone「快捷指令 → 自动化 → + → Apple Watch 体能训练（结束时 · 立即运行）」选择本快捷指令，需先配对同名「开始」自动化。`,
  ].join("\n");

  const xml = wrapShortcutPlist(
    [
      commentActionXml(commentText),
      ...(prelude ? prelude.actions : []),
      delayActionXml(5),
      currentDateActionXml({ uuid: dateUuid }),
      downloadJsonActionXml({
        uuid: activeReqUuid,
        endpoint: activeEndpoint,
        endpointPath: prelude ? activeEndpointPath : undefined,
        token: cleanToken,
        originUuid: prelude?.originUuid,
        tokenUuid: prelude?.tokenUuid,
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
        endpointPath: prelude ? endpointPath : undefined,
        token: cleanToken,
        originUuid: prelude?.originUuid,
        tokenUuid: prelude?.tokenUuid,
        bodyItems: [
          { key: "schemaVersion", value: "1", itemType: 3 },
          { key: "event", value: "end" },
          { key: "activityType", value: activityType },
          { key: "environment", value: resolvedEnv },
          { key: "occurredAt", outputAttachment: { name: "Date", uuid: dateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
          ...metrics.bodyItems,
        ],
      }),
    ],
    prelude?.importQuestions ?? [],
  );

  return {
    filename,
    shortcutName: filename.replace(/\.shortcut$/, ""),
    endpoint,
    locale: resolvedLocale,
    xml,
    base64: encodeShortcutXmlToBase64(xml),
  };
}

export function buildIronlogRecentWorkoutShortcut({
  serverOrigin,
  token,
  activityType = "traditionalStrengthTraining",
  environment,
  windowMinutes = 45,
  locale = "zh-Hans",
  useImportQuestions = false,
  uuidFactory = makeUuid,
}: {
  serverOrigin?: string;
  token?: string;
  activityType?: string;
  environment?: string;
  windowMinutes?: number;
  locale?: string;
  useImportQuestions?: boolean;
  uuidFactory?: () => string;
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
  } = resolveWorkoutConfig({ serverOrigin, token, activityType, environment, locale, useImportQuestions });

  const endpointPath = "/api/integrations/apple-health/workouts";
  const endpoint = useImportQuestions ? `<导入时填写>${endpointPath}` : `${base}${endpointPath}`;
  const prelude = useImportQuestions ? buildUniversalConfigPrelude(uuidFactory) : null;
  const filename = useImportQuestions
    ? `铁记-通用-结束直传-${sportLabel}.shortcut`
    : `铁记-结束直传-${sportLabel}.shortcut`;
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
    distanceSpec,
  });

  const commentText = [
    `铁记（Ironlog）单条全自动直传：${sportLabel}（免配「开始」自动化，回溯最近 ${resolvedMinutes} 分钟）`,
    `目标接口：${endpoint}`,
    `绑定方式：iPhone「快捷指令 → 自动化 → + → Apple Watch 体能训练（结束任何体能训练 / ${sportLabel} · 立即运行）」选择本快捷指令即可；如单次训练更长/更短，可在下方动作里微调 ${resolvedMinutes} 分钟窗口。`,
  ].join("\n");

  const xml = wrapShortcutPlist(
    [
      commentActionXml(commentText),
      ...(prelude ? prelude.actions : []),
      delayActionXml(5),
      currentDateActionXml({ uuid: nowDateUuid }),
      adjustDateSubtractMinutesActionXml({ uuid: startRawUuid, minutes: resolvedMinutes, inputUuid: nowDateUuid, inputName: "Date" }),
      ...metrics.actions,
      downloadJsonActionXml({
        uuid: requestUuid,
        endpoint,
        endpointPath: prelude ? endpointPath : undefined,
        token: cleanToken,
        originUuid: prelude?.originUuid,
        tokenUuid: prelude?.tokenUuid,
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
    ],
    prelude?.importQuestions ?? [],
  );

  return {
    filename,
    shortcutName: filename.replace(/\.shortcut$/, ""),
    endpoint,
    locale: resolvedLocale,
    windowMinutes: resolvedMinutes,
    xml,
    base64: encodeShortcutXmlToBase64(xml),
  };
}

function resolveDailyMetricsSelection({
  groups = APPLE_HEALTH_DAILY_GROUPS.map((g) => g.id),
  metrics = null,
}: {
  groups?: string[];
  metrics?: string[] | null;
}): {
  activeGroups: HealthDailyGroupDef[];
  selectedGroups: string[];
  selectedMetrics: HealthDailyMetricDef[];
} {
  if (Array.isArray(metrics)) {
    const metricSet = new Set(metrics);
    const selectedMetrics = APPLE_HEALTH_DAILY_GROUPS.flatMap((g) => g.metrics).filter((m) => metricSet.has(m.key));
    if (!selectedMetrics.length) throw new Error("请至少选择一项健康指标");
    const activeGroups = APPLE_HEALTH_DAILY_GROUPS.filter((g) => g.metrics.some((m) => metricSet.has(m.key)));
    return { activeGroups, selectedGroups: activeGroups.map((g) => g.id), selectedMetrics };
  }
  const selectedGroups = [...new Set(groups)].filter((id) => VALID_DAILY_GROUPS.has(id));
  if (!selectedGroups.length) throw new Error("请至少选择一类健康数据");
  const activeGroups = APPLE_HEALTH_DAILY_GROUPS.filter((g) => selectedGroups.includes(g.id));
  return { activeGroups, selectedGroups, selectedMetrics: activeGroups.flatMap((g) => g.metrics) };
}

function buildDailyHealthCollectionActions({
  uuidFactory,
  selectedMetrics,
  endpoint,
  endpointPath,
  cleanToken,
  originUuid,
  tokenUuid,
}: {
  uuidFactory: () => string;
  selectedMetrics: HealthDailyMetricDef[];
  endpoint: string;
  endpointPath?: string;
  cleanToken: string;
  originUuid?: string;
  tokenUuid?: string;
}): string[] {
  const actions: string[] = [];
  const jsonBodyItems: DictionaryFieldItem[] = [
    { key: "schemaVersion", value: "1", itemType: 3 },
    { key: "shortcutGenVersion", value: "3" },
    { key: "source", value: "shortcut" },
  ];
  const rawNowUuid = uuidFactory();
  actions.push(currentDateActionXml({ uuid: rawNowUuid }));
  jsonBodyItems.push({
    key: "occurredAt",
    outputAttachment: { name: "Date", uuid: rawNowUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS },
  });

  // For dailySum metrics, use native "Start Date is today" (`Operator: 1002`, `Values: { Number: "7", Unit: 16 }`,
  // `WFContentPredicateBoundedDate: false`, verified against real iOS 26.2 Find Health Samples exports):
  // - Steps groups by Hour (at most 24 buckets for today, no Limit cap, summed via Calculate Statistics)
  // - Other dailySum metrics group by Day (1 bucket for today)
  // For sleep & latest point-in-time vitals/body metrics, use relative 1-day (24h) `Operator: 1001`.
  for (const metric of selectedMetrics) {
    const findUuid = uuidFactory();
    const variableName = `v_${metric.key}`;
    const isSleep = metric.mode === "sleepIntervals";
    const latest = metric.mode === "latest";
    const isDailySum = metric.mode === "dailySum";
    const isSteps = metric.key === "steps";
    actions.push(findHealthSampleActionXml({
      uuid: findUuid,
      typeLabel: metric.typeLabelEn,
      unit: metric.unit ?? null,
      groupBy: isSteps ? "Hour" : isDailySum ? "Day" : null,
      dateFilter: isDailySum
        ? { kind: "today" }
        : { kind: "lastDays", days: 1, byEndDate: isSleep },
      sortOrder: isSleep ? "Oldest First" : "Latest First",
      limit: latest ? 1 : null,
    }));

    let bodyActions: string[];
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
    endpointPath,
    token: cleanToken,
    originUuid,
    tokenUuid,
    bodyItems: jsonBodyItems,
  }));

  return actions;
}

export function buildIronlogDailyHealthShortcut({
  serverOrigin,
  token,
  groups = APPLE_HEALTH_DAILY_GROUPS.map((g) => g.id),
  metrics = null,
  locale = "zh-Hans",
  useImportQuestions = false,
  uuidFactory = makeUuid,
}: {
  serverOrigin?: string;
  token?: string;
  groups?: string[];
  metrics?: string[] | null;
  locale?: string;
  useImportQuestions?: boolean;
  uuidFactory?: () => string;
} = {}) {
  const resolvedLocale = resolveShortcutLocale(locale);
  const cleanToken = useImportQuestions ? "" : validateToken(token);
  const base = useImportQuestions ? "" : normalizeServerOrigin(serverOrigin);
  const endpointPath = "/api/integrations/apple-health/daily";
  const endpoint = useImportQuestions ? `<导入时填写>${endpointPath}` : `${base}${endpointPath}`;
  const prelude = useImportQuestions ? buildUniversalConfigPrelude(uuidFactory) : null;

  const { activeGroups, selectedGroups, selectedMetrics } = resolveDailyMetricsSelection({ groups, metrics });
  const groupNames = activeGroups.map((g) => g.label).join("、");
  const filename = useImportQuestions
    ? "铁记-通用-每日全量健康同步.shortcut"
    : "铁记-每日全量健康同步.shortcut";

  const commentText = [
    `铁记（Ironlog）每日 Apple 健康同步：${groupNames}（共 ${selectedMetrics.length} 项）`,
    `目标接口：${endpoint}`,
    `提示：① 首次运行请在 iPhone「健康 App → 头像 → 隐私 → App → 快捷指令」打开已选指标权限；② 若某项健康数据最近无记录，iOS 快捷指令会弹窗「未找到样本」，建议只在网页端勾选你平时确实有数据的指标。`,
  ].join("\n");

  const actions: string[] = [
    commentActionXml(commentText),
    ...(prelude ? prelude.actions : []),
    ...buildDailyHealthCollectionActions({
      uuidFactory,
      selectedMetrics,
      endpoint,
      endpointPath: prelude ? endpointPath : undefined,
      cleanToken,
      originUuid: prelude?.originUuid,
      tokenUuid: prelude?.tokenUuid,
    }),
  ];

  const xml = wrapShortcutPlist(actions, prelude?.importQuestions ?? []);
  return {
    filename,
    shortcutName: filename.replace(/\.shortcut$/, ""),
    endpoint,
    locale: resolvedLocale,
    metricCount: selectedMetrics.length,
    groups: selectedGroups,
    xml,
    base64: encodeShortcutXmlToBase64(xml),
  };
}

/**
 * Generates an all-in-one Apple Health & Fitness smart hub shortcut supporting
 * URL-routed input (`strength` | `cardio` | `end` | `daily`) and interactive menu fallback.
 */
export function buildIronlogUnifiedAppleHubShortcut({
  serverOrigin,
  token,
  activityType = "traditionalStrengthTraining",
  environment,
  windowMinutes = 45,
  groups = APPLE_HEALTH_DAILY_GROUPS.map((g) => g.id),
  metrics = null,
  locale = "zh-Hans",
  useImportQuestions = true,
  uuidFactory = makeUuid,
}: {
  serverOrigin?: string;
  token?: string;
  activityType?: string;
  environment?: string;
  windowMinutes?: number;
  groups?: string[];
  metrics?: string[] | null;
  locale?: string;
  useImportQuestions?: boolean;
  uuidFactory?: () => string;
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
  } = resolveWorkoutConfig({ serverOrigin, token, activityType, environment, locale, useImportQuestions });
  const { activeGroups, selectedGroups, selectedMetrics } = resolveDailyMetricsSelection({ groups, metrics });

  const prelude = useImportQuestions ? buildUniversalConfigPrelude(uuidFactory) : null;
  const eventsPath = "/api/integrations/apple-health/events";
  const activePath = `/api/integrations/apple-health/events/active?activityType=${encodeURIComponent(activityType)}`;
  const workoutsPath = "/api/integrations/apple-health/workouts";
  const dailyPath = "/api/integrations/apple-health/daily";
  const prefix = prelude ? "<导入时填写>" : base;
  const eventsEndpoint = `${prefix}${eventsPath}`;
  const activeEndpoint = `${prefix}${activePath}`;
  const workoutsEndpoint = `${prefix}${workoutsPath}`;
  const dailyEndpoint = `${prefix}${dailyPath}`;
  const filename = useImportQuestions
    ? `${DEFAULT_APPLE_HUB_SHORTCUT_NAME}.shortcut`
    : "铁记-Apple健康全能联动.shortcut";

  const commentText = [
    `铁记（Ironlog）Apple 健康全能智能联动（1 个快捷指令覆盖全流程）`,
    `默认运动：${sportLabel}（${resolvedEnv}），兜底窗口 ${resolvedMinutes} 分钟；每日健康涵盖：${activeGroups.map((g) => g.label).join("、")}（${selectedMetrics.length} 项）`,
    `网页智能路由参数（input=text）：`,
    `  • strength / strength:functional / strength:core：上报对应力量开始事件，自动开始对应体能训练并打开 Apple「健身」App`,
    `  • cardio / cardio:<方式>：按所选有氧方式上报开始事件，自动开始对应体能训练并打开 Apple「健身」App`,
    `  • end：等待 5 秒并回传活动能量、心率与对应距离（自动匹配网页或手表刚开启的训练，并可绑定 Apple Watch「体能训练结束时 → 文本 end → 运行本快捷指令」实现免动手全自动闭环）`,
    `  • daily：同步今日选定 Apple 健康指标`,
    `在手机上直接点击运行（无入参）时，会自动弹出 4 合 1 菜单。`,
  ].join("\n");

  const makeMenuSetMode = (modeValue: string) => {
    const valUuid = uuidFactory();
    return [
      textActionXml({ uuid: valUuid, text: modeValue }),
      setVariableActionXml({ variableName: "v_mode", inputUuid: valUuid, inputName: "Text" }),
    ];
  };

  const makeStartWorkoutAndOpenFitness = (workoutName: string) => {
    const nameUuid = uuidFactory();
    return [
      textActionXml({ uuid: nameUuid, text: workoutName }),
      startWorkoutActionXml({ uuid: uuidFactory(), workoutNameUuid: nameUuid }),
      openAppActionXml("com.apple.Fitness", "Fitness"),
    ];
  };

  const extInputTextUuid = uuidFactory();
  const resolveModeActions = conditionalBlock({
    groupUuid: uuidFactory(),
    input: { kind: "extensionInput" },
    condition: 100,
    bodyActions: [
      textActionXml({ uuid: extInputTextUuid, extensionInput: true }),
      setVariableActionXml({ variableName: "v_mode", inputUuid: extInputTextUuid, inputName: "Text" }),
    ],
    otherwiseActions: chooseFromMenuBlock({
      groupUuid: uuidFactory(),
      prompt: "选择铁记 Apple 健康操作",
      items: [
        { title: "开始传统力量", actions: makeMenuSetMode("strength") },
        { title: "打开有氧健身", actions: makeMenuSetMode("cardio") },
        { title: "结束训练并同步心率热量", actions: makeMenuSetMode("end") },
        { title: "同步今日健康数据", actions: makeMenuSetMode("daily") },
      ],
    }),
  });

  // Branch 1: strength -> report start event + start Watch workout + open Apple Fitness app
  const strengthDateUuid = uuidFactory();
  const defaultStrengthWorkoutName = resolveAppleWorkoutName(activityType, resolvedEnv, resolvedLocale);
  const strengthBranch = conditionalBlock({
    groupUuid: uuidFactory(),
    input: { kind: "variable", variableName: "v_mode" },
    condition: 4,
    equalsText: "strength",
    bodyActions: [
      currentDateActionXml({ uuid: strengthDateUuid }),
      downloadJsonActionXml({
        uuid: uuidFactory(),
        endpoint: eventsEndpoint,
        endpointPath: prelude ? eventsPath : undefined,
        token: cleanToken,
        originUuid: prelude?.originUuid,
        tokenUuid: prelude?.tokenUuid,
        bodyItems: [
          { key: "schemaVersion", value: "1", itemType: 3 },
          { key: "event", value: "start" },
          { key: "activityType", value: activityType },
          { key: "environment", value: resolvedEnv },
          { key: "occurredAt", outputAttachment: { name: "Date", uuid: strengthDateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
        ],
      }),
      commentActionXml(`【${sportLabel}】自动开始「${defaultStrengthWorkoutName}」体能训练并打开「健身」App`),
      ...makeStartWorkoutAndOpenFitness(defaultStrengthWorkoutName),
    ],
  });

  const strengthRoutes: ReadonlyArray<{
    mode: string;
    label: string;
    appleWorkoutLabel: string;
    appleWorkoutLabelEn: string;
    activityType: string;
    environment: ShortcutEnvironment;
  }> = [
    {
      mode: "strength:functional",
      label: "功能性力量",
      appleWorkoutLabel: "功能性力量训练",
      appleWorkoutLabelEn: "Functional Strength Training",
      activityType: "functionalStrengthTraining",
      environment: "indoor",
    },
    {
      mode: "strength:core",
      label: "核心训练",
      appleWorkoutLabel: "核心训练",
      appleWorkoutLabelEn: "Core Training",
      activityType: "coreTraining",
      environment: "indoor",
    },
  ];

  const strengthRouteBranches = strengthRoutes.flatMap((route) => {
    const startDateUuid = uuidFactory();
    const workoutName = resolvedLocale === "en" ? route.appleWorkoutLabelEn : route.appleWorkoutLabel;
    return conditionalBlock({
      groupUuid: uuidFactory(),
      input: { kind: "variable", variableName: "v_mode" },
      condition: 4,
      equalsText: route.mode,
      bodyActions: [
        currentDateActionXml({ uuid: startDateUuid }),
        downloadJsonActionXml({
          uuid: uuidFactory(),
          endpoint: eventsEndpoint,
          endpointPath: prelude ? eventsPath : undefined,
          token: cleanToken,
          originUuid: prelude?.originUuid,
          tokenUuid: prelude?.tokenUuid,
          bodyItems: [
            { key: "schemaVersion", value: "1", itemType: 3 },
            { key: "event", value: "start" },
            { key: "activityType", value: route.activityType },
            { key: "environment", value: route.environment },
            { key: "occurredAt", outputAttachment: { name: "Date", uuid: startDateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
          ],
        }),
        commentActionXml(`【${route.label}】自动开始「${workoutName}」体能训练并打开「健身」App`),
        ...makeStartWorkoutAndOpenFitness(workoutName),
      ],
    });
  });

  const cardioRoutes: ReadonlyArray<{
    id: string;
    label: string;
    appleWorkoutLabel: string;
    appleWorkoutLabelEn: string;
    activityType: string;
    environment: ShortcutEnvironment;
  }> = [
    { id: "outdoor_run", label: "户外跑步", appleWorkoutLabel: "户外跑步", appleWorkoutLabelEn: "Outdoor Run", activityType: "running", environment: "outdoor" },
    { id: "indoor_run", label: "室内跑步", appleWorkoutLabel: "室内跑步", appleWorkoutLabelEn: "Indoor Run", activityType: "running", environment: "indoor" },
    { id: "outdoor_cycle", label: "户外骑行", appleWorkoutLabel: "户外单车", appleWorkoutLabelEn: "Outdoor Cycle", activityType: "cycling", environment: "outdoor" },
    { id: "indoor_cycle", label: "室内单车", appleWorkoutLabel: "室内单车", appleWorkoutLabelEn: "Indoor Cycle", activityType: "cycling", environment: "indoor" },
    { id: "stair_climbing", label: "爬楼机", appleWorkoutLabel: "踏步机", appleWorkoutLabelEn: "Stair Stepper", activityType: "stairClimbing", environment: "indoor" },
    { id: "elliptical", label: "椭圆机", appleWorkoutLabel: "椭圆机", appleWorkoutLabelEn: "Elliptical", activityType: "elliptical", environment: "indoor" },
    { id: "rowing", label: "划船机", appleWorkoutLabel: "划船机", appleWorkoutLabelEn: "Rower", activityType: "rowing", environment: "indoor" },
    { id: "swimming", label: "游泳", appleWorkoutLabel: "泳池游泳", appleWorkoutLabelEn: "Pool Swim", activityType: "swimming", environment: "indoor" },
    { id: "hiit", label: "HIIT", appleWorkoutLabel: "高强度间歇训练", appleWorkoutLabelEn: "High Intensity Interval Training", activityType: "highIntensityIntervalTraining", environment: "indoor" },
    { id: "jump_rope", label: "跳绳", appleWorkoutLabel: "跳绳", appleWorkoutLabelEn: "Jump Rope", activityType: "jumpRope", environment: "indoor" },
    { id: "outdoor_walk", label: "户外步行", appleWorkoutLabel: "户外步行", appleWorkoutLabelEn: "Outdoor Walk", activityType: "walking", environment: "outdoor" },
    { id: "hiking", label: "徒步", appleWorkoutLabel: "徒步", appleWorkoutLabelEn: "Hiking", activityType: "hiking", environment: "outdoor" },
    { id: "mixed_cardio", label: "混合有氧", appleWorkoutLabel: "混合有氧", appleWorkoutLabelEn: "Mixed Cardio", activityType: "mixedCardio", environment: "indoor" },
  ];

  // Branch 2: cardio -> interactive menu of cardio modalities, setting v_mode to cardio:<id>
  const cardioBranch = conditionalBlock({
    groupUuid: uuidFactory(),
    input: { kind: "variable", variableName: "v_mode" },
    condition: 4,
    equalsText: "cardio",
    bodyActions: chooseFromMenuBlock({
      groupUuid: uuidFactory(),
      prompt: "选择有氧方式",
      items: [
        ...cardioRoutes.map((route) => ({
          title: route.label,
          actions: makeMenuSetMode(`cardio:${route.id}`),
        })),
        { title: "直接打开健身 App", actions: [openAppActionXml("com.apple.Fitness", "Fitness")] },
      ],
    }),
  });

  // Branch 2b..n: cardio:<id> -> log modality start event + start Watch workout + open Apple Fitness app
  const cardioRouteBranches = cardioRoutes.flatMap((route) => {
    const startDateUuid = uuidFactory();
    const workoutName = resolvedLocale === "en" ? route.appleWorkoutLabelEn : route.appleWorkoutLabel;
    return conditionalBlock({
      groupUuid: uuidFactory(),
      input: { kind: "variable", variableName: "v_mode" },
      condition: 4,
      equalsText: `cardio:${route.id}`,
      bodyActions: [
        currentDateActionXml({ uuid: startDateUuid }),
        downloadJsonActionXml({
          uuid: uuidFactory(),
          endpoint: eventsEndpoint,
          endpointPath: prelude ? eventsPath : undefined,
          token: cleanToken,
          originUuid: prelude?.originUuid,
          tokenUuid: prelude?.tokenUuid,
          bodyItems: [
            { key: "schemaVersion", value: "1", itemType: 3 },
            { key: "event", value: "start" },
            { key: "activityType", value: route.activityType },
            { key: "environment", value: route.environment },
            { key: "occurredAt", outputAttachment: { name: "Date", uuid: startDateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
          ],
        }),
        commentActionXml(`【${route.label}】自动开始「${workoutName}」体能训练并打开「健身」App`),
        ...makeStartWorkoutAndOpenFitness(workoutName),
      ],
    });
  });

  // Branch 3: end -> check active start event (default activityType or any active cardio/strength) or fallback recent workout window upload
  const endDateUuid = uuidFactory();
  const activeReqUuid = uuidFactory();
  const elapsedValUuid = uuidFactory();
  const pairedStartUuid = uuidFactory();
  const pairedMetrics = buildWorkoutWindowMetricsActions({
    uuidFactory,
    dateFilter: {
      kind: "betweenDates",
      startDateUuid: pairedStartUuid,
      startDateOutputName: "Adjusted Date",
      endDateUuid: endDateUuid,
      endDateOutputName: "Date",
    },
    distanceSpec,
  });
  const activeAnyPath = "/api/integrations/apple-health/events/active?activityType=any";
  const activeAnyEndpoint = `${prefix}${activeAnyPath}`;
  const activeAnyReqUuid = uuidFactory();
  const anyElapsedValUuid = uuidFactory();
  const anyTypeValUuid = uuidFactory();
  const anyEnvValUuid = uuidFactory();
  const anyDistModeValUuid = uuidFactory();
  const anyPairedStartUuid = uuidFactory();
  const anyDateFilter: DateFilterSpec = {
    kind: "betweenDates",
    startDateUuid: anyPairedStartUuid,
    startDateOutputName: "Adjusted Date",
    endDateUuid: endDateUuid,
    endDateOutputName: "Date",
  };
  const anyPairedMetrics = buildWorkoutWindowMetricsActions({
    uuidFactory,
    dateFilter: anyDateFilter,
    distanceSpec: null,
  });
  const anyDistanceBranches = (
    [
      {
        mode: "foot",
        typeLabel: "Walking + Running Distance",
        unit: "km",
        varName: "v_anyDistKm",
      },
      {
        mode: "cycling",
        typeLabel: "Cycling Distance",
        unit: "km",
        varName: "v_anyDistKm",
      },
      {
        mode: "swimming",
        typeLabel: "Swimming Distance",
        unit: "m",
        varName: "v_anyDistMeters",
      },
    ] as const
  ).flatMap((spec) => {
    const findDistUuid = uuidFactory();
    const distValUuid = uuidFactory();
    const distSumUuid = uuidFactory();
    return conditionalBlock({
      groupUuid: uuidFactory(),
      input: { kind: "output", outputUuid: anyDistModeValUuid, outputName: "Dictionary Value" },
      condition: 4,
      equalsText: spec.mode,
      bodyActions: [
        findHealthSampleActionXml({
          uuid: findDistUuid,
          typeLabel: spec.typeLabel,
          unit: spec.unit,
          dateFilter: anyDateFilter,
          sortOrder: "Latest First",
          limit: null,
        }),
        ...conditionalHasValueBlock({
          groupUuid: uuidFactory(),
          inputUuid: findDistUuid,
          bodyActions: [
            getHealthDetailActionXml({ uuid: distValUuid, propertyName: "Value", inputUuid: findDistUuid }),
            calculateStatisticsActionXml({ uuid: distSumUuid, operation: "Sum", inputUuid: distValUuid, inputName: "Value" }),
            setVariableActionXml({ variableName: spec.varName, inputUuid: distSumUuid, inputName: "Sum" }),
          ],
        }),
      ],
    });
  });
  const fallbackStartUuid = uuidFactory();
  const fallbackMetrics = buildWorkoutWindowMetricsActions({
    uuidFactory,
    dateFilter: {
      kind: "betweenDates",
      startDateUuid: fallbackStartUuid,
      startDateOutputName: "Adjusted Date",
      endDateUuid: endDateUuid,
      endDateOutputName: "Date",
    },
    distanceSpec,
  });

  const endBranch = conditionalBlock({
    groupUuid: uuidFactory(),
    input: { kind: "variable", variableName: "v_mode" },
    condition: 4,
    equalsText: "end",
    bodyActions: [
      delayActionXml(5),
      currentDateActionXml({ uuid: endDateUuid }),
      downloadJsonActionXml({
        uuid: activeReqUuid,
        endpoint: activeEndpoint,
        endpointPath: prelude ? activePath : undefined,
        token: cleanToken,
        originUuid: prelude?.originUuid,
        tokenUuid: prelude?.tokenUuid,
        method: "GET",
      }),
      getDictionaryValueActionXml({
        uuid: elapsedValUuid,
        key: "elapsedMinutes",
        inputUuid: activeReqUuid,
        inputName: "Contents of URL",
      }),
      ...conditionalBlock({
        groupUuid: uuidFactory(),
        input: { kind: "output", outputUuid: elapsedValUuid, outputName: "Dictionary Value" },
        condition: 100,
        bodyActions: [
          adjustDateSubtractMinutesActionXml({
            uuid: pairedStartUuid,
            minutesUuid: elapsedValUuid,
            minutesOutputName: "Dictionary Value",
            inputUuid: endDateUuid,
            inputName: "Date",
          }),
          ...pairedMetrics.actions,
          downloadJsonActionXml({
            uuid: uuidFactory(),
            endpoint: eventsEndpoint,
            endpointPath: prelude ? eventsPath : undefined,
            token: cleanToken,
            originUuid: prelude?.originUuid,
            tokenUuid: prelude?.tokenUuid,
            bodyItems: [
              { key: "schemaVersion", value: "1", itemType: 3 },
              { key: "event", value: "end" },
              { key: "activityType", value: activityType },
              { key: "environment", value: resolvedEnv },
              { key: "occurredAt", outputAttachment: { name: "Date", uuid: endDateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
              ...pairedMetrics.bodyItems,
            ],
          }),
        ],
        otherwiseActions: [
          downloadJsonActionXml({
            uuid: activeAnyReqUuid,
            endpoint: activeAnyEndpoint,
            endpointPath: prelude ? activeAnyPath : undefined,
            token: cleanToken,
            originUuid: prelude?.originUuid,
            tokenUuid: prelude?.tokenUuid,
            method: "GET",
          }),
          getDictionaryValueActionXml({
            uuid: anyElapsedValUuid,
            key: "elapsedMinutes",
            inputUuid: activeAnyReqUuid,
            inputName: "Contents of URL",
          }),
          getDictionaryValueActionXml({
            uuid: anyTypeValUuid,
            key: "activityType",
            inputUuid: activeAnyReqUuid,
            inputName: "Contents of URL",
          }),
          getDictionaryValueActionXml({
            uuid: anyEnvValUuid,
            key: "environment",
            inputUuid: activeAnyReqUuid,
            inputName: "Contents of URL",
          }),
          getDictionaryValueActionXml({
            uuid: anyDistModeValUuid,
            key: "distanceMode",
            inputUuid: activeAnyReqUuid,
            inputName: "Contents of URL",
          }),
          ...conditionalBlock({
            groupUuid: uuidFactory(),
            input: { kind: "output", outputUuid: anyElapsedValUuid, outputName: "Dictionary Value" },
            condition: 100,
            bodyActions: [
              adjustDateSubtractMinutesActionXml({
                uuid: anyPairedStartUuid,
                minutesUuid: anyElapsedValUuid,
                minutesOutputName: "Dictionary Value",
                inputUuid: endDateUuid,
                inputName: "Date",
              }),
              ...anyPairedMetrics.actions,
              ...anyDistanceBranches,
              downloadJsonActionXml({
                uuid: uuidFactory(),
                endpoint: eventsEndpoint,
                endpointPath: prelude ? eventsPath : undefined,
                token: cleanToken,
                originUuid: prelude?.originUuid,
                tokenUuid: prelude?.tokenUuid,
                bodyItems: [
                  { key: "schemaVersion", value: "1", itemType: 3 },
                  { key: "event", value: "end" },
                  { key: "activityType", outputAttachment: { name: "Dictionary Value", uuid: anyTypeValUuid } },
                  { key: "environment", outputAttachment: { name: "Dictionary Value", uuid: anyEnvValUuid } },
                  { key: "occurredAt", outputAttachment: { name: "Date", uuid: endDateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
                  ...anyPairedMetrics.bodyItems,
                  { key: "distanceKm", varAttachment: "v_anyDistKm" },
                  { key: "distanceMeters", varAttachment: "v_anyDistMeters" },
                ],
              }),
            ],
            otherwiseActions: [
              adjustDateSubtractMinutesActionXml({
                uuid: fallbackStartUuid,
                minutes: resolvedMinutes,
                inputUuid: endDateUuid,
                inputName: "Date",
              }),
              ...fallbackMetrics.actions,
              downloadJsonActionXml({
                uuid: uuidFactory(),
                endpoint: workoutsEndpoint,
                endpointPath: prelude ? workoutsPath : undefined,
                token: cleanToken,
                originUuid: prelude?.originUuid,
                tokenUuid: prelude?.tokenUuid,
                bodyItems: [
                  { key: "schemaVersion", value: "1", itemType: 3 },
                  { key: "source", value: "shortcut" },
                  { key: "captureMethod", value: "trigger" },
                  { key: "durationKind", value: "event_elapsed" },
                  { key: "activityType", value: activityType },
                  { key: "environment", value: resolvedEnv },
                  { key: "startedAt", outputAttachment: { name: "Adjusted Date", uuid: fallbackStartUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
                  { key: "endedAt", outputAttachment: { name: "Date", uuid: endDateUuid, aggrandizements: ISO_DATE_AGGRANDIZEMENTS } },
                  { key: "durationMinutes", value: String(resolvedMinutes), itemType: 3 },
                  ...fallbackMetrics.bodyItems,
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // Branch 4: daily -> collect daily health metrics & upload
  const dailyBranch = conditionalBlock({
    groupUuid: uuidFactory(),
    input: { kind: "variable", variableName: "v_mode" },
    condition: 4,
    equalsText: "daily",
    bodyActions: buildDailyHealthCollectionActions({
      uuidFactory,
      selectedMetrics,
      endpoint: dailyEndpoint,
      endpointPath: prelude ? dailyPath : undefined,
      cleanToken,
      originUuid: prelude?.originUuid,
      tokenUuid: prelude?.tokenUuid,
    }),
  });

  const actions: string[] = [
    commentActionXml(commentText),
    ...(prelude ? prelude.actions : []),
    ...resolveModeActions,
    ...strengthBranch,
    ...strengthRouteBranches,
    ...cardioBranch,
    ...cardioRouteBranches,
    ...endBranch,
    ...dailyBranch,
  ];

  const xml = wrapShortcutPlist(actions, prelude?.importQuestions ?? [], { hasShortcutInputVariables: true });
  return {
    filename,
    shortcutName: filename.replace(/\.shortcut$/, ""),
    endpoint: prelude ? `<导入时填写>/api/integrations/apple-health/{daily,events,workouts}` : `${base}/api/integrations/apple-health/daily`,
    locale: resolvedLocale,
    metricCount: selectedMetrics.length,
    groups: selectedGroups,
    windowMinutes: resolvedMinutes,
    xml,
    base64: encodeShortcutXmlToBase64(xml),
  };
}

export function buildMacSignCommand(): string {
  return "mkdir -p ~/Downloads/ironlog-signed && find ~/Downloads -maxdepth 1 -name '铁记-*.shortcut' -exec sh -c 'for f; do b=$(basename \"$f\"); plutil -convert binary1 \"$f\" -o \"/tmp/$b\" && shortcuts sign --mode anyone --input \"/tmp/$b\" --output \"$HOME/Downloads/ironlog-signed/$b\" && rm -f \"/tmp/$b\"; done' sh {} + && open ~/Downloads/ironlog-signed";
}
