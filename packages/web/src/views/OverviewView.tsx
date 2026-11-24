import { useEffect, useRef, useState } from "react";
import { LoadChart, MiniSparkline, MuscleDistributionCard, WeekStrip, WeightChart } from "../components/Charts";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { DotCheckIcon, DotPlayIcon, ThinMeter } from "../components/Meters";
import {
  AppleDailyStrip,
  AppleLine,
  type AppleDailyEntry,
  type AppleWorkoutAgendaItem,
} from "../components/apple/AppleHealthModals";
import { BadgesOverviewStrip } from "../components/badges/BadgesOverviewStrip";
import { WelcomeChecklist, onboardingSeenKey } from "../components/onboarding/WelcomeChecklist";
import { apiFetch } from "../lib/api";
import type { BadgeSummary } from "../lib/badges";
import { duration, fmt, shortDate, today } from "../lib/date";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import {
  FEELINGS,
  INTERVALS,
  findLocalWorkoutDraft,
  shiftDateStr,
  type LoadMetricKey,
  type MuscleKey,
  type OverviewStatsResponse,
  type PeriodDays,
  type TodayResponse,
} from "../lib/domain";
import {
  openAiReviewModal,
  openAppleDailyDetailsModal,
  openAppleWorkoutDetailsModal,
  openCalendarDayModal,
  openDailyShareModal,
  openDietEditor,
  openOnboardingModal,
  openRoutinePreview,
  openWeightEditor,
  openWorkoutEditor,
  openWorkoutReport,
  resumeLocalWorkoutDraft,
} from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

export function OverviewView() {
  const userId = useAuthStore((s) => s.userId);
  const demo = useAuthStore((s) => s.demo);
  const username = useAuthStore((s) => s.username);
  const isNewUser = useAuthStore((s) => s.isNewUser);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);

  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);
  const navigate = useUiStore((s) => s.navigate);

  const [period, setPeriod] = useState<PeriodDays | null>(null);
  const [through, setThrough] = useState<string>(() => today());
  const [metric, setMetric] = useState<LoadMetricKey>("volume");
  const [atlasMode, setAtlasMode] = useState<"volume" | "recovery" | "recency">("volume");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleKey | "">("");
  const [statsCategory, setStatsCategory] = useState<"all" | "load" | "muscle" | "weight">("all");
  const [weekDate, setWeekDate] = useState<string>("");

  interface OverviewSnapshot {
    stats: OverviewStatsResponse;
    day: TodayResponse | null;
    badges: BadgeSummary | null;
    hasPlan: boolean;
    visiblePanels: string[] | null;
    appleDaily: AppleDailyEntry | null;
    appleAgenda: AppleWorkoutAgendaItem[];
  }
  const initialQuery = new URLSearchParams({ through });
  if (period) initialQuery.set("days", String(period));
  const initialCacheKey = `view:overview:${initialQuery.toString()}:${appleHealthConnected ? 1 : 0}`;
  const cachedInit = peekQuery<OverviewSnapshot>(initialCacheKey, userId)?.data;

  const [stats, setStats] = useState<OverviewStatsResponse | null>(() => cachedInit?.stats ?? null);
  const [day, setDay] = useState<TodayResponse | null>(() => cachedInit?.day ?? null);
  const [badges, setBadges] = useState<BadgeSummary | null>(() => cachedInit?.badges ?? null);
  const [hasPlan, setHasPlan] = useState<boolean>(() => cachedInit?.hasPlan ?? false);
  const [visiblePanels, setVisiblePanels] = useState<string[] | null>(() => cachedInit?.visiblePanels ?? null);
  const [appleDaily, setAppleDaily] = useState<AppleDailyEntry | null>(() => cachedInit?.appleDaily ?? null);
  const [appleAgenda, setAppleAgenda] = useState<AppleWorkoutAgendaItem[]>(() => cachedInit?.appleAgenda ?? []);
  const [loading, setLoading] = useState(() => !cachedInit);
  const [error, setError] = useState("");
  const autoOnboardedUserRef = useRef("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ through });
    if (period) query.set("days", String(period));
    const currentToday = today();
    const viewKey = `view:overview:${query.toString()}:${appleHealthConnected ? 1 : 0}`;
    const staleHit = peekQuery<OverviewSnapshot>(viewKey, userId)?.data;
    if (staleHit) {
      setStats(staleHit.stats);
      setDay(staleHit.day);
      setBadges(staleHit.badges);
      setHasPlan(staleHit.hasPlan);
      setVisiblePanels(staleHit.visiblePanels);
      setAppleDaily(staleHit.appleDaily);
      setAppleAgenda(staleHit.appleAgenda);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError("");
    void Promise.all([
      cachedApiFetch<OverviewStatsResponse>(`/api/web/statistics?${query.toString()}`, { epoch: dataEpoch, userId }),
      cachedApiFetch<TodayResponse>("/api/web/today", { ttlMs: 60_000, epoch: dataEpoch, userId }).catch(() => null),
      cachedApiFetch<BadgeSummary>("/api/web/badges", { epoch: dataEpoch, userId }).catch(() => null),
      cachedApiFetch<{ panels?: string[] }>("/api/web/preferences", { epoch: dataEpoch, userId }).catch(() => null),
      cachedApiFetch<{ planId?: string | null }>("/api/web/schedule", { epoch: dataEpoch, userId }).catch(() => null),
      appleHealthConnected
        ? cachedApiFetch<{ entries?: AppleDailyEntry[] }>(
            `/api/integrations/apple-health/daily?from=${encodeURIComponent(currentToday)}&through=${encodeURIComponent(currentToday)}`,
            { epoch: dataEpoch, userId },
          ).catch(() => null)
        : Promise.resolve(null),
      appleHealthConnected
        ? cachedApiFetch<AppleWorkoutAgendaItem[]>(
            `/api/integrations/apple-health/agenda?from=${encodeURIComponent(currentToday)}&through=${encodeURIComponent(currentToday)}`,
            { epoch: dataEpoch, userId },
          ).catch(() => [])
        : Promise.resolve([]),
    ])
      .then(([statsRes, todayRes, badgesRes, prefsRes, schedRes, dailyRes, agendaRes]) => {
        if (!active) return;
        const nextSnap: OverviewSnapshot = {
          stats: statsRes,
          day: todayRes,
          badges: badgesRes,
          hasPlan: Boolean(schedRes?.planId || todayRes?.planned),
          visiblePanels: Array.isArray(prefsRes?.panels) ? prefsRes.panels : null,
          appleDaily: dailyRes?.entries?.[0] ?? null,
          appleAgenda: Array.isArray(agendaRes) ? agendaRes : [],
        };
        writeQueryCache(viewKey, nextSnap, { userId, epoch: dataEpoch });
        setStats(nextSnap.stats);
        setDay(nextSnap.day);
        setBadges(nextSnap.badges);
        setHasPlan(nextSnap.hasPlan);
        setVisiblePanels(nextSnap.visiblePanels);
        setAppleDaily(nextSnap.appleDaily);
        setAppleAgenda(nextSnap.appleAgenda);

        if (
          !demo &&
          userId &&
          isNewUser &&
          autoOnboardedUserRef.current !== userId &&
          typeof localStorage !== "undefined" &&
          !localStorage.getItem(onboardingSeenKey(userId))
        ) {
          autoOnboardedUserRef.current = userId;
          openOnboardingModal({ currentProfile: statsRes.goals, initialStep: 1 });
        }
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
  }, [userId, demo, isNewUser, appleHealthConnected, dataEpoch, through, period]);

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

  const localDraft = findLocalWorkoutDraft(userId);

  const openTodayTraining = () => {
    if (day?.active?.id) {
      void apiFetch<any>(`/api/web/records/workout/${encodeURIComponent(day.active.id)}`)
        .then((rec) => openWorkoutEditor({ record: rec, goals: stats.goals }))
        .catch(() => openWorkoutEditor({ goals: stats.goals }));
      return;
    }
    if (localDraft) {
      void resumeLocalWorkoutDraft(userId, stats.goals);
      return;
    }
    if (day?.planned?.date === todayKey) {
      openRoutinePreview({
        id: day.planned.source === "scheduled" ? day.planned.date : day.planned.id,
        source: day.planned.source === "scheduled" ? "scheduled" : "plan",
        date: day.planned.date,
      });
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
    : localDraft
      ? {
          main: "本机训练草稿",
          note: "有未提交组数",
          label: "恢复草稿",
          active: false,
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

  const isPlannedToday = Boolean(
    !trainingTile.active && !trainingTile.completed && (day?.planned?.date === todayKey || localDraft),
  );

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

  const primaryPanels = visiblePanels
    ? visiblePanels.filter((p) => p === "load" || p === "muscle" || p === "weight")
    : ["load", "muscle", "weight"];
  const activeStatsCategory =
    statsCategory !== "all" && !primaryPanels.includes(statsCategory) ? "all" : statsCategory;
  const renderedPanels =
    activeStatsCategory === "all" ? primaryPanels : primaryPanels.filter((p) => p === activeStatsCategory);
  const overviewPanelLabels: Record<string, string> = {
    load: "训练趋势",
    muscle: "肌群分布",
    weight: "体重趋势",
  };

  return (
    <>
      {error ? (
        <div
          className="panel"
          role="alert"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}
        >
          <span>首页数据刷新失败：{error}</span>
          <button type="button" className="secondary-button" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      ) : null}
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
                aria-label="分享今日记录"
                onClick={() => openDailyShareModal({ date: todayKey })}
              >
                <Icon name="download" size={14} /> 分享
              </button>
              <button
                type="button"
                className="icon-button hero-refresh-btn"
                aria-label="刷新首页数据"
                title="刷新首页数据"
                onClick={() => {
                  bumpDataEpoch();
                  notify("已刷新首页数据");
                }}
              >
                <Icon name="refresh" size={14} />
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
              onSelectDate={(iso) => {
                setWeekDate(iso);
                openCalendarDayModal(iso, (d) => setWeekDate(d));
              }}
            />
          </div>
        </section>

        {day ? (
          <section className="today-strip" aria-label="今日摘要">
            <button
              type="button"
              className={`today-training${trainingTile.active ? " is-training" : isPlannedToday ? " is-planned" : ""}`}
              onClick={openTodayTraining}
            >
              <span className="play-squircle">
                {trainingTile.completed && !trainingTile.active ? <DotCheckIcon size={24} /> : <DotPlayIcon size={24} />}
              </span>
              <span className="today-training-main">
                <span className="today-caption">
                  {trainingTile.active ? <span className="training-led" aria-hidden="true" /> : null}
                  今日训练
                </span>
                <strong>{trainingTile.main}</strong>
                {trainingTile.note ? <small>{trainingTile.note}</small> : null}
              </span>
              <span className={`today-cta-pill${trainingTile.active ? " is-live" : trainingTile.completed ? " is-done" : ""}`}>
                {trainingTile.label}
              </span>
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
                  <small>
                    / {fmt(day.nutrition.target, 0)} kcal
                    {day.nutrition.protein > 0 ? ` · 蛋 ${fmt(day.nutrition.protein, 0)}g` : ""}
                  </small>
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

      {isNewUser && !demo ? <WelcomeChecklist stats={stats} currentDay={day} hasPlan={hasPlan} /> : null}

      <div className="section-bar stats-header">
        <div>
          <div className="stats-header-title">
            <h2>训练表现</h2>
            <button type="button" className="quiet stats-analytics-link" onClick={() => navigate("analytics")}>
              深度分析 <Icon name="chevron" size={14} />
            </button>
          </div>
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

      {primaryPanels.length ? (
        <>
          {primaryPanels.length > 1 ? (
            <div className="overview-stats-cats" role="group" aria-label="统计图表类别筛选">
              <button
                type="button"
                aria-pressed={activeStatsCategory === "all"}
                onClick={() => setStatsCategory("all")}
              >
                全部统计
              </button>
              {primaryPanels.map((panelId) => (
                <button
                  key={panelId}
                  type="button"
                  aria-pressed={activeStatsCategory === panelId}
                  onClick={() => setStatsCategory(panelId as "load" | "muscle" | "weight")}
                >
                  {overviewPanelLabels[panelId] ?? panelId}
                </button>
              ))}
            </div>
          ) : null}
          <div
            className={`dashboard${
              renderedPanels.length === 1
                ? " is-single-panel"
                : renderedPanels.length === 2
                  ? " is-two-panel"
                  : ""
            }`}
          >
            {renderedPanels.map((panelId) => {
              if (panelId === "load") {
                return <LoadChart key="load" data={stats} metric={metric} onMetricChange={setMetric} />;
              }
              if (panelId === "muscle") {
                return (
                  <MuscleDistributionCard
                    key="muscle"
                    data={stats}
                    mode={atlasMode}
                    selectedMuscle={selectedMuscle}
                    onModeChange={setAtlasMode}
                    onSelectMuscle={setSelectedMuscle}
                  />
                );
              }
              return (
                <section key="weight" className="panel panel-weight" id="panel-weight">
                  <header className="panel-head">
                    <div>
                      <h2>体重趋势</h2>
                      <p>
                        {shortDate(stats.from ?? since30)} – {shortDate(stats.through ?? todayKey)}
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
              );
            })}
          </div>
        </>
      ) : (
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="empty">
            <strong>首页核心图表已全部隐藏</strong>
            <p>可在设置中重新勾选需要展示的数据面板。</p>
            <button type="button" className="secondary-button" onClick={() => navigate("settings")}>
              前往设置
            </button>
          </div>
        </section>
      )}

      <section className="panel recent">
        <header className="panel-head">
          <h2>近期训练</h2>
          <div className="heading-actions">
            <button type="button" className="quiet ai-inline-btn" onClick={() => openAiReviewModal()}>
              <Icon name="bolt" size={15} /> AI 复盘
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

      <BadgesOverviewStrip rawSummary={badges} />

      {appleHealthConnected && (!visiblePanels || visiblePanels.includes("apple")) && (appleDaily || appleAgenda.length > 0) ? (
        <details className="overview-more">
          <summary>
            <span>
              <strong>Apple 健康今日同步</strong>
              <small>{appleAgenda.length ? `${appleAgenda.length} 项体能记录` : "步数 · 睡眠 · 心率恢复"}</small>
            </span>
            <Icon name="chevron" size={16} />
          </summary>
          <div className="overview-more-body">
            {appleDaily ? (
              <AppleDailyStrip daily={appleDaily} onOpenDetails={openAppleDailyDetailsModal} />
            ) : null}
            {appleAgenda.length ? (
              <div className="sync-list">
                {appleAgenda.map((item) => (
                  <AppleLine key={item.id} item={item} onClick={() => openAppleWorkoutDetailsModal(item)} />
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </>
  );
}
