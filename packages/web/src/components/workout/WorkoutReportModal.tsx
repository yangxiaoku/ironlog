import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { duration, fmt, shortDate, today } from "../../lib/date";
import {
  FEELINGS,
  MUSCLES,
  SET_TYPES,
  type ExerciseMode,
  type ProfileGoals,
  type RecordEnvelope,
  type WorkoutData,
  type WorkoutReportResponse,
} from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { openAppleWorkoutDetailsModal, openWorkoutReport, openWorkoutShareModal } from "../../lib/record-openers";
import { useUiStore } from "../../store/useUiStore";
import { AppleLine, type AppleWorkoutAgendaItem } from "../apple/AppleHealthModals";
import { Icon } from "../Icon";
import { MatrixText } from "../MatrixText";

const METRIC_LABELS: Record<string, [string, string]> = {
  weight: ["最高重量", "kg"],
  oneRepMax: ["估算 1RM", "kg"],
  hold: ["最长时长", "秒"],
  assistance: ["最低辅助重量", "kg"],
};

function formatSetValue(set: { weight: number; reps: number; seconds: number }, mode: ExerciseMode): string {
  if (mode === "timed") return `${fmt(set.seconds)} 秒`;
  if (mode === "assisted") return `辅助 ${fmt(set.weight)} kg × ${set.reps}`;
  return set.weight ? `${fmt(set.weight)} kg × ${set.reps}` : `${fmt(set.reps)} 次`;
}

export function WorkoutReportModal({
  workoutId,
  record,
  goals,
  onEditWorkout,
  onRepeatWorkout,
}: {
  workoutId: string;
  record?: RecordEnvelope<WorkoutData>;
  goals?: ProfileGoals | null;
  onEditWorkout: (rec: RecordEnvelope<WorkoutData>, goals?: ProfileGoals | null) => void;
  onRepeatWorkout: (seed: Partial<WorkoutData>, goals?: ProfileGoals | null) => void;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [report, setReport] = useState<WorkoutReportResponse | null>(null);
  const [appleItem, setAppleItem] = useState<AppleWorkoutAgendaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [copied, setCopied] = useState(false);
  const [syncArmed, setSyncArmed] = useState(false);
  const [syncedRoutineName, setSyncedRoutineName] = useState("");
  const [savedTemplate, setSavedTemplate] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setAppleItem(null);
    setSyncArmed(false);
    setSyncedRoutineName("");
    setSavedTemplate(false);
    void apiFetch<WorkoutReportResponse>(`/api/web/workout-report/${encodeURIComponent(workoutId)}`)
      .then((res) => {
        if (!active) return;
        setReport(res);
        if (res.date) {
          void apiFetch<AppleWorkoutAgendaItem[]>(
            `/api/integrations/apple-health/agenda?from=${encodeURIComponent(res.date)}&through=${encodeURIComponent(res.date)}`,
          )
            .then((items) => {
              if (!active) return;
              const linked = items.find((item) => item.manualWorkoutId === res.id) ?? null;
              setAppleItem(linked);
            })
            .catch(() => {});
        }
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载训练复盘失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workoutId]);

  const fetchFullRecord = async (): Promise<RecordEnvelope<WorkoutData>> => {
    if (record) return record;
    return apiFetch<RecordEnvelope<WorkoutData>>(`/api/web/records/workout/${encodeURIComponent(workoutId)}`);
  };

  if (loading) {
    return (
      <div className="dialog-form">
        <p className="muted" style={{ padding: "18px 0" }}>正在生成本场训练复盘…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="dialog-form">
        <p className="form-error" role="alert">{error || "找不到训练记录"}</p>
      </div>
    );
  }

  const handleCopy = async () => {
    const lines = [
      `${report.title} · ${report.date}`,
      `${duration(report.duration)} / ${fmt(report.sets)} 有效工作组 / ${fmt(report.volume, 2)} kg`,
      ...report.exercises.map(
        (row) =>
          `${row.supersetGroup ? `[超级组${row.supersetGroup}] ` : ""}${row.name}　${row.completed
            .map(
              (s) =>
                formatSetValue(s, row.mode) +
                (s.rir != null ? ` RIR${s.rir}` : "") +
                (s.type !== "normal" ? `（${SET_TYPES[s.type]?.label ?? s.type}）` : ""),
            )
            .join("、")}`,
      ),
    ].join("\n");
    if (await copyText(lines)) {
      setCopied(true);
      notify("训练摘要已复制");
    } else {
      notify("无法自动复制，请长按文本复制");
    }
  };

  const handleEdit = async () => {
    setBusyAction("edit");
    try {
      const full = await fetchFullRecord();
      triggerHaptic("light");
      onEditWorkout(full, goals);
    } catch (err) {
      notify((err as Error)?.message || "读取训练明细失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleRepeat = async () => {
    setBusyAction("repeat");
    try {
      const full = await fetchFullRecord();
      const cloned = full.data.exercises.map((row) => {
        const workSets = row.sets.filter((s) => s.type !== "warmup");
        const pool = workSets.length ? workSets : row.sets;
        return {
          id: crypto.randomUUID(),
          exerciseId: row.exerciseId,
          supersetGroup: row.supersetGroup ?? null,
          restSeconds: row.restSeconds ?? 90,
          snapshot: row.snapshot ?? null,
          sets: pool.map((s) => ({
            id: crypto.randomUUID(),
            type: (s.type === "warmup" ? "normal" : s.type) as "normal",
            weight: s.weight ?? 0,
            reps: s.reps ?? 8,
            seconds: s.seconds ?? 0,
            completed: false,
            rir: null,
          })),
        };
      });
      triggerHaptic("light");
      onRepeatWorkout(
        {
          title: full.data.title,
          date: today(),
          exercises: cloned,
        },
        goals,
      );
    } catch (err) {
      notify((err as Error)?.message || "准备再练一次失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleDelete = () => {
    openConfirm({
      title: "删除训练记录",
      message: `确定要删除 ${shortDate(report.date)} 的「${report.title}」吗？删除后将从统计与历史中移除。`,
      confirmLabel: "删除记录",
      onConfirm: async () => {
        const full = await fetchFullRecord();
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id: full.id,
            kind: "workout",
            baseVersion: full.version,
            deleted: true,
            data: full.data,
          },
        });
        bumpDataEpoch();
        closeAllModals();
        notify("已删除训练记录");
      },
    });
  };

  const handleSaveTemplate = async () => {
    if (savedTemplate || busyAction) return;
    setBusyAction("template");
    try {
      const full = await fetchFullRecord();
      const plannedExercises = full.data.exercises.map((row) => {
        const mode = row.snapshot?.mode ?? "reps";
        const workSets = row.sets.filter((s) => s.type !== "warmup");
        const pool = workSets.length ? workSets : row.sets;
        const maxWeight = Math.max(...pool.map((s) => s.weight || 0), 0);
        const avgReps = Math.max(
          1,
          Math.round(pool.reduce((s, x) => s + (x.reps || 8), 0) / Math.max(1, pool.length)),
        );
        const maxSec = Math.max(...pool.map((s) => s.seconds || 0), mode === "timed" ? 30 : 0);
        return {
          exerciseId: row.exerciseId,
          sets: Math.max(1, Math.min(100, pool.length)),
          repsMin: mode === "timed" ? 1 : Math.max(1, avgReps - 2),
          repsMax: mode === "timed" ? 1 : avgReps,
          weight: maxWeight > 0 ? maxWeight : null,
          seconds: mode === "timed" ? Math.max(1, maxSec) : 0,
          restSeconds: row.restSeconds ?? 90,
          targetRir: 2,
          progression: "double",
          increment: 2.5,
          backupExerciseId: null,
          supersetGroup: row.supersetGroup ?? null,
        };
      });
      if (!plannedExercises.length) {
        notify("本场没有动作可存为模板");
        return;
      }
      const tplId = `tpl_${crypto.randomUUID().slice(0, 12)}`;
      const tplName = full.data.title || "自定义训练模板";
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId: crypto.randomUUID(),
          id: tplId,
          kind: "template",
          baseVersion: 0,
          deleted: false,
          data: { id: tplId, name: tplName, exercises: plannedExercises },
        },
      });
      triggerHaptic("success");
      setSavedTemplate(true);
      bumpDataEpoch();
      notify(`已保存「${tplName}」至训练计划模板库`);
    } catch (err) {
      notify((err as Error)?.message || "存为模板失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleSyncToPlan = async () => {
    if (syncedRoutineName || busyAction) return;
    if (!syncArmed) {
      setSyncArmed(true);
      return;
    }
    setBusyAction("sync");
    try {
      const res = await apiFetch<{ syncedRoutineName: string }>("/api/web/plans/sync-routine", {
        method: "POST",
        body: {
          workoutId: report.id,
          expectedRevision: report.activePlanRevision,
        },
      });
      triggerHaptic("success");
      setSyncedRoutineName(res.syncedRoutineName);
      bumpDataEpoch();
      notify(`已将本场动作、组数与超级组同步至计划「${res.syncedRoutineName}」`);
    } catch (err) {
      setSyncArmed(false);
      notify((err as Error)?.message || "同步回计划失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleShare = () => {
    openWorkoutShareModal({
      singleReport: report,
      singleHealth: appleItem,
      onBack: () => useUiStore.getState().closeTopModal(),
    });
  };

  const cmp = report.previousComparison;

  return (
    <div className="workout-report dialog-form">
      <div className="report-meta">
        <time dateTime={report.date}>{report.date}</time>
        {report.feeling ? <span>体感 {FEELINGS[report.feeling]}</span> : null}
        <span>训练已完成</span>
      </div>

      {appleItem ? (
        <div style={{ marginBottom: 12 }}>
          <AppleLine
            item={appleItem}
            onClick={() =>
              openAppleWorkoutDetailsModal({
                item: appleItem,
                back: () => useUiStore.getState().closeTopModal(),
              })
            }
          />
        </div>
      ) : null}

      <div className="report-stats">
        <div>
          <span>训练时长</span>
          <strong>{duration(report.duration)}</strong>
        </div>
        <div>
          <span>有效工作组</span>
          <strong>
            <MatrixText value={fmt(report.sets)} /> <small>组</small>
          </strong>
        </div>
        <div>
          <span>训练容量</span>
          <strong>
            {fmt(report.volume, 2)} <small>kg</small>
          </strong>
        </div>
      </div>

      {cmp ? (
        <div className="report-comparison-bar">
          <span>较上次 {shortDate(cmp.date)}</span>
          <b className={cmp.volumeDelta > 0 ? "is-up" : cmp.volumeDelta < 0 ? "is-down" : ""}>
            容量 {cmp.volumeDelta >= 0 ? "+" : ""}
            {fmt(cmp.volumeDelta, 1)} kg
            {cmp.volumePct != null ? ` (${cmp.volumePct >= 0 ? "+" : ""}${cmp.volumePct}%)` : ""}
          </b>
          {cmp.setsDelta ? <small>工作组 {cmp.setsDelta > 0 ? "+" : ""}{cmp.setsDelta}</small> : null}
        </div>
      ) : null}

      {report.muscleSets?.length ? (
        <div className="report-muscles" aria-label="本场肌群有效组数">
          <span className="report-muscles-label">肌群刺激</span>
          <div className="report-muscles-chips">
            {report.muscleSets.map((m) => (
              <span key={m.key}>
                {MUSCLES[m.key] ?? m.key} <b>{fmt(m.sets)}</b> 组
              </span>
            ))}
          </div>
          <small className="report-recovery-tip">单场 ≥6 组肌群建议休整 48–72h，&lt;6 组约 24–48h</small>
        </div>
      ) : null}

      {report.records.length ? (
        <section className="report-records">
          <h3>
            <i aria-hidden="true" />
            个人新纪录
          </h3>
          {report.records.map(({ key, name, improvements }) => (
            <div key={key} className="report-pr">
              <strong>{name}</strong>
              <ul>
                {improvements.map(({ metric, previous, current }) => {
                  const [label, unit] = METRIC_LABELS[metric] ?? [metric, ""];
                  return (
                    <li key={metric}>
                      <span>{label}</span>
                      <span>
                        {fmt(previous, 2)} → <b>{fmt(current, 2)} {unit}</b>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="report-exercises">
        <h3>动作明细</h3>
        {report.exercises.length ? (
          report.exercises.map((row) => (
            <article key={row.id}>
              <h4>
                {row.supersetGroup ? <span className="superset-pill">超级组 {row.supersetGroup}</span> : null}
                {row.name}{" "}
                <small>
                  {row.completed.length} 组{row.volume > 0 ? ` · ${fmt(row.volume, 0)} kg` : ""}
                </small>
              </h4>
              <ul>
                {row.completed.map((s, idx) => (
                  <li key={idx}>
                    <span className="set-index">{idx + 1}</span>
                    <span>{formatSetValue(s, row.mode)}</span>
                    {s.rir != null ? <small className="set-rir-tag">RIR {s.rir}</small> : null}
                    {s.type !== "normal" ? <small>{SET_TYPES[s.type]?.label ?? s.type}</small> : null}
                  </li>
                ))}
              </ul>
            </article>
          ))
        ) : (
          <p className="muted">暂无已完成的有效组。</p>
        )}
      </section>

      {report.notes ? (
        <section className="report-notes">
          <h3>训练备注</h3>
          <p>{report.notes}</p>
        </section>
      ) : null}

      <footer className="report-foot-actions">
        <div className="report-foot-secondary">
          <button
            type="button"
            className="secondary-button"
            disabled={busyAction !== ""}
            onClick={() => void handleEdit()}
          >
            编辑
          </button>
          {report.canSyncToActivePlan ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busyAction !== "" || Boolean(syncedRoutineName)}
              onClick={() => void handleSyncToPlan()}
            >
              <Icon name="refresh" size={15} />{" "}
              {syncedRoutineName ? "已同步回计划" : syncArmed ? "确认同步？" : "同步回计划"}
            </button>
          ) : null}
          {report.exercises.length ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busyAction !== "" || savedTemplate}
              onClick={() => void handleSaveTemplate()}
            >
              <Icon name="bookmark" size={15} /> {savedTemplate ? "已存为模板" : "存为模板"}
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            disabled={busyAction !== ""}
            onClick={handleShare}
          >
            <Icon name="download" size={15} /> 分享记录
          </button>
          <button type="button" className="quiet" onClick={() => void handleCopy()}>
            <Icon name="copy" size={15} /> {copied ? "已复制训练摘要" : "复制摘要"}
          </button>
          <button type="button" className="danger" onClick={handleDelete}>
            删除
          </button>
        </div>
        {report.exercises.length ? (
          <button
            type="button"
            className="primary-button"
            disabled={busyAction !== ""}
            onClick={() => void handleRepeat()}
          >
            <Icon name="refresh" size={15} /> 再练一次
          </button>
        ) : null}
      </footer>
    </div>
  );
}
