import { useEffect, useId, useState } from "react";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { DotMeter } from "../components/Meters";
import { SleepReportPanel } from "../components/SleepReportPanel";
import type { AppleDailyEntry, AppleWorkoutAgendaItem } from "../components/apple/AppleHealthModals";
import { formatSleepMinutes } from "../components/apple/AppleHealthModals";
import { downloadClientFile } from "../components/settings/DataModals";
import { ANALYTICS_PERIODS, useAnalytics, type AnalyticsPeriod } from "../hooks/useAnalytics";
import { apiFetch } from "../lib/api";
import { duration, fmt, shortDate, today } from "../lib/date";
import type { EquipmentKey, ProfileGoals, RecordEnvelope, WeightData } from "../lib/domain";
import { openAppleDailyDetailsModal, openAppleWorkoutDetailsModal, openDeviceSetupModal } from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";
import { WORKOUT_PREFS_EVENT, readWorkoutPreferences, writeWorkoutPreference } from "../lib/workout-helpers";

const analyticsSections = [
  ["load", "负荷恢复"],
  ["strength", "肌群力量"],
  ["body", "体态饮食"],
  ["sleep", "睡眠"],
  ["reports", "周期报表"],
] as const;
type AnalyticsSection = typeof analyticsSections[number][0];
type ReportCategory = "all" | "training" | "progress" | "apple";
type BodyChartKey = "weightKg" | "bodyFatPct" | "waistCm";
type RecoveryChartKey = "restingHeartRateBpm" | "hrvMs" | "bloodOxygenPct" | "steps" | "distanceKm" | "activeEnergyKcal";

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

function formatHumanCorrelation(c: { label: string; r: number; sampleDays: number }): string {
  const metrics = c.label.replace(" vs ", "与").replace("HRV 恢复", "HRV");
  return `${metrics}在 ${c.sampleDays} 个配对记录日中呈${c.r > 0 ? "正" : "负"}相关（r = ${c.r}）。`;
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
  const [section, setSection] = useState<AnalyticsSection>("load");
  const [reportCategory, setReportCategory] = useState<ReportCategory>("all");
  const [appleBodyChart, setAppleBodyChart] = useState<BodyChartKey>("weightKg");
  const [appleRecoveryChart, setAppleRecoveryChart] = useState<RecoveryChartKey>("restingHeartRateBpm");
  const [appleWorkoutFilter, setAppleWorkoutFilter] = useState<"all" | "device">("all");
  const [workoutsExpanded, setWorkoutsExpanded] = useState(false);
  const [dailyExpanded, setDailyExpanded] = useState(false);
  const [acwrActiveIdx, setAcwrActiveIdx] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [nutritionChartMetric, setNutritionChartMetric] = useState<"calories" | "protein" | "waterMl">("calories");
  const [deloadMode, setDeloadMode] = useState(() => readWorkoutPreferences().deloadMode);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setDeloadMode(readWorkoutPreferences().deloadMode);
    window.addEventListener(WORKOUT_PREFS_EVENT, sync);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, sync);
  }, []);

  const { data, loading, error } = useAnalytics(period, through, userId, dataEpoch);
  useEffect(() => {
    setAcwrActiveIdx(null);
  }, [userId, period, through, dataEpoch]);

  const controls = (
    <>
      <div className="page-heading masthead-analytics">
        <div>
          <h1>数据分析</h1>
          <p>训练、睡眠、饮食与体重趋势</p>
        </div>
        <div className="period-controls">
          <label aria-label="数据分析截止日期">
            <input
              type="date"
              min="1902-01-01"
              max={data?.today ?? today()}
              value={through}
              onChange={(e) => {
                if (e.target.validity.valid && e.target.value) setThrough(e.target.value);
              }}
            />
          </label>
          <div className="segments">
            {ANALYTICS_PERIODS.map((days) => (
              <button key={days} type="button" aria-pressed={period === days} onClick={() => setPeriod(days)}>
                {days} 天
              </button>
            ))}
          </div>
        </div>
      </div>
      <nav className="analytics-subnav" aria-label="统计分类">
        <div className="segments analytics-section-tabs">
          {analyticsSections.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)}>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );

  if (!data) {
    return (
      <>
        {controls}
        {loading ? (
          <div className="empty loading" role="status">正在加载所选周期的数据…</div>
        ) : (
          <div className="empty" role="alert">
            <strong>数据分析加载失败</strong>
            <p>{error}</p>
            <button type="button" className="primary-button" onClick={bumpDataEpoch}>重试</button>
          </div>
        )}
      </>
    );
  }

  const { acwr, monotony, muscles, inol, ipfGl, nutrition, bodyweight, appleDaily, appleWorkouts, userProfile } = data;
  const hasApple = Boolean(
    appleHealthConnected ||
      appleDaily?.bodyReport?.hasData ||
      appleDaily?.recoveryReport?.hasData ||
      (appleWorkouts?.totalCount ?? 0) > 0,
  );
  const activeSection: AnalyticsSection = section;
  const jumpToSection = (next: AnalyticsSection) => setSection(next);

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
  const { weightKg, appleWeightKg, gender } = userProfile;
  const appleWeightDiff = appleWeightKg != null && weightKg != null && Math.abs(appleWeightKg - weightKg) >= 0.1;
  const needsStrengthProfile = weightKg == null || gender == null;
  const formatLift = (liftKg: number) => `${fmt(liftKg)} kg${weightKg != null ? ` (${fmt(liftKg / weightKg, 2)}× 体重)` : ""}`;

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
      nutrition.protein.complianceRatePct == null
        ? `日均蛋白 ${fmt(nutrition.protein.averageGramsPerDay)} g · 待补体重`
        : nutrition.protein.status === "suboptimal"
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
  if (nutrition.energy?.estimatedTdeeKcal) {
    bodyParts.push(`自适应代谢反推维持热量约 ${fmt(nutrition.energy.estimatedTdeeKcal, 0)} kcal/天`);
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
  } else if (muscles.symmetry?.pushPullStatus === "push_dominant") {
    muscleTip += ` 但推力组（胸肩 ${muscles.symmetry.pushSets} 组）明显多于背部拉力组（${muscles.symmetry.pullSets} 组），建议适当增加划船/下拉平衡肩胛。`;
  }

  const handleAdoptAppleWeight = async () => {
    if (userProfile.appleWeightKg == null || busyAction) return;
    const targetDate = appleDaily?.latestBody?.weightKg?.date ?? data.through ?? today();
    setBusyAction("adoptWeight");
    try {
      const existing = await apiFetch<RecordEnvelope<WeightData>>(
        `/api/web/records/weight/${encodeURIComponent(`weight_${targetDate}`)}?includeDeleted=1`,
      ).catch(() => null);
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
            bodyFat:
              appleDaily?.latestBody?.bodyFatPct?.value ??
              (!existing?.deleted ? existing?.data?.bodyFat : null) ??
              null,
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
    for (const wk of data.weeklyBreakdown ?? []) {
      lines.push(
        [
          "周训练明细",
          `${wk.from}至${wk.through}`,
          `第${wk.weekIndex}周 · ${wk.sessions}场 · ${wk.workSets}组 · ${wk.tonnageKg}kg`,
          "铁记周报",
          ...Array(20).fill(""),
          wk.durationMinutes * 60,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    for (const ex of data.exerciseProgress ?? []) {
      lines.push(
        [
          "动作进步",
          data.through ?? today(),
          `${ex.name} · ${ex.workSets}组 · ${ex.tonnageKg}kg · e1RM ${ex.best1RM}kg (${ex.delta1RM >= 0 ? "+" : ""}${ex.delta1RM}kg)`,
          "铁记力量",
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
      periodComparison: data.periodComparison,
      weeklyBreakdown: data.weeklyBreakdown,
      exerciseProgress: data.exerciseProgress,
      effortSpectrum: data.effortSpectrum,
      symmetry: muscles.symmetry,
      energyNutrition: nutrition.energy,
      appleDaily: data.appleDaily,
      appleWorkouts: data.appleWorkouts,
      sleepReport: data.sleepReport,
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
    activeWorkoutBucket?.avgBpm == null &&
    activeWorkoutBucket?.maxBpm == null &&
    (activeWorkoutBucket?.totalCaloriesKcal ?? 0) === 0 &&
    filteredWorkouts.every((r) => r.captureMethod === "trigger");

  const hasAppleReportData = Boolean(
    hasApple &&
      (entriesDesc.length > 0 ||
        (appleWorkouts?.totalCount ?? 0) > 0 ||
        appleDaily?.weeklyComparison ||
        appleDaily?.coverageSummary),
  );
  const activeReportCategory: ReportCategory = !hasAppleReportData && reportCategory === "apple" ? "all" : reportCategory;
  const showTrainingReport = activeReportCategory === "all" || activeReportCategory === "training";
  const showProgressReport = activeReportCategory === "all" || activeReportCategory === "progress";
  const showAppleReport = hasAppleReportData && (activeReportCategory === "all" || activeReportCategory === "apple");
  const hasTrainingReportBlock = Boolean(data.periodComparison || (data.weeklyBreakdown && data.weeklyBreakdown.length > 0));
  const hasProgressReportBlock = Boolean(data.exerciseProgress && data.exerciseProgress.length > 0);
  const hasVisibleReportBlock =
    (showTrainingReport && hasTrainingReportBlock) ||
    (showProgressReport && hasProgressReportBlock) ||
    showAppleReport;

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
      {controls}
      {error ? (
        <div
          className="panel"
          role="alert"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}
        >
          <span>数据分析刷新失败：{error}</span>
          <button type="button" className="secondary-button" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      ) : null}

      {activeSection !== "sleep" && activeSection !== "reports" ? <>
      <div className="section-bar stats-header analytics-meta-bar">
        <div>
          <h2>近期状态一览</h2>
          <p>
            截至 {shortDate(data.through)} · {weightKg == null ? "暂无体重" : `体重 ${fmt(weightKg, 1)} kg`}
            {gender != null ? `（${gender === "female" ? "女性" : "男性"}）` : ""}
            {appleWeightDiff ? ` · Apple 健康 ${fmt(appleWeightKg, 2)} kg` : ""}
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
        <button
          type="button"
          className={`kpi-card kpi-card-btn ${acwrBadgeClass}${activeSection === "load" ? " is-selected" : ""}`}
          aria-pressed={activeSection === "load"}
          onClick={() => jumpToSection("load")}
        >
          <span className="kpi-label">训练节奏（负荷比）</span>
          <div className="kpi-val-row">
            <strong className="kpi-value">{fmt(currAcwr.acwr, 2)}</strong>
            <span className={`kpi-pill ${acwrBadgeClass}`}>{plainAcwrStatus(currAcwr.zone)}</span>
          </div>
          <span className="kpi-sub">
            近7天 {fmt(currAcwr.acuteLoad)} kg · 平时每周 {fmt(currAcwr.chronicLoad)} kg
          </span>
        </button>

        {readinessScore != null && rec ? (
          <button
            type="button"
            className={`kpi-card kpi-card-btn ${readinessToneClass}${activeSection === "load" ? " is-selected" : ""}`}
            aria-pressed={activeSection === "load"}
            onClick={() => jumpToSection("load")}
          >
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
          </button>
        ) : (
          <button
            type="button"
            className={`kpi-card kpi-card-btn ${
              bodyweight.report?.category === "optimal_cut" || bodyweight.report?.category === "lean_bulk"
                ? "is-sweet"
                : bodyweight.report?.category === "rapid_loss" || bodyweight.report?.category === "rapid_gain"
                  ? "is-caution"
                  : ""
            }${activeSection === "body" ? " is-selected" : ""}`}
            aria-pressed={activeSection === "body"}
            onClick={() => jumpToSection("body")}
          >
            <span className="kpi-label">体态与代谢</span>
            <div className="kpi-val-row">
              <strong className="kpi-value">
                {bodyweight.report ? (
                  <>
                    {(bodyweight.report.weeklySlopeKg ?? 0) > 0 ? "+" : ""}
                    {fmt(bodyweight.report.weeklySlopeKg ?? bodyweight.report.deltaKg, 2)} <small>kg/周</small>
                  </>
                ) : nutrition.protein.totalDaysLogged > 0 ? (
                  <>
                    {nutrition.protein.averageGramsPerKg != null
                      ? <>{fmt(nutrition.protein.averageGramsPerKg, 2)} <small>g/kg</small></>
                      : <>{fmt(nutrition.protein.averageGramsPerDay)} <small>g/天</small></>}
                  </>
                ) : (
                  "—"
                )}
              </strong>
              <span
                className={`kpi-pill ${
                  bodyweight.report?.category === "optimal_cut" || bodyweight.report?.category === "lean_bulk"
                    ? "is-sweet"
                    : nutrition.protein.status === "optimal" || nutrition.protein.status === "high"
                      ? "is-sweet"
                      : ""
                }`}
              >
                {(
                  bodyweight.report?.categoryLabel ??
                  (nutrition.protein.totalDaysLogged > 0 ? nutrition.protein.statusLabel : "待记录")
                ).replace(/\s*\([^)]*\)/, "")}
              </span>
            </div>
            <span className="kpi-sub">
              {nutrition.protein.totalDaysLogged > 0
                ? `日均蛋白 ${fmt(nutrition.protein.averageGramsPerDay)} g${nutrition.protein.complianceRatePct != null ? ` · 达标 ${nutrition.protein.complianceRatePct}%` : ""}`
                : "记饮食与称重后追踪代谢走势"}
            </span>
          </button>
        )}

        <button
          type="button"
          className={`kpi-card kpi-card-btn is-sweet${activeSection === "strength" ? " is-selected" : ""}`}
          aria-pressed={activeSection === "strength"}
          onClick={() => jumpToSection("strength")}
        >
          <span className="kpi-label">肌群练到位</span>
          <div className="kpi-val-row">
            <strong className="kpi-value">
              {optMuscles} <small>/ 6 部位</small>
            </strong>
            <span className="kpi-pill is-sweet">{optMuscles >= 4 ? "分布均衡" : "部分偏少"}</span>
          </div>
          <span className="kpi-sub">建议每个部位每周 10–20 组</span>
        </button>

        <button
          type="button"
          className={`kpi-card kpi-card-btn${activeSection === "strength" ? " is-selected" : ""}`}
          aria-pressed={activeSection === "strength"}
          onClick={() => jumpToSection("strength")}
        >
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
                : needsStrengthProfile
                  ? "按体重和性别资料计算"
                  : "完成深蹲/卧推/硬拉后评估"}
          </span>
        </button>
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
      </> : null}

      <div className="analytics-deck">
        {activeSection === "sleep" ? (
          <>
            {data.sleepReport ? (
              <SleepReportPanel key={`${userId}:${data.sleepReport.current.from}:${data.sleepReport.current.through}`} report={data.sleepReport} />
            ) : (
              <div className="empty" role="status">
                <strong>后台版本暂未提供睡眠报表</strong>
                <p>更新后台后即可读取报表。</p>
                <button type="button" className="quiet" onClick={bumpDataEpoch}>重试</button>
              </div>
            )}
            {data.sleepTrainingImpact && data.sleepTrainingImpact.pairedDays > 0 ? (
              <section className="panel analytics-panel panel-sleep-training" id="panel-sleep-training">
                <header className="panel-head">
                  <div>
                    <h2>睡眠时长 × 次日训练表现</h2>
                    <p>对照不同睡眠时长下当天的训练组数、总吨位与疲惫体感（已配对 {data.sleepTrainingImpact.pairedDays} 天）</p>
                  </div>
                  <span className="atlas-pill">{data.sleepTrainingImpact.pairedDays} 个配对日</span>
                </header>
                <div className="sleep-impact-grid">
                  {(
                    [
                      ["充沛睡眠 (≥7h)", data.sleepTrainingImpact.goodSleep, "is-sweet"],
                      ["中等睡眠 (6–<7h)", data.sleepTrainingImpact.midSleep, ""],
                      ["睡眠偏少 (<6h)", data.sleepTrainingImpact.shortSleep, "is-caution"],
                    ] as const
                  ).map(([label, b, tone]) => (
                    <div key={label} className={`sleep-impact-card ${tone}`}>
                      <span className="sleep-impact-label">{label}</span>
                      <strong>
                        {b.days} <small>个训练日</small>
                      </strong>
                      <div className="sleep-impact-meta">
                        <span>均组数：{b.avgWorkSets != null ? `${fmt(b.avgWorkSets, 1)} 组` : "—"}</span>
                        <span>均吨位：{b.avgTonnageKg != null ? `${fmt(b.avgTonnageKg, 0)} kg` : "—"}</span>
                        <span>疲惫感：{b.fatiguedPct != null ? `${b.fatiguedPct}%` : "—"}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {data.sleepTrainingImpact.insight ? (
                  <p className="physio-advice">{data.sleepTrainingImpact.insight}</p>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}

        {/* LOAD & RECOVERY SECTION */}
        {activeSection === "load" ? (
          <>
            <section className="panel analytics-panel panel-acwr" id="panel-acwr">
              <header className="panel-head">
                <div>
                  <h2>最近训练量是否过载</h2>
                  <p>把近 7 天训练量和平时 1 个月对比，预防练太猛受伤</p>
                </div>
                <div className="acwr-head-actions">
                  {(currAcwr.zone === "danger" || currAcwr.zone === "caution" || deloadMode) ? (
                    <button
                      type="button"
                      className={deloadMode ? "secondary-button is-deload-on" : "secondary-button"}
                      onClick={() => {
                        const next = !deloadMode;
                        writeWorkoutPreference("deloadMode", next);
                        setDeloadMode(next);
                        notify(next ? "已开启减载周模式，开练将自动缩放重量与组数" : "已关闭减载周模式");
                      }}
                    >
                      {deloadMode ? "减载周已开启 · 关闭" : "一键开启减载周"}
                    </button>
                  ) : null}
                  <span className="atlas-pill">
                    {plainAcwrStatus(currAcwr.zone)} ({fmt(currAcwr.acwr, 2)})
                  </span>
                </div>
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
                {acwr.referenceWeightKg != null ? (
                  <p>缺少体重记录，徒手或辅助动作的负荷按 {acwr.referenceWeightKg} kg 参考体重估算。</p>
                ) : null}
              </div>
            </section>

            <section className="panel analytics-panel panel-monotony" id="panel-monotony">
              <header className="panel-head">
                <div>
                  <h2>练休起伏 · 次数与力竭强度谱</h2>
                  <p>轻重交替安排恢复日，并监测 1–5 / 6–12 / 13+ 次数分布与 RIR 逼近力竭质量</p>
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
              {data.effortSpectrum && data.effortSpectrum.totalWorkSets > 0 ? (
                <div className="sci-spectrum-box">
                  <div className="sci-spectrum-head">
                    <strong>近 {data.period} 天次数区间分布（有效组 {data.effortSpectrum.totalWorkSets} 组）</strong>
                    {data.effortSpectrum.rirDistribution.avgRir != null ? (
                      <small>均 RIR {data.effortSpectrum.rirDistribution.avgRir}</small>
                    ) : null}
                  </div>
                  <div className="sci-stack-bar" role="img" aria-label="次数区间比例">
                    {data.effortSpectrum.repZones.strength.pct > 0 ? (
                      <i
                        className="rep-str"
                        style={{ width: `${data.effortSpectrum.repZones.strength.pct}%` }}
                        title={`1-5次 绝对力量 ${data.effortSpectrum.repZones.strength.sets} 组`}
                      />
                    ) : null}
                    {data.effortSpectrum.repZones.hypertrophy.pct > 0 ? (
                      <i
                        className="rep-hyp"
                        style={{ width: `${data.effortSpectrum.repZones.hypertrophy.pct}%` }}
                        title={`6-12次 肌肥大 ${data.effortSpectrum.repZones.hypertrophy.sets} 组`}
                      />
                    ) : null}
                    {data.effortSpectrum.repZones.metabolic.pct > 0 ? (
                      <i
                        className="rep-met"
                        style={{ width: `${data.effortSpectrum.repZones.metabolic.pct}%` }}
                        title={`13+次 代谢耐力 ${data.effortSpectrum.repZones.metabolic.sets} 组`}
                      />
                    ) : null}
                  </div>
                  <div className="sci-spectrum-legend">
                    <span><i className="rep-str" /> 1–5次 力量 {data.effortSpectrum.repZones.strength.pct}% ({data.effortSpectrum.repZones.strength.sets}组)</span>
                    <span><i className="rep-hyp" /> 6–12次 增肌 {data.effortSpectrum.repZones.hypertrophy.pct}% ({data.effortSpectrum.repZones.hypertrophy.sets}组)</span>
                    <span><i className="rep-met" /> 13+次 耐力 {data.effortSpectrum.repZones.metabolic.pct}% ({data.effortSpectrum.repZones.metabolic.sets}组)</span>
                  </div>
                  {data.effortSpectrum.rirDistribution.loggedCount > 0 ? (
                    <div className="sci-rir-row">
                      <span>RIR 逼近力竭 ({data.effortSpectrum.rirDistribution.loggedCount} 组已记)</span>
                      <small>
                        RIR 0–1 力竭 {data.effortSpectrum.rirDistribution.nearFailure.pct}% ·
                        RIR 2–3 最佳 {data.effortSpectrum.rirDistribution.optimal.pct}% ·
                        RIR 4+ 轻松 {data.effortSpectrum.rirDistribution.reserveHigh.pct}%
                      </small>
                    </div>
                  ) : null}
                  <p className="muscle-dose-advice">{data.effortSpectrum.advice}</p>
                </div>
              ) : null}
              <div className="sci-insight-box">
                <div className="sci-insight-head">
                  <Icon name="rest" size={15} /> <span>恢复节奏提醒</span>
                </div>
                <p>{monotony.current.monotonyAdvice} 高效练法要有重训日、轻练日和休息日，不要每天练到差不多的疲劳度。</p>
              </div>
            </section>

            {hasApple ? (
              <section className="panel analytics-panel panel-apple-recovery" id="panel-apple-recovery">
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
            ) : null}

              {data.planAdherence ? (
                <section className="panel analytics-panel panel-plan-adherence" id="panel-plan-adherence">
                  <header className="panel-head">
                    <div>
                      <h2>计划执行率与缺练追踪</h2>
                      <p>
                        {data.planAdherence.hasPlan
                          ? `对照「${data.planAdherence.planName}」(${shortDate(data.planAdherence.from)}–${shortDate(data.planAdherence.through)}) 排期兑现情况`
                          : "启用训练计划后自动统计实际完成率与各分部缺练情况"}
                      </p>
                    </div>
                    {data.planAdherence.adherencePct != null ? (
                      <span className={`atlas-pill${data.planAdherence.adherencePct >= 80 ? " is-sweet" : ""}`}>
                        兑现率 {data.planAdherence.adherencePct}%
                      </span>
                    ) : null}
                  </header>
                  {data.planAdherence.hasPlan && data.planAdherence.scheduledSessions > 0 ? (
                    <>
                      <div className="adherence-grid">
                        <div>
                          <span>计划应练</span>
                          <strong>{data.planAdherence.scheduledSessions} 场</strong>
                        </div>
                        <div>
                          <span>实际完成</span>
                          <strong>{data.planAdherence.completedSessions} 场</strong>
                        </div>
                        <div>
                          <span>已过期未完成</span>
                          <strong>{data.planAdherence.missedSessions} 场</strong>
                          {data.planAdherence.pendingSessions ? <small>待完成 {data.planAdherence.pendingSessions} 场</small> : null}
                        </div>
                        <div>
                          <span>完成率</span>
                          <strong>{data.planAdherence.adherencePct == null ? "—" : `${data.planAdherence.adherencePct}%`}</strong>
                        </div>
                      </div>
                      {data.planAdherence.adherencePct != null ? (
                        <div className="who-cardio-bar" role="progressbar" aria-label="计划完成率" aria-valuenow={data.planAdherence.adherencePct} aria-valuemin={0} aria-valuemax={100}>
                          <i style={{ width: `${data.planAdherence.adherencePct}%` }} />
                        </div>
                      ) : null}
                      {data.planAdherence.byRoutine.length > 0 ? (
                        <div className="apple-table-scroll">
                          <table className="apple-ledger-table">
                            <thead>
                              <tr>
                                <th>分化 / 课表</th>
                                <th>应练</th>
                                <th>已完成</th>
                                <th>完成率</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.planAdherence.byRoutine.map((r) => (
                                <tr key={r.key ?? r.name}>
                                  <td><b>{r.name}</b></td>
                                  <td>{r.scheduled} 场</td>
                                  <td>{r.completed} 场</td>
                                  <td>
                                    {r.adherencePct == null ? "待完成" : (
                                      <span className={`kpi-pill ${r.adherencePct >= 80 ? "is-sweet" : r.adherencePct >= 50 ? "is-caution" : "is-danger"}`}>
                                        {r.adherencePct}%
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="empty">
                      <strong>暂无可评估的排期窗口</strong>
                      <p>在「计划」页选用方案并完成训练后，系统会统计每个训练日的兑现率。</p>
                    </div>
                  )}
                </section>
              ) : null}

              {appleWorkouts?.whoCardio && appleWorkouts.totalCount > 0 ? (
                <section className="panel analytics-panel panel-who-cardio" id="panel-who-cardio">
                  <header className="panel-head">
                    <div>
                      <h2>WHO 每周有氧达标与配速走势</h2>
                      <p>按近 7 天中等强度 + 2×高强度换算，推荐每周 ≥ 150 分钟有氧当量</p>
                    </div>
                    <span className={`atlas-pill${appleWorkouts.whoCardio.completionPct >= 100 ? " is-sweet" : ""}`}>
                      {appleWorkouts.whoCardio.equivalentMinutes} / {appleWorkouts.whoCardio.targetMinutes} 分 ({appleWorkouts.whoCardio.completionPct}%)
                    </span>
                  </header>
                  <div className="adherence-grid">
                    <div>
                      <span>中等强度</span>
                      <strong>{appleWorkouts.whoCardio.moderateMinutes} 分</strong>
                    </div>
                    <div>
                      <span>高强度 (≥80% HRmax)</span>
                      <strong>{appleWorkouts.whoCardio.vigorousMinutes} 分</strong>
                    </div>
                    <div>
                      <span>折算有氧当量</span>
                      <strong>{appleWorkouts.whoCardio.equivalentMinutes} 分</strong>
                    </div>
                  </div>
                  <div className="who-cardio-bar" role="progressbar" aria-valuenow={appleWorkouts.whoCardio.completionPct} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${appleWorkouts.whoCardio.completionPct}%` }} />
                  </div>
                  {appleWorkouts.paceTrend && appleWorkouts.paceTrend.length >= 2 ? (
                    <SimpleTrendChart
                      points={appleWorkouts.paceTrend.map((p) => ({ date: p.date, value: p.paceMinPerKm }))}
                      label="平均配速"
                      unit="min/km"
                      digits={2}
                    />
                  ) : null}
                </section>
              ) : null}
          </>
        ) : null}

        {/* STRENGTH & MUSCLE SECTION */}
        {activeSection === "strength" ? (
          <>
            <section className="panel analytics-panel panel-muscle-dose" id="panel-muscle-dose">
              <header className="panel-head">
                <div>
                  <h2>各部位练到位了吗 · 频次与推拉比</h2>
                  <p>每周 10–20 组、频次 ≥2 次/周最易增肌，推拉比 0.7–1.35 更护肩</p>
                </div>
                <span className="atlas-pill">10–20 组/周最佳</span>
              </header>
              {muscles.symmetry && (muscles.symmetry.pushSets > 0 || muscles.symmetry.pullSets > 0) ? (
                <div className="sci-symmetry-strip">
                  <div>
                    <span>推 / 拉比例</span>
                    <strong>
                      {muscles.symmetry.pushPullRatio != null ? `${fmt(muscles.symmetry.pushPullRatio, 2)} : 1` : "—"}
                    </strong>
                    <small>
                      推 {muscles.symmetry.pushSets} · 拉 {muscles.symmetry.pullSets} 组
                    </small>
                  </div>
                  <div>
                    <span>上 / 下肢比</span>
                    <strong>
                      {muscles.symmetry.upperLowerRatio != null ? `${fmt(muscles.symmetry.upperLowerRatio, 2)} : 1` : "—"}
                    </strong>
                    <small>
                      上 {muscles.symmetry.upperSets} · 下 {muscles.symmetry.lowerSets} 组
                    </small>
                  </div>
                  <div className="sci-symmetry-badge-col">
                    <span
                      className={`kpi-pill ${
                        muscles.symmetry.pushPullStatus === "balanced"
                          ? "is-sweet"
                          : muscles.symmetry.pushPullStatus === "push_dominant"
                            ? "is-caution"
                            : ""
                      }`}
                    >
                      {muscles.symmetry.pushPullLabel}
                    </span>
                    <small>{muscles.symmetry.advice}</small>
                  </div>
                </div>
              ) : null}
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
                          <strong>{m.sets}</strong> 组/周{" "}
                          <small>
                            (4周均 {fmt(m.avg4WeekSets, 1)} · {fmt(m.freqPerWeek ?? 0, 1)}x/周)
                          </small>
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
                  <h2>相对力量参考分</h2>
                  <p>标准平板杠铃卧推、深蹲和硬拉的估算 1RM，按 IPF GL 公式换算参考分。</p>
                </div>
                <span className="atlas-pill">{tierShort}</span>
              </header>
              <div className="ipf-gl-cards">
                <div className="ipf-score-box">
                  <div className="ipf-score-top">
                    <span className="ipf-title">平板卧推得分</span>
                    <span className={`kpi-pill ${ipfGl.bench && ipfGl.bench.score >= 35 ? "is-sweet" : ""}`}>
                      {ipfGl.bench?.tierLabel ?? (ipfGl.components.bench1RM && needsStrengthProfile ? "待补体重或性别" : "需卧推数据")}
                    </span>
                  </div>
                  <div className="ipf-score-val">
                    <strong>{ipfGl.bench ? fmt(ipfGl.bench.score, 1) : "—"}</strong>
                    <span>分</span>
                  </div>
                  <small>
                    推算极限:{" "}
                    {ipfGl.components.bench1RM
                      ? formatLift(ipfGl.components.bench1RM)
                      : "未记录"}{" "}
                    {weightKg != null ? ` · 体重 ${fmt(weightKg)} kg` : ""}
                  </small>
                </div>

                <div className="ipf-score-box">
                  <div className="ipf-score-top">
                    <span className="ipf-title">三大项总分 (SBD)</span>
                    <span className={`kpi-pill ${ipfGl.total && ipfGl.total.score >= 35 ? "is-sweet" : ""}`}>
                      {ipfGl.total?.tierLabel ?? (ipfGl.components.total3Lift && needsStrengthProfile ? "待补体重或性别" : "需三项训练数据")}
                    </span>
                  </div>
                  <div className="ipf-score-val">
                    <strong>{ipfGl.total ? fmt(ipfGl.total.score, 1) : "—"}</strong>
                    <span>分</span>
                  </div>
                  <small>
                    卧推 {fmt(ipfGl.components.bench1RM)} + 深蹲 {fmt(ipfGl.components.squat1RM)} +{" "}
                    硬拉 {fmt(ipfGl.components.deadlift1RM)} ={" "}
                    {ipfGl.components.total3Lift
                      ? formatLift(ipfGl.components.total3Lift)
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

            {data.plateaus ? (
              <section className="panel analytics-panel panel-plateaus" id="panel-plateaus">
                <header className="panel-head">
                  <div>
                    <h2>动作平台期与退步预警</h2>
                    <p>追踪近 3 次推算 1RM 停滞或回落的动作，及时介入微调组数/次数</p>
                  </div>
                  <span className={`atlas-pill${data.plateaus.length === 0 ? " is-sweet" : ""}`}>
                    {data.plateaus.length ? `${data.plateaus.length} 项提醒` : "全线推进中"}
                  </span>
                </header>
                {data.plateaus.length > 0 ? (
                  <div className="plateau-list">
                    {data.plateaus.map((item) => (
                      <div key={item.id} className="plateau-item">
                        <div className="plateau-top">
                          <div>
                            <strong>{item.name}</strong>
                            <small>
                              近 3 次 1RM：{fmt(item.baseline1RM, 1)} → {fmt(item.latest1RM, 1)} kg · 最近 {shortDate(item.lastDate)}
                            </small>
                          </div>
                          <span className={`kpi-pill ${item.status === "regression" ? "is-danger" : "is-caution"}`}>
                            {item.status === "regression" ? "略回落" : "平台期"} ({item.deltaPct > 0 ? "+" : ""}
                            {item.deltaPct}%)
                          </span>
                        </div>
                        <p className="muscle-dose-advice">{item.advice}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="apple-baseline-note">
                    <Icon name="trending" size={15} />
                    <span>当前高频训练动作近 3 次均保持稳步推进或刚进入周期，暂未触发平台期预警。</span>
                  </div>
                )}
              </section>
            ) : null}

            {data.repMaxBoard && data.repMaxBoard.length > 0 ? (
              <section className="panel analytics-panel panel-rep-max" id="panel-rep-max">
                <header className="panel-head">
                  <div>
                    <h2>Rep-Max 个人纪录矩阵 (1 / 3 / 5 / 8 / 10RM)</h2>
                    <p>按真实完成过的最高重量统计，不依赖公式反推（含负重引体/双杠自重叠加）</p>
                  </div>
                  <span className="atlas-pill">{data.repMaxBoard.length} 个主打动作</span>
                </header>
                <div className="apple-table-scroll">
                  <table className="apple-ledger-table rep-max-table">
                    <thead>
                      <tr>
                        <th>动作</th>
                        <th>1RM</th>
                        <th>3RM</th>
                        <th>5RM</th>
                        <th>8RM</th>
                        <th>10RM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.repMaxBoard.map((row) => (
                        <tr key={row.id}>
                          <td><b>{row.name}</b></td>
                          {(["rm1", "rm3", "rm5", "rm8", "rm10"] as const).map((k) => {
                            const hit = row[k];
                            return (
                              <td key={k}>
                                {hit ? (
                                  <span title={`${hit.weight}kg × ${hit.reps} (${hit.date})`}>
                                    <b>{fmt(hit.weight, 1)} kg</b>
                                    <small className="apple-cell-sub">{shortDate(hit.date)}</small>
                                  </span>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {/* BODY & NUTRITION SECTION */}
        {activeSection === "body" ? (
          <>
            <section className="panel analytics-panel panel-nutrition-physio" id="panel-nutrition-physio">
              <header className="panel-head">
                <div>
                  <h2>饮食、体重与能量估算</h2>
                  <p>用完整饮食记录和同期体重变化估算维持热量。</p>
                </div>
                <span className="atlas-pill">建议蛋白 ≥1.6 g/kg</span>
              </header>
              <div className="physio-deck">
                <div className="physio-block">
                  <div className="physio-top">
                    <strong>每天蛋白质吃够没</strong>
                    <span className={`kpi-pill ${nutrition.protein.status === "optimal" || nutrition.protein.status === "high" ? "is-sweet" : "is-caution"}`}>
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
                        {nutrition.protein.averageGramsPerKg != null
                          ? <>{fmt(nutrition.protein.averageGramsPerKg, 2)} <small>g/kg</small></>
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>达标天数</span>
                      <strong>
                        {nutrition.protein.daysMeetingTarget != null ? (
                          <>{nutrition.protein.daysMeetingTarget}{" "}
                            <small>/ {nutrition.protein.totalDaysLogged} 天 ({nutrition.protein.complianceRatePct}%)</small>
                          </>
                        ) : "—"}
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

                {nutrition.energy && nutrition.energy.daysLogged > 0 ? (
                  <div className="physio-block physio-energy-wide">
                    <div className="physio-top">
                      <strong>摄入与维持热量</strong>
                      {nutrition.energy.estimatedTdeeKcal != null ? (
                        <span className="kpi-pill is-sweet">
                          推算维持 {fmt(nutrition.energy.estimatedTdeeKcal, 0)} kcal
                        </span>
                      ) : <span className="kpi-pill">维持热量资料不足</span>}
                    </div>
                    <div className="physio-nums">
                      <div>
                        <span>日均已记录摄入</span>
                        <strong>
                          {fmt(nutrition.energy.avgCalories, 0)} <small>kcal</small>
                        </strong>
                        <small>目标 {fmt(nutrition.energy.calorieTarget, 0)} kcal</small>
                      </div>
                      <div>
                        <span>训练日 / 休息日</span>
                        <strong>
                          {nutrition.energy.trainingDayAvgKcal != null ? fmt(nutrition.energy.trainingDayAvgKcal, 0) : "—"}
                          {" / "}
                          {nutrition.energy.restDayAvgKcal != null ? fmt(nutrition.energy.restDayAvgKcal, 0) : "—"}
                        </strong>
                        <small>日均千卡对照</small>
                      </div>
                      <div>
                        <span>三大营养素均量</span>
                        <strong>
                          {nutrition.energy.avgCarbs}/{nutrition.energy.avgProtein}/{nutrition.energy.avgFat}
                        </strong>
                        <small>碳/蛋/脂 (克/天)</small>
                      </div>
                    </div>
                    <div className="sci-stack-bar" role="img" aria-label="三大营养素热量比例">
                      <i className="rep-hyp" style={{ width: `${nutrition.energy.macroPct.protein}%` }} title={`蛋白 ${nutrition.energy.macroPct.protein}%`} />
                      <i className="rep-str" style={{ width: `${nutrition.energy.macroPct.carbs}%` }} title={`碳水 ${nutrition.energy.macroPct.carbs}%`} />
                      <i className="rep-met" style={{ width: `${nutrition.energy.macroPct.fat}%` }} title={`脂肪 ${nutrition.energy.macroPct.fat}%`} />
                    </div>
                    <div className="sci-spectrum-legend">
                      <span><i className="rep-hyp" /> 蛋白 {nutrition.energy.macroPct.protein}%</span>
                      <span><i className="rep-str" /> 碳水 {nutrition.energy.macroPct.carbs}%</span>
                      <span><i className="rep-met" /> 脂肪 {nutrition.energy.macroPct.fat}%</span>
                    </div>
                    <p className="physio-advice">{nutrition.energy.energyAdvice}</p>
                    {nutrition.energy.tdeeBasis ? (
                      <p className="physio-advice">
                        {shortDate(nutrition.energy.tdeeBasis.from)}–{shortDate(nutrition.energy.tdeeBasis.through)}
                        {" · "}{nutrition.energy.tdeeBasis.completeDays} 天完整饮食
                        {" · "}{nutrition.energy.tdeeBasis.weightSamples} 次称重
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            {nutrition.dailySeries && nutrition.dailySeries.length > 0 ? (
              <section className="panel analytics-panel panel-nutrition-daily" id="panel-nutrition-daily">
                <header className="panel-head">
                  <div>
                    <h2>逐日饮食摄入与饮水走势</h2>
                    <p>随当前统计窗口（{data.period} 天）联动展示每日热量、蛋白与饮水完成度</p>
                  </div>
                  <div className="segments">
                    {(
                      [
                        ["calories", "热量 kcal"],
                        ["protein", "蛋白 g"],
                        ["waterMl", "饮水 ml"],
                      ] as const
                    ).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={nutritionChartMetric === k}
                        onClick={() => setNutritionChartMetric(k)}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </header>
                {(() => {
                  const pts = nutrition.dailySeries
                    .filter((d) => {
                      if (nutritionChartMetric === "calories") return d.calories > 0;
                      if (nutritionChartMetric === "protein") return d.protein > 0;
                      return typeof d.waterMl === "number" && d.waterMl > 0;
                    })
                    .map((d) => ({
                      date: d.date,
                      value:
                        nutritionChartMetric === "calories"
                          ? d.calories
                          : nutritionChartMetric === "protein"
                            ? d.protein
                            : (d.waterMl ?? 0),
                    }));
                  const spec =
                    nutritionChartMetric === "calories"
                      ? { label: "每日热量", unit: "kcal", digits: 0 }
                      : nutritionChartMetric === "protein"
                        ? { label: "每日蛋白", unit: "g", digits: 1 }
                        : { label: "每日饮水", unit: "ml", digits: 0 };
                  return pts.length >= 2 ? (
                    <SimpleTrendChart points={pts} label={spec.label} unit={spec.unit} digits={spec.digits} />
                  ) : (
                    <div className="apple-baseline-note">
                      <Icon name="diet" size={14} />
                      <span>在所选周期内记录至少 2 天{spec.label}后自动绘制趋势曲线。</span>
                    </div>
                  );
                })()}
                {nutrition.hydration ? (
                  <div className="adherence-grid" style={{ marginTop: 12 }}>
                    <div>
                      <span>日均饮水</span>
                      <strong>{nutrition.hydration.loggedDays > 0 ? `${fmt(nutrition.hydration.averageMl, 0)} ml` : "—"}</strong>
                    </div>
                    <div>
                      <span>饮水记录天数</span>
                      <strong>{nutrition.hydration.loggedDays} / {nutrition.hydration.totalDays} 天</strong>
                    </div>
                    <div>
                      <span>达标 ≥ {nutrition.hydration.targetMl} ml</span>
                      <strong>{nutrition.hydration.daysMeetingTarget} 天 ({nutrition.hydration.complianceRatePct}%)</strong>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {data.bodyMeasurements && (data.bodyMeasurements.count > 0 || data.bodyMeasurements.recompSignal) ? (
              <section className="panel analytics-panel panel-body-measurements" id="panel-body-measurements">
                <header className="panel-head">
                  <div>
                    <h2>自建围度档案与减脂保肌信号</h2>
                    <p>
                      {data.bodyMeasurements.latestDate
                        ? `最近围度更新：${shortDate(data.bodyMeasurements.latestDate)} · 对照体重与推算力量判断身体重塑走向`
                        : "结合体重走势与主项力量变化判断减脂保肌或干净增肌状态"}
                    </p>
                  </div>
                  {data.bodyMeasurements.recompSignal ? (
                    <span
                      className={`atlas-pill${
                        data.bodyMeasurements.recompSignal.status === "optimal" ? " is-sweet" : ""
                      }`}
                    >
                      {data.bodyMeasurements.recompSignal.label}
                    </span>
                  ) : null}
                </header>
                {data.bodyMeasurements.count > 0 ? (
                  <div className="measurement-kpi-grid">
                    {(
                      [
                        ["腰围", data.bodyMeasurements.latest.waistCm, data.bodyMeasurements.deltas.waistCm],
                        ["胸围", data.bodyMeasurements.latest.chestCm, data.bodyMeasurements.deltas.chestCm],
                        ["臂围", data.bodyMeasurements.latest.armCm, data.bodyMeasurements.deltas.armCm],
                        ["腿围", data.bodyMeasurements.latest.thighCm, data.bodyMeasurements.deltas.thighCm],
                        ["臀围", data.bodyMeasurements.latest.hipCm, data.bodyMeasurements.deltas.hipCm],
                      ] as const
                    ).map(([lbl, val, delta]) =>
                      val != null ? (
                        <div key={lbl} className="measurement-kpi-item">
                          <span>{lbl}</span>
                          <strong>{fmt(val, 1)} cm</strong>
                          {delta != null && delta !== 0 ? (
                            <small>
                              变化 {delta > 0 ? "+" : ""}
                              {fmt(delta, 1)} cm
                            </small>
                          ) : null}
                        </div>
                      ) : null,
                    )}
                    {data.bodyMeasurements.whtr != null ? (
                      <div className="measurement-kpi-item">
                        <span>腰身高比 WHtR</span>
                        <strong>{fmt(data.bodyMeasurements.whtr, 2)}</strong>
                        <small>{data.bodyMeasurements.whtr < 0.5 ? "健康范围 (<0.50)" : "偏高 (建议 <0.50)"}</small>
                      </div>
                    ) : null}
                    {data.bodyMeasurements.whr != null ? (
                      <div className="measurement-kpi-item">
                        <span>腰臀比 WHR</span>
                        <strong>{fmt(data.bodyMeasurements.whr, 2)}</strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {data.bodyMeasurements.recompSignal ? (
                  <p className="physio-advice">{data.bodyMeasurements.recompSignal.detail}</p>
                ) : null}
              </section>
            ) : null}

            {hasApple ? (
              <section className="panel analytics-panel panel-apple-body" id="panel-apple-body">
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
            ) : null}
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

              <div className="report-cat-bar" role="group" aria-label="报表子类别">
                {(
                  [
                    ["all", "全部报表"],
                    ["training", "周期周报"],
                    ["progress", "动作进步"],
                    ...(hasAppleReportData ? ([["apple", "Apple 明细"]] as const) : []),
                  ] as ReadonlyArray<readonly [ReportCategory, string]>
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={activeReportCategory === k}
                    onClick={() => setReportCategory(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {showTrainingReport && data.periodComparison ? (
                <div className="apple-report-subblock">
                  <div className="apple-report-subhead">
                    <strong>周期对照 · {data.period} 天</strong>
                    {data.periodComparison.currentRange && data.periodComparison.previousRange ? (
                      <small>
                        本期 {shortDate(data.periodComparison.currentRange.from)}–{shortDate(data.periodComparison.currentRange.through)}
                        {" · 上期 "}{shortDate(data.periodComparison.previousRange.from)}–{shortDate(data.periodComparison.previousRange.through)}
                      </small>
                    ) : null}
                  </div>
                  <div className="health-metrics apple-workout-kpis">
                    <div>
                      <span>训练场次 / 活跃天</span>
                      <strong>
                        {fmt(data.periodComparison.current.sessions, 0)} 场{" "}
                        <small>({data.periodComparison.current.activeDays} 天)</small>
                      </strong>
                      <small>
                        上期 {data.periodComparison.previous.sessions} 场
                        {data.periodComparison.deltas.sessionsPct != null
                          ? ` (${data.periodComparison.deltas.sessionsPct >= 0 ? "+" : ""}${data.periodComparison.deltas.sessionsPct}%)`
                          : ""}
                      </small>
                    </div>
                    <div>
                      <span>有效工作组</span>
                      <strong>
                        {fmt(data.periodComparison.current.workSets, 0)} <small>组</small>
                      </strong>
                      <small>
                        上期 {data.periodComparison.previous.workSets} 组
                        {data.periodComparison.deltas.workSetsPct != null
                          ? ` (${data.periodComparison.deltas.workSetsPct >= 0 ? "+" : ""}${data.periodComparison.deltas.workSetsPct}%)`
                          : ""}
                      </small>
                    </div>
                    <div>
                      <span>力量总容量</span>
                      <strong>
                        {fmt(data.periodComparison.current.tonnageKg, 0)} <small>kg</small>
                      </strong>
                      <small>
                        上期 {fmt(data.periodComparison.previous.tonnageKg, 0)} kg
                        {data.periodComparison.deltas.tonnagePct != null
                          ? ` (${data.periodComparison.deltas.tonnagePct >= 0 ? "+" : ""}${data.periodComparison.deltas.tonnagePct}%)`
                          : ""}
                      </small>
                    </div>
                    <div>
                      <span>累计训练时长</span>
                      <strong>
                        {fmt(data.periodComparison.current.durationMinutes, 0)} <small>分</small>
                      </strong>
                      <small>上期 {fmt(data.periodComparison.previous.durationMinutes, 0)} 分</small>
                    </div>
                    <div>
                      <span>饮食记录覆盖</span>
                      <strong>
                        {data.periodComparison.current.dietDaysLogged} <small>/ {data.period} 天</small>
                      </strong>
                      <small>
                        上期 {data.periodComparison.previous.dietDaysLogged} / {data.period} 天
                      </small>
                    </div>
                  </div>
                </div>
              ) : null}

              {showTrainingReport && data.weeklyBreakdown && data.weeklyBreakdown.length > 0 ? (
                <div className="apple-report-subblock">
                  <div className="apple-report-subhead">
                    <strong>按周训练节奏与负荷分解（共 {data.weeklyBreakdown.length} 周）</strong>
                    <small>统计每周有效组、高强度逼近组（RIR ≤2 / 力竭）与真实容量走势</small>
                  </div>
                  <div className="apple-table-scroll">
                    <table className="apple-ledger-table">
                      <thead>
                        <tr>
                          <th>周期</th>
                          <th>场次 / 活跃天</th>
                          <th>有效组 (高强度)</th>
                          <th>力量总容量</th>
                          <th>训练时长</th>
                          <th>综合负荷</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.weeklyBreakdown.map((wk) => (
                          <tr key={wk.weekIndex}>
                            <td>
                              <b>第 {wk.weekIndex} 周</b>
                              <small className="apple-cell-sub">
                                {shortDate(wk.from)}–{shortDate(wk.through)}
                              </small>
                            </td>
                            <td>
                              <b>{wk.sessions} 场</b>
                              <small className="apple-cell-sub">{wk.activeDays} 个训练日</small>
                            </td>
                            <td>
                              <b>{wk.workSets} 组</b>
                              {wk.hardSets > 0 ? <small className="apple-cell-sub">高强 {wk.hardSets} 组</small> : null}
                            </td>
                            <td>
                              <b>{fmt(wk.tonnageKg, 0)} kg</b>
                            </td>
                            <td>{wk.durationMinutes ? `${wk.durationMinutes} 分钟` : "—"}</td>
                            <td>{fmt(wk.load, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {showProgressReport && data.exerciseProgress && data.exerciseProgress.length > 0 ? (
                <div className="apple-report-subblock">
                  <div className="apple-report-subhead">
                    <strong>核心动作进步追踪榜（Top {data.exerciseProgress.length}）</strong>
                    <small>对照本周期首次与最近一次估算 1RM 变化</small>
                  </div>
                  <div className="apple-table-scroll">
                    <table className="apple-ledger-table">
                      <thead>
                        <tr>
                          <th>动作名称</th>
                          <th>练过场次</th>
                          <th>有效组</th>
                          <th>周期容量</th>
                          <th>估算 1RM (初 → 末)</th>
                          <th>周期变化</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.exerciseProgress.map((ex) => (
                          <tr key={ex.id}>
                            <td>
                              <b>{ex.name}</b>
                            </td>
                            <td>{ex.sessions} 场</td>
                            <td>{ex.workSets} 组</td>
                            <td>{ex.tonnageKg > 0 ? `${fmt(ex.tonnageKg, 0)} kg` : "—"}</td>
                            <td>
                              {ex.best1RM > 0 ? (
                                <b>
                                  {fmt(ex.first1RM, 1)} → {fmt(ex.last1RM, 1)} kg
                                  <small className="apple-cell-sub">峰值 {fmt(ex.best1RM, 1)} kg</small>
                                </b>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              {ex.best1RM > 0 && ex.sessions >= 2 && ex.delta1RM !== 0 ? (
                                <span className={`kpi-pill ${ex.delta1RM > 0 ? "is-sweet" : "is-caution"}`}>
                                  {ex.delta1RM > 0 ? "+" : ""}
                                  {fmt(ex.delta1RM, 1)} kg
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {showAppleReport && entriesDesc.length > 0 ? (
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

              {showAppleReport && hasApple && (appleWorkouts?.totalCount ?? 0) > 0 ? (
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
                              Tanaka 估算最大心率 {activeWorkoutBucket.hrZones.hrMax} bpm · 每场按平均值归类
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
                      ) : activeWorkoutBucket.avgBpm != null ? (
                        <p>已记录平均心率。年龄资料在 18–81 岁范围内时可查看估算区间。</p>
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
                                        ...(row.startedAt ? { startedAt: row.startedAt } : {}),
                                        ...(row.endedAt ? { endedAt: row.endedAt } : {}),
                                        manualWorkoutId: row.manualWorkoutId,
                                        durationKind: row.durationKind,
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

              {showAppleReport && (appleDaily?.weeklyComparison || appleDaily?.coverageSummary) ? (
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

              {!hasVisibleReportBlock ? (
                <div className="empty">
                  <strong>当前区间暂无该类别报表记录</strong>
                  <p>可切换「全部报表」、调整上方周期范围，或先完成训练与体征同步。</p>
                </div>
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
