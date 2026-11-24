import { useEffect, useId, useState } from "react";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { DotMeter } from "../components/Meters";
import type { AppleDailyEntry, AppleWorkoutAgendaItem } from "../components/apple/AppleHealthModals";
import { formatSleepMinutes } from "../components/apple/AppleHealthModals";
import { downloadClientFile } from "../components/settings/DataModals";
import { apiFetch } from "../lib/api";
import { duration, fmt, shortDate, today } from "../lib/date";
import type { EquipmentKey, ProfileGoals, RecordEnvelope, WeightData } from "../lib/domain";
import { openAppleDailyDetailsModal, openAppleWorkoutDetailsModal, openDeviceSetupModal } from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

type AnalyticsPeriod = 14 | 30 | 60 | 90;
type AnalyticsSection = "training" | "health" | "reports";
type BodyChartKey = "weightKg" | "bodyFatPct" | "waistCm";
type RecoveryChartKey = "restingHeartRateBpm" | "hrvMs" | "bloodOxygenPct" | "steps" | "distanceKm" | "activeEnergyKcal";

interface AnalyticsResponse {
  today: string;
  through: string;
  period: AnalyticsPeriod;
  userProfile: { weightKg: number; appleWeightKg: number | null; gender: string };
  acwr: {
    current: {
      acwr: number;
      ewmaAcwr?: number;
      uncoupledAcwr?: number | null;
      zone: "deload" | "sweet_spot" | "caution" | "danger";
      ewmaZone?: string;
      acuteLoad: number;
      chronicLoad: number;
    };
    series: Array<{ date: string; acwr: number; ewmaAcwr?: number; zone: string }>;
  };
  monotony: {
    current: {
      monotony: number;
      monotonyLevel: "high" | "moderate" | "low";
      meanDailyLoad: number;
      standardDeviation: number;
      trainingStrain: number;
      monotonyAdvice: string;
    };
    previous: { trainingStrain: number };
  };
  muscles: {
    audits: Array<{
      muscleName: string;
      sets: number;
      avg4WeekSets: number;
      category: "optimal" | "overreaching" | "maintenance";
      categoryLabel: string;
      advice: string;
    }>;
  };
  inol: {
    lifts: Array<{
      name: string;
      oneRepMax: number;
      sessionDate?: string;
      category: string;
      categoryLabel: string;
      sessionInol: number;
      weeklyInol: number;
      totalSets: number;
      totalReps: number;
      advice: string;
    }>;
  };
  ipfGl: {
    bench?: { score: number; tierLabel: string } | null;
    total?: { score: number; tierLabel: string } | null;
    components: {
      bench1RM: number;
      squat1RM: number;
      deadlift1RM: number;
      deadliftSourceName?: string;
      total3Lift: number;
    };
  };
  nutrition: {
    protein: {
      status: "optimal" | "suboptimal";
      statusLabel: string;
      averageGramsPerDay: number;
      averageGramsPerKg: number;
      leanMassGramsPerKg?: number | null;
      daysMeetingTarget: number;
      totalDaysLogged: number;
      complianceRatePct: number;
      advice: string;
    };
  };
  bodyweight: {
    report?: {
      category: string;
      categoryLabel: string;
      changeRatePerWeekPct: number;
      weeklySlopeKg: number;
      deltaKg: number;
      weeksSpan: number;
      trendMethod?: string;
      rSquared?: number | null;
      advice: string;
    } | null;
  };
  trainingSummary?: { sessions: number; workSets: number; tonnageKg: number; activeDays: number; dietDaysLogged: number };
  citations: Record<string, { authors: string; year: number; journal: string; title: string; takeaway: string }>;
  appleDaily?: {
    series?: AppleDailyEntry[];
    averages?: { sleepMinutes?: number | null; restingHeartRateBpm?: number | null; hrvMs?: number | null };
    latestBody?: { weightKg?: { value: number; date: string } | null; bodyFatPct?: { value: number } | null };
    bodyReport?: {
      hasData: boolean;
      weightKg?: number | null;
      bodyFatPct?: number | null;
      fatMassKg?: number | null;
      leanBodyMassKg?: number | null;
      leanSharePct?: number | null;
      bmi?: number | null;
      bmiStatus?: { label: string } | null;
      ffmi?: number | null;
      ffmiStatus?: { label: string } | null;
      waistCm?: number | null;
      whtr?: number | null;
      whtrStatus?: { label: string } | null;
      waistStatus?: { label: string } | null;
      heightCm?: number | null;
      heightSource?: string;
      measuredAt?: { weightDate?: string } | null;
      insights?: string[];
      metabolic?: {
        appleRestingAvgKcal?: number | null;
        bmrKatchMcArdleKcal: number;
        sedentaryTdeeKcal: number;
        trainingTdeeKcal: number;
        recompCutTargetKcal: number;
        proteinTargetG: number;
        measuredVsPredictedPct?: number | null;
      } | null;
      recomposition?: {
        targetWaistCm: number;
        waistDeltaCm?: number | null;
        milestones: Array<{ label: string; targetWeightKg: number; fatToLoseKg: number; estWeeks: number }>;
      } | null;
    } | null;
    recoveryReport?: {
      hasData: boolean;
      readinessScore?: number | null;
      readinessTone?: string;
      readinessLabel: string;
      baselineMode?: string;
      signals?: Array<{
        key: string;
        label: string;
        value: number;
        unit: string;
        statusLabel: string;
        tone: string;
        detail: string;
        rangeBand?: { min: number; max: number; optMin: number; optMax: number };
      }>;
      heartRateLatest?: { value: number; spreadFromRhr?: number | null; date: string } | null;
      vo2MaxLatest?: { value: number; date: string } | null;
      insights?: string[];
      lnHrvBaseline?: { latest: number; zScore?: number | null; swcHalfSd?: number | null } | null;
      autonomicBalanceRatio?: number | null;
    } | null;
    activityReport?: {
      hasData: boolean;
      latestSteps?: number | null;
      latestDistanceKm?: number | null;
      latestActiveEnergyKcal?: number | null;
      latestFlightsClimbed?: number | null;
      avgSteps?: number | null;
      avgDistanceKm?: number | null;
      strideCm?: number | null;
      activityTierLabel?: string;
    } | null;
    correlations?: Array<{ label: string; r: number; sampleDays: number; note: string }>;
    weeklyComparison?: {
      recentWindow: { from: string; through: string };
      previousWindow: { daysWithData: number };
      hasPreviousBaseline: boolean;
      metrics: Array<{ key: string; label: string; unit: string; current: number | null; delta: number | null }>;
    } | null;
    coverageSummary?: {
      syncedCount: number;
      totalCount: number;
      categoryProgress?: Array<{ category: string; synced: number; total: number }>;
      syncedMetrics: Array<{ label: string }>;
      missingMetrics?: Array<{ category: string; label: string }>;
    } | null;
  } | null;
  appleWorkouts?: AppleWorkoutsBucket & {
    realDeviceCount: number;
    demoCount: number;
    realDeviceStats?: AppleWorkoutsBucket | null;
  };
}

interface AppleWorkoutsBucket {
  totalCount: number;
  realDeviceCount?: number;
  linkedManualCount?: number;
  totalDurationSeconds: number;
  totalCaloriesKcal: number;
  totalDistanceKm: number;
  avgBpm: number | null;
  maxBpm: number | null;
  byActivity: Array<{ title: string; count: number; durationSeconds: number; caloriesKcal: number; avgBpm: number | null }>;
  hrZones?: {
    hrMax: number;
    hrMaxSource: string;
    zones: Array<{ key: string; label: string; count: number; pct: number; durationSeconds: number }>;
  } | null;
  recent: Array<{
    id: string;
    date: string;
    title: string;
    activityType: string;
    isDemo?: boolean;
    captureMethod?: string;
    durationSeconds: number;
    activeEnergyKcal?: number | null;
    distanceMeters?: number | null;
    heartRate?: { avgBpm?: number | null; maxBpm?: number | null } | null;
  }>;
}

const BODY_CHART_METRICS: Record<BodyChartKey, { label: string; unit: string; digits: number }> = {
  weightKg: { label: "体重", unit: "kg", digits: 2 },
  bodyFatPct: { label: "体脂率", unit: "%", digits: 1 },
  waistCm: { label: "腰围", unit: "cm", digits: 1 },
};

const RECOVERY_CHART_METRICS: Record<RecoveryChartKey, { label: string; unit: string; digits: number }> = {
  restingHeartRateBpm: { label: "静息心率", unit: "bpm", digits: 0 },
  hrvMs: { label: "HRV", unit: "ms", digits: 1 },
  bloodOxygenPct: { label: "血氧 SpO2", unit: "%", digits: 1 },
  steps: { label: "步数", unit: "步", digits: 0 },
  distanceKm: { label: "距离", unit: "km", digits: 2 },
  activeEnergyKcal: { label: "活动消耗", unit: "kcal", digits: 0 },
};

function toneClass(tone?: string): string {
  return tone === "sweet" ? "is-sweet" : tone === "danger" ? "is-danger" : tone === "caution" ? "is-caution" : "";
}

function plainAcwrStatus(zone: string): string {
  if (zone === "deload") return "偏轻松";
  if (zone === "sweet_spot") return "刚刚好";
  if (zone === "caution") return "有点累";
  return "练太猛了";
}

function formatHumanCorrelation(c: { label: string; r: number; sampleDays: number; note: string }): string {
  const daysNote = `（近 ${c.sampleDays} 天规律）`;
  if (c.label.includes("睡眠") && c.label.includes("HRV")) {
    return `${c.r > 0 ? "睡得越久，身体恢复活力往往越好" : "睡眠时长和恢复指标近期走势相反"}${daysNote}。`;
  }
  if (c.label.includes("睡眠") && c.label.includes("静息心率")) {
    return `${c.r < 0 ? "睡得越足，早上静息心率通常越低越稳" : "睡眠时长与静息心率同步变动"}${daysNote}。`;
  }
  if (c.label.includes("步数") && c.label.includes("消耗")) {
    return `走动越多、越活跃的日子，额外消耗的热量也明显更高${daysNote}。`;
  }
  if (c.label.includes("体重") && c.label.includes("腰围")) {
    return `${c.r > 0 ? "体重下降的时候，腰围也在稳步变小" : "体重和腰围近期变化步调不完全一致"}${daysNote}。`;
  }
  return `${c.label}近期呈现稳定${c.r > 0 ? "同向" : "反向"}趋势${daysNote}。`;
}

function pickAvailableChartMetric<K extends string>(
  series: AppleDailyEntry[],
  metricsMap: Record<K, { label: string; unit: string; digits: number }>,
  requestedKey: K,
  fallbackKey: K,
): K {
  if (requestedKey && metricsMap[requestedKey]) {
    if (series.filter((e) => typeof e[requestedKey as keyof AppleDailyEntry] === "number").length >= 2) {
      return requestedKey;
    }
  }
  for (const key of Object.keys(metricsMap) as K[]) {
    if (series.filter((e) => typeof e[key as keyof AppleDailyEntry] === "number").length >= 2) return key;
  }
  return requestedKey && metricsMap[requestedKey] ? requestedKey : fallbackKey;
}

function SimpleTrendChart({
  points,
  label,
  unit,
  digits,
}: {
  points: Array<{ date: string; value: number }>;
  label: string;
  unit: string;
  digits: number;
}) {
  const gradId = useId();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="apple-baseline-note">
        <Icon name="heart" size={14} />
        <span>
          已记录首日基线数据（{points[0] ? `${shortDate(points[0].date)} · ${fmt(points[0].value, digits)} ${unit}` : "待同步"}
          ）；连续同步 ≥ 2 天后自动绘制{label}趋势曲线。
        </span>
      </div>
    );
  }

  const width = 640;
  const height = 180;
  const padL = 52;
  const padR = 16;
  const padT = 18;
  const padB = 26;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const vals = points.map((p) => p.value);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const delta = vals.at(-1)! - vals[0]!;
  const span = Math.max(0.5, rawMax - rawMin);
  const lo = rawMin - span * 0.16;
  const hi = rawMax + span * 0.16;
  const getX = (i: number) => padL + (i / (points.length - 1)) * chartW;
  const getY = (v: number) => padT + chartH - ((v - lo) / (hi - lo)) * chartH;
  const poly = points.map((p, i) => `${getX(i).toFixed(1)},${getY(p.value).toFixed(1)}`).join(" ");
  const baseBottomY = padT + chartH;
  const areaPoly = `${getX(0).toFixed(1)},${baseBottomY} ${poly} ${getX(points.length - 1).toFixed(1)},${baseBottomY}`;

  const activeTip =
    activeIdx != null && points[activeIdx]
      ? `${shortDate(points[activeIdx]!.date)} · ${label} ${fmt(points[activeIdx]!.value, digits)} ${unit}`
      : "";

  return (
    <>
      <div className="apple-trend-meta">
        <span>
          均值 <b>{fmt(avg, digits)} {unit}</b>
        </span>
        <span>
          范围 {fmt(rawMin, digits)}–{fmt(rawMax, digits)} {unit}
        </span>
        <span>
          变化{" "}
          <b className={delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}>
            {delta > 0 ? "+" : ""}
            {fmt(delta, digits)} {unit}
          </b>
        </span>
      </div>
      <div className="chart-readout-line">
        <span className="chart-readout">{activeTip}</span>
      </div>
      <svg className="analytics-chart" viewBox={`0 0 ${width} ${height}`} aria-label={`${label}趋势图`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--red)" stopOpacity={0.24} />
            <stop offset="100%" stopColor="var(--red)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <line x1={padL} y1={getY(rawMax)} x2={width - padR} y2={getY(rawMax)} stroke="var(--edge)" strokeDasharray="3 3" />
        <line x1={padL} y1={getY(avg)} x2={width - padR} y2={getY(avg)} stroke="var(--muted)" strokeDasharray="4 3" opacity={0.65} />
        <line x1={padL} y1={getY(rawMin)} x2={width - padR} y2={getY(rawMin)} stroke="var(--edge)" strokeDasharray="3 3" />
        <text x={padL - 6} y={getY(rawMax) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
          {fmt(rawMax, digits)}
        </text>
        <text x={padL - 6} y={getY(rawMin) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
          {fmt(rawMin, digits)}
        </text>
        <text x={width - padR - 2} y={getY(avg) - 5} fontSize={11} textAnchor="end" fill="var(--muted)">
          均值 {fmt(avg, digits)}
        </text>
        <polygon points={areaPoly} fill={`url(#${gradId})`} />
        <polyline points={poly} fill="none" stroke="var(--red)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => {
          const cx = Number(getX(i).toFixed(1));
          const cy = Number(getY(p.value).toFixed(1));
          const tip = `${shortDate(p.date)} · ${label} ${fmt(p.value, digits)} ${unit}`;
          return (
            <g key={p.date}>
              <circle cx={cx} cy={cy} r={4} fill="var(--red)" />
              <circle
                cx={cx}
                cy={cy}
                r={10}
                className={`chart-hit${activeIdx === i ? " is-active" : ""}`}
                tabIndex={0}
                role="button"
                aria-label={tip}
                onClick={() => setActiveIdx((cur) => (cur === i ? null : i))}
                onFocus={() => setActiveIdx(i)}
              >
                <title>{tip}</title>
              </circle>
            </g>
          );
        })}
        <text x={padL} y={height - 5} fontSize={11} fill="var(--muted)">
          {shortDate(points[0]!.date)}
        </text>
        <text x={width - padR} y={height - 5} fontSize={11} textAnchor="end" fill="var(--muted)">
          {shortDate(points.at(-1)!.date)}
        </text>
      </svg>
    </>
  );
}

function DayDeltaTag({
  curr,
  prev,
  unit = "",
  digits = 1,
  lowerBetter = false,
}: {
  curr?: number | null;
  prev?: number | null;
  unit?: string;
  digits?: number;
  lowerBetter?: boolean;
}) {
  if (typeof curr !== "number" || typeof prev !== "number") return null;
  const diff = curr - prev;
  if (Math.abs(diff) < (digits === 0 ? 1 : 0.05)) return null;
  const good = lowerBetter ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "↑" : "↓";
  const sign = diff > 0 ? "+" : "";
  return (
    <span className={`apple-delta-tag ${good ? "is-good" : "is-warn"}`}>
      {arrow}
      {sign}
      {fmt(diff, digits)}
      {unit}
    </span>
  );
}

export function AnalyticsView() {
  const userId = useAuthStore((s) => s.userId);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [period, setPeriod] = useState<AnalyticsPeriod>(30);
  const [through, setThrough] = useState<string>(() => today());
  const [section, setSection] = useState<AnalyticsSection>("training");
  const [appleBodyChart, setAppleBodyChart] = useState<BodyChartKey>("weightKg");
  const [appleRecoveryChart, setAppleRecoveryChart] = useState<RecoveryChartKey>("restingHeartRateBpm");
  const [appleWorkoutFilter, setAppleWorkoutFilter] = useState<"all" | "device">("all");
  const [workoutsExpanded, setWorkoutsExpanded] = useState(false);
  const [dailyExpanded, setDailyExpanded] = useState(false);
  const [acwrActiveIdx, setAcwrActiveIdx] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState("");

  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ days: String(period), through });
    setLoading(true);
    setError("");
    setAcwrActiveIdx(null);
    void apiFetch<AnalyticsResponse>(`/api/web/analytics?${query.toString()}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载数据分析失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, period, through, dataEpoch]);

  if (loading && !data) {
    return (
      <div className="empty loading" role="status">
        正在计算负荷、恢复与力量分析…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="empty">
        <strong>数据分析加载失败</strong>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={bumpDataEpoch}>
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { acwr, monotony, muscles, inol, ipfGl, nutrition, bodyweight, appleDaily, appleWorkouts, userProfile } = data;
  const hasApple = Boolean(
    appleHealthConnected ||
      appleDaily?.bodyReport?.hasData ||
      appleDaily?.recoveryReport?.hasData ||
      (appleWorkouts?.totalCount ?? 0) > 0,
  );
  const activeSection: AnalyticsSection = !hasApple && section === "health" ? "training" : section;

  const currAcwr = acwr.current;
  const acwrBadgeClass =
    currAcwr.zone === "sweet_spot"
      ? "is-sweet"
      : currAcwr.zone === "danger"
        ? "is-danger"
        : currAcwr.zone === "caution"
          ? "is-caution"
          : "is-deload";

  const optMuscles = muscles.audits.filter((m) => m.category === "optimal").length;
  const appleWeightDiff =
    userProfile.appleWeightKg != null && Math.abs(userProfile.appleWeightKg - userProfile.weightKg) >= 0.1;

  const rec = appleDaily?.recoveryReport;
  const body = appleDaily?.bodyReport;
  const readinessScore = hasApple ? rec?.readinessScore ?? null : null;
  const readinessToneClass = rec?.readinessTone ? toneClass(rec.readinessTone) : "";
  const tierRaw = ipfGl.total?.tierLabel ?? ipfGl.bench?.tierLabel ?? "暂无数据";
  const tierShort = tierRaw.replace(/\s*\([^)]*\)/, "");

  // Coach summary bullets
  let loadTip = "最近还没有连贯训练，按计划正常开练就好。";
  if (currAcwr.acwr > 0) {
    if (currAcwr.zone === "danger" || (currAcwr.ewmaZone === "danger" && readinessScore != null && readinessScore < 70)) {
      loadTip = "这阵子训练量冲得太猛了，建议接下来 1–2 天减载或休息恢复，避免练伤。";
    } else if (currAcwr.ewmaZone === "danger") {
      loadTip = "近两天训练量加得有点急，虽然周平均还没超线，明天别硬上极限重量。";
    } else if (readinessScore != null && readinessScore < 60) {
      loadTip = `今天身体恢复状态一般（${readinessScore} 分），练的时候少冲力竭组、动作稳一点。`;
    } else if (currAcwr.zone === "sweet_spot") {
      loadTip = "最近训练量和身体恢复配合得刚刚好，按计划稳步加重量或次数就行。";
    } else if (currAcwr.zone === "caution") {
      loadTip = "近期训练量比平时略高一点，注意晚上睡足，别连着猛练同一个部位。";
    } else {
      loadTip = "最近训练量比较轻松，适合当作调整恢复周；想冲进度的话这周可以慢慢加点量。";
    }
  }

  let bodyTip = "多记几顿饮食和早起称重，系统就能自动过滤喝水波动，帮你盯住蛋白质和体重走向。";
  const bodyParts: string[] = [];
  if (nutrition.protein.totalDaysLogged > 0) {
    bodyParts.push(
      nutrition.protein.status === "suboptimal"
        ? `每日蛋白偏低（均 ${fmt(nutrition.protein.averageGramsPerDay)} g），多吃点瘦肉蛋奶`
        : `蛋白质吃得很够（均 ${fmt(nutrition.protein.averageGramsPerDay)} g · 达标率 ${nutrition.protein.complianceRatePct}%）`,
    );
  }
  if (bodyweight.report) {
    const bw = bodyweight.report;
    const slopeAbs = fmt(Math.abs(bw.weeklySlopeKg ?? 0), 2);
    if (bw.category === "optimal_cut") bodyParts.push(`近期体重每周稳降约 ${slopeAbs} kg，减脂不掉肌节奏很好`);
    else if (bw.category === "rapid_loss") bodyParts.push(`近期每周降重约 ${slopeAbs} kg 有点太快，小心跟着掉力气`);
    else if (bw.category === "lean_bulk") bodyParts.push(`近期体重每周稳涨约 ${slopeAbs} kg，干净增肌节奏不错`);
    else if (bw.category === "rapid_gain") bodyParts.push(`近期每周涨重约 ${slopeAbs} kg 偏快，注意控制多余热量`);
    else bodyParts.push("近期体重过滤单日波动后整体平稳");
  }
  if (bodyParts.length) bodyTip = `${bodyParts.join("；")}。`;

  let muscleTip = `本周有 ${optMuscles} / 6 个大肌群练够了推荐组数，分布很均衡。`;
  if (optMuscles < 4) {
    const lacking = muscles.audits
      .filter((m) => m.category === "maintenance")
      .slice(0, 2)
      .map((m) => m.muscleName)
      .join("、");
    muscleTip = lacking
      ? `${lacking}这周练的组数偏少（不足 10 组），下周可以适当多给它们补一两个动作。`
      : "个别部位这周总组数偏高，记得留够肌肉恢复时间。";
  }

  const handleAdoptAppleWeight = async () => {
    if (userProfile.appleWeightKg == null || busyAction) return;
    const targetDate = appleDaily?.latestBody?.weightKg?.date ?? data.through ?? today();
    setBusyAction("adoptWeight");
    try {
      const weights = await apiFetch<Array<RecordEnvelope<WeightData>>>("/api/records/weight").catch(() => []);
      const existing = weights.find((r) => !r.deleted && r.id === `weight_${targetDate}`);
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId: crypto.randomUUID(),
          id: `weight_${targetDate}`,
          kind: "weight",
          baseVersion: existing?.version ?? 0,
          deleted: false,
          data: {
            date: targetDate,
            weight: userProfile.appleWeightKg,
            bodyFat: appleDaily?.latestBody?.bodyFatPct?.value ?? existing?.data?.bodyFat ?? null,
          },
        },
      });
      bumpDataEpoch();
      notify(`已同步 Apple 健康体重 ${fmt(userProfile.appleWeightKg, 2)} kg (${shortDate(targetDate)})`);
    } catch (err) {
      notify((err as Error)?.message || "同步体重失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleApplyAppleTargets = async () => {
    const met = body?.metabolic;
    if (!met || !body || busyAction) return;
    setBusyAction("applyTargets");
    try {
      const profRes = await apiFetch<{ version: number; profile: ProfileGoals }>("/api/web/profile");
      const profile = profRes.profile;
      const calories = met.recompCutTargetKcal;
      const protein = met.proteinTargetG;
      const fat = Math.max(40, Math.round((body.weightKg ?? 75) * 0.8));
      const carbs = Math.max(50, Math.round((calories - protein * 4 - fat * 9) / 4));
      const targetWeight = body.recomposition?.milestones?.[0]?.targetWeightKg ?? profile.targetWeight ?? null;
      const nextEnergyProfile = profile.energyProfile
        ? {
            ...profile.energyProfile,
            heightCm: body.heightCm ?? profile.energyProfile.heightCm,
            weightKg: body.weightKg ?? profile.energyProfile.weightKg,
            weightDate: body.measuredAt?.weightDate ?? profile.energyProfile.weightDate,
          }
        : null;

      await apiFetch("/api/web/profile", {
        method: "PUT",
        body: {
          calories,
          protein,
          carbs,
          fat,
          targetWeight,
          daysPerWeek: profile.daysPerWeek,
          restSeconds: profile.restSeconds,
          equipment: (profile.equipment ?? []) as EquipmentKey[],
          energyProfile: nextEnergyProfile,
          version: profRes.version,
          opId: crypto.randomUUID(),
        },
      });
      bumpDataEpoch();
      notify(`已同步目标：热量 ${calories} kcal · 蛋白 ${protein} g · 碳水 ${carbs} g · 脂肪 ${fat} g`);
    } catch (err) {
      notify((err as Error)?.message || "同步饮食目标失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleExportCsv = () => {
    const ad = appleDaily?.series ?? [];
    const ts = data.trainingSummary;
    const activeBucket =
      appleWorkoutFilter === "device" && appleWorkouts?.realDeviceStats ? appleWorkouts.realDeviceStats : appleWorkouts;
    const aw = activeBucket?.recent ?? [];
    if (!ad.length && !aw.length && !(ts && ts.sessions > 0)) {
      notify("当前区间暂无可导出的健康与训练记录");
      return;
    }
    const csvCell = (val: unknown) => `"${String(val ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [
      [
        "记录类型",
        "日期",
        "名称/时段",
        "来源",
        "体重(kg)",
        "体脂(%)",
        "瘦体重(kg)",
        "BMI",
        "腰围(cm)",
        "FFMI",
        "WHtR腰高比",
        "Katch BMR(kcal)",
        "准备度评分",
        "静息HR",
        "即时HR",
        "HRV(ms)",
        "血氧(%)",
        "呼吸(/分)",
        "步数",
        "步行距离(km)",
        "楼层",
        "活动kcal",
        "静息kcal",
        "睡眠(分)",
        "训练时长(秒)",
      ]
        .map(csvCell)
        .join(","),
    ];
    if (ts?.sessions) {
      lines.push(
        [
          "力量训练汇总",
          data.through ?? today(),
          `${ts.sessions}场·${ts.workSets}组·${ts.tonnageKg}kg吨位`,
          "铁记训练",
          ...Array(21).fill(""),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    if (body?.hasData || rec?.hasData) {
      lines.push(
        [
          "区间最新评估",
          data.through ?? today(),
          rec?.readinessLabel ?? "",
          "汇总分析",
          body?.weightKg ?? "",
          body?.bodyFatPct ?? "",
          body?.leanBodyMassKg ?? "",
          body?.bmi ?? "",
          body?.waistCm ?? "",
          body?.ffmi ?? "",
          body?.whtr ?? "",
          body?.metabolic?.bmrKatchMcArdleKcal ?? "",
          rec?.readinessScore ?? "",
          ...Array(12).fill(""),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    for (const r of ad) {
      lines.push(
        [
          "每日体征",
          r.date,
          "",
          "Apple 健康",
          r.weightKg,
          r.bodyFatPct,
          r.leanBodyMassKg,
          r.bmi,
          r.waistCm,
          "",
          "",
          "",
          "",
          r.restingHeartRateBpm,
          r.heartRateBpm,
          r.hrvMs,
          r.bloodOxygenPct,
          r.respiratoryRate,
          r.steps,
          r.distanceKm,
          r.flightsClimbed,
          r.activeEnergyKcal,
          r.restingEnergyKcal,
          r.sleepMinutes,
          "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    for (const w of aw) {
      lines.push(
        [
          "运动记录",
          w.date,
          w.title,
          w.isDemo ? "示例" : w.captureMethod === "trigger" ? "真机·触发" : "真机上传",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          w.heartRate?.avgBpm ?? "",
          "",
          "",
          "",
          "",
          w.distanceMeters ? (w.distanceMeters / 1000).toFixed(2) : "",
          "",
          w.activeEnergyKcal ?? "",
          "",
          "",
          w.durationSeconds ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const filterTag = appleWorkoutFilter === "device" ? "-仅真机" : "";
    downloadClientFile(
      `\uFEFF${lines.join("\r\n")}`,
      "text/csv;charset=utf-8;",
      `铁记-健康训练分析报表-${data.through || today()}${filterTag}.csv`,
    );
    notify("已导出健康与训练 CSV 报表");
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      through: data.through,
      periodDays: data.period,
      userProfile: data.userProfile,
      trainingSummary: data.trainingSummary,
      appleDaily: data.appleDaily,
      appleWorkouts: data.appleWorkouts,
    };
    downloadClientFile(
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8;",
      `铁记-健康训练体检报告-${data.through || today()}.json`,
    );
    notify("已导出健康与训练 JSON 体检报告");
  };

  // ACWR chart geometry
  const acwrSeries = acwr.series;
  const acwrWidth = 640;
  const acwrHeight = 180;
  const acwrPadL = 40;
  const acwrPadR = 16;
  const acwrPadT = 16;
  const acwrPadB = 26;
  const acwrChartW = acwrWidth - acwrPadL - acwrPadR;
  const acwrChartH = acwrHeight - acwrPadT - acwrPadB;
  const maxAcwr = Math.max(2.0, ...acwrSeries.map((s) => Math.max(s.acwr, s.ewmaAcwr ?? 0)));
  const getAcwrY = (v: number) => acwrPadT + acwrChartH - (v / maxAcwr) * acwrChartH;
  const getAcwrX = (idx: number) => acwrPadL + (idx / Math.max(1, acwrSeries.length - 1)) * acwrChartW;
  const acwrTipText =
    acwrActiveIdx != null && acwrSeries[acwrActiveIdx]
      ? `${shortDate(acwrSeries[acwrActiveIdx]!.date)} · 负荷比 ${fmt(acwrSeries[acwrActiveIdx]!.acwr, 2)}（${plainAcwrStatus(acwrSeries[acwrActiveIdx]!.zone)}）`
      : "";

  // Health recovery & body chart slices
  const healthSeries = appleDaily?.series ?? [];
  const recMetricKey = pickAvailableChartMetric(healthSeries, RECOVERY_CHART_METRICS, appleRecoveryChart, "restingHeartRateBpm");
  const recSpec = RECOVERY_CHART_METRICS[recMetricKey];
  const recPoints = healthSeries
    .filter((entry) => typeof entry[recMetricKey] === "number")
    .map((entry) => ({ date: entry.date, value: entry[recMetricKey] as number }));

  const bodyMetricKey = pickAvailableChartMetric(healthSeries, BODY_CHART_METRICS, appleBodyChart, "weightKg");
  const bodySpec = BODY_CHART_METRICS[bodyMetricKey];
  const bodyPoints = healthSeries
    .filter((entry) => typeof entry[bodyMetricKey] === "number")
    .map((entry) => ({ date: entry.date, value: entry[bodyMetricKey] as number }));

  // Report variables
  const entriesDesc = hasApple ? [...healthSeries].reverse() : [];
  const activeWorkoutBucket =
    appleWorkoutFilter === "device" && appleWorkouts?.realDeviceStats ? appleWorkouts.realDeviceStats : appleWorkouts;
  const filteredWorkouts = activeWorkoutBucket?.recent ?? [];
  const visibleWorkouts = filteredWorkouts.slice(0, workoutsExpanded ? filteredWorkouts.length : 8);
  const visibleDaily = entriesDesc.slice(0, dailyExpanded ? entriesDesc.length : 10);
  const realDeviceCount = appleWorkouts?.realDeviceCount ?? 0;
  const demoCount = appleWorkouts?.demoCount ?? 0;
  const onlyShortTriggers =
    appleWorkoutFilter === "device" &&
    filteredWorkouts.length > 0 &&
    !activeWorkoutBucket?.hrZones &&
    (activeWorkoutBucket?.totalCaloriesKcal ?? 0) === 0 &&
    filteredWorkouts.every((r) => r.captureMethod === "trigger");

  const ewmaAlert =
    currAcwr.ewmaZone === "danger" && currAcwr.zone !== "danger"
      ? " 提醒：这最近两天训练量突然冲得有点猛，即使周平均还没超标，明天也建议放缓一点。"
      : "";
  const acwrAdviceText =
    (currAcwr.zone === "sweet_spot"
      ? "当前训练节奏非常合适，刺激足够又不容易练伤，照常推进即可。"
      : currAcwr.zone === "danger"
        ? "警告：近期训练量突然上涨太多，关节和体能容易吃不消，强烈建议安排 2–3 天休息或大幅减轻重量！"
        : currAcwr.zone === "caution"
          ? "最近训练量比平时略高，如果感觉累了记得多睡会儿、吃好碳水，别连续加码。"
          : "最近训练量比平时轻一些，如果是主动减载休整正好；想冲力量的话可以慢慢多练几组。") + ewmaAlert;

  return (
    <>
      <div className="page-heading masthead-analytics">
        <div>
          <h1>数据分析</h1>
          <p>
            {hasApple
              ? "负荷、恢复、力量和饮食，一页看清近期状态与建议。"
              : "负荷、力量、肌群分布和饮食，一页看清近期训练节奏与建议。"}
          </p>
        </div>
        <div className="period-controls">
          <label aria-label="数据分析截止日期">
            <input
              type="date"
              min="1902-01-01"
              max={data.today}
              value={through}
              onChange={(e) => {
                if (e.target.value) setThrough(e.target.value);
              }}
            />
          </label>
          <div className="segments">
            {([14, 30, 60, 90] as const).map((d) => (
              <button key={d} type="button" aria-pressed={period === d} onClick={() => setPeriod(d)}>
                {d} 天
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section-bar stats-header analytics-meta-bar">
        <div>
          <h2>近期状态一览</h2>
          <p>
            截至 {shortDate(data.through)} · 当前体重 {fmt(userProfile.weightKg, 1)} kg
            {userProfile.appleWeightKg != null && Math.abs(userProfile.appleWeightKg - userProfile.weightKg) >= 0.05
              ? ` · Apple 健康 ${fmt(userProfile.appleWeightKg, 2)} kg`
              : ""}{" "}
            ({userProfile.gender === "female" ? "女性" : "男性"})
            {appleWeightDiff ? (
              <>
                {" "}
                <button
                  type="button"
                  className="quiet apple-inline-sync"
                  disabled={busyAction === "adoptWeight"}
                  onClick={() => void handleAdoptAppleWeight()}
                >
                  同步为 {fmt(userProfile.appleWeightKg, 2)} kg
                </button>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="kpis analytics-kpis">
        <div className={`kpi-card ${acwrBadgeClass}`}>
          <span className="kpi-label">训练节奏（负荷比）</span>
          <div className="kpi-val-row">
            <strong className="kpi-value">{fmt(currAcwr.acwr, 2)}</strong>
            <span className={`kpi-pill ${acwrBadgeClass}`}>{plainAcwrStatus(currAcwr.zone)}</span>
          </div>
          <span className="kpi-sub">
            近7天 {fmt(currAcwr.acuteLoad)} kg · 平时每周 {fmt(currAcwr.chronicLoad)} kg
          </span>
        </div>

        {readinessScore != null && rec ? (
          <div className={`kpi-card ${readinessToneClass}`}>
            <span className="kpi-label">今日身体准备度</span>
            <div className="kpi-val-row">
              <strong className="kpi-value">
                {readinessScore} <small>分</small>
              </strong>
              <span className={`kpi-pill ${readinessToneClass}`}>{rec.readinessLabel.split(" · ")[0]}</span>
            </div>
            <span className="kpi-sub">
              {[
                body?.weightKg != null ? `${fmt(body.weightKg, 2)} kg` : null,
                body?.bodyFatPct != null ? `体脂 ${fmt(body.bodyFatPct, 1)}%` : null,
                appleDaily?.averages?.sleepMinutes != null
                  ? `睡眠 ${formatSleepMinutes(appleDaily.series?.at(-1)?.sleepMinutes ?? appleDaily.averages.sleepMinutes)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "综合心率与睡眠恢复"}
            </span>
          </div>
        ) : (
          <div
            className={`kpi-card ${
              monotony.current.monotonyLevel === "high"
                ? "is-danger"
                : monotony.current.monotonyLevel === "moderate"
                  ? "is-caution"
                  : "is-sweet"
            }`}
          >
            <span className="kpi-label">练休起伏</span>
            <div className="kpi-val-row">
              <strong className="kpi-value">
                {monotony.current.monotonyLevel === "high"
                  ? "太单一"
                  : monotony.current.monotonyLevel === "moderate"
                    ? "较平均"
                    : "张弛有度"}
              </strong>
              <span className="kpi-pill">
                {monotony.current.monotonyLevel === "high"
                  ? "多留休息日"
                  : monotony.current.monotonyLevel === "moderate"
                    ? "轻重交替"
                    : "恢复节奏好"}
              </span>
            </div>
            <span className="kpi-sub">重训与休息错开更不容易疲劳堆积</span>
          </div>
        )}

        <div className="kpi-card is-sweet">
          <span className="kpi-label">肌群练到位</span>
          <div className="kpi-val-row">
            <strong className="kpi-value">
              {optMuscles} <small>/ 6 部位</small>
            </strong>
            <span className="kpi-pill is-sweet">{optMuscles >= 4 ? "分布均衡" : "部分偏少"}</span>
          </div>
          <span className="kpi-sub">建议每个部位每周 10–20 组</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">同体重力量</span>
          <div className="kpi-val-row">
            <strong className="kpi-value">
              {ipfGl.total ? fmt(ipfGl.total.score, 1) : ipfGl.bench ? fmt(ipfGl.bench.score, 1) : "—"}{" "}
              <small>分</small>
            </strong>
            <span className="kpi-pill">{tierShort}</span>
          </div>
          <span className="kpi-sub">
            {ipfGl.total
              ? "三大项同体型排名分"
              : ipfGl.bench
                ? "卧推同体型排名分"
                : "完成深蹲/卧推/硬拉后评估"}
          </span>
        </div>
      </div>

      <section className="coach-summary-strip" aria-label="本周核心建议">
        <div className="coach-summary-head">
          <Icon name="bolt" size={15} /> <strong>一句话结论</strong>
        </div>
        <ul className="sci-insight-list">
          <li>{loadTip}</li>
          <li>{bodyTip}</li>
          <li>{muscleTip}</li>
        </ul>
      </section>

      <div className="analytics-subnav" role="navigation" aria-label="分析板块筛选">
        <div className="segments">
          <button type="button" aria-pressed={activeSection === "training"} onClick={() => setSection("training")}>
            训练与力量
          </button>
          {hasApple ? (
            <button type="button" aria-pressed={activeSection === "health"} onClick={() => setSection("health")}>
              身体与恢复
            </button>
          ) : null}
          <button type="button" aria-pressed={activeSection === "reports"} onClick={() => setSection("reports")}>
            {hasApple ? "明细与报表" : "训练报表与文献"}
          </button>
        </div>
        <span className="analytics-subnav-meta">
          {activeSection === "health"
            ? "聚焦 Apple 健康体成分、睡眠与心率恢复"
            : activeSection === "training"
              ? "聚焦负荷节奏、肌群组数、强度与饮食"
              : hasApple
                ? "聚焦每日体征流水表、运动统计与导出"
                : "聚焦力量训练汇总报表、导出与科研文献"}
        </span>
      </div>

      <div className="analytics-deck">
        {/* TRAINING SECTION */}
        {activeSection === "training" ? (
          <>
            <section className="panel analytics-panel panel-acwr" id="panel-acwr">
              <header className="panel-head">
                <div>
                  <h2>最近训练量是否过载</h2>
                  <p>把近 7 天训练量和平时 1 个月对比，预防练太猛受伤</p>
                </div>
                <span className="atlas-pill">
                  {plainAcwrStatus(currAcwr.zone)} ({fmt(currAcwr.acwr, 2)})
                </span>
              </header>

              <div className="acwr-gauge-strip">
                <div className="acwr-zone-meter">
                  <div className="zone-bar deload" title="偏轻 (<0.8)" />
                  <div className="zone-bar sweet" title="刚刚好 (0.8–1.3)" />
                  <div className="zone-bar caution" title="偏累 (1.3–1.5)" />
                  <div className="zone-bar danger" title="过载 (≥1.5)" />
                  <div
                    className="acwr-pointer"
                    style={{ left: `${Math.min(100, Math.max(0, (currAcwr.acwr / 2.0) * 100))}%` }}
                  >
                    <i />
                    <b>{fmt(currAcwr.acwr, 2)}</b>
                  </div>
                </div>
                <div className="acwr-zone-legend" aria-hidden="true">
                  <span>&lt;0.8 偏轻</span>
                  <span>0.8–1.3 刚刚好</span>
                  <span>1.3–1.5 偏累</span>
                  <span>≥1.5 过载</span>
                </div>
              </div>

              <div className="chart-wrap">
                <div className="chart-info">
                  <strong>{fmt(currAcwr.acwr, 2)}</strong>
                  <span>负荷比 · {plainAcwrStatus(currAcwr.zone)}</span>
                  <small>
                    近7天总量 {fmt(currAcwr.acuteLoad)} kg · 平时每周 {fmt(currAcwr.chronicLoad)} kg
                  </small>
                </div>
                <div className="chart-readout-line">
                  <span className="chart-readout">{acwrTipText}</span>
                </div>
                {acwrSeries.length ? (
                  <svg className="analytics-chart" viewBox={`0 0 ${acwrWidth} ${acwrHeight}`} aria-label="ACWR 趋势图">
                    <defs>
                      <linearGradient id="sweetZoneGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.08} />
                        <stop offset="100%" stopColor="var(--ink)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <rect
                      x={acwrPadL}
                      y={getAcwrY(1.3)}
                      width={acwrChartW}
                      height={Math.max(0, getAcwrY(0.8) - getAcwrY(1.3))}
                      fill="url(#sweetZoneGrad)"
                    />
                    <line x1={acwrPadL} y1={getAcwrY(0.8)} x2={acwrWidth - acwrPadR} y2={getAcwrY(0.8)} stroke="var(--edge)" strokeDasharray="3 3" />
                    <line x1={acwrPadL} y1={getAcwrY(1.3)} x2={acwrWidth - acwrPadR} y2={getAcwrY(1.3)} stroke="var(--edge)" strokeDasharray="3 3" />
                    <text x={acwrWidth - acwrPadR - 4} y={getAcwrY(1.3) - 5} fontSize={11} textAnchor="end" fill="var(--muted)">
                      理想上限 1.3
                    </text>
                    <line x1={acwrPadL} y1={getAcwrY(1.5)} x2={acwrWidth - acwrPadR} y2={getAcwrY(1.5)} stroke="var(--red)" strokeDasharray="4 2" strokeWidth={1.2} />
                    <text x={acwrPadL + 4} y={getAcwrY(1.5) - 5} fontSize={11} fill="var(--red)">
                      过载线 1.5
                    </text>
                    {acwrSeries.some((s) => typeof s.ewmaAcwr === "number") ? (
                      <polyline
                        points={acwrSeries.map((s, idx) => `${getAcwrX(idx).toFixed(1)},${getAcwrY(s.ewmaAcwr ?? s.acwr).toFixed(1)}`).join(" ")}
                        fill="none"
                        stroke="var(--muted)"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                    <polyline
                      points={acwrSeries.map((s, idx) => `${getAcwrX(idx).toFixed(1)},${getAcwrY(s.acwr).toFixed(1)}`).join(" ")}
                      fill="none"
                      stroke="var(--ink)"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {acwrSeries.map((s, idx) => {
                      const cx = Number(getAcwrX(idx).toFixed(1));
                      const cy = Number(getAcwrY(s.acwr).toFixed(1));
                      const tip = `${shortDate(s.date)} · 负荷比 ${fmt(s.acwr, 2)}（${plainAcwrStatus(s.zone)}）`;
                      return (
                        <g key={s.date}>
                          <circle cx={cx} cy={cy} r={3} fill="var(--bg)" stroke={s.zone === "danger" ? "var(--red)" : "var(--ink)"} strokeWidth={1.8} />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={10}
                            className={`chart-hit${acwrActiveIdx === idx ? " is-active" : ""}`}
                            tabIndex={0}
                            role="button"
                            aria-label={tip}
                            onClick={() => setAcwrActiveIdx((cur) => (cur === idx ? null : idx))}
                            onFocus={() => setAcwrActiveIdx(idx)}
                          >
                            <title>{tip}</title>
                          </circle>
                        </g>
                      );
                    })}
                    {acwrSeries.length >= 2 ? (
                      <>
                        <text x={acwrPadL} y={acwrHeight - 5} fontSize={11} fill="var(--muted)">
                          {shortDate(acwrSeries[0]!.date)}
                        </text>
                        <text x={acwrWidth - acwrPadR} y={acwrHeight - 5} fontSize={11} textAnchor="end" fill="var(--muted)">
                          {shortDate(acwrSeries.at(-1)!.date)}
                        </text>
                      </>
                    ) : null}
                  </svg>
                ) : (
                  <div className="empty">
                    <strong>暂无负荷数据</strong>
                    <p>连续记录几次训练后就会看到节奏曲线。</p>
                  </div>
                )}
              </div>

              <div className="sci-insight-box">
                <div className="sci-insight-head">
                  <Icon name="bolt" size={15} /> <span>节奏建议</span>
                </div>
                <p>{acwrAdviceText}</p>
              </div>
            </section>

            <section className="panel analytics-panel panel-muscle-dose" id="panel-muscle-dose">
              <header className="panel-head">
                <div>
                  <h2>各部位练到位了吗</h2>
                  <p>每个大肌群每周练 10–20 组最容易长肌肉</p>
                </div>
                <span className="atlas-pill">10–20 组/周最佳</span>
              </header>
              <div className="muscle-dose-list">
                {muscles.audits.map((m) => {
                  const pct = Math.min(100, Math.round((m.sets / 24) * 100));
                  const pillClass =
                    m.category === "optimal" ? "is-sweet" : m.category === "overreaching" ? "is-danger" : "is-deload";
                  return (
                    <div key={m.muscleName} className="muscle-dose-row">
                      <div className="muscle-dose-meta">
                        <span className="muscle-name">{m.muscleName}</span>
                        <span className="muscle-sets">
                          <strong>{m.sets}</strong> 组/周 <small>(近4周均 {fmt(m.avg4WeekSets, 1)})</small>
                        </span>
                        <span className={`kpi-pill ${pillClass}`}>{m.categoryLabel}</span>
                      </div>
                      <div className="muscle-dose-track">
                        <div className="dose-zone-marker opt-start" style={{ left: `${(10 / 24) * 100}%` }} title="最低增肌阈值 10 组" />
                        <div className="dose-zone-marker opt-end" style={{ left: `${(20 / 24) * 100}%` }} title="高容量上限 20 组" />
                        <div className={`muscle-dose-bar ${pillClass}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="muscle-dose-advice">{m.advice}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel analytics-panel panel-monotony" id="panel-monotony">
              <header className="panel-head">
                <div>
                  <h2>练休安排合不合理</h2>
                  <p>轻重日与休息日错开，比每天硬练同样强度更不容易累</p>
                </div>
                <span className="atlas-pill">
                  {monotony.current.monotony < 1.5 ? "有张有弛" : monotony.current.monotony < 2.0 ? "起伏偏平" : "太过单调"}
                </span>
              </header>
              <div className="health-metrics monotony-metrics">
                <div>
                  <span>平均每天练多少</span>
                  <strong>
                    {fmt(monotony.current.meanDailyLoad)} <small>kg/天</small>
                  </strong>
                  <small>起伏幅度 ±{fmt(monotony.current.standardDeviation)}</small>
                </div>
                <div>
                  <span>训练重复度</span>
                  <strong>{fmt(monotony.current.monotony, 2)}</strong>
                  <small>{monotony.current.monotony >= 2.0 ? "≥2.0 太相似易疲劳" : "<1.5 轻重交替好"}</small>
                </div>
                <div>
                  <span>本周总疲劳压</span>
                  <strong>{fmt(monotony.current.trainingStrain)}</strong>
                  <small>
                    较上周 {monotony.current.trainingStrain >= monotony.previous.trainingStrain ? "+" : ""}
                    {fmt(monotony.current.trainingStrain - monotony.previous.trainingStrain)}
                  </small>
                </div>
              </div>
              <div className="sci-insight-box">
                <div className="sci-insight-head">
                  <Icon name="rest" size={15} /> <span>恢复节奏提醒</span>
                </div>
                <p>{monotony.current.monotonyAdvice} 高效练法要有重训日、轻练日和休息日，不要每天练到差不多的疲劳度。</p>
              </div>
            </section>

            <section className="panel analytics-panel panel-inol" id="panel-inol">
              <header className="panel-head">
                <div>
                  <h2>核心大重量动作疲劳度</h2>
                  <p>评估卧推、深蹲、硬拉单次和一周累计压力，防止过度疲劳</p>
                </div>
                <span className="atlas-pill">单次建议 0.4–1.0</span>
              </header>
              {inol.lifts.length ? (
                <div className="inol-grid">
                  {inol.lifts.map((l) => {
                    const badgeClass =
                      l.category === "optimal"
                        ? "is-sweet"
                        : l.category === "brutal"
                          ? "is-danger"
                          : l.category === "tough"
                            ? "is-caution"
                            : "is-deload";
                    return (
                      <div key={l.name} className="inol-card">
                        <div className="inol-top">
                          <div>
                            <strong>{l.name}</strong>
                            <small>
                              估算 1RM: {fmt(l.oneRepMax)} kg · {l.sessionDate ? shortDate(l.sessionDate) : "近期"}
                            </small>
                          </div>
                          <span className={`kpi-pill ${badgeClass}`}>{l.categoryLabel}</span>
                        </div>
                        <div className="inol-scores">
                          <div>
                            <span>单次压力</span>
                            <strong>{fmt(l.sessionInol, 2)}</strong>
                            <small>
                              {l.totalSets} 组 · {l.totalReps} 次
                            </small>
                          </div>
                          <div>
                            <span>这周累计</span>
                            <strong>{fmt(l.weeklyInol, 2)}</strong>
                            <small>
                              {l.weeklyInol >= 4.0 ? "累计偏重了" : l.weeklyInol >= 2.0 ? "刺激很充分" : "还有加练空间"}
                            </small>
                          </div>
                        </div>
                        <p className="inol-advice">{l.advice}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty">
                  <strong>暂无大重量动作记录</strong>
                  <p>完成卧推、深蹲、硬拉等复合动作后会自动评估强度压力。</p>
                </div>
              )}
            </section>

            <section className="panel analytics-panel panel-ipf-gl" id="panel-ipf-gl">
              <header className="panel-head">
                <div>
                  <h2>按体重算，力量排哪一档</h2>
                  <p>按 IPF GL 公式排除体重影响，对比健身与力量训练人群相对力量（世界纪录基准为 100 分）</p>
                </div>
                <span className="atlas-pill">{tierShort}</span>
              </header>
              <div className="ipf-gl-cards">
                <div className="ipf-score-box">
                  <div className="ipf-score-top">
                    <span className="ipf-title">平板卧推得分</span>
                    <span className={`kpi-pill ${ipfGl.bench && ipfGl.bench.score >= 35 ? "is-sweet" : ""}`}>
                      {ipfGl.bench?.tierLabel ?? "需卧推数据"}
                    </span>
                  </div>
                  <div className="ipf-score-val">
                    <strong>{ipfGl.bench ? fmt(ipfGl.bench.score, 1) : "—"}</strong>
                    <span>分</span>
                  </div>
                  <small>
                    推算极限:{" "}
                    {ipfGl.components.bench1RM
                      ? `${fmt(ipfGl.components.bench1RM)} kg (${fmt(ipfGl.components.bench1RM / Math.max(1, userProfile.weightKg), 2)}× 体重)`
                      : "未记录"}{" "}
                    · 体重 {fmt(userProfile.weightKg)} kg
                  </small>
                </div>

                <div className="ipf-score-box">
                  <div className="ipf-score-top">
                    <span className="ipf-title">三大项总分 (SBD)</span>
                    <span className={`kpi-pill ${ipfGl.total && ipfGl.total.score >= 35 ? "is-sweet" : ""}`}>
                      {ipfGl.total?.tierLabel ?? "需深蹲/硬拉数据"}
                    </span>
                  </div>
                  <div className="ipf-score-val">
                    <strong>{ipfGl.total ? fmt(ipfGl.total.score, 1) : "—"}</strong>
                    <span>分</span>
                  </div>
                  <small>
                    卧推 {fmt(ipfGl.components.bench1RM)} + 深蹲 {fmt(ipfGl.components.squat1RM)} +{" "}
                    {ipfGl.components.deadliftSourceName || "硬拉"} {fmt(ipfGl.components.deadlift1RM)} ={" "}
                    {ipfGl.components.total3Lift
                      ? `${fmt(ipfGl.components.total3Lift)} kg (${fmt(ipfGl.components.total3Lift / Math.max(1, userProfile.weightKg), 2)}× 体重)`
                      : "待补齐"}
                  </small>
                </div>
              </div>
              <div className="ipf-standards-strip">
                <div className="ipf-level"><span className="dot" /><b>入门</b>&lt;35 分</div>
                <div className="ipf-level"><span className="dot is-sweet" /><b>扎实</b>35–46 分</div>
                <div className="ipf-level"><span className="dot is-sweet" /><b>进阶</b>47–62 分</div>
                <div className="ipf-level"><span className="dot is-danger" /><b>精英</b>≥63 分</div>
              </div>
            </section>

            <section className="panel analytics-panel panel-nutrition-physio" id="panel-nutrition-physio">
              <header className="panel-head">
                <div>
                  <h2>吃够蛋白了吗 · 体重真实走势</h2>
                  <p>自动排除喝水起伏，看长期减脂增肌节奏稳不稳</p>
                </div>
                <span className="atlas-pill">建议蛋白 ≥1.6 g/kg</span>
              </header>
              <div className="physio-deck">
                <div className="physio-block">
                  <div className="physio-top">
                    <strong>每天蛋白质吃够没</strong>
                    <span className={`kpi-pill ${nutrition.protein.status === "optimal" ? "is-sweet" : "is-caution"}`}>
                      {nutrition.protein.statusLabel}
                    </span>
                  </div>
                  <div className="physio-nums">
                    <div>
                      <span>日均摄入</span>
                      <strong>
                        {fmt(nutrition.protein.averageGramsPerDay)} <small>g/天</small>
                      </strong>
                    </div>
                    <div>
                      <span>每公斤体重</span>
                      <strong>
                        {fmt(nutrition.protein.averageGramsPerKg, 2)} <small>g/kg</small>
                      </strong>
                    </div>
                    <div>
                      <span>达标天数</span>
                      <strong>
                        {nutrition.protein.daysMeetingTarget}{" "}
                        <small>
                          / {nutrition.protein.totalDaysLogged} 天 ({nutrition.protein.complianceRatePct}%)
                        </small>
                      </strong>
                    </div>
                  </div>
                  <p className="physio-advice">{nutrition.protein.advice}</p>
                </div>

                <div className="physio-block">
                  <div className="physio-top">
                    <strong>每周真实体重变化节奏</strong>
                    <span
                      className={`kpi-pill ${
                        bodyweight.report?.category === "optimal_cut" || bodyweight.report?.category === "lean_bulk"
                          ? "is-sweet"
                          : ""
                      }`}
                    >
                      {bodyweight.report?.categoryLabel ?? "数据累积中"}
                    </span>
                  </div>
                  {bodyweight.report ? (
                    <>
                      <div className="physio-nums">
                        <div>
                          <span>周变化率</span>
                          <strong>
                            {bodyweight.report.changeRatePerWeekPct > 0 ? "+" : ""}
                            {fmt(bodyweight.report.changeRatePerWeekPct, 2)}% <small>/周</small>
                          </strong>
                        </div>
                        <div>
                          <span>平均每周</span>
                          <strong>
                            {(bodyweight.report.weeklySlopeKg ?? 0) > 0 ? "+" : ""}
                            {fmt(bodyweight.report.weeklySlopeKg ?? bodyweight.report.deltaKg, 2)} <small>kg</small>
                          </strong>
                        </div>
                        <div>
                          <span>跨度</span>
                          <strong>
                            {fmt(bodyweight.report.weeksSpan, 1)} <small>周</small>
                          </strong>
                        </div>
                      </div>
                      <p className="physio-advice">{bodyweight.report.advice}</p>
                    </>
                  ) : (
                    <div className="empty">
                      <strong>还缺几次称重记录</strong>
                      <p>记满 2 次以上体重后就能自动判断每周增减速度合不合理。</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </>
        ) : null}

        {/* HEALTH SECTION */}
        {activeSection === "health" ? (
          <>
            <section className="panel analytics-panel" id="panel-apple-recovery">
              <header className="panel-head">
                <div>
                  <h2>身体恢复与日常活力</h2>
                  <p>
                    {rec?.hasData || appleDaily?.activityReport?.hasData
                      ? rec?.baselineMode === "personal_baseline"
                        ? "自动对照你最近几天的个人平时水平，看今天疲不疲劳"
                        : rec?.hasData
                          ? "当前先按健康标准区间评估（同步满 3 天后会自动对照个人平时习惯）"
                          : "记录日常步数与步行状态"
                      : "同步静息心率、HRV、血氧、呼吸频率和睡眠后每天帮你看恢复状态"}
                  </p>
                </div>
                {rec?.readinessScore != null ? (
                  <span className={`kpi-pill ${toneClass(rec.readinessTone)}`}>
                    准备度 {rec.readinessScore} 分 · {rec.readinessLabel.split(" · ")[0]}
                  </span>
                ) : (
                  <button type="button" className="quiet" onClick={() => openDeviceSetupModal()}>
                    <Icon name="plus" size={14} /> 生成快捷指令
                  </button>
                )}
              </header>

              {rec?.hasData || appleDaily?.activityReport?.hasData ? (
                <>
                  {rec?.readinessScore != null ? (
                    <div className={`apple-readiness-banner ${toneClass(rec.readinessTone)}`}>
                      <div className="apple-readiness-score">
                        <div className="apple-readiness-matrix">
                          <MatrixText value={String(rec.readinessScore)} />
                        </div>
                        <div>
                          <small>今日身体准备度 / 100</small>
                          <strong>{rec.readinessLabel}</strong>
                        </div>
                      </div>
                      <div className="apple-readiness-meter">
                        <DotMeter
                          ratio={rec.readinessScore / 100}
                          count={10}
                          label={`准备度 ${rec.readinessScore} / 100`}
                        />
                        <small>{rec.readinessScore}% 综合状态</small>
                      </div>
                    </div>
                  ) : null}

                  <div className="apple-signal-grid">
                    {(rec?.signals ?? []).map((s) => {
                      const band = s.rangeBand;
                      const digits =
                        s.key === "hrvMs" ||
                        s.key === "respiratoryRate" ||
                        s.key === "bloodOxygenPct" ||
                        s.key === "sleepMinutes"
                          ? 1
                          : 0;
                      const span = band ? band.max - band.min : 0;
                      const pct = (v: number) => (span > 0 && band ? Math.min(100, Math.max(0, ((v - band.min) / span) * 100)) : 0);
                      return (
                        <div key={s.key} className="apple-signal-card">
                          <div className="apple-signal-top">
                            <span>{s.label}</span>
                            <span className={`kpi-pill ${toneClass(s.tone)}`}>{s.statusLabel}</span>
                          </div>
                          <strong>
                            {fmt(s.value, digits)} {s.unit}
                          </strong>
                          {band && span > 0 ? (
                            <div className="apple-signal-gauge" aria-hidden="true">
                              <div
                                className="apple-gauge-opt"
                                style={{
                                  left: `${pct(band.optMin).toFixed(1)}%`,
                                  width: `${Math.max(4, pct(band.optMax) - pct(band.optMin)).toFixed(1)}%`,
                                }}
                              />
                              <i className={`apple-gauge-pin ${toneClass(s.tone)}`} style={{ left: `${pct(s.value).toFixed(1)}%` }} />
                            </div>
                          ) : null}
                          <small>{s.detail}</small>
                        </div>
                      );
                    })}

                    {rec?.heartRateLatest ? (
                      <div className="apple-signal-card">
                        <div className="apple-signal-top">
                          <span>即时心率</span>
                          <span className="kpi-pill is-sweet">
                            {rec.heartRateLatest.spreadFromRhr != null
                              ? `高于静息 +${fmt(rec.heartRateLatest.spreadFromRhr, 0)} bpm`
                              : shortDate(rec.heartRateLatest.date)}
                          </span>
                        </div>
                        <strong>{fmt(rec.heartRateLatest.value, 0)} bpm</strong>
                        <small>最近采样 {shortDate(rec.heartRateLatest.date)}</small>
                      </div>
                    ) : null}

                    {rec?.vo2MaxLatest ? (
                      <div className="apple-signal-card">
                        <div className="apple-signal-top">
                          <span>最大摄氧量</span>
                          <span className={`kpi-pill ${rec.vo2MaxLatest.value >= 45 ? "is-sweet" : "is-caution"}`}>
                            {rec.vo2MaxLatest.value >= 45 ? "心肺耐力优良" : "心肺基础指标"}
                          </span>
                        </div>
                        <strong>{fmt(rec.vo2MaxLatest.value, 1)}</strong>
                        <small>mL/kg·min · {shortDate(rec.vo2MaxLatest.date)}</small>
                      </div>
                    ) : null}

                    {appleDaily?.activityReport?.hasData ? (
                      <div className="apple-signal-card">
                        <div className="apple-signal-top">
                          <span>日常活动与步行</span>
                          <span
                            className={`kpi-pill ${
                              appleDaily.activityReport.latestSteps != null && appleDaily.activityReport.latestSteps < 300
                                ? "is-caution"
                                : "is-sweet"
                            }`}
                          >
                            {String(appleDaily.activityReport.activityTierLabel ?? "").replace(/\s*\([^)]*\)/, "")}
                          </span>
                        </div>
                        <strong>
                          {[
                            appleDaily.activityReport.latestSteps != null ? `${fmt(appleDaily.activityReport.latestSteps, 0)} 步` : null,
                            appleDaily.activityReport.latestDistanceKm != null
                              ? `${fmt(appleDaily.activityReport.latestDistanceKm, 2)} km`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || `${fmt(appleDaily.activityReport.latestActiveEnergyKcal, 0)} kcal`}
                        </strong>
                        <small>
                          {[
                            appleDaily.activityReport.avgSteps != null ? `均值 ${fmt(appleDaily.activityReport.avgSteps, 0)} 步` : null,
                            appleDaily.activityReport.avgDistanceKm != null ? `${fmt(appleDaily.activityReport.avgDistanceKm, 2)} km` : null,
                            appleDaily.activityReport.strideCm != null ? `步幅 ${fmt(appleDaily.activityReport.strideCm, 0)} cm` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "日常活动基线"}
                        </small>
                      </div>
                    ) : null}
                  </div>

                  <div className="chart-wrap">
                    <div className="apple-chart-subbar">
                      <span>关键体征趋势</span>
                      <div className="segments">
                        {(Object.entries(RECOVERY_CHART_METRICS) as Array<[RecoveryChartKey, { label: string }]>).map(
                          ([k, v]) => (
                            <button
                              key={k}
                              type="button"
                              aria-pressed={recMetricKey === k}
                              onClick={() => setAppleRecoveryChart(k)}
                            >
                              {v.label}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                    <SimpleTrendChart points={recPoints} label={recSpec.label} unit={recSpec.unit} digits={recSpec.digits} />
                  </div>

                  {(() => {
                    const corrInsights = (appleDaily?.correlations ?? []).map(formatHumanCorrelation);
                    const combined = [...(rec?.insights ?? []), ...corrInsights];
                    if (!combined.length) return null;
                    return (
                      <div className="sci-insight-box">
                        <div className="sci-insight-head">
                          <Icon name="heart" size={15} /> <span>自主神经与训练载荷建议</span>
                        </div>
                        <ul className="sci-insight-list">
                          {combined.slice(0, 2).map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                        {combined.length > 2 ? (
                          <details className="sci-sub-drawer is-compact">
                            <summary className="sci-sub-summary">
                              <span>更多生理规律与关联解读（+{combined.length - 2} 条）</span>
                              <small>展开</small>
                            </summary>
                            <div className="sci-sub-body">
                              <ul className="sci-insight-list">
                                {combined.slice(2).map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="empty">
                  <strong>暂未收到心肺恢复样本</strong>
                  <p>通过快捷指令同步静息心率、HRV、血氧或呼吸频率后展示准备度与心肺分析。</p>
                </div>
              )}
            </section>

            <section className="panel analytics-panel" id="panel-apple-body">
              <header className="panel-head">
                <div>
                  <h2>身体成分与热量建议</h2>
                  <p>
                    {body?.hasData
                      ? `${
                          body.heightCm
                            ? `${body.heightSource === "bmi_inferred" ? "按估算身高" : "档案身高"} ${fmt(body.heightCm, 1)} cm · `
                            : ""
                        }看懂你的肌肉量、体脂和每日热量目标`
                      : "同步体重、体脂率、瘦体重、BMI 或腰围后自动算出"}
                  </p>
                </div>
                {body?.hasData ? (
                  <div className="segments">
                    {(Object.entries(BODY_CHART_METRICS) as Array<[BodyChartKey, { label: string }]>).map(([k, v]) => (
                      <button key={k} type="button" aria-pressed={bodyMetricKey === k} onClick={() => setAppleBodyChart(k)}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button type="button" className="quiet" onClick={() => openDeviceSetupModal()}>
                    <Icon name="plus" size={14} /> 生成快捷指令
                  </button>
                )}
              </header>

              {body?.hasData ? (
                <>
                  <div className="health-metrics analytics-apple-grid">
                    {body.weightKg != null ? (
                      <div>
                        <span>体重</span>
                        <strong>{fmt(body.weightKg, 2)} kg</strong>
                        <small>{body.measuredAt?.weightDate ? shortDate(body.measuredAt.weightDate) : "最新"}</small>
                      </div>
                    ) : null}
                    {body.bodyFatPct != null ? (
                      <div>
                        <span>体脂率</span>
                        <strong>{fmt(body.bodyFatPct, 1)}%</strong>
                        <small>{body.fatMassKg != null ? `体脂约 ${fmt(body.fatMassKg, 2)} kg` : "体成分"}</small>
                      </div>
                    ) : null}
                    {body.leanBodyMassKg != null ? (
                      <div>
                        <span>瘦体重</span>
                        <strong>{fmt(body.leanBodyMassKg, 2)} kg</strong>
                        <small>{body.leanSharePct != null ? `占比 ${fmt(body.leanSharePct, 1)}%` : "去脂质量"}</small>
                      </div>
                    ) : null}
                    {body.bmi != null ? (
                      <div>
                        <span>BMI</span>
                        <strong>{fmt(body.bmi, 1)}</strong>
                        <small>{body.bmiStatus?.label ?? "体重指数"}</small>
                      </div>
                    ) : null}
                    {body.ffmi != null ? (
                      <div>
                        <span>肌肉量评级</span>
                        <strong>{body.ffmiStatus?.label ?? "标准"}</strong>
                        <small>综合肌肉指数 {fmt(body.ffmi, 1)}</small>
                      </div>
                    ) : null}
                    {body.waistCm != null ? (
                      <div>
                        <span>腰围状态</span>
                        <strong>{fmt(body.waistCm, 1)} cm</strong>
                        <small>{body.whtrStatus?.label ?? body.waistStatus?.label ?? "腹围"}</small>
                      </div>
                    ) : null}
                  </div>

                  {body.leanSharePct != null && body.bodyFatPct != null ? (
                    <div className="apple-comp-split">
                      <div className="apple-comp-head">
                        <span>
                          <b>瘦体重</b> {fmt(body.leanBodyMassKg, 2)} kg ({fmt(body.leanSharePct, 1)}%)
                        </span>
                        <span>
                          <b>体脂肪</b> {fmt(body.fatMassKg, 2)} kg ({fmt(100 - body.leanSharePct, 1)}%)
                        </span>
                      </div>
                      <div className="apple-comp-bar" role="img" aria-label="瘦体重与体脂肪比例">
                        <i className="comp-lean" style={{ width: `${Math.min(100, Math.max(0, body.leanSharePct))}%` }} />
                        <i className="comp-fat" style={{ width: `${Math.min(100, Math.max(0, 100 - body.leanSharePct))}%` }} />
                      </div>
                    </div>
                  ) : null}

                  {body.metabolic ? (
                    <div className="apple-metabolic-box">
                      <div className="apple-metabolic-head">
                        <strong>每天建议热量与蛋白</strong>
                        <small>
                          按 {fmt(body.leanBodyMassKg, 1)} kg 瘦体重推算
                          {body.metabolic.appleRestingAvgKcal != null
                            ? ` · 手表实测静息 ${fmt(body.metabolic.appleRestingAvgKcal, 0)} kcal`
                            : ""}
                        </small>
                      </div>
                      <div className="apple-metabolic-grid">
                        <div>
                          <span>静息基础消耗</span>
                          <strong>
                            {fmt(body.metabolic.bmrKatchMcArdleKcal, 0)} <small>kcal</small>
                          </strong>
                        </div>
                        <div>
                          <span>每天总消耗</span>
                          <strong>
                            {fmt(body.metabolic.sedentaryTdeeKcal, 0)}–{fmt(body.metabolic.trainingTdeeKcal, 0)}
                          </strong>
                        </div>
                        <div>
                          <span>建议减脂热量</span>
                          <strong>
                            ~{fmt(body.metabolic.recompCutTargetKcal, 0)} <small>kcal</small>
                          </strong>
                        </div>
                        <div>
                          <span>每天蛋白目标</span>
                          <strong>
                            {fmt(body.metabolic.proteinTargetG, 0)} <small>g/天</small>
                          </strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="secondary-button apple-apply-btn"
                        disabled={busyAction === "applyTargets"}
                        onClick={() => void handleApplyAppleTargets()}
                      >
                        <Icon name="check" size={14} /> 一键同步推荐热量与蛋白到饮食目标
                      </button>
                    </div>
                  ) : null}

                  <div className="chart-wrap">
                    <SimpleTrendChart points={bodyPoints} label={bodySpec.label} unit={bodySpec.unit} digits={bodySpec.digits} />
                  </div>

                  {body.recomposition || body.insights?.length ? (
                    <details className="sci-sub-drawer">
                      <summary className="sci-sub-summary">
                        <span>
                          <Icon name="bolt" size={14} /> <strong>体成分详细解读与减脂阶段预估</strong>
                        </span>
                        <small>展开查看</small>
                      </summary>
                      <div className="sci-sub-body">
                        {body.recomposition ? (
                          <div className="apple-metabolic-box apple-recomp-box">
                            <div className="apple-metabolic-head">
                              <strong>保肌减脂路线预估（保持瘦体重不变）</strong>
                              <small>
                                理想腰围 &lt; {fmt(body.recomposition.targetWaistCm, 0)} cm
                                {body.recomposition.waistDeltaCm != null && body.recomposition.waistDeltaCm > 0
                                  ? `（距达标差 ${fmt(body.recomposition.waistDeltaCm, 1)} cm）`
                                  : ""}
                              </small>
                            </div>
                            {body.recomposition.milestones.length ? (
                              <div className="apple-recomp-list">
                                {body.recomposition.milestones.map((m, i) => (
                                  <div key={i}>
                                    <span>{m.label}</span>
                                    <strong>目标体重 {fmt(m.targetWeightKg, 1)} kg</strong>
                                    <small>
                                      减脂 {fmt(m.fatToLoseKg, 1)} kg · 约 {m.estWeeks} 周
                                    </small>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <small className="muted">当前体脂与腰围已处于很理想的区间。</small>
                            )}
                          </div>
                        ) : null}
                        {body.insights?.length ? (
                          <div className="sci-insight-box">
                            <div className="sci-insight-head">
                              <Icon name="bolt" size={15} /> <span>体成分科学洞察</span>
                            </div>
                            <ul className="sci-insight-list">
                              {body.insights.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </>
              ) : (
                <div className="empty">
                  <strong>暂未收到体成分数据</strong>
                  <p>在 Apple 健康同期上传体重、体脂率、瘦体重或腰围即可自动评估 FFMI 与腰高比。</p>
                </div>
              )}
            </section>
          </>
        ) : null}

        {/* REPORTS SECTION */}
        {activeSection === "reports" ? (
          <>
            <section className="panel analytics-panel panel-apple-report" id="panel-apple-report">
              <header className="panel-head">
                <div>
                  <h2>{hasApple ? "Apple 健康 · 运动汇总与每日明细报表" : "训练汇总报表与数据导出"}</h2>
                  <p>
                    {entriesDesc.length || (appleWorkouts?.totalCount ?? 0) > 0 || (data.trainingSummary?.sessions ?? 0) > 0
                      ? `近 ${data.period} 天结构化明细报表 · 支持一键导出 CSV、完整 JSON 档案与打印/存 PDF`
                      : hasApple
                        ? "通过快捷指令同步后自动生成每日体征流水账与运动统计报表"
                        : `近 ${data.period} 天力量训练汇总 · 支持导出 CSV、JSON 与打印/存 PDF`}
                  </p>
                </div>
                <div className="apple-report-actions">
                  <button type="button" className="secondary-button" onClick={handleExportCsv}>
                    <Icon name="download" size={15} /> 导出 CSV
                  </button>
                  <button type="button" className="secondary-button" onClick={handleExportJson}>
                    <Icon name="download" size={15} /> 导出 JSON
                  </button>
                  <button type="button" className="secondary-button" onClick={() => window.print()}>
                    <Icon name="print" size={15} /> 打印 / 存 PDF
                  </button>
                </div>
              </header>

              {entriesDesc.length > 0 ? (
                <div className="apple-report-subblock">
                  <div className="apple-report-subhead">
                    <strong>每日体征与体成分流水明细（共 {entriesDesc.length} 天）</strong>
                    <small>加粗为主指标，下行显示细分数据；含连续日环比波动提示</small>
                  </div>
                  <div className="apple-table-scroll">
                    <table className="apple-ledger-table">
                      <thead>
                        <tr>
                          <th>日期</th>
                          <th>体重与围度</th>
                          <th>去脂与指数</th>
                          <th>心率指标</th>
                          <th>恢复与通气</th>
                          <th>活动与睡眠</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDaily.map((row, idx) => {
                          const prev = entriesDesc[idx + 1] ?? null;
                          return (
                            <tr key={row.date}>
                              <td>
                                <b>{row.date}</b>
                              </td>
                              <td>
                                {row.weightKg != null ? (
                                  <b>
                                    {fmt(row.weightKg, 2)} kg
                                    <DayDeltaTag curr={row.weightKg} prev={prev?.weightKg} digits={2} lowerBetter />
                                  </b>
                                ) : row.bodyFatPct != null ? (
                                  <b>体脂 {fmt(row.bodyFatPct, 1)}%</b>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                                {row.waistCm != null || (row.weightKg != null && row.bodyFatPct != null) ? (
                                  <small className="apple-cell-sub">
                                    {[
                                      row.weightKg != null && row.bodyFatPct != null ? `体脂 ${fmt(row.bodyFatPct, 1)}%` : null,
                                      row.waistCm != null ? `腰围 ${fmt(row.waistCm, 1)} cm` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </small>
                                ) : null}
                              </td>
                              <td>
                                {row.leanBodyMassKg != null ? (
                                  <b>瘦体重 {fmt(row.leanBodyMassKg, 1)} kg</b>
                                ) : row.bmi != null ? (
                                  <b>BMI {fmt(row.bmi, 1)}</b>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                                {row.leanBodyMassKg != null && row.bmi != null ? (
                                  <small className="apple-cell-sub">BMI {fmt(row.bmi, 1)}</small>
                                ) : null}
                              </td>
                              <td>
                                {row.restingHeartRateBpm != null ? (
                                  <b>
                                    静息 {fmt(row.restingHeartRateBpm, 0)} bpm
                                    <DayDeltaTag curr={row.restingHeartRateBpm} prev={prev?.restingHeartRateBpm} digits={0} lowerBetter />
                                  </b>
                                ) : row.heartRateBpm != null ? (
                                  <b>即时 {fmt(row.heartRateBpm, 0)} bpm</b>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                                {row.restingHeartRateBpm != null && row.heartRateBpm != null ? (
                                  <small className="apple-cell-sub">即时 {fmt(row.heartRateBpm, 0)} bpm</small>
                                ) : null}
                              </td>
                              <td>
                                {row.hrvMs != null ? (
                                  <b>
                                    HRV {fmt(row.hrvMs, 1)} ms
                                    <DayDeltaTag curr={row.hrvMs} prev={prev?.hrvMs} digits={1} />
                                  </b>
                                ) : row.bloodOxygenPct != null ? (
                                  <b>血氧 {fmt(row.bloodOxygenPct, 0)}%</b>
                                ) : row.respiratoryRate != null ? (
                                  <b>呼吸 {fmt(row.respiratoryRate, 1)}/分</b>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td>
                                {row.steps != null ? (
                                  <b>
                                    {fmt(row.steps, 0)} 步
                                    {row.distanceKm != null ? ` · ${fmt(row.distanceKm, 2)} km` : ""}
                                  </b>
                                ) : row.sleepMinutes != null ? (
                                  <b>睡眠 {formatSleepMinutes(row.sleepMinutes)}</b>
                                ) : row.activeEnergyKcal != null ? (
                                  <b>活动 {fmt(row.activeEnergyKcal, 0)} kcal</b>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td>
                                <button type="button" className="quiet" onClick={() => openAppleDailyDetailsModal(row)}>
                                  档案 <Icon name="chevron" size={12} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {entriesDesc.length > 10 ? (
                    <div className="apple-table-more">
                      <button type="button" className="quiet" onClick={() => setDailyExpanded((v) => !v)}>
                        {dailyExpanded ? "收起至最近 10 天" : `展开全部 ${entriesDesc.length} 天体征流水`}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {hasApple && (appleWorkouts?.totalCount ?? 0) > 0 ? (
                <div className="apple-report-subblock">
                  <div className="apple-report-subhead">
                    <strong>Apple Watch 运动统计（{appleWorkoutFilter === "device" ? "仅真机" : `近 ${data.period} 天`}）</strong>
                    <div className="apple-report-subctrl">
                      <small>
                        真机 {fmt(realDeviceCount, 0)} 场 · 示例 {fmt(demoCount, 0)} 场 · 关联力量{" "}
                        {fmt(activeWorkoutBucket?.linkedManualCount ?? 0, 0)} 场
                      </small>
                      <div className="segments">
                        <button
                          type="button"
                          aria-pressed={appleWorkoutFilter === "all"}
                          onClick={() => setAppleWorkoutFilter("all")}
                        >
                          全部运动
                        </button>
                        <button
                          type="button"
                          aria-pressed={appleWorkoutFilter === "device"}
                          onClick={() => setAppleWorkoutFilter("device")}
                        >
                          仅真机上传
                        </button>
                      </div>
                    </div>
                  </div>

                  {activeWorkoutBucket && activeWorkoutBucket.totalCount > 0 ? (
                    <>
                      <div className="health-metrics apple-workout-kpis">
                        <div>
                          <span>{appleWorkoutFilter === "device" ? "真机场次" : "累计场次"}</span>
                          <strong>
                            {fmt(activeWorkoutBucket.totalCount, 0)} <small>场</small>
                          </strong>
                        </div>
                        <div>
                          <span>运动总时长</span>
                          <strong>{duration(activeWorkoutBucket.totalDurationSeconds)}</strong>
                        </div>
                        <div>
                          <span>总活动消耗</span>
                          <strong>
                            {activeWorkoutBucket.totalCaloriesKcal ? (
                              <>
                                {fmt(activeWorkoutBucket.totalCaloriesKcal, 0)} <small>kcal</small>
                              </>
                            ) : (
                              "—"
                            )}
                          </strong>
                        </div>
                        <div>
                          <span>累计距离 / 心率</span>
                          <strong>
                            {activeWorkoutBucket.avgBpm ? (
                              <>
                                {fmt(activeWorkoutBucket.avgBpm, 0)} <small>bpm</small>
                              </>
                            ) : activeWorkoutBucket.totalDistanceKm ? (
                              <>
                                {fmt(activeWorkoutBucket.totalDistanceKm, 2)} <small>km</small>
                              </>
                            ) : (
                              "—"
                            )}
                          </strong>
                          {activeWorkoutBucket.maxBpm ? (
                            <small>
                              峰值 {fmt(activeWorkoutBucket.maxBpm, 0)} bpm
                              {activeWorkoutBucket.totalDistanceKm ? ` · ${fmt(activeWorkoutBucket.totalDistanceKm, 2)} km` : ""}
                            </small>
                          ) : null}
                        </div>
                      </div>

                      {onlyShortTriggers ? (
                        <p className="apple-device-tip">
                          当前 {activeWorkoutBucket.totalCount} 条为捷径事件触发记录（未含窗口心率与千卡能耗）；佩戴 Apple Watch 完成完整锻炼或运行「近期训练直传」后，此处将自动呈现心率区间与热量拆分。
                        </p>
                      ) : null}

                      <div className="apple-activity-bars">
                        {activeWorkoutBucket.byActivity.map((act) => {
                          const share = Math.max(
                            8,
                            Math.round((act.durationSeconds / Math.max(1, activeWorkoutBucket.totalDurationSeconds)) * 100),
                          );
                          return (
                            <div key={act.title} className="apple-activity-row">
                              <span>
                                <strong>{act.title}</strong>
                                <small>
                                  {act.count} 场 · {duration(act.durationSeconds)}
                                  {act.caloriesKcal ? ` · ${fmt(act.caloriesKcal, 0)} kcal` : ""}
                                  {act.avgBpm ? ` · 均心率 ${act.avgBpm}` : ""}
                                </small>
                              </span>
                              <div className="apple-activity-track">
                                <i style={{ width: `${share}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {activeWorkoutBucket.hrZones ? (
                        <div className="apple-hr-zones">
                          <div className="apple-hr-zone-head">
                            <span>单场平均心率区间分布（按场次占比）</span>
                            <small>
                              {activeWorkoutBucket.hrZones.hrMaxSource === "tanaka_age" ? "Tanaka 最大心率" : "默认最大心率"}{" "}
                              {activeWorkoutBucket.hrZones.hrMax} bpm · 非实时心率停留时长
                            </small>
                          </div>
                          <div className="apple-hr-zone-bar" role="img" aria-label="单场平均心率区间分布">
                            {activeWorkoutBucket.hrZones.zones
                              .filter((z) => z.pct > 0)
                              .map((z) => (
                                <i key={z.key} className={`hr-${z.key}`} style={{ width: `${z.pct}%` }} title={z.label} />
                              ))}
                          </div>
                          <div className="apple-hr-zone-legend">
                            {activeWorkoutBucket.hrZones.zones
                              .filter((z) => z.count > 0)
                              .map((z) => (
                                <span key={z.key}>
                                  <i className={`hr-${z.key}`} />
                                  {z.label} {z.count} 场（场次 {z.pct}%{z.durationSeconds > 0 ? ` · 共 ${duration(z.durationSeconds)}` : ""}）
                                </span>
                              ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="apple-table-scroll">
                        <table className="apple-ledger-table">
                          <thead>
                            <tr>
                              <th>日期</th>
                              <th>运动类型</th>
                              <th>时长</th>
                              <th>消耗 / 距离</th>
                              <th>平均 / 峰值心率</th>
                              <th>详情</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleWorkouts.map((row) => (
                              <tr key={row.id}>
                                <td>{shortDate(row.date)}</td>
                                <td>
                                  <b>{row.title}</b>{" "}
                                  <span className={`apple-source-tag ${row.isDemo ? "is-demo" : "is-device"}`}>
                                    {row.isDemo ? "示例" : row.captureMethod === "trigger" ? "真机·触发" : "真机"}
                                  </span>
                                </td>
                                <td>{duration(row.durationSeconds)}</td>
                                <td>
                                  {[
                                    row.activeEnergyKcal != null ? `${fmt(row.activeEnergyKcal, 0)} kcal` : null,
                                    row.distanceMeters ? `${fmt(row.distanceMeters / 1000, 2)} km` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "—"}
                                </td>
                                <td>
                                  {row.heartRate?.avgBpm != null
                                    ? `${fmt(row.heartRate.avgBpm, 0)}${row.heartRate?.maxBpm ? ` / ${fmt(row.heartRate.maxBpm, 0)}` : ""} bpm`
                                    : "—"}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="quiet"
                                    onClick={() =>
                                      openAppleWorkoutDetailsModal({
                                        id: row.id,
                                        title: row.title,
                                        date: row.date,
                                        startedAt: `${row.date}T00:00:00Z`,
                                        endedAt: `${row.date}T00:00:00Z`,
                                        durationSeconds: row.durationSeconds,
                                        activeEnergyKcal: row.activeEnergyKcal,
                                        distanceMeters: row.distanceMeters,
                                        heartRate: row.heartRate,
                                      } as AppleWorkoutAgendaItem)
                                    }
                                  >
                                    查看 <Icon name="chevron" size={12} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {filteredWorkouts.length > 8 ? (
                        <div className="apple-table-more">
                          <button type="button" className="quiet" onClick={() => setWorkoutsExpanded((v) => !v)}>
                            {workoutsExpanded ? "收起至最近 8 条" : `展开全部 ${filteredWorkouts.length} 条运动记录`}
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="empty">
                      <strong>近 {data.period} 天暂无真机运动记录</strong>
                      <p>可在快捷指令运行运动上传或切换「全部运动」对照示例记录。</p>
                    </div>
                  )}
                </div>
              ) : null}

              {appleDaily?.weeklyComparison || appleDaily?.coverageSummary ? (
                <details className="sci-sub-drawer">
                  <summary className="sci-sub-summary">
                    <span>
                      <strong>
                        近 7 天生理均值周环比 · 体征维度覆盖矩阵（{appleDaily?.coverageSummary?.syncedCount ?? 0}/
                        {appleDaily?.coverageSummary?.totalCount ?? 22}）
                      </strong>
                    </span>
                    <small>展开核对</small>
                  </summary>
                  <div className="sci-sub-body">
                    {appleDaily?.weeklyComparison?.metrics?.length ? (
                      <div className="apple-report-subblock">
                        <div className="apple-report-subhead">
                          <strong>
                            近 7 天生理均值与周环比（{shortDate(appleDaily.weeklyComparison.recentWindow.from)}–
                            {shortDate(appleDaily.weeklyComparison.recentWindow.through)}）
                          </strong>
                          <small>
                            {appleDaily.weeklyComparison.hasPreviousBaseline
                              ? `对比前 7 天（${appleDaily.weeklyComparison.previousWindow.daysWithData} 天样本）`
                              : "累积跨周（≥8 天）后自动显示周环比涨跌"}
                          </small>
                        </div>
                        <div className="apple-weekly-grid">
                          {appleDaily.weeklyComparison.metrics.map((m) => {
                            const digits = m.key === "weightKg" ? 2 : m.key === "hrvMs" ? 1 : 0;
                            const dText = m.delta != null ? `${m.delta > 0 ? "+" : ""}${fmt(m.delta, digits)} ${m.unit}` : "首周基线";
                            return (
                              <div key={m.key} className="apple-weekly-card">
                                <span>{m.label}</span>
                                <strong>
                                  {m.current != null ? (
                                    <>
                                      {fmt(m.current, digits)} <small>{m.unit}</small>
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </strong>
                                <small>{dText}</small>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {appleDaily?.coverageSummary && appleDaily.coverageSummary.totalCount > 0 ? (
                      <div className="apple-report-subblock">
                        <div className="apple-report-subhead">
                          <strong>
                            体征维度覆盖矩阵（{appleDaily.coverageSummary.syncedCount} / {appleDaily.coverageSummary.totalCount}）
                          </strong>
                          <small>
                            {appleDaily.coverageSummary.missingMetrics?.length
                              ? `还有 ${appleDaily.coverageSummary.missingMetrics.length} 项待同步`
                              : "全部维度均已覆盖"}
                          </small>
                        </div>
                        <div className="apple-cov-grid">
                          {(appleDaily.coverageSummary.categoryProgress ?? []).map((c) => (
                            <div key={c.category} className="apple-cov-cat">
                              <div className="apple-cov-head">
                                <span>{c.category}</span>
                                <strong>
                                  {c.synced}
                                  <small>/{c.total}</small>
                                </strong>
                              </div>
                              <DotMeter
                                ratio={c.synced / Math.max(1, c.total)}
                                count={c.total}
                                label={`${c.category} ${c.synced}/${c.total}`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </section>

            <details className="panel analytics-panel panel-bibliography sci-advanced-drawer" id="panel-bibliography">
              <summary className="sci-drawer-summary">
                <div>
                  <strong>进阶查看 · 底层科学模型参数与 {Object.keys(data.citations).length} 篇文献依据</strong>
                  <small>平时无需关心，展开可核对 EWMA-ACWR、去耦合比、OLS R²、ln(rMSSD) Z-score、t 检验与参考文献</small>
                </div>
                <span className="atlas-pill">展开详情</span>
              </summary>
              <div className="sci-drawer-body">
                <div className="bibliography-list">
                  {Object.values(data.citations).map((cit, i) => (
                    <div key={i} className="biblio-entry">
                      <div className="biblio-meta">
                        <strong>
                          {cit.authors} ({cit.year})
                        </strong>
                        <span className="biblio-journal">{cit.journal}</span>
                      </div>
                      <p className="biblio-title">“{cit.title}”</p>
                      <p className="biblio-takeaway">
                        <Icon name="check" size={14} /> <b>核心结论：</b>
                        {cit.takeaway}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </>
        ) : null}
      </div>
    </>
  );
}
