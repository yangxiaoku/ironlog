import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { fmt, today } from "../../lib/date";
import {
  EQUIPMENT,
  FEELINGS,
  MUSCLES,
  SET_TYPES,
  summarizeWorkoutRecord,
  workoutDraftKey,
  type CatalogueExercise,
  type ExerciseMode,
  type ExerciseReferenceEntry,
  type FeelingKey,
  type ProfileGoals,
  type RecordEnvelope,
  type SetType,
  type WorkoutData,
  type WorkoutExercise,
  type WorkoutSet,
} from "../../lib/domain";
import {
  createRestAudio,
  createRestTimer,
  elapsedAt,
  formatClock,
  keepWorkoutScreenAwake,
  normalizeRestTimer,
  pauseAt,
  pauseRestTimer,
  resolveSetRestSeconds,
  restProgress,
  resumeRestTimer,
  shiftRestTimer,
  triggerHaptic,
  type RestTimerState,
  type WorkoutTiming,
} from "../../lib/haptics-audio";
import { enqueueMutation, isNetworkError } from "../../lib/offline-queue";
import {
  ALL_PLATES,
  BAR_PRESETS,
  barPreference,
  notifyPreference,
  plateBreakdown,
  plateDeltaLabel,
  rirPreference,
  round2,
  screenPreference,
  snapWarmupWeight,
  soundPreference,
} from "../../lib/workout-helpers";
import { openAiAdaptWorkoutModal } from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";
import { ExercisePickerModal } from "./ExercisePickerModal";

const SET_TYPE_ORDER: SetType[] = ["normal", "warmup", "failure", "drop", "rest_pause"];
const REST_PRESETS = [30, 60, 90, 120, 180];

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultSet(weight = 0, reps = 8, seconds = 0): WorkoutSet {
  return {
    id: newId(),
    type: "normal",
    weight,
    reps,
    seconds,
    completed: false,
    rir: null,
  };
}

function readBoolPref(key: string, defaultOn: boolean): boolean {
  if (typeof localStorage === "undefined") return defaultOn;
  const v = localStorage.getItem(key);
  if (v == null) return defaultOn;
  return defaultOn ? v !== "off" : v === "on";
}

function writeBoolPref(key: string, val: boolean): void {
  try {
    localStorage.setItem(key, val ? "on" : "off");
  } catch {}
}

function readBarWeight(): number {
  if (typeof localStorage === "undefined") return 20;
  const n = Number(localStorage.getItem(barPreference));
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

interface WorkoutDraftSnapshot {
  title: string;
  date: string;
  notes: string;
  feeling: FeelingKey | null;
  exercises: WorkoutExercise[];
  timing: WorkoutTiming;
  rest: RestTimerState | null;
}

export function WorkoutEditorModal({
  record,
  goals,
  seed,
  onCompleted,
}: {
  record?: RecordEnvelope<WorkoutData>;
  goals?: ProfileGoals | null;
  seed?: Partial<WorkoutData>;
  onCompleted?: (savedRecord: RecordEnvelope<WorkoutData>) => void;
}) {
  const userId = useAuthStore((s) => s.userId);
  const openModal = useUiStore((s) => s.openModal);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const refreshPendingCount = useUiStore((s) => s.refreshPendingCount);
  const notify = useUiStore((s) => s.notify);

  const todayStr = today();
  const draftStorageKey = userId ? workoutDraftKey(userId, record?.id) : "";

  const initialSnapshot = useMemo<WorkoutDraftSnapshot>(() => {
    const baseData = record?.data;
    if (!seed && draftStorageKey && typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(draftStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<WorkoutDraftSnapshot>;
          if (Array.isArray(parsed.exercises)) {
            return {
              title: parsed.title ?? baseData?.title ?? "自由训练",
              date: parsed.date ?? baseData?.date ?? todayStr,
              notes: parsed.notes ?? baseData?.notes ?? "",
              feeling: parsed.feeling ?? baseData?.feeling ?? null,
              exercises: parsed.exercises,
              timing: parsed.timing ?? baseData?.timing ?? { elapsedSeconds: 0, runningSince: new Date().toISOString() },
              rest: normalizeRestTimer(parsed.rest ?? null),
            };
          }
        }
      } catch {}
    }

    const baseRest: RestTimerState | null =
      baseData?.restEndsAt && baseData.restEndsAt > Date.now()
        ? {
            start: baseData.restStartedAt ?? Date.now(),
            end: baseData.restEndsAt,
            total: Math.max(1000, baseData.restEndsAt - (baseData.restStartedAt ?? Date.now() - 90_000)),
            setId: "restored",
          }
        : null;

    return {
      title: seed?.title ?? baseData?.title ?? "自由训练",
      date: seed?.date ?? baseData?.date ?? todayStr,
      notes: seed?.notes ?? baseData?.notes ?? "",
      feeling: seed?.feeling ?? baseData?.feeling ?? null,
      exercises: seed?.exercises ?? baseData?.exercises ?? [],
      timing:
        baseData?.timing ??
        (record?.data.status === "completed"
          ? { elapsedSeconds: 0, runningSince: null }
          : { elapsedSeconds: 0, runningSince: new Date().toISOString() }),
      rest: baseRest,
    };
  }, [record, seed, draftStorageKey, todayStr]);

  const [savedRecord, setSavedRecord] = useState<RecordEnvelope<WorkoutData> | undefined>(record);
  const savedRecordRef = useRef<RecordEnvelope<WorkoutData> | undefined>(record);
  savedRecordRef.current = savedRecord;

  const isHistoricalEdit = (savedRecord ?? record)?.data.status === "completed";
  const [workoutId] = useState<string>(() => record?.id ?? newId());
  const [sessionStart] = useState<string>(() => record?.data.startedAt ?? new Date().toISOString());

  const [title, setTitle] = useState(initialSnapshot.title);
  const [date, setDate] = useState(initialSnapshot.date);
  const [notes, setNotes] = useState(initialSnapshot.notes);
  const [feeling, setFeeling] = useState<FeelingKey | null>(initialSnapshot.feeling);
  const [exercises, setExercises] = useState<WorkoutExercise[]>(initialSnapshot.exercises);
  const [timing, setTiming] = useState<WorkoutTiming>(initialSnapshot.timing);
  const [rest, setRest] = useState<RestTimerState | null>(initialSnapshot.rest);

  const [soundOn, setSoundOn] = useState(() => readBoolPref(soundPreference, true));
  const [showRir, setShowRir] = useState(() => readBoolPref(rirPreference, false));
  const [screenAwakePref, setScreenAwakePref] = useState(() => readBoolPref(screenPreference, false));
  const [notifyRestPref, setNotifyRestPref] = useState(() => readBoolPref(notifyPreference, false));
  const [barWeight, setBarWeight] = useState<number>(() => readBarWeight());
  const [wakeActive, setWakeActive] = useState(false);

  const [activeExIdx, setActiveExIdx] = useState(0);
  const [openMenu, setOpenMenu] = useState(false);
  const [finishPanelOpen, setFinishPanelOpen] = useState(isHistoricalEdit);
  const [openSettingsIds, setOpenSettingsIds] = useState<Set<string>>(() => new Set());
  const [refsByExId, setRefsByExId] = useState<Map<string, ExerciseReferenceEntry["sets"]>>(() => new Map());

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const audio = useMemo(() => createRestAudio(() => soundOnRef.current), []);
  const restAlarmFiredForRef = useRef<number | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  // Sync `.is-live-workout` on parent <dialog> while live session runs
  useEffect(() => {
    const dialog = document.getElementById("dialog");
    if (!dialog) return;
    if (!isHistoricalEdit) dialog.classList.add("is-live-workout");
    return () => {
      dialog.classList.remove("is-live-workout");
    };
  }, [isHistoricalEdit]);

  // Auto-save local draft so accidental browser close never loses sets
  useEffect(() => {
    if (!draftStorageKey || isHistoricalEdit) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          draftStorageKey,
          JSON.stringify({ title, date, notes, feeling, exercises, timing, rest }),
        );
      } catch {}
    }, 200);
    return () => window.clearTimeout(timer);
  }, [draftStorageKey, isHistoricalEdit, title, date, notes, feeling, exercises, timing, rest]);

  // Timestamp-anchored clock tick & visibility recalibration
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const interval = window.setInterval(tick, 250);
    const onVis = () => {
      if (document.visibilityState === "visible") setNowMs(Date.now());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Rest completion alarm
  useEffect(() => {
    if (!rest || rest.pausedLeftMs != null) return;
    if (nowMs >= rest.end && restAlarmFiredForRef.current !== rest.end) {
      restAlarmFiredForRef.current = rest.end;
      audio.play(true);
      if (notifyRestPref && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification("铁记 · 组间休息结束", { body: "准备下一组训练", tag: "ironlog-rest" });
        } catch {}
      }
      setRest(null);
    }
  }, [rest, nowMs, audio, notifyRestPref]);

  // Wake lock guard
  useEffect(() => {
    if (isHistoricalEdit || !("wakeLock" in navigator)) return;
    const mgr = keepWorkoutScreenAwake(() => screenAwakePref, setWakeActive);
    mgr.update();
    return () => mgr.stop();
  }, [isHistoricalEdit, screenAwakePref]);

  // Fetch previous-session reference sets for exercises in workout
  const exIdsKey = exercises.map((e) => `${e.exerciseId}:${e.snapshot?.mode ?? "reps"}`).join(",");
  useEffect(() => {
    if (!exercises.length || !date) return;
    let active = true;
    const uniqueEntries = [
      ...new Map(exercises.map((e) => [e.exerciseId, { id: e.exerciseId, mode: e.snapshot?.mode ?? "reps" }])).values(),
    ];
    void apiFetch<ExerciseReferenceEntry[]>("/api/web/exercise-references", {
      method: "POST",
      body: {
        date,
        startedAt: sessionStart,
        ...(record?.id ? { workoutId: record.id } : {}),
        exercises: uniqueEntries,
      },
    })
      .then((list) => {
        if (!active) return;
        setRefsByExId(new Map(list.map((entry) => [entry.id, entry.sets])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [exIdsKey, date, record?.id, sessionStart]);

  const elapsedSeconds = elapsedAt(timing, nowMs);
  const { totalSets, doneSets, liveVolume } = useMemo(() => {
    let total = 0;
    let done = 0;
    const summary = summarizeWorkoutRecord({
      date,
      title,
      startedAt: sessionStart,
      endedAt: null,
      status: "active",
      exercises,
    });
    for (const ex of exercises) {
      total += ex.sets.length;
      done += ex.sets.filter((s) => s.completed).length;
    }
    return { totalSets: total, doneSets: done, liveVolume: summary.volume };
  }, [exercises, date, title, sessionStart]);

  const openAddExercisePicker = () => {
    triggerHaptic("light");
    openModal({
      title: "添加训练动作",
      layout: "exercise",
      wide: true,
      content: (
        <ExercisePickerModal
          title="添加训练动作"
          onSelect={(ex: CatalogueExercise) => {
            const newEx: WorkoutExercise = {
              id: newId(),
              exerciseId: ex.id,
              supersetGroup: null,
              restSeconds: goals?.restSeconds ?? 90,
              snapshot: {
                name: ex.name,
                muscle: ex.muscle,
                equipment: ex.equipment,
                mode: ex.mode,
                volumeMultiplier: ex.volumeMultiplier ?? 1,
              },
              sets: [
                defaultSet(0, ex.mode === "timed" ? 0 : 8, ex.mode === "timed" ? 30 : 0),
                defaultSet(0, ex.mode === "timed" ? 0 : 8, ex.mode === "timed" ? 30 : 0),
                defaultSet(0, ex.mode === "timed" ? 0 : 8, ex.mode === "timed" ? 30 : 0),
              ],
            };
            setExercises((prev) => {
              setActiveExIdx(prev.length);
              return [...prev, newEx];
            });
          }}
        />
      ),
    });
  };

  const openSwapExercisePicker = (rowIdx: number) => {
    triggerHaptic("light");
    openModal({
      title: "替换训练动作",
      layout: "exercise",
      wide: true,
      content: (
        <ExercisePickerModal
          title="替换训练动作"
          onSelect={(ex: CatalogueExercise) => {
            setExercises((prev) =>
              prev.map((row, i) =>
                i === rowIdx
                  ? {
                      ...row,
                      exerciseId: ex.id,
                      snapshot: {
                        name: ex.name,
                        muscle: ex.muscle,
                        equipment: ex.equipment,
                        mode: ex.mode,
                        volumeMultiplier: ex.volumeMultiplier ?? 1,
                      },
                    }
                  : row,
              ),
            );
            notify(`已替换为「${ex.name}」`);
          }}
        />
      ),
    });
  };

  const updateSet = (exIdx: number, setIdx: number, updater: (cur: WorkoutSet) => WorkoutSet) => {
    setExercises((prev) =>
      prev.map((row, i) =>
        i === exIdx
          ? { ...row, sets: row.sets.map((s, j) => (j === setIdx ? updater(s) : s)) }
          : row,
      ),
    );
  };

  const toggleSetComplete = (exIdx: number, setIdx: number, nextCompleted: boolean) => {
    const row = exercises[exIdx];
    const targetSet = row?.sets[setIdx];
    if (!row || !targetSet) return;

    // Hardware tactile & ambient sound MUST run synchronously inside user click handler
    triggerHaptic(nextCompleted ? "success" : "light");
    audio.tap(nextCompleted ? "check" : "uncheck");

    if (nextCompleted && !isHistoricalEdit) {
      const nextSet = row.sets[setIdx + 1];
      const { seconds } = resolveSetRestSeconds({
        setType: targetSet.type,
        nextSetType: nextSet?.type ?? null,
        defaultRestSeconds: row.restSeconds ?? goals?.restSeconds ?? 90,
      });
      if (seconds > 0) {
        restAlarmFiredForRef.current = null;
        setRest(createRestTimer(seconds, targetSet.id));
      }
    }

    updateSet(exIdx, setIdx, (s) => ({
      ...s,
      completed: nextCompleted,
      ...(nextCompleted ? { completedAt: new Date().toISOString() } : { completedAt: undefined }),
    }));
  };

  const addWarmupSets = (exIdx: number) => {
    const row = exercises[exIdx];
    if (!row) return;
    const isBarbell = row.snapshot?.equipment === "barbell";
    const firstWorkWeight = row.sets.find((s) => s.type !== "warmup" && s.weight > 0)?.weight ?? 60;
    const w1 = snapWarmupWeight(firstWorkWeight * 0.5, isBarbell, barWeight, ALL_PLATES);
    const w2 = snapWarmupWeight(firstWorkWeight * 0.75, isBarbell, barWeight, ALL_PLATES);
    const warmups: WorkoutSet[] = [
      { id: newId(), type: "warmup", weight: w1, reps: 8, seconds: 0, completed: false, rir: null },
      ...(w2 > w1
        ? [{ id: newId(), type: "warmup" as const, weight: w2, reps: 5, seconds: 0, completed: false, rir: null }]
        : []),
    ];
    triggerHaptic("light");
    setExercises((prev) =>
      prev.map((r, i) => (i === exIdx ? { ...r, sets: [...warmups, ...r.sets] } : r)),
    );
    notify(`已加入 ${warmups.length} 组递增热身`);
  };

  const buildWorkoutPayload = (targetStatus: "active" | "completed") => {
    const curRec = savedRecordRef.current;
    const cleanTitle = title.trim() || "自由训练";
    const nowDate = new Date();
    const endedAt =
      targetStatus === "active"
        ? null
        : curRec?.data.endedAt && date === curRec.data.date
          ? curRec.data.endedAt
          : date === todayStr
            ? nowDate.toISOString()
            : new Date(Date.parse(sessionStart) + Math.max(0, elapsedSeconds) * 1000).toISOString();

    const pausedTiming = pauseAt(timing, nowDate.getTime());
    const resting = targetStatus === "active" && rest?.pausedLeftMs == null && (rest?.end ?? 0) > nowDate.getTime();

    const sanitizedExercises = exercises.map((ex) => ({
      ...ex,
      restSeconds: Math.max(0, Math.min(900, Math.round(ex.restSeconds ?? 90))),
      sets: ex.sets.map((s) => ({
        ...s,
        weight: Math.max(0, Number(s.weight) || 0),
        reps: Math.max(0, Math.min(1000, Math.round(Number(s.reps) || 0))),
        seconds: Math.max(0, Math.min(86400, Math.round(Number(s.seconds) || 0))),
      })),
    }));

    const workoutData: WorkoutData = {
      title: cleanTitle,
      date,
      startedAt: sessionStart,
      endedAt,
      status: targetStatus,
      durationUnknown: curRec?.data.durationUnknown,
      notes: notes.trim(),
      feeling,
      source: curRec?.data.source ?? "manual",
      planId: curRec?.data.planId ?? null,
      planVersion: curRec?.data.planVersion ?? null,
      routineId: curRec?.data.routineId ?? null,
      exercises: sanitizedExercises,
      timing: pausedTiming,
      restEndsAt: resting && rest ? Math.round(rest.end) : null,
      restStartedAt: resting && rest ? Math.max(0, Math.round(rest.start)) : null,
    };

    const body = {
      opId: newId(),
      id: workoutId,
      kind: "workout" as const,
      baseVersion: curRec?.version ?? 0,
      deleted: false,
      data: workoutData,
    };

    return { cleanTitle, workoutData, body };
  };

  const ensureSavedDraft = async (): Promise<RecordEnvelope<WorkoutData>> => {
    if (!exercises.length) {
      throw new Error("请先添加至少一个训练动作后再使用 AI 调整");
    }
    const curRec = savedRecordRef.current;
    const status = curRec?.data.status === "completed" ? "completed" : "active";
    const { workoutData, body } = buildWorkoutPayload(status);
    const res = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
      method: "POST",
      body,
    });
    const saved: RecordEnvelope<WorkoutData> = res.record ?? {
      id: workoutId,
      kind: "workout",
      version: (curRec?.version ?? 0) + 1,
      deleted: false,
      updatedAt: new Date().toISOString(),
      data: workoutData,
    };
    savedRecordRef.current = saved;
    setSavedRecord(saved);
    bumpDataEpoch();
    return saved;
  };

  const submitWorkout = async (targetStatus: "active" | "completed") => {
    if (!exercises.length && targetStatus === "completed") {
      setError("请至少添加一个动作后再结束训练");
      return;
    }

    setSaving(true);
    setError("");
    const curRec = savedRecordRef.current;
    const { cleanTitle, workoutData, body } = buildWorkoutPayload(targetStatus);

    try {
      const res = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
        method: "POST",
        body,
      });
      if (draftStorageKey && typeof localStorage !== "undefined") {
        localStorage.removeItem(draftStorageKey);
      }
      triggerHaptic("success");
      bumpDataEpoch();
      const saved: RecordEnvelope<WorkoutData> = res.record ?? {
        id: workoutId,
        kind: "workout",
        version: (curRec?.version ?? 0) + 1,
        deleted: false,
        updatedAt: new Date().toISOString(),
        data: workoutData,
      };
      savedRecordRef.current = saved;
      setSavedRecord(saved);
      if (targetStatus === "completed" && onCompleted) {
        onCompleted(saved);
      } else {
        closeAllModals();
        notify(targetStatus === "active" ? "训练草稿已保存至云端" : "训练已保存");
      }
    } catch (err) {
      if (isNetworkError(err) && userId && typeof localStorage !== "undefined") {
        enqueueMutation(localStorage, userId, {
          opId: body.opId,
          path: "/api/records",
          method: "POST",
          body,
          label: `训练：${cleanTitle}`,
        });
        refreshPendingCount(userId);
        if (draftStorageKey) localStorage.removeItem(draftStorageKey);
        closeAllModals();
        notify("离线状态：训练已暂存，联网后自动同步");
        return;
      }
      setError((err as Error)?.message || "保存训练失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWorkout = () => {
    const curRec = savedRecordRef.current;
    if (!curRec) return;
    openConfirm({
      title: "删除训练记录",
      message: `确定要删除「${title}」吗？此操作不可撤销。`,
      confirmLabel: "删除记录",
      onConfirm: async () => {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: newId(),
            id: curRec.id,
            kind: "workout",
            baseVersion: curRec.version,
            deleted: true,
            data: curRec.data,
          },
        });
        if (draftStorageKey && typeof localStorage !== "undefined") {
          localStorage.removeItem(draftStorageKey);
        }
        bumpDataEpoch();
        closeAllModals();
        notify("已删除训练记录");
      },
    });
  };

  const restInfo = rest ? restProgress(rest, nowMs) : null;
  const isPausedClock = timing.runningSince == null;

  return (
    <div className={`dialog-form workout-form${showRir ? " show-rir" : ""}${!isHistoricalEdit ? " is-live" : ""}`}>
      {!isHistoricalEdit ? (
        <header className="workout-topbar">
          <div className="workout-topbar-row">
            <button
              type="button"
              className="workout-circle-btn"
              aria-label="展开训练设置与偏好"
              onClick={() => {
                triggerHaptic("light");
                setOpenMenu((v) => !v);
              }}
            >
              <Icon name="more" size={18} />
            </button>

            <button
              type="button"
              className={`workout-topbar-center${isPausedClock ? " is-paused" : ""}`}
              onClick={() => {
                triggerHaptic("light");
                setTiming((cur) =>
                  cur.runningSince
                    ? pauseAt(cur, Date.now())
                    : { elapsedSeconds: cur.elapsedSeconds, runningSince: new Date().toISOString() },
                );
              }}
            >
              <strong>{title || "自由训练"}</strong>
              <span className="workout-topbar-sub">
                <i className="live-led" aria-hidden="true" />
                <em>{formatClock(elapsedSeconds)}</em>
                <i>· {doneSets}/{totalSets} 组</i>
              </span>
            </button>

            <div className="workout-topbar-actions">
              <button
                type="button"
                className="workout-finish-pill secondary-button"
                disabled={saving}
                onClick={() => void submitWorkout("active")}
              >
                草稿
              </button>
              <button
                type="button"
                className="workout-finish-pill"
                disabled={saving}
                onClick={() => {
                  triggerHaptic("light");
                  setFinishPanelOpen((v) => !v);
                }}
              >
                结束
              </button>
            </div>
          </div>

          <div className="workout-progress-strip">
            <progress value={doneSets} max={Math.max(1, totalSets)} />
            <span className="workout-live-vol">{fmt(liveVolume, 0)} kg</span>
          </div>
        </header>
      ) : null}

      {/* Topbar Dropdown / Overlay Settings */}
      {openMenu ? (
        <div className="session-menu-overlay">
          <div className="picker-overlay-head">
            <strong>训练会话设置</strong>
            <button type="button" className="secondary-button picker-close-btn" onClick={() => setOpenMenu(false)}>
              完成
            </button>
          </div>
          <div className="session-menu-body">
            <label className="field">
              <span>训练名称</span>
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>训练日期</span>
              <input type="date" value={date} min="1902-01-01" max={todayStr} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="session-options">
              <label className="switch-chip">
                <span>提示音反馈</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={soundOn}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setSoundOn(next);
                    writeBoolPref(soundPreference, next);
                    if (next) audio.unlock();
                  }}
                />
              </label>
              <label className="switch-chip">
                <span>显示 RIR 储备</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={showRir}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setShowRir(next);
                    writeBoolPref(rirPreference, next);
                  }}
                />
              </label>
              <label className={`switch-chip${wakeActive ? " wake-active" : ""}`}>
                <span>训练防息屏</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={screenAwakePref}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setScreenAwakePref(next);
                    writeBoolPref(screenPreference, next);
                  }}
                />
              </label>
              <label className="switch-chip">
                <span>到期通知</span>
                <input
                  className="switch"
                  type="checkbox"
                  checked={notifyRestPref}
                  onChange={(e) => {
                    const next = e.target.checked;
                    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
                      void Notification.requestPermission();
                    }
                    setNotifyRestPref(next);
                    writeBoolPref(notifyPreference, next);
                  }}
                />
              </label>
            </div>
            <div className="field">
              <span>杠铃空杆规格</span>
              <div className="segments">
                {BAR_PRESETS.map(([bw, lbl]) => (
                  <button
                    key={bw}
                    type="button"
                    aria-pressed={barWeight === bw}
                    onClick={() => {
                      setBarWeight(bw);
                      try {
                        localStorage.setItem(barPreference, String(bw));
                      } catch {}
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="session-menu-quick">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  openAiAdaptWorkoutModal({
                    ensureSavedWorkout: ensureSavedDraft,
                    onApplied: (updated) => {
                      savedRecordRef.current = updated;
                      setSavedRecord(updated);
                      setExercises(updated.data.exercises);
                      setOpenMenu(false);
                      bumpDataEpoch();
                      notify("已应用 AI 训中调整");
                    },
                  })
                }
              >
                <Icon name="bolt" size={15} /> AI 训中调整
              </button>
              {savedRecord ? (
                <button type="button" className="danger" onClick={handleDeleteWorkout}>
                  删除本条记录
                </button>
              ) : (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    if (draftStorageKey && typeof localStorage !== "undefined") {
                      localStorage.removeItem(draftStorageKey);
                    }
                    closeAllModals();
                  }}
                >
                  放弃未保存草稿
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Exercise Jump Bar */}
      <div className="session-control-stack">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="exercise-jump" role="navigation" aria-label="动作快捷跳转">
            {exercises.map((row, idx) => {
              const allDone = row.sets.length > 0 && row.sets.every((s) => s.completed);
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`jump-circle${allDone ? " finished" : ""}`}
                  aria-pressed={activeExIdx === idx}
                  title={row.snapshot?.name ?? row.exerciseId}
                  onClick={() => {
                    setActiveExIdx(idx);
                    cardRefs.current[row.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {idx + 1}
                  {row.supersetGroup ? <i className="jump-ss-sup">{row.supersetGroup}</i> : null}
                </button>
              );
            })}
          </div>
          <div className="exercise-bar-right">
            <button type="button" className="secondary-button" onClick={openAddExercisePicker}>
              <Icon name="plus" size={14} /> 加动作
            </button>
          </div>
        </div>
      </div>

      {/* Main Exercise Scroll Stack */}
      <div className="workout-scroll">
        {finishPanelOpen ? (
          <div className="finish-panel">
            {isHistoricalEdit ? (
              <div className="fields">
                <label className="field">
                  <span>训练名称</span>
                  <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="field">
                  <span>训练日期</span>
                  <input
                    type="date"
                    value={date}
                    min="1902-01-01"
                    max={todayStr}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
            ) : null}

            <fieldset>
              <legend>本次训练体感</legend>
              <div className="feeling-choices">
                {(Object.entries(FEELINGS) as Array<[FeelingKey, string]>).map(([k, lbl]) => (
                  <label key={k}>
                    <input
                      type="radio"
                      name="feeling"
                      checked={feeling === k}
                      onChange={() => {
                        triggerHaptic("light");
                        setFeeling(k);
                      }}
                    />
                    <span>{lbl}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span>训练备注（选填）</span>
              <input
                maxLength={400}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="例如：握距偏窄、左肩微紧"
              />
            </label>

            <div className="dialog-foot">
              {!isHistoricalEdit ? (
                <button type="button" className="quiet" onClick={() => setFinishPanelOpen(false)}>
                  继续练
                </button>
              ) : (
                <button type="button" className="danger" onClick={handleDeleteWorkout}>
                  删除
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={saving}
                onClick={() => void submitWorkout("completed")}
              >
                {saving ? "保存中…" : isHistoricalEdit ? "保存修改" : `完成训练 · ${doneSets} 组`}
              </button>
            </div>
          </div>
        ) : null}

        {exercises.length === 0 ? (
          <div className="workout-empty-state">
            <strong>还没有添加训练动作</strong>
            <p className="muted">从 5,650+ 中英文动作库或个人收藏挑选动作开始记录。</p>
            <button type="button" className="primary-button" onClick={openAddExercisePicker}>
              <Icon name="plus" size={16} /> 添加动作
            </button>
          </div>
        ) : (
          exercises.map((row, exIdx) => {
            const snap = row.snapshot;
            const mode: ExerciseMode = snap?.mode ?? "reps";
            const isTimed = mode === "timed";
            const isBarbell = snap?.equipment === "barbell";
            const exDoneCount = row.sets.filter((s) => s.completed).length;
            const settingsExpanded = openSettingsIds.has(row.id);
            const refSets = refsByExId.get(row.exerciseId) ?? [];
            const refText = refSets
              .filter((r): r is NonNullable<typeof r> => r != null)
              .slice(0, 4)
              .map((r) => (isTimed ? `${r.seconds}s` : `${r.weight}×${r.reps}`))
              .join(", ");

            return (
              <section
                key={row.id}
                ref={(el) => {
                  cardRefs.current[row.id] = el;
                }}
                className={`exercise-editor${isTimed ? " timed-exercise" : ""} has-delete-cols`}
              >
                <div className="ex-hero-head">
                  <button
                    type="button"
                    className="ex-hero-thumb is-fallback"
                    aria-label="替换动作"
                    onClick={() => openSwapExercisePicker(exIdx)}
                  >
                    <Icon name="workout" size={22} />
                    <span className="ex-thumb-badge">
                      <Icon name="swap" size={10} />
                    </span>
                  </button>

                  <div className="ex-hero-title-col">
                    <div className="ex-hero-title-row">
                      <h3>{snap?.name ?? row.exerciseId}</h3>
                      <span className="ex-set-ratio">
                        {exDoneCount}/{row.sets.length} 组
                      </span>
                    </div>
                    <div className="ex-hero-tags">
                      {snap?.muscle ? <span className="ex-tag">{MUSCLES[snap.muscle] ?? snap.muscle}</span> : null}
                      {snap?.equipment ? (
                        <span className="ex-tag">{EQUIPMENT[snap.equipment] ?? snap.equipment}</span>
                      ) : null}
                      {row.supersetGroup ? <span className="superset-pill">超级组 {row.supersetGroup}</span> : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="icon-button"
                    aria-label="动作管理与休息时长"
                    aria-expanded={settingsExpanded}
                    onClick={() => {
                      setOpenSettingsIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      });
                    }}
                  >
                    <Icon name="settings" size={16} />
                  </button>
                </div>

                {refText ? (
                  <div className="ex-context-stack">
                    <div className="ex-last-row">
                      <span>上次：{refText}</span>
                      {!isTimed ? (
                        <button
                          type="button"
                          className="ex-apply-ref"
                          onClick={() => {
                            triggerHaptic("light");
                            setExercises((prev) =>
                              prev.map((ex, i) =>
                                i === exIdx
                                  ? {
                                      ...ex,
                                      sets: ex.sets.map((s, j) => {
                                        const ref = refSets[j];
                                        if (!ref || s.completed) return s;
                                        return { ...s, weight: ref.weight, reps: ref.reps || s.reps };
                                      }),
                                    }
                                  : ex,
                              ),
                            );
                            notify("已填入上次重量与次数");
                          }}
                        >
                          沿用上次
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {settingsExpanded ? (
                  <div className="exercise-settings">
                    <div className="exercise-settings-body">
                      <div className="rest-preset-row">
                        <label>组间休息</label>
                        <div className="rest-quick-pills">
                          {REST_PRESETS.map((sec) => (
                            <button
                              key={sec}
                              type="button"
                              className="quiet"
                              aria-pressed={row.restSeconds === sec}
                              onClick={() =>
                                setExercises((prev) =>
                                  prev.map((ex, i) => (i === exIdx ? { ...ex, restSeconds: sec } : ex)),
                                )
                              }
                            >
                              {sec}s
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="rest-preset-row">
                        <label>超级组标记</label>
                        <div className="rest-quick-pills">
                          {([null, "A", "B", "C"] as const).map((code) => (
                            <button
                              key={code ?? "none"}
                              type="button"
                              className="quiet"
                              aria-pressed={(row.supersetGroup ?? null) === code}
                              onClick={() =>
                                setExercises((prev) =>
                                  prev.map((ex, i) => (i === exIdx ? { ...ex, supersetGroup: code } : ex)),
                                )
                              }
                            >
                              {code ?? "无"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="exercise-manage-row">
                        <div className="exercise-move-group">
                          <button
                            type="button"
                            className="quiet"
                            disabled={exIdx === 0}
                            onClick={() =>
                              setExercises((prev) => {
                                const next = [...prev];
                                [next[exIdx - 1], next[exIdx]] = [next[exIdx]!, next[exIdx - 1]!];
                                return next;
                              })
                            }
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            className="quiet"
                            disabled={exIdx === exercises.length - 1}
                            onClick={() =>
                              setExercises((prev) => {
                                const next = [...prev];
                                [next[exIdx], next[exIdx + 1]] = [next[exIdx + 1]!, next[exIdx]!];
                                return next;
                              })
                            }
                          >
                            下移
                          </button>
                          <button type="button" className="quiet" onClick={() => openSwapExercisePicker(exIdx)}>
                            替换动作
                          </button>
                        </div>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => setExercises((prev) => prev.filter((_, i) => i !== exIdx))}
                        >
                          移除动作
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="sets-card">
                  <div className="set-head">
                    <span>组</span>
                    <span>{isTimed ? "时长(秒)" : snap?.mode === "assisted" ? "辅助(kg)" : "重量(kg)"}</span>
                    {!isTimed ? <span>次数</span> : null}
                    <span className="col-rir">RIR</span>
                    <span>完成</span>
                    <span />
                  </div>

                  {row.sets.map((s, setIdx) => {
                    const prevSet = setIdx > 0 ? row.sets[setIdx - 1] : null;
                    const deltaHint =
                      isBarbell && prevSet && s.weight > barWeight
                        ? plateDeltaLabel(prevSet.weight, s.weight, barWeight, ALL_PLATES)
                        : "";
                    const platesInfo =
                      isBarbell && s.weight > barWeight ? plateBreakdown(s.weight, barWeight, ALL_PLATES) : null;
                    const typeInfo = SET_TYPES[s.type];

                    return (
                      <div key={s.id} className="set-block">
                        <div className={`set-row${s.completed ? " is-complete" : ""}`}>
                          <button
                            type="button"
                            className="set-num-btn"
                            data-type={s.type}
                            title={`组别：${typeInfo.label}（点击切换）`}
                            onClick={() => {
                              triggerHaptic("light");
                              const nextIdx = (SET_TYPE_ORDER.indexOf(s.type) + 1) % SET_TYPE_ORDER.length;
                              updateSet(exIdx, setIdx, (cur) => ({ ...cur, type: SET_TYPE_ORDER[nextIdx]! }));
                            }}
                          >
                            {setIdx + 1}
                            {typeInfo.short ? <i className="set-kind-sup">{typeInfo.short}</i> : null}
                          </button>

                          {!isTimed ? (
                            <>
                              <div className="num-stepper">
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  aria-label="减重量"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    audio.tap("step");
                                    updateSet(exIdx, setIdx, (cur) => ({
                                      ...cur,
                                      weight: Math.max(0, round2(cur.weight - 2.5)),
                                    }));
                                  }}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step={0.5}
                                  min={0}
                                  max={5000}
                                  value={s.weight}
                                  onChange={(e) =>
                                    updateSet(exIdx, setIdx, (cur) => ({
                                      ...cur,
                                      weight: Math.max(0, Number(e.target.value) || 0),
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  aria-label="加重量"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    audio.tap("step");
                                    updateSet(exIdx, setIdx, (cur) => ({
                                      ...cur,
                                      weight: round2(cur.weight + 2.5),
                                    }));
                                  }}
                                >
                                  +
                                </button>
                              </div>

                              <div className="num-stepper">
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  aria-label="减次数"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    audio.tap("step");
                                    updateSet(exIdx, setIdx, (cur) => ({
                                      ...cur,
                                      reps: Math.max(0, cur.reps - 1),
                                    }));
                                  }}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={1000}
                                  value={s.reps}
                                  onChange={(e) =>
                                    updateSet(exIdx, setIdx, (cur) => ({
                                      ...cur,
                                      reps: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  aria-label="加次数"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    audio.tap("step");
                                    updateSet(exIdx, setIdx, (cur) => ({
                                      ...cur,
                                      reps: Math.min(1000, cur.reps + 1),
                                    }));
                                  }}
                                >
                                  +
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="num-stepper">
                              <button
                                type="button"
                                className="num-step-btn"
                                onClick={() => {
                                  triggerHaptic("light");
                                  updateSet(exIdx, setIdx, (cur) => ({
                                    ...cur,
                                    seconds: Math.max(0, cur.seconds - 5),
                                  }));
                                }}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={86400}
                                value={s.seconds}
                                onChange={(e) =>
                                  updateSet(exIdx, setIdx, (cur) => ({
                                    ...cur,
                                    seconds: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="num-step-btn"
                                onClick={() => {
                                  triggerHaptic("light");
                                  updateSet(exIdx, setIdx, (cur) => ({
                                    ...cur,
                                    seconds: cur.seconds + 5,
                                  }));
                                }}
                              >
                                +
                              </button>
                            </div>
                          )}

                          <select
                            className="col-rir set-rir-select"
                            aria-label="RIR"
                            value={s.rir ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value;
                              updateSet(exIdx, setIdx, (cur) => ({
                                ...cur,
                                rir: raw === "" ? null : Number(raw),
                              }));
                            }}
                          >
                            <option value="">—</option>
                            {[0, 1, 2, 3, 4, 5].map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>

                          <label className="check-set" aria-label={`标记第 ${setIdx + 1} 组完成`}>
                            <input
                              type="checkbox"
                              checked={s.completed}
                              onChange={(e) => toggleSetComplete(exIdx, setIdx, e.target.checked)}
                            />
                            <span>
                              <Icon name="check" size={16} />
                            </span>
                          </label>

                          <button
                            type="button"
                            className="quiet icon-button set-del-btn"
                            aria-label="删除此组"
                            disabled={row.sets.length <= 1}
                            onClick={() =>
                              setExercises((prev) =>
                                prev.map((ex, i) =>
                                  i === exIdx ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) } : ex,
                                ),
                              )
                            }
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </div>

                        {platesInfo?.valid ? (
                          <div className="set-inline-meta">
                            <div className="set-inline-top">
                              <span className="set-plate-line">
                                {barWeight}kg杆 每侧 {platesInfo.plates.length ? platesInfo.plates.join(" + ") : "空杆"}
                                {!platesInfo.achievable && platesInfo.remainder > 0 ? ` (余 ${platesInfo.remainder}kg)` : ""}
                              </span>
                              {deltaHint ? <span className="set-plate-delta">{deltaHint}</span> : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  <div className="sets-card-foot">
                    <button
                      type="button"
                      className="sets-add-btn"
                      onClick={() => {
                        triggerHaptic("light");
                        const last = row.sets.at(-1);
                        setExercises((prev) =>
                          prev.map((ex, i) =>
                            i === exIdx
                              ? {
                                  ...ex,
                                  sets: [
                                    ...ex.sets,
                                    defaultSet(
                                      last?.weight ?? 0,
                                      last?.reps ?? (isTimed ? 0 : 8),
                                      last?.seconds ?? (isTimed ? 30 : 0),
                                    ),
                                  ],
                                }
                              : ex,
                          ),
                        );
                      }}
                    >
                      <Icon name="plus" size={16} /> 加一组
                    </button>

                    <div className="sets-foot-tools">
                      {!isTimed ? (
                        <button type="button" className="sets-foot-pill" onClick={() => addWarmupSets(exIdx)}>
                          + 热身组
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            );
          })
        )}

        <button
          type="button"
          className="secondary-button workout-inline-add-btn"
          onClick={openAddExercisePicker}
        >
          <Icon name="plus" size={16} /> 添加动作
        </button>

        <p className="form-error" role="alert" hidden={!error}>
          {error}
        </p>
      </div>

      {/* Bottom Rest Timer Dock */}
      {rest && restInfo ? (
        <div className="session-dock">
          <div
            className={`rest-clock${restInfo.paused ? " is-paused" : ""}${restInfo.seconds <= 5 ? " rest-urgent" : ""}`}
          >
            <div className="rest-top-progress">
              <i style={{ width: `${(restInfo.fraction * 100).toFixed(1)}%` }} />
            </div>
            <div className="rest-clock-inner">
              <div className="rest-dock-trigger">
                <strong>{formatClock(restInfo.seconds)}</strong>
                <span>
                  <i className="rest-led" aria-hidden="true" /> 组间休息
                </span>
              </div>
              <div className="rest-dock-buttons">
                <button
                  type="button"
                  className="rest-pill-btn"
                  onClick={() => {
                    triggerHaptic("light");
                    setRest((cur) => shiftRestTimer(cur, -15));
                  }}
                >
                  −15s
                </button>
                <button
                  type="button"
                  className="rest-pill-btn"
                  onClick={() => {
                    triggerHaptic("light");
                    setRest((cur) => shiftRestTimer(cur, 15));
                  }}
                >
                  +15s
                </button>
                <button
                  type="button"
                  className="rest-pill-btn rest-pause-btn"
                  aria-label={restInfo.paused ? "继续休息" : "暂停休息"}
                  aria-pressed={restInfo.paused}
                  onClick={() => {
                    triggerHaptic("light");
                    setRest((cur) => (restInfo.paused ? resumeRestTimer(cur) : pauseRestTimer(cur)));
                  }}
                >
                  <Icon name={restInfo.paused ? "play" : "pause"} size={14} />
                </button>
                <button
                  type="button"
                  className="rest-skip-btn"
                  onClick={() => {
                    triggerHaptic("light");
                    setRest(null);
                  }}
                >
                  跳过
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
