import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import {
  DayDossier,
  hasAppleTelemetry,
  type DayScheduleDetail,
} from "../components/calendar/DayDossier";
import type { AppleDailyEntry, AppleWorkoutAgendaItem } from "../components/apple/AppleHealthModals";
import type { ScheduleDayEntry } from "../components/plan/PlanModals";
import { compactWorkoutTag, fullWorkoutTag } from "../lib/calendar-label";
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
  const [schedError, setSchedError] = useState("");
  const [schedLoaded, setSchedLoaded] = useState(false);
  const [schedRetrySeq, setSchedRetrySeq] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchMonthSlice = async (targetMonth: string): Promise<CalendarMonthSnap & { schedOk: boolean; schedErrMsg?: string }> => {
      const { days: mDays } = monthDays(targetMonth);
      const from = `${targetMonth}-01`;
      const monthEnd = `${targetMonth}-${String(mDays).padStart(2, "0")}`;
      const appleThrough = monthEnd > todayKey ? todayKey : monthEnd;
      let schedOk = true;
      let schedErrMsg = "";
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
          { epoch: dataEpoch + schedRetrySeq, userId },
        ).catch((err) => {
          schedOk = false;
          schedErrMsg = (err as Error)?.message || "排期服务暂不可用";
          return null;
        }),
      ]);
      return {
        appleEntries: appleActs,
        appleDailyMap: new Map((dailyRes.entries ?? []).map((row) => [row.date, row])),
        schedDays: schedRes?.days ?? [],
        schedOk,
        schedErrMsg,
      };
    };

    const currentKey = `view:calendar:month:${month}`;
    const staleMonth = peekQuery<CalendarMonthSnap>(currentKey, userId)?.data;
    if (staleMonth) {
      setAppleEntries(staleMonth.appleEntries);
      setAppleDailyMap(staleMonth.appleDailyMap);
      setSchedDays(staleMonth.schedDays);
      setSchedLoaded(true);
      setMonthLoading(false);
    } else {
      setSchedLoaded(false);
      setMonthLoading(true);
    }
    setSchedError("");

    let prefetchTimer: number | undefined;
    void fetchMonthSlice(month)
      .then((nextMonthSnap) => {
        if (!active) return;
        setAppleEntries(nextMonthSnap.appleEntries);
        setAppleDailyMap(nextMonthSnap.appleDailyMap);
        if (nextMonthSnap.schedOk) {
          setSchedDays(nextMonthSnap.schedDays);
          setSchedLoaded(true);
          setSchedError("");
          writeQueryCache(currentKey, nextMonthSnap, { userId, epoch: dataEpoch });
        } else {
          // #135: Do NOT overwrite cached schedule with empty array or cache a failed 503 response!
          setSchedError(nextMonthSnap.schedErrMsg || "月排期加载失败，请稍后重试");
        }

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
                if (snap.schedOk) writeQueryCache(adjKey, snap, { userId, epoch: dataEpoch });
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
  }, [userId, month, dataEpoch, schedRetrySeq, todayKey, maxMonth, appleHealthConnected]);

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
  // R16 perf + #131/#132: Memoize date grouping, validate nutrition snapshot, and separate completed vs active drafts
  const {
    standaloneApple,
    showApple,
    workoutsByDate,
    completedWorkoutsByDate,
    appleByDate,
    dietsByDate,
    schedByDate,
    completeSet,
    totalWorkouts,
    calorieDays,
    avgCalories,
    completeDietDays,
    futurePlannedCount,
  } = useMemo(() => {
    const standalone = appleEntries.filter((r) => !r.manualWorkoutId);
    const hasApple = Boolean(
      appleHealthConnected || standalone.length > 0 || [...appleDailyMap.values()].some(hasAppleTelemetry),
    );
    const allWByDate = groupByDate(workouts, (r) => r.data?.date);
    const doneWByDate = groupByDate(
      workouts.filter((r) => r.data?.status === "completed"),
      (r) => r.data?.date,
    );
    const aByDate = groupByDate(standalone, (r) => r.date);
    const dByDate = groupByDate(diets, (r) => r.data?.date);
    const sByDate = new Map(schedDays.map((s) => [s.date, s]));

    // #131: Validate nutritionDay snapshot against actual meal versions/ids (matches @ironlog/shared nutritionDayComplete)
    const validComplete = new Set<string>();
    for (const nd of nutritionDays) {
      if (nd.deleted || !nd.data?.complete) continue;
      const dayMeals = dByDate.get(nd.data.date) ?? [];
      if (!dayMeals.length) continue;
      const snap = (nd.data as { meals?: Array<{ id: string; version: number }> }).meals;
      if (Array.isArray(snap)) {
        const mealVerMap = new Map(dayMeals.map((m) => [m.id, m.version]));
        if (snap.length === dayMeals.length && snap.every((s) => mealVerMap.get(s.id) === s.version)) {
          validComplete.add(nd.data.date);
        }
      } else {
        validComplete.add(nd.data.date);
      }
    }

    let totWorkouts = 0;
    let calDays = 0;
    let totCalories = 0;
    let compDietDays = 0;
    let futPlanned = 0;
    for (let i = 0; i < days; i++) {
      const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
      const doneList = doneWByDate.get(iso) ?? [];
      const aList = aByDate.get(iso) ?? [];
      const dList = dByDate.get(iso) ?? [];
      const sched = sByDate.get(iso);

      if (doneList.length || aList.length) {
        totWorkouts += doneList.length + aList.length;
      }
      if (dList.length) {
        calDays++;
        totCalories += dList.reduce((sum, r) => sum + (r.data.calories || 0), 0);
        if (validComplete.has(iso)) compDietDays++;
      }
      if (iso >= todayKey && !doneList.length && !aList.length && (sched?.status === "scheduled" || sched?.status === "projected")) {
        futPlanned++;
      }
    }
    return {
      standaloneApple: standalone,
      showApple: hasApple,
      workoutsByDate: allWByDate,
      completedWorkoutsByDate: doneWByDate,
      appleByDate: aByDate,
      dietsByDate: dByDate,
      schedByDate: sByDate,
      completeSet: validComplete,
      totalWorkouts: totWorkouts,
      calorieDays: calDays,
      avgCalories: calDays ? Math.round(totCalories / calDays) : 0,
      completeDietDays: compDietDays,
      futurePlannedCount: futPlanned,
    };
  }, [workouts, appleEntries, appleDailyMap, appleHealthConnected, diets, schedDays, nutritionDays, days, month, todayKey]);

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
        <div className="cal-mast-copy">
          <div className="cal-mast-title">
            <h1>日历</h1>
            <span className="cal-mast-matrix">
              <MatrixText value={month.replace("-", ".")} />
            </span>
          </div>
          <p>
            {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
          </p>
        </div>
        <div className="segments" role="group" aria-label="日历视图过滤">
          {(
            [
              ["all", "全部"],
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
              <label className="calendar-month-picker" aria-label="选择年月" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <h2 className="calendar-month-title">
                  {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
                </h2>
                <input
                  type="month"
                  aria-label="跳转到指定月份"
                  value={month}
                  min="1902-01"
                  max={maxMonth}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^\d{4}-\d{2}$/.test(val) && val <= maxMonth) {
                      setMonth(val);
                      setSelectedDate(val === todayKey.slice(0, 7) ? todayKey : `${val}-01`);
                    }
                  }}
                  style={{ width: 22, opacity: 0.72, cursor: "pointer", border: 0, background: "transparent", padding: 0 }}
                />
              </label>
              {monthLoading ? <span className="calendar-month-sync-badge">同步中…</span> : null}
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
                {schedError && !schedLoaded ? (
                  <small>暂不可用</small>
                ) : (
                  <>
                    {futurePlannedCount} <small>场</small>
                  </>
                )}
              </strong>
            </div>
          </div>
          {schedError ? (
            <div className="form-error" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "8px 0" }}>
              <span>月排期刷新失败：{schedError}</span>
              <button type="button" className="quiet" onClick={() => setSchedRetrySeq((n) => n + 1)}>
                重试
              </button>
            </div>
          ) : null}

          <div className={`calendar-grid${monthLoading ? " is-month-loading" : ""}`}>
            {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
              <span key={d}>周{d}</span>
            ))}
            {Array.from({ length: beginning }, (_, idx) => (
              <div key={`pad-${idx}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const cell = `${month}-${String(i + 1).padStart(2, "0")}`;
              const cellAllWorkouts = workoutsByDate.get(cell) ?? [];
              const cellWorkouts = completedWorkoutsByDate.get(cell) ?? [];
              const cellActiveDrafts = cellAllWorkouts.filter((w) => w.data.status === "active");
              const cellApple = appleByDate.get(cell) ?? [];
              const cellDiets = dietsByDate.get(cell) ?? [];
              const sched = schedByDate.get(cell);

              // #132: Only count COMPLETED workouts + Apple workouts toward trained cell & monthly count
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
                : cellActiveDrafts.length > 0
                  ? "进行中"
                  : hasPlanned
                    ? fullWorkoutTag(sched?.title ?? "")
                    : isRestSched
                      ? "休息"
                      : "";
              const shortTrainLabel = workoutCount
                ? `${compactWorkoutTag(rawTrainTitle || "训练")}${countSuffix}`
                : cellActiveDrafts.length > 0
                  ? "进行中"
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
                !workoutCount && cellActiveDrafts.length > 0 ? "has-active-draft" : "",
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
              else if (cellActiveDrafts.length > 0) ariaParts.push("进行中训练草稿");
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
