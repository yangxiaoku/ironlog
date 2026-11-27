import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { cachedApiFetch } from "../../lib/query-cache";
import { duration, fmt, formatWeekdayZh, shortDate, today } from "../../lib/date";
import {
  FEELINGS,
  MEALS,
  shiftDateStr,
  workoutSeconds,
  type CatalogueExercise,
  type DietData,
  type ProfileGoals,
  type RecordEnvelope,
  type WeightData,
  type WorkoutData,
} from "../../lib/domain";
import {
  openAppleDailyDetailsModal,
  openAppleWorkoutDetailsModal,
  openDailyShareModal,
  openDayScheduler,
  openDietEditor,
  openRoutinePreview,
  openWeightEditor,
  openWorkoutEditor,
  openWorkoutReport,
} from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";
import { DotMeter } from "../Meters";
import { AppleDailyStrip, AppleLine, type AppleDailyEntry, type AppleWorkoutAgendaItem } from "../apple/AppleHealthModals";
import type { ScheduleDayEntry } from "../plan/PlanModals";

const APPLE_DAILY_TELEMETRY_KEYS: ReadonlyArray<keyof AppleDailyEntry> = [
  "sleepMinutes",
  "weightKg",
  "bodyFatPct",
  "waistCm",
  "steps",
  "activeEnergyKcal",
  "totalEnergyKcal",
  "restingHeartRateBpm",
  "hrvMs",
  "bloodOxygenPct",
  "respiratoryRate",
  "vo2Max",
];

export function hasAppleTelemetry(daily: AppleDailyEntry | null | undefined): boolean {
  return Boolean(daily && APPLE_DAILY_TELEMETRY_KEYS.some((k) => daily[k] != null));
}

export interface DayScheduleDetail {
  date: string;
  telemetry?: {
    summary?: { progressionCount?: number; prOpportunityCount?: number };
    exercises?: Array<{
      item: { exerciseId: string; sets: number };
      exercise?: { name?: string; mode?: string };
      weight: number | null;
      reps: number;
      seconds: number;
      progression: { statusLabel: string };
    }>;
  } | null;
  weekForecast?: { conflicts?: string[] } | null;
  override?: { version?: number } | null;
}

function computeWorkoutSummary(data: WorkoutData, catalogueMap: Map<string, CatalogueExercise>) {
  let volume = 0;
  let completedSets = 0;
  const exercises: Array<{ name: string; sets: number; best: string }> = [];
  for (const row of data.exercises ?? []) {
    const exInfo = row.snapshot ?? catalogueMap.get(row.exerciseId);
    const name = exInfo?.name ?? row.exerciseId;
    const mode = exInfo?.mode ?? "reps";
    const mult = exInfo?.volumeMultiplier ?? 1;
    const work = (row.sets ?? []).filter((s) => s.completed && s.type !== "warmup");
    const done = (row.sets ?? []).filter((s) => s.completed);
    completedSets += work.length;
    if (mode === "reps") {
      for (const s of work) {
        if (s.weight > 0 && s.reps > 0) volume += s.weight * s.reps * mult;
      }
    }
    let best = `${done.length} 组`;
    if (work.length) {
      if (mode === "timed") {
        best = `${Math.max(...work.map((s) => s.seconds || 0))}s`;
      } else {
        let top = work[0]!;
        for (let i = 1; i < work.length; i++) {
          const s = work[i]!;
          const w = s.weight || 0;
          const tw = top.weight || 0;
          const r = s.reps || 0;
          const tr = top.reps || 0;
          const better = mode === "assisted" ? w < tw || (w === tw && r > tr) : w > tw || (w === tw && r > tr);
          if (better) top = s;
        }
        const topW = top.weight || 0;
        const topR = top.reps || 0;
        best =
          topW > 0
            ? `${mode === "assisted" ? "助" : ""}${fmt(topW)}kg×${topR}`
            : topR > 0
              ? `${topR}次`
              : `${work.length} 组`;
      }
    }
    exercises.push({ name, sets: done.length || row.sets?.length || 0, best });
  }
  return {
    volume: Math.round(volume * 10) / 10,
    completedSets,
    seconds: workoutSeconds(data),
    exercises,
  };
}

export interface DayDossierProps {
  date: string;
  todayKey: string;
  workouts: Array<RecordEnvelope<WorkoutData>>;
  appleEntries: AppleWorkoutAgendaItem[];
  appleDaily: AppleDailyEntry | null;
  appleHealthConnected: boolean;
  diets: Array<RecordEnvelope<DietData>>;
  weightRecord: RecordEnvelope<WeightData> | null;
  nutritionComplete: boolean;
  goals: ProfileGoals | null;
  daySched: DayScheduleDetail | null;
  schedSummary: ScheduleDayEntry | undefined;
  catalogueMap: Map<string, CatalogueExercise>;
  inModal?: boolean;
  loading?: boolean;
  onStepDate?: (newDate: string) => void;
}

export function DayDossier({
  date,
  todayKey,
  workouts,
  appleEntries,
  appleDaily,
  appleHealthConnected,
  diets,
  weightRecord,
  nutritionComplete,
  goals,
  daySched,
  schedSummary,
  catalogueMap,
  inModal = false,
  loading = false,
  onStepDate,
}: DayDossierProps) {
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const notify = useUiStore((s) => s.notify);
  const [completingDiet, setCompletingDiet] = useState(false);

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const isFuture = date > todayKey;
  const totalKcal = Math.round(diets.reduce((sum, r) => sum + (r.data.calories || 0), 0));
  const totalP = Math.round(diets.reduce((sum, r) => sum + (r.data.protein || 0), 0));
  const totalC = Math.round(diets.reduce((sum, r) => sum + (r.data.carbs || 0), 0));
  const totalF = Math.round(diets.reduce((sum, r) => sum + (r.data.fat || 0), 0));
  const targetKcal = goals?.calories ?? 2200;

  let dayVolume = 0;
  let daySeconds = 0;
  const workoutStatsList = workouts.map((rec) => {
    const st = computeWorkoutSummary(rec.data, catalogueMap);
    dayVolume += st.volume;
    daySeconds += st.seconds ?? 0;
    return { rec, st };
  });
  for (const ap of appleEntries) daySeconds += ap.durationSeconds ?? 0;

  const hasTrained = workouts.length > 0 || appleEntries.length > 0;
  const hasPlanned =
    !hasTrained && date >= todayKey && (schedSummary?.status === "scheduled" || schedSummary?.status === "projected");
  const isRest = !hasTrained && !hasPlanned && schedSummary?.source === "rest";

  const kpiTrainVal = hasTrained
    ? `${workouts.length + appleEntries.length} 场`
    : hasPlanned
      ? "已排期"
      : isRest
        ? "休息"
        : "—";
  const kpiTrainSub = hasTrained
    ? dayVolume > 0
      ? `${fmt(dayVolume)} kg`
      : daySeconds > 0
        ? duration(daySeconds)
        : "已打卡"
    : hasPlanned
      ? `${schedSummary?.exercisesCount ?? 0} 个动作`
      : isRest
        ? "主动恢复"
        : "未训练";
  const kpiKcalVal = diets.length ? fmt(totalKcal, 0) : "—";
  const kpiKcalSub = diets.length ? `目标 ${fmt(targetKcal, 0)}` : isFuture ? "未来日期" : "未记录饮食";
  const kpiWeightVal = weightRecord
    ? `${fmt(weightRecord.data.weight, 2)}`
    : appleDaily?.weightKg != null
      ? `${fmt(appleDaily.weightKg, 2)}`
      : "—";
  const kpiWeightSub = weightRecord
    ? weightRecord.data.bodyFat != null
      ? `体脂 ${fmt(weightRecord.data.bodyFat)}%`
      : "kg · 点击修改"
    : appleDaily?.weightKg != null
      ? `Apple 同步${appleDaily.bodyFatPct != null ? ` · ${fmt(appleDaily.bodyFatPct, 1)}%` : ""}`
      : "未称重";

  const mealOrder: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
  const sortedDiets = [...diets].sort((a, b) => (mealOrder[a.data.meal] ?? 9) - (mealOrder[b.data.meal] ?? 9));

  const handleCompleteDiet = async () => {
    if (completingDiet) return;
    setCompletingDiet(true);
    try {
      await apiFetch("/api/web/nutrition-day", { method: "PUT", body: { date, opId: crypto.randomUUID() } });
      bumpDataEpoch();
      notify(`${shortDate(date)} 饮食已标记完整`);
    } catch (err) {
      notify((err as Error)?.message || "标记失败");
    } finally {
      setCompletingDiet(false);
    }
  };

  const handleShiftDay = async () => {
    try {
      await apiFetch("/api/web/schedule/shift", {
        method: "POST",
        body: { fromDate: date, toDate: shiftDateStr(date, 1) },
      });
      bumpDataEpoch();
      if (inModal) closeAllModals();
      notify(`已顺延至 ${shortDate(shiftDateStr(date, 1))}`);
    } catch (err) {
      notify((err as Error)?.message || "顺延失败");
    }
  };

  const handleSetRest = async () => {
    try {
      let baseVersion = typeof daySched?.override?.version === "number" ? daySched.override.version : null;
      if (baseVersion === null) {
        const fresh = await apiFetch<DayScheduleDetail>(`/api/web/schedule/${encodeURIComponent(date)}`).catch(() => null);
        baseVersion = typeof fresh?.override?.version === "number" ? fresh.override.version : 0;
      }
      await apiFetch(`/api/web/schedule/${encodeURIComponent(date)}`, {
        method: "PUT",
        body: { mode: "rest", title: "休息日", notes: "", exercises: [], baseVersion },
      });
      bumpDataEpoch();
      notify(`${shortDate(date)} 已设为休息日`);
    } catch (err) {
      notify((err as Error)?.message || "操作失败");
    }
  };

  const handleClearSched = async () => {
    try {
      await apiFetch(`/api/web/schedule/${encodeURIComponent(date)}`, { method: "DELETE" });
      bumpDataEpoch();
      notify(`${shortDate(date)} 已恢复默认顺排`);
    } catch (err) {
      notify((err as Error)?.message || "操作失败");
    }
  };

  const diffDays = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86400000);
  const relLabel =
    diffDays === 0
      ? "今天"
      : diffDays === -1
        ? "昨天"
        : diffDays === 1
          ? "明天"
          : diffDays < 0
            ? `${Math.abs(diffDays)} 天前`
            : `${diffDays} 天后`;

  const showDailyStrip = Boolean(appleDaily && hasAppleTelemetry(appleDaily) && (appleHealthConnected || hasAppleTelemetry(appleDaily)));
  const ratio = targetKcal > 0 ? totalKcal / targetKcal : 0;

  return (
    <div
      className={`cal-dossier${inModal ? " in-modal" : ""}`}
      onTouchStart={(e) => {
        if (!inModal || !onStepDate || e.touches.length !== 1) return;
        const t = e.touches[0]!;
        if (t.clientX < 24 || (typeof window !== "undefined" && t.clientX > window.innerWidth - 24)) {
          swipeStartRef.current = null;
          return;
        }
        swipeStartRef.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!inModal || !onStepDate || !start || e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          onStepDate(shiftDateStr(date, dx < 0 ? 1 : -1));
        }
      }}
    >
      {inModal && onStepDate ? (
        <div className="dossier-day-stepper">
          <button
            type="button"
            className="quiet day-step-btn"
            onClick={() => onStepDate(shiftDateStr(date, -1))}
          >
            <Icon name="back" size={14} /> 前一天
          </button>
          <span className="dossier-step-date">
            <strong>{relLabel}</strong>
            {loading ? <span className="calendar-month-sync-badge">刷新当日…</span> : null}
            {diffDays !== 0 ? (
              <button type="button" className="dossier-today-chip" onClick={() => onStepDate(todayKey)}>
                回今天
              </button>
            ) : null}
          </span>
          <button
            type="button"
            className="quiet day-step-btn"
            onClick={() => onStepDate(shiftDateStr(date, 1))}
          >
            后一天 <Icon name="chevron" size={14} />
          </button>
        </div>
      ) : null}

      <div className="dossier-kpis">
        <div>
          <span>训练</span>
          <strong>{kpiTrainVal}</strong>
          <small>{kpiTrainSub}</small>
        </div>
        <div>
          <span>摄入热量</span>
          <strong>{kpiKcalVal}</strong>
          <small>{kpiKcalSub}</small>
        </div>
        <div>
          <span>体重</span>
          <strong>{kpiWeightVal}</strong>
          <small>{kpiWeightSub}</small>
        </div>
      </div>

      {/* Section 1: Training */}
      {hasTrained ? (
        <section className="dossier-block">
          <header className="dossier-head">
            <h3>
              <Icon name="workout" size={15} /> 训练明细
            </h3>
            {!isFuture ? (
              <button type="button" className="quiet" onClick={() => openWorkoutEditor(undefined, goals, { date })}>
                <Icon name="plus" size={14} /> 补录训练
              </button>
            ) : null}
          </header>
          <div className="dossier-cards">
            {workoutStatsList.map(({ rec, st }) => (
              <article key={rec.id} className="dossier-workout-card">
                <header>
                  <div>
                    <strong>{rec.data.title}</strong>
                    <small>
                      {rec.data.status === "active" ? "进行中" : duration(st.seconds)}
                      {rec.data.feeling ? ` · ${FEELINGS[rec.data.feeling]}` : ""}
                      {st.volume > 0 ? ` · ${fmt(st.volume)} kg` : ""}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() =>
                      rec.data.status === "completed"
                        ? openWorkoutReport(rec.id, rec, goals)
                        : openWorkoutEditor(rec, goals)
                    }
                  >
                    查看详情 <Icon name="chevron" size={13} />
                  </button>
                </header>
                {st.exercises.length ? (
                  <ul className="dossier-ex-list">
                    {st.exercises.map((ex, i) => (
                      <li key={i}>
                        <span>{ex.name}</span>
                        <small>
                          {ex.sets} 组 · {ex.best}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {appleEntries.map((ap) => (
              <AppleLine key={ap.id} item={ap} onClick={() => openAppleWorkoutDetailsModal(ap)} />
            ))}
          </div>
        </section>
      ) : date >= todayKey ? (
        hasPlanned && schedSummary ? (
          <section className="dossier-block">
            <header className="dossier-head">
              <h3>
                <Icon name="plan" size={15} /> 排期训练
              </h3>
              <span className={`drawer-badge${schedSummary.status === "scheduled" ? " is-manual" : " is-plan"}`}>
                {schedSummary.status === "scheduled" ? "手动排期" : "计划顺排"}
              </span>
            </header>
            <div className="cal-schedule-preview">
              <div className="hero-drawer-title">
                <strong>{schedSummary.title}</strong>
              </div>
              <div className="hero-drawer-tags">
                <span>{schedSummary.exercisesCount} 个动作</span>
                <span>约 {schedSummary.estimatedMinutes} 分钟</span>
                {daySched?.telemetry?.summary?.progressionCount ? (
                  <span>{daySched.telemetry.summary.progressionCount} 项渐进</span>
                ) : null}
                {daySched?.telemetry?.summary?.prOpportunityCount ? (
                  <span>{daySched.telemetry.summary.prOpportunityCount} 个 PR 机会</span>
                ) : null}
              </div>
              {daySched?.weekForecast?.conflicts?.length ? (
                <p className="forecast-conflict">
                  {daySched.weekForecast.conflicts[0]}
                </p>
              ) : null}
              {daySched?.telemetry?.exercises?.length ? (
                <ol className="cal-ex-preview">
                  {daySched.telemetry.exercises.map((ex, idx) => (
                    <li key={`${ex.item.exerciseId}-${idx}`}>
                      <span>
                        <b>{String(idx + 1).padStart(2, "0")}</b> {ex.exercise?.name ?? ex.item.exerciseId}
                      </span>
                      <small>
                        {ex.item.sets}组 ·{" "}
                        {ex.exercise?.mode === "timed"
                          ? `${ex.seconds}秒`
                          : `${ex.weight ? `${fmt(ex.weight)}kg × ` : ""}${ex.reps}次`}{" "}
                        · {ex.progression.statusLabel}
                      </small>
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="hero-drawer-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openRoutinePreview({ id: date, source: "scheduled", date })}
                >
                  {date === todayKey ? "开始训练" : "动作与 PR"}
                </button>
                <button type="button" className="secondary-button" onClick={() => openDayScheduler(date)}>
                  调整排期
                </button>
                <button type="button" className="quiet" onClick={() => void handleShiftDay()}>
                  顺延+1
                </button>
                <button type="button" className="quiet" onClick={() => void handleSetRest()}>
                  设休息
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="dossier-block">
            <header className="dossier-head">
              <h3>
                <Icon name="plan" size={15} /> {isRest ? "休息日 · 主动恢复" : "训练排期"}
              </h3>
              <button type="button" className="secondary-button" onClick={() => openDayScheduler(date)}>
                <Icon name="plus" size={14} /> 排训练
              </button>
            </header>
            <p className="muted dossier-empty-note">
              {schedSummary?.notes || "当天暂未安排训练，可排入计划日或训练模板。"}
            </p>
            {daySched?.override ? (
              <div className="hero-drawer-actions">
                <button type="button" className="quiet" onClick={() => void handleClearSched()}>
                  恢复默认顺排
                </button>
              </div>
            ) : null}
          </section>
        )
      ) : (
        <section className="dossier-block">
          <header className="dossier-head">
            <h3>
              <Icon name="workout" size={15} /> 训练记录
            </h3>
            <button type="button" className="quiet" onClick={() => openWorkoutEditor(undefined, goals, { date })}>
              <Icon name="plus" size={14} /> 补录训练
            </button>
          </header>
          <p className="muted dossier-empty-note">这一天暂无训练记录，可随时补录。</p>
        </section>
      )}

      {/* Section 2: Diet */}
      {diets.length ? (
        <section className="dossier-block">
          <header className="dossier-head">
            <h3>
              <Icon name="diet" size={15} /> 饮食与热量
            </h3>
            <div className="dossier-head-right">
              {nutritionComplete ? (
                <span className="tile-badge">全天完整</span>
              ) : !isFuture ? (
                <button type="button" className="quiet" disabled={completingDiet} onClick={() => void handleCompleteDiet()}>
                  标记完整
                </button>
              ) : null}
              {!isFuture ? (
                <button type="button" className="quiet" onClick={() => openDietEditor({ date, meal: "snack" })}>
                  <Icon name="plus" size={14} /> 记饮食
                </button>
              ) : null}
            </div>
          </header>
          <div className="dossier-kcal-summary">
            <div className="dossier-kcal-main">
              <strong>
                {fmt(totalKcal, 0)} <small>kcal</small>
              </strong>
              <span>目标 {fmt(targetKcal, 0)} kcal</span>
            </div>
            <DotMeter ratio={ratio} count={14} />
            <div className="dossier-macros">
              <span>蛋白 <b>{fmt(totalP, 0)}g</b></span>
              <span>碳水 <b>{fmt(totalC, 0)}g</b></span>
              <span>脂肪 <b>{fmt(totalF, 0)}g</b></span>
            </div>
          </div>
          <div className="dossier-meal-list">
            {sortedDiets.map((rec) => (
              <button
                key={rec.id}
                type="button"
                className="dossier-meal-row"
                onClick={() => openDietEditor({ record: rec })}
              >
                <span className="dossier-meal-tag">{MEALS[rec.data.meal] ?? rec.data.meal}</span>
                <span className="dossier-meal-copy">
                  <strong>{rec.data.name}</strong>
                  <small>
                    蛋 {fmt(rec.data.protein, 0)}g · 碳 {fmt(rec.data.carbs, 0)}g · 脂 {fmt(rec.data.fat, 0)}g
                  </small>
                </span>
                <span className="dossier-meal-kcal">
                  {fmt(rec.data.calories, 0)} <small>kcal</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : !isFuture ? (
        <section className="dossier-block">
          <header className="dossier-head">
            <h3>
              <Icon name="diet" size={15} /> 饮食与热量
            </h3>
            <button type="button" className="quiet" onClick={() => openDietEditor({ date, meal: "lunch" })}>
              <Icon name="plus" size={14} /> 记饮食
            </button>
          </header>
          <p className="muted dossier-empty-note">当天暂无饮食记录。</p>
        </section>
      ) : null}

      {/* Section 3: Weight */}
      {!isFuture ? (
        <section className="dossier-block dossier-weight-row">
          <span className="dossier-weight-label">
            <Icon name="weight" size={15} /> 当日体重
          </span>
          {weightRecord ? (
            <button type="button" className="quiet" onClick={() => openWeightEditor({ record: weightRecord })}>
              <b>{fmt(weightRecord.data.weight, 2)} kg</b>
              {weightRecord.data.bodyFat != null ? ` · 体脂 ${fmt(weightRecord.data.bodyFat)}%` : ""}{" "}
              <Icon name="chevron" size={13} />
            </button>
          ) : appleDaily?.weightKg != null ? (
            <button
              type="button"
              className="quiet"
              onClick={() =>
                openWeightEditor({
                  date,
                  defaultWeight: appleDaily.weightKg ?? null,
                })
              }
            >
              <Icon name="heart" size={14} /> 转入 Apple {fmt(appleDaily.weightKg, 2)} kg
            </button>
          ) : (
            <button type="button" className="quiet" onClick={() => openWeightEditor({ date })}>
              <Icon name="plus" size={14} /> 记体重
            </button>
          )}
        </section>
      ) : null}

      {/* Section 4: Apple Health Daily */}
      {!isFuture && showDailyStrip && appleDaily ? (
        <AppleDailyStrip daily={appleDaily} compact onOpenDetails={(d) => openAppleDailyDetailsModal(d)} />
      ) : null}

      {inModal && !isFuture ? (
        <div className="dossier-share-foot">
          <button type="button" className="secondary-button" onClick={() => openDailyShareModal(date)}>
            <Icon name="download" size={15} /> 分享记录
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Self-contained Calendar Day Dossier Modal supporting prev/next stepping across months.
 */
export function CalendarDayModal({
  initialDate,
  onDateChange,
}: {
  initialDate: string;
  onDateChange?: (d: string) => void;
}) {
  const userId = useAuthStore((s) => s.userId);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const updateTopModalTitle = useUiStore((s) => s.updateTopModalTitle);

  const [date, setDate] = useState(initialDate);
  const [loading, setLoading] = useState(true);
  const [propsData, setPropsData] = useState<Omit<DayDossierProps, "inModal" | "loading" | "onStepDate"> | null>(null);

  useEffect(() => {
    let active = true;
    const todayKey = today();
    setLoading(true);
    void (async () => {
      try {
        const [workouts, diets, weights, nutritionDays, profileRes, appleWorkouts, dailyRes, schedRes, dayDetail] =
          await Promise.all([
            cachedApiFetch<Array<RecordEnvelope<WorkoutData>>>("/api/records/workout", { epoch: dataEpoch, userId }),
            cachedApiFetch<Array<RecordEnvelope<DietData>>>("/api/records/diet", { epoch: dataEpoch, userId }),
            cachedApiFetch<Array<RecordEnvelope<WeightData>>>("/api/records/weight", { epoch: dataEpoch, userId }).catch(() => []),
            cachedApiFetch<Array<RecordEnvelope<{ date: string; complete?: boolean }>>>("/api/records/nutritionDay", {
              epoch: dataEpoch,
              userId,
            }).catch(() => []),
            cachedApiFetch<{ profile: ProfileGoals }>("/api/web/profile", { epoch: dataEpoch, userId }).catch(() => null),
            date <= todayKey
              ? cachedApiFetch<AppleWorkoutAgendaItem[]>(
                  `/api/integrations/apple-health/agenda?from=${date}&through=${date}`,
                  { epoch: dataEpoch, userId },
                ).catch(() => [])
              : Promise.resolve([]),
            date <= todayKey
              ? cachedApiFetch<{ entries?: AppleDailyEntry[] }>(
                  `/api/integrations/apple-health/daily?from=${date}&through=${date}`,
                  { epoch: dataEpoch, userId },
                ).catch(() => ({ entries: [] }))
              : Promise.resolve({ entries: [] }),
            cachedApiFetch<{ days: ScheduleDayEntry[] }>(`/api/web/schedule?from=${date}&through=${date}`, {
              epoch: dataEpoch,
              userId,
            }).catch(() => null),
            date >= todayKey
              ? cachedApiFetch<DayScheduleDetail>(`/api/web/schedule/${encodeURIComponent(date)}`, {
                  epoch: dataEpoch,
                  userId,
                }).catch(() => null)
              : Promise.resolve(null),
          ]);

        const dayWorkouts = workouts.filter((r) => !r.deleted && r.data.status !== "cancelled" && r.data.date === date);
        const dayDiets = diets.filter((r) => !r.deleted && r.data.date === date);
        const weightRec = weights.find((r) => !r.deleted && r.data.date === date) ?? null;
        const nutritionComplete = nutritionDays.some((r) => !r.deleted && r.data?.complete && r.data.date === date);
        const catMap = await import("../../lib/catalogue").then((m) =>
          m.resolveCatalogueMap(dayWorkouts.flatMap((w) => w.data.exercises?.map((e) => e.exerciseId) ?? [])),
        );
        if (!active) return;
        setPropsData({
          date,
          todayKey,
          workouts: dayWorkouts,
          appleEntries: appleWorkouts.filter((a) => !a.manualWorkoutId && a.date === date),
          appleDaily: (dailyRes.entries ?? []).find((d) => d.date === date) ?? null,
          appleHealthConnected,
          diets: dayDiets,
          weightRecord: weightRec,
          nutritionComplete,
          goals: profileRes?.profile ?? null,
          daySched: dayDetail,
          schedSummary: schedRes?.days?.find((d) => d.date === date),
          catalogueMap: catMap,
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [date, appleHealthConnected, dataEpoch, userId]);

  const handleStep = (nextDate: string) => {
    setDate(nextDate);
    updateTopModalTitle(`${shortDate(nextDate)} 训练日程`);
    onDateChange?.(nextDate);
  };

  if (loading && !propsData) {
    return (
      <div className="cal-dossier in-modal">
        <p className="muted" style={{ padding: "18px 0" }}>
          正在读取 {shortDate(date)} ({formatWeekdayZh(date)}) 当日明细…
        </p>
      </div>
    );
  }
  if (!propsData) return null;

  return <DayDossier {...propsData} inModal loading={loading} onStepDate={handleStep} />;
}
