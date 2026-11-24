import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { duration, fmt } from "../../lib/date";
import {
  APPLE_HEALTH_AUTO_METRICS,
  APPLE_HEALTH_DAILY_GROUPS,
  APPLE_HEALTH_DEFAULT_METRICS,
  APPLE_HEALTH_WATCH_METRICS,
  APPLE_SHORTCUT_ENVIRONMENTS,
  APPLE_SHORTCUT_RECENT_WINDOWS,
  APPLE_SHORTCUT_SPORTS,
  assessServerOrigin,
  buildIronlogDailyHealthShortcut,
  buildIronlogEventShortcut,
  buildIronlogRecentWorkoutShortcut,
  buildMacSignCommand,
  type ShortcutEnvironment,
} from "../../lib/shortcut-gen";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

const CLOCK_FMT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Hong_Kong",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const EXPORT_ENDPOINT = "/api/integrations/apple-health/health-data-export";
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const EXPORT_TOO_LARGE = "文件超过 16 MB，请缩短导出日期范围，或只导出训练摘要。";

export interface AppleDailyEntry {
  date: string;
  updatedAt?: string;
  sleepMinutes?: number | null;
  sleepInBedMinutes?: number | null;
  sleepEfficiencyPct?: number | null;
  sleepDeepMinutes?: number | null;
  sleepCoreMinutes?: number | null;
  sleepRemMinutes?: number | null;
  sleepAwakeMinutes?: number | null;
  sleepStartAt?: string | null;
  sleepEndAt?: string | null;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  leanBodyMassKg?: number | null;
  bmi?: number | null;
  waistCm?: number | null;
  steps?: number | null;
  distanceKm?: number | null;
  flightsClimbed?: number | null;
  activeEnergyKcal?: number | null;
  restingEnergyKcal?: number | null;
  totalEnergyKcal?: number | null;
  restingHeartRateBpm?: number | null;
  heartRateBpm?: number | null;
  hrvMs?: number | null;
  vo2Max?: number | null;
  bloodOxygenPct?: number | null;
  respiratoryRate?: number | null;
  waterMl?: number | null;
  dietaryEnergyKcal?: number | null;
  dietaryProteinG?: number | null;
  dietaryCarbsG?: number | null;
  dietaryFatG?: number | null;
}

export interface AppleWorkoutAgendaItem {
  id: string;
  title: string;
  date: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  durationKind?: string;
  energyKind?: string;
  activeEnergyKcal?: number | null;
  distanceMeters?: number | null;
  heartRate?: { avgBpm?: number | null; maxBpm?: number | null } | null;
  plan?: { name?: string } | null;
  manualWorkoutId?: string | null;
}

export function formatSleepMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} 分钟`;
}

export function AppleLine({
  item,
  onClick,
}: {
  item: AppleWorkoutAgendaItem;
  onClick: () => void;
}) {
  const metadata = [
    "Apple 健康",
    item.plan?.name ? "已完成 " + item.plan.name : null,
    item.manualWorkoutId ? "已关联铁记记录" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button className="record-line apple-line" type="button" onClick={onClick}>
      <span className="record-icon">
        <Icon name="heart" size={17} />
      </span>
      <span>
        <strong>{item.title}</strong>
        <small>{metadata}</small>
      </span>
      <span className="record-number">{duration(item.durationSeconds)}</span>
      <Icon name="chevron" size={15} />
    </button>
  );
}

export function AppleDailyStrip({
  daily,
  compact = false,
  onOpenDetails,
  onOpenAnalytics,
}: {
  daily: AppleDailyEntry | null | undefined;
  compact?: boolean;
  onOpenDetails: (daily: AppleDailyEntry) => void;
  onOpenAnalytics?: () => void;
}) {
  if (!daily) return null;
  const pills: Array<[string, string]> = [];
  if (daily.sleepMinutes != null) pills.push(["睡眠", formatSleepMinutes(daily.sleepMinutes)]);
  if (daily.weightKg != null) pills.push(["体重", `${fmt(daily.weightKg, 2)} kg`]);
  if (daily.bodyFatPct != null) pills.push(["体脂率", `${fmt(daily.bodyFatPct, 1)}%`]);
  if (daily.waistCm != null) pills.push(["腰围", `${fmt(daily.waistCm, 1)} cm`]);
  if (daily.steps != null) {
    pills.push([
      "步数",
      !compact && daily.distanceKm != null ? `${fmt(daily.steps, 0)} · ${fmt(daily.distanceKm, 2)} km` : `${fmt(daily.steps, 0)} 步`,
    ]);
  }
  if (daily.totalEnergyKcal != null) pills.push(["总消耗", `${fmt(daily.totalEnergyKcal, 0)} kcal`]);
  else if (daily.activeEnergyKcal != null) pills.push(["活动能量", `${fmt(daily.activeEnergyKcal, 0)} kcal`]);
  if (daily.restingHeartRateBpm != null) pills.push(["静息心率", `${fmt(daily.restingHeartRateBpm, 0)} bpm`]);
  if (daily.hrvMs != null) pills.push(["HRV", `${fmt(daily.hrvMs, 1)} ms`]);
  if (daily.bloodOxygenPct != null && !compact) pills.push(["血氧", `${fmt(daily.bloodOxygenPct, 0)}%`]);
  if (daily.respiratoryRate != null && !compact) pills.push(["呼吸", `${fmt(daily.respiratoryRate, 1)} /分`]);
  if (daily.vo2Max != null && !compact) pills.push(["VO2 Max", fmt(daily.vo2Max, 1)]);
  if (!pills.length) return null;

  const visible = pills.slice(0, 6);
  return (
    <div className={`apple-daily-strip${compact ? " is-compact" : ""}`}>
      <div className="apple-daily-head">
        <span>
          <Icon name="heart" size={15} /> <strong>Apple 健康日常指标</strong>
          <small>
            {daily.date}
            {pills.length > 6 ? ` · 已同步 ${pills.length} 项` : ""}
          </small>
        </span>
        <div className="apple-daily-actions">
          {!compact && onOpenAnalytics ? (
            <button type="button" className="quiet" onClick={onOpenAnalytics}>
              数据分析 <Icon name="chevron" size={14} />
            </button>
          ) : null}
          <button type="button" className="quiet" onClick={() => onOpenDetails(daily)}>
            完整指标 <Icon name="chevron" size={14} />
          </button>
        </div>
      </div>
      <div className="apple-daily-pills">
        {visible.map(([label, val]) => (
          <div key={label} className="apple-daily-pill">
            <span>{label}</span>
            <strong>{val}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricGrid({ rows }: { rows: Array<[string, string]> }) {
  const valid = rows.filter(([, value]) => value !== "—");
  if (!valid.length) return null;
  return (
    <div className="health-metrics apple-telemetry">
      {valid.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function AppleDailyDetailsModal({ daily }: { daily: AppleDailyEntry }) {
  const totalStageMin =
    (daily.sleepDeepMinutes ?? 0) +
    (daily.sleepCoreMinutes ?? 0) +
    (daily.sleepRemMinutes ?? 0) +
    (daily.sleepAwakeMinutes ?? 0);
  const sleepWindow =
    daily.sleepStartAt && daily.sleepEndAt
      ? `${CLOCK_FMT.format(new Date(daily.sleepStartAt))} – ${CLOCK_FMT.format(new Date(daily.sleepEndAt))}`
      : "";
  const updatedClock = daily.updatedAt ? CLOCK_FMT.format(new Date(daily.updatedAt)) : "";

  const hasBody =
    daily.weightKg != null ||
    daily.bodyFatPct != null ||
    daily.leanBodyMassKg != null ||
    daily.bmi != null ||
    daily.waistCm != null;
  const hasActivity =
    daily.steps != null ||
    daily.activeEnergyKcal != null ||
    daily.restingEnergyKcal != null ||
    daily.totalEnergyKcal != null ||
    daily.distanceKm != null ||
    daily.flightsClimbed != null;
  const hasVitals =
    daily.restingHeartRateBpm != null ||
    daily.heartRateBpm != null ||
    daily.hrvMs != null ||
    daily.vo2Max != null ||
    daily.bloodOxygenPct != null ||
    daily.respiratoryRate != null;
  const hasNutrition =
    daily.waterMl != null ||
    daily.dietaryEnergyKcal != null ||
    daily.dietaryProteinG != null ||
    daily.dietaryCarbsG != null ||
    daily.dietaryFatG != null;

  return (
    <div className="dialog-form apple-workout apple-daily-dossier">
      <div className="report-meta">
        <time dateTime={daily.date}>{daily.date}</time>
        <span>Apple 健康{updatedClock ? ` · ${updatedClock}` : ""}</span>
      </div>

      {daily.sleepMinutes != null || daily.sleepInBedMinutes != null ? (
        <section className="apple-dossier-section">
          <header>
            <strong>睡眠恢复</strong>
            {sleepWindow ? <small>{sleepWindow}</small> : null}
          </header>
          <MetricGrid
            rows={[
              ["实际睡眠", formatSleepMinutes(daily.sleepMinutes)],
              ["卧床时长", formatSleepMinutes(daily.sleepInBedMinutes)],
              ["睡眠效率", daily.sleepEfficiencyPct != null ? `${fmt(daily.sleepEfficiencyPct, 0)}%` : "—"],
              ["清醒时长", formatSleepMinutes(daily.sleepAwakeMinutes)],
            ]}
          />
          {totalStageMin > 0 ? (
            <>
              <div className="sleep-stage-bar" role="img" aria-label="睡眠分期比例">
                {daily.sleepDeepMinutes ? <i className="stage-deep" style={{ width: `${(daily.sleepDeepMinutes / totalStageMin) * 100}%` }} /> : null}
                {daily.sleepCoreMinutes ? <i className="stage-core" style={{ width: `${(daily.sleepCoreMinutes / totalStageMin) * 100}%` }} /> : null}
                {daily.sleepRemMinutes ? <i className="stage-rem" style={{ width: `${(daily.sleepRemMinutes / totalStageMin) * 100}%` }} /> : null}
                {daily.sleepAwakeMinutes ? <i className="stage-awake" style={{ width: `${(daily.sleepAwakeMinutes / totalStageMin) * 100}%` }} /> : null}
              </div>
              <div className="sleep-stage-legend">
                {daily.sleepDeepMinutes != null ? <span><i className="stage-deep" />深睡 {formatSleepMinutes(daily.sleepDeepMinutes)}</span> : null}
                {daily.sleepCoreMinutes != null ? <span><i className="stage-core" />核心 {formatSleepMinutes(daily.sleepCoreMinutes)}</span> : null}
                {daily.sleepRemMinutes != null ? <span><i className="stage-rem" />REM {formatSleepMinutes(daily.sleepRemMinutes)}</span> : null}
                {daily.sleepAwakeMinutes != null ? <span><i className="stage-awake" />清醒 {formatSleepMinutes(daily.sleepAwakeMinutes)}</span> : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {hasBody ? (
        <section className="apple-dossier-section">
          <header><strong>身体成分</strong></header>
          <MetricGrid
            rows={[
              ["体重", daily.weightKg != null ? `${fmt(daily.weightKg, 2)} kg` : "—"],
              ["体脂率", daily.bodyFatPct != null ? `${fmt(daily.bodyFatPct, 1)}%` : "—"],
              ["瘦体重", daily.leanBodyMassKg != null ? `${fmt(daily.leanBodyMassKg, 2)} kg` : "—"],
              ["BMI", daily.bmi != null ? fmt(daily.bmi, 1) : "—"],
              ["腰围", daily.waistCm != null ? `${fmt(daily.waistCm, 1)} cm` : "—"],
            ]}
          />
        </section>
      ) : null}

      {hasActivity ? (
        <section className="apple-dossier-section">
          <header><strong>日常活动与消耗</strong></header>
          <MetricGrid
            rows={[
              ["今日步数", daily.steps != null ? `${fmt(daily.steps, 0)} 步` : "—"],
              ["活动能量", daily.activeEnergyKcal != null ? `${fmt(daily.activeEnergyKcal, 0)} kcal` : "—"],
              ["静息能量", daily.restingEnergyKcal != null ? `${fmt(daily.restingEnergyKcal, 0)} kcal` : "—"],
              ["总能量消耗", daily.totalEnergyKcal != null ? `${fmt(daily.totalEnergyKcal, 0)} kcal` : "—"],
              ["步行/跑步距离", daily.distanceKm != null ? `${fmt(daily.distanceKm, 2)} km` : "—"],
              ["已爬楼层", daily.flightsClimbed != null ? `${fmt(daily.flightsClimbed, 0)} 层` : "—"],
            ]}
          />
        </section>
      ) : null}

      {hasVitals ? (
        <section className="apple-dossier-section">
          <header><strong>心肺与恢复体征</strong></header>
          <MetricGrid
            rows={[
              ["静息心率", daily.restingHeartRateBpm != null ? `${fmt(daily.restingHeartRateBpm, 0)} bpm` : "—"],
              ["最新心率", daily.heartRateBpm != null ? `${fmt(daily.heartRateBpm, 0)} bpm` : "—"],
              ["心率变异性 HRV", daily.hrvMs != null ? `${fmt(daily.hrvMs, 1)} ms` : "—"],
              ["VO2 Max", daily.vo2Max != null ? fmt(daily.vo2Max, 1) : "—"],
              ["血氧 SpO2", daily.bloodOxygenPct != null ? `${fmt(daily.bloodOxygenPct, 1)}%` : "—"],
              ["呼吸频率", daily.respiratoryRate != null ? `${fmt(daily.respiratoryRate, 1)} /分` : "—"],
            ]}
          />
        </section>
      ) : null}

      {hasNutrition ? (
        <section className="apple-dossier-section">
          <header><strong>饮水与膳食快照</strong></header>
          <MetricGrid
            rows={[
              ["饮水量", daily.waterMl != null ? `${fmt(daily.waterMl, 0)} mL` : "—"],
              ["膳食热量", daily.dietaryEnergyKcal != null ? `${fmt(daily.dietaryEnergyKcal, 0)} kcal` : "—"],
              ["膳食蛋白", daily.dietaryProteinG != null ? `${fmt(daily.dietaryProteinG, 1)} g` : "—"],
              ["膳食碳水", daily.dietaryCarbsG != null ? `${fmt(daily.dietaryCarbsG, 1)} g` : "—"],
              ["膳食脂肪", daily.dietaryFatG != null ? `${fmt(daily.dietaryFatG, 1)} g` : "—"],
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}

export function AppleWorkoutDetailsModal({
  item,
  back = false,
  onOpenWorkout,
}: {
  item: AppleWorkoutAgendaItem;
  back?: boolean;
  onOpenWorkout?: (workoutId: string) => void;
}) {
  const measures: Array<[string, string]> = [
    [item.durationKind === "event_elapsed" ? "开始至结束间隔" : "训练时长", duration(item.durationSeconds)],
    [
      item.energyKind === "window_estimate" ? "活动能量（估算）" : "活动能量",
      item.activeEnergyKcal == null ? "—" : `${fmt(item.activeEnergyKcal)} kcal`,
    ],
    ["训练距离", item.distanceMeters == null ? "—" : `${fmt(item.distanceMeters / 1000, 2)} km`],
    ["平均心率", item.heartRate?.avgBpm == null ? "—" : `${fmt(item.heartRate.avgBpm, 0)} bpm`],
  ];

  return (
    <div className="dialog-form apple-workout">
      <div className="report-meta">
        <time dateTime={item.startedAt}>
          {item.date} · {CLOCK_FMT.format(new Date(item.startedAt))}–{CLOCK_FMT.format(new Date(item.endedAt))}
        </time>
        <span>
          运动类型 <strong>{item.title}</strong>
        </span>
      </div>
      {item.plan?.name ? (
        <div className="apple-plan-result">
          <Icon name="check" size={17} />
          <div>
            <strong>{item.plan.name}</strong>
            <small>计划已完成</small>
          </div>
        </div>
      ) : null}
      <div className="health-metrics apple-telemetry">
        {measures.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {item.manualWorkoutId && onOpenWorkout ? (
        <footer>
          <button type="button" className="secondary-button" onClick={() => onOpenWorkout(item.manualWorkoutId!)}>
            {back ? "返回训练复盘" : "查看关联训练"}
          </button>
        </footer>
      ) : null}
    </div>
  );
}

export function HealthDataImportModal({ onImported }: { onImported?: () => void }) {
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultText, setResultText] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !file.size) {
      setError("请选择有内容的训练 JSON 文件。");
      return;
    }
    if (file.size > MAX_EXPORT_BYTES) {
      setError(EXPORT_TOO_LARGE);
      return;
    }
    setBusy(true);
    setError("");
    setResultText("");
    try {
      let body: unknown;
      try {
        body = JSON.parse(await file.text());
      } catch {
        throw new Error("无法读取 JSON，请在 Health Data Export 重新选择 JSON 格式导出。");
      }
      const res = await apiFetch<{ imported: number; updated: number; duplicate: number }>(`${EXPORT_ENDPOINT}/import`, {
        method: "POST",
        body,
      });
      setResultText(`新增 ${res.imported} 条 · 补全 ${res.updated} 条 · 跳过重复 ${res.duplicate} 条`);
      setFile(null);
      bumpDataEpoch();
      onImported?.();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setError(status === 413 ? EXPORT_TOO_LARGE : (err as Error)?.message || "导入失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="health-data-import" className="dialog-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="muted">在 Health Data Export 选择 Workouts（体能训练）和 JSON 格式，存到「文件」后在这里上传。</p>
      <label className="field">
        <span>训练 JSON 文件</span>
        <input
          type="file"
          accept=".json,application/json"
          required
          disabled={busy}
          onChange={(e) => {
            setError("");
            setResultText("");
            setFile(e.target.files?.[0] ?? null);
          }}
        />
      </label>
      <p className="muted">一次最多 16 MB、1,000 条。重复上传会合并同一条训练。</p>
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <p role="status" hidden={!resultText}>
        {resultText}
      </p>
      <footer className="dialog-foot">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "正在导入…" : "导入训练"}
        </button>
      </footer>
    </form>
  );
}

export function HealthDataWebhookModal({ onRefresh }: { onRefresh?: () => void }) {
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiFetch<{ webhookUrl?: string }>(`${EXPORT_ENDPOINT}/config`)
      .catch((err) => {
        if ((err as { status?: number })?.status === 404) return {} as { webhookUrl?: string };
        throw err;
      })
      .then((cfg) => {
        if (!active) return;
        const matchesOrigin =
          typeof location !== "undefined" &&
          location.protocol === "https:" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
        setWebhookUrl(cfg.webhookUrl || (matchesOrigin ? `${location.origin}${EXPORT_ENDPOINT}/webhook` : null));
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "读取 Webhook 配置失败");
      });
    return () => {
      active = false;
    };
  }, []);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || issuedToken) return;
    setBusy(true);
    setError("");
    try {
      const device = await apiFetch<{ token: string }>("/api/integrations/apple-health/tokens", {
        method: "POST",
        body: { label: "Health Data Export" },
      });
      setIssuedToken(device.token);
      bumpDataEpoch();
      onRefresh?.();
    } catch (err) {
      setError((err as Error)?.message || "生成设备令牌失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="health-data-webhook" className="dialog-form" onSubmit={(e) => void handleIssue(e)}>
      <p className="muted">
        {webhookUrl
          ? "在 Health Data Export 的自动导出中选择 Workouts 和 HTTPS Webhook，填入地址与设备令牌，再测试连接。"
          : "此网页使用本机地址。可以先生成设备令牌，等 iPhone 可访问的 HTTPS 上传地址配置好后再填写。"}
      </p>
      {webhookUrl ? (
        <label className="field">
          <span>Webhook 地址</span>
          <input name="webhookUrl" readOnly value={webhookUrl} />
        </label>
      ) : null}
      {issuedToken ? (
        <div>
          <label className="field">
            <span>Bearer Token（仅显示一次）</span>
            <input name="webhookToken" readOnly value={issuedToken} />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void copyText(issuedToken).then((ok) => notify(ok ? "设备令牌已复制" : "无法自动复制，请长按复制"))}
          >
            复制令牌
          </button>
        </div>
      ) : null}
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <footer className="dialog-foot">
        {webhookUrl ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => void copyText(webhookUrl).then((ok) => notify(ok ? "Webhook 地址已复制" : "无法自动复制，请长按复制"))}
          >
            复制地址
          </button>
        ) : null}
        {!issuedToken ? (
          <button type="submit" className="primary-button" disabled={busy}>
            生成设备令牌
          </button>
        ) : null}
      </footer>
    </form>
  );
}

interface CachedDeviceInfo {
  id: string;
  label: string;
  token: string;
  origin: string;
}

function triggerShortcutDownload(filename: string, xml: string): void {
  const url = URL.createObjectURL(new Blob([xml], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  Object.assign(link, { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeviceSetupModal({ onRefresh }: { onRefresh?: () => void }) {
  const userId = useAuthStore((s) => s.userId);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const cacheKey = `ironlog.appleDevice.${userId || "default"}`;

  const [step, setStep] = useState<"device" | "export">("device");
  const [cachedDevice, setCachedDevice] = useState<CachedDeviceInfo | null>(null);
  const [labelInput, setLabelInput] = useState("我的 iPhone");
  const [originInput, setOriginInput] = useState(() => (typeof location !== "undefined" ? location.origin : ""));
  const [activeToken, setActiveToken] = useState<{ token: string; label: string } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");

  // Step 2 export options
  const [dailyMetrics, setDailyMetrics] = useState<Set<string>>(() => new Set(APPLE_HEALTH_DEFAULT_METRICS));
  const [workoutMode, setWorkoutMode] = useState<"recent" | "pair">("recent");
  const [activityType, setActivityType] = useState(APPLE_SHORTCUT_SPORTS[0]!.activityType);
  const [environment, setEnvironment] = useState<ShortcutEnvironment>(APPLE_SHORTCUT_SPORTS[0]!.defaultEnvironment);
  const [recentWindowMinutes, setRecentWindowMinutes] = useState(45);

  useEffect(() => {
    let active = true;
    let candidate: CachedDeviceInfo | null = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      candidate = raw ? (JSON.parse(raw) as CachedDeviceInfo) : null;
    } catch {}
    if (!candidate?.id || !candidate?.token) return;
    void apiFetch<Array<{ id: string }>>("/api/integrations/apple-health/tokens")
      .then((devices) => {
        if (!active || !candidate) return;
        if (Array.isArray(devices) && devices.some((d) => d.id === candidate.id)) {
          setCachedDevice(candidate);
          if (candidate.origin) setOriginInput(candidate.origin);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [cacheKey]);

  const originCheck = assessServerOrigin(originInput);

  if (step === "device") {
    const handleIssue = async (e: React.FormEvent) => {
      e.preventDefault();
      const check = assessServerOrigin(originInput);
      if (!check.valid) {
        setError(check.warning);
        return;
      }
      setIssuing(true);
      setError("");
      try {
        const cleanLabel = labelInput.trim() || "我的 iPhone";
        const device = await apiFetch<{ id: string; token: string }>("/api/integrations/apple-health/tokens", {
          method: "POST",
          body: { label: cleanLabel },
        });
        const nextCached: CachedDeviceInfo = {
          id: device.id,
          label: cleanLabel,
          token: device.token,
          origin: check.normalized,
        };
        try {
          localStorage.setItem(cacheKey, JSON.stringify(nextCached));
        } catch {}
        setCachedDevice(nextCached);
        setActiveToken({ token: device.token, label: cleanLabel });
        setStep("export");
        bumpDataEpoch();
        onRefresh?.();
      } catch (err) {
        setError((err as Error)?.message || "生成设备令牌失败");
      } finally {
        setIssuing(false);
      }
    };

    return (
      <form id="device-form" className="dialog-form shortcut-modal" onSubmit={(e) => void handleIssue(e)}>
        {cachedDevice ? (
          <div className="shortcut-card" style={{ marginBottom: 4 }}>
            <div className="shortcut-card-head">
              <span className="shortcut-tag">BOUND</span>
              <strong>{cachedDevice.label || "已绑定设备"}</strong>
            </div>
            <small>此上传令牌已与账号持久绑定（服务重启也不变）。可直接沿用原令牌继续导出或增补快捷指令：</small>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const nextOrigin = originCheck.valid ? originCheck.normalized : cachedDevice.origin || location.origin;
                try {
                  localStorage.setItem(cacheKey, JSON.stringify({ ...cachedDevice, origin: nextOrigin }));
                } catch {}
                setOriginInput(nextOrigin);
                setActiveToken({ token: cachedDevice.token, label: cachedDevice.label });
                setStep("export");
              }}
            >
              <Icon name="download" size={16} /> 使用当前绑定令牌导出快捷指令
            </button>
          </div>
        ) : null}

        <p className="muted">
          {cachedDevice
            ? "如需再绑定一台新手机/设备，可另建设备令牌："
            : "签发设备令牌后（与账号持久绑定，重启不变），直接导出预填网址、授权头、日期格式与 JSON 的快捷指令，在 Mac 终端一行命令签名即可导入 iPhone。"}
        </p>

        <label className="field">
          <span>设备名称</span>
          <input name="label" maxLength={80} required value={labelInput} onChange={(e) => setLabelInput(e.target.value)} />
        </label>
        <label className="field">
          <span>铁记服务器地址</span>
          <input
            name="serverOrigin"
            type="url"
            placeholder="https://ironlog.example.com"
            required
            value={originInput}
            onChange={(e) => setOriginInput(e.target.value)}
          />
        </label>
        <p className="shortcut-warn" hidden={!originCheck.valid || !originCheck.warning}>
          {originCheck.valid ? originCheck.warning : ""}
        </p>
        <p className="form-error" role="alert" hidden={!error}>
          {error}
        </p>
        <footer className="dialog-foot">
          <button type="submit" className={cachedDevice ? "secondary-button" : "primary-button"} disabled={issuing}>
            {cachedDevice ? "额外新建设备令牌并导出" : "生成令牌并导出快捷指令"}
          </button>
        </footer>
      </form>
    );
  }

  const token = activeToken?.token ?? "";
  const sport = APPLE_SHORTCUT_SPORTS.find((s) => s.activityType === activityType);
  const sportLabel = sport?.label ?? activityType;
  const macCommand = buildMacSignCommand();

  const applyPreset = (preset: "default" | "watch" | "auto" | "all") => {
    if (preset === "all") {
      setDailyMetrics(new Set(APPLE_HEALTH_DAILY_GROUPS.flatMap((g) => g.metrics.map((m) => m.key))));
    } else if (preset === "watch") {
      setDailyMetrics(new Set(APPLE_HEALTH_WATCH_METRICS));
    } else if (preset === "auto") {
      setDailyMetrics(new Set(APPLE_HEALTH_AUTO_METRICS));
    } else {
      setDailyMetrics(new Set(APPLE_HEALTH_DEFAULT_METRICS));
    }
  };

  return (
    <div className="dialog-form shortcut-modal" id="shortcut-export">
      <p className="muted">令牌已自动写入快捷指令。每日健康同步读取今天和前两天，按采样日期保存；单场训练可单独上传。</p>
      <label className="field">
        <span>铁记服务器地址</span>
        <input
          type="url"
          placeholder="https://ironlog.example.com"
          required
          value={originInput}
          onChange={(e) => {
            setError("");
            setOriginInput(e.target.value);
          }}
        />
      </label>
      <p className="shortcut-warn" hidden={!originCheck.valid || !originCheck.warning}>
        {originCheck.valid ? originCheck.warning : ""}
      </p>

      <section className="shortcut-daily-box">
        <div className="shortcut-card-head">
          <span className="shortcut-tag">DAILY SYNC</span>
          <strong>铁记-每日全量健康同步.shortcut</strong>
        </div>
        <p className="muted">
          ⚠️ iOS 只要遇到某项在「健康」里查到 <b>0 条记录</b>或未授权，就会弹出<b>「未找到样本」</b>（如未手动录过的腰围/饮水/膳食营养、未支持血氧、或
          <b>凌晨 0 点刚过</b>尚未写入今日的静息能量）。推荐点下方<b>「自动体征全项 (14项)」</b>，并在 iPhone{" "}
          <b>健康 App → 头像 → 隐私 → App → 快捷指令</b> 打开对应开关。
        </p>
        <div className="shortcut-preset-row">
          <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("default")}>
            基础防弹窗 (4项)
          </button>
          <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("watch")}>
            Watch 日常 (8项)
          </button>
          <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("auto")}>
            自动体征全项 (14项)
          </button>
          <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("all")}>
            全选全部 (22项)
          </button>
        </div>
        <div className="shortcut-check-grid">
          {APPLE_HEALTH_DAILY_GROUPS.map((group) => (
            <div key={group.id} className="shortcut-metric-group">
              <div className="shortcut-metric-head">
                <b>{group.label}</b>
                <small>{group.description}</small>
              </div>
              <div className="shortcut-pill-grid">
                {group.metrics.map((metric) => (
                  <label key={metric.key} className="shortcut-pill">
                    <input
                      type="checkbox"
                      checked={dailyMetrics.has(metric.key)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setDailyMetrics((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(metric.key);
                          else next.delete(metric.key);
                          return next;
                        });
                      }}
                    />
                    <span>{metric.typeLabel}</span>
                    {metric.emptyHint ? <small className="shortcut-pill-hint">{metric.emptyHint}</small> : null}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setError("");
            try {
              const built = buildIronlogDailyHealthShortcut({
                serverOrigin: originInput,
                token,
                metrics: [...dailyMetrics],
              });
              triggerShortcutDownload(built.filename, built.xml);
              notify(`已导出 ${built.filename}（含 ${built.metricCount} 项健康指标）`);
            } catch (err) {
              setError((err as Error)?.message || "导出失败");
            }
          }}
        >
          <Icon name="download" size={16} /> 下载每日健康同步（已选 {dailyMetrics.size} 项）
        </button>
      </section>

      <details className="training-details" open>
        <summary>
          <span>单场训练自动同步（全运动类型 · 热量 / 心率 / 距离）</span>
          <Icon name="chevron" size={14} />
        </summary>
        <div className="details-body">
          <label className="field">
            <span>触发方式</span>
            <select value={workoutMode} onChange={(e) => setWorkoutMode(e.target.value as "recent" | "pair")}>
              <option value="recent">单条全自动直传（只需绑定结束时 · 免配开始）</option>
              <option value="pair">开始 + 结束双条配对（精确计算训练时长）</option>
            </select>
          </label>
          <div className="shortcut-config-grid">
            <label className="field">
              <span>运动类型</span>
              <select
                value={activityType}
                onChange={(e) => {
                  const val = e.target.value;
                  setActivityType(val);
                  const matched = APPLE_SHORTCUT_SPORTS.find((s) => s.activityType === val);
                  if (matched) setEnvironment(matched.defaultEnvironment);
                }}
              >
                {APPLE_SHORTCUT_SPORTS.map((s) => (
                  <option key={s.activityType} value={s.activityType}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>运动环境</span>
              <select value={environment} onChange={(e) => setEnvironment(e.target.value as ShortcutEnvironment)}>
                {(Object.entries(APPLE_SHORTCUT_ENVIRONMENTS) as Array<[ShortcutEnvironment, string]>).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {workoutMode === "recent" ? (
            <div>
              <label className="field">
                <span>自动回溯窗口时长</span>
                <select value={String(recentWindowMinutes)} onChange={(e) => setRecentWindowMinutes(Number(e.target.value))}>
                  {Object.entries(APPLE_SHORTCUT_RECENT_WINDOWS).map(([k, lbl]) => (
                    <option key={k} value={k}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </label>
              <div className="shortcut-card">
                <div className="shortcut-card-head">
                  <span className="shortcut-tag">AUTO POST</span>
                  <strong>铁记-结束直传-{sportLabel}.shortcut</strong>
                </div>
                <small>手表结束训练 5 秒后，自动拉取最近窗口内的活动能量、心率均值/峰值及对应距离并直接写入铁记。</small>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    setError("");
                    try {
                      const built = buildIronlogRecentWorkoutShortcut({
                        serverOrigin: originInput,
                        token,
                        activityType,
                        environment,
                        windowMinutes: recentWindowMinutes,
                      });
                      triggerShortcutDownload(built.filename, built.xml);
                      notify(`已导出 ${built.filename}`);
                    } catch (err) {
                      setError((err as Error)?.message || "导出失败");
                    }
                  }}
                >
                  <Icon name="download" size={16} /> 下载结束直传快捷指令 (.shortcut)
                </button>
              </div>
            </div>
          ) : (
            <div className="shortcut-pair">
              <div className="shortcut-card">
                <div className="shortcut-card-head">
                  <span className="shortcut-tag">START</span>
                  <strong>铁记-开始-{sportLabel}.shortcut</strong>
                </div>
                <small>开练时上报 event: "start"</small>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setError("");
                    try {
                      const built = buildIronlogEventShortcut({
                        event: "start",
                        serverOrigin: originInput,
                        token,
                        activityType,
                        environment,
                      });
                      triggerShortcutDownload(built.filename, built.xml);
                      notify(`已导出 ${built.filename}`);
                    } catch (err) {
                      setError((err as Error)?.message || "导出失败");
                    }
                  }}
                >
                  <Icon name="download" size={16} /> 下载开始
                </button>
              </div>
              <div className="shortcut-card">
                <div className="shortcut-card-head">
                  <span className="shortcut-tag">END</span>
                  <strong>铁记-结束-{sportLabel}.shortcut</strong>
                </div>
                <small>结束时自动计算时长、匹配今日计划，并抓热量/心率/距离</small>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setError("");
                    try {
                      const built = buildIronlogEventShortcut({
                        event: "end",
                        serverOrigin: originInput,
                        token,
                        activityType,
                        environment,
                      });
                      triggerShortcutDownload(built.filename, built.xml);
                      notify(`已导出 ${built.filename}`);
                    } catch (err) {
                      setError((err as Error)?.message || "导出失败");
                    }
                  }}
                >
                  <Icon name="download" size={16} /> 下载结束
                </button>
              </div>
            </div>
          )}
        </div>
      </details>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <div className="shortcut-mac-box">
        <div className="shortcut-mac-head">
          <strong>Mac 终端一行签名命令（同时签名以上全部 .shortcut）</strong>
          <button
            type="button"
            className="quiet"
            onClick={() => void copyText(macCommand).then((ok) => notify(ok ? "Mac 签名命令已复制" : "无法自动复制，请长按复制"))}
          >
            <Icon name="copy" size={15} /> 复制命令
          </button>
        </div>
        <pre className="shortcut-code">
          <code>{macCommand}</code>
        </pre>
        <ol className="shortcut-steps">
          <li>下载需要的 <code>.shortcut</code> 文件到 Mac「下载」文件夹；</li>
          <li>
            打开 Mac「<b>终端</b>」粘贴上方命令回车，将自动生成并打开 <code>ironlog-signed</code> 目录；
          </li>
          <li>
            把已签名的文件 <b>AirDrop 到 iPhone</b> 并添加（<b>每日全量健康同步须在 iPhone 运行</b>
            ，Mac 无健康数据库；若个别指标因 iOS 版本译名微调显示未选，在手机端轻点该蓝色标签重选一次即可）；
          </li>
          <li>
            绑定自动化：<b>每日全量同步</b>建议设为每天 <b>23:30 睡前亮屏时段 / 充电时</b>「立即运行」（防锁屏读健康受限）；
            <b>开始 / 结束训练</b>绑到 Apple Watch 体能训练对应触发器。
          </li>
        </ol>
      </div>

      <details className="training-details">
        <summary>
          <span>备用明文令牌（{activeToken?.label || "设备"}）</span>
          <Icon name="chevron" size={14} />
        </summary>
        <div className="details-body">
          <p className="muted">
            若需自行微调快捷指令请求头，Authorization 填 <code>Bearer &lt;令牌&gt;</code>。
          </p>
          <label className="field">
            <span>上传令牌</span>
            <input readOnly value={token} />
          </label>
          <div className="details-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void copyText(token).then((ok) => notify(ok ? "上传令牌已复制" : "请长按已选中的令牌复制"))}
            >
              <Icon name="copy" size={15} /> 复制令牌
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
