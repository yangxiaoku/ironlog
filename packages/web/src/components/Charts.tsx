import { useEffect, useId, useMemo, useState } from "react";
import { duration, fmt, shortDate } from "../lib/date";
import { MUSCLES, type LoadMetricKey, type MuscleKey, type OverviewStatsResponse } from "../lib/domain";
import { Icon } from "./Icon";
import { ThinMeter } from "./Meters";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;
const MUSCLE_PARTS: MuscleKey[] = ["chest", "back", "legs", "shoulders", "arms", "core"];

const METRIC_LABELS: Record<LoadMetricKey, string> = {
  volume: "训练容量",
  sets: "完成组数",
  workouts: "训练次数",
  seconds: "训练时长",
};

const METRIC_TABS: Array<{ key: LoadMetricKey; label: string }> = [
  { key: "volume", label: "容量" },
  { key: "sets", label: "组数" },
  { key: "workouts", label: "次数" },
  { key: "seconds", label: "时长" },
];

function useCompactViewport(): boolean {
  const query = "(max-width: 630px)";
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    setCompact(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setCompact(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return compact;
}

function computeYScale(values: number[], zeroMin: boolean) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) {
    return { low: 0, high: 2, ticks: [0, 1, 2] };
  }
  const max = Math.max(...finite);
  const min = zeroMin ? 0 : Math.min(...finite);
  const spread = Math.max(zeroMin ? 1 : Math.max(Math.abs(max) * 0.015, 0.2), max - min);
  const stepTarget = spread / 3;
  const stepUnit = 10 ** Math.floor(Math.log10(stepTarget));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * stepUnit).find((sz) => sz >= stepTarget) ?? 10 * stepUnit;
  const low = zeroMin ? 0 : Math.floor((min - spread * 0.07) / step) * step;
  const high = Math.max(low + step * 2, Math.ceil((max + spread * 0.05) / step) * step);
  const tickCount = Math.round((high - low) / step) + 1;
  const ticks = Array.from({ length: tickCount }, (_, i) => low + i * step);
  return { low, high, ticks };
}

export function MiniSparkline({ values }: { values: number[] }) {
  const pts = values.filter(Number.isFinite).slice(-8);
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = Math.max(0.2, max - min);
  const x0 = 6;
  const x1 = 114;
  const y0 = 6;
  const y1 = 28;
  const coords = pts.map((val, i) => [
    x0 + (i / (pts.length - 1)) * (x1 - x0),
    y1 - ((val - min) / span) * (y1 - y0),
  ] as const);

  return (
    <svg className="mini-spark" viewBox="0 0 120 34" aria-hidden="true">
      <polyline
        points={coords.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={1.4}
        strokeDasharray="2 3"
        strokeLinecap="round"
      />
      {coords.map(([px, py], i) =>
        i === coords.length - 1 ? (
          <circle key={i} cx={px.toFixed(1)} cy={py.toFixed(1)} r={2.8} fill="var(--ink)" />
        ) : (
          <circle
            key={i}
            cx={px.toFixed(1)}
            cy={py.toFixed(1)}
            r={2.5}
            fill="var(--bg)"
            stroke="var(--ink)"
            strokeWidth={1.6}
          />
        ),
      )}
    </svg>
  );
}

export function WeekStrip({
  activity,
  todayKey,
  selectedDate = "",
  onSelectDate,
}: {
  activity: Array<{ date: string; active: boolean }>;
  todayKey: string;
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}) {
  const activeSet = new Set((activity ?? []).filter((c) => c.active).map((c) => c.date));
  const anchor = new Date(`${todayKey}T00:00:00Z`);
  const weekday = (anchor.getUTCDay() + 6) % 7;

  const days = WEEK_LABELS.map((label, i) => {
    const iso = new Date(anchor.getTime() + (i - weekday) * 86_400_000).toISOString().slice(0, 10);
    return {
      label,
      iso,
      active: activeSet.has(iso),
      isToday: iso === todayKey,
      isFuture: iso > todayKey,
    };
  });

  const doneCount = days.filter((d) => d.active).length;

  return (
    <div className="hero-week" aria-label="本周训练打卡与排期">
      <div className="hero-week-head">
        <span>本周节律</span>
        <b>{doneCount} / 7 天</b>
      </div>
      <div className="hero-week-days">
        {days.map(({ label, iso, active, isToday, isFuture }) => {
          const cls = ["week-pill", active ? "is-active" : "", isToday ? "is-today" : "", isFuture ? "is-future" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={iso}
              type="button"
              className={cls}
              aria-pressed={selectedDate === iso}
              aria-label={`${iso}${active ? " 已训练" : ""}`}
              onClick={() => onSelectDate?.(selectedDate === iso ? "" : iso)}
            >
              <span>{label}</span>
              <b>{Number(iso.slice(8))}</b>
              <i />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LoadChart({
  data,
  metric,
  onMetricChange,
}: {
  data: OverviewStatsResponse;
  metric: LoadMetricKey;
  onMetricChange: (next: LoadMetricKey) => void;
}) {
  const patternId = useId().replace(/:/g, "");
  const [readout, setReadout] = useState("");
  const compact = useCompactViewport();
  const width = compact ? 344 : 660;
  const height = 252;
  const left = 48;
  const right = 14;
  const top = 12;
  const bottom = 32;
  const innerW = width - left - right;
  const innerH = height - top - bottom;

  const rows = data.daily;
  const series = useMemo(() => {
    const valueOf = (row: OverviewStatsResponse["daily"][number]) =>
      metric === "seconds" ? row.seconds / 60 : metric === "workouts" ? row.workouts + (row.addedApple ?? 0) : row[metric];
    if (data.period <= 30) return rows.map((r) => ({ date: r.date, value: valueOf(r), complete: r.complete }));
    const size = data.period > 90 ? 14 : 7;
    const groups: Array<{ date: string; value: number; complete?: boolean }> = [];
    for (let i = 0; i < rows.length; i += size) {
      const slice = rows.slice(i, i + size);
      groups.push({
        date: slice[0]?.date ?? "",
        value: slice.reduce((sum, item) => sum + valueOf(item), 0),
      });
    }
    return groups;
  }, [rows, data.period, metric]);

  const workoutCount = data.totals.activities ?? data.totals.workouts;
  const hasAny = (metric === "workouts" ? workoutCount : data.totals.workouts) > 0;
  const totalValue = metric === "workouts" ? workoutCount : data.totals[metric];
  const loadUnit = metric === "volume" ? "kg" : metric === "sets" ? "组" : metric === "workouts" ? "次" : "分钟";
  const loadPeak = useMemo(
    () => series.reduce((best, item) => (item.value > best.value ? item : best), { date: "", value: 0 }),
    [series],
  );
  const loadAverage =
    metric === "volume"
      ? data.totals.workouts
        ? `${fmt(data.totals.volume / data.totals.workouts, 0)} kg`
        : "—"
      : metric === "sets"
        ? data.totals.workouts
          ? `${fmt(data.totals.sets / data.totals.workouts, 1)} 组`
          : "—"
        : metric === "workouts"
          ? `周均 ${fmt(workoutCount / Math.max(1, data.period / 7), 1)} 次`
          : duration(data.totals.timedWorkouts ? Math.round(data.totals.seconds / data.totals.timedWorkouts) : null);

  const loadPrev = metric === "workouts" ? (data.previous.activities ?? data.previous.workouts) : data.previous[metric];
  const loadDelta = totalValue - loadPrev;
  const loadDeltaText =
    !loadPrev && !totalValue
      ? "暂无上期对比"
      : loadDelta === 0
        ? "与上期持平"
        : metric === "seconds"
          ? `较上期 ${loadDelta > 0 ? "+" : "-"}${duration(Math.abs(loadDelta))}`
          : `较上期 ${loadDelta > 0 ? "+" : ""}${fmt(loadDelta, 0)} ${metric === "volume" ? "kg" : metric === "sets" ? "组" : "次"}`;

  const activeDays =
    data.totals.activeDays ??
    (data.activity ?? []).slice(-84).filter((c) => c.date >= data.from && c.date <= data.through && c.active).length;

  const scale = useMemo(() => {
    const known = series.map((r) => r.value).filter(Number.isFinite);
    return known.length ? computeYScale(known, true) : null;
  }, [series]);
  const y = (v: number) => (scale ? top + ((scale.high - v) / (scale.high - scale.low)) * innerH : top);
  const count = Math.max(1, series.length);
  const labelIndices = [...new Set([0, Math.floor((count - 1) / 3), Math.floor((2 * (count - 1)) / 3), count - 1])].filter(
    (i) => i >= 0 && i < series.length,
  );
  const colW = innerW / count;
  const barW = Math.min(24, Math.max(3, colW * 0.6));
  const rx = Math.min(7, barW / 2);
  const latestIdx = useMemo(() => series.findLastIndex((row) => row.value > 0), [series]);
  const baseY = y(0);

  return (
    <section className="panel panel-load" id="panel-load">
      <header className="panel-head">
        <div>
          <h2>训练趋势</h2>
        </div>
        <div className="segments">
          {METRIC_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={metric === tab.key}
              onClick={() => {
                setReadout("");
                onMetricChange(tab.key);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="chart-wrap">
        <div className="chart-readout-line">
          <span className="chart-readout is-summary">
            {readout ||
              (metric === "seconds"
                ? `日均 ${duration(Math.round(data.totals.seconds / Math.max(1, data.period)))}`
                : `日均 ${fmt(totalValue / Math.max(1, data.period), metric === "volume" ? 0 : 1)} ${loadUnit}`)}
          </span>
        </div>

        {hasAny && scale ? (
          <svg
            className="chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={METRIC_LABELS[metric]}
            onMouseLeave={() => setReadout("")}
          >
            <defs>
              <pattern id={`stipple-${patternId}`} width={4} height={4} patternUnits="userSpaceOnUse">
                <circle cx={2} cy={2} r={0.95} fill="var(--soft)" opacity={0.65} />
              </pattern>
            </defs>

            {scale.ticks.map((tick) => (
              <g key={tick}>
                <line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} className="gridline" />
                <text x={left - 8} y={y(tick) + 4} textAnchor="end">
                  {fmt(tick, 2)}
                </text>
              </g>
            ))}

            {labelIndices.map((idx) => {
              const row = series[idx]!;
              const cx = left + (innerW * (idx + 0.5)) / count;
              return (
                <text key={idx} x={cx} y={height - 8} textAnchor="middle">
                  {shortDate(row.date)}
                </text>
              );
            })}

            {series.map((row, idx) => {
              const val = row.value;
              const cx = left + (innerW * (idx + 0.5)) / count;
              if (!Number.isFinite(val) || val <= 0) {
                if (count <= 31) {
                  const restH = Math.min(18, innerH);
                  return (
                    <rect
                      key={row.date}
                      x={cx - barW / 2}
                      y={baseY - restH}
                      width={barW}
                      height={restH}
                      rx={Math.min(rx, restH / 2)}
                      className="bar-rest"
                      style={{ fill: `url(#stipple-${patternId})` }}
                    />
                  );
                }
                return null;
              }
              const topY = y(val);
              const barH = Math.max(4, baseY - topY);
              const cls = `bars${row.complete === false ? " partial" : ""}${idx === latestIdx ? " bar-latest" : ""}`;
              const tip = `${shortDate(row.date)} · ${fmt(val, 1)} ${loadUnit}`;
              return (
                <g key={row.date}>
                  <rect
                    x={cx - barW / 2}
                    y={baseY - barH}
                    width={barW}
                    height={barH}
                    rx={Math.min(rx, barH / 2)}
                    className={cls}
                    style={row.complete === false ? { fill: `url(#stipple-${patternId})` } : undefined}
                  />
                  {idx === latestIdx ? (
                    <circle cx={cx} cy={Math.max(top + 3, topY - 7)} r={2.8} className="bar-latest-dot" />
                  ) : null}
                  <rect
                    x={cx - Math.max(barW, 12) / 2}
                    y={top}
                    width={Math.max(barW, 12)}
                    height={innerH}
                    className="chart-hit"
                    tabIndex={0}
                    role="button"
                    aria-label={tip}
                    onMouseEnter={() => setReadout(tip)}
                    onFocus={() => setReadout(tip)}
                    onClick={() => setReadout(tip)}
                  >
                    <title>{tip}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="empty">
            <strong>还没有训练记录</strong>
            <p>记录一次训练后，这里会显示趋势。</p>
          </div>
        )}
      </div>

      {hasAny ? (
        <>
          <div className="health-metrics load-metrics">
            <div>
              <span>{metric === "workouts" ? "训练频率" : "场均表现"}</span>
              <strong>{loadAverage}</strong>
            </div>
            <div>
              <span>{data.period > 90 ? "双周峰值" : data.period > 30 ? "单周峰值" : "单日峰值"}</span>
              <strong>
                {metric === "seconds" ? (
                  duration(Math.round(loadPeak.value * 60))
                ) : (
                  <>
                    {fmt(loadPeak.value, 0)} <small>{loadUnit}</small>
                  </>
                )}
              </strong>
              {loadPeak.date ? <small>{shortDate(loadPeak.date)}</small> : null}
            </div>
            <div>
              <span>训练天数</span>
              <strong>
                {fmt(activeDays)} <small>/ {data.period} 天</small>
              </strong>
            </div>
          </div>

          <footer className="panel-foot">
            <div className="legend">
              <span>
                <i className="neutral" />
                {data.period > 90 ? "双周累计" : data.period > 30 ? "每周累计" : "每日"}
              </span>
              <span>
                <i className="red" />
                最近一次
              </span>
            </div>
            <span className={`load-delta${loadDelta > 0 ? " is-gain" : ""}`}>{loadDeltaText}</span>
          </footer>
        </>
      ) : null}
    </section>
  );
}

export function MuscleDistributionCard({
  data,
  mode,
  selectedMuscle,
  onModeChange,
  onSelectMuscle,
}: {
  data: OverviewStatsResponse;
  mode: "volume" | "recovery" | "recency";
  selectedMuscle: MuscleKey | "";
  onModeChange: (next: "volume" | "recovery" | "recency") => void;
  onSelectMuscle: (key: MuscleKey | "") => void;
}) {
  const [hoverMuscle, setHoverMuscle] = useState<MuscleKey | "">("");
  const setsByPart = useMemo(() => new Map(data.muscles.map((item) => [item.key, item.sets])), [data.muscles]);
  const statusList = data.muscleStatus ?? [];
  const statusByPart = useMemo(() => new Map(statusList.map((item) => [item.key, item])), [statusList]);

  const anatomical = useMemo(
    () =>
      MUSCLE_PARTS.map((part) => ({
        key: part,
        name: MUSCLES[part],
        sets: setsByPart.get(part) ?? 0,
      })).sort((a, b) => b.sets - a.sets),
    [setsByPart],
  );

  const maxMuscle = useMemo(() => Math.max(1, ...anatomical.map((item) => item.sets)), [anatomical]);
  const totalMuscleSets = useMemo(() => anatomical.reduce((sum, item) => sum + item.sets, 0), [anatomical]);
  const focusTarget = hoverMuscle || selectedMuscle;

  const pillText = (() => {
    if (!focusTarget) return "";
    const count = setsByPart.get(focusTarget) ?? 0;
    const share = totalMuscleSets ? Math.round((count / totalMuscleSets) * 100) : 0;
    const st = statusByPart.get(focusTarget);
    if (mode === "recovery" && st) return `${MUSCLES[focusTarget]} · 恢复 ${st.recoveryPct}% (${st.statusLabel})`;
    if (mode === "recency" && st) {
      const gap = st.daysSinceLast == null ? "久未练" : st.daysSinceLast === 0 ? "今天刚练" : `${st.daysSinceLast} 天前`;
      return `${MUSCLES[focusTarget]} · ${gap} · 近7天 ${fmt(st.recent7dSets)} 组`;
    }
    return `${MUSCLES[focusTarget]} · ${fmt(count)} 组 (${share}%)`;
  })();

  const idleHint =
    mode === "recovery"
      ? "红疲劳 · 黄恢复中 · 绿已就绪"
      : mode === "recency"
        ? "点击部位查看训练间隔"
        : totalMuscleSets > 0
          ? `点击部位 · 共 ${fmt(totalMuscleSets)} 组`
          : "记录训练后查看部位分布";

  return (
    <section className="panel panel-muscle" id="panel-muscle">
      <header className="panel-head">
        <div>
          <h2>肌群分布</h2>
        </div>
        <div className="atlas-head-controls">
          <div className="segments">
            {(
              [
                ["volume", "容量"],
                ["recovery", "恢复度"],
                ["recency", "间隔"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={mode === k}
                onClick={() => onModeChange(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="atlas-readout-bar">
        <span className="atlas-pill" hidden={!pillText}>
          {pillText}
        </span>
        <span className="atlas-hint" hidden={Boolean(pillText)}>
          {idleHint}
        </span>
        <button
          className="quiet atlas-clear-btn"
          type="button"
          hidden={!selectedMuscle}
          onClick={() => onSelectMuscle("")}
        >
          全部
        </button>
      </div>

      <div className="atlas-stage">
        <div className="atlas-wrap">
          <img
            className="atlas-base"
            src="/app/atlas-neutral.png"
            width={600}
            height={540}
            alt="人体正面和背面肌群分布"
          />
          {MUSCLE_PARTS.map((part) => {
            const count = setsByPart.get(part) ?? 0;
            const st = statusByPart.get(part);
            let tone = "";
            let heat = count > 0 ? (0.38 + 0.6 * (count / maxMuscle)).toFixed(2) : "0";
            let hot = count > 0;
            if (mode === "recovery" && st) {
              tone = st.status;
              heat = (
                st.status === "fatigued"
                  ? Math.max(0.58, st.fatiguePct / 100)
                  : st.status === "recovering"
                    ? Math.max(0.44, st.fatiguePct / 100)
                    : st.status === "ready"
                      ? 0.28
                      : 0.2
              ).toFixed(2);
              hot = true;
            } else if (mode === "recency" && st) {
              const days = st.daysSinceLast;
              tone = days == null || days >= 10 ? "detrained" : days >= 7 ? "recovering" : "ready";
              heat = days == null ? "0.72" : days >= 10 ? "0.68" : days >= 7 ? "0.52" : days >= 3 ? "0.34" : "0.24";
              hot = true;
            }
            const isSelected = focusTarget === part;
            const isDimmed = Boolean(focusTarget && focusTarget !== part);
            const cls = [
              "atlas-layer",
              mode === "volume" ? (hot ? "is-hot" : "is-cold") : "is-toned",
              isSelected ? "is-selected" : "",
              isDimmed ? "is-dimmed" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <span
                key={part}
                className={cls}
                data-muscle={part}
                data-tone={tone || undefined}
                style={{ "--mask": `url(/app/atlas-${part}.png)`, "--heat": heat } as React.CSSProperties}
                aria-label={MUSCLES[part]}
              />
            );
          })}
        </div>
        <div className="atlas-views" aria-hidden="true">
          <span>正面</span>
          <span>背面</span>
        </div>
      </div>

      <div className="muscle-bars">
        {mode === "recovery" && statusList.length ? (
          [...statusList]
            .sort((a, b) => a.recoveryPct - b.recoveryPct)
            .map((st) => {
              const isSelected = selectedMuscle === st.key;
              const isDimmed = Boolean(selectedMuscle && !isSelected);
              return (
                <button
                  key={st.key}
                  type="button"
                  className={`muscle-line${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}`}
                  data-tone={st.status}
                  aria-pressed={isSelected}
                  onMouseEnter={() => setHoverMuscle(st.key)}
                  onMouseLeave={() => setHoverMuscle("")}
                  onClick={() => onSelectMuscle(isSelected ? "" : st.key)}
                >
                  <span>{st.name}</span>
                  <ThinMeter ratio={st.recoveryPct / 100} />
                  <strong>
                    {st.recoveryPct}% <small>{st.statusLabel}</small>
                  </strong>
                </button>
              );
            })
        ) : mode === "recency" && statusList.length ? (
          [...statusList]
            .sort((a, b) => (b.daysSinceLast ?? 9999) - (a.daysSinceLast ?? 9999))
            .map((st) => {
              const isSelected = selectedMuscle === st.key;
              const isDimmed = Boolean(selectedMuscle && !isSelected);
              const gapText =
                st.daysSinceLast == null ? "久未练" : st.daysSinceLast === 0 ? "今天" : `${st.daysSinceLast} 天前`;
              const tone =
                st.daysSinceLast == null || st.daysSinceLast >= 10
                  ? "detrained"
                  : st.daysSinceLast >= 7
                    ? "recovering"
                    : "ready";
              return (
                <button
                  key={st.key}
                  type="button"
                  className={`muscle-line${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}`}
                  data-tone={tone}
                  aria-pressed={isSelected}
                  onMouseEnter={() => setHoverMuscle(st.key)}
                  onMouseLeave={() => setHoverMuscle("")}
                  onClick={() => onSelectMuscle(isSelected ? "" : st.key)}
                >
                  <span>{st.name}</span>
                  <ThinMeter ratio={Math.min(1, (st.daysSinceLast ?? 14) / 14)} />
                  <strong>
                    {gapText} <small>近7天 {fmt(st.recent7dSets)} 组</small>
                  </strong>
                </button>
              );
            })
        ) : totalMuscleSets || selectedMuscle ? (
          anatomical.map((item) => {
            const share = totalMuscleSets ? Math.round((item.sets / totalMuscleSets) * 100) : 0;
            const isSelected = selectedMuscle === item.key;
            const isDimmed = Boolean(selectedMuscle && !isSelected);
            return (
              <button
                key={item.key}
                type="button"
                className={`muscle-line${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}`}
                aria-pressed={isSelected}
                onMouseEnter={() => setHoverMuscle(item.key)}
                onMouseLeave={() => setHoverMuscle("")}
                onClick={() => onSelectMuscle(isSelected ? "" : item.key)}
              >
                <span>{item.name}</span>
                <ThinMeter ratio={item.sets / maxMuscle} />
                <strong>
                  {fmt(item.sets)} 组 <small>{share}%</small>
                </strong>
              </button>
            );
          })
        ) : (
          <p className="muted">记录力量训练后，查看主要训练部位。</p>
        )}
      </div>
    </section>
  );
}

export function WeightChart({
  rows,
  from,
  to,
  goal = null,
  showAverage = false,
}: {
  rows: Array<{ date: string; weight: number; average?: number | null }>;
  from?: string;
  to?: string;
  goal?: number | null;
  showAverage?: boolean;
}) {
  const [readout, setReadout] = useState("");
  const compact = useCompactViewport();
  const width = compact ? 344 : showAverage ? 420 : 660;
  const height = 200;
  const left = 48;
  const right = 14;
  const top = 12;
  const bottom = 32;
  const innerW = width - left - right;
  const innerH = height - top - bottom;

  const { hasData, scale, dateMarks, primaryPoints, averagePoints } = useMemo(() => {
    const weightNums = rows.map((r) => r.weight).filter(Number.isFinite);
    const avgNums = showAverage ? rows.map((r) => r.average).filter((v): v is number => Number.isFinite(v)) : [];
    const known = [...weightNums, ...avgNums];

    if (!known.length || !rows.length) {
      return {
        hasData: false,
        scale: computeYScale([], false),
        dateMarks: [] as Array<{ date: string; x: number }>,
        primaryPoints: [] as Array<{ px: number; py: number; row: { date: string; weight: number; average?: number | null } }>,
        averagePoints: [] as Array<{ px: number; py: number; row: { date: string; weight: number; average: number } }>,
      };
    }

    const yData = goal == null ? known : [...known, goal];
    const computedScale = computeYScale(yData, false);
    const getY = (value: number) =>
      top + ((computedScale.high - value) / (computedScale.high - computedScale.low)) * innerH;
    const start = Date.parse(from ?? rows[0]!.date);
    const end = Date.parse(to ?? rows.at(-1)!.date);
    const getX = (dateStr: string) =>
      start === end ? left + innerW / 2 : left + (innerW * (Date.parse(dateStr) - start)) / (end - start);

    const marks = [
      ...new Set([start, start + Math.floor((end - start) / 86_400_000 / 2) * 86_400_000, end]),
    ].map((ms) => {
      const iso = new Date(ms).toISOString().slice(0, 10);
      return { date: iso, x: getX(iso) };
    });

    const primary = rows.map((row) => ({ px: getX(row.date), py: getY(row.weight), row }));
    const average = showAverage
      ? rows
          .filter((row): row is { date: string; weight: number; average: number } => Number.isFinite(row.average))
          .map((row) => ({ px: getX(row.date), py: getY(row.average), row }))
      : [];

    return {
      hasData: true,
      scale: computedScale,
      dateMarks: marks,
      primaryPoints: primary,
      averagePoints: average,
    };
  }, [rows, from, to, goal, showAverage, innerW, innerH]);

  if (!hasData) {
    return (
      <div className="empty">
        <strong>这个区间暂无数据</strong>
        <p>更换时间范围，或添加一条称重记录。</p>
      </div>
    );
  }

  const y = (value: number) => top + ((scale.high - value) / (scale.high - scale.low)) * innerH;

  return (
    <div className="chart-wrap">
      <div className="chart-readout-line">
        <span className="chart-readout">{readout}</span>
      </div>
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={showAverage ? "称重与滚动平均，单位千克" : "称重趋势，单位千克"}
        onMouseLeave={() => setReadout("")}
      >
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} className="gridline" />
            <text x={left - 8} y={y(tick) + 4} textAnchor="end">
              {fmt(tick, 2)}
            </text>
          </g>
        ))}

        {dateMarks.map((mark) => (
          <text key={mark.date} x={mark.x} y={height - 8} textAnchor="middle">
            {shortDate(mark.date)}
          </text>
        ))}

        {goal != null ? (
          <path d={`M${left},${y(goal)}H${width - right}`} className="goal-line">
            <title>目标 {fmt(goal)}</title>
          </path>
        ) : null}

        {showAverage && averagePoints.length > 0 ? (
          <>
            <polyline
              points={averagePoints.map(({ px, py }) => `${px},${py}`).join(" ")}
              className="trace secondary"
            />
            {averagePoints.map(({ px, py, row }) => (
              <circle key={`avg-${row.date}`} cx={px} cy={py} r={2.1} className="node-secondary" />
            ))}
          </>
        ) : null}

        <polyline
          points={primaryPoints.map(({ px, py }) => `${px},${py}`).join(" ")}
          className="trace primary"
        />
        {primaryPoints.map(({ px, py, row }) => {
          const tip = `${shortDate(row.date)} · 称重 ${fmt(row.weight, 2)} kg`;
          return (
            <g key={row.date}>
              <circle cx={px} cy={py} r={primaryPoints.length > 38 ? 2.4 : 3.6} className="node-primary" />
              <circle
                cx={px}
                cy={py}
                r={10}
                className="chart-hit"
                tabIndex={0}
                role="button"
                aria-label={tip}
                onMouseEnter={() => setReadout(tip)}
                onFocus={() => setReadout(tip)}
                onClick={() => setReadout(tip)}
              >
                <title>{tip}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
