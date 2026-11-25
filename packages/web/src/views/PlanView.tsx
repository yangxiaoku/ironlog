import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { ThinMeter } from "../components/Meters";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { type ScheduleResponse } from "../components/plan/PlanModals";
import { MuscleDistributionSummary, PROGRESSION_SHORT_LABELS, supersetBadges } from "../components/plan/PlannedExerciseList";
import { exportPlanAsJson } from "../components/settings/DataModals";
import { apiFetch } from "../lib/api";
import { resolveCatalogueMap } from "../lib/catalogue";
import { fmt, formatWeekdayZh, shortDate, today } from "../lib/date";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import {
  EQUIPMENT,
  MUSCLES,
  shiftDateStr,
  type CatalogueExercise,
  type MuscleKey,
  type PlanData,
  type PlanRoutine,
  type PlannedExercise,
  type RecordEnvelope,
  type TodayResponse,
  type WorkoutData,
} from "../lib/domain";
import {
  openAiPlanModal,
  openDayScheduler,
  openPlanBuilderModal,
  openPlanDraftModal,
  openPlanImportModal,
  openRoutinePreview,
  openTemplateEditorModal,
  openWorkoutEditor,
  resumeLocalWorkoutDraft,
} from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore, type PlanTab } from "../store/useUiStore";
import {
  WORKOUT_PREFS_EVENT,
  readWorkoutPreferences,
  writeWorkoutPreference,
} from "../lib/workout-helpers";

interface ActivePlanResponse {
  id: string;
  version: number;
  revision: number;
  data: PlanData;
  history: Array<{ id: string; version: number }>;
}

interface StarterPlan {
  id: string;
  tag: string;
  level: string;
  daysPerWeek: number;
  summary: string;
  equipmentTags?: Array<keyof typeof EQUIPMENT>;
  weeklyMuscleSets?: Array<{ name: string; sets: number }>;
  exerciseNames?: Record<string, string>;
  plan: PlanData;
}

const WEEKDAY_CHARS = ["一", "二", "三", "四", "五", "六", "日"];

export function PlanView() {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const planTab = useUiStore((s) => s.planTab);
  const setPlanTab = useUiStore((s) => s.setPlanTab);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const navigate = useUiStore((s) => s.navigate);
  const notify = useUiStore((s) => s.notify);

  interface PlanViewSnap {
    activePlan: ActivePlanResponse | null;
    templates: Array<RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }>>;
    drafts: Array<RecordEnvelope<PlanData>>;
    aiReady: boolean;
    currentDay: TodayResponse & { applePlan?: { routineId: string; name: string } | null } | null;
    schedule: ScheduleResponse | null;
    starterPlans: StarterPlan[];
    catalogueMap: Map<string, CatalogueExercise>;
  }
  const cachedPlan = peekQuery<PlanViewSnap>("view:plan", userId)?.data;

  const [loading, setLoading] = useState(() => !cachedPlan);
  const [error, setError] = useState("");
  const [activePlan, setActivePlan] = useState<ActivePlanResponse | null>(() => cachedPlan?.activePlan ?? null);
  const [templates, setTemplates] = useState<Array<RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }>>>(
    () => cachedPlan?.templates ?? [],
  );
  const [drafts, setDrafts] = useState<Array<RecordEnvelope<PlanData>>>(() => cachedPlan?.drafts ?? []);
  const [aiReady, setAiReady] = useState(() => cachedPlan?.aiReady ?? false);
  const [currentDay, setCurrentDay] = useState<TodayResponse & { applePlan?: { routineId: string; name: string } | null } | null>(
    () => cachedPlan?.currentDay ?? null,
  );
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(() => cachedPlan?.schedule ?? null);
  const [starterPlans, setStarterPlans] = useState<StarterPlan[]>(() => cachedPlan?.starterPlans ?? []);
  const [catalogueMap, setCatalogueMap] = useState<Map<string, CatalogueExercise>>(
    () => cachedPlan?.catalogueMap ?? new Map(),
  );
  const [armedStarterId, setArmedStarterId] = useState("");
  const [adoptingId, setAdoptingId] = useState("");
  const [workoutPrefs, setWorkoutPrefs] = useState(() => readWorkoutPreferences());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setWorkoutPrefs(readWorkoutPreferences());
    window.addEventListener(WORKOUT_PREFS_EVENT, sync);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, sync);
  }, []);

  useEffect(() => {
    let active = true;
    const stalePlan = peekQuery<PlanViewSnap>("view:plan", userId)?.data;
    if (!stalePlan) setLoading(true);
    setError("");
    void (async () => {
      try {
        const [activeRes, templatesRes, draftsRes, meRes, todayRes, schedRes, startersRes] = await Promise.all([
          cachedApiFetch<ActivePlanResponse | null>("/api/plans/active", { epoch: dataEpoch, userId }),
          cachedApiFetch<Array<RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }>>>("/api/records/template", { epoch: dataEpoch, userId }),
          cachedApiFetch<Array<RecordEnvelope<PlanData>>>("/api/records/plan", { epoch: dataEpoch, userId }),
          cachedApiFetch<{ aiReady?: boolean }>("/api/me", { epoch: dataEpoch, userId }),
          cachedApiFetch<TodayResponse & { applePlan?: { routineId: string; name: string } | null }>("/api/web/today", { ttlMs: 60_000, epoch: dataEpoch, userId }).catch(() => null),
          cachedApiFetch<ScheduleResponse>("/api/web/schedule", { epoch: dataEpoch, userId }).catch(() => null),
          cachedApiFetch<StarterPlan[]>("/api/web/starter-plans", { epoch: dataEpoch, userId }).catch(() => []),
        ]);

        const activeTemplates = templatesRes.filter((t) => !t.deleted);
        const activeDrafts = draftsRes.filter((d) => !d.deleted);
        const activeRoutines = activeRes?.data?.routines ?? [];
        const saved = activeTemplates.map((t) => t.data);
        const unapplied = activeDrafts
          .filter((record) => !activeRes?.history?.some((entry) => entry.id === record.id && entry.version === record.version))
          .filter((record) => record.id !== activeRes?.id || record.version !== activeRes?.version)
          .reverse();

        const ids = [
          ...activeRoutines,
          ...saved,
          ...unapplied.flatMap((entry) => entry.data.routines),
        ].flatMap((routine) => routine.exercises.flatMap((row) => [row.exerciseId, row.backupExerciseId ?? ""].filter(Boolean)));
        const catMap = await resolveCatalogueMap(ids);

        if (!active) return;
        const nextSnap: PlanViewSnap = {
          activePlan: activeRes,
          templates: activeTemplates,
          drafts: unapplied,
          aiReady: Boolean(meRes?.aiReady),
          currentDay: todayRes,
          schedule: schedRes,
          starterPlans: startersRes,
          catalogueMap: catMap,
        };
        writeQueryCache("view:plan", nextSnap, { userId, epoch: dataEpoch });
        setActivePlan(nextSnap.activePlan);
        setTemplates(nextSnap.templates);
        setDrafts(nextSnap.drafts);
        setAiReady(nextSnap.aiReady);
        setCurrentDay(nextSnap.currentDay);
        setSchedule(nextSnap.schedule);
        setStarterPlans(nextSnap.starterPlans);
        setCatalogueMap(nextSnap.catalogueMap);
      } catch (err) {
        if (active) setError((err as Error)?.message || "加载训练计划失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  if (loading && !activePlan && !starterPlans.length) {
    return (
      <>
        <WorkspaceTabs />
        <div className="empty loading" role="status">
          正在加载训练计划…
        </div>
      </>
    );
  }

  if (error && !activePlan && !starterPlans.length) {
    return (
      <>
        <WorkspaceTabs />
        <div className="empty">
          <strong>训练计划加载失败</strong>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      </>
    );
  }

  const planData = activePlan?.data;
  const activeRoutines = planData?.routines ?? [];
  const next = currentDay?.planned;
  const todayStr = today();

  const planShortcut = currentDay?.active
    ? {
        label: "进行中的训练",
        name: currentDay.active.title,
        note: `${currentDay.active.done}/${currentDay.active.total} 组`,
        action: () => {
          void apiFetch<RecordEnvelope<WorkoutData>>(
            `/api/web/records/workout/${encodeURIComponent(currentDay.active!.id)}`,
          )
            .then((rec) => openWorkoutEditor({ record: rec }))
            .catch(() => resumeLocalWorkoutDraft(userId));
        },
        button: "继续训练",
      }
    : next
      ? {
          label: next.date === currentDay?.date ? "今日安排" : "下一次训练",
          name: next.name,
          note: `${shortDate(next.date)} · ${next.exercises} 个动作`,
          action: () =>
            next.source === "scheduled"
              ? openRoutinePreview({ id: next.date, source: "scheduled", date: next.date })
              : openRoutinePreview({ id: next.id, source: "plan", date: next.date }),
          button: "预览训练",
        }
      : currentDay?.applePlan
        ? {
            label: "今日已完成",
            name: currentDay.applePlan.name,
            note: "Apple 健康已同步",
            action: () => navigate("workout"),
            button: "查看训练",
          }
        : null;

  const routineMuscleSummary = (routine: { exercises: PlannedExercise[] }): Array<[MuscleKey, number]> => {
    const tracked = new Set<MuscleKey>(["chest", "back", "legs", "shoulders", "arms", "core"]);
    const mMap = new Map<MuscleKey, number>();
    for (const row of routine.exercises ?? []) {
      const ex = catalogueMap.get(row.exerciseId);
      if (!ex) continue;
      if (tracked.has(ex.muscle)) mMap.set(ex.muscle, (mMap.get(ex.muscle) ?? 0) + (row.sets || 0));
      for (const sec of ex.secondaryMuscles ?? []) {
        if (sec !== ex.muscle && tracked.has(sec)) mMap.set(sec, (mMap.get(sec) ?? 0) + (row.sets || 0) * 0.5);
      }
    }
    return [...mMap.entries()]
      .map(([k, v]) => [k, Math.round(v * 10) / 10] as [MuscleKey, number])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
  };

  const handleAdoptStarter = async (preset: StarterPlan, mode: "draft" | "apply") => {
    if (mode === "apply" && planData && armedStarterId !== preset.id) {
      setArmedStarterId(preset.id);
      return;
    }
    setAdoptingId(preset.id);
    try {
      await apiFetch(`/api/web/starter-plans/${encodeURIComponent(preset.id)}/adopt`, {
        method: "POST",
        body: { mode, expectedRevision: activePlan?.revision ?? 0 },
      });
      setArmedStarterId("");
      bumpDataEpoch();
      setPlanTab(mode === "apply" ? "current" : "drafts");
      notify(mode === "apply" ? `已启用「${preset.plan.name}」` : `已将「${preset.plan.name}」存为草稿`);
    } catch (err) {
      notify((err as Error)?.message || "选用方案失败");
    } finally {
      setAdoptingId("");
    }
  };

  const handleDeleteTemplate = (tpl: RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }>) => {
    openConfirm({
      title: "删除训练模板",
      message: `确定删除训练模板「${tpl.data.name}」吗？`,
      confirmLabel: "删除模板",
      onConfirm: async () => {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id: tpl.id,
            kind: "template",
            baseVersion: tpl.version,
            deleted: true,
            data: tpl.data,
          },
        });
        bumpDataEpoch();
        notify(`已删除模板「${tpl.data.name}」`);
      },
    });
  };

  const handleShiftDay = async (fromDate: string) => {
    const toDate = shiftDateStr(fromDate, 1);
    try {
      await apiFetch("/api/web/schedule/shift", { method: "POST", body: { fromDate, toDate } });
      bumpDataEpoch();
      notify(`已将 ${shortDate(fromDate)} 训练顺延至 ${shortDate(toDate)}`);
    } catch (err) {
      notify((err as Error)?.message || "顺延失败");
    }
  };

  const upcomingDays = (schedule?.days ?? []).filter((d) => d.date >= todayStr);
  const maxMuscleTotal = Math.max(12, ...(schedule?.weekForecast?.muscles ?? []).map((m) => m.total));

  const renderRoutineCard = (
    routine: PlanRoutine | { id: string; name: string; exercises: PlannedExercise[] },
    index: number,
    isActiveRoutine: boolean,
    templateRec?: RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }>,
  ) => {
    const checkedIn = isActiveRoutine && currentDay?.applePlan?.routineId === routine.id;
    const isNext = isActiveRoutine && next?.id === routine.id;
    const mChips = routineMuscleSummary(routine);
    const ssBadges = supersetBadges(routine.exercises);

    return (
      <section
        key={templateRec?.id ?? routine.id}
        className={`panel routine routine-card${checkedIn ? " is-done" : isNext ? " is-next" : ""}`}
      >
        <header className="panel-head">
          <div>
            <h3>{routine.name}</h3>
            {checkedIn ? (
              <span className="apple-status">Apple 健康已完成</span>
            ) : isNext ? (
              <span className="plan-next-tag">下次安排</span>
            ) : isActiveRoutine && planData?.schedule === "weekdays" && planData.weekdays?.[index] ? (
              <p>星期{WEEKDAY_CHARS[planData.weekdays[index]! - 1] ?? ""}</p>
            ) : null}
          </div>
          <div className="routine-head-actions">
            <button
              type="button"
              className="secondary-button"
              aria-label={`预览训练 ${routine.name}`}
              onClick={() => openRoutinePreview({ id: routine.id, source: isActiveRoutine ? "plan" : "template" })}
            >
              预览训练
            </button>
            {!isActiveRoutine && templateRec ? (
              <>
                <button
                  type="button"
                  className="quiet"
                  aria-label={`编辑模板 ${routine.name}`}
                  onClick={() => openTemplateEditorModal(templateRec)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="quiet icon-button"
                  aria-label="删除模板"
                  onClick={() => handleDeleteTemplate(templateRec)}
                >
                  <Icon name="close" size={15} />
                </button>
              </>
            ) : null}
          </div>
        </header>

        {mChips.length ? (
          <div className="routine-muscles" aria-label="本训练日肌群有效组数">
            {mChips.map(([k, v]) => (
              <span key={k}>
                {MUSCLES[k] ?? k} <b>{fmt(v)}</b> 组
              </span>
            ))}
          </div>
        ) : null}

        <details>
          <summary>
            {routine.exercises.length} 个动作 <Icon name="chevron" size={14} />
          </summary>
          <ol>
            {routine.exercises.map((row, exIdx) => {
              const progTxt = PROGRESSION_SHORT_LABELS[row.progression];
              const backupName = row.backupExerciseId
                ? catalogueMap.get(row.backupExerciseId)?.name ?? row.backupExerciseId
                : "";
              const ssTag = ssBadges[exIdx];
              return (
                <li key={`${row.exerciseId}-${exIdx}`}>
                  <span>
                    {ssTag ? <span className="superset-pill">超级组 {ssTag}</span> : null}
                    <b>{catalogueMap.get(row.exerciseId)?.name ?? row.exerciseId}</b>
                    {progTxt ? (
                      <small className="routine-prog-meta">
                        {progTxt}
                        {backupName ? ` · 备选 ${backupName}` : ""}
                      </small>
                    ) : null}
                  </span>
                  <span>
                    {row.sets} 组 × {row.seconds ? `${row.seconds} 秒` : `${row.repsMin}–${row.repsMax} 次`}
                    {row.weight ? ` · ${fmt(row.weight)} kg` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </details>
      </section>
    );
  };

  return (
    <>
      <WorkspaceTabs />
      <header className="page-heading masthead-plan">
        <div>
          <h1>训练计划</h1>
          <p>{planData ? `${planData.name} · ${planData.weeks} 周` : "周期编排、渐进负荷与排期"}</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              openPlanImportModal({
                hasActivePlan: Boolean(planData),
                expectedRevision: activePlan?.revision ?? 0,
              })
            }
          >
            <Icon name="upload" size={15} /> 导入计划
          </button>
          <button
            type="button"
            className={aiReady ? "secondary-button" : "primary-button"}
            onClick={() => openPlanBuilderModal()}
          >
            <Icon name="plus" size={16} /> 新建计划
          </button>
          {aiReady ? (
            <button type="button" className="primary-button" onClick={() => openAiPlanModal(activePlan?.id)}>
              <Icon name="bolt" size={16} /> 智能排课
            </button>
          ) : null}
        </div>
      </header>

      <div className="page-sections plan-sections" role="group" aria-label="训练计划分类">
        <div className="segments">
          {(
            [
              ["current", "当前计划"],
              ["horizon", "未来排期"],
              ["starters", "经典方案"],
              ["templates", "训练模板"],
              ["drafts", "计划草稿"],
            ] as ReadonlyArray<readonly [PlanTab, string]>
          ).map(([tabId, label]) => (
            <button key={tabId} type="button" aria-pressed={planTab === tabId} onClick={() => setPlanTab(tabId)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {planTab === "current" ? (
        <div>
          {planShortcut ? (
            <section className="panel plan-shortcut">
              <div>
                <h2>{planShortcut.name}</h2>
                <p className="shortcut-meta">
                  <i aria-hidden="true" />
                  {planShortcut.label} · {planShortcut.note}
                </p>
              </div>
              <button type="button" className="primary-button" onClick={planShortcut.action}>
                {planShortcut.button}
                <Icon name="chevron" size={16} />
              </button>
            </section>
          ) : null}

          <section className={`panel deload-card${workoutPrefs.deloadMode ? " is-active" : ""}`}>
            <div className="deload-card-head">
              <div>
                <strong>减载周模式（Deload Week）</strong>
                <small>开启后，从计划开练时自动按比例下调目标重量与组数，帮助消除累积疲劳</small>
              </div>
              <input
                type="checkbox"
                className="switch"
                aria-label="开启减载周模式"
                checked={workoutPrefs.deloadMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  writeWorkoutPreference("deloadMode", next);
                  setWorkoutPrefs(readWorkoutPreferences());
                  notify(next ? "已开启减载周模式" : "已恢复常规训练负荷");
                }}
              />
            </div>
            {workoutPrefs.deloadMode ? (
              <div className="deload-card-ratios">
                <div className="deload-ratio-group">
                  <span>目标重量比例</span>
                  <div className="segments">
                    {[70, 75, 80].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        aria-pressed={workoutPrefs.deloadWeightPct === pct}
                        onClick={() => {
                          writeWorkoutPreference("deloadWeightPct", pct);
                          setWorkoutPrefs(readWorkoutPreferences());
                        }}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
                <div className="deload-ratio-group">
                  <span>目标组数比例</span>
                  <div className="segments">
                    {[50, 75].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        aria-pressed={workoutPrefs.deloadSetsPct === pct}
                        onClick={() => {
                          writeWorkoutPreference("deloadSetsPct", pct);
                          setWorkoutPrefs(readWorkoutPreferences());
                        }}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {planData && activePlan ? (
            <>
              <section className="plan-summary">
                <header className="panel-head">
                  <div>
                    <h2>{planData.name}</h2>
                    <p>
                      {planData.weeks} 周 · {planData.schedule === "rotation" ? "按顺序轮换" : "按星期执行"}
                    </p>
                  </div>
                  <div className="plan-summary-actions">
                    <button type="button" className="secondary-button" onClick={() => exportPlanAsJson(planData, notify)}>
                      <Icon name="download" size={14} /> 导出 JSON
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openPlanBuilderModal({ id: activePlan.id, version: activePlan.version, data: planData })}
                    >
                      编辑此计划
                    </button>
                  </div>
                </header>
                {planData.rationale ? (
                  <details className="plan-rationale">
                    <summary>
                      <span>计划说明</span>
                      <Icon name="chevron" size={14} />
                    </summary>
                    <p>{planData.rationale}</p>
                  </details>
                ) : null}
              </section>
              <div className={`routine-grid${activeRoutines.length === 3 ? " is-three" : ""}`}>
                {activeRoutines.map((r, i) => renderRoutineCard(r, i, true))}
              </div>
            </>
          ) : (
            <div className="empty">
              <strong>暂无生效计划</strong>
              <p>{aiReady ? "可直接选用「经典方案」，或点击右上角「新建计划」「智能排课」。" : "可直接选用「经典方案」，或点击右上角「新建计划」开始排课。"}</p>
              <button type="button" className="secondary-button" onClick={() => setPlanTab("starters")}>
                <Icon name="plan" size={16} /> 浏览经典方案
              </button>
            </div>
          )}
        </div>
      ) : null}

      {planTab === "horizon" ? (
        <section>
          {schedule ? (
            <div className="horizon-layout">
              {schedule.weekForecast ? (
                <section className="panel forecast-card">
                  <header className="panel-head">
                    <div>
                      <h2>本周肌群负荷预测</h2>
                      <p>
                        {shortDate(schedule.weekForecast.weekStart)} – {shortDate(schedule.weekForecast.weekEnd)} · 已完成 + 未来排期
                      </p>
                    </div>
                    <span className="status-pill">
                      {
                        upcomingDays.filter(
                          (d) =>
                            d.date <= schedule.weekForecast!.weekEnd &&
                            (d.status === "scheduled" || d.status === "projected"),
                        ).length
                      }{" "}
                      场待练
                    </span>
                  </header>
                  <div className="forecast-grid">
                    {schedule.weekForecast.muscles.map((m) => (
                      <div key={m.key} className="forecast-row">
                        <span className="forecast-name">{MUSCLES[m.key] ?? m.key}</span>
                        <div className="forecast-bar">
                          <ThinMeter ratio={m.total / maxMuscleTotal} />
                        </div>
                        <span className="forecast-num">
                          {m.completed}
                          {m.planned ? <i>+{m.planned}</i> : null} 组
                        </span>
                      </div>
                    ))}
                  </div>
                  {schedule.weekForecast.conflicts?.length ? (
                    <p className="forecast-conflict">
                      <Icon name="bolt" size={14} /> {schedule.weekForecast.conflicts.join("；")}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="panel horizon-card">
                <header className="panel-head">
                  <div>
                    <h2>未来 14 天排期日程</h2>
                    <p>点击任意日期可直接调整训练日、设为休息或顺延安排</p>
                  </div>
                </header>
                <div className="horizon-list">
                  {upcomingDays.map((day) => {
                    const isToday = day.date === todayStr;
                    const badgeCls =
                      day.status === "completed"
                        ? "is-done"
                        : day.status === "scheduled"
                          ? "is-manual"
                          : day.status === "projected"
                            ? "is-plan"
                            : "is-rest";
                    const badgeLabel =
                      day.status === "completed"
                        ? "已完成"
                        : day.status === "scheduled"
                          ? "手动排期"
                          : day.status === "projected"
                            ? "计划顺排"
                            : day.source === "rest"
                              ? "休息日"
                              : "待安排";
                    const hasRoutine = day.status === "scheduled" || day.status === "projected";
                    const meta = hasRoutine
                      ? `${day.exercisesCount} 动作 · 约 ${day.estimatedMinutes} 分钟${
                          day.muscles.length ? ` · ${day.muscles.map((m) => MUSCLES[m] ?? m).join("/")}` : ""
                        }`
                      : day.notes || (day.status === "completed" ? "已计入本周完成" : "可点击排训练或保持恢复");

                    return (
                      <div
                        key={day.date}
                        className={`horizon-row${isToday ? " is-today" : ""}${day.status === "scheduled" ? " is-manual-row" : ""}`}
                      >
                        <div className="horizon-date">
                          <strong>{shortDate(day.date)}</strong>
                          <span>{isToday ? "今天" : formatWeekdayZh(day.date)}</span>
                        </div>
                        <div className="horizon-main">
                          <div className="horizon-title">
                            <span className={`drawer-badge ${badgeCls}`}>{badgeLabel}</span>
                            <strong>{day.title}</strong>
                          </div>
                          <small>{meta}</small>
                        </div>
                        <div className="horizon-actions">
                          {day.status !== "completed" ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => openDayScheduler(day.date)}
                            >
                              {hasRoutine ? "调整" : "排训练"}
                            </button>
                          ) : null}
                          {hasRoutine ? (
                            <>
                              <button
                                type="button"
                                className="quiet"
                                onClick={() => openRoutinePreview({ id: day.date, source: "scheduled", date: day.date })}
                              >
                                动作/PR
                              </button>
                              <button type="button" className="quiet" onClick={() => void handleShiftDay(day.date)}>
                                顺延
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : (
            <p className="muted">暂时无法加载排期数据。</p>
          )}
        </section>
      ) : null}

      {planTab === "starters" ? (
        <section>
          {starterPlans.length ? (
            <div className="starter-plan-grid">
              {starterPlans.map((preset) => {
                const names = preset.exerciseNames ?? {};
                const busy = adoptingId === preset.id;
                const armed = armedStarterId === preset.id;
                return (
                  <section key={preset.id} className="panel starter-card">
                    <header className="starter-card-head">
                      <div className="starter-card-meta">
                        <span className="starter-tag">{preset.tag}</span>
                        <small>
                          {preset.level} · 每周 {preset.daysPerWeek} 练 · {preset.plan.weeks} 周
                        </small>
                      </div>
                      <h3>{preset.plan.name}</h3>
                      <p className="muted">{preset.summary}</p>
                    </header>

                    {preset.equipmentTags?.length ? (
                      <div className="starter-equip-row">
                        {preset.equipmentTags.map((eq) => (
                          <span key={eq}>{EQUIPMENT[eq] ?? eq}</span>
                        ))}
                      </div>
                    ) : null}

                    {preset.weeklyMuscleSets?.length ? (
                      <div className="starter-muscles" aria-label="每周肌群有效组数">
                        {preset.weeklyMuscleSets.map((m) => (
                          <span key={m.name}>
                            {m.name} <b>{fmt(m.sets)}</b> 组
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <details>
                      <summary>
                        {preset.plan.routines.length} 个训练日明细 <Icon name="chevron" size={14} />
                      </summary>
                      <div className="starter-routines">
                        {preset.plan.routines.map((rt) => (
                          <div key={rt.id} className="starter-routine-block">
                            <strong>{rt.name}</strong>
                            <ol>
                              {rt.exercises.map((row, exIdx) => (
                                <li key={`${row.exerciseId}-${exIdx}`}>
                                  <span>{names[row.exerciseId] ?? catalogueMap.get(row.exerciseId)?.name ?? row.exerciseId}</span>
                                  <span>
                                    {row.sets} 组 ×{" "}
                                    {row.seconds ? `${row.seconds} 秒` : `${row.repsMin}–${row.repsMax} 次`}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        ))}
                      </div>
                    </details>

                    <footer className="starter-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void handleAdoptStarter(preset, "draft")}
                      >
                        存为草稿
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void handleAdoptStarter(preset, "apply")}
                      >
                        {busy ? "应用中…" : armed ? "确认覆盖当前计划" : "一键启用"}
                      </button>
                    </footer>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="empty">
              <strong>暂无经典方案</strong>
            </div>
          )}
        </section>
      ) : null}

      {planTab === "templates" ? (
        <section>
          <div className="templates-head-bar">
            <button type="button" className="secondary-button" onClick={() => openTemplateEditorModal()}>
              <Icon name="plus" size={15} /> 新建训练模板
            </button>
          </div>
          {templates.length ? (
            <div className={`routine-grid${templates.length === 3 ? " is-three" : ""}`}>
              {templates.map((tpl, i) => renderRoutineCard(tpl.data, i, false, tpl))}
            </div>
          ) : (
            <div className="empty">
              <strong>还没有训练模板</strong>
              <p>可直接点击上方「新建训练模板」，或在训练复盘里把一次训练存为模板。</p>
              <button type="button" className="secondary-button" onClick={() => openTemplateEditorModal()}>
                <Icon name="plus" size={15} /> 新建训练模板
              </button>
            </div>
          )}
        </section>
      ) : null}

      {planTab === "drafts" ? (
        <section>
          {drafts.length ? (
            <div className="panel plan-drafts">
              {drafts.map((entry) => (
                <button
                  key={`${entry.id}-${entry.version}`}
                  className="record-line"
                  type="button"
                  onClick={() => openPlanDraftModal(entry, catalogueMap, activePlan?.revision ?? 0)}
                >
                  <span className="record-icon">
                    <Icon name="plan" />
                  </span>
                  <span>
                    <strong>{entry.data.name}</strong>
                    <small>
                      {entry.data.weeks} 周 · {entry.data.routines.length} 个训练日
                    </small>
                  </span>
                  <span />
                  <Icon name="chevron" size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <strong>还没有计划草稿</strong>
              <p>{aiReady ? "生成计划草稿后，可在这里预览与启用。" : "点击右上角「新建计划」或导入方案即可在此管理草稿。"}</p>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
