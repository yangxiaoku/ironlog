import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWorkoutToFit } from "@ironlog/shared";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { duration, fmt, shortDate, today } from "../../lib/date";
import {
  FEELINGS,
  MUSCLES,
  safeUuid,
  SET_TYPES,
  type ExerciseMode,
  type ProfileGoals,
  type RecordEnvelope,
  type WorkoutData,
  type WorkoutReportResponse,
} from "../../lib/domain";
import { triggerAppleHubAction } from "../../lib/apple-fitness";
import { triggerHaptic } from "../../lib/haptics-audio";
import { openAiReviewModal, openAppleWorkoutDetailsModal, openWorkoutReport, openWorkoutShareModal } from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
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

function formatSetValue(
  set: { weight: number; reps: number; seconds: number },
  mode: ExerciseMode,
  unit: "kg" | "lb" = "kg",
): string {
  // #232: Show weight alongside seconds for weighted timed exercises (e.g. weighted plank 20 kg · 65 秒)
  if (mode === "timed") {
    return set.weight > 0 ? `${fmt(set.weight)} ${unit} · ${fmt(set.seconds)} 秒` : `${fmt(set.seconds)} 秒`;
  }
  if (mode === "assisted") return `辅助 ${fmt(set.weight)} ${unit} × ${set.reps}`;
  return set.weight ? `${fmt(set.weight)} ${unit} × ${set.reps}` : `${fmt(set.reps)} 次`;
}

function formatCardioPace(durationSeconds: number | null, distanceMeters: number | null | undefined, activityType?: string): { label: string; value: string } | null {
  if (!durationSeconds || durationSeconds <= 0 || !distanceMeters || distanceMeters <= 0) return null;
  const km = distanceMeters / 1000;
  if (km <= 0.01) return null;
  const act = (activityType ?? "").toLowerCase();
  if (act.includes("cycl") || act.includes("bike")) {
    const kmh = km / (durationSeconds / 3600);
    return { label: "平均速度", value: `${fmt(kmh, 1)} km/h` };
  }
  const secPerKm = Math.round(durationSeconds / km);
  const mins = Math.floor(secPerKm / 60);
  const secs = secPerKm % 60;
  return { label: "平均配速", value: `${mins}'${String(secs).padStart(2, "0")}"/km` };
}

export function WorkoutReportModal({
  workoutId,
  record,
  goals,
  justCompleted = false,
  onEditWorkout,
  onRepeatWorkout,
}: {
  workoutId: string;
  record?: RecordEnvelope<WorkoutData>;
  goals?: ProfileGoals | null;
  justCompleted?: boolean;
  onEditWorkout: (rec: RecordEnvelope<WorkoutData>, goals?: ProfileGoals | null) => void;
  onRepeatWorkout: (seed: Partial<WorkoutData>, goals?: ProfileGoals | null) => void;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const notify = useUiStore((s) => s.notify);
  const aiReady = useAuthStore((s) => s.aiReady);

  const [report, setReport] = useState<WorkoutReportResponse | null>(null);
  const [appleItem, setAppleItem] = useState<AppleWorkoutAgendaItem | null>(null);
  const [checkingApple, setCheckingApple] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportRetryNonce, setReportRetryNonce] = useState(0);
  const [busyAction, setBusyAction] = useState("");
  const [copied, setCopied] = useState(false);
  const [syncArmed, setSyncArmed] = useState(false);
  const [syncedRoutineName, setSyncedRoutineName] = useState("");
  const [savedTemplate, setSavedTemplate] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  // #234: Keep stable tplId + opId across retries if save-as-template response is lost (503)
  const pendingTemplateRef = useRef<{ workoutId: string; tplId: string; opId: string } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setAppleItem(null);
    setSyncArmed(false);
    setSyncedRoutineName("");
    setSavedTemplate(false);
    pendingTemplateRef.current = null;
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
  }, [workoutId, reportRetryNonce]);

  const refreshAppleAgenda = useCallback(
    async (reportDate: string, targetId: string, opts?: { notifyFound?: boolean }) => {
      setCheckingApple(true);
      try {
        const items = await apiFetch<AppleWorkoutAgendaItem[]>(
          `/api/integrations/apple-health/agenda?from=${encodeURIComponent(reportDate)}&through=${encodeURIComponent(reportDate)}`,
        );
        const linked = items.find((item) => item.manualWorkoutId === targetId) ?? null;
        // #245: Always sync appleItem including clearing to null when a linked Apple workout was deleted
        setAppleItem(linked);
        if (linked && opts?.notifyFound) {
          bumpDataEpoch();
          notify("已同步 Apple Watch 心率与消耗");
        }
      } catch {}
      setCheckingApple(false);
    },
    [bumpDataEpoch, notify],
  );

  // #245: Refresh linked Apple workout whenever global dataEpoch changes (e.g. after deleting linked Apple record)
  useEffect(() => {
    if (!report?.date || !report.id) return;
    let active = true;
    void apiFetch<AppleWorkoutAgendaItem[]>(
      `/api/integrations/apple-health/agenda?from=${encodeURIComponent(report.date)}&through=${encodeURIComponent(report.date)}`,
    )
      .then((items) => {
        if (!active) return;
        const linked = items.find((item) => item.manualWorkoutId === report.id) ?? null;
        setAppleItem(linked);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [dataEpoch, report?.date, report?.id]);

  useEffect(() => {
    if (!report || appleItem || report.date !== today()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      pollCount += 1;
      void refreshAppleAgenda(report.date, report.id, { notifyFound: true });
      if (pollCount >= 6) clearInterval(pollInterval);
    }, 5000);
    const scheduleRefresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshAppleAgenda(report.date, report.id, { notifyFound: true });
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshAppleAgenda(report.date, report.id, { notifyFound: true });
      }, 3000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    const onFocus = () => scheduleRefresh();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }
    return () => {
      clearInterval(pollInterval);
      if (timer != null) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [report, appleItem, refreshAppleAgenda]);

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
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReportRetryNonce((n) => n + 1)}
          >
            <Icon name="refresh" size={14} /> 重试加载
          </button>
        </div>
      </div>
    );
  }

  const cardioDistanceMeters = report.cardioMeta?.distanceMeters ?? null;
  const cardioPace = formatCardioPace(report.duration, cardioDistanceMeters, report.cardioMeta?.activityType);

  const handleCopy = async () => {
    const cardioSummary =
      cardioDistanceMeters && cardioDistanceMeters > 0
        ? ` / ${fmt(cardioDistanceMeters / 1000, 2)} km${cardioPace ? ` (${cardioPace.value})` : ""}`
        : "";
    const lines = [
      `${report.title} · ${report.date}`,
      `${duration(report.duration)}${cardioSummary} / ${fmt(report.sets)} 有效工作组 / ${fmt(report.volume, 2)} kg`,
      ...report.exercises.map(
        (row) =>
          `${row.supersetGroup ? `[超级组${row.supersetGroup}] ` : ""}${row.name}　${row.completed
            .map(
              (s) =>
                formatSetValue(s, row.mode, row.weightUnit) +
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
          ...(row.weightUnit ? { weightUnit: row.weightUnit } : {}),
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

  const handleExportFit = async () => {
    if (!report) return;
    setBusyAction("fit");
    try {
      let full: RecordEnvelope<WorkoutData> | null = record ?? null;
      if (!full) {
        try {
          full = await fetchFullRecord();
        } catch {
          full = null;
        }
      }
      // #236: Never fabricate a noon UTC start time when full record fetch fails and report has no trusted startedAt
      const startIso = full?.data.startedAt ?? report.startedAt ?? null;
      const endIso = full?.data.endedAt ?? report.endedAt ?? null;
      const isDurationUnknown = Boolean(full?.data.durationUnknown ?? report.durationUnknown);
      if (!startIso || !Number.isFinite(Date.parse(startIso))) {
        notify("读取完整训练记录失败，缺少实际开始时间，无法生成准确的 .fit 文件；请稍后重试");
        return;
      }
      const inferredDuration =
        report.duration ??
        (!isDurationUnknown && startIso && endIso && Date.parse(endIso) > Date.parse(startIso)
          ? Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000)
          : null);
      if (isDurationUnknown || !inferredDuration || inferredDuration <= 0) {
        notify("本场训练时长未知，无法生成符合实际记录的 .fit 文件；请先补充训练时长或改用 CSV/JSON 导出");
        return;
      }
      const bytes = encodeWorkoutToFit({
        title: report.title,
        date: report.date,
        startedAt: startIso,
        endedAt: endIso,
        durationSeconds: inferredDuration,
        durationUnknown: isDurationUnknown,
        activeCaloriesKcal: appleItem?.activeEnergyKcal ?? null,
        cardioMeta: full?.data.cardioMeta ?? report.cardioMeta ?? null,
        exercises: full?.data.exercises as Parameters<typeof encodeWorkoutToFit>[0]["exercises"],
        totalSets: report.sets,
        totalVolumeKg: report.volume,
      });
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ironlog-${report.date}-${report.id.slice(0, 8)}.fit`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("已导出 Garmin / Strava 兼容 .fit 文件");
    } catch (err) {
      notify((err as Error)?.message || "导出 .fit 失败");
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveTemplate = async () => {
    if (savedTemplate || busyAction) return;
    setBusyAction("template");
    try {
      const full = await fetchFullRecord();
      // #233: Reuse catalogue-resolved mode from report when legacy workout exercises have no snapshot
      const reportModeByRowId = new Map(report.exercises.map((e) => [e.id, e.mode]));
      const reportModeByExId = new Map(report.exercises.map((e) => [e.exerciseId, e.mode]));
      const plannedExercises = full.data.exercises.map((row) => {
        const inferredTimed =
          row.sets.some((s) => s.seconds > 0) && row.sets.every((s) => s.reps === 0);
        const mode: ExerciseMode =
          row.snapshot?.mode ??
          reportModeByRowId.get(row.id) ??
          reportModeByExId.get(row.exerciseId) ??
          (inferredTimed ? "timed" : "reps");
        const workSets = row.sets.filter((s) => s.type !== "warmup");
        const pool = workSets.length ? workSets : row.sets;
        const maxWeight = Math.max(...pool.map((s) => s.weight || 0), 0);
        const avgReps = Math.max(
          1,
          Math.round(pool.reduce((s, x) => s + (x.reps || 8), 0) / Math.max(1, pool.length)),
        );
        const maxSec = Math.max(...pool.map((s) => s.seconds || 0), mode === "timed" ? 30 : 0);
        const rowUnit = row.weightUnit === "lb" ? "lb" : row.weightUnit === "kg" ? "kg" : undefined;
        return {
          exerciseId: row.exerciseId,
          sets: Math.max(1, Math.min(100, pool.length)),
          repsMin: mode === "timed" ? 1 : Math.max(1, avgReps - 2),
          repsMax: mode === "timed" ? 1 : avgReps,
          weight: maxWeight > 0 ? maxWeight : null,
          seconds: mode === "timed" ? Math.max(1, maxSec) : 0,
          restSeconds: row.restSeconds ?? 90,
          targetRir: 2,
          progression: mode === "timed" ? "manual" : "double",
          increment: rowUnit === "lb" ? 5 : 2.5,
          backupExerciseId: null,
          supersetGroup: row.supersetGroup ?? null,
          ...(rowUnit ? { weightUnit: rowUnit } : {}),
        };
      });
      if (!plannedExercises.length) {
        notify("本场没有动作可存为模板");
        return;
      }
      // #234: Reuse the exact same tplId + opId across retries if the first save succeeded on server but response was lost
      if (!pendingTemplateRef.current || pendingTemplateRef.current.workoutId !== report.id) {
        pendingTemplateRef.current = {
          workoutId: report.id,
          tplId: `tpl_${safeUuid().slice(0, 12)}`,
          opId: safeUuid(),
        };
      }
      const { tplId, opId } = pendingTemplateRef.current;
      const tplName = full.data.title || "自定义训练模板";
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId,
          id: tplId,
          kind: "template",
          baseVersion: 0,
          deleted: false,
          data: { id: tplId, name: tplName, exercises: plannedExercises },
        },
      });
      pendingTemplateRef.current = null;
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
                onDeleted: () => setAppleItem(null),
              })
            }
          />
        </div>
      ) : report.date === today() ? (
        <div className="report-comparison-bar" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>等待 Apple Watch 自动回传心率与消耗</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="quiet"
              disabled={checkingApple}
              onClick={() => {
                triggerHaptic("light");
                void refreshAppleAgenda(report.date, report.id, { notifyFound: true });
              }}
            >
              <Icon name="refresh" size={14} /> {checkingApple ? "检查中…" : "刷新"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                triggerHaptic("light");
                triggerAppleHubAction("end", { notify });
              }}
            >
              <Icon name="heart" size={14} /> 手动补传
            </button>
          </div>
        </div>
      ) : null}

      <div className="report-stats">
        <div>
          <span>训练时长</span>
          <strong>{duration(report.duration)}</strong>
        </div>
        {cardioDistanceMeters != null && cardioDistanceMeters > 0 ? (
          <div>
            <span>有氧距离</span>
            <strong>
              {fmt(cardioDistanceMeters / 1000, 2)} <small>km</small>
            </strong>
          </div>
        ) : null}
        {cardioPace ? (
          <div>
            <span>{cardioPace.label}</span>
            <strong>{cardioPace.value}</strong>
          </div>
        ) : null}
        {!(cardioDistanceMeters != null && cardioDistanceMeters > 0 && report.volume === 0) ? (
          <>
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
          </>
        ) : null}
      </div>

      {cmp ? (
        <div className="report-comparison-bar" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span>
              较上次 {shortDate(cmp.date)}「{cmp.title}」
            </span>
            <b className={cmp.volumeDelta > 0 ? "is-up" : cmp.volumeDelta < 0 ? "is-down" : ""}>
              容量 {cmp.volumeDelta >= 0 ? "+" : ""}
              {fmt(cmp.volumeDelta, 1)} kg
              {cmp.volumePct != null ? ` (${cmp.volumePct >= 0 ? "+" : ""}${cmp.volumePct}%)` : ""}
            </b>
            {cmp.setsDelta ? <small>工作组 {cmp.setsDelta > 0 ? "+" : ""}{cmp.setsDelta}</small> : null}
          </div>
          {cmp.workoutId ? (
            <button
              type="button"
              className="micro-chip"
              onClick={() => {
                triggerHaptic("light");
                openWorkoutReport({ workoutId: cmp.workoutId });
              }}
            >
              查看原记录
            </button>
          ) : null}
        </div>
      ) : report.planId || report.routineId ? (
        <div className="report-comparison-bar">
          <span className="muted">暂无同计划对应训练日的可比记录</span>
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
                {row.weightUnit === "lb" ? <span className="unit-pill">lb</span> : null}
                <small>
                  {row.completed.length} 组{row.volume > 0 ? ` · ${fmt(row.volume, 0)} kg` : ""}
                </small>
              </h4>
              <ul>
                {row.completed.map((s, idx) => (
                  <li key={idx}>
                    <span className="set-index">{idx + 1}</span>
                    <span>{formatSetValue(s, row.mode, row.weightUnit ?? "kg")}</span>
                    {s.rir != null ? <small className="set-rir-tag">RIR {s.rir}</small> : null}
                    {s.type !== "normal" ? <small>{SET_TYPES[s.type]?.label ?? s.type}</small> : null}
                    {s.note ? <small className="set-note-tag">「{s.note}」</small> : null}
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

      {report.canSyncToActivePlan ? (
        <div className={`report-sync-banner${syncedRoutineName ? " is-synced" : ""}`} role="status">
          <div>
            <strong>{syncedRoutineName ? `已同步回计划「${syncedRoutineName}」` : "将本次改动同步回原计划？"}</strong>
            <small className="muted">
              {syncedRoutineName
                ? "下次开练将按本次调整后的动作与组数执行"
                : "若训中替换了动作或调整了组数/休息时长，可一键更新回当前计划"}
            </small>
          </div>
          {!syncedRoutineName ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busyAction !== ""}
              onClick={() => void handleSyncToPlan()}
            >
              <Icon name="refresh" size={14} /> {syncArmed ? "确认同步" : "同步回计划"}
            </button>
          ) : null}
        </div>
      ) : null}

      <footer className="report-foot-actions">
        <div className="report-foot-primary-row">
          {justCompleted ? (
            <button
              type="button"
              className="primary-button"
              disabled={busyAction !== ""}
              onClick={() => {
                triggerHaptic("light");
                closeAllModals();
              }}
            >
              完成并返回
            </button>
          ) : report.exercises.length ? (
            <button
              type="button"
              className="primary-button"
              disabled={busyAction !== ""}
              onClick={() => void handleRepeat()}
            >
              <Icon name="refresh" size={15} /> 再练一次
            </button>
          ) : null}

          <button
            type="button"
            className="secondary-button"
            disabled={busyAction !== ""}
            onClick={handleShare}
          >
            <Icon name="download" size={15} /> {justCompleted ? "分享战报" : "分享记录"}
          </button>

          {aiReady ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busyAction !== ""}
              onClick={() => openAiReviewModal()}
            >
              AI 复盘
            </button>
          ) : null}

          <button
            type="button"
            className="quiet"
            aria-expanded={moreActionsOpen}
            onClick={() => {
              triggerHaptic("light");
              setMoreActionsOpen((v) => !v);
            }}
          >
            {moreActionsOpen ? "收起更多" : "更多操作 ▾"}
          </button>
        </div>

        {moreActionsOpen ? (
          <div className="report-foot-secondary">
            {justCompleted && report.exercises.length ? (
              <button
                type="button"
                className="secondary-button"
                disabled={busyAction !== ""}
                onClick={() => void handleRepeat()}
              >
                <Icon name="refresh" size={15} /> 再练一次
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={busyAction !== ""}
              onClick={() => void handleEdit()}
            >
              编辑记录
            </button>
            {report.exercises.length ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyAction !== "" || savedTemplate}
                  onClick={() => void handleSaveTemplate()}
                >
                  <Icon name="bookmark" size={15} /> {savedTemplate ? "已存为模板" : "存为模板"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busyAction !== ""}
                  onClick={() => void handleExportFit()}
                >
                  <Icon name="download" size={15} /> {busyAction === "fit" ? "导出中…" : "导出 .fit"}
                </button>
              </>
            ) : null}
            <button type="button" className="quiet" onClick={() => void handleCopy()}>
              <Icon name="copy" size={15} /> {copied ? "已复制训练摘要" : "复制摘要"}
            </button>
            <button type="button" className="danger" onClick={handleDelete}>
              删除
            </button>
          </div>
        ) : null}
      </footer>
    </div>
  );
}
