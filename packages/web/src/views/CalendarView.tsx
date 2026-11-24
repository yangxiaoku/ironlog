import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import {
  compactWorkoutTag,
  DayDossier,
  fullWorkoutTag,
  hasAppleTelemetry,
  type DayScheduleDetail,
} from "../components/calendar/DayDossier";
import type { AppleDailyEntry, AppleWorkoutAgendaItem } from "../components/apple/AppleHealthModals";
import type { ScheduleDayEntry } from "../components/plan/PlanModals";
import { resolveCatalogueMap } from "../lib/catalogue";
import { fmt, formatWeekdayZh, monthDays, shortDate, today } from "../lib/date";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import {
  shiftDateStr,
  workoutSeconds,
  type CatalogueExercise,
  type DietData,
  type ProfileGoals,
  type RecordEnvelope,
  type WeightData,
  type WorkoutData,
} from "../lib/domain";
import {
  openCalendarDayModal,
  openDailyShareModal,
  openDayScheduler,
} from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

type CalendarLens = "all" | "training" | "diet";

function shiftMonthStr(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function groupByDate<T>(items: T[], getDate: (item: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const d = getDate(item);
    if (!d) continue;
    let list = map.get(d);
    if (!list) {
      list = [];
      map.set(d, list);
    }
    list.push(item);
  }
  return map;
}

export function CalendarView() {
  const userId = useAuthStore((s) => s.userId);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);

  const todayKey = today();
  const [month, setMonth] = useState(() => todayKey.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [lens, setLens] = useState<CalendarLens>("all");

  interface CalendarBaseSnap {
    workouts: Array<RecordEnvelope<WorkoutData>>;
    diets: Array<RecordEnvelope<DietData>>;
    weights: Array<RecordEnvelope<WeightData>>;
    nutritionDays: Array<RecordEnvelope<{ date: string; complete?: boolean }>>;
    goals: ProfileGoals | null;
  }

  interface CalendarMonthSnap {
    appleEntries: AppleWorkoutAgendaItem[];
    appleDailyMap: Map<string, AppleDailyEntry>;
    schedDays: ScheduleDayEntry[];
  }

  const baseCacheKey = "view:calendar:base";
  const monthCacheKey = `view:calendar:month:${month}`;
  const cachedBase = peekQuery<CalendarBaseSnap>(baseCacheKey, userId)?.data;
  const cachedMonth = peekQuery<CalendarMonthSnap>(monthCacheKey, userId)?.data;

  const [baseLoading, setBaseLoading] = useState(() => !cachedBase);
  const [monthLoading, setMonthLoading] = useState(() => !cachedMonth);
  const [error, setError] = useState("");
  const [workouts, setWorkouts] = useState<Array<RecordEnvelope<WorkoutData>>>(() => cachedBase?.workouts ?? []);
  const [diets, setDiets] = useState<Array<RecordEnvelope<DietData>>>(() => cachedBase?.diets ?? []);
  const [weights, setWeights] = useState<Array<RecordEnvelope<WeightData>>>(() => cachedBase?.weights ?? []);
  const [nutritionDays, setNutritionDays] = useState<Array<RecordEnvelope<{ date: string; complete?: boolean }>>>(
    () => cachedBase?.nutritionDays ?? [],
  );
  const [goals, setGoals] = useState<ProfileGoals | null>(() => cachedBase?.goals ?? null);
  const [appleEntries, setAppleEntries] = useState<AppleWorkoutAgendaItem[]>(() => cachedMonth?.appleEntries ?? []);
  const [appleDailyMap, setAppleDailyMap] = useState<Map<string, AppleDailyEntry>>(
    () => cachedMonth?.appleDailyMap ?? new Map(),
  );
  const [schedDays, setSchedDays] = useState<ScheduleDayEntry[]>(() => cachedMonth?.schedDays ?? []);
  const [daySched, setDaySched] = useState<DayScheduleDetail | null>(null);
  const [catalogueMap, setCatalogueMap] = useState<Map<string, CatalogueExercise>>(() => new Map());

  const monthSwipeRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const prevUserIdRef = useRef(userId);

  const maxMonth = shiftDateStr(todayKey, 365).slice(0, 7);

  // 1. Account-wide base records: fetched once per user/dataEpoch, unaffected by month swipes
  useEffect(() => {
    let active = true;
    const userChanged = prevUserIdRef.current !== userId;
    prevUserIdRef.current = userId;
    const staleBase = peekQuery<CalendarBaseSnap>(baseCacheKey, userId)?.data;
    if (staleBase) {
      setWorkouts(staleBase.workouts);
      setDiets(staleBase.diets);
      setWeights(staleBase.weights);
      setNutritionDays(staleBase.nutritionDays);
      setGoals(staleBase.goals);
      setBaseLoading(false);
    } else if (userChanged) {
      setWorkouts([]);
      setDiets([]);
      setWeights([]);
      setNutritionDays([]);
      setGoals(null);
      setCatalogueMap(new Map());
      setDaySched(null);
      setBaseLoading(true);
    } else if (!workouts.length && !diets.length) {
      setBaseLoading(true);
    }
    setError("");
    void (async () => {
      try {
        const [wRes, dRes, wtRes, ndRes, profRes] = await Promise.all([
          cachedApiFetch<Array<RecordEnvelope<WorkoutData>>>("/api/records/workout", { epoch: dataEpoch, userId }),
          cachedApiFetch<Array<RecordEnvelope<DietData>>>("/api/records/diet", { epoch: dataEpoch, userId }),
          cachedApiFetch<Array<RecordEnvelope<WeightData>>>("/api/records/weight", { epoch: dataEpoch, userId }).catch(() => []),
          cachedApiFetch<Array<RecordEnvelope<{ date: string; complete?: boolean }>>>("/api/records/nutritionDay", { epoch: dataEpoch, userId }).catch(() => []),
          cachedApiFetch<{ profile: ProfileGoals }>("/api/web/profile", { epoch: dataEpoch, userId }).catch(() => null),
        ]);
        if (!active) return;

        const nextBase: CalendarBaseSnap = {
          workouts: wRes.filter((r) => !r.deleted && r.data.status !== "cancelled"),
          diets: dRes.filter((r) => !r.deleted),
          weights: wtRes.filter((r) => !r.deleted),
          nutritionDays: ndRes.filter((r) => !r.deleted),
          goals: profRes?.profile ?? null,
        };
        writeQueryCache(baseCacheKey, nextBase, { userId, epoch: dataEpoch });
        setWorkouts(nextBase.workouts);
        setDiets(nextBase.diets);
        setWeights(nextBase.weights);
        setNutritionDays(nextBase.nutritionDays);
        setGoals(nextBase.goals);
      } catch (err) {
        if (active) setError((err as Error)?.message || "加载日历数据失败");
      } finally {
        if (active) setBaseLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  // 2. Month-local incremental slice: only fetches schedule & Apple telemetry for visible month
  useEffect(() => {
    let active = true;
    const fetchMonthSlice = async (targetMonth: string): Promise<CalendarMonthSnap> => {
      const { days: mDays } = monthDays(targetMonth);
      const from = `${targetMonth}-01`;
      const monthEnd = `${targetMonth}-${String(mDays).padStart(2, "0")}`;
      const appleThrough = monthEnd > todayKey ? todayKey : monthEnd;
      const [appleActs, dailyRes, schedRes] = await Promise.all([
        appleHealthConnected && from <= todayKey
          ? cachedApiFetch<AppleWorkoutAgendaItem[]>(
              `/api/integrations/apple-health/agenda?from=${from}&through=${appleThrough}`,
              { epoch: dataEpoch, userId },
            ).catch(() => [])
          : Promise.resolve([]),
        appleHealthConnected && from <= todayKey
          ? cachedApiFetch<{ entries?: AppleDailyEntry[] }>(
              `/api/integrations/apple-health/daily?from=${from}&through=${appleThrough}`,
              { epoch: dataEpoch, userId },
            ).catch(() => ({ entries: [] }))
          : Promise.resolve({ entries: [] }),
        cachedApiFetch<{ days?: ScheduleDayEntry[] }>(
          `/api/web/schedule?from=${from}&through=${monthEnd}`,
          { epoch: dataEpoch, userId },
        ).catch(() => null),
      ]);
      return {
        appleEntries: appleActs,
        appleDailyMap: new Map((dailyRes.entries ?? []).map((row) => [row.date, row])),
        schedDays: schedRes?.days ?? [],
      };
    };

    const currentKey = `view:calendar:month:${month}`;
    const staleMonth = peekQuery<CalendarMonthSnap>(currentKey, userId)?.data;
    if (staleMonth) {
      setAppleEntries(staleMonth.appleEntries);
      setAppleDailyMap(staleMonth.appleDailyMap);
      setSchedDays(staleMonth.schedDays);
      setMonthLoading(false);
    } else {
      setMonthLoading(true);
    }

    let prefetchTimer: number | undefined;
    void fetchMonthSlice(month)
      .then((nextMonthSnap) => {
        if (!active) return;
        writeQueryCache(currentKey, nextMonthSnap, { userId, epoch: dataEpoch });
        setAppleEntries(nextMonthSnap.appleEntries);
        setAppleDailyMap(nextMonthSnap.appleDailyMap);
        setSchedDays(nextMonthSnap.schedDays);

        // Warm adjacent months locally so next left/right swipe is instantaneous
        prefetchTimer = window.setTimeout(() => {
          if (!active) return;
          const neighbors = [shiftMonthStr(month, -1), shiftMonthStr(month, 1)].filter(
            (m) => m <= maxMonth,
          );
          for (const adj of neighbors) {
            const adjKey = `view:calendar:month:${adj}`;
            if (peekQuery<CalendarMonthSnap>(adjKey, userId)) continue;
            void fetchMonthSlice(adj)
              .then((snap) => {
                writeQueryCache(adjKey, snap, { userId, epoch: dataEpoch });
              })
              .catch(() => {});
          }
        }, 250);
      })
      .finally(() => {
        if (active) setMonthLoading(false);
      });

    return () => {
      active = false;
      if (prefetchTimer !== undefined) window.clearTimeout(prefetchTimer);
    };
  }, [userId, month, dataEpoch, todayKey, maxMonth, appleHealthConnected]);

  // 3. Incrementally resolve exercise dictionary entries for exercises appearing in visible month
  useEffect(() => {
    let active = true;
    const monthExIds = workouts
      .filter((r) => r.data.date.slice(0, 7) === month)
      .flatMap((r) => r.data.exercises?.map((e) => e.exerciseId) ?? []);
    if (!monthExIds.length) return;
    void resolveCatalogueMap(monthExIds).then((catMap) => {
      if (!active) return;
      setCatalogueMap((prev) => new Map([...prev, ...catMap]));
    });
    return () => {
      active = false;
    };
  }, [workouts, month]);

  // Load selected date schedule telemetry when >= today
  useEffect(() => {
    let active = true;
    if (selectedDate < todayKey) {
      setDaySched(null);
      return;
    }
    void cachedApiFetch<DayScheduleDetail>(`/api/web/schedule/${encodeURIComponent(selectedDate)}`, { epoch: dataEpoch, userId })
      .then((res) => {
        if (active) setDaySched(res);
      })
      .catch(() => {
        if (active) setDaySched(null);
      });
    return () => {
      active = false;
    };
  }, [selectedDate, todayKey, dataEpoch, userId]);

  if (baseLoading && !workouts.length && !diets.length && !schedDays.length) {
    return (
      <div className="empty loading" role="status">
        正在加载训练日历…
      </div>
    );
  }

  if (error && !workouts.length && !diets.length) {
    return (
      <div className="empty">
        <strong>日历数据加载失败</strong>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={bumpDataEpoch}>
          重试
        </button>
      </div>
    );
  }

  const { beginning, days } = monthDays(month);
  const standaloneApple = appleEntries.filter((r) => !r.manualWorkoutId);
  const showApple = Boolean(
    appleHealthConnected || standaloneApple.length > 0 || [...appleDailyMap.values()].some(hasAppleTelemetry),
  );

  const workoutsByDate = groupByDate(workouts, (r) => r.data?.date);
  const appleByDate = groupByDate(standaloneApple, (r) => r.date);
  const dietsByDate = groupByDate(diets, (r) => r.data?.date);
  const schedByDate = new Map(schedDays.map((s) => [s.date, s]));
  const completeSet = new Set(nutritionDays.filter((r) => !r.deleted && r.data?.complete).map((r) => r.data.date));

  let totalWorkouts = 0;
  let totalSeconds = 0;
  let calorieDays = 0;
  let totalCalories = 0;
  let completeDietDays = 0;
  let futurePlannedCount = 0;

  for (let i = 0; i < days; i++) {
    const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
    const wList = workoutsByDate.get(iso) ?? [];
    const aList = appleByDate.get(iso) ?? [];
    const dList = dietsByDate.get(iso) ?? [];
    const sched = schedByDate.get(iso);

    if (wList.length || aList.length) {
      totalWorkouts += wList.length + aList.length;
      for (const w of wList) totalSeconds += workoutSeconds(w.data) ?? 0;
      for (const a of aList) totalSeconds += a.durationSeconds ?? 0;
    }
    if (dList.length) {
      calorieDays++;
      totalCalories += dList.reduce((sum, r) => sum + (r.data.calories || 0), 0);
      if (completeSet.has(iso)) completeDietDays++;
    }
    if (iso >= todayKey && !wList.length && !aList.length && (sched?.status === "scheduled" || sched?.status === "projected")) {
      futurePlannedCount++;
    }
  }
  const avgCalories = calorieDays ? Math.round(totalCalories / calorieDays) : 0;

  const selWorkouts = workoutsByDate.get(selectedDate) ?? [];
  const selApple = appleByDate.get(selectedDate) ?? [];
  const selDiets = dietsByDate.get(selectedDate) ?? [];
  const selWeight = weights.find((r) => !r.deleted && r.data.date === selectedDate) ?? null;
  const selDietComplete = completeSet.has(selectedDate);
  const selSchedSummary = schedByDate.get(selectedDate);

  const changeMonth = (delta: number) => {
    const nextM = shiftMonthStr(month, delta);
    if (nextM > maxMonth) return;
    setMonth(nextM);
    setSelectedDate(nextM === todayKey.slice(0, 7) ? todayKey : `${nextM}-01`);
  };

  const selectDateCell = (cellDate: string) => {
    setSelectedDate(cellDate);
    if (typeof window !== "undefined" && matchMedia("(max-width: 850px)").matches) {
      openCalendarDayModal(cellDate, (d) => {
        setSelectedDate(d);
        const nextM = d.slice(0, 7);
        setMonth((prev) => (nextM !== prev && nextM <= maxMonth ? nextM : prev));
      });
    }
  };

  return (
    <>
      <div className="page-heading masthead-calendar">
        <span className="vf-c tl" aria-hidden="true" />
        <span className="vf-c tr" aria-hidden="true" />
        <span className="vf-c bl" aria-hidden="true" />
        <span className="vf-c br" aria-hidden="true" />
        <div className="cal-mast-copy">
          <div className="cal-mast-title">
            <h1>日历</h1>
            <span className="cal-mast-matrix">
              <MatrixText value={month.replace("-", ".")} />
            </span>
          </div>
          <p>
            {month.slice(0, 4)} 年 {Number(month.slice(5))} 月 · 训练记录、热量与排期
          </p>
        </div>
        <div className="segments" role="group" aria-label="日历视图过滤">
          {(
            [
              ["all", "全天双显"],
              ["training", "训练"],
              ["diet", "热量"],
            ] as ReadonlyArray<readonly [CalendarLens, string]>
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={lens === id} onClick={() => setLens(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`calendar-layout lens-${lens}`}>
        <section
          className="panel calendar"
          onTouchStart={(e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0]!;
            if (t.clientX < 24 || (typeof window !== "undefined" && t.clientX > window.innerWidth - 24)) {
              monthSwipeRef.current = null;
              return;
            }
            monthSwipeRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
          }}
          onTouchEnd={(e) => {
            const start = monthSwipeRef.current;
            monthSwipeRef.current = null;
            if (!start || e.changedTouches.length !== 1) return;
            const elapsed = Date.now() - start.time;
            const t = e.changedTouches[0]!;
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            if (elapsed < 480 && Math.abs(dx) >= 68 && Math.abs(dx) > Math.abs(dy) * 1.8) {
              changeMonth(dx < 0 ? 1 : -1);
            }
          }}
        >
          <header className="calendar-header">
            <div className="calendar-month">
              <button className="icon-button" type="button" aria-label="上个月" onClick={() => changeMonth(-1)}>
                <Icon name="back" />
              </button>
              <h2>
                {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
              </h2>
              {monthLoading ? <span className="calendar-month-sync-badge">刷新排期…</span> : null}
              <button
                className="icon-button"
                type="button"
                aria-label="下个月"
                disabled={month >= maxMonth}
                onClick={() => changeMonth(1)}
              >
                <Icon name="chevron" />
              </button>
            </div>
            <button
              className="quiet"
              type="button"
              disabled={selectedDate === todayKey && month === todayKey.slice(0, 7)}
              onClick={() => {
                setMonth(todayKey.slice(0, 7));
                setSelectedDate(todayKey);
              }}
            >
              今天
            </button>
          </header>

          <div className="calendar-month-band" aria-label="本月概览">
            <div>
              <span>完成训练</span>
              <strong>
                {totalWorkouts} <small>场</small>
              </strong>
            </div>
            <div>
              <span>月均摄入</span>
              <strong>
                {avgCalories ? fmt(avgCalories, 0) : "—"} <small>{avgCalories ? "kcal" : ""}</small>
              </strong>
            </div>
            <div>
              <span>完整饮食</span>
              <strong>
                {completeDietDays} <small>天</small>
              </strong>
            </div>
            <div>
              <span>后续排期</span>
              <strong>
                {futurePlannedCount} <small>场</small>
              </strong>
            </div>
          </div>

          <div className={`calendar-grid${monthLoading ? " is-month-loading" : ""}`}>
            {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
              <span key={d}>周{d}</span>
            ))}
            {Array.from({ length: beginning }, (_, idx) => (
              <div key={`pad-${idx}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const cell = `${month}-${String(i + 1).padStart(2, "0")}`;
              const cellWorkouts = workoutsByDate.get(cell) ?? [];
              const cellApple = appleByDate.get(cell) ?? [];
              const cellDiets = dietsByDate.get(cell) ?? [];
              const sched = schedByDate.get(cell);

              const workoutCount = cellWorkouts.length + cellApple.length;
              const rawTrainTitle = cellWorkouts[0]?.data.title ?? cellApple[0]?.plan?.name ?? cellApple[0]?.title ?? "";
              const isFuture = cell > todayKey;
              const hasPlanned =
                !workoutCount && cell >= todayKey && (sched?.status === "scheduled" || sched?.status === "projected");
              const isManualPlan = hasPlanned && sched?.status === "scheduled";
              const isRestSched = !workoutCount && !hasPlanned && cell >= todayKey && sched?.source === "rest";

              const kcal = Math.round(cellDiets.reduce((sum, r) => sum + (r.data.calories || 0), 0));
              const dietDone = completeSet.has(cell);
              const hasAppleDaily = showApple && hasAppleTelemetry(appleDailyMap.get(cell));

              const countSuffix = workoutCount > 1 ? `×${workoutCount}` : "";
              const fullTrainLabel = workoutCount
                ? `${fullWorkoutTag(rawTrainTitle || "训练")}${countSuffix}`
                : hasPlanned
                  ? fullWorkoutTag(sched?.title ?? "")
                  : isRestSched
                    ? "休息"
                    : "";
              const shortTrainLabel = workoutCount
                ? `${compactWorkoutTag(rawTrainTitle || "训练")}${countSuffix}`
                : hasPlanned
                  ? compactWorkoutTag(sched?.title ?? "")
                  : isRestSched
                    ? "休息"
                    : "";

              const kcalLabel = kcal > 0 ? fmt(kcal, 0) : "";

              const cls = [
                "cal-cell",
                cell === todayKey ? "is-today" : "",
                workoutCount ? "has-entries has-workout" : "",
                hasPlanned ? "has-planned" : "",
                isManualPlan ? "has-manual-plan" : "",
                isRestSched ? "is-rest-cell" : "",
                kcal > 0 ? "has-diet" : "",
                dietDone ? "has-diet-complete" : "",
                hasAppleDaily ? "has-apple-daily" : "",
                isFuture ? "is-future-cell" : "",
              ]
                .filter(Boolean)
                .join(" ");

              const ariaParts = [cell];
              if (workoutCount) ariaParts.push(`训练 ${rawTrainTitle}`);
              else if (hasPlanned) ariaParts.push(`排期 ${sched?.title ?? ""}`);
              if (kcal > 0) ariaParts.push(`摄入 ${kcal} 千卡`);
              if (hasAppleDaily) ariaParts.push("体征已同步");

              return (
                <button
                  key={cell}
                  type="button"
                  aria-label={ariaParts.join(" · ")}
                  aria-pressed={selectedDate === cell}
                  className={cls}
                  onClick={() => selectDateCell(cell)}
                >
                  <span className="cal-cell-head">
                    <span className="cal-day-num">{i + 1}</span>
                    <span className="cal-cell-leds" aria-hidden="true">
                      {workoutCount ? <i className="led-work" /> : hasPlanned ? <i className="led-plan" /> : null}
                      {kcal > 0 ? <i className={`led-diet${dietDone ? " is-full" : ""}`} /> : null}
                      {hasAppleDaily ? <i className="led-apple" /> : null}
                    </span>
                  </span>
                  <span className="cal-cell-body">
                    {fullTrainLabel ? (
                      <span
                        className={`cal-cell-work${hasPlanned ? " is-planned" : isRestSched ? " is-rest" : ""}`}
                        title={rawTrainTitle || sched?.title || ""}
                      >
                        <span className="cal-work-full">{fullTrainLabel}</span>
                        <span className="cal-work-short">{shortTrainLabel}</span>
                      </span>
                    ) : (
                      <span className="cal-cell-work is-empty" aria-hidden="true" />
                    )}
                    {kcalLabel ? (
                      <span className={`cal-cell-kcal${dietDone ? " is-full" : ""}`}>
                        {kcalLabel}
                        <small>卡</small>
                      </span>
                    ) : (
                      <span className="cal-cell-kcal is-empty" aria-hidden="true" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <footer className="calendar-legend">
            <span><i className="led-work" /> 已练</span>
            <span><i className="led-plan" /> 排期</span>
            <span><i className="led-diet is-full" /> 饮食完整</span>
            {showApple ? <span><i className="led-apple" /> 体征已同步</span> : null}
            <span className="cal-legend-hint">点击日期查看当天动作与热量明细</span>
          </footer>
        </section>

        <section className="panel calendar-detail">
          <header className="panel-head">
            <div>
              <h2>
                {shortDate(selectedDate)} <small>{formatWeekdayZh(selectedDate)}</small>
              </h2>
            </div>
            {selectedDate <= todayKey ? (
              <div className="dossier-head-right">
                <button type="button" className="secondary-button" onClick={() => openDailyShareModal(selectedDate)}>
                  <Icon name="download" size={14} /> 分享记录
                </button>
                <button type="button" className="quiet" onClick={() => openCalendarDayModal(selectedDate)}>
                  当日详情
                </button>
              </div>
            ) : (
              <button type="button" className="secondary-button" onClick={() => openDayScheduler(selectedDate)}>
                <Icon name="plus" size={16} /> 排训练
              </button>
            )}
          </header>

          <DayDossier
            date={selectedDate}
            todayKey={todayKey}
            workouts={selWorkouts}
            appleEntries={selApple}
            appleDaily={appleDailyMap.get(selectedDate) ?? null}
            appleHealthConnected={showApple}
            diets={selDiets}
            weightRecord={selWeight}
            nutritionComplete={selDietComplete}
            goals={goals}
            daySched={daySched?.date === selectedDate ? daySched : null}
            schedSummary={selSchedSummary}
            catalogueMap={catalogueMap}
          />
        </section>
      </div>
    </>
  );
}
