import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiFetch } from "../../lib/api";
import { resolveCatalogueMap } from "../../lib/catalogue";
import { fmt, formatWeekdayZh, shortDate, today } from "../../lib/date";
import {
  shiftDateStr,
  type CatalogueExercise,
  type MuscleKey,
  type OverviewStatsResponse,
  type PlanData,
  type PlanRoutine,
  type PlannedExercise,
  type ProfileGoals,
  type RecordEnvelope,
  type WorkoutData,
} from "../../lib/domain";
import { useUiStore } from "../../store/useUiStore";
import {
  WORKOUT_PREFS_EVENT,
  applyDeloadToTarget,
  readWorkoutPreferences,
  writeWorkoutPreference,
} from "../../lib/workout-helpers";
import { buildWorkoutSeedFromRoutine } from "../../lib/routine-launch";
import { Icon } from "../Icon";
import { exportPlanAsJson } from "../settings/DataModals";
import {
  MuscleDistributionSummary,
  PlannedExerciseList,
  sanitizePlannedExercises,
  supersetBadges,
  type ExercisePrInfo,
} from "./PlannedExerciseList";

const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function safeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchMissingPrs(
  ids: string[],
  current: Map<string, ExercisePrInfo>,
  setPrMap: Dispatch<SetStateAction<Map<string, ExercisePrInfo>>>,
  dateRef = "2099-12-31",
): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => id && !current.has(id));
  if (!missing.length) return;
  try {
    const prs = await apiFetch<ExercisePrInfo[]>("/api/web/exercise-prs", {
      method: "POST",
      body: {
        date: dateRef,
        startedAt: `${dateRef}T23:59:59Z`,
        exercises: missing.map((id) => ({ id })),
      },
    });
    if (!prs.length) return;
    setPrMap((prev) => {
      const next = new Map(prev);
      for (const p of prs) next.set(p.exerciseId, p);
      return next;
    });
  } catch {}
}

export interface ScheduleDayEntry {
  date: string;
  status: "completed" | "scheduled" | "projected" | "rest" | "empty";
  source: string;
  title: string;
  notes?: string;
  exercisesCount: number;
  estimatedMinutes: number;
  muscles: MuscleKey[];
  planId?: string | null;
  routineId?: string | null;
  routine?: { id: string; name: string; exercises: PlannedExercise[] } | null;
}

export interface ScheduleResponse {
  days: ScheduleDayEntry[];
  weekForecast?: {
    weekStart: string;
    weekEnd: string;
    muscles: Array<{ key: MuscleKey; completed: number; planned: number; total: number }>;
    conflicts?: string[];
  } | null;
  activePlan?: { id: string; routines: PlanRoutine[] } | null;
  templates?: Array<{ id: string; name: string; exercises: PlannedExercise[] }>;
}

interface ScheduleDetailResponse {
  date: string;
  day: ScheduleDayEntry;
  override?: {
    version: number;
    data: {
      mode: "workout" | "rest";
      title: string;
      notes?: string;
      planId?: string | null;
      routineId?: string | null;
      templateId?: string | null;
      exercises: PlannedExercise[];
    };
  } | null;
  adjacent?: {
    previous?: { title: string } | null;
    next?: { title: string } | null;
  } | null;
  weekForecast?: ScheduleResponse["weekForecast"];
  telemetry?: {
    summary?: { prOpportunityCount?: number; deloadCount?: number };
  } | null;
}

export function DaySchedulerModal({
  date,
  onSaved,
  onStartPreview,
}: {
  date: string;
  onSaved?: (savedDate: string) => void;
  onStartPreview?: (date: string) => void;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<ScheduleDetailResponse | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [recentWorkouts, setRecentWorkouts] = useState<Array<RecordEnvelope<WorkoutData>>>([]);
  const [catalogueMap, setCatalogueMap] = useState<Map<string, CatalogueExercise>>(() => new Map());
  const [prMap, setPrMap] = useState<Map<string, ExercisePrInfo>>(() => new Map());

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<PlannedExercise[]>([]);
  // #160: Sequence guard so late-returning template/preset catalogue fetches never overwrite a newer selection
  const presetSeqRef = useRef(0);
  const [applyingPresetName, setApplyingPresetName] = useState("");

  useEffect(() => {
    let active = true;
    const todayDate = today();
    const rangeFrom = shiftDateStr(date, -6);
    const rangeThrough = shiftDateStr(date, 13);
    setLoading(true);
    void (async () => {
      try {
        const [det, sched, workouts] = await Promise.all([
          apiFetch<ScheduleDetailResponse>(`/api/web/schedule/${encodeURIComponent(date)}`),
          apiFetch<ScheduleResponse>(`/api/web/schedule?${new URLSearchParams({ from: rangeFrom, through: rangeThrough })}`),
          apiFetch<Array<RecordEnvelope<WorkoutData>>>("/api/records/workout").catch(() => []),
        ]);
        const initEx =
          det.override?.data?.mode === "workout"
            ? det.override.data.exercises
            : det.day?.routine?.exercises ?? [];
        const allIds = [
          ...initEx.flatMap((e) => [e.exerciseId, e.backupExerciseId ?? ""].filter(Boolean)),
          ...(sched.activePlan?.routines ?? []).flatMap((r) => r.exercises.map((e) => e.exerciseId)),
        ];
        const [catMap, prList] = await Promise.all([
          resolveCatalogueMap(allIds),
          allIds.length
            ? apiFetch<ExercisePrInfo[]>("/api/web/exercise-prs", {
                method: "POST",
                body: {
                  date: shiftDateStr(todayDate, 1),
                  startedAt: `${shiftDateStr(todayDate, 1)}T23:59:59Z`,
                  exercises: [...new Set(allIds)].map((id) => ({ id })),
                },
              }).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (!active) return;
        setDetail(det);
        setSchedule(sched);
        setRecentWorkouts(
          workouts
            .filter((w) => !w.deleted && w.data.status === "completed" && w.data.exercises?.length)
            .sort((a, b) => b.data.date.localeCompare(a.data.date))
            .slice(0, 5),
        );
        setCatalogueMap(catMap);
        setPrMap(new Map(prList.map((b) => [b.exerciseId, b])));
        setTitle(det.override?.data?.title || (det.day?.routine ? det.day.title : ""));
        setNotes(det.override?.data?.notes ?? "");
        setPlanId(det.override?.data?.planId ?? det.day?.planId ?? null);
        setRoutineId(det.override?.data?.routineId ?? det.day?.routineId ?? null);
        setTemplateId(det.override?.data?.templateId ?? null);
        setExercises(initEx.map((e) => ({ ...e })));
      } catch (err) {
        if (active) setError((err as Error)?.message || "读取当日排期失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [date]);

  if (loading) {
    return (
      <div className="empty loading" role="status">
        正在读取当日排期与 PR 基准…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="dialog-form">
        <p className="form-error" role="alert">
          {error || "无法读取排期详情"}
        </p>
      </div>
    );
  }

  const currentDay = detail.day;
  const baseVersion = detail.override?.version ?? 0;
  const isRest = detail.override?.data?.mode === "rest" || (!currentDay?.routine && currentDay?.source === "rest");
  const conflicts = detail.weekForecast?.conflicts ?? [];
  const telemetry = detail.telemetry;

  const mergeCatalogue = async (ids: string[]) => {
    const missing = ids.filter((id) => id && !catalogueMap.has(id));
    if (!missing.length) return catalogueMap;
    const fetched = await resolveCatalogueMap(missing);
    let merged = catalogueMap;
    setCatalogueMap((prev) => {
      const next = new Map(prev);
      fetched.forEach((v, k) => next.set(k, v));
      merged = next;
      return next;
    });
    return merged;
  };

  const applyPlanPreset = async (r: PlanRoutine) => {
    const seq = ++presetSeqRef.current;
    setError("");
    setApplyingPresetName(r.name);
    const ids = r.exercises.flatMap((e) => [e.exerciseId, e.backupExerciseId ?? ""].filter(Boolean));
    try {
      await mergeCatalogue(ids);
      if (seq !== presetSeqRef.current) return;
      void fetchMissingPrs(ids, prMap, setPrMap, shiftDateStr(today(), 1));
      setTitle(r.name);
      setPlanId(schedule?.activePlan?.id ?? null);
      setRoutineId(r.id);
      setTemplateId(null);
      setExercises(r.exercises.map((e) => ({ ...e })));
    } finally {
      if (seq === presetSeqRef.current) setApplyingPresetName("");
    }
  };

  const applyTemplatePreset = async (t: { id: string; name: string; exercises: PlannedExercise[] }) => {
    const seq = ++presetSeqRef.current;
    setError("");
    setApplyingPresetName(t.name);
    const ids = t.exercises.flatMap((e) => [e.exerciseId, e.backupExerciseId ?? ""].filter(Boolean));
    try {
      await mergeCatalogue(ids);
      if (seq !== presetSeqRef.current) return;
      void fetchMissingPrs(ids, prMap, setPrMap, shiftDateStr(today(), 1));
      setTitle(t.name);
      setPlanId(null);
      setRoutineId(null);
      setTemplateId(t.id);
      setExercises(t.exercises.map((e) => ({ ...e })));
    } finally {
      if (seq === presetSeqRef.current) setApplyingPresetName("");
    }
  };

  const applyHistoryPreset = async (w: RecordEnvelope<WorkoutData>) => {
    const seq = ++presetSeqRef.current;
    setError("");
    setApplyingPresetName(w.data.title);
    const ids = w.data.exercises.map((e) => e.exerciseId);
    try {
      const map = await mergeCatalogue(ids);
      if (seq !== presetSeqRef.current) return;
      void fetchMissingPrs(ids, prMap, setPrMap, shiftDateStr(today(), 1));
      setTitle(w.data.title);
      setPlanId(w.data.planId ?? null);
      setRoutineId(w.data.routineId ?? null);
      setTemplateId(null);
      setExercises(
        w.data.exercises.map((exRow) => {
          const info = map.get(exRow.exerciseId);
          const mode = info?.mode ?? exRow.snapshot?.mode ?? "reps";
          const timed = mode === "timed";
          const assisted = mode === "assisted";
          const work = exRow.sets.filter((s) => s.completed && s.type !== "warmup");
          const topWeight = work.length
            ? (assisted ? Math.min : Math.max)(...work.map((s) => s.weight))
            : null;
          const reps = work.length ? Math.max(...work.map((s) => s.reps)) : 8;
          const rowUnit = exRow.weightUnit === "lb" || exRow.weightUnit === "kg" ? exRow.weightUnit : undefined;
          return {
            exerciseId: exRow.exerciseId,
            sets: Math.max(1, work.length || exRow.sets.length || 3),
            repsMin: timed ? 1 : Math.max(1, Math.min(reps, 12)),
            repsMax: timed ? 1 : Math.max(Math.min(reps + 2, 15), reps, 10),
            weight: timed ? null : topWeight,
            ...(rowUnit ? { weightUnit: rowUnit } : {}),
            seconds: timed ? Math.max(15, ...exRow.sets.map((s) => s.seconds || 0)) : 0,
            restSeconds: exRow.restSeconds ?? 90,
            targetRir: 2,
            progression: timed ? "manual" : "double",
            increment: rowUnit === "lb" ? 5 : 2.5,
            backupExerciseId: null,
            supersetGroup: exRow.supersetGroup ?? null,
          };
        }),
      );
    } finally {
      if (seq === presetSeqRef.current) setApplyingPresetName("");
    }
  };

  const handleQuickOp = async (op: "rest" | "shift" | "clear") => {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      if (op === "rest") {
        await apiFetch(`/api/web/schedule/${encodeURIComponent(date)}`, {
          method: "PUT",
          body: {
            mode: "rest",
            title: "休息日",
            notes: notes.trim(),
            exercises: [],
            // #272: Always send observed baseVersion (including 0 when blank) so concurrent creations trigger 409
            baseVersion,
          },
        });
        bumpDataEpoch();
        closeAllModals();
        onSaved?.(date);
        notify(`${shortDate(date)} 已设为休息日`);
      } else if (op === "shift") {
        const nextDate = shiftDateStr(date, 1);
        try {
          await apiFetch("/api/web/schedule/shift", { method: "POST", body: { fromDate: date, toDate: nextDate } });
          bumpDataEpoch();
          closeAllModals();
          onSaved?.(nextDate);
          notify(`已顺延至 ${shortDate(nextDate)}`);
        } catch (shiftErr) {
          // #274: Reuse shift conflict confirmation inside DaySchedulerModal
          const apiErr = shiftErr as Error & {
            status?: number;
            payload?: {
              conflictTarget?: { date: string; title: string; notes: string; version: number; routineId?: string | null };
              fromVersion?: number;
              planRevision?: number;
              fromRoutineId?: string | null;
            };
          };
          if (apiErr.status === 409 && apiErr.payload?.conflictTarget) {
            const target = apiErr.payload.conflictTarget;
            setSaving(false);
            useUiStore.getState().openConfirm({
              title: "目标日期已有训练安排",
              message: `${shortDate(nextDate)} 已有「${target.title}」${target.notes ? `（备注：${target.notes}）` : ""}。确认将 ${shortDate(date)} 的安排顺延并覆盖目标日期吗？`,
              confirmLabel: "确认覆盖",
              onConfirm: async () => {
                await apiFetch("/api/web/schedule/shift", {
                  method: "POST",
                  body: {
                    fromDate: date,
                    toDate: nextDate,
                    overwrite: true,
                    expectedFromVersion: apiErr.payload?.fromVersion,
                    expectedToVersion: target.version,
                    expectedPlanRevision: apiErr.payload?.planRevision,
                    expectedFromRoutineId: apiErr.payload?.fromRoutineId,
                    expectedToRoutineId: target.routineId ?? null,
                  },
                });
                bumpDataEpoch();
                closeAllModals();
                onSaved?.(nextDate);
                notify(`已将 ${shortDate(date)} 训练顺延并覆盖至 ${shortDate(nextDate)}`);
              },
            });
            return;
          }
          throw shiftErr;
        }
      } else {
        // #273: Pass observed baseVersion on DELETE so newer edits from another device are not silently deleted
        await apiFetch(
          `/api/web/schedule/${encodeURIComponent(date)}?baseVersion=${encodeURIComponent(String(baseVersion))}`,
          { method: "DELETE" },
        );
        bumpDataEpoch();
        closeAllModals();
        onSaved?.(date);
        notify(`${shortDate(date)} 已恢复默认顺排`);
      }
    } catch (err) {
      setError((err as Error)?.message || "操作失败");
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // #275: Prevent saving stale exercises while a selected template/preset is still loading
    if (saving || applyingPresetName) return;
    setError("");
    const sanitized = sanitizePlannedExercises(exercises, catalogueMap);
    if (!sanitized.length) {
      setError("请添加至少一个训练动作");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/web/schedule/${encodeURIComponent(date)}`, {
        method: "PUT",
        body: {
          mode: "workout",
          title: title.trim() || "自定义排期训练",
          planId,
          routineId,
          templateId,
          notes: notes.trim(),
          exercises: sanitized,
          // #272: Always send observed baseVersion (including 0 for previously blank days)
          baseVersion,
        },
      });
      bumpDataEpoch();
      closeAllModals();
      onSaved?.(date);
      notify(`${shortDate(date)} 训练排期已保存`);
    } catch (err) {
      setError((err as Error)?.message || "保存排期失败");
      setSaving(false);
    }
  };

  const hasPresets =
    Boolean(schedule?.activePlan?.routines?.length) || Boolean(schedule?.templates?.length) || recentWorkouts.length > 0;

  return (
    <form id="day-scheduler-form" className="dialog-form scheduler-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="scheduler-telemetry">
        <div className="preview-meta">
          <span className="meta-accent">
            {currentDay.status === "scheduled"
              ? "当前：手动排期"
              : currentDay.status === "projected"
                ? "当前：计划顺排"
                : isRest
                  ? "当前：休息日"
                  : "当前：未安排"}
          </span>
          {detail.adjacent?.previous ? <span>前一日：{detail.adjacent.previous.title}</span> : null}
          {detail.adjacent?.next ? <span>次日：{detail.adjacent.next.title}</span> : null}
          {telemetry?.summary?.prOpportunityCount ? (
            <span className="meta-pr">
              <Icon name="trophy" size={12} /> 预计 {telemetry.summary.prOpportunityCount} 个 PR 突破点
            </span>
          ) : null}
          {telemetry?.summary?.deloadCount ? (
            <span className="meta-warn">
              <Icon name="bolt" size={12} /> 含 {telemetry.summary.deloadCount} 个减载提示
            </span>
          ) : null}
        </div>
        {conflicts.length ? (
          <p className="forecast-conflict">
            <Icon name="bolt" size={14} /> {conflicts[0]}（可下方更换分化或顺延至后天）
          </p>
        ) : null}
      </div>

      {hasPresets ? (
        <section className="scheduler-presets">
          <span>快速排入{applyingPresetName ? ` · 正在载入「${applyingPresetName}」…` : ""}</span>
          <div className="ai-presets">
            {(schedule?.activePlan?.routines ?? []).map((r) => (
              <button key={r.id} type="button" className="ai-chip" onClick={() => void applyPlanPreset(r)}>
                {r.name}
              </button>
            ))}
            {(schedule?.templates ?? []).map((t) => (
              <button key={t.id} type="button" className="ai-chip" onClick={() => void applyTemplatePreset(t)}>
                模板 · {t.name}
              </button>
            ))}
            {recentWorkouts.map((w) => (
              <button key={w.id} type="button" className="ai-chip" onClick={() => void applyHistoryPreset(w)}>
                {shortDate(w.data.date)} {w.data.title}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="scheduler-mode-bar">
        <div className="fields scheduler-meta-fields">
          <label className="field">
            <span>训练日标题</span>
            <input
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：推 · 胸肩三头 / 弱项补充"
            />
          </label>
          <label className="field">
            <span>备注 / 重点提示（可选）</span>
            <input
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="例如：卧推重点冲击 75kg · 注意肩胛下沉"
            />
          </label>
        </div>
        <div className="scheduler-quick-ops">
          <button type="button" className="secondary-button" disabled={saving} onClick={() => void handleQuickOp("rest")}>
            <Icon name="rest" size={15} /> 设为休息日
          </button>
          {currentDay?.routine ? (
            <button type="button" className="secondary-button" disabled={saving} onClick={() => void handleQuickOp("shift")}>
              <Icon name="chevron" size={15} /> 顺延+1天
            </button>
          ) : null}
          {detail.override ? (
            <button type="button" className="quiet" disabled={saving} onClick={() => void handleQuickOp("clear")}>
              恢复按计划自动
            </button>
          ) : null}
          {currentDay?.routine && onStartPreview ? (
            <button type="button" className="quiet" onClick={() => onStartPreview(date)}>
              <Icon name="trending" size={14} /> 渐进与 PR 预览
            </button>
          ) : null}
        </div>
      </div>

      <section className="form-section">
        <h3 className="form-section-title">动作处方与渐进规则</h3>
        <PlannedExerciseList
          items={exercises}
          catalogueMap={catalogueMap}
          prMap={prMap}
          onChange={setExercises}
          onRegisterExercise={(ex) => {
            setCatalogueMap((prev) => {
              const next = new Map(prev);
              next.set(ex.id, ex);
              return next;
            });
            void fetchMissingPrs([ex.id], prMap, setPrMap, shiftDateStr(today(), 1));
          }}
        />
      </section>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <footer className="dialog-foot">
        <button type="button" className="secondary-button" onClick={closeAllModals}>
          取消
        </button>
        <button type="submit" className="primary-button" disabled={saving || Boolean(applyingPresetName)}>
          {applyingPresetName ? "载入模板中…" : saving ? "保存中…" : "保存排期"}
        </button>
      </footer>
    </form>
  );
}

export function PlanBuilderModal({
  existingPlan,
  expectedRevision,
}: {
  existingPlan?: {
    id: string;
    version?: number;
    data: PlanData;
    expectedRevision?: number;
    isActiveSource?: boolean;
  } | null;
  expectedRevision?: number;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openPlanSection = useUiStore((s) => s.openPlanSection);
  const notify = useUiStore((s) => s.notify);

  const src = existingPlan?.data;
  const initialExpectedRevision = existingPlan?.expectedRevision ?? expectedRevision;
  const hasExplicitExpectedRevision = typeof initialExpectedRevision === "number";
  const [name, setName] = useState(src?.name || "自定义力量分化");
  const [weeks, setWeeks] = useState(src?.weeks ?? 6);
  const [schedule, setSchedule] = useState<"rotation" | "weekdays">(src?.schedule ?? "rotation");
  const [weekdays, setWeekdays] = useState<number[]>(() => (src?.weekdays?.length ? [...src.weekdays] : [1]));
  const [rationale, setRationale] = useState(
    src?.rationale || "按动作渐进规则推进负荷，完成全组上限次数与目标 RIR 后自动加重。",
  );
  const [routines, setRoutines] = useState<PlanRoutine[]>(() =>
    src?.routines?.length
      ? src.routines.map((r) => ({ id: r.id, name: r.name, ...(r.isDeload ? { isDeload: true } : {}), exercises: r.exercises.map((e) => ({ ...e })) }))
      : [{ id: "routine_0", name: "训练日 A", exercises: [] }],
  );
  const [activeRoutineIdx, setActiveRoutineIdx] = useState(0);
  const [catalogueMap, setCatalogueMap] = useState<Map<string, CatalogueExercise>>(() => new Map());
  const [prMap, setPrMap] = useState<Map<string, ExercisePrInfo>>(() => new Map());
  const [prLoading, setPrLoading] = useState(false);
  const [metaRetryNonce, setMetaRetryNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictActive, setConflictActive] = useState<{ id: string; version: number; revision: number; name: string } | null>(null);
  const createdDraftRef = useRef<{ id: string; version: number; fingerprint: string } | null>(null);
  // #158: Bind stable opId per draft content fingerprint before POST /api/plans/drafts
  const pendingDraftOpRef = useRef<{ fingerprint: string; opId: string } | null>(null);
  // #271: Bind expectedRevision to the exact plan snapshot the user opened from instead of silently overwriting with a newer active revision
  const openingRevisionRef = useRef<number>(initialExpectedRevision ?? 0);

  // R15 UX: Render form immediately; fetch catalogue, activePlan, and PRs independently without blocking editing
  useEffect(() => {
    let active = true;
    const ids = [
      ...new Set(
        routines.flatMap((r) => r.exercises.flatMap((e) => [e.exerciseId, e.backupExerciseId ?? ""].filter(Boolean))),
      ),
    ];
    void resolveCatalogueMap(ids)
      .then((cat) => {
        if (!active) return;
        setCatalogueMap((prev) => {
          const next = new Map(prev);
          cat.forEach((v, k) => next.set(k, v));
          return next;
        });
      })
      .catch(() => {});

    if (!hasExplicitExpectedRevision) {
      void apiFetch<{ revision?: number } | null>("/api/plans/active")
        .then((activePlan) => {
          if (active) openingRevisionRef.current = activePlan?.revision ?? 0;
        })
        .catch(() => {});
    }

    if (ids.length) {
      setPrLoading(true);
      void apiFetch<ExercisePrInfo[]>("/api/web/exercise-prs", {
        method: "POST",
        body: {
          date: "2099-12-31",
          startedAt: "2099-12-31T23:59:59Z",
          exercises: ids.map((id) => ({ id })),
        },
      })
        .then((prs) => {
          if (active) setPrMap(new Map(prs.map((p) => [p.exerciseId, p])));
        })
        .catch(() => {})
        .finally(() => {
          if (active) setPrLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [metaRetryNonce]);

  const missingMetaIds = [
    ...new Set(
      routines
        .flatMap((r) => r.exercises.map((e) => e.exerciseId))
        .filter((id) => id && !catalogueMap.has(id)),
    ),
  ];

  const currentRoutine = routines[activeRoutineIdx] ?? routines[0]!;

  const updateCurrentRoutine = (patch: Partial<PlanRoutine>) => {
    setRoutines((prev) => prev.map((r, i) => (i === activeRoutineIdx ? { ...r, ...patch } : r)));
  };

  const handleScheduleModeChange = (nextMode: "rotation" | "weekdays") => {
    setSchedule(nextMode);
    if (nextMode === "weekdays") {
      const used = new Set<number>();
      setWeekdays(
        routines.map((_, idx) => {
          const cur = weekdays[idx];
          if (cur && !used.has(cur)) {
            used.add(cur);
            return cur;
          }
          const pick = [1, 2, 3, 4, 5, 6, 7].find((w) => !used.has(w)) ?? ((idx % 7) + 1);
          used.add(pick);
          return pick;
        }),
      );
    }
  };

  const addRoutine = () => {
    if (routines.length >= 7) return;
    const idx = routines.length;
    const used = new Set(weekdays);
    const nextWd = [1, 2, 3, 4, 5, 6, 7].find((w) => !used.has(w)) ?? 1;
    setRoutines((prev) => [
      ...prev,
      { id: `routine_${Date.now().toString(36)}_${idx}`, name: `训练日 ${String.fromCharCode(65 + idx)}`, exercises: [] },
    ]);
    if (schedule === "weekdays") setWeekdays((prev) => [...prev, nextWd]);
    setActiveRoutineIdx(idx);
  };

  const dupRoutine = () => {
    if (routines.length >= 7) return;
    const idx = routines.length;
    const used = new Set(weekdays);
    const nextWd = [1, 2, 3, 4, 5, 6, 7].find((w) => !used.has(w)) ?? 1;
    setRoutines((prev) => [
      ...prev,
      {
        id: `routine_${Date.now().toString(36)}_${idx}`,
        name: `${currentRoutine.name} (副本)`.slice(0, 120),
        ...(currentRoutine.isDeload ? { isDeload: true } : {}),
        exercises: currentRoutine.exercises.map((e) => ({ ...e })),
      },
    ]);
    if (schedule === "weekdays") setWeekdays((prev) => [...prev, nextWd]);
    setActiveRoutineIdx(idx);
  };

  const moveRoutine = (dir: -1 | 1) => {
    const nextIdx = activeRoutineIdx + dir;
    if (nextIdx < 0 || nextIdx >= routines.length) return;
    setRoutines((prev) => {
      const next = [...prev];
      [next[activeRoutineIdx], next[nextIdx]] = [next[nextIdx]!, next[activeRoutineIdx]!];
      return next;
    });
    if (schedule === "weekdays") {
      setWeekdays((prev) => {
        const next = [...prev];
        [next[activeRoutineIdx], next[nextIdx]] = [next[nextIdx]!, next[activeRoutineIdx]!];
        return next;
      });
    }
    setActiveRoutineIdx(nextIdx);
  };

  const delRoutine = () => {
    if (routines.length <= 1) return;
    setRoutines((prev) => prev.filter((_, i) => i !== activeRoutineIdx));
    setWeekdays((prev) => prev.filter((_, i) => i !== activeRoutineIdx));
    setActiveRoutineIdx((i) => Math.max(0, i - 1));
  };

  const handleSave = async (mode: "draft" | "apply") => {
    if (saving) return;
    setError("");
    const cleanedRoutines = routines.map((r, i) => ({
      ...r,
      name: r.name.trim() || `训练日 ${i + 1}`,
      exercises: sanitizePlannedExercises(r.exercises, catalogueMap),
    }));
    const emptyRoutine = cleanedRoutines.find((r) => !r.exercises.length);
    if (emptyRoutine) {
      setError(`「${emptyRoutine.name}」至少需要添加 1 个动作`);
      return;
    }
    if (schedule === "weekdays" && new Set(weekdays.slice(0, cleanedRoutines.length)).size !== cleanedRoutines.length) {
      setError("按固定星期执行时，每个训练日需要对应不同的星期");
      return;
    }

    setSaving(true);
    try {
      const draftBody = {
        name: name.trim(),
        weeks: Number(weeks),
        schedule,
        weekdays: schedule === "weekdays" ? weekdays.slice(0, cleanedRoutines.length) : [],
        routines: cleanedRoutines,
        rationale: rationale.trim() || "手动规划训练分化与渐进参数。",
        source: "manual",
        parentId: existingPlan?.id ?? null,
      };
      const fingerprint = JSON.stringify(draftBody);
      let targetDraft = createdDraftRef.current?.fingerprint === fingerprint ? createdDraftRef.current : null;
      if (!targetDraft) {
        // #158: Reuse stable opId for identical draft content so retrying after a lost receipt never creates a duplicate draft
        if (!pendingDraftOpRef.current || pendingDraftOpRef.current.fingerprint !== fingerprint) {
          pendingDraftOpRef.current = { fingerprint, opId: safeUuid() };
        }
        const draftRes = await apiFetch<{ record?: { id: string; version: number } }>("/api/plans/drafts", {
          method: "POST",
          body: { ...draftBody, opId: pendingDraftOpRef.current.opId },
        });
        if (draftRes?.record) {
          targetDraft = { id: draftRes.record.id, version: draftRes.record.version, fingerprint };
          createdDraftRef.current = targetDraft;
          pendingDraftOpRef.current = null;
        }
      }
      if (mode === "apply" && targetDraft) {
        try {
          await apiFetch("/api/plans/apply", {
            method: "POST",
            body: {
              id: targetDraft.id,
              version: targetDraft.version,
              expectedRevision: openingRevisionRef.current,
            },
          });
        } catch (applyErr) {
          // #159: On 409 conflict, check if this exact draft is ALREADY the active plan (lost receipt from previous attempt)
          const status = (applyErr as { status?: number })?.status;
          if (status === 409) {
            const currentActive = await apiFetch<{
              id?: string;
              version?: number;
              revision?: number;
              data?: { name?: string };
            } | null>("/api/plans/active").catch(() => null);
            if (currentActive && currentActive.id === targetDraft.id && currentActive.version === targetDraft.version) {
              bumpDataEpoch();
              closeAllModals();
              openPlanSection("current");
              notify("训练计划已保存并启用");
              return;
            }
            if (currentActive?.id) {
              setConflictActive({
                id: currentActive.id,
                version: currentActive.version ?? 1,
                revision: currentActive.revision ?? 0,
                name: currentActive.data?.name || "其他生效计划",
              });
              setError(
                `当前生效计划已在其他设备更新为「${currentActive.data?.name || "其他生效计划"}」（修订 #${currentActive.revision ?? 0}）。您的修改已存为草稿，请核对后再决定是否覆盖启用。`,
              );
              setSaving(false);
              return;
            }
          }
          throw applyErr;
        }
      }
      bumpDataEpoch();
      closeAllModals();
      openPlanSection(mode === "apply" ? "current" : "drafts");
      notify(mode === "apply" ? "训练计划已保存并启用" : "训练计划已存为草稿");
    } catch (err) {
      setError((err as Error)?.message || "保存训练计划失败");
      setSaving(false);
    }
  };

  return (
    <form
      id="plan-builder-form"
      className="dialog-form scheduler-form"
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        void handleSave(submitter?.value === "draft" ? "draft" : "apply");
      }}
    >
      <div className="plan-builder-top">
        <label className="field">
          <span>计划名称</span>
          <input maxLength={120} required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>周期周数</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={52}
            required
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>排期模式</span>
          <select value={schedule} onChange={(e) => handleScheduleModeChange(e.target.value as "rotation" | "weekdays")}>
            <option value="rotation">按顺序轮换</option>
            <option value="weekdays">按固定星期</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span>计划说明 / 渐进思路</span>
        <textarea rows={2} maxLength={8000} required value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </label>

      <div className="plan-routine-bar">
        <div className="plan-routine-tabs" role="tablist" aria-label="训练日列表">
          {routines.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className="routine-tab"
              aria-selected={i === activeRoutineIdx}
              onClick={() => setActiveRoutineIdx(i)}
            >
              <span>{r.name}</span>
              {schedule === "weekdays" ? <small>{WEEKDAY_NAMES[(weekdays[i] || (i % 7) + 1) - 1]}</small> : null}
            </button>
          ))}
        </div>
        <button type="button" className="secondary-button" disabled={routines.length >= 7} onClick={addRoutine}>
          <Icon name="plus" size={15} /> 加训练日
        </button>
      </div>

      <div className="builder-muscle-summary">
        {prLoading ? (
          <small className="muted" role="status" style={{ display: "block", marginBottom: 4 }}>
            正在后台加载个人 PR 参考基准…
          </small>
        ) : null}
        {missingMetaIds.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <small className="muted">部分动作详情暂未加载，已保留原有目标参数。</small>
            <button type="button" className="micro-chip" onClick={() => setMetaRetryNonce((n) => n + 1)}>
              重试加载
            </button>
          </div>
        ) : null}
        <MuscleDistributionSummary
          routines={routines}
          catalogueMap={catalogueMap}
          emptyHint="每周肌群分布平衡：添加动作后实时计算各部位有效组数（推荐每部位 10–20 组/周）"
          highlightRange
        />
      </div>

      <div className="plan-routine-meta">
        <label className="field">
          <span>当前训练日名称</span>
          <input
            maxLength={120}
            required
            value={currentRoutine.name}
            onChange={(e) => updateCurrentRoutine({ name: e.target.value })}
          />
        </label>
        <label className="switch-chip" style={{ alignSelf: "flex-end", marginBottom: 4 }}>
          <span>减载训练日</span>
          <input
            type="checkbox"
            className="switch"
            checked={Boolean(currentRoutine.isDeload)}
            onChange={(e) => updateCurrentRoutine({ isDeload: e.target.checked })}
          />
        </label>
        <label className="field" hidden={schedule !== "weekdays"}>
          <span>安排星期</span>
          <select
            value={String(weekdays[activeRoutineIdx] ?? ((activeRoutineIdx % 7) + 1))}
            onChange={(e) => {
              const val = Number(e.target.value);
              setWeekdays((prev) => prev.map((w, i) => (i === activeRoutineIdx ? val : w)));
            }}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {WEEKDAY_NAMES[d - 1]}
              </option>
            ))}
          </select>
        </label>
        <div className="plan-routine-ops">
          <button type="button" className="quiet" disabled={activeRoutineIdx <= 0} onClick={() => moveRoutine(-1)}>
            ← 前移
          </button>
          <button
            type="button"
            className="quiet"
            disabled={activeRoutineIdx >= routines.length - 1}
            onClick={() => moveRoutine(1)}
          >
            后移 →
          </button>
          <button type="button" className="quiet" disabled={routines.length >= 7} onClick={dupRoutine}>
            <Icon name="copy" size={13} /> 复制训练日
          </button>
          <button type="button" className="quiet danger" disabled={routines.length <= 1} onClick={delRoutine}>
            删除此训练日
          </button>
        </div>
      </div>

      <section className="form-section">
        <h3 className="form-section-title">当日动作与渐进配置</h3>
        <PlannedExerciseList
          scopeKey={currentRoutine.id}
          items={currentRoutine.exercises}
          catalogueMap={catalogueMap}
          prMap={prMap}
          onChange={(nextEx) => updateCurrentRoutine({ exercises: nextEx })}
          onRegisterExercise={(ex) => {
            setCatalogueMap((prev) => {
              const next = new Map(prev);
              next.set(ex.id, ex);
              return next;
            });
            void fetchMissingPrs([ex.id], prMap, setPrMap, shiftDateStr(today(), 1));
          }}
        />
      </section>

      {existingPlan ? (
        <p className="muted" style={{ fontSize: 12.5, margin: "4px 0" }}>
          编辑来源：{existingPlan.data.name}（v{existingPlan.version ?? 1}
          {existingPlan.isActiveSource ? ` · 生效修订 #${openingRevisionRef.current}` : ""}）
        </p>
      ) : null}
      {conflictActive ? (
        <div className="notice-banner" role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>
            云端当前生效：<strong>{conflictActive.name}</strong>（修订 #{conflictActive.revision}）
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              openingRevisionRef.current = conflictActive.revision;
              setConflictActive(null);
              setError("");
              notify(`已对齐至最新修订 #${conflictActive.revision}，可再次点击「保存并立即启用」覆盖`);
            }}
          >
            核对后允许覆盖启用
          </button>
        </div>
      ) : null}

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <footer className="dialog-foot">
        <button type="submit" className="secondary-button" value="draft" disabled={saving}>
          仅存草稿
        </button>
        <button type="submit" className="primary-button" value="apply" disabled={saving}>
          保存并立即启用
        </button>
      </footer>
    </form>
  );
}

export function TemplateEditorModal({
  existingTemplate,
}: {
  existingTemplate?: RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }> | null;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const isEdit = Boolean(existingTemplate?.data);
  const [tplId] = useState(() => existingTemplate?.id ?? `tpl_${safeUuid().slice(0, 12)}`);
  const [baseVersion, setBaseVersion] = useState(existingTemplate?.version ?? 0);

  const [name, setName] = useState(existingTemplate?.data?.name ?? "");
  const [items, setItems] = useState<PlannedExercise[]>(() =>
    (existingTemplate?.data?.exercises ?? []).map((e) => ({ ...e })),
  );
  const [catalogueMap, setCatalogueMap] = useState<Map<string, CatalogueExercise>>(() => new Map());
  const [prMap, setPrMap] = useState<Map<string, ExercisePrInfo>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictRecord, setConflictRecord] = useState<RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }> | null>(null);
  // #276: Bind stable opId per payload fingerprint so retrying after a lost response reuses the same opId
  const pendingOpRef = useRef<{ fingerprint: string; opId: string } | null>(null);

  useEffect(() => {
    let active = true;
    const ids = items.flatMap((e) => [e.exerciseId, e.backupExerciseId ?? ""].filter(Boolean));
    void Promise.all([
      resolveCatalogueMap(ids),
      ids.length
        ? apiFetch<ExercisePrInfo[]>("/api/web/exercise-prs", {
            method: "POST",
            body: {
              date: "2099-12-31",
              startedAt: "2099-12-31T23:59:59Z",
              exercises: [...new Set(ids)].map((id) => ({ id })),
            },
          }).catch(() => [])
        : Promise.resolve([]),
    ])
      .then(([cat, prs]) => {
        if (!active) return;
        setCatalogueMap(cat);
        setPrMap(new Map(prs.map((p) => [p.exerciseId, p])));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="dialog-form scheduler-form">
        <p className="muted">正在加载模板动作详情…</p>
      </div>
    );
  }

  const sanitized = sanitizePlannedExercises(items, catalogueMap);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    const cleanName = name.trim();
    if (!cleanName) {
      setError("请填写模板名称");
      return;
    }
    if (!sanitized.length) {
      setError("请至少添加 1 个训练动作");
      return;
    }
    setSaving(true);
    setConflictRecord(null);
    const dataPayload = { id: tplId, name: cleanName, exercises: sanitized };
    const fingerprint = JSON.stringify({ id: tplId, baseVersion, data: dataPayload });
    if (!pendingOpRef.current || pendingOpRef.current.fingerprint !== fingerprint) {
      pendingOpRef.current = { fingerprint, opId: safeUuid() };
    }
    try {
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId: pendingOpRef.current.opId,
          id: tplId,
          kind: "template",
          baseVersion,
          deleted: false,
          data: dataPayload,
        },
      });
      pendingOpRef.current = null;
      bumpDataEpoch();
      closeAllModals();
      notify(isEdit ? `已更新模板「${cleanName}」` : `已保存模板「${cleanName}」`);
    } catch (err) {
      const apiErr = err as Error & { status?: number };
      if (apiErr?.status === 409) {
        const latest = await apiFetch<RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }>>(
          `/api/web/records/template/${encodeURIComponent(tplId)}?includeDeleted=1`,
        ).catch(() => null);
        if (latest) {
          setConflictRecord(latest);
          setError(
            `模板已在其他端更新至版本 v${latest.version}（名称：「${latest.data?.name ?? cleanName}」，${latest.data?.exercises?.length ?? 0} 个动作）。请核对后选择载入最新版本或覆盖保存。`,
          );
          setSaving(false);
          return;
        }
      }
      setError(apiErr?.message || "保存模板失败");
      setSaving(false);
    }
  };

  return (
    <form id="template-editor-form" className="dialog-form scheduler-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="field">
        <span>模板名称</span>
        <input
          maxLength={120}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：推 · 胸肩三头、居家哑铃全身"
        />
      </label>
      <div className="builder-muscle-summary">
        <MuscleDistributionSummary
          routines={[{ exercises: sanitized }]}
          catalogueMap={catalogueMap}
          title="本模板肌群有效组数"
          subNote=""
          emptyHint="添加动作后将实时汇总本模板各部位工作组分布"
          highlightRange={false}
        />
      </div>
      <section className="form-section">
        <h3 className="form-section-title">模板动作、渐进规则与超级组</h3>
        <PlannedExerciseList
          items={items}
          catalogueMap={catalogueMap}
          prMap={prMap}
          onChange={setItems}
          onRegisterExercise={(ex) => {
            setCatalogueMap((prev) => {
              const next = new Map(prev);
              next.set(ex.id, ex);
              return next;
            });
            void fetchMissingPrs([ex.id], prMap, setPrMap, shiftDateStr(today(), 1));
          }}
        />
      </section>
      {conflictRecord ? (
        <div className="notice-banner" role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>
            云端版本 v{conflictRecord.version}：「{conflictRecord.data?.name}」（{conflictRecord.data?.exercises?.length ?? 0} 个动作）
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setBaseVersion(conflictRecord.version);
                setName(conflictRecord.data?.name ?? "");
                setItems((conflictRecord.data?.exercises ?? []).map((e) => ({ ...e })));
                pendingOpRef.current = null;
                setConflictRecord(null);
                setError("");
                notify(`已载入云端最新模板 v${conflictRecord.version}`);
              }}
            >
              载入云端版本
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setBaseVersion(conflictRecord.version);
                pendingOpRef.current = null;
                setConflictRecord(null);
                setError("");
                notify(`已基于 v${conflictRecord.version} 准备覆盖，请再次点击「保存模板」`);
              }}
            >
              保留当前编辑并重试
            </button>
          </div>
        </div>
      ) : null}
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <footer className="dialog-foot">
        <button type="button" className="secondary-button" onClick={closeAllModals}>
          取消
        </button>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中…" : "保存模板"}
        </button>
      </footer>
    </form>
  );
}

export function PlanDraftModal({
  record,
  catalogueMap,
  expectedRevision,
  onEditDraft,
}: {
  record: RecordEnvelope<PlanData>;
  catalogueMap: Map<string, CatalogueExercise>;
  expectedRevision: number;
  onEditDraft?: () => void;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openPlanSection = useUiStore((s) => s.openPlanSection);
  const notify = useUiStore((s) => s.notify);

  const [armed, setArmed] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleDeleteDraft = () => {
    openConfirm({
      title: "删除计划草稿",
      message: `确定要删除计划草稿「${record.data.name}」吗？此操作不可撤销。`,
      confirmLabel: "删除草稿",
      onConfirm: async () => {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: safeUuid(),
            id: record.id,
            kind: "plan",
            baseVersion: record.version,
            deleted: true,
            data: record.data,
          },
        });
        bumpDataEpoch();
        closeAllModals();
        notify("已删除计划草稿");
      },
    });
  };

  const applyDraft = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setApplying(true);
    try {
      await apiFetch("/api/plans/apply", {
        method: "POST",
        body: { id: record.id, version: record.version, expectedRevision },
      });
      bumpDataEpoch();
      closeAllModals();
      openPlanSection("current");
      notify("训练计划已启用");
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 409) {
        const currentActive = await apiFetch<{ id?: string; version?: number } | null>("/api/plans/active").catch(() => null);
        if (currentActive && currentActive.id === record.id && currentActive.version === record.version) {
          bumpDataEpoch();
          closeAllModals();
          openPlanSection("current");
          notify("训练计划已启用");
          return;
        }
      }
      notify((err as Error)?.message || "启用失败");
      setApplying(false);
    }
  };

  return (
    <div className="dialog-form">
      {record.data.rationale ? <p>{record.data.rationale}</p> : null}
      {record.data.routines.map((routine) => {
        const ssBadges = supersetBadges(routine.exercises);
        return (
          <section key={routine.id} className="panel routine">
            <h3>{routine.name}</h3>
            <ol>
              {routine.exercises.map((row, exIdx) => (
                <li key={`${row.exerciseId}-${exIdx}`}>
                  <span>
                    {ssBadges[exIdx] ? <span className="superset-pill">超级组 {ssBadges[exIdx]}</span> : null}
                    {catalogueMap.get(row.exerciseId)?.name ?? row.exerciseId}
                  </span>
                  <span>
                    {row.sets} 组 × {row.seconds ? `${row.seconds} 秒` : `${row.repsMin}–${row.repsMax} 次`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      <footer className="dialog-foot has-remove" style={{ flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="danger" onClick={handleDeleteDraft}>
          删除草稿
        </button>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          {onEditDraft ? (
            <button type="button" className="secondary-button" onClick={onEditDraft}>
              编辑草稿
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => exportPlanAsJson(record.data, notify)}>
            <Icon name="download" size={14} /> 导出 JSON
          </button>
          <button type="button" className="primary-button" disabled={applying} onClick={() => void applyDraft()}>
            {applying ? "启用中…" : armed ? "确认启用" : "启用此计划"}
          </button>
        </div>
      </footer>
    </div>
  );
}

interface RoutinePreviewResponse {
  name: string;
  planId?: string | null;
  planVersion?: number | null;
  routineId: string;
  targetSnapshot?: unknown;
  summary?: {
    progressionCount?: number;
    prOpportunityCount?: number;
    deloadCount?: number;
    estimatedMinutes?: number;
  };
  exercises: Array<{
    exerciseId: string;
    targetIndex?: number | null;
    restSeconds: number;
    supersetGroup?: string | null;
    snapshot: {
      name: string;
      muscle: MuscleKey;
      equipment: CatalogueExercise["equipment"];
      mode: CatalogueExercise["mode"];
      volumeMultiplier: number;
    };
    sets: number;
    weight: number;
    reps: number;
    seconds: number;
    progression?: {
      status?: string;
      statusLabel?: string;
      ruleLabel?: string;
      forecast?: string;
      reason?: string;
    } | null;
    pr?: {
      kind?: string;
      label?: string;
      detail?: string;
    } | null;
    lastTop?: {
      date?: string | null;
      weight: number;
      weightUnit?: "kg" | "lb";
      originalWeight?: number;
      originalUnit?: "kg" | "lb";
      reps: number;
      seconds: number;
      setsCount?: number;
    } | null;
    backup?: { id: string; name: string } | null;
    autoWarmup?: boolean;
    weightUnit?: "kg" | "lb";
  }>;
}

export function RoutinePreviewModal({
  id,
  source = "plan",
  date = today(),
  onEditScheduledDay,
  onLaunchWorkout,
}: {
  id: string;
  source?: "plan" | "template" | "scheduled";
  date?: string;
  onEditScheduledDay: (date: string) => void;
  onLaunchWorkout: (seed: Partial<WorkoutData>, goals: ProfileGoals | null) => void;
}) {
  const [result, setResult] = useState<RoutinePreviewResponse | null>(null);
  const [goals, setGoals] = useState<ProfileGoals | null>(null);
  const [muscleStatus, setMuscleStatus] = useState<NonNullable<OverviewStatsResponse["muscleStatus"]>>([]);
  const [deloadPrefs, setDeloadPrefs] = useState(() => {
    const p = readWorkoutPreferences();
    return {
      deloadMode: p.deloadMode,
      deloadWeightPct: p.deloadWeightPct,
      deloadSetsPct: p.deloadSetsPct,
      weightStepKg: p.weightStepKg,
    };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const nextPrefs = readWorkoutPreferences();
      setDeloadPrefs({
        deloadMode: nextPrefs.deloadMode,
        deloadWeightPct: nextPrefs.deloadWeightPct,
        deloadSetsPct: nextPrefs.deloadSetsPct,
        weightStepKg: nextPrefs.weightStepKg,
      });
    };
    window.addEventListener(WORKOUT_PREFS_EVENT, sync);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, sync);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      apiFetch<RoutinePreviewResponse>(`/api/web/routine?${new URLSearchParams({ id, source, date }).toString()}`),
      apiFetch<OverviewStatsResponse>("/api/web/statistics?days=7").catch(() => null),
    ])
      .then(([res, stats]) => {
        if (!active) return;
        setResult(res);
        setGoals(stats?.goals ?? null);
        setMuscleStatus(stats?.muscleStatus ?? []);
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载训练日预览失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, source, date]);

  if (loading) {
    return (
      <div className="routine-preview dialog-form">
        <p className="muted" style={{ padding: "18px 0" }}>正在生成渐进目标与 PR 预览…</p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="routine-preview dialog-form">
        <p className="form-error" role="alert">
          {error || "无法加载该训练日"}
        </p>
      </div>
    );
  }

  const todayKey = today();
  const isFuture = Boolean(date && date > todayKey);
  const allowEditSchedule = source === "scheduled" || isFuture;
  const scaleRowTarget = (row: RoutinePreviewResponse["exercises"][number]) =>
    deloadPrefs.deloadMode
      ? applyDeloadToTarget(
          row.sets,
          row.weight,
          row.snapshot.mode,
          (row.weightUnit ?? "kg") === "lb" ? 5 : deloadPrefs.weightStepKg,
          deloadPrefs.deloadWeightPct,
          deloadPrefs.deloadSetsPct,
        )
      : { sets: row.sets, weight: row.weight };
  const totalSets = result.exercises.reduce((sum, r) => sum + scaleRowTarget(r).sets, 0);
  const progCount = result.summary?.progressionCount ?? 0;
  const prCount = result.summary?.prOpportunityCount ?? 0;
  const deloadCount = result.summary?.deloadCount ?? 0;
  const estMinutes = result.summary?.estimatedMinutes ?? 0;

  const targetMuscles = new Set(result.exercises.map((r) => r.snapshot?.muscle).filter(Boolean));
  const recoveryAlerts = muscleStatus.filter(
    (st) => targetMuscles.has(st.key) && Number.isFinite(st.recoveryPct) && st.recoveryPct < 60,
  );
  const ssBadges = supersetBadges(result.exercises);

  // #278: Reuse buildWorkoutSeedFromRoutine so preview launch matches direct launch (including 45 lb barbell & lb plate warmups)
  const handleLaunch = () => {
    const livePrefs = readWorkoutPreferences();
    const seed = buildWorkoutSeedFromRoutine(result, { prefs: livePrefs });
    onLaunchWorkout(seed, goals);
  };

  return (
    <div className="routine-preview dialog-form">
      {deloadPrefs.deloadMode ? (
        <div className="deload-banner">
          <span>
            <strong>减载周已开启</strong> · 组数 {deloadPrefs.deloadSetsPct}% · 重量 {deloadPrefs.deloadWeightPct}%
          </span>
          <button
            type="button"
            className="quiet"
            onClick={() => writeWorkoutPreference("deloadMode", false)}
          >
            恢复常规负荷
          </button>
        </div>
      ) : null}
      <div className="preview-meta">
        {date ? <span>{shortDate(date)}{isFuture ? " 排期" : ""}</span> : null}
        <span>{result.exercises.length} 个动作</span>
        <span>{totalSets} 个计划组</span>
        {estMinutes ? <span>约 {estMinutes} 分钟</span> : null}
        {progCount ? (
          <span className="meta-accent">
            <Icon name="trending" size={12} /> {progCount} 项渐进
          </span>
        ) : null}
        {prCount ? (
          <span className="meta-pr">
            <Icon name="trophy" size={12} /> {prCount} 个 PR 机会
          </span>
        ) : null}
        {deloadCount ? (
          <span className="meta-warn">
            <Icon name="bolt" size={12} /> {deloadCount} 项建议减载
          </span>
        ) : null}
      </div>

      {recoveryAlerts.length ? (
        <div className="preview-recovery-alert" role="status">
          <Icon name="bolt" size={14} />
          <span>
            <b>目标肌群恢复提醒：</b>
            {recoveryAlerts.map((st) => `${st.name} 当前恢复 ${st.recoveryPct}%（${st.statusLabel}）`).join(" · ")}
          </span>
        </div>
      ) : null}

      <ol className="preview-list">
        {result.exercises.map((row, index) => {
          const hasPrAlert = Boolean(row.pr && row.pr.kind !== "baseline");
          const isProg = row.progression?.status === "progress_weight" || row.progression?.status === "progress_reps";
          const isDeload = row.progression?.status === "plateau_deload";
          const ssBadge = ssBadges[index];
          const scaled = scaleRowTarget(row);
          const targetUnit = row.weightUnit ?? "kg";
          const lastUnit = row.lastTop?.weightUnit ?? targetUnit;
          const valText =
            row.snapshot.mode === "timed"
              ? `${fmt(row.seconds)} 秒`
              : row.snapshot.mode === "assisted"
                ? `辅助 ${fmt(scaled.weight)} ${targetUnit} × ${fmt(row.reps)}`
                : scaled.weight
                  ? `${fmt(scaled.weight)} ${targetUnit} × ${fmt(row.reps)}`
                  : `${fmt(row.reps)} 次`;

          return (
            <li key={`${row.exerciseId}-${index}`} className={`preview-row-card${ssBadge ? " has-superset" : ""}`}>
              <div className="preview-row-main">
                <span className="preview-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  {ssBadge ? <span className="superset-pill">超级组 {ssBadge}</span> : null}
                  <strong>{row.snapshot.name}</strong>
                  <small>
                    组间休息 {row.restSeconds} 秒
                    {row.progression?.ruleLabel ? ` · ${row.progression.ruleLabel}` : ""}
                    {row.backup ? ` · 备选 ${row.backup.name}` : ""}
                  </small>
                </div>
                <span className="preview-target">
                  {scaled.sets} 组 <i>·</i> {valText}
                </span>
              </div>
              {row.lastTop || row.progression || row.pr ? (
                <div className="preview-signals">
                  {row.lastTop ? (
                    <span className="sig-pill preview-last-pill">
                      上次{" "}
                      {row.snapshot.mode === "timed"
                        ? `${fmt(row.lastTop.seconds)}s`
                        : row.snapshot.mode === "assisted"
                          ? `辅助 ${fmt(row.lastTop.weight)} ${lastUnit} × ${fmt(row.lastTop.reps)}`
                          : row.lastTop.weight > 0
                            ? `${fmt(row.lastTop.weight)} ${lastUnit} × ${fmt(row.lastTop.reps)}`
                            : `徒手 × ${fmt(row.lastTop.reps)}`}
                    </span>
                  ) : null}
                  {row.progression ? (
                    <span
                      className={`sig-pill${isProg ? " is-up" : isDeload ? " is-warn" : ""}`}
                      title={row.progression.forecast ?? ""}
                    >
                      <Icon name="trending" size={12} /> {row.progression.statusLabel}
                    </span>
                  ) : null}
                  {row.pr ? (
                    <span className={`sig-pill${hasPrAlert ? " is-pr" : ""}`} title={row.pr.detail ?? ""}>
                      <Icon name="trophy" size={12} /> {row.pr.label}
                    </span>
                  ) : null}
                  {row.progression?.reason ? <span className="sig-note">{row.progression.reason}</span> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <footer className="dialog-foot">
        {allowEditSchedule ? (
          <button type="button" className="secondary-button" onClick={() => onEditScheduledDay(date)}>
            调整当日排期
          </button>
        ) : null}
        <button type="button" className="primary-button" onClick={handleLaunch}>
          {isFuture ? "提前开始本次训练" : "开始训练"}
        </button>
      </footer>
    </div>
  );
}
