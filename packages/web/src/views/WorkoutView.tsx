import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeading, WorkspaceTabs } from "../components/WorkspaceTabs";
import { apiFetch } from "../lib/api";
import { displayWeekday, duration, fmt, shortDate } from "../lib/date";
import {
  FEELINGS,
  MUSCLES,
  findLocalWorkoutDraft,
  summarizeWorkoutRecord,
  workoutSeconds,
  type MuscleKey,
  type ProfileGoals,
  type RecordEnvelope,
  type TrainedExerciseSummary,
  type WorkoutData,
} from "../lib/domain";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import { openAiWorkoutModal, openCsvImportModal, openWorkoutEditor, openWorkoutReport } from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

interface WorkoutViewSnap {
  records: Array<RecordEnvelope<WorkoutData>>;
  trainedItems: TrainedExerciseSummary[];
  goals: ProfileGoals | null;
}

export function WorkoutView() {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const cached = peekQuery<WorkoutViewSnap>("view:workout", userId)?.data;

  const [records, setRecords] = useState<Array<RecordEnvelope<WorkoutData>>>(() => cached?.records ?? []);
  const [trainedItems, setTrainedItems] = useState<TrainedExerciseSummary[]>(() => cached?.trainedItems ?? []);
  const [goals, setGoals] = useState<ProfileGoals | null>(() => cached?.goals ?? null);
  const [loading, setLoading] = useState(() => !cached);

  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleKey | "">("");
  const [shownCount, setShownCount] = useState(15);

  useEffect(() => {
    let active = true;
    if (!peekQuery("view:workout", userId)) setLoading(true);
    void Promise.all([
      cachedApiFetch<Array<RecordEnvelope<WorkoutData>>>("/api/records/workout", { epoch: dataEpoch, userId }),
      cachedApiFetch<{ items?: TrainedExerciseSummary[] }>("/api/web/trained-exercises", { epoch: dataEpoch, userId }).catch(() => ({ items: [] })),
      cachedApiFetch<{ profile: ProfileGoals }>("/api/web/profile", { epoch: dataEpoch, userId }).catch(() => null),
    ])
      .then(([recs, trainedRes, profRes]) => {
        if (!active) return;
        const nextSnap: WorkoutViewSnap = {
          records: recs.filter((r) => !r.deleted && r.data.status !== "cancelled"),
          trainedItems: trainedRes.items ?? [],
          goals: profRes?.profile ?? null,
        };
        writeQueryCache("view:workout", nextSnap, { userId, epoch: dataEpoch });
        setRecords(nextSnap.records);
        setTrainedItems(nextSnap.trainedItems);
        setGoals(nextSnap.goals);
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
    if (!trainedItems.length) return [];
    const byId = new Map(trainedItems.map((i) => [i.id, i]));
    const picks: TrainedExerciseSummary[] = [];
    const seen = new Set<string>();
    for (const id of ["bench-press", "squat", "deadlift", "romanian-deadlift", "overhead-press", "barbell-row"]) {
      const hit = byId.get(id);
      if (hit) {
        picks.push(hit);
        seen.add(id);
      }
    }
    const score = (e: TrainedExerciseSummary) =>
      e.mode === "timed" ? e.bestHold ?? 0 : e.best1rm ?? e.bestWeight ?? 0;
    for (const item of [...trainedItems].sort((a, b) => score(b) - score(a))) {
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
    const sq = byId.get("squat")?.best1rm ?? 0;
    const bp = byId.get("bench-press")?.best1rm ?? 0;
    const dl = byId.get("deadlift")?.best1rm ?? byId.get("romanian-deadlift")?.best1rm ?? 0;
    return sq > 0 && bp > 0 && dl > 0 ? Math.round((sq + bp + dl) * 10) / 10 : null;
  }, [trainedItems]);

  return (
    <>
      <WorkspaceTabs />
      <PageHeading
        title="训练记录"
        view="workout"
        controls={
          <div className="heading-actions">
            <button type="button" className="secondary-button" onClick={() => openCsvImportModal()}>
              <Icon name="upload" size={15} /> 导入 CSV
            </button>
            <button type="button" className="secondary-button" onClick={() => openAiWorkoutModal()}>
              <Icon name="bolt" size={16} /> AI 记训练
            </button>
            <button type="button" className="primary-button" onClick={() => openWorkoutEditor({ goals })}>
              <Icon name="plus" size={16} /> 记一次训练
            </button>
          </div>
        }
      />

      {activeWorkouts.map((draft) => (
        <section key={draft.id} className="panel" style={{ marginBottom: 14, borderColor: "var(--red)" }}>
          <header className="panel-head">
            <div>
              <h2>正在进行的训练 · {draft.data.title}</h2>
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

      {localDraft ? (
        <section className="panel" style={{ marginBottom: 14, borderColor: "var(--red)" }}>
          <header className="panel-head">
            <div>
              <h2>检测到本机未保存训练草稿</h2>
              <p>可随时恢复继续记录已完成组数与休息计时</p>
            </div>
            <button type="button" className="primary-button" onClick={() => openWorkoutEditor({ goals })}>
              恢复草稿
            </button>
          </header>
        </section>
      ) : null}

      {prPicks.length ? (
        <section className="panel pr-wall-panel" style={{ marginBottom: 14 }}>
          <header className="panel-head">
            <div>
              <h2>力量基准榜</h2>
              <p>
                已累计 {trainedItems.length} 个训练动作
                {sbdTotal != null ? ` · 三大项估算总和 ${fmt(sbdTotal, 1)} kg` : ""}
              </p>
            </div>
          </header>
          <div className="pr-wall-grid">
            {prPicks.map((ex) => (
              <div key={ex.id} className="pr-wall-card">
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
              </div>
            ))}
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
