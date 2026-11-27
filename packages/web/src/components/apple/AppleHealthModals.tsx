import { useEffect, useRef, useState } from "react";
import type { AppleWorkoutAnnotation } from "@ironlog/shared";
import { apiFetch } from "../../lib/api";
import { triggerAppleHubAction } from "../../lib/apple-fitness";
import { copyText } from "../../lib/clipboard";
import { duration, fmt, today } from "../../lib/date";
import { FEELINGS } from "../../lib/domain";
import { formatClock, triggerHaptic } from "../../lib/haptics-audio";
import {
  APPLE_HEALTH_AUTO_METRICS,
  APPLE_HEALTH_DAILY_GROUPS,
  APPLE_HEALTH_DEFAULT_METRICS,
  APPLE_HEALTH_WATCH_METRICS,
  APPLE_SHORTCUT_ENVIRONMENTS,
  APPLE_SHORTCUT_SPORTS,
  DEFAULT_APPLE_HUB_SHORTCUT_NAME,
  assessServerOrigin,
  buildIronlogDailyHealthShortcut,
  buildIronlogEventShortcut,
  buildIronlogRecentWorkoutShortcut,
  buildIronlogUnifiedAppleHubShortcut,
  buildMacSignCommand,
  type ShortcutEnvironment,
} from "../../lib/shortcut-gen";
import { writeWorkoutPreference } from "../../lib/workout-helpers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

const CLOCK_FMT = new Intl.DateTimeFormat("zh-CN", {
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
  annotation?: AppleWorkoutAnnotation;
}

export interface AppleSyncStatus {
  activeSession: {
    activityType: string;
    title: string;
    environment: string;
    startedAt: string;
    elapsedMinutes: number;
    deviceLabel: string;
  } | null;
  lastWorkout: {
    id: string;
    title: string;
    activityType: string;
    environment: string;
    startedAt: string;
    endedAt: string;
    receivedAt: string;
    durationSeconds: number | null;
    activeEnergyKcal: number | null;
    avgBpm: number | null;
  } | null;
  lastDaily: {
    date: string;
    updatedAt: string;
    steps: number | null;
    sleepMinutes: number | null;
    activeEnergyKcal: number | null;
    restingHeartRateBpm: number | null;
  } | null;
}

function formatSyncTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const datePart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const clock = CLOCK_FMT.format(d);
  return datePart === today() ? `今日 ${clock}` : `${datePart.slice(5)} ${clock}`;
}

export function AppleSyncStatusCard() {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const notify = useUiStore((s) => s.notify);
  const [status, setStatus] = useState<AppleSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await apiFetch<AppleSyncStatus>("/api/integrations/apple-health/status");
      setStatus(res);
      if (manual) notify("已刷新 Apple 健康同步状态");
    } catch {
      if (manual) notify("刷新同步状态失败，请稍后重试");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiFetch<AppleSyncStatus>("/api/integrations/apple-health/status")
      .then((res) => {
        if (active) setStatus(res);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  if (loading && !status) {
    return (
      <div className="apple-sync-status">
        <span className="muted">正在检查 Apple Watch 同步状态…</span>
      </div>
    );
  }

  const activeSession = status?.activeSession ?? null;
  const lastWorkout = status?.lastWorkout ?? null;
  const lastDaily = status?.lastDaily ?? null;

  return (
    <div className={`apple-sync-status${activeSession ? " is-live" : ""}`}>
      <div className="apple-sync-status-head">
        <strong>
          {activeSession ? (
            <>
              <i className="live-led" aria-hidden="true" /> Apple Watch 训练进行中
            </>
          ) : (
            "服务端同步状态"
          )}
        </strong>
        <button
          type="button"
          className="quiet"
          disabled={refreshing}
          onClick={() => {
            triggerHaptic("light");
            void load(true);
          }}
        >
          <Icon name="refresh" size={13} /> {refreshing ? "检查中…" : "刷新"}
        </button>
      </div>

      {activeSession ? (
        <div className="apple-sync-status-live">
          <b>{activeSession.title}</b>
          <span>
            已开始约 {activeSession.elapsedMinutes} 分钟（{formatSyncTime(activeSession.startedAt)} 起）· 结束手表训练后将自动回传心率与消耗
          </span>
        </div>
      ) : null}

      <div className="apple-sync-status-rows">
        <div className="apple-sync-status-row">
          <span>最近运动</span>
          <strong>
            {lastWorkout
              ? [
                  `${lastWorkout.title}（${formatSyncTime(lastWorkout.receivedAt)}）`,
                  lastWorkout.durationSeconds ? duration(lastWorkout.durationSeconds) : null,
                  lastWorkout.avgBpm ? `均心率 ${fmt(lastWorkout.avgBpm, 0)}` : null,
                  lastWorkout.activeEnergyKcal ? `${fmt(lastWorkout.activeEnergyKcal, 0)} kcal` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "暂无手表运动记录"}
          </strong>
        </div>
        <div className="apple-sync-status-row">
          <span>最近日常</span>
          <strong>
            {lastDaily
              ? [
                  `${lastDaily.date}（${formatSyncTime(lastDaily.updatedAt)}）`,
                  lastDaily.steps != null ? `${fmt(lastDaily.steps, 0)} 步` : null,
                  lastDaily.sleepMinutes != null ? `睡眠 ${formatSleepMinutes(lastDaily.sleepMinutes)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "暂无每日健康同步"}
          </strong>
        </div>
      </div>
    </div>
  );
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
  const startDate = item.startedAt ? new Date(item.startedAt) : null;
  const annotation = item.annotation;
  const endDate = item.endedAt ? new Date(item.endedAt) : null;
  const hasTimeWindow = Boolean(
    startDate && !Number.isNaN(startDate.getTime()) && endDate && !Number.isNaN(endDate.getTime()),
  );
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
        <time dateTime={item.startedAt || item.date}>
          {item.date}
          {hasTimeWindow ? ` · ${CLOCK_FMT.format(startDate!)}–${CLOCK_FMT.format(endDate!)}` : ""}
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
      {annotation && (annotation.notes || annotation.feeling || annotation.distanceKm || annotation.lapSeconds.length > 0) ? (
        <section className="report-notes">
          <h3>训练记录</h3>
          {annotation.notes ? <p>{annotation.notes}</p> : null}
          {annotation.feeling ? <p>体感 · {FEELINGS[annotation.feeling]}</p> : null}
          {annotation.distanceKm ? <p>手记距离 · {annotation.distanceKm} km</p> : null}
          {annotation.lapSeconds.length ? (
            <ol aria-label="计时分段">
              {annotation.lapSeconds.map((seconds, index) => <li key={index}>{formatClock(seconds)}</li>)}
            </ol>
          ) : null}
        </section>
      ) : null}
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultText, setResultText] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
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
      if (fileInputRef.current) fileInputRef.current.value = "";
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
          ref={fileInputRef}
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

type WizardStep = 1 | 2 | 3 | 4 | 5;
type SignMethod = "web" | "base64" | "mac";

const WIZARD_STEPS: ReadonlyArray<{ step: WizardStep; shortLabel: string }> = [
  { step: 1, shortLabel: "绑定" },
  { step: 2, shortLabel: "导出" },
  { step: 3, shortLabel: "签名" },
  { step: 4, shortLabel: "凭据" },
  { step: 5, shortLabel: "验证" },
];

interface AppleAutomationPreset {
  param: string;
  label: string;
  trigger: string;
  badge?: string;
}

const REQUIRED_APPLE_AUTOMATIONS: ReadonlyArray<AppleAutomationPreset> = [
  { param: "end", label: "结束任何体能训练", trigger: "所有力量与有氧共用这 1 条", badge: "必配" },
  { param: "daily", label: "每日定时同步健康", trigger: "特定时间（如每天 23:30）", badge: "必配" },
];

const COMMON_START_AUTOMATIONS: ReadonlyArray<AppleAutomationPreset> = [
  { param: "strength", label: "传统力量训练", trigger: "手表开始时" },
  { param: "cardio:indoor_run", label: "室内跑步", trigger: "手表开始时" },
  { param: "cardio:outdoor_run", label: "户外跑步", trigger: "手表开始时" },
  { param: "cardio:stair_climbing", label: "踏步机 / 爬楼机", trigger: "手表开始时" },
];

const EXTRA_START_AUTOMATIONS: ReadonlyArray<AppleAutomationPreset> = [
  { param: "strength:functional", label: "功能性力量训练", trigger: "手表开始时" },
  { param: "strength:core", label: "核心训练", trigger: "手表开始时" },
  { param: "cardio:indoor_cycle", label: "室内单车", trigger: "手表开始时" },
  { param: "cardio:outdoor_cycle", label: "户外单车 / 骑行", trigger: "手表开始时" },
  { param: "cardio:elliptical", label: "椭圆机", trigger: "手表开始时" },
  { param: "cardio:rowing", label: "划船机", trigger: "手表开始时" },
  { param: "cardio:swimming", label: "泳池游泳", trigger: "手表开始时" },
  { param: "cardio:hiit", label: "高强度间歇 (HIIT)", trigger: "手表开始时" },
  { param: "cardio:jump_rope", label: "跳绳", trigger: "手表开始时" },
  { param: "cardio:outdoor_walk", label: "户外步行", trigger: "手表开始时" },
  { param: "cardio:hiking", label: "徒步", trigger: "手表开始时" },
  { param: "cardio:mixed_cardio", label: "混合有氧", trigger: "手表开始时" },
];

export function AppleAutomationCopyPanel({
  shortcutName = DEFAULT_APPLE_HUB_SHORTCUT_NAME,
}: {
  shortcutName?: string;
}) {
  const notify = useUiStore((s) => s.notify);
  const [copiedKey, setCopiedKey] = useState("");
  const timerRef = useRef<number | null>(null);
  const resolvedName = shortcutName.trim() || DEFAULT_APPLE_HUB_SHORTCUT_NAME;

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = (value: string, noticeLabel?: string) => {
    triggerHaptic("light");
    void copyText(value).then((ok) => {
      if (ok) {
        setCopiedKey(value);
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopiedKey(""), 1800);
      }
      notify(ok ? `已复制：${noticeLabel ?? value}` : `无法自动复制，请手动复制：${value}`);
    });
  };

  const renderChip = (item: AppleAutomationPreset) => {
    const isCopied = copiedKey === item.param;
    return (
      <button
        key={item.param}
        type="button"
        className={`apple-auto-chip${isCopied ? " is-copied" : ""}`}
        onClick={() => handleCopy(item.param, `${item.label}（${item.param}）`)}
      >
        <div className="apple-auto-chip-top">
          <strong>{item.label}</strong>
          <span className="apple-auto-chip-badge">{isCopied ? "✓ 已复制" : item.badge ?? "复制"}</span>
        </div>
        <code className="apple-auto-chip-param">{item.param}</code>
        <small>{item.trigger}</small>
      </button>
    );
  };

  return (
    <div className="apple-auto-panel">
      <p className="apple-auto-hint">
        在 iPhone <b>快捷指令 → 自动化 → ＋ → 立即运行</b> → 放 2 个动作：① <b>「文本」</b>粘贴下方参数 → ② <b>「运行快捷指令」</b>选目标指令即可。
      </p>

      <div className="apple-auto-shortcut-bar">
        <div className="apple-auto-shortcut-meta">
          <span>目标快捷指令</span>
          <code>{resolvedName}</code>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => handleCopy(resolvedName, "快捷指令名称")}
        >
          <Icon name="copy" size={14} /> {copiedKey === resolvedName ? "✓ 已复制" : "复制名称"}
        </button>
      </div>

      <div className="apple-auto-group">
        <span className="apple-auto-group-label">必配 2 条（全局通用）</span>
        <div className="apple-auto-grid">{REQUIRED_APPLE_AUTOMATIONS.map(renderChip)}</div>
      </div>

      <div className="apple-auto-group">
        <span className="apple-auto-group-label">常用运动开始（按常练项目挑 2～4 条配即可）</span>
        <div className="apple-auto-grid">{COMMON_START_AUTOMATIONS.map(renderChip)}</div>
      </div>

      <details className="settings-accordion">
        <summary>
          <span>更多运动开始参数</span>
          <span className="settings-accordion-meta">
            <span>{EXTRA_START_AUTOMATIONS.length} 项</span>
            <Icon name="chevron" size={14} />
          </span>
        </summary>
        <div className="settings-accordion-body">
          <div className="apple-auto-grid">{EXTRA_START_AUTOMATIONS.map(renderChip)}</div>
        </div>
      </details>
    </div>
  );
}

export function DeviceSetupModal({ onRefresh }: { onRefresh?: () => void }) {
  const userId = useAuthStore((s) => s.userId);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const closeTopModal = useUiStore((s) => s.closeTopModal);
  const notify = useUiStore((s) => s.notify);

  const cacheKey = `ironlog.appleDevice.${userId || "default"}`;

  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [signMethod, setSignMethod] = useState<SignMethod>("web");
  const [cachedDevice, setCachedDevice] = useState<CachedDeviceInfo | null>(null);
  const [labelInput, setLabelInput] = useState("我的 iPhone");
  const [originInput, setOriginInput] = useState(() => (typeof location !== "undefined" ? location.origin : ""));
  const [activeToken, setActiveToken] = useState<{ token: string; label: string } | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");

  // Export & wizard tracking state
  const [universalMode, setUniversalMode] = useState(true);
  const [dailyMetrics, setDailyMetrics] = useState<Set<string>>(() => new Set(APPLE_HEALTH_DEFAULT_METRICS));
  const [workoutMode, setWorkoutMode] = useState<"recent" | "pair">("recent");
  const [activityType, setActivityType] = useState(APPLE_SHORTCUT_SPORTS[0]!.activityType);
  const [environment, setEnvironment] = useState<ShortcutEnvironment>(APPLE_SHORTCUT_SPORTS[0]!.defaultEnvironment);
  const recentWindowMinutes = 45;
  const [exportedFile, setExportedFile] = useState("");
  const [copiedOrigin, setCopiedOrigin] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [checkingSync, setCheckingSync] = useState(false);
  const [syncVerifyMsg, setSyncVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
  const token = activeToken?.token ?? "";
  const sport = APPLE_SHORTCUT_SPORTS.find((s) => s.activityType === activityType);
  const sportLabel = sport?.label ?? activityType;
  const macCommand = buildMacSignCommand();
  const cleanOrigin = originCheck.valid ? originCheck.normalized : originInput.trim().replace(/\/+$/, "");

  const goToStep = (target: WizardStep) => {
    if (target > 1 && !activeToken) return;
    setError("");
    setWizardStep(target);
  };

  const renderStepper = () => (
    <nav className="shortcut-wizard-stepper" aria-label="快捷指令设置步骤">
      {WIZARD_STEPS.map(({ step, shortLabel }) => {
        const disabled = step > 1 && !activeToken;
        const isCurrent = wizardStep === step;
        const isDone =
          !isCurrent &&
          (step < wizardStep ||
            (step === 1 && Boolean(activeToken)) ||
            (step === 2 && Boolean(exportedFile)) ||
            (step === 4 && (!universalMode || (copiedOrigin && copiedToken))));
        return (
          <button
            key={step}
            type="button"
            className={`shortcut-step-pill${isCurrent ? " is-active" : ""}${isDone ? " is-done" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
            disabled={disabled}
            onClick={() => goToStep(step)}
          >
            <span>{isDone ? "✓" : step}</span>
            <b>{shortLabel}</b>
          </button>
        );
      })}
    </nav>
  );

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (issuing) return;
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
      setCopiedOrigin(false);
      setCopiedToken(false);
      setSyncVerifyMsg(null);
      setWizardStep(2);
      bumpDataEpoch();
      onRefresh?.();
    } catch (err) {
      setError((err as Error)?.message || "生成设备令牌失败");
    } finally {
      setIssuing(false);
    }
  };

  const handleReuseCached = () => {
    if (!cachedDevice) return;
    const nextOrigin = originCheck.valid ? originCheck.normalized : cachedDevice.origin || location.origin;
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ ...cachedDevice, origin: nextOrigin }));
    } catch {}
    setOriginInput(nextOrigin);
    setActiveToken({ token: cachedDevice.token, label: cachedDevice.label });
    setError("");
    setWizardStep(2);
  };

  const handleDownloadShortcut = <T extends { filename: string; xml: string }>(
    buildFn: () => T,
    extraNotice?: (built: T) => string,
    onBuilt?: (built: T) => void,
  ) => {
    setError("");
    try {
      const built = buildFn();
      onBuilt?.(built);
      triggerShortcutDownload(built.filename, built.xml);
      setExportedFile(built.filename);
      notify(extraNotice ? extraNotice(built) : `已导出 ${built.filename}`);
    } catch (err) {
      setError((err as Error)?.message || "导出失败");
    }
  };

  const handleCopyBase64 = <T extends { filename: string; base64: string }>(
    buildFn: () => T,
    onBuilt?: (built: T) => void,
  ) => {
    setError("");
    try {
      const built = buildFn();
      onBuilt?.(built);
      setExportedFile(`${built.filename}（Base64）`);
      setSignMethod("base64");
      void copyText(built.base64).then((ok) =>
        notify(
          ok
            ? `已复制 ${built.filename} 的 Base64，点「下一步」去手机端签名`
            : "无法自动复制，请改用「下载全能 .shortcut」",
        ),
      );
    } catch (err) {
      setError((err as Error)?.message || "生成 Base64 失败");
    }
  };

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

  const buildCurrentHub = () =>
    buildIronlogUnifiedAppleHubShortcut({
      serverOrigin: originInput,
      token,
      activityType,
      environment,
      windowMinutes: recentWindowMinutes,
      metrics: [...dailyMetrics],
      useImportQuestions: universalMode,
    });

  const handleVerifySync = async () => {
    if (checkingSync) return;
    setCheckingSync(true);
    setSyncVerifyMsg(null);
    const todayStr = today();
    try {
      const res = await apiFetch<{ entries?: AppleDailyEntry[] }>(
        `/api/integrations/apple-health/daily?from=${encodeURIComponent(todayStr)}&through=${encodeURIComponent(todayStr)}`,
      );
      if ((res.entries?.length ?? 0) > 0) {
        setSyncVerifyMsg({
          ok: true,
          text: `✓ 已收到今日（${todayStr}）Apple 健康数据，同步链路已完全打通！`,
        });
        bumpDataEpoch();
        onRefresh?.();
      } else {
        setSyncVerifyMsg({
          ok: false,
          text: "暂未检测到今日健康记录：请先在下方点「拉起测试」并在 iPhone 选择「同步今日健康数据」完成上传，几秒后再点此检查。",
        });
      }
    } catch (err) {
      setSyncVerifyMsg({ ok: false, text: (err as Error)?.message || "检查失败，请稍后重试" });
    } finally {
      setCheckingSync(false);
    }
  };

  if (wizardStep === 1) {
    return (
      <form id="device-form" className="dialog-form shortcut-modal" onSubmit={(e) => void handleIssue(e)}>
        {renderStepper()}

        <div className="shortcut-wizard-head">
          <span>第 1 步 / 共 5 步</span>
          <h3>绑定 iPhone 并确认服务器地址</h3>
          <p>只需绑定一次，设备上传令牌会持久保存在账号里，服务重启也不会失效。</p>
        </div>

        <div className="shortcut-step-body">
          {cachedDevice ? (
            <div className="shortcut-card">
              <div className="shortcut-card-head">
                <span className="shortcut-tag">BOUND</span>
                <strong>{cachedDevice.label || "已绑定设备"}</strong>
              </div>
              <small>检测到当前账号已绑定设备，推荐直接沿用原令牌并进入第 2 步下载：</small>
              <button type="button" className="primary-button" onClick={handleReuseCached}>
                使用当前令牌，进入第 2 步 →
              </button>
            </div>
          ) : null}

          <label className="field">
            <span>{cachedDevice ? "新设备名称（如需再绑一台）" : "设备名称"}</span>
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
        </div>

        <footer className="shortcut-wizard-foot">
          {activeToken ? (
            <button type="button" className="quiet" onClick={() => goToStep(2)}>
              跳过，回到第 2 步 →
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>完成后进入导出步骤</span>
          )}
          <button type="submit" className={cachedDevice ? "secondary-button" : "primary-button"} disabled={issuing}>
            {issuing ? "生成中…" : cachedDevice ? "新建设备令牌并下一步 →" : "生成令牌并进入第 2 步 →"}
          </button>
        </footer>
      </form>
    );
  }

  return (
    <div className="dialog-form shortcut-modal" id="shortcut-export">
      {renderStepper()}

      {wizardStep === 2 ? (
        <div className="shortcut-step-body">
          <div className="shortcut-wizard-head">
            <span>第 2 步 / 共 5 步</span>
            <h3>下载「Apple 健康静默上报」快捷指令</h3>
            <p>1 个纯后台文件：手表原生开练与结束自动静默回传心率、消耗、距离与每日健康（步数 3 天按小时、睡眠 2 天）。</p>
          </div>

          <div className="field">
            <span>安全导出模式</span>
            <div className="segments">
              <button
                type="button"
                aria-pressed={universalMode}
                onClick={() => {
                  setUniversalMode(true);
                  if (signMethod === "mac") setSignMethod("web");
                }}
              >
                通用模板（推荐）
              </button>
              <button
                type="button"
                aria-pressed={!universalMode}
                onClick={() => {
                  setUniversalMode(false);
                  setSignMethod("mac");
                }}
              >
                预填直出（仅 Mac）
              </button>
            </div>
          </div>

          <p className="muted">
            {universalMode
              ? "通用模板不含网址和令牌，可放心交给第三方网页签名；第 4 步导入时再粘贴即可。"
              : "预填直出已将令牌写入文件，请勿上传给第三方网页，仅限自己在 Mac 终端签名。"}
          </p>

          <section className="shortcut-daily-box">
            <div className="shortcut-card-head">
              <span className="shortcut-tag">ALL-IN-ONE HUB</span>
              <strong>{universalMode ? `${DEFAULT_APPLE_HUB_SHORTCUT_NAME}.shortcut` : "铁记-Apple健康全能联动.shortcut"}</strong>
            </div>

            <div className="shortcut-preset-row">
              <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("default")}>
                基础 4项
              </button>
              <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("watch")}>
                Watch 8项
              </button>
              <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("auto")}>
                自动体征 13项
              </button>
              <button type="button" className="secondary-button shortcut-preset-btn" onClick={() => applyPreset("all")}>
                全选 21项
              </button>
            </div>

            <details className="settings-accordion">
              <summary>
                <span>自定义运动类型与健康指标</span>
                <span className="settings-accordion-meta">
                  <span>{sportLabel} · {dailyMetrics.size} 项</span>
                  <Icon name="chevron" size={14} />
                </span>
              </summary>
              <div className="settings-accordion-body">
                <div className="shortcut-config-grid">
                  <label className="field">
                    <span>默认力量 / 运动类型</span>
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
                <small className="muted">
                  ⚠️ 若某项在 iPhone「健康」中为 0 条记录或未授权会提示「未找到样本」，建议先用「自动体征 13项」。
                </small>
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
              </div>
            </details>

            <div className="shortcut-action-row">
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  handleDownloadShortcut(
                    buildCurrentHub,
                    (built) => `已下载 ${built.filename}，请点右下角「下一步：去签名」`,
                    (built) => writeWorkoutPreference("appleHubShortcutName", built.shortcutName),
                  )
                }
              >
                <Icon name="download" size={16} /> 下载全能 .shortcut
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  handleCopyBase64(buildCurrentHub, (built) =>
                    writeWorkoutPreference("appleHubShortcutName", built.shortcutName),
                  )
                }
              >
                <Icon name="copy" size={16} /> 复制 Base64
              </button>
            </div>

            {exportedFile ? (
              <p className="shortcut-verify-status is-ok" role="status">
                ✓ 已导出：{exportedFile}
              </p>
            ) : null}
          </section>

          <details className="training-details">
            <summary>
              <span>高级：单独导出单项快捷指令（用于独立 Apple Watch 自动化）</span>
              <Icon name="chevron" size={14} />
            </summary>
            <div className="details-body">
              <div className="shortcut-card">
                <div className="shortcut-card-head">
                  <span className="shortcut-tag">DAILY SYNC</span>
                  <strong>{universalMode ? "铁记-通用-每日全量健康同步.shortcut" : "铁记-每日全量健康同步.shortcut"}</strong>
                </div>
                <small>使用上方当前勾选的 {dailyMetrics.size} 项健康指标单独导出。</small>
                <div className="shortcut-action-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      handleCopyBase64(() =>
                        buildIronlogDailyHealthShortcut({
                          serverOrigin: originInput,
                          token,
                          metrics: [...dailyMetrics],
                          useImportQuestions: universalMode,
                        }),
                      )
                    }
                  >
                    <Icon name="copy" size={15} /> 复制每日 Base64
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      handleDownloadShortcut(
                        () =>
                          buildIronlogDailyHealthShortcut({
                            serverOrigin: originInput,
                            token,
                            metrics: [...dailyMetrics],
                            useImportQuestions: universalMode,
                          }),
                        (built) => `已导出 ${built.filename}（含 ${built.metricCount} 项健康指标）`,
                      )
                    }
                  >
                    <Icon name="download" size={15} /> 下载每日 .shortcut
                  </button>
                </div>
              </div>

              <label className="field">
                <span>单场训练触发方式</span>
                <select value={workoutMode} onChange={(e) => setWorkoutMode(e.target.value as "recent" | "pair")}>
                  <option value="recent">单条全自动直传（只需绑定结束时 · 免配开始）</option>
                  <option value="pair">开始 + 结束双条配对（精确计算训练时长）</option>
                </select>
              </label>

              {workoutMode === "recent" ? (
                <div className="shortcut-card">
                  <div className="shortcut-card-head">
                    <span className="shortcut-tag">AUTO POST</span>
                    <strong>
                      {universalMode ? `铁记-通用-结束直传-${sportLabel}.shortcut` : `铁记-结束直传-${sportLabel}.shortcut`}
                    </strong>
                  </div>
                  <small>使用上方选定的 {sportLabel}（{recentWindowMinutes} 分钟窗口），手表结束训练 5 秒后直传。</small>
                  <div className="shortcut-action-row">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        handleCopyBase64(() =>
                          buildIronlogRecentWorkoutShortcut({
                            serverOrigin: originInput,
                            token,
                            activityType,
                            environment,
                            windowMinutes: recentWindowMinutes,
                            useImportQuestions: universalMode,
                          }),
                        )
                      }
                    >
                      <Icon name="copy" size={15} /> 复制 Base64
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        handleDownloadShortcut(() =>
                          buildIronlogRecentWorkoutShortcut({
                            serverOrigin: originInput,
                            token,
                            activityType,
                            environment,
                            windowMinutes: recentWindowMinutes,
                            useImportQuestions: universalMode,
                          }),
                        )
                      }
                    >
                      <Icon name="download" size={15} /> 下载 .shortcut
                    </button>
                  </div>
                </div>
              ) : (
                <div className="shortcut-pair">
                  <div className="shortcut-card">
                    <div className="shortcut-card-head">
                      <span className="shortcut-tag">START</span>
                      <strong>{universalMode ? `铁记-通用-开始-${sportLabel}.shortcut` : `铁记-开始-${sportLabel}.shortcut`}</strong>
                    </div>
                    <small>开练时上报 event: "start"</small>
                    <div className="shortcut-action-row">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          handleCopyBase64(() =>
                            buildIronlogEventShortcut({
                              event: "start",
                              serverOrigin: originInput,
                              token,
                              activityType,
                              environment,
                              useImportQuestions: universalMode,
                            }),
                          )
                        }
                      >
                        <Icon name="copy" size={15} /> 复制 Base64
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          handleDownloadShortcut(() =>
                            buildIronlogEventShortcut({
                              event: "start",
                              serverOrigin: originInput,
                              token,
                              activityType,
                              environment,
                              useImportQuestions: universalMode,
                            }),
                          )
                        }
                      >
                        <Icon name="download" size={15} /> 下载
                      </button>
                    </div>
                  </div>
                  <div className="shortcut-card">
                    <div className="shortcut-card-head">
                      <span className="shortcut-tag">END</span>
                      <strong>{universalMode ? `铁记-通用-结束-${sportLabel}.shortcut` : `铁记-结束-${sportLabel}.shortcut`}</strong>
                    </div>
                    <small>结束时自动计算时长、匹配今日计划，并抓热量/心率/距离</small>
                    <div className="shortcut-action-row">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          handleCopyBase64(() =>
                            buildIronlogEventShortcut({
                              event: "end",
                              serverOrigin: originInput,
                              token,
                              activityType,
                              environment,
                              useImportQuestions: universalMode,
                            }),
                          )
                        }
                      >
                        <Icon name="copy" size={15} /> 复制 Base64
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          handleDownloadShortcut(() =>
                            buildIronlogEventShortcut({
                              event: "end",
                              serverOrigin: originInput,
                              token,
                              activityType,
                              environment,
                              useImportQuestions: universalMode,
                            }),
                          )
                        }
                      >
                        <Icon name="download" size={15} /> 下载
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </details>

          <p className="form-error" role="alert" hidden={!error}>
            {error}
          </p>

          <footer className="shortcut-wizard-foot">
            <button type="button" className="secondary-button" onClick={() => goToStep(1)}>
              ← 上一步
            </button>
            <button
              type="button"
              className={exportedFile ? "primary-button" : "secondary-button"}
              onClick={() => goToStep(3)}
            >
              下一步：去签名安装 →
            </button>
          </footer>
        </div>
      ) : null}

      {wizardStep === 3 ? (
        <div className="shortcut-step-body">
          <div className="shortcut-wizard-head">
            <span>第 3 步 / 共 5 步</span>
            <h3>签名并安装到 iPhone</h3>
            <p>iOS 15+ 规定未签名文件无法直接添加，按下方最顺手的方式签名一次即可。</p>
          </div>

          <div className="segments shortcut-sign-segments" role="group" aria-label="选择签名方式">
            <button type="button" aria-pressed={signMethod === "web"} onClick={() => setSignMethod("web")}>
              网页在线签名
            </button>
            <button type="button" aria-pressed={signMethod === "base64"} onClick={() => setSignMethod("base64")}>
              手机 Base64
            </button>
            <button type="button" aria-pressed={signMethod === "mac"} onClick={() => setSignMethod("mac")}>
              Mac 终端
            </button>
          </div>

          {!universalMode && signMethod !== "mac" ? (
            <div className="shortcut-warn">
              <b>安全拦截</b>：当前第 2 步导出的是包含明文令牌的「预填直出」版，请勿上传给第三方站点签名！
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setUniversalMode(true);
                    handleDownloadShortcut(
                      () =>
                        buildIronlogUnifiedAppleHubShortcut({
                          serverOrigin: originInput,
                          token,
                          activityType,
                          environment,
                          windowMinutes: recentWindowMinutes,
                          metrics: [...dailyMetrics],
                          useImportQuestions: true,
                        }),
                      (built) => `已切换通用安全模板并下载 ${built.filename}`,
                      (built) => writeWorkoutPreference("appleHubShortcutName", built.shortcutName),
                    );
                  }}
                >
                  切回「通用安全模板」并重新下载
                </button>
              </div>
            </div>
          ) : signMethod === "web" ? (
            <div className="shortcut-mac-box">
              <div className="shortcut-mac-head">
                <strong>免电脑 · 网页在线签名（推荐）</strong>
              </div>
              <ol className="shortcut-steps">
                <li>点击下方按钮用 Safari 打开在线签名页（无需注册登录）；</li>
                <li>上传第 2 步保存的 <b>{exportedFile || `${DEFAULT_APPLE_HUB_SHORTCUT_NAME}.shortcut`}</b> 并等待签名；</li>
                <li>签名完成后点击下载，在 Safari 弹出窗口点 <b>「添加快捷指令」</b>，随后点本页下一步填入地址和令牌。</li>
              </ol>
              <a
                className="primary-button shortcut-ext-link"
                href="https://sign.shortcuty.app"
                target="_blank"
                rel="noopener noreferrer"
              >
                打开 sign.shortcuty.app 在线签名 ↗
              </a>
            </div>
          ) : signMethod === "base64" ? (
            <div className="shortcut-mac-box">
              <div className="shortcut-mac-head">
                <strong>手机端 Base64 / 快捷指令工具签名</strong>
              </div>
              <ol className="shortcut-steps">
                <li>
                  打开{" "}
                  <a href="https://routinehub.co" target="_blank" rel="noopener noreferrer">
                    routinehub.co
                  </a>{" "}
                  搜索安装 <b>Sign Shortcut File</b> 或 <b>HubSign</b>；
                </li>
                <li>点击下方重新复制 Base64（如已复制可跳过），通过「Base64 转文件」解码并用工具签名；</li>
                <li>签名后点 <b>「添加快捷指令」</b>，然后点本页下一步填入地址和令牌。</li>
              </ol>
              <div className="shortcut-action-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    handleCopyBase64(buildCurrentHub, (built) =>
                      writeWorkoutPreference("appleHubShortcutName", built.shortcutName),
                    )
                  }
                >
                  <Icon name="copy" size={15} /> 复制 Base64
                </button>
                <a
                  className="secondary-button shortcut-ext-link"
                  href="https://routinehub.co"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开 RoutineHub ↗
                </a>
              </div>
            </div>
          ) : (
            <div className="shortcut-mac-box">
              <div className="shortcut-mac-head">
                <strong>Mac 终端一行命令本地签名</strong>
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
                <li>确认 <code>.shortcut</code> 文件已保存到 Mac「下载」文件夹；</li>
                <li>打开 Mac「<b>终端</b>」，粘贴上方命令并回车，会自动生成 <code>ironlog-signed</code> 目录；</li>
                <li>将签完名的文件通过 <b>隔空投送 (AirDrop)</b> 发给 iPhone 并点 <b>「添加快捷指令」</b>。</li>
              </ol>
            </div>
          )}

          <footer className="shortcut-wizard-foot">
            <button type="button" className="secondary-button" onClick={() => goToStep(2)}>
              ← 上一步
            </button>
            <button type="button" className="primary-button" onClick={() => goToStep(4)}>
              {universalMode ? "已点「添加」，下一步填凭据 →" : "已添加完成，下一步去验证 →"}
            </button>
          </footer>
        </div>
      ) : null}

      {wizardStep === 4 ? (
        <div className="shortcut-step-body">
          <div className="shortcut-wizard-head">
            <span>第 4 步 / 共 5 步</span>
            <h3>添加时依次填入服务器地址和令牌</h3>
            <p>
              {universalMode
                ? "在 iPhone 点「添加快捷指令」后会连续弹出 2 个填空框，按顺序复制粘贴即可。"
                : "你导出的预填直出文件已写入凭据，添加完成后直接进入第 5 步授权并测试。"}
            </p>
          </div>

          {universalMode ? (
            <>
              <label className="field">
                <span>确认服务器地址（可微调后再复制）</span>
                <input
                  type="url"
                  placeholder="https://ironlog.example.com"
                  value={originInput}
                  onChange={(e) => {
                    setCopiedOrigin(false);
                    setOriginInput(e.target.value);
                  }}
                />
              </label>

              <div className={`shortcut-cred-card${copiedOrigin ? " is-done" : ""}`}>
                <div className="shortcut-card-head">
                  <span className="shortcut-tag">第 1 个弹窗</span>
                  <strong>铁记服务器地址</strong>
                </div>
                <code>{cleanOrigin || "请在上方输入服务器地址"}</code>
                <button
                  type="button"
                  className={copiedOrigin ? "secondary-button" : "primary-button"}
                  disabled={!cleanOrigin}
                  onClick={() =>
                    void copyText(cleanOrigin).then((ok) => {
                      if (ok) setCopiedOrigin(true);
                      notify(ok ? `已复制第 1 项：${cleanOrigin}` : "无法自动复制，请手动复制上方输入框");
                    })
                  }
                >
                  <Icon name="copy" size={15} /> {copiedOrigin ? "✓ 已复制地址（去粘贴第 1 框）" : "复制第 1 项：服务器地址"}
                </button>
              </div>

              <div className={`shortcut-cred-card${copiedToken ? " is-done" : ""}`}>
                <div className="shortcut-card-head">
                  <span className="shortcut-tag">第 2 个弹窗</span>
                  <strong>设备上传令牌（仅令牌本身，无需写 Bearer）</strong>
                </div>
                <code>
                  {token.length > 10 ? `${token.slice(0, 8)}••••••••${token.slice(-4)}` : token || "未找到令牌"}
                </code>
                <button
                  type="button"
                  className={copiedToken ? "secondary-button" : "primary-button"}
                  disabled={!token}
                  onClick={() =>
                    void copyText(token).then((ok) => {
                      if (ok) setCopiedToken(true);
                      notify(ok ? "已复制第 2 项：设备上传令牌" : "请展开下方备用明文令牌手动复制");
                    })
                  }
                >
                  <Icon name="copy" size={15} /> {copiedToken ? "✓ 已复制令牌（去粘贴第 2 框）" : "复制第 2 项：设备令牌"}
                </button>
              </div>
            </>
          ) : (
            <p className="shortcut-verify-status is-ok">
              ✓ 当前为 Mac 预填直出模式，服务器地址与设备令牌已写入快捷指令，导入 iPhone 时不会弹出填空框。
            </p>
          )}

          <details className="training-details">
            <summary>
              <span>备用：查看完整明文令牌 / 手动配置说明（{activeToken?.label || "设备"}）</span>
              <Icon name="chevron" size={14} />
            </summary>
            <div className="details-body">
              <p className="muted">
                如日后在快捷指令内手工修改，服务器文本填上方地址，HTTP 请求头 Authorization 填 <code>Bearer &lt;令牌&gt;</code>。
              </p>
              <label className="field">
                <span>上传令牌</span>
                <input readOnly value={token} />
              </label>
              <div className="details-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    void copyText(token).then((ok) => {
                      if (ok) setCopiedToken(true);
                      notify(ok ? "上传令牌已复制" : "请长按已选中的令牌复制");
                    })
                  }
                >
                  <Icon name="copy" size={15} /> 复制令牌
                </button>
              </div>
            </div>
          </details>

          <footer className="shortcut-wizard-foot">
            <button type="button" className="secondary-button" onClick={() => goToStep(3)}>
              ← 上一步
            </button>
            <button
              type="button"
              className={!universalMode || (copiedOrigin && copiedToken) ? "primary-button" : "secondary-button"}
              onClick={() => goToStep(5)}
            >
              已添加到手机，下一步测试 →
            </button>
          </footer>
        </div>
      ) : null}

      {wizardStep === 5 ? (
        <div className="shortcut-step-body">
          <div className="shortcut-wizard-head">
            <span>第 5 步 / 共 5 步</span>
            <h3>开启健康权限并验证首次同步</h3>
            <p>最后一步：打开 iPhone 隐私授权并试跑一次，确认服务器已收到你的健康数据。</p>
          </div>

          <div className="shortcut-mac-box">
            <div className="shortcut-mac-head">
              <strong>1. 先在 iPhone 打开健康读取权限</strong>
            </div>
            <ol className="shortcut-steps">
              <li>
                打开 iPhone <b>「健康」App → 右上角头像 → 隐私 → App → 快捷指令</b>，将需要的指标权限打开（建议「全部打开」）；
              </li>
              <li>
                新版纯后台指令已适配 iOS 26.2：步数按小时分组回看近 3 天、睡眠按开始日期回看近 2 天，且不包含任何跳转健身 App 动作，不会干扰手表原生训练；
              </li>
              <li>若某项提示「未找到样本」，说明近期暂未测得该项（可回到第 2 步换「基础 4项」或「自动体征 13项」）。</li>
            </ol>
          </div>

          <div className="shortcut-card">
            <div className="shortcut-card-head">
              <span className="shortcut-tag">VERIFY</span>
              <strong>2. 试跑一次并检查是否上传成功</strong>
            </div>
            <small>在 iPhone 上点下「拉起测试」（选「同步今日健康数据」），跑完后点右侧检查按钮：</small>
            <div className="shortcut-action-row">
              <button
                type="button"
                className="primary-button"
                onClick={() => triggerAppleHubAction("daily", { notify })}
              >
                <Icon name="heart" size={15} /> 拉起测试同步
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={checkingSync}
                onClick={() => void handleVerifySync()}
              >
                <Icon name="refresh" size={15} /> {checkingSync ? "检查中…" : "检查是否收到数据"}
              </button>
            </div>
            {syncVerifyMsg ? (
              <p className={`shortcut-verify-status ${syncVerifyMsg.ok ? "is-ok" : "is-wait"}`} role="status">
                {syncVerifyMsg.text}
              </p>
            ) : null}
          </div>

          <div className="shortcut-card">
            <div className="shortcut-card-head">
              <span className="shortcut-tag">AUTOMATION</span>
              <strong>3. 复制参数去配 iPhone 个人自动化</strong>
            </div>
            <AppleAutomationCopyPanel shortcutName={DEFAULT_APPLE_HUB_SHORTCUT_NAME} />
          </div>

          <footer className="shortcut-wizard-foot">
            <button type="button" className="secondary-button" onClick={() => goToStep(4)}>
              ← 上一步
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                bumpDataEpoch();
                onRefresh?.();
                notify("Apple 健康快捷指令向导已完成");
                closeTopModal();
              }}
            >
              完成设置 ✓
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
