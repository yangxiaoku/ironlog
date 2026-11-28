import { useEffect, useRef, useState } from "react";
import { LoadChart, MiniSparkline, MuscleDistributionCard, WeekStrip, WeightChart } from "../components/Charts";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { DotCheckIcon, DotPlayIcon, ThinMeter } from "../components/Meters";
import { MuscleBodyMap } from "../components/MuscleBodyMap";
import type { ScheduleResponse } from "../components/plan/PlanModals";
import {
  AppleDailyStrip,
  AppleLine,
  type AppleDailyEntry,
  type AppleSyncStatus,
  type AppleWorkoutAgendaItem,
} from "../components/apple/AppleHealthModals";
import { BadgesOverviewStrip } from "../components/badges/BadgesOverviewStrip";
import { WelcomeChecklist, onboardingSeenKey } from "../components/onboarding/WelcomeChecklist";
import { apiFetch } from "../lib/api";
import { pinnedBadgesKey, type BadgeSummary } from "../lib/badges";
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
import { WORKOUT_PREFS_EVENT, readWorkoutPreferences } from "../lib/workout-helpers";
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
  const openConfirm = useUiStore((s) => s.openConfirm);
  const notify = useUiStore((s) => s.notify);
  const navigate = useUiStore((s) => s.navigate);

  const [period, setPeriod] = useState<PeriodDays | null>(null);
  const [through, setThrough] = useState<string>(() => today());
  const [statsRetrySeq, setStatsRetrySeq] = useState(0);
  const [metric, setMetric] = useState<LoadMetricKey>("volume");
  const [atlasMode, setAtlasMode] = useState<"volume" | "recovery" | "recency">("volume");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleKey | "">("");
  const [statsCategory, setStatsCategory] = useState<"all" | "load" | "muscle" | "weight">("all");
  const [weekDate, setWeekDate] = useState<string>("");
  const [quickDayBusy, setQuickDayBusy] = useState(false);
  const [, setPinnedBadgesTick] = useState(0);
  const [hiddenModules, setHiddenModules] = useState<string[]>(() => readWorkoutPreferences().hiddenModules ?? []);

  useEffect(() => {
    const onPrefs = () => setHiddenModules(readWorkoutPreferences().hiddenModules ?? []);
    window.addEventListener(WORKOUT_PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, onPrefs);
  }, []);

  interface OverviewAuxSnapshot {
    day: TodayResponse | null;
    liveStats: OverviewStatsResponse | null;
    badges: BadgeSummary | null;
    hasPlan: boolean;
    schedule: ScheduleResponse | null;
    visiblePanels: string[] | null;
    appleDaily: AppleDailyEntry | null;
    appleAgenda: AppleWorkoutAgendaItem[];
    appleStatus: AppleSyncStatus | null;
  }
  const initialQuery = new URLSearchParams({ through });
  if (period) initialQuery.set("days", String(period));
  const initialStatsKey = `view:overview:stats:${initialQuery.toString()}`;
  const initialAuxKey = `view:overview:aux:${appleHealthConnected ? 1 : 0}`;
  const cachedStatsInit = peekQuery<OverviewStatsResponse>(initialStatsKey, userId)?.data;
  const cachedAuxInit = peekQuery<OverviewAuxSnapshot>(initialAuxKey, userId)?.data;

  const [stats, setStats] = useState<OverviewStatsResponse | null>(() => cachedStatsInit ?? null);
  const [liveTodayStats, setLiveTodayStats] = useState<OverviewStatsResponse | null>(() => cachedAuxInit?.liveStats ?? null);
  const [day, setDay] = useState<TodayResponse | null>(() => cachedAuxInit?.day ?? null);
  const [badges, setBadges] = useState<BadgeSummary | null>(() => cachedAuxInit?.badges ?? null);
  const [hasPlan, setHasPlan] = useState<boolean>(() => cachedAuxInit?.hasPlan ?? false);
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(() => cachedAuxInit?.schedule ?? null);
  const [visiblePanels, setVisiblePanels] = useState<string[] | null>(() => cachedAuxInit?.visiblePanels ?? null);
  const [appleDaily, setAppleDaily] = useState<AppleDailyEntry | null>(() => cachedAuxInit?.appleDaily ?? null);
  const [appleAgenda, setAppleAgenda] = useState<AppleWorkoutAgendaItem[]>(() => cachedAuxInit?.appleAgenda ?? []);
  const [appleStatus, setAppleStatus] = useState<AppleSyncStatus | null>(() => cachedAuxInit?.appleStatus ?? null);
  const [loading, setLoading] = useState(() => !cachedStatsInit);
  const [error, setError] = useState("");
  const autoOnboardedUserRef = useRef("");
  const lastUserRef = useRef(userId);
  const manualRefreshToastRef = useRef<string | null>(null);

  useEffect(() => {
    const key = pinnedBadgesKey(userId);
    const onPinnedChange = () => setPinnedBadgesTick((n) => n + 1);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === null || ev.key === key) setPinnedBadgesTick((n) => n + 1);
    };
    window.addEventListener("ironlog-pinned-badges-change", onPinnedChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ironlog-pinned-badges-change", onPinnedChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  // Stats-only effect: changing period or through ONLY fetches /api/web/statistics
  useEffect(() => {
    let active = true;
    const userChanged = lastUserRef.current !== userId;
    const query = new URLSearchParams({ through });
    if (period) query.set("days", String(period));
    const statsKey = `view:overview:stats:${query.toString()}`;
    const staleStats = peekQuery<OverviewStatsResponse>(statsKey, userId)?.data;
    if (staleStats) {
      setStats(staleStats);
      setLoading(false);
    } else if (userChanged) {
      setStats(null);
      setLoading(true);
    } else if (!stats) {
      setLoading(true);
    }
    setError("");
    void cachedApiFetch<OverviewStatsResponse>(`/api/web/statistics?${query.toString()}`, {
      epoch: dataEpoch + statsRetrySeq,
      userId,
    })
      .then((statsRes) => {
        if (!active) return;
        writeQueryCache(statsKey, statsRes, { userId, epoch: dataEpoch });
        setStats(statsRes);
        if (manualRefreshToastRef.current) {
          const msg = manualRefreshToastRef.current;
          manualRefreshToastRef.current = null;
          notify(msg);
        }
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
        manualRefreshToastRef.current = null;
        setError((err as Error)?.message || "加载首页统计失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, demo, isNewUser, dataEpoch, through, period, statsRetrySeq]);

  // Aux & Today effect: independent of period/through switches, never overwrites state on transient failure
  useEffect(() => {
    let active = true;
    const userChanged = lastUserRef.current !== userId;
    lastUserRef.current = userId;
    const currentToday = today();
    const auxKey = `view:overview:aux:${appleHealthConnected ? 1 : 0}`;
    const staleAux = peekQuery<OverviewAuxSnapshot>(auxKey, userId)?.data;
    if (userChanged) {
      if (staleAux) {
        setDay(staleAux.day);
        setLiveTodayStats(staleAux.liveStats ?? null);
        setBadges(staleAux.badges);
        setHasPlan(staleAux.hasPlan);
        setScheduleData(staleAux.schedule);
        setVisiblePanels(staleAux.visiblePanels);
        setAppleDaily(staleAux.appleDaily);
        setAppleAgenda(staleAux.appleAgenda);
        setAppleStatus(staleAux.appleStatus);
      } else {
        setDay(null);
        setLiveTodayStats(null);
        setBadges(null);
        setHasPlan(false);
        setScheduleData(null);
        setVisiblePanels(null);
        setAppleDaily(null);
        setAppleAgenda([]);
        setAppleStatus(null);
      }
    }
    const wrap = <T,>(p: Promise<T>) =>
      p.then(
        (v) => ({ ok: true as const, v }),
        () => ({ ok: false as const, v: null }),
      );
    void Promise.all([
      wrap(cachedApiFetch<TodayResponse>("/api/web/today", { ttlMs: 60_000, epoch: dataEpoch, userId })),
      // #209: Always fetch real-today weekly streak & activity independently of historical `through` date picker
      wrap(cachedApiFetch<OverviewStatsResponse>(`/api/web/statistics?through=${encodeURIComponent(currentToday)}&days=7`, { epoch: dataEpoch, userId })),
      wrap(cachedApiFetch<BadgeSummary>("/api/web/badges", { epoch: dataEpoch, userId })),
      wrap(cachedApiFetch<{ panels?: string[] }>("/api/web/preferences", { epoch: dataEpoch, userId })),
      wrap(cachedApiFetch<ScheduleResponse>("/api/web/schedule", { epoch: dataEpoch, userId })),
      appleHealthConnected
        ? wrap(
            cachedApiFetch<{ entries?: AppleDailyEntry[] }>(
              `/api/integrations/apple-health/daily?from=${encodeURIComponent(currentToday)}&through=${encodeURIComponent(currentToday)}`,
              { epoch: dataEpoch, userId },
            ),
          )
        : Promise.resolve({ ok: true as const, v: null }),
      appleHealthConnected
        ? wrap(
            cachedApiFetch<AppleWorkoutAgendaItem[]>(
              `/api/integrations/apple-health/agenda?from=${encodeURIComponent(currentToday)}&through=${encodeURIComponent(currentToday)}`,
              { epoch: dataEpoch, userId },
            ),
          )
        : Promise.resolve({ ok: true as const, v: [] as AppleWorkoutAgendaItem[] }),
      appleHealthConnected
        ? wrap(cachedApiFetch<AppleSyncStatus>("/api/integrations/apple-health/status", { ttlMs: 30_000, epoch: dataEpoch, userId }))
        : Promise.resolve({ ok: true as const, v: null }),
    ]).then(([todayRes, liveStatsRes, badgesRes, prefsRes, schedRes, dailyRes, agendaRes, statusRes]) => {
      if (!active) return;
      if (todayRes.ok) setDay(todayRes.v);
      if (liveStatsRes.ok) setLiveTodayStats(liveStatsRes.v);
      if (badgesRes.ok) setBadges(badgesRes.v);
      if (schedRes.ok) setScheduleData(schedRes.v ?? null);
      if (todayRes.ok || schedRes.ok) {
        setHasPlan(Boolean(schedRes.v?.activePlan?.id || todayRes.v?.planned));
      }
      if (prefsRes.ok) setVisiblePanels(Array.isArray(prefsRes.v?.panels) ? prefsRes.v.panels : null);
      if (dailyRes.ok) setAppleDaily(dailyRes.v?.entries?.[0] ?? null);
      if (agendaRes.ok) setAppleAgenda(Array.isArray(agendaRes.v) ? agendaRes.v : []);
      if (statusRes.ok) setAppleStatus(statusRes.v ?? null);
      if (
        todayRes.ok &&
        liveStatsRes.ok &&
        badgesRes.ok &&
        prefsRes.ok &&
        schedRes.ok &&
        dailyRes.ok &&
        agendaRes.ok &&
        statusRes.ok
      ) {
        const nextAux: OverviewAuxSnapshot = {
          day: todayRes.v,
          liveStats: liveStatsRes.v,
          badges: badgesRes.v,
          hasPlan: Boolean(schedRes.v?.activePlan?.id || todayRes.v?.planned),
          schedule: schedRes.v ?? null,
          visiblePanels: Array.isArray(prefsRes.v?.panels) ? prefsRes.v.panels : null,
          appleDaily: dailyRes.v?.entries?.[0] ?? null,
          appleAgenda: Array.isArray(agendaRes.v) ? agendaRes.v : [],
          appleStatus: statusRes.v ?? null,
        };
        writeQueryCache(auxKey, nextAux, { userId, epoch: dataEpoch });
      }
    });
    return () => {
      active = false;
    };
  }, [userId, appleHealthConnected, dataEpoch]);

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
  const isHistoricalThrough = through !== todayKey;
  const activities = stats.totals.activities ?? stats.totals.workouts;
  const prevActivities = stats.previous.activities ?? stats.previous.workouts;

  const weights = stats.weights ?? [];
  const latestWeight = day?.weight ?? (!isHistoricalThrough ? weights.at(-1)?.weight ?? null : null);
  const prevWeight = !isHistoricalThrough && weights.length >= 2 ? weights.at(-2)?.weight ?? null : null;
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
    const todayRecent = !isHistoricalThrough ? stats.recent.find((r) => r.date === todayKey) : undefined;
    if (todayRecent) {
      openWorkoutReport({ workoutId: todayRecent.id, goals: stats.goals });
      return;
    }
    const latestAppleToday = appleAgenda.at(-1);
    if (latestAppleToday) {
      openAppleWorkoutDetailsModal({ item: latestAppleToday });
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

  const handleQuickDayAction = async (
    targetDate: string,
    action:
      | { kind: "rest" }
      | { kind: "reset" }
      | { kind: "swap"; title: string; planId?: string | null; routineId?: string | null; templateId?: string | null; exercises: unknown[] },
  ) => {
    if (quickDayBusy) return;
    setQuickDayBusy(true);
    try {
      const detail = await apiFetch<{ override?: { version: number } | null }>(
        `/api/web/schedule/${encodeURIComponent(targetDate)}`,
      ).catch(() => ({ override: null }));
      const baseVersion = detail?.override?.version ?? 0;

      if (action.kind === "reset") {
        if (!detail?.override) {
          notify("该日当前已是默认排期");
          return;
        }
        await apiFetch(`/api/web/schedule/${encodeURIComponent(targetDate)}`, {
          method: "DELETE",
          body: { baseVersion },
        });
        notify(`已恢复 ${shortDate(targetDate)} 默认排期`);
      } else if (action.kind === "rest") {
        await apiFetch(`/api/web/schedule/${encodeURIComponent(targetDate)}`, {
          method: "PUT",
          body: {
            baseVersion,
            mode: "rest",
            title: "休息日",
            notes: "",
            planId: null,
            routineId: null,
            templateId: null,
            exercises: [],
          },
        });
        notify(`已将 ${shortDate(targetDate)} 设为休息/跳过`);
      } else {
        await apiFetch(`/api/web/schedule/${encodeURIComponent(targetDate)}`, {
          method: "PUT",
          body: {
            baseVersion,
            mode: "workout",
            title: action.title,
            notes: "",
            planId: action.planId ?? null,
            routineId: action.routineId ?? null,
            templateId: action.templateId ?? null,
            exercises: action.exercises,
          },
        });
        notify(`已将 ${shortDate(targetDate)} 临时调整为「${action.title}」`);
      }
      setWeekDate("");
      bumpDataEpoch();
    } catch (err) {
      notify((err as Error)?.message || "调整排期失败");
    } finally {
      setQuickDayBusy(false);
    }
  };

  const selectedWeekEntry = weekDate ? scheduleData?.days?.find((d) => d.date === weekDate) ?? null : null;
  const swapChoices: Array<{
    key: string;
    title: string;
    planId?: string | null;
    routineId?: string | null;
    templateId?: string | null;
    exercises: unknown[];
  }> = [
    ...(scheduleData?.activePlan?.routines ?? []).map((r) => ({
      key: `plan:${r.id}`,
      title: r.name,
      planId: scheduleData!.activePlan!.id,
      routineId: r.id,
      templateId: null,
      exercises: r.exercises,
    })),
    ...(scheduleData?.templates ?? []).map((t) => ({
      key: `tpl:${t.id}`,
      title: t.name,
      planId: null,
      routineId: null,
      templateId: t.id,
      exercises: t.exercises,
    })),
  ];

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
                  manualRefreshToastRef.current = "已刷新首页数据";
                  bumpDataEpoch();
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
            <div className="hero-title-streak">
              <h1>今天</h1>
              {(() => {
                // #209: Hero "今天" streak & freeze actions ALWAYS bind to real-today live stats, never historical `through`
                const liveStreak = liveTodayStats?.weeklyStreak ?? (through === todayKey ? stats.weeklyStreak : null);
                const liveAct = liveTodayStats?.activity ?? (through === todayKey ? stats.activity : []);
                if (!liveStreak) return null;
                const liveAnchor = new Date(`${todayKey}T00:00:00Z`);
                const liveMonOffset = (liveAnchor.getUTCDay() + 6) % 7;
                const liveMon = shiftDateStr(todayKey, -liveMonOffset);
                const trainedThisWeek = liveAct.some((a) => a.active && a.date >= liveMon && a.date <= todayKey);
                return (
                  <div className="streak-pill-bar">
                    <span className="streak-pill" title={`本周标识 ${liveStreak.currentWeekKey}`}>
                      🔥 连续 <b>{liveStreak.currentWeeks}</b> 周
                    </span>
                    {liveStreak.isCurrentWeekFrozen ? (
                      <span className="streak-freeze-pill is-frozen">❄️ 本周已冻结保护</span>
                    ) : liveStreak.freezeRemainingThisMonth > 0 ? (
                      <button
                        type="button"
                        className="streak-freeze-pill"
                        title="出差或生病时使用每月 1 次的连胜冻结卡，避免周连胜清零"
                        onClick={() => {
                          const warnExtra = trainedThisWeek
                            ? "\n\n提示：本周你已完成训练，连胜已自动延续，建议保留本次额度以备不时之需。"
                            : liveStreak.currentWeeks === 0
                              ? "\n\n提示：当前连续周数为 0 周，暂无待保护的连胜，建议留存额度。"
                              : "";
                          openConfirm({
                            title: "启用本周连胜冻结保护",
                            message: `拟保护周期：${liveStreak.currentWeekKey}（当前连续 ${liveStreak.currentWeeks} 周，本月剩余额度 ${liveStreak.freezeRemainingThisMonth} 次）。启用后本周即使未练也不会中断周连胜。${warnExtra}`,
                            confirmLabel: "确认启用冻结卡",
                            onConfirm: async () => {
                              await apiFetch("/api/web/streak-freeze", {
                                method: "POST",
                                body: { weekKey: liveStreak.currentWeekKey },
                              });
                              bumpDataEpoch();
                              notify(`已启用 ${liveStreak.currentWeekKey} 连胜冻结保护 ❄️`);
                            },
                          });
                        }}
                      >
                        ❄️ 冻结卡 ({liveStreak.freezeRemainingThisMonth})
                      </button>
                    ) : null}
                  </div>
                );
              })()}
            </div>
            <WeekStrip
              activity={liveTodayStats?.activity ?? (through === todayKey ? stats.activity : [])}
              todayKey={todayKey}
              selectedDate={weekDate}
              scheduleDays={scheduleData?.days}
              onSelectDate={(iso) => setWeekDate(iso)}
            />
          </div>

          {weekDate ? (
            <div className="week-quick-sheet" role="region" aria-label="单日排期快操">
              <div className="week-quick-head">
                <div>
                  <strong>{shortDate(weekDate)}</strong>
                  <small className="muted">
                    {selectedWeekEntry?.status === "completed"
                      ? `已完成 · ${selectedWeekEntry.title}`
                      : selectedWeekEntry?.status === "rest"
                        ? "当前为休息日"
                        : selectedWeekEntry?.title
                          ? `当前安排：${selectedWeekEntry.title}`
                          : "暂无排期"}
                  </small>
                </div>
                <button type="button" className="quiet" onClick={() => setWeekDate("")}>
                  收起
                </button>
              </div>
              <div className="week-quick-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={quickDayBusy}
                  onClick={() => void handleQuickDayAction(weekDate, { kind: "rest" })}
                >
                  跳过 / 设休息
                </button>
                {selectedWeekEntry?.source === "scheduled" ? (
                  <button
                    type="button"
                    className="quiet"
                    disabled={quickDayBusy}
                    onClick={() => void handleQuickDayAction(weekDate, { kind: "reset" })}
                  >
                    恢复默认排期
                  </button>
                ) : null}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    const target = weekDate;
                    setWeekDate("");
                    openCalendarDayModal(target, (d) => setWeekDate(d));
                  }}
                >
                  查看当日档案
                </button>
              </div>
              {swapChoices.length ? (
                <div className="week-quick-swap">
                  <span className="muted">临时换成：</span>
                  <div className="week-quick-swap-chips">
                    {swapChoices.slice(0, 8).map((choice) => (
                      <button
                        key={choice.key}
                        type="button"
                        className="quiet"
                        disabled={quickDayBusy}
                        onClick={() =>
                          void handleQuickDayAction(weekDate, {
                            kind: "swap",
                            title: choice.title,
                            planId: choice.planId,
                            routineId: choice.routineId,
                            templateId: choice.templateId,
                            exercises: choice.exercises,
                          })
                        }
                      >
                        {choice.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
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
                  {day.planned?.scheduleMode === "rotation" && isPlannedToday ? (
                    <em className="today-mode-pill">轮换顺延</em>
                  ) : null}
                </span>
                <strong>{trainingTile.main}</strong>
                {trainingTile.note ? <small>{trainingTile.note}</small> : null}
              </span>
              {day.planned?.muscleScores && Object.keys(day.planned.muscleScores).length > 0 && isPlannedToday ? (
                <MuscleBodyMap size="mini" scores={day.planned.muscleScores} />
              ) : null}
              <span className={`today-cta-pill${trainingTile.active ? " is-live" : trainingTile.completed ? " is-done" : ""}`}>
                {trainingTile.label}
              </span>
            </button>

            {!hiddenModules.includes("diet") ? (
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
                  <MatrixText value={day.nutrition.count ? fmt(day.nutrition.calories, 0) : "0"} />
                </strong>
                <small>
                  {day.nutrition.target ? `/ ${fmt(day.nutrition.target, 0)} kcal` : "kcal"}
                  {day.nutrition.count && day.nutrition.protein > 0 ? ` · 蛋 ${fmt(day.nutrition.protein, 0)}g` : ""}
                </small>
                <ThinMeter
                  ratio={day.nutrition.count && day.nutrition.target ? day.nutrition.calories / day.nutrition.target : 0}
                  label="热量进度"
                />
              </button>
            ) : null}

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

      {appleStatus?.activeSession ? (
        <div className="apple-live-banner" role="status">
          <span className="apple-live-banner-main">
            <i className="live-led" aria-hidden="true" />
            <strong>Apple Watch 训练进行中 · {appleStatus.activeSession.title}</strong>
            <small>已进行约 {appleStatus.activeSession.elapsedMinutes} 分钟</small>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                openConfirm({
                  title: "取消进行中的手表会话",
                  message: `确定要清除「${appleStatus.activeSession!.title}」的进行中状态吗？`,
                  confirmLabel: "取消会话",
                  onConfirm: async () => {
                    await apiFetch("/api/integrations/apple-health/active-session", { method: "DELETE" });
                    setAppleStatus((prev) => (prev ? { ...prev, activeSession: null } : prev));
                    bumpDataEpoch();
                    notify("已清除进行中的 Apple Watch 会话");
                  },
                });
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                manualRefreshToastRef.current = "已刷新同步状态";
                bumpDataEpoch();
              }}
            >
              <Icon name="refresh" size={13} /> 刷新
            </button>
          </div>
        </div>
      ) : null}

      {isNewUser && !demo ? <WelcomeChecklist stats={stats} currentDay={day} hasPlan={hasPlan} /> : null}

      <div className="section-bar stats-header">
        <div>
          <div className="stats-header-title">
            <h2>训练表现</h2>
            <button
              type="button"
              className="quiet stats-analytics-link"
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    "ironlog_analytics_handoff",
                    JSON.stringify({ through: stats.through, days: period ?? stats.period }),
                  );
                } catch {}
                navigate("analytics");
              }}
            >
              数据分析 <Icon name="chevron" size={14} />
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
              className={through !== stats.today ? "is-custom-date" : undefined}
              min="1902-01-01"
              max={stats.today}
              value={through}
              onChange={(e) => {
                if (e.target.value && e.target.validity.valid) setThrough(e.target.value);
              }}
            />
          </label>
          <div className="segments">
            {INTERVALS.map((opt) => {
              const selectedPeriod = period ?? stats.period;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={selectedPeriod === opt.value}
                  onClick={() => {
                    if (period === opt.value) {
                      setStatsRetrySeq((n) => n + 1);
                    } else {
                      setPeriod(opt.value);
                    }
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="kpis">
        <article className="kpi">
          <div>
            <span>完成训练</span>
          </div>
          <strong>
            <span className="kpi-num">{fmt(activities)}</span>
            <small>次</small>
          </strong>
          {deltaText(activities, prevActivities, " 次")}
        </article>

        <article className="kpi">
          <div>
            <span>训练容量</span>
          </div>
          <strong>
            <span className="kpi-num">{fmt(stats.totals.volume)}</span>
            <small>kg</small>
          </strong>
          {deltaText(stats.totals.volume, stats.previous.volume, " kg")}
        </article>

        <article className="kpi">
          <div>
            <span>完成组数</span>
          </div>
          <strong>
            <span className="kpi-num">{fmt(stats.totals.sets)}</span>
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
              {stats.totals.timedWorkouts ? fmt(stats.totals.seconds / 3600, 1) : "—"}
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
              const latestPt = weightSeries.at(-1);
              const firstPt = weightSeries[0];
              const targetW = stats.goals?.targetWeight ?? null;
              const minW = weightSeries.length ? Math.min(...weightSeries.map((r) => r.weight)) : null;
              const maxW = weightSeries.length ? Math.max(...weightSeries.map((r) => r.weight)) : null;
              const rangeDelta = firstPt && latestPt ? Math.round((latestPt.weight - firstPt.weight) * 10) / 10 : 0;
              const goalDiff = latestPt && targetW != null ? Math.round((latestPt.weight - targetW) * 10) / 10 : null;
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
                  {weightSeries.length > 0 && latestPt ? (
                    <div className="weight-panel-body">
                      <WeightChart
                        rows={weightSeries}
                        from={stats.from}
                        to={stats.through}
                        goal={targetW}
                        showAverage={weightSeries.length >= 2}
                        wide
                      />
                      <aside className="weight-panel-rail" aria-label="体重统计摘要">
                        <div className="weight-rail-stat">
                          <span>最新体重</span>
                          <strong>{fmt(latestPt.weight, 1)} kg</strong>
                          <small>{shortDate(latestPt.date)}</small>
                        </div>
                        {weightSeries.length >= 2 ? (
                          <div className="weight-rail-stat">
                            <span>7日均值</span>
                            <strong>{fmt(latestPt.average, 1)} kg</strong>
                            <small>
                              {rangeDelta === 0 ? "区间持平" : `区间 ${rangeDelta > 0 ? "+" : ""}${fmt(rangeDelta, 1)} kg`}
                            </small>
                          </div>
                        ) : null}
                        {goalDiff != null && targetW != null ? (
                          <div className="weight-rail-stat">
                            <span>距目标</span>
                            <strong>{goalDiff === 0 ? "已达标" : `${goalDiff > 0 ? "+" : ""}${fmt(goalDiff, 1)} kg`}</strong>
                            <small>目标 {fmt(targetW, 1)} kg</small>
                          </div>
                        ) : minW != null && maxW != null ? (
                          <div className="weight-rail-stat">
                            <span>区间范围</span>
                            <strong>{fmt(minW, 1)}–{fmt(maxW, 1)}</strong>
                            <small>kg · {weightSeries.length} 次记录</small>
                          </div>
                        ) : null}
                      </aside>
                    </div>
                  ) : (
                    <WeightChart
                      rows={weightSeries}
                      from={stats.from}
                      to={stats.through}
                      goal={targetW}
                      showAverage={weightSeries.length >= 2}
                      wide
                    />
                  )}
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
              className="record-line no-icon"
              onClick={() => openWorkoutReport({ workoutId: row.id, goals: stats.goals })}
            >
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

      {!hiddenModules.includes("badges") ? <BadgesOverviewStrip rawSummary={badges} /> : null}

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
