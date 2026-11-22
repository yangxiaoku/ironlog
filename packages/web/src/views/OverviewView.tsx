import { useEffect, useState } from "react";
import { LoadChart, MiniSparkline, MuscleDistributionCard, WeekStrip, WeightChart } from "../components/Charts";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { DotCheckIcon, DotPlayIcon, ThinMeter } from "../components/Meters";
import { apiFetch } from "../lib/api";
import { duration, fmt, shortDate, today } from "../lib/date";
import {
  FEELINGS,
  INTERVALS,
  shiftDateStr,
  type LoadMetricKey,
  type MuscleKey,
  type OverviewStatsResponse,
  type PeriodDays,
  type TodayResponse,
} from "../lib/domain";
import { openDietEditor, openWeightEditor, openWorkoutEditor, openWorkoutReport } from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

export function OverviewView() {
  const userId = useAuthStore((s) => s.userId);
  const demo = useAuthStore((s) => s.demo);
  const username = useAuthStore((s) => s.username);

  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);
  const navigate = useUiStore((s) => s.navigate);

  const [period, setPeriod] = useState<PeriodDays | null>(null);
  const [through, setThrough] = useState<string>(() => today());
  const [metric, setMetric] = useState<LoadMetricKey>("volume");
  const [atlasMode, setAtlasMode] = useState<"volume" | "recovery" | "recency">("volume");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleKey | "">("");
  const [weekDate, setWeekDate] = useState<string>("");

  const [stats, setStats] = useState<OverviewStatsResponse | null>(null);
  const [day, setDay] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ through });
    if (period) query.set("days", String(period));
    setLoading(true);
    setError("");
    void Promise.all([
      apiFetch<OverviewStatsResponse>(`/api/web/statistics?${query.toString()}`),
      apiFetch<TodayResponse>("/api/web/today").catch(() => null),
    ])
      .then(([statsRes, todayRes]) => {
        if (!active) return;
        setStats(statsRes);
        setDay(todayRes);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error)?.message || "加载首页统计失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch, through, period]);

  if (loading && !stats) {
    return (
      <div className="skeleton-page" role="status" aria-label="正在加载首页工作台">
        <div className="skeleton-block skeleton-hero" />
        <div className="skeleton-kpis">
          <div className="skeleton-block skeleton-kpi" />
          <div className="skeleton-block skeleton-kpi" />
        </div>
        <div className="skeleton-list">
          <div className="skeleton-block skeleton-row" />
          <div className="skeleton-block skeleton-row" />
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="empty">
        <strong>首页数据暂时无法加载</strong>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={bumpDataEpoch}>
          重新加载
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const todayKey = stats.today ?? today();
  const activities = stats.totals.activities ?? stats.totals.workouts;
  const prevActivities = stats.previous.activities ?? stats.previous.workouts;

  const weights = stats.weights ?? [];
  const latestWeight = day?.weight ?? weights.at(-1)?.weight ?? null;
  const prevWeight = weights.length >= 2 ? weights.at(-2)?.weight ?? null : null;
  const wDiff = prevWeight != null && latestWeight != null ? Math.round((latestWeight - prevWeight) * 10) / 10 : null;
  const wDelta = wDiff != null && wDiff !== 0 ? `${wDiff > 0 ? "+" : ""}${fmt(wDiff, 1)} kg ${wDiff > 0 ? "↑" : "↓"}` : "";
  const weightSub =
    wDelta || (stats.goals?.targetWeight ? `目标 ${fmt(stats.goals.targetWeight, 1)} kg` : day?.weight == null && latestWeight != null ? "最近" : "点击记录");

  const openTodayTraining = () => {
    if (day?.active?.id) {
      void apiFetch<any>(`/api/web/records/workout/${encodeURIComponent(day.active.id)}`)
        .then((rec) => openWorkoutEditor({ record: rec, goals: stats.goals }))
        .catch(() => openWorkoutEditor({ goals: stats.goals }));
      return;
    }
    const todayRecent = stats.recent.find((r) => r.date === todayKey);
    if (todayRecent) {
      openWorkoutReport({ workoutId: todayRecent.id, goals: stats.goals });
      return;
    }
    openWorkoutEditor({ goals: stats.goals });
  };

  const trainingTile = day?.active
    ? {
        main: day.active.title,
        note: `${day.active.from ? `${shortDate(day.active.from)} · ` : ""}${day.active.done}/${day.active.total} 组`,
        label: "继续训练",
        active: true,
        completed: false,
      }
    : day?.planned?.date === todayKey
      ? {
          main: day.planned.name,
          note: `${day.planned.exercises} 个动作`,
          label: "开始计划",
          active: false,
          completed: false,
        }
      : day?.completed
        ? {
            main: `今日已完成 ${day.completed} 次`,
            note: "点击查看复盘",
            label: "查看详情",
            active: false,
            completed: true,
          }
        : day?.restToday
          ? {
              main: "今日休息",
              note: "主动恢复日",
              label: "自由训练",
              active: false,
              completed: false,
            }
          : {
              main: "自由训练",
              note: "随时记录一组",
              label: "开始记录",
              active: false,
              completed: false,
            };

  // Compute trailing weight average for weight card if not already provided
  const since30 = shiftDateStr(todayKey, -29);
  let left = 0;
  let winSum = 0;
  const weightSeries = weights.map((row, idx) => {
    winSum += row.weight;
    const winStart = shiftDateStr(row.date, -6);
    while (left <= idx && (weights[left]?.date ?? "") < winStart) {
      winSum -= weights[left++]?.weight ?? 0;
    }
    return {
      date: row.date,
      weight: row.weight,
      average: row.average ?? Math.round((winSum / Math.max(1, idx - left + 1)) * 100) / 100,
    };
  });

  const deltaText = (val: number, prev: number, suffix: string) => {
    if (!prev && !val) return <span className="comparison">暂无对比</span>;
    const diff = val - prev;
    if (diff === 0) return <span className="comparison">与上期持平</span>;
    return (
      <span className={`comparison${diff > 0 ? " gain" : ""}`}>
        {diff > 0 ? "↑ +" : "↓ "}
        {fmt(diff)}
        {suffix}
      </span>
    );
  };

  return (
    <>
      <div className={`overview-lead${day ? "" : " single-lead"}`}>
        <section className="hero">
          <span className="vf-c tl" aria-hidden="true" />
          <span className="vf-c tr" aria-hidden="true" />
          <span className="vf-c bl" aria-hidden="true" />
          <span className="vf-c br" aria-hidden="true" />
          <div className="hero-top">
            <time className="hero-date" dateTime={todayKey}>
              <strong>
                <MatrixText value={todayKey.slice(8)} />
              </strong>
              <span>{todayKey.slice(0, 7).replace("-", ".")}</span>
            </time>
            <div className="hero-top-actions">
              <button
                type="button"
                className="quiet hero-share-btn"
                onClick={() => {
                  bumpDataEpoch();
                  notify("已刷新首页数据");
                }}
              >
                <Icon name="refresh" size={14} /> 刷新
              </button>
              <div className="hero-status">
                <i />
                {demo ? "演示" : username || "训练日志"}
              </div>
            </div>
          </div>

          <div className="hero-inner">
            <h1>今天</h1>
            <button type="button" className="hero-sublink" onClick={openTodayTraining}>
              <span>{trainingTile.main}</span>
              <Icon name="chevron" size={15} />
            </button>
            <WeekStrip
              activity={stats.activity}
              todayKey={todayKey}
              selectedDate={weekDate}
              onSelectDate={setWeekDate}
            />
          </div>
        </section>

        {day ? (
          <section className="today-strip" aria-label="今日摘要">
            <button
              type="button"
              className={`today-training${trainingTile.active ? " is-training" : ""}`}
              onClick={openTodayTraining}
            >
              <span className="play-squircle">
                {trainingTile.completed && !trainingTile.active ? <DotCheckIcon size={24} /> : <DotPlayIcon size={24} />}
              </span>
              <span className="today-training-main">
                <span className="today-caption">
                  {trainingTile.active ? <span className="training-led" aria-hidden="true" /> : null}
                  今日训练 · {trainingTile.label}
                </span>
                <strong>{trainingTile.main}</strong>
                {trainingTile.note ? <small>{trainingTile.note}</small> : null}
              </span>
              <Icon name="chevron" size={18} />
            </button>

            <button
              type="button"
              className="today-tile is-diet"
              onClick={() => openDietEditor({ date: todayKey })}
            >
              <span className="tile-head">
                <span>摄入</span>
                {day.nutrition.complete ? <em className="tile-badge">完整</em> : null}
                <Icon name="plus" size={14} />
              </span>
              <strong>
                {day.nutrition.count ? <MatrixText value={fmt(day.nutrition.calories, 0)} /> : "记饮食"}
              </strong>
              {day.nutrition.count ? (
                <>
                  <small>/ {fmt(day.nutrition.target, 0)} kcal</small>
                  <ThinMeter
                    ratio={day.nutrition.target ? day.nutrition.calories / day.nutrition.target : 0}
                    label="热量进度"
                  />
                </>
              ) : (
                <small>快速记录</small>
              )}
            </button>

            <button
              type="button"
              className="today-tile is-weight"
              onClick={() => openWeightEditor({ defaultWeight: latestWeight })}
            >
              <span className="tile-head">
                <span>体重</span>
                <Icon name="plus" size={14} />
              </span>
              <strong>
                {latestWeight != null ? (
                  <>
                    <MatrixText value={fmt(latestWeight, 1)} /> <em>kg</em>
                  </>
                ) : (
                  "记体重"
                )}
              </strong>
              <small>{weightSub}</small>
              <MiniSparkline values={weights.slice(-8).map((w) => w.weight)} />
            </button>
          </section>
        ) : null}
      </div>

      <div className="section-bar stats-header">
        <div>
          <h2>训练表现</h2>
          <p>
            {shortDate(stats.from)} – {shortDate(stats.through)}
          </p>
        </div>
        <div className="period-controls">
          <label aria-label="统计截止日期">
            <input
              type="date"
              min="1902-01-01"
              max={stats.today}
              value={stats.through}
              onChange={(e) => {
                if (e.target.value && e.target.validity.valid) setThrough(e.target.value);
              }}
            />
          </label>
          <div className="segments">
            {INTERVALS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={stats.period === opt.value}
                onClick={() => setPeriod(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kpis">
        <article className="kpi">
          <div>
            <span>完成训练</span>
          </div>
          <strong>
            <span className="kpi-num">
              <MatrixText value={fmt(activities)} />
            </span>
            <small>次</small>
          </strong>
          {deltaText(activities, prevActivities, " 次")}
        </article>

        <article className="kpi">
          <div>
            <span>训练容量</span>
          </div>
          <strong>
            <span className="kpi-num">
              <MatrixText value={fmt(stats.totals.volume)} />
            </span>
            <small>kg</small>
          </strong>
          {deltaText(stats.totals.volume, stats.previous.volume, " kg")}
        </article>

        <article className="kpi">
          <div>
            <span>完成组数</span>
          </div>
          <strong>
            <span className="kpi-num">
              <MatrixText value={fmt(stats.totals.sets)} />
            </span>
            <small>组</small>
          </strong>
          {deltaText(stats.totals.sets, stats.previous.sets, " 组")}
        </article>

        <article className="kpi">
          <div>
            <span>训练时长</span>
          </div>
          <strong>
            <span className="kpi-num">
              <MatrixText value={stats.totals.timedWorkouts ? fmt(stats.totals.seconds / 3600, 1) : "—"} />
            </span>
            <small>h</small>
          </strong>
          <span className="comparison">
            {stats.totals.timedWorkouts ? `均次 ${duration(stats.totals.seconds / stats.totals.timedWorkouts)}` : "暂无时长"}
          </span>
        </article>
      </div>

      <div className="dashboard">
        <LoadChart data={stats} metric={metric} onMetricChange={setMetric} />
        <MuscleDistributionCard
          data={stats}
          mode={atlasMode}
          selectedMuscle={selectedMuscle}
          onModeChange={setAtlasMode}
          onSelectMuscle={setSelectedMuscle}
        />
        <section className="panel panel-weight" id="panel-weight">
          <header className="panel-head">
            <div>
              <h2>体重趋势</h2>
              <p>
                {shortDate(since30)} – {shortDate(todayKey)}
              </p>
            </div>
            <button type="button" className="quiet" onClick={() => navigate("weight")}>
              体重档案 <Icon name="chevron" size={14} />
            </button>
          </header>
          <WeightChart
            rows={weightSeries}
            from={stats.from}
            to={stats.through}
            goal={stats.goals?.targetWeight ?? null}
            showAverage={weightSeries.length >= 2}
          />
        </section>
      </div>

      <section className="panel recent">
        <header className="panel-head">
          <h2>近期训练</h2>
          <div className="heading-actions">
            <button type="button" className="quiet" onClick={() => openWorkoutEditor({ goals: stats.goals })}>
              <Icon name="plus" size={15} /> 开始训练
            </button>
            <button type="button" className="quiet" onClick={() => navigate("workout")}>
              全部训练 <Icon name="chevron" size={16} />
            </button>
          </div>
        </header>
        {stats.recent.length ? (
          stats.recent.map((row) => (
            <button
              key={row.id}
              type="button"
              className="record-line"
              onClick={() => openWorkoutReport({ workoutId: row.id, goals: stats.goals })}
            >
              <span className="record-icon">
                <Icon name="workout" />
              </span>
              <span>
                <strong>{row.title}</strong>
                <small>
                  {shortDate(row.date)} · {duration(row.duration)}
                  {row.feeling ? ` · ${FEELINGS[row.feeling]}` : ""}
                </small>
              </span>
              <span className="record-number">
                {fmt(row.sets)} 组 · {fmt(row.volume)} kg
              </span>
              <Icon name="chevron" size={15} />
            </button>
          ))
        ) : (
          <div className="empty">
            <strong>暂无近期训练</strong>
            <p>添加第一条训练，从这里回看表现。</p>
          </div>
        )}
      </section>
    </>
  );
}
