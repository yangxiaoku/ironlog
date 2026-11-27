import { useEffect, useMemo, useState } from "react";
import { classicLiftIds, classicStrength } from "@ironlog/shared";
import { Icon } from "../components/Icon";
import { MuscleBodyMap } from "../components/MuscleBodyMap";
import type { ScheduleResponse } from "../components/plan/PlanModals";
import { PageHeading, WorkspaceTabs } from "../components/WorkspaceTabs";
import { apiFetch } from "../lib/api";
import { displayWeekday, duration, fmt, shortDate, today } from "../lib/date";
import {
  FEELINGS,
  MUSCLES,
  findLocalWorkoutDraft,
  summarizeWorkoutRecord,
  workoutSeconds,
  type MuscleKey,
  type ProfileGoals,
  type RecordEnvelope,
  type TodayResponse,
  type TrainedExerciseSummary,
  type WorkoutData,
} from "../lib/domain";
import { triggerHaptic } from "../lib/haptics-audio";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import {
  launchRoutineDirectly,
  openRoutinePreview,
  openWorkoutEditor,
  openWorkoutReport,
  resumeLocalWorkoutDraft,
} from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

interface WorkoutViewSnap {
  records: Array<RecordEnvelope<WorkoutData>>;
  trainedItems: TrainedExerciseSummary[];
  goals: ProfileGoals | null;
  todayInfo: TodayResponse | null;
  schedule: ScheduleResponse | null;
}

export function WorkoutView() {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const notify = useUiStore((s) => s.notify);
  const cached = peekQuery<WorkoutViewSnap>("view:workout", userId)?.data;

  const [records, setRecords] = useState<Array<RecordEnvelope<WorkoutData>>>(() => cached?.records ?? []);
  const [trainedItems, setTrainedItems] = useState<TrainedExerciseSummary[]>(() => cached?.trainedItems ?? []);
  const [goals, setGoals] = useState<ProfileGoals | null>(() => cached?.goals ?? null);
  const [todayInfo, setTodayInfo] = useState<TodayResponse | null>(() => cached?.todayInfo ?? null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(() => cached?.schedule ?? null);
  const [quickWeightInput, setQuickWeightInput] = useState("");
  const [savingQuickWeight, setSavingQuickWeight] = useState(false);
  const [launchingKey, setLaunchingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleKey | "">("");
  const [shownCount, setShownCount] = useState(15);

  useEffect(() => {
    let active = true;
    if (!peekQuery("view:workout", userId)) setLoading(true);
    setError("");
    void Promise.all([
      cachedApiFetch<Array<RecordEnvelope<WorkoutData>>>("/api/records/workout", { epoch: dataEpoch, userId }),
      cachedApiFetch<{ items?: TrainedExerciseSummary[] }>("/api/web/trained-exercises", { epoch: dataEpoch, userId }).catch(() => ({ items: [] })),
      cachedApiFetch<{ profile: ProfileGoals }>("/api/web/profile", { epoch: dataEpoch, userId }).catch(() => null),
      cachedApiFetch<TodayResponse>("/api/web/today", { ttlMs: 60_000, epoch: dataEpoch, userId }).catch(() => null),
      cachedApiFetch<ScheduleResponse>("/api/web/schedule", { epoch: dataEpoch, userId }).catch(() => null),
    ])
      .then(([recs, trainedRes, profRes, todayRes, schedRes]) => {
        if (!active) return;
        const nextSnap: WorkoutViewSnap = {
          records: recs.filter((r) => !r.deleted && r.data.status !== "cancelled"),
          trainedItems: trainedRes.items ?? [],
          goals: profRes?.profile ?? null,
          todayInfo: todayRes ?? null,
          schedule: schedRes ?? null,
        };
        writeQueryCache("view:workout", nextSnap, { userId, epoch: dataEpoch });
        setRecords(nextSnap.records);
        setTrainedItems(nextSnap.trainedItems);
        setGoals(nextSnap.goals);
        setTodayInfo(nextSnap.todayInfo);
        setSchedule(nextSnap.schedule);
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载训练记录失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  const activeWorkouts = useMemo(
    () => records.filter((r) => r.data.status === "active"),
    [records],
  );
  const localDraft = useMemo(
    () => (activeWorkouts.length === 0 ? findLocalWorkoutDraft(userId) : null),
    [userId, activeWorkouts.length, dataEpoch],
  );

  const completed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records
      .filter((r) => r.data.status === "completed")
      .filter((r) => {
        if (muscle && !(r.data.exercises ?? []).some((ex) => ex.snapshot?.muscle === muscle)) return false;
        if (!q) return true;
        const hay = [
          r.data.title,
          r.data.notes,
          ...(r.data.exercises ?? []).flatMap((ex) => [ex.snapshot?.name, ex.exerciseId]),
        ];
        return hay.some((t) => String(t ?? "").toLowerCase().includes(q));
      })
      .sort((a, b) => b.data.date.localeCompare(a.data.date) || Date.parse(b.data.startedAt) - Date.parse(a.data.startedAt));
  }, [records, query, muscle]);

  const byMonth = useMemo(() => {
    const map = new Map<string, Map<string, Array<RecordEnvelope<WorkoutData>>>>();
    for (const rec of completed.slice(0, shownCount)) {
      const m = rec.data.date.slice(0, 7);
      let mMap = map.get(m);
      if (!mMap) {
        mMap = new Map();
        map.set(m, mMap);
      }
      const list = mMap.get(rec.data.date) ?? [];
      list.push(rec);
      mMap.set(rec.data.date, list);
    }
    return map;
  }, [completed, shownCount]);

  const prPicks = useMemo(() => {
    const withRealPr = trainedItems.filter((e) =>
      e.mode === "timed"
        ? e.bestHold != null && e.bestHold > 0
        : (e.best1rm != null && e.best1rm > 0) || (e.bestWeight != null && e.bestWeight > 0),
    );
    if (!withRealPr.length) return [];
    const byId = new Map(withRealPr.map((i) => [i.id, i]));
    const picks: TrainedExerciseSummary[] = [];
    const seen = new Set<string>();
    for (const id of [...classicLiftIds.bench, ...classicLiftIds.squat, ...classicLiftIds.deadlift, "overhead-press", "barbell-row"]) {
      const hit = byId.get(id);
      if (hit) {
        picks.push(hit);
        seen.add(id);
      }
    }
    const score = (e: TrainedExerciseSummary) =>
      e.mode === "timed" ? e.bestHold ?? 0 : e.best1rm ?? e.bestWeight ?? 0;
    for (const item of [...withRealPr].sort((a, b) => score(b) - score(a))) {
      if (picks.length >= 6) break;
      if (!seen.has(item.id)) {
        seen.add(item.id);
        picks.push(item);
      }
    }
    return picks;
  }, [trainedItems]);

  const sbdTotal = useMemo(() => {
    const byId = new Map(trainedItems.map((i) => [i.id, i]));
    return classicStrength((id) => byId.get(id)?.best1rm).total;
  }, [trainedItems]);

  const handleQuickPreWorkoutWeight = async () => {
    const val = Number(quickWeightInput);
    if (!Number.isFinite(val) || val < 20 || val > 350 || savingQuickWeight) {
      notify("请输入有效体重（20–350 kg）");
      return;
    }
    setSavingQuickWeight(true);
    try {
      const todayKey = today();
      const existing = await apiFetch<RecordEnvelope<{ date: string; weight: number; bodyFat?: number | null }> | null>(
        `/api/web/records/weight/${encodeURIComponent(`weight_${todayKey}`)}`,
      ).catch(() => null);
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId: crypto.randomUUID(),
          id: `weight_${todayKey}`,
          kind: "weight",
          baseVersion: existing?.version ?? 0,
          deleted: false,
          data: {
            date: todayKey,
            weight: Math.round(val * 100) / 100,
            bodyFat: existing?.data?.bodyFat ?? null,
          },
        },
      });
      setQuickWeightInput("");
      bumpDataEpoch();
      notify(`已记录今日训前体重 ${fmt(val, 1)} kg`);
    } catch (err) {
      notify((err as Error)?.message || "记录体重失败");
    } finally {
      setSavingQuickWeight(false);
    }
  };

  const launchRoutines = schedule?.activePlan?.routines ?? [];
  const launchTemplates = schedule?.templates ?? [];
  const plannedToday = todayInfo?.planned ?? null;
  const primaryActiveCloud = activeWorkouts[0] ?? null;
  const localDraftSummary = useMemo(() => {
    if (!localDraft) return null;
    try {
      const parsed = JSON.parse(localDraft.raw) as {
        title?: string;
        exercises?: Array<{ sets?: Array<{ completed?: boolean }> }>;
      };
      const exList = Array.isArray(parsed.exercises) ? parsed.exercises : [];
      const total = exList.reduce((sum, e) => sum + (e.sets?.length ?? 0), 0);
      const done = exList.reduce((sum, e) => sum + (e.sets?.filter((s) => s.completed).length ?? 0), 0);
      return { title: parsed.title?.trim() || "未命名训练草稿", exercisesCount: exList.length, done, total };
    } catch {
      return { title: "未保存的训练草稿", exercisesCount: 0, done: 0, total: 0 };
    }
  }, [localDraft]);

  const handleDirectLaunch = async (key: string, params: { id: string; source: "plan" | "template" | "scheduled"; date: string }) => {
    if (launchingKey) return;
    triggerHaptic("light");
    setLaunchingKey(key);
    try {
      await launchRoutineDirectly({ ...params, goals });
    } finally {
      setLaunchingKey(null);
    }
  };

  return (
    <>
      <WorkspaceTabs />
      <PageHeading
        title="训练"
        view="workout"
        controls={
          <div className="heading-actions">
            <button type="button" className="secondary-button" onClick={() => openWorkoutEditor({ goals })}>
              <Icon name="plus" size={16} /> 自由训练
            </button>
          </div>
        }
      />

      {/* OpenGym-style Workout Launchpad Console (Draft-First & 1-Tap Direct Start) */}
      <section
        className={`panel workout-launchpad${primaryActiveCloud || localDraft ? " is-ongoing" : ""}`}
        aria-label="今日开练控制台"
      >
        <div className="launchpad-hero">
          {primaryActiveCloud ? (
            <>
              <div className="launchpad-hero-info">
                <span className="launchpad-eyebrow">进行中的训练</span>
                <h2>{primaryActiveCloud.data.title}</h2>
                <p className="muted">
                  {shortDate(primaryActiveCloud.data.date)} · {primaryActiveCloud.data.exercises.length} 个动作 · 已完成{" "}
                  {primaryActiveCloud.data.exercises.reduce((s, e) => s + e.sets.filter((x) => x.completed).length, 0)}/
                  {primaryActiveCloud.data.exercises.reduce((s, e) => s + e.sets.length, 0)} 组
                </p>
              </div>
              <div className="launchpad-hero-cta">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openWorkoutEditor({ record: primaryActiveCloud, goals })}
                >
                  继续进行中的训练
                </button>
              </div>
            </>
          ) : localDraft && localDraftSummary ? (
            <>
              <div className="launchpad-hero-info">
                <span className="launchpad-eyebrow">本机未保存草稿</span>
                <h2>{localDraftSummary.title}</h2>
                <p className="muted">
                  {localDraftSummary.exercisesCount} 个动作 · 已完成 {localDraftSummary.done}/{localDraftSummary.total} 组
                </p>
              </div>
              <div className="launchpad-hero-cta">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void resumeLocalWorkoutDraft(userId, goals)}
                >
                  继续训练
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    openConfirm({
                      title: "丢弃未保存训练草稿",
                      message: "确定要丢弃本机未保存的训练草稿吗？此操作不可撤销。",
                      confirmLabel: "丢弃草稿",
                      onConfirm: () => {
                        try {
                          localStorage.removeItem(localDraft.key);
                        } catch {}
                        bumpDataEpoch();
                        notify("已丢弃本机训练草稿");
                      },
                    });
                  }}
                >
                  丢弃
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="launchpad-hero-info">
                <span className="launchpad-eyebrow">
                  {plannedToday
                    ? plannedToday.date === today()
                      ? "今日计划"
                      : `下一次计划 · ${shortDate(plannedToday.date)}`
                    : "自由开练"}
                  {plannedToday?.scheduleMode === "rotation" ? (
                    <em className="today-mode-pill">轮换顺延</em>
                  ) : null}
                </span>
                <h2>{plannedToday ? plannedToday.name : "随时开始自由训练"}</h2>
                <p className="muted">
                  {plannedToday
                    ? `${plannedToday.exercises} 个动作 · 一键直达第 1 组并自动带出渐进目标`
                    : "边练边选动作，或从下方挑一个常用训练日直接开练"}
                </p>
              </div>
              {plannedToday?.muscleScores && Object.keys(plannedToday.muscleScores).length > 0 ? (
                <div className="launchpad-hero-map">
                  <MuscleBodyMap size="sm" scores={plannedToday.muscleScores} />
                </div>
              ) : null}
              <div className="launchpad-hero-cta">
                {plannedToday ? (
                  <>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={launchingKey !== null}
                      onClick={() =>
                        void handleDirectLaunch("today", {
                          id: plannedToday.source === "scheduled" ? plannedToday.date : plannedToday.id,
                          source: plannedToday.source === "scheduled" ? "scheduled" : "plan",
                          date: plannedToday.date,
                        })
                      }
                    >
                      {launchingKey === "today" ? "准备中…" : "一键开练"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={launchingKey !== null}
                      onClick={() =>
                        openRoutinePreview({
                          id: plannedToday.source === "scheduled" ? plannedToday.date : plannedToday.id,
                          source: plannedToday.source === "scheduled" ? "scheduled" : "plan",
                          date: plannedToday.date,
                        })
                      }
                    >
                      预览目标
                    </button>
                  </>
                ) : (
                  <button type="button" className="primary-button" onClick={() => openWorkoutEditor({ goals })}>
                    <Icon name="plus" size={15} /> 开始自由训练
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {(launchRoutines.length > 0 || launchTemplates.length > 0) ? (
          <div className="launchpad-quick-row">
            <span className="muted">快捷开练：</span>
            <div className="launchpad-chips">
              {launchRoutines.map((r) => (
                <button
                  key={`r:${r.id}`}
                  type="button"
                  className="launchpad-chip"
                  disabled={launchingKey !== null}
                  onClick={() => void handleDirectLaunch(`r:${r.id}`, { id: r.id, source: "plan", date: today() })}
                >
                  {launchingKey === `r:${r.id}` ? "准备中…" : r.name}
                </button>
              ))}
              {launchTemplates.slice(0, 6).map((t) => (
                <button
                  key={`t:${t.id}`}
                  type="button"
                  className="launchpad-chip"
                  disabled={launchingKey !== null}
                  onClick={() => void handleDirectLaunch(`t:${t.id}`, { id: t.id, source: "template", date: today() })}
                >
                  {launchingKey === `t:${t.id}` ? "准备中…" : t.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="launchpad-weighin-bar">
          {todayInfo?.weight != null ? (
            <span className="muted">
              今日已称重：<strong>{fmt(todayInfo.weight, 1)} kg</strong>
            </span>
          ) : (
            <form
              className="launchpad-weighin-form"
              onSubmit={(e) => {
                e.preventDefault();
                void handleQuickPreWorkoutWeight();
              }}
            >
              <span className="muted">训前快记体重：</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min={20}
                max={350}
                placeholder="例如 75.5"
                value={quickWeightInput}
                onChange={(e) => setQuickWeightInput(e.target.value)}
              />
              <span className="muted">kg</span>
              <button type="submit" className="secondary-button" disabled={savingQuickWeight || !quickWeightInput.trim()}>
                {savingQuickWeight ? "保存中…" : "记录"}
              </button>
            </form>
          )}
        </div>
      </section>

      {error && records.length === 0 ? (
        <div className="empty">
          <strong>训练记录加载失败</strong>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      ) : null}

      {activeWorkouts.slice(1).map((draft) => (
        <section key={draft.id} className="panel" style={{ marginBottom: 14, borderColor: "var(--red)" }}>
          <header className="panel-head">
            <div>
              <h2>其他进行中的训练 · {draft.data.title}</h2>
              <p>{shortDate(draft.data.date)} · {draft.data.exercises.length} 个动作</p>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => openWorkoutEditor({ record: draft, goals })}
            >
              继续训练
            </button>
          </header>
        </section>
      ))}

      {prPicks.length ? (
        <section className="panel pr-wall-panel" style={{ marginBottom: 14 }}>
          <header className="panel-head">
            <div>
              <h2>主项 1RM</h2>
              <p>
                {sbdTotal != null
                  ? `三大项预估合计 ${fmt(sbdTotal, 1)} kg`
                  : `已记录 ${trainedItems.length} 个动作`}
              </p>
            </div>
            {prPicks.some((ex) => ex.name === query) ? (
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setQuery("");
                  setShownCount(15);
                }}
              >
                清除动作筛选
              </button>
            ) : null}
          </header>
          <div className="pr-wall-grid">
            {prPicks.map((ex) => {
              const isSelected = query === ex.name;
              return (
                <button
                  key={ex.id}
                  type="button"
                  className={`pr-wall-card${isSelected ? " is-active" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    triggerHaptic("light");
                    setQuery(isSelected ? "" : ex.name);
                    setShownCount(15);
                  }}
                >
                  <span className="pr-wall-name">{ex.name}</span>
                  <strong>
                    {ex.mode === "timed"
                      ? `${fmt(ex.bestHold)} 秒`
                      : ex.best1rm != null
                        ? `${fmt(ex.best1rm)} kg`
                        : ex.bestWeight != null
                          ? `${fmt(ex.bestWeight)} kg`
                          : "—"}
                  </strong>
                  <small>
                    {ex.sessionsCount} 场 · {ex.totalWorkSets} 工作组
                  </small>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="workout-filter-bar" style={{ marginBottom: 14 }}>
        <input
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShownCount(15);
          }}
          placeholder="搜索训练标题、动作名或备注…"
        />
        <div className="muscle-pills" role="group" aria-label="按肌群筛选历史">
          <button type="button" aria-pressed={muscle === ""} onClick={() => setMuscle("")}>
            全部
          </button>
          {(Object.entries(MUSCLES) as Array<[MuscleKey, string]>).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              aria-pressed={muscle === k}
              onClick={() => setMuscle(muscle === k ? "" : k)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {loading && records.length === 0 ? (
        <div className="skeleton-list">
          <div className="skeleton-block skeleton-row" />
          <div className="skeleton-block skeleton-row" />
        </div>
      ) : byMonth.size === 0 ? (
        <div className="empty">
          <strong>暂无已完成训练</strong>
          <p>{query || muscle ? "没有匹配的训练记录，试试清空筛选条件。" : "完成一场训练后，可以在这里回看每场容量与纪录。"}</p>
        </div>
      ) : (
        <>
          {[...byMonth].map(([month, days]) => (
            <section key={month} className="history-month">
              <header className="history-month-head">
                <h3>
                  {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
                </h3>
                <span>{[...days.values()].reduce((s, l) => s + l.length, 0)} 场</span>
              </header>
              {[...days].map(([date, list]) => (
                <section key={date} className="history-day">
                  <header>
                    <h3>
                      <time dateTime={date}>{shortDate(date)}</time>
                    </h3>
                    <p>
                      {displayWeekday(date)} · {list.length} 条
                    </p>
                  </header>
                  <div className="history-entries">
                    {list.map((rec) => {
                      const { sets, volume } = summarizeWorkoutRecord(rec.data);
                      const sec = workoutSeconds(rec.data);
                      const exNames = (rec.data.exercises ?? [])
                        .map((ex) => ex.snapshot?.name)
                        .filter((n): n is string => Boolean(n));
                      return (
                        <button
                          key={rec.id}
                          type="button"
                          className="record-line"
                          onClick={() => openWorkoutReport({ workoutId: rec.id, record: rec, goals })}
                        >
                          <span className="record-icon">
                            <Icon name="workout" />
                          </span>
                          <span>
                            <strong>{rec.data.title}</strong>
                            <small>
                              {duration(sec)}
                              {rec.data.feeling ? ` · ${FEELINGS[rec.data.feeling]}` : ""}
                            </small>
                            {exNames.length ? (
                              <small className="workout-row-exercises">
                                {exNames.slice(0, 3).join(" · ")}
                                {exNames.length > 3 ? ` 等 ${exNames.length} 项` : ""}
                              </small>
                            ) : null}
                          </span>
                          <span className="record-number">
                            {sets} 组{volume > 0 ? ` · ${fmt(volume)} kg` : ""}
                          </span>
                          <Icon name="chevron" size={15} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </section>
          ))}
          {completed.length > shownCount ? (
            <div className="history-more">
              <button type="button" className="secondary-button" onClick={() => setShownCount((n) => n + 15)}>
                查看更多记录（还有 {completed.length - shownCount} 场）
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
