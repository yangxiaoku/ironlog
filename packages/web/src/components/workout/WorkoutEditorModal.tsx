import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { summarizeWorkoutMuscleSets } from "@ironlog/shared";
import { apiFetch } from "../../lib/api";
import {
  buildAppleHubActionUrl,
  isAppleMobileDevice,
  triggerAppleHubAction,
} from "../../lib/apple-fitness";
import { resolveCatalogueMap, safeExerciseMediaUrl } from "../../lib/catalogue";
import {
  COACH_QUICK_SCENARIOS,
  appendRoutineExercises,
  buildCoachQuickAdvice,
  type CoachQuickScenario,
} from "../../lib/coach-quick";
import { fmt, shortDate, today } from "../../lib/date";
import {
  EQUIPMENT,
  FEELINGS,
  MUSCLES,
  SET_TYPES,
  estimated1RM,
  kgToUnit,
  summarizeWorkoutRecord,
  weightToKg,
  workoutDraftKey,
  type CatalogueExercise,
  type ExerciseMode,
  type ExerciseReferenceEntry,
  type FeelingKey,
  type MuscleKey,
  type PlannedExercise,
  type ProfileGoals,
  type RecordEnvelope,
  type SetType,
  type TrainedExerciseSummary,
  type WeightUnit,
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
  speakCue,
  triggerHaptic,
  type RestTimerState,
  type WorkoutTiming,
} from "../../lib/haptics-audio";
import { enqueueMutation, getOfflineStorage, isNetworkError } from "../../lib/offline-queue";
import {
  ALL_PLATES,
  applySetFieldUpdate,
  BAR_PRESETS,
  buildWarmupSetsPlan,
  DEFAULT_EQUIPMENT_PROFILES,
  DEMO_DISPLAY_PRESETS,
  plateBreakdown,
  plateDeltaLabel,
  readWorkoutPreferences,
  resolveSupersetTransition,
  REST_SOUND_PRESETS,
  REST_STEP_PRESETS,
  round2,
  WARMUP_REST_PRESETS,
  WARMUP_SCHEMES,
  WEIGHT_STEP_PRESETS,
  WORKOUT_LAYOUT_PRESETS,
  WORKOUT_PREFS_EVENT,
  writeWorkoutPreference,
  type SetFieldPatch,
  type WorkoutLayoutMode,
  type WorkoutPreferences,
} from "../../lib/workout-helpers";
import {
  checkSetBeatsPrBaseline,
  describeSetOverloadCue,
  diffWorkoutAgainstSourceRoutine,
  duplicateSetInList,
  insertDropSetAfter,
  insertRestPauseSetAfter,
  summarizeExerciseBenchmarks,
  type LiveExercisePrBaseline,
} from "../../lib/workout-set-ops";
import { isBackfillWorkoutDate, resolveAutoAdvanceDelayMs } from "../../lib/routine-launch";
import {
  openAiAdaptWorkoutModal,
  openExerciseDetailModal,
} from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";
import { MuscleBodyMap } from "../MuscleBodyMap";
import type { ScheduleResponse } from "../plan/PlanModals";
import { ExercisePickerModal } from "./ExercisePickerModal";

const SET_TYPE_ORDER: SetType[] = ["normal", "warmup", "failure", "drop", "rest_pause"];
const REST_PRESETS = [30, 60, 90, 120, 180];

const RECORD_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SET_TYPES = new Set<SetType>(SET_TYPE_ORDER);
const VALID_FEELINGS = new Set<FeelingKey>(["easy", "balanced", "fatigued"]);
const VALID_MODES = new Set<ExerciseMode>(["reps", "timed", "assisted"]);

function isValidRecordId(val: unknown): val is string {
  return typeof val === "string" && RECORD_ID_RE.test(val);
}

function normalizeWorkoutSource(raw?: string): "manual" | "ai" | "agent" {
  return raw === "ai" || raw === "agent" ? raw : "manual";
}

function normalizeIsoTimestamp(raw: unknown, fallback?: string): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function sanitizeExerciseSnapshot(
  raw: WorkoutExercise["snapshot"],
): WorkoutExercise["snapshot"] {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : "";
  if (!name) return null;
  if (!(raw.muscle in MUSCLES) || !(raw.equipment in EQUIPMENT) || !VALID_MODES.has(raw.mode)) {
    return null;
  }
  const vm = Number(raw.volumeMultiplier);
  return {
    name,
    muscle: raw.muscle,
    equipment: raw.equipment,
    mode: raw.mode,
    volumeMultiplier: Number.isFinite(vm) ? Math.min(2, Math.max(1, vm)) : 1,
  };
}

function sanitizeTargetSnapshot(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { id?: unknown; name?: unknown; exercises?: unknown };
  if (!isValidRecordId(r.id)) return null;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 120) : "";
  if (!name || !Array.isArray(r.exercises) || r.exercises.length === 0 || r.exercises.length > 100) {
    return null;
  }
  const cleanExercises: Array<Record<string, unknown>> = [];
  for (const item of r.exercises) {
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    if (!isValidRecordId(it.exerciseId)) return null;
    const sets = Math.max(1, Math.min(100, Math.round(Number(it.sets) || 1)));
    const repsMin = Math.max(1, Math.min(1000, Math.round(Number(it.repsMin) || 1)));
    const repsMax = Math.max(repsMin, Math.min(1000, Math.round(Number(it.repsMax) || repsMin)));
    const rawWeight = it.weight;
    const weight =
      rawWeight == null
        ? null
        : Number.isFinite(Number(rawWeight))
          ? Math.max(0, Math.min(100000, Number(rawWeight)))
          : null;
    const seconds = Math.max(0, Math.min(86400, Math.round(Number(it.seconds) || 0)));
    const restSeconds = Math.max(0, Math.min(900, Math.round(Number(it.restSeconds) || 90)));
    const targetRir = Math.max(0, Math.min(10, Math.round(Number(it.targetRir ?? 2) || 0)));
    const progression =
      it.progression === "linear" ||
      it.progression === "greyskull" ||
      it.progression === "triple" ||
      it.progression === "manual"
        ? it.progression
        : "double";
    const rawInc = Number(it.increment);
    const increment = Number.isFinite(rawInc) ? Math.max(0, Math.min(20, rawInc)) : 2.5;
    const backupExerciseId = isValidRecordId(it.backupExerciseId) ? it.backupExerciseId : null;
    const supersetGroup =
      typeof it.supersetGroup === "string" && it.supersetGroup.trim()
        ? it.supersetGroup.trim().slice(0, 16)
        : null;
    cleanExercises.push({
      exerciseId: it.exerciseId,
      sets,
      repsMin,
      repsMax,
      weight,
      seconds,
      restSeconds,
      targetRir,
      progression,
      increment,
      backupExerciseId,
      supersetGroup,
      ...(it.weightUnit === "kg" || it.weightUnit === "lb" ? { weightUnit: it.weightUnit } : {}),
      ...(it.autoWarmup === true ? { autoWarmup: true } : {}),
    });
  }
  return { id: r.id, name, exercises: cleanExercises };
}

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

interface WorkoutDraftSnapshot {
  title: string;
  date: string;
  notes: string;
  feeling: FeelingKey | null;
  exercises: WorkoutExercise[];
  timing: WorkoutTiming;
  rest: RestTimerState | null;
  baseVersion?: number;
  workoutId?: string;
  source?: string;
  rawPrompt?: string;
  planId?: string | null;
  planVersion?: number | null;
  routineId?: string | null;
  targetSnapshot?: unknown;
  adjustments?: unknown[];
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
  const aiReady = useAuthStore((s) => s.aiReady);
  const openModal = useUiStore((s) => s.openModal);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const refreshPendingCount = useUiStore((s) => s.refreshPendingCount);
  const notify = useUiStore((s) => s.notify);
  const setInnerOverlayDismiss = useUiStore((s) => s.setInnerOverlayDismiss);

  const todayStr = today();
  const initialDraftKey = userId ? workoutDraftKey(userId, record?.id) : "";
  const restoredFromDraftRef = useRef(false);

  const initialSnapshot = useMemo<WorkoutDraftSnapshot>(() => {
    const baseData = record?.data;
    if (!seed && record?.data.status !== "completed" && initialDraftKey && typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(initialDraftKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<WorkoutDraftSnapshot>;
          if (Array.isArray(parsed.exercises)) {
            restoredFromDraftRef.current = true;
            return {
              title: parsed.title ?? baseData?.title ?? "自由训练",
              date: parsed.date ?? baseData?.date ?? todayStr,
              notes: parsed.notes ?? baseData?.notes ?? "",
              feeling: parsed.feeling ?? baseData?.feeling ?? null,
              exercises: parsed.exercises,
              timing: parsed.timing ?? baseData?.timing ?? { elapsedSeconds: 0, runningSince: new Date().toISOString() },
              rest: normalizeRestTimer(parsed.rest ?? null),
              baseVersion: typeof parsed.baseVersion === "number" ? parsed.baseVersion : record?.version ?? 0,
              workoutId: parsed.workoutId ?? record?.id,
              source: normalizeWorkoutSource(parsed.source ?? baseData?.source),
              rawPrompt: parsed.rawPrompt ?? baseData?.rawPrompt,
              planId: parsed.planId ?? baseData?.planId ?? null,
              planVersion: parsed.planVersion ?? baseData?.planVersion ?? null,
              routineId: parsed.routineId ?? baseData?.routineId ?? null,
              targetSnapshot: parsed.targetSnapshot ?? baseData?.targetSnapshot,
              adjustments: parsed.adjustments ?? baseData?.adjustments,
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

    const resolvedDate = seed?.date ?? baseData?.date ?? todayStr;
    const initialBackfill = isBackfillWorkoutDate(
      resolvedDate,
      todayStr,
      record?.data.status === "completed",
    );

    return {
      title: seed?.title ?? baseData?.title ?? "自由训练",
      date: resolvedDate,
      notes: seed?.notes ?? baseData?.notes ?? "",
      feeling: seed?.feeling ?? baseData?.feeling ?? null,
      exercises: seed?.exercises ?? baseData?.exercises ?? [],
      timing:
        baseData?.timing ??
        (record?.data.status === "completed" || initialBackfill
          ? { elapsedSeconds: 0, runningSince: null }
          : { elapsedSeconds: 0, runningSince: new Date().toISOString() }),
      rest: baseRest,
      baseVersion: record?.version ?? 0,
      workoutId: record?.id,
      source: normalizeWorkoutSource(seed?.source ?? baseData?.source),
      rawPrompt: seed?.rawPrompt ?? baseData?.rawPrompt,
      planId: seed?.planId ?? baseData?.planId ?? null,
      planVersion: seed?.planVersion ?? baseData?.planVersion ?? null,
      routineId: seed?.routineId ?? baseData?.routineId ?? null,
      targetSnapshot: seed?.targetSnapshot ?? baseData?.targetSnapshot,
      adjustments: seed?.adjustments ?? baseData?.adjustments,
    };
  }, [record, seed, initialDraftKey, todayStr]);

  const [savedRecord, setSavedRecord] = useState<RecordEnvelope<WorkoutData> | undefined>(record);
  const savedRecordRef = useRef<RecordEnvelope<WorkoutData> | undefined>(record);
  savedRecordRef.current = savedRecord;

  const isHistoricalEdit = (savedRecord ?? record)?.data.status === "completed";
  const hadTiming = Boolean(seed || record?.data?.timing || record?.data.status !== "completed");
  const [workoutId] = useState<string>(() => initialSnapshot.workoutId ?? record?.id ?? newId());
  const draftStorageKey = userId ? workoutDraftKey(userId, savedRecord?.id ?? record?.id) : "";
  const [sessionStart] = useState<string>(() => record?.data.startedAt ?? new Date().toISOString());
  const sessionMetaRef = useRef({
    source: normalizeWorkoutSource(initialSnapshot.source),
    rawPrompt: initialSnapshot.rawPrompt,
    planId: initialSnapshot.planId ?? null,
    planVersion: initialSnapshot.planVersion ?? null,
    routineId: initialSnapshot.routineId ?? null,
    targetSnapshot: initialSnapshot.targetSnapshot,
    adjustments: initialSnapshot.adjustments,
  });

  const [title, setTitle] = useState(initialSnapshot.title);
  const [date, setDate] = useState(initialSnapshot.date);
  const [notes, setNotes] = useState(initialSnapshot.notes);
  const [feeling, setFeeling] = useState<FeelingKey | null>(initialSnapshot.feeling);
  const [exercises, setExercises] = useState<WorkoutExercise[]>(initialSnapshot.exercises);
  const [timing, setTiming] = useState<WorkoutTiming>(initialSnapshot.timing);
  const [rest, setRest] = useState<RestTimerState | null>(initialSnapshot.rest);
  const draftFinalized = useRef(false);

  const [prefs, setPrefs] = useState<WorkoutPreferences>(() => readWorkoutPreferences());
  const {
    soundOn,
    soundStyle,
    hapticsOn,
    screenAwake: screenAwakePref,
    notifyRest: notifyRestPref,
    showRir,
    autoSyncSubsequent,
    autoPrefillLast,
    autoStartRestTimer,
    autoAdvanceExercise,
    warmupRestSeconds,
    restAdjustStep,
    weightStepKg,
    barWeight,
    enabledPlates,
    platePairs,
    showPlateMath,
    warmupScheme,
    workoutLayout,
    collapseCompletedExercises,
    voiceRestCues,
    demoDisplayMode,
  } = prefs;
  const effectiveDemoMode = demoDisplayMode ?? "small";
  const [wakeActive, setWakeActive] = useState(false);

  const updatePref = <K extends keyof WorkoutPreferences>(key: K, value: WorkoutPreferences[K]) => {
    writeWorkoutPreference(key, value);
    setPrefs(readWorkoutPreferences());
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPrefs = () => setPrefs(readWorkoutPreferences());
    window.addEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
  }, []);

  const [activeExIdx, setActiveExIdx] = useState(0);
  const isBackfillMode = isBackfillWorkoutDate(date, todayStr, isHistoricalEdit);
  const [viewMode, setViewMode] = useState<"single" | "all">(() =>
    isHistoricalEdit ||
    isBackfillWorkoutDate(initialSnapshot.date, todayStr, isHistoricalEdit) ||
    prefs.workoutLayout === "compact"
      ? "all"
      : "single",
  );
  const [recentQuickPicks, setRecentQuickPicks] = useState<TrainedExerciseSummary[]>([]);
  const [expandedDoneIds, setExpandedDoneIds] = useState<Set<string>>(() => new Set());
  const [timedSetClock, setTimedSetClock] = useState<{
    exIdx: number;
    setIdx: number;
    setId: string;
    targetSeconds: number;
    endAt: number;
  } | null>(null);
  const restTenSecSpokenForRef = useRef<number | null>(null);
  const timedCueSpokenSecRef = useRef<number | null>(null);
  const [openMenu, setOpenMenu] = useState(false);
  const [muscleProgressOpen, setMuscleProgressOpen] = useState(false);
  const [mergeRoutineOpen, setMergeRoutineOpen] = useState(false);
  const [mergeOptions, setMergeOptions] = useState<Array<{ key: string; title: string; source: string; exercises: PlannedExercise[] }>>([]);
  const [loadingMergeOptions, setLoadingMergeOptions] = useState(false);
  const [coachExIdx, setCoachExIdx] = useState<number | null>(null);
  const [coachScenario, setCoachScenario] = useState<CoachQuickScenario>("pain");
  const [editingSetNoteId, setEditingSetNoteId] = useState<string | null>(null);
  const [openSetMenuId, setOpenSetMenuId] = useState<string | null>(null);
  const [finishPanelOpen, setFinishPanelOpen] = useState(isHistoricalEdit);
  const [syncSourceOnFinish, setSyncSourceOnFinish] = useState(false);
  const [openSettingsIds, setOpenSettingsIds] = useState<Set<string>>(() => new Set());
  const [refsByExId, setRefsByExId] = useState<Map<string, ExerciseReferenceEntry["sets"]>>(() => new Map());
  const [refDatesByExId, setRefDatesByExId] = useState<Map<string, string>>(() => new Map());
  const [prsByExId, setPrsByExId] = useState<Map<string, LiveExercisePrBaseline>>(() => new Map());
  const [mediaByExId, setMediaByExId] = useState<Map<string, string>>(() => new Map());
  const touchedExIdsRef = useRef<Set<string>>(new Set());
  const autoPrefilledExIdsRef = useRef<Set<string>>(new Set());
  const [historyModalEx, setHistoryModalEx] = useState<{
    id: string;
    name: string;
    loading: boolean;
    mode: ExerciseMode;
    sessions: Array<{
      workoutId: string;
      date: string;
      title: string;
      topWeight: number | null;
      topReps: number | null;
      estimated1rm: number | null;
      bestSeconds: number | null;
      workSets: number;
      volume: number;
      sets: Array<{ type: string; weight: number; reps: number; seconds: number; rir: number | null }>;
    }>;
  } | null>(null);
  const [notesByExId, setNotesByExId] = useState<Record<string, { note: string }>>({});
  const [editingNoteExId, setEditingNoteExId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [swipeOffsetX, setSwipeOffsetX] = useState(0);
  const [manualDurationMin, setManualDurationMin] = useState<string>(() =>
    isHistoricalEdit ? String(Math.max(1, Math.round(elapsedAt(initialSnapshot.timing, Date.now()) / 60))) : "",
  );
  const [undoDeletedSet, setUndoDeletedSet] = useState<{
    exIdx: number;
    setIdx: number;
    set: WorkoutSet;
    exName: string;
  } | null>(null);
  const undoSetTimerRef = useRef<number | null>(null);

  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const soundStyleRef = useRef(soundStyle);
  soundStyleRef.current = soundStyle;
  const audio = useMemo(
    () =>
      createRestAudio(
        () => soundOnRef.current,
        () => soundStyleRef.current,
      ),
    [],
  );
  const restAlarmFiredForRef = useRef<number | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const jumpRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const workoutScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      if (undoSetTimerRef.current !== null) {
        window.clearTimeout(undoSetTimerRef.current);
      }
    };
  }, []);

  const isWorkoutTop = useUiStore((s) => s.modals.at(-1)?.layout === "workout");
  const safeExIdx = exercises.length ? Math.min(Math.max(0, activeExIdx), exercises.length - 1) : 0;

  useEffect(() => {
    if (exercises.length > 0 && activeExIdx >= exercises.length) {
      setActiveExIdx(exercises.length - 1);
    }
  }, [exercises.length, activeExIdx]);

  useEffect(() => {
    jumpRefs.current[safeExIdx]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [safeExIdx, exercises.length]);

  const goToExercise = (idx: number) => {
    if (!exercises.length) return;
    const clamped = Math.max(0, Math.min(exercises.length - 1, idx));
    triggerHaptic("light");
    setOpenSetMenuId(null);
    setActiveExIdx(clamped);
    if (viewMode === "single") {
      workoutScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      const targetId = exercises[clamped]?.id;
      if (targetId) cardRefs.current[targetId]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Register inner overlays with ModalHost so mobile Back gesture / ESC closes ONLY the active drawer
  const hasAnyInnerOverlay = Boolean(
    historyModalEx ||
      coachExIdx != null ||
      mergeRoutineOpen ||
      muscleProgressOpen ||
      openMenu ||
      (!isHistoricalEdit && finishPanelOpen),
  );
  useEffect(() => {
    if (!hasAnyInnerOverlay) {
      setInnerOverlayDismiss(null);
      return;
    }
    setInnerOverlayDismiss(() => {
      if (historyModalEx) setHistoryModalEx(null);
      else if (coachExIdx != null) setCoachExIdx(null);
      else if (mergeRoutineOpen) setMergeRoutineOpen(false);
      else if (muscleProgressOpen) setMuscleProgressOpen(false);
      else if (openMenu) setOpenMenu(false);
      else if (!isHistoricalEdit && finishPanelOpen) setFinishPanelOpen(false);
    });
    return () => setInnerOverlayDismiss(null);
  }, [
    hasAnyInnerOverlay,
    historyModalEx,
    coachExIdx,
    mergeRoutineOpen,
    muscleProgressOpen,
    openMenu,
    finishPanelOpen,
    isHistoricalEdit,
    setInnerOverlayDismiss,
  ]);

  // Fetch recent frequently-trained exercises for 1-tap quick-picks in free workout empty state
  useEffect(() => {
    if (exercises.length > 0 || !userId || recentQuickPicks.length > 0) return;
    let active = true;
    void apiFetch<{ items?: TrainedExerciseSummary[] }>("/api/web/trained-exercises")
      .then((res) => {
        if (active && Array.isArray(res?.items)) {
          setRecentQuickPicks(res.items.slice(0, 8));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [exercises.length, userId, recentQuickPicks.length]);

  const swipeRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    locked: "none" as "none" | "x" | "y",
  });

  const handleStageTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (viewMode !== "single" || isHistoricalEdit || exercises.length <= 1 || e.touches.length !== 1) return;
    if (openMenu || finishPanelOpen) return;
    const target = e.target as Element | null;
    if (target?.closest("input, textarea, select, [data-no-swipe]")) return;
    const t = e.touches[0];
    if (!t) return;
    swipeRef.current = { active: true, startX: t.clientX, startY: t.clientY, startTime: Date.now(), locked: "none" };
  };

  const handleStageTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const st = swipeRef.current;
    if (!st.active || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - st.startX;
    const dy = t.clientY - st.startY;
    if (st.locked === "none") {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
        st.locked = "y";
        st.active = false;
        setSwipeOffsetX(0);
        return;
      }
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.35) {
        st.locked = "x";
      } else {
        return;
      }
    }
    if (st.locked === "x") {
      const atEdge = (dx > 0 && safeExIdx === 0) || (dx < 0 && safeExIdx === exercises.length - 1);
      const factor = atEdge ? 0.22 : 0.55;
      setSwipeOffsetX(Math.max(-110, Math.min(110, dx * factor)));
    }
  };

  const handleStageTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const st = swipeRef.current;
    swipeRef.current.active = false;
    const locked = st.locked;
    st.locked = "none";
    setSwipeOffsetX(0);
    if (locked !== "x") return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - st.startX;
    const dt = Date.now() - st.startTime;
    if (Math.abs(dx) >= 56 || (Math.abs(dx) >= 32 && dt < 220)) {
      if (dx < 0 && safeExIdx < exercises.length - 1) goToExercise(safeExIdx + 1);
      else if (dx > 0 && safeExIdx > 0) goToExercise(safeExIdx - 1);
    }
  };

  const handleStageTouchCancel = () => {
    swipeRef.current.active = false;
    swipeRef.current.locked = "none";
    setSwipeOffsetX(0);
  };

  useEffect(() => {
    if (viewMode !== "single" || isHistoricalEdit || exercises.length <= 1 || openMenu || finishPanelOpen || !isWorkoutTop) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (e.key === "ArrowLeft" && safeExIdx > 0) {
        e.preventDefault();
        goToExercise(safeExIdx - 1);
      } else if (e.key === "ArrowRight" && safeExIdx < exercises.length - 1) {
        e.preventDefault();
        goToExercise(safeExIdx + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Sync `.is-live-workout` on parent <dialog> while live session runs
  useEffect(() => {
    const dialog = document.getElementById("dialog");
    if (!dialog) return;
    if (!isHistoricalEdit && isWorkoutTop) dialog.classList.add("is-live-workout");
    else dialog.classList.remove("is-live-workout");
    return () => {
      dialog.classList.remove("is-live-workout");
    };
  }, [isHistoricalEdit, isWorkoutTop]);

  const persistDraft = useCallback(() => {
    if (!draftStorageKey || isHistoricalEdit || draftFinalized.current) return;
    try {
      const storage = getOfflineStorage();
      if (!storage) return;
      if (initialDraftKey && initialDraftKey !== draftStorageKey) {
        storage.removeItem(initialDraftKey);
      }
      storage.setItem(
        draftStorageKey,
        JSON.stringify({
          title,
          date,
          notes,
          feeling,
          exercises,
          timing,
          rest,
          workoutId,
          baseVersion: savedRecordRef.current?.version ?? record?.version ?? initialSnapshot.baseVersion ?? 0,
          ...sessionMetaRef.current,
        }),
      );
    } catch {}
  }, [draftStorageKey, initialDraftKey, isHistoricalEdit, title, date, notes, feeling, exercises, timing, rest, workoutId, record?.version, initialSnapshot.baseVersion]);

  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;

  const clearDraft = () => {
    draftFinalized.current = true;
    try {
      const storage = getOfflineStorage();
      if (draftStorageKey) storage?.removeItem(draftStorageKey);
      if (initialDraftKey && initialDraftKey !== draftStorageKey) storage?.removeItem(initialDraftKey);
    } catch {}
  };

  useEffect(() => {
    if (isHistoricalEdit && initialDraftKey) {
      try {
        getOfflineStorage()?.removeItem(initialDraftKey);
      } catch {}
    }
  }, [isHistoricalEdit, initialDraftKey]);

  const handleMinimize = () => {
    persistDraft();
    triggerHaptic("light");
    closeAllModals();
    notify("训练已收起至底部悬浮条 · 计时与休息继续中");
  };

  useLayoutEffect(() => {
    if (!draftStorageKey || isHistoricalEdit) return;
    const timer = window.setTimeout(persistDraft, 200);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persistDraft();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", persistDraft);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", persistDraft);
    };
  }, [draftStorageKey, isHistoricalEdit, persistDraft]);

  useEffect(() => {
    return () => {
      persistDraftRef.current();
    };
  }, []);

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

  // Rest 10-second voice cue & completion alarm
  useEffect(() => {
    if (!rest || rest.pausedLeftMs != null) return;
    const leftSec = Math.ceil((rest.end - nowMs) / 1000);
    if (voiceRestCues && leftSec === 10 && restTenSecSpokenForRef.current !== rest.end) {
      restTenSecSpokenForRef.current = rest.end;
      speakCue("还剩 10 秒", { enabled: true });
    }
    if (nowMs >= rest.end && restAlarmFiredForRef.current !== rest.end) {
      restAlarmFiredForRef.current = rest.end;
      if (nowMs - rest.end <= 60_000) {
        audio.play(true);
        if (voiceRestCues) {
          const nextEx = exercises[safeExIdx] ?? exercises.find((e) => e.sets.some((s) => !s.completed));
          const nextSet = nextEx?.sets.find((s) => !s.completed);
          const nextName = nextEx?.snapshot?.name ?? "";
          const nextUnit = nextEx?.weightUnit === "lb" ? "磅" : "公斤";
          const cueText =
            nextName && nextSet
              ? nextEx?.snapshot?.mode === "timed"
                ? `休息结束，下一组 ${nextName}，${nextSet.seconds} 秒`
                : nextSet.weight > 0
                  ? `休息结束，下一组 ${nextName}，${nextSet.weight} ${nextUnit} ${nextSet.reps} 次`
                  : `休息结束，下一组 ${nextName}，${nextSet.reps} 次`
              : "休息结束，准备下一组";
          speakCue(cueText, { enabled: true });
        }
        if (notifyRestPref && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification("铁记 · 组间休息结束", { body: "准备下一组训练", tag: "ironlog-rest" });
          } catch {}
        }
      }
      setRest(null);
    }
  }, [rest, nowMs, audio, notifyRestPref, voiceRestCues, exercises, safeExIdx]);

  // Isometric / timed set countdown with 3-2-1 cue and auto-complete
  useEffect(() => {
    if (!timedSetClock) return;
    const leftSec = Math.ceil((timedSetClock.endAt - nowMs) / 1000);
    if (leftSec >= 1 && leftSec <= 3 && timedCueSpokenSecRef.current !== leftSec) {
      timedCueSpokenSecRef.current = leftSec;
      if (voiceRestCues) speakCue(String(leftSec), { enabled: true });
      else audio.play(false);
    }
    if (nowMs >= timedSetClock.endAt) {
      const doneClock = timedSetClock;
      setTimedSetClock(null);
      timedCueSpokenSecRef.current = null;
      audio.play(true);
      if (voiceRestCues) speakCue("计时完成", { enabled: true });
      triggerHaptic("success");
      setExercises((prev) =>
        prev.map((ex, ei) =>
          ei !== doneClock.exIdx
            ? ex
            : {
                ...ex,
                sets: ex.sets.map((s, si) =>
                  si === doneClock.setIdx
                    ? { ...s, seconds: Math.max(s.seconds, doneClock.targetSeconds), completed: true, completedAt: new Date().toISOString() }
                    : s,
                ),
              },
        ),
      );
    }
  }, [timedSetClock, nowMs, audio, voiceRestCues]);

  // Wake lock guard (disabled in historical edit & past-date backfill mode)
  useEffect(() => {
    if (isHistoricalEdit || isBackfillMode || !("wakeLock" in navigator)) return;
    const mgr = keepWorkoutScreenAwake(() => screenAwakePref, setWakeActive);
    mgr.update();
    return () => mgr.stop();
  }, [isHistoricalEdit, isBackfillMode, screenAwakePref]);

  // Fetch previous-session reference sets, all-time PR baselines, and exercise demo GIF media
  const exIdsKey = exercises.map((e) => `${e.exerciseId}:${e.snapshot?.mode ?? "reps"}`).join(",");
  useEffect(() => {
    if (!exercises.length || !date) return;
    let active = true;
    const uniqueEntries = [
      ...new Map(exercises.map((e) => [e.exerciseId, { id: e.exerciseId, mode: e.snapshot?.mode ?? "reps" }])).values(),
    ];
    const reqBody = {
      date,
      startedAt: sessionStart,
      ...(record?.id ? { workoutId: record.id } : {}),
      exercises: uniqueEntries,
    };
    void apiFetch<ExerciseReferenceEntry[]>("/api/web/exercise-references", {
      method: "POST",
      body: reqBody,
    })
      .then((list) => {
        if (!active) return;
        const nextRefs = new Map(list.map((entry) => [entry.id, entry.sets]));
        const nextDates = new Map<string, string>();
        for (const entry of list) {
          if (entry.date) nextDates.set(entry.id, entry.date);
        }
        setRefsByExId(nextRefs);
        setRefDatesByExId(nextDates);

        // Auto-prefill working sets with last session's exact per-set weight & reps on fresh open
        if (!isHistoricalEdit && !record && !restoredFromDraftRef.current && autoPrefillLast && !prefs.deloadMode) {
          setExercises((prev) => {
            let changed = false;
            const next = prev.map((row) => {
              if (autoPrefilledExIdsRef.current.has(row.id) || touchedExIdsRef.current.has(row.id)) {
                return row;
              }
              if (row.sets.some((s) => s.completed)) return row;
              const refList = nextRefs.get(row.exerciseId);
              const validList = refList?.filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [];
              if (!validList.length) return row;
              autoPrefilledExIdsRef.current.add(row.id);
              const rowIsTimed = row.snapshot?.mode === "timed";
              let workIdx = 0;
              const nextSets = row.sets.map((s) => {
                if (s.type === "warmup") return s;
                const ref = validList[workIdx] ?? validList.at(-1);
                workIdx++;
                if (!ref) return s;
                if (rowIsTimed) {
                  if (ref.seconds > 0 && ref.seconds !== s.seconds) {
                    changed = true;
                    return { ...s, seconds: ref.seconds };
                  }
                  return s;
                }
                const nextW = ref.weight;
                const nextR = ref.reps || s.reps;
                if (nextW !== s.weight || nextR !== s.reps) {
                  changed = true;
                  return { ...s, weight: nextW, reps: nextR };
                }
                return s;
              });
              return { ...row, sets: nextSets };
            });
            return changed ? next : prev;
          });
        }
      })
      .catch(() => {});

    void apiFetch<LiveExercisePrBaseline[]>("/api/web/exercise-prs", {
      method: "POST",
      body: reqBody,
    })
      .then((list) => {
        if (!active || !Array.isArray(list)) return;
        setPrsByExId(new Map(list.map((entry) => [entry.exerciseId, entry])));
      })
      .catch(() => {});

    void resolveCatalogueMap(uniqueEntries.map((e) => e.id))
      .then((catMap) => {
        if (!active) return;
        const nextMedia = new Map<string, string>();
        for (const [id, ex] of catMap.entries()) {
          const url = safeExerciseMediaUrl(ex.illustration?.gifPath ?? ex.illustration?.frames?.[0]?.path);
          if (url) nextMedia.set(id, url);
        }
        if (nextMedia.size) {
          setMediaByExId((prev) => {
            const merged = new Map(prev);
            for (const [id, url] of nextMedia.entries()) merged.set(id, url);
            return merged;
          });
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [exIdsKey, date, record?.id, sessionStart]);

  const openQuickHistory = (exerciseId: string, name: string, fallbackMode: ExerciseMode) => {
    triggerHaptic("light");
    setHistoryModalEx({ id: exerciseId, name, loading: true, mode: fallbackMode, sessions: [] });
    void apiFetch<{
      exerciseId: string;
      name: string;
      mode: ExerciseMode;
      sessions: Array<{
        workoutId: string;
        date: string;
        title: string;
        topWeight: number | null;
        topReps: number | null;
        estimated1rm: number | null;
        bestSeconds: number | null;
        workSets: number;
        volume: number;
        sets: Array<{ type: string; weight: number; reps: number; seconds: number; rir: number | null }>;
      }>;
    }>(`/api/web/exercise-history/${encodeURIComponent(exerciseId)}`)
      .then((res) => {
        setHistoryModalEx((cur) =>
          cur && cur.id === exerciseId
            ? {
                id: exerciseId,
                name: res.name || name,
                mode: res.mode ?? fallbackMode,
                loading: false,
                sessions: (res.sessions ?? []).slice(0, 8),
              }
            : cur,
        );
      })
      .catch(() => {
        setHistoryModalEx((cur) =>
          cur && cur.id === exerciseId ? { ...cur, loading: false, sessions: [] } : cur,
        );
      });
  };

  // Fetch persistent per-exercise training cues/notes
  useEffect(() => {
    setNotesByExId({});
    setEditingNoteExId(null);
    setNoteDraft("");
    if (!userId) return;
    let active = true;
    void apiFetch<Record<string, { note: string }>>("/api/web/exercise-notes")
      .then((map) => {
        if (active && map && typeof map === "object") setNotesByExId(map);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);

  const handleSaveInlineNote = async (rowId: string, exerciseId: string) => {
    if (savingNote) return;
    setSavingNote(true);
    try {
      const res = await apiFetch<{ note: string }>(`/api/web/exercise-notes/${encodeURIComponent(exerciseId)}`, {
        method: "PUT",
        body: { note: noteDraft.trim() },
      });
      setNotesByExId((prev) => {
        const next = { ...prev };
        if (res.note) next[exerciseId] = { note: res.note };
        else delete next[exerciseId];
        return next;
      });
      setEditingNoteExId((cur) => (cur === rowId ? null : cur));
      notify(res.note ? "动作要点已保存" : "动作要点已清除");
    } catch (err) {
      notify((err as Error)?.message || "保存动作要点失败");
    } finally {
      setSavingNote(false);
    }
  };

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

  const appendExercises = (pickedList: CatalogueExercise[]) => {
    if (!pickedList.length) return;
    const addedRows: Array<{ rowId: string; ex: CatalogueExercise; isTimedEx: boolean; needsRef: boolean }> = [];
    const buildInitialSets = (isTimedEx: boolean, refList?: ExerciseReferenceEntry["sets"]) => {
      const validList = refList?.filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [];
      const targetCount = Math.max(3, validList.length);
      return Array.from({ length: Math.min(6, targetCount) }, (_, idx) => {
        const ref = validList[idx] ?? validList.at(-1);
        if (ref && autoPrefillLast) {
          return defaultSet(
            isTimedEx ? 0 : ref.weight ?? 0,
            isTimedEx ? 0 : ref.reps || 8,
            isTimedEx ? ref.seconds || 30 : 0,
          );
        }
        return defaultSet(0, isTimedEx ? 0 : 8, isTimedEx ? 30 : 0);
      });
    };

    const newExercises: WorkoutExercise[] = pickedList.map((ex) => {
      const rowId = newId();
      const isTimedEx = ex.mode === "timed";
      const cachedRef = autoPrefillLast ? refsByExId.get(ex.id) : undefined;
      addedRows.push({ rowId, ex, isTimedEx, needsRef: Boolean(autoPrefillLast && !cachedRef) });
      return {
        id: rowId,
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
        sets: buildInitialSets(isTimedEx, cachedRef),
      };
    });

    setExercises((prev) => {
      setActiveExIdx(prev.length);
      return [...prev, ...newExercises];
    });
    if (pickedList.length > 1) {
      notify(`已连续加入 ${pickedList.length} 个训练动作`);
    }

    const toFetch = addedRows.filter((r) => r.needsRef);
    if (toFetch.length) {
      const activeId = savedRecordRef.current?.id ?? record?.id;
      void apiFetch<ExerciseReferenceEntry[]>("/api/web/exercise-references", {
        method: "POST",
        body: {
          date,
          startedAt: sessionStart,
          ...(activeId ? { workoutId: activeId } : {}),
          exercises: toFetch.map((r) => ({ id: r.ex.id, mode: r.ex.mode ?? "reps" })),
        },
      })
        .then((list) => {
          const byId = new Map(list.map((entry) => [entry.id, entry.sets]));
          setRefsByExId((prev) => {
            const next = new Map(prev);
            for (const [id, sets] of byId.entries()) {
              if (sets?.length) next.set(id, sets);
            }
            return next;
          });
          setExercises((prev) =>
            prev.map((row) => {
              const meta = toFetch.find((r) => r.rowId === row.id);
              if (!meta) return row;
              const foundSets = byId.get(meta.ex.id);
              if (!foundSets?.length) return row;
              const untouched = row.sets.every(
                (s) => !s.completed && s.weight === 0 && (meta.isTimedEx ? s.seconds === 30 : s.reps === 8),
              );
              if (!untouched) return row;
              return { ...row, sets: buildInitialSets(meta.isTimedEx, foundSets) };
            }),
          );
        })
        .catch(() => {});
    }
  };

  const openAddExercisePicker = () => {
    triggerHaptic("light");
    openModal({
      title: "添加训练动作",
      layout: "exercise",
      wide: true,
      content: (
        <ExercisePickerModal
          title="添加训练动作"
          multiple
          onSelect={(ex: CatalogueExercise) => appendExercises([ex])}
          onSelectMany={(list: CatalogueExercise[]) => appendExercises(list)}
        />
      ),
    });
  };

  const applySwapExercise = (rowIdx: number, ex: CatalogueExercise, opts?: { fromBackup?: boolean }) => {
    const prevRow = exercises[rowIdx];
    const prevMode = prevRow?.snapshot?.mode ?? "reps";
    const nextIsTimed = ex.mode === "timed";
    const modeChanged = prevMode !== ex.mode;
    const rowId = prevRow?.id ?? "";
    const cachedRef = autoPrefillLast ? refsByExId.get(ex.id) : undefined;
    const validCached = cachedRef?.filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [];

    setExercises((prev) =>
      prev.map((row, i) => {
        if (i !== rowIdx) return row;
        const nextSets = row.sets.map((s, sIdx) => {
          if (s.completed) return s;
          const ref = validCached[sIdx] ?? validCached.at(-1);
          if (ref && autoPrefillLast) {
            return {
              ...s,
              weight: nextIsTimed ? 0 : ref.weight ?? 0,
              reps: nextIsTimed ? 0 : ref.reps || 8,
              seconds: nextIsTimed ? ref.seconds || 30 : 0,
            };
          }
          if (modeChanged) {
            return {
              ...s,
              weight: nextIsTimed ? 0 : prevMode === "timed" ? 0 : s.weight,
              reps: nextIsTimed ? 0 : s.reps || 8,
              seconds: nextIsTimed ? s.seconds || 30 : 0,
            };
          }
          return s;
        });
        return {
          ...row,
          exerciseId: ex.id,
          ...(opts?.fromBackup
            ? {
                backupExerciseId: row.exerciseId,
                backupExerciseName: row.snapshot?.name ?? row.exerciseId,
              }
            : {}),
          snapshot: {
            name: ex.name,
            muscle: ex.muscle,
            equipment: ex.equipment,
            mode: ex.mode,
            volumeMultiplier: ex.volumeMultiplier ?? 1,
          },
          sets: nextSets,
        };
      }),
    );

    if (autoPrefillLast && !validCached.length && rowId) {
      const activeId = savedRecordRef.current?.id ?? record?.id;
      void apiFetch<ExerciseReferenceEntry[]>("/api/web/exercise-references", {
        method: "POST",
        body: {
          date,
          startedAt: sessionStart,
          ...(activeId ? { workoutId: activeId } : {}),
          exercises: [{ id: ex.id, mode: ex.mode ?? "reps" }],
        },
      })
        .then((list) => {
          const found = list.find((entry) => entry.id === ex.id);
          const valid = found?.sets?.filter((r): r is NonNullable<typeof r> => Boolean(r)) ?? [];
          if (!valid.length) return;
          setRefsByExId((prev) => {
            const next = new Map(prev);
            next.set(ex.id, found!.sets);
            return next;
          });
          setExercises((prev) =>
            prev.map((row) => {
              if (row.id !== rowId || row.exerciseId !== ex.id) return row;
              return {
                ...row,
                sets: row.sets.map((s, sIdx) => {
                  if (s.completed) return s;
                  const ref = valid[sIdx] ?? valid.at(-1);
                  if (!ref) return s;
                  return {
                    ...s,
                    weight: nextIsTimed ? 0 : ref.weight ?? 0,
                    reps: nextIsTimed ? 0 : ref.reps || 8,
                    seconds: nextIsTimed ? ref.seconds || 30 : 0,
                  };
                }),
              };
            }),
          );
        })
        .catch(() => {});
    }

    notify(opts?.fromBackup ? `已切换至备选动作「${ex.name}」` : `已替换为「${ex.name}」`);
  };

  const swapToBackupExercise = async (rowIdx: number) => {
    const row = exercises[rowIdx];
    if (!row?.backupExerciseId) return;
    triggerHaptic("light");
    try {
      const res = await apiFetch<{ exercise: CatalogueExercise }>(
        `/api/catalogue/exercises/${encodeURIComponent(row.backupExerciseId)}`,
      );
      if (res?.exercise) {
        applySwapExercise(rowIdx, res.exercise, { fromBackup: true });
      }
    } catch {
      notify("读取备选动作失败，请改用「替换动作」");
    }
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
          onSelect={(ex: CatalogueExercise) => applySwapExercise(rowIdx, ex)}
        />
      ),
    });
  };

  const updateSet = (exIdx: number, setIdx: number, updater: (cur: WorkoutSet) => WorkoutSet) => {
    setExercises((prev) =>
      prev.map((row, i) => {
        if (i !== exIdx) return row;
        touchedExIdsRef.current.add(row.id);
        return { ...row, sets: row.sets.map((s, j) => (j === setIdx ? updater(s) : s)) };
      }),
    );
  };

  const updateSetAndCascade = (
    exIdx: number,
    setIdx: number,
    patchOrFn: SetFieldPatch | ((cur: WorkoutSet) => SetFieldPatch),
  ) => {
    setExercises((prev) =>
      prev.map((row, i) => {
        if (i !== exIdx) return row;
        touchedExIdsRef.current.add(row.id);
        const cur = row.sets[setIdx];
        if (!cur) return row;
        const patch = typeof patchOrFn === "function" ? patchOrFn(cur) : patchOrFn;
        return { ...row, sets: applySetFieldUpdate(row.sets, setIdx, patch, { autoSyncSubsequent }) };
      }),
    );
  };

  const syncRemainingSets = (exIdx: number) => {
    const row = exercises[exIdx];
    if (!row) return;
    const src =
      [...row.sets].reverse().find((s) => s.completed && s.type !== "warmup") ??
      row.sets.find((s) => !s.completed && s.type !== "warmup" && (s.weight > 0 || s.reps > 0 || s.seconds > 0)) ??
      row.sets.find((s) => !s.completed && s.type !== "warmup");
    const srcIdx = src ? row.sets.indexOf(src) : -1;
    if (!src || srcIdx < 0) return;
    const nextSets = applySetFieldUpdate(
      row.sets,
      srcIdx,
      { weight: src.weight, reps: src.reps, seconds: src.seconds },
      { autoSyncSubsequent: true },
    );
    triggerHaptic("light");
    setExercises((prev) => prev.map((ex, i) => (i === exIdx ? { ...ex, sets: nextSets } : ex)));
    notify(`已将 ${src.weight > 0 ? `${fmt(src.weight)} kg × ` : ""}${src.reps} 同步至后续未完成组`);
  };

  const toggleSetComplete = (exIdx: number, setIdx: number, nextCompleted: boolean) => {
    const row = exercises[exIdx];
    const targetSet = row?.sets[setIdx];
    if (!row || !targetSet) return;

    const prHit =
      nextCompleted && !isHistoricalEdit
        ? checkSetBeatsPrBaseline(
            { ...targetSet, completed: true },
            row.snapshot?.mode ?? "reps",
            row.weightUnit,
            prsByExId.get(row.exerciseId),
          )
        : null;

    // Hardware tactile & audio unlock MUST run synchronously inside user click handler
    triggerHaptic(prHit ? "pr" : nextCompleted ? "success" : "light");
    if (prHit) {
      notify(
        prHit === "weight"
          ? "🏆 破纪录！已刷新本动作最大负重 PR"
          : prHit === "oneRepMax"
            ? "🏆 破纪录！已刷新本动作估算 1RM PR"
            : prHit === "hold"
              ? "🏆 破纪录！已刷新最长保持时长 PR"
              : "🏆 破纪录！已刷新最小辅助重量 PR",
      );
    }

    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    const ssTransition = nextCompleted
      ? resolveSupersetTransition(exercises, exIdx, setIdx)
      : { inSuperset: false, shouldStartRest: false, nextExerciseIdx: null, reason: "single" as const };

    if (nextCompleted && !isHistoricalEdit && !isBackfillMode && autoStartRestTimer && ssTransition.shouldStartRest) {
      const nextSet = row.sets[setIdx + 1];
      const hasCustomRest =
        targetSet.restAfterSeconds != null && Number.isFinite(targetSet.restAfterSeconds);
      const seconds = hasCustomRest
        ? Math.max(0, Math.min(900, Math.round(targetSet.restAfterSeconds!)))
        : resolveSetRestSeconds({
            setType: targetSet.type,
            nextSetType: nextSet?.type ?? null,
            defaultRestSeconds: row.restSeconds ?? goals?.restSeconds ?? 90,
            warmupRestSeconds,
          }).seconds;
      if (seconds > 0) {
        audio.unlock();
        restAlarmFiredForRef.current = null;
        setRest(createRestTimer(seconds, targetSet.id));
      }
    }

    updateSet(exIdx, setIdx, (s) => ({
      ...s,
      completed: nextCompleted,
      ...(nextCompleted ? { completedAt: new Date().toISOString() } : { completedAt: undefined }),
    }));

    if (
      nextCompleted &&
      !isHistoricalEdit &&
      autoAdvanceExercise &&
      ssTransition.inSuperset &&
      ssTransition.nextExerciseIdx !== null
    ) {
      const targetIdx = ssTransition.nextExerciseIdx;
      const targetEx = exercises[targetIdx]!;
      const targetId = targetEx.id;
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        setActiveExIdx(targetIdx);
        if (viewMode === "single") {
          workoutScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          cardRefs.current[targetId]?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        notify(
          ssTransition.reason === "next_partner"
            ? `超级组 ${row.supersetGroup}：免休切换至「${targetEx.snapshot?.name ?? "搭档动作"}」`
            : `超级组 ${row.supersetGroup} 本轮完成 · 休息后回到「${targetEx.snapshot?.name ?? "首项动作"}」`,
        );
      }, 280);
      return;
    }

    if (
      nextCompleted &&
      !isHistoricalEdit &&
      !isBackfillMode &&
      autoAdvanceExercise &&
      row.sets.every((s, idx) => idx === setIdx || s.completed)
    ) {
      const afterIdx = exercises.findIndex((ex, idx) => idx > exIdx && ex.sets.some((s) => !s.completed));
      const nextIdx =
        afterIdx >= 0
          ? afterIdx
          : exercises.findIndex((ex, idx) => idx < exIdx && ex.sets.some((s) => !s.completed));
      const advanceDelayMs = resolveAutoAdvanceDelayMs(Boolean(prHit));
      if (nextIdx >= 0) {
        const targetEx = exercises[nextIdx]!;
        const targetId = targetEx.id;
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          setActiveExIdx(nextIdx);
          if (viewMode === "single") {
            workoutScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
            notify(`已完成本动作，切换至「${targetEx.snapshot?.name ?? "下一项"}」`);
          } else {
            cardRefs.current[targetId]?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, advanceDelayMs);
      } else if (exercises.every((ex, idx) => idx === exIdx || ex.sets.every((s) => s.completed))) {
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          notify("全部动作已完成，可点击底部「完成并结束训练」");
        }, advanceDelayMs);
      }
    }
  };

  const addWarmupSets = (exIdx: number) => {
    const row = exercises[exIdx];
    if (!row) return;
    const isBarbell = row.snapshot?.equipment === "barbell";
    const firstWorkWeight = row.sets.find((s) => s.type !== "warmup" && s.weight > 0)?.weight ?? 60;
    const planned = buildWarmupSetsPlan(firstWorkWeight, isBarbell, barWeight, enabledPlates, warmupScheme);
    const warmups: WorkoutSet[] = planned.map((step) => ({
      id: newId(),
      type: "warmup",
      weight: step.weight,
      reps: step.reps,
      seconds: 0,
      completed: false,
      rir: null,
    }));
    triggerHaptic("light");
    setExercises((prev) =>
      prev.map((r, i) => (i === exIdx ? { ...r, sets: [...warmups, ...r.sets] } : r)),
    );
    notify(`已加入 ${warmups.length} 组递增热身`);
  };

  const buildWorkoutPayload = (
    targetStatus: "active" | "completed",
    options?: { exercisesOverride?: WorkoutExercise[] },
  ) => {
    const curRec = savedRecordRef.current;
    const cleanTitle = (title.trim() || "自由训练").slice(0, 120);
    const cleanDate = ISO_DATE_RE.test(date) ? date : todayStr;
    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const nowIso = nowDate.toISOString();
    const cleanStartedAt = normalizeIsoTimestamp(sessionStart, nowIso) ?? nowIso;
    const startMs = Date.parse(cleanStartedAt);

    const pausedRaw = pauseAt(timing, nowMs);
    const parsedManualMin = manualDurationMin.trim() === "" ? null : Number(manualDurationMin);
    const hasManualDuration =
      parsedManualMin != null && Number.isFinite(parsedManualMin) && parsedManualMin > 0 && parsedManualMin <= 720;
    const rawElapsed = hasManualDuration ? Math.round(parsedManualMin * 60) : Number(pausedRaw.elapsedSeconds);
    const pausedTiming: WorkoutTiming = {
      elapsedSeconds: Number.isFinite(rawElapsed) ? Math.max(0, Math.round(rawElapsed)) : 0,
      runningSince: normalizeIsoTimestamp(pausedRaw.runningSince, null as unknown as string) ?? null,
    };

    let endedAt: string | null = null;
    if (targetStatus === "completed") {
      const candidateEndedAt = hasManualDuration
        ? new Date(startMs + pausedTiming.elapsedSeconds * 1000).toISOString()
        : curRec?.data.endedAt && cleanDate === curRec.data.date
          ? curRec.data.endedAt
          : cleanDate === todayStr
            ? new Date(Math.max(startMs, nowMs)).toISOString()
            : new Date(startMs + pausedTiming.elapsedSeconds * 1000).toISOString();
      const parsedEndMs = Date.parse(candidateEndedAt);
      endedAt = new Date(
        Math.max(startMs, Number.isFinite(parsedEndMs) ? parsedEndMs : nowMs),
      ).toISOString();
    }

    const resting = targetStatus === "active" && rest?.pausedLeftMs == null && (rest?.end ?? 0) > nowMs;
    const sourceExercises = (options?.exercisesOverride ?? exercises).slice(0, 100);
    const usedIds = new Set<string>();
    const takeUniqueId = (candidate: unknown): string => {
      if (isValidRecordId(candidate) && !usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
      let next = newId();
      while (usedIds.has(next)) next = newId();
      usedIds.add(next);
      return next;
    };

    const sanitizedExercises: WorkoutExercise[] = sourceExercises
      .filter((ex) => isValidRecordId(ex?.exerciseId))
      .map((ex) => {
        const cleanRest = Number(ex.restSeconds ?? 90);
        const rawTargetIdx = ex.targetIndex == null ? NaN : Number(ex.targetIndex);
        const cleanTargetIdx =
          Number.isFinite(rawTargetIdx) && rawTargetIdx >= 0 && rawTargetIdx <= 99
            ? Math.round(rawTargetIdx)
            : null;
        const cleanSuperset =
          typeof ex.supersetGroup === "string" && ex.supersetGroup.trim()
            ? ex.supersetGroup.trim().slice(0, 16)
            : null;
        return {
          id: takeUniqueId(ex.id),
          exerciseId: ex.exerciseId,
          targetIndex: cleanTargetIdx,
          supersetGroup: cleanSuperset,
          ...(ex.weightUnit === "lb" || ex.weightUnit === "kg" ? { weightUnit: ex.weightUnit } : {}),
          restSeconds: Number.isFinite(cleanRest) ? Math.max(0, Math.min(900, Math.round(cleanRest))) : 90,
          snapshot: sanitizeExerciseSnapshot(ex.snapshot),
          sets: (Array.isArray(ex.sets) ? ex.sets : []).slice(0, 100).map((s) => {
            const rawWeight = Number(s.weight);
            const rawReps = Number(s.reps);
            const rawSeconds = Number(s.seconds);
            const rawRir = s.rir == null ? NaN : Number(s.rir);
            const cleanCompleted = Boolean(s.completed);
            const cleanCompletedAt = cleanCompleted ? normalizeIsoTimestamp(s.completedAt) : undefined;
            const cleanNote = typeof s.note === "string" ? s.note.trim().slice(0, 200) : "";
            const rawRestAfter = s.restAfterSeconds == null ? NaN : Number(s.restAfterSeconds);
            const cleanRestAfter = Number.isFinite(rawRestAfter)
              ? Math.max(0, Math.min(900, Math.round(rawRestAfter)))
              : undefined;
            return {
              id: takeUniqueId(s.id),
              type: VALID_SET_TYPES.has(s.type) ? s.type : "normal",
              weight: Number.isFinite(rawWeight) ? Math.max(0, Math.min(100000, rawWeight)) : 0,
              reps: Number.isFinite(rawReps) ? Math.max(0, Math.min(1000, Math.round(rawReps))) : 0,
              seconds: Number.isFinite(rawSeconds) ? Math.max(0, Math.min(86400, Math.round(rawSeconds))) : 0,
              completed: cleanCompleted,
              ...(cleanCompletedAt ? { completedAt: cleanCompletedAt } : {}),
              rir: Number.isFinite(rawRir) ? Math.max(0, Math.min(10, Math.round(rawRir))) : null,
              ...(cleanRestAfter != null ? { restAfterSeconds: cleanRestAfter } : {}),
              ...(cleanNote ? { note: cleanNote } : {}),
            };
          }),
        };
      });

    const curMeta = sessionMetaRef.current;
    const rawPlanVersion = curRec?.data.planVersion ?? curMeta.planVersion;
    const planVersion =
      typeof rawPlanVersion === "number" && Number.isFinite(rawPlanVersion) && rawPlanVersion > 0
        ? Math.round(rawPlanVersion)
        : null;
    const rawPlanId = curRec?.data.planId ?? curMeta.planId;
    const rawRoutineId = curRec?.data.routineId ?? curMeta.routineId;
    const rawPromptSource = curRec?.data.rawPrompt ?? curMeta.rawPrompt;
    const rawAdjustments = curRec?.data.adjustments ?? curMeta.adjustments;

    const workoutData: WorkoutData = {
      title: cleanTitle,
      date: cleanDate,
      startedAt: cleanStartedAt,
      endedAt,
      status: targetStatus,
      ...(hasManualDuration
        ? { durationUnknown: false }
        : typeof curRec?.data.durationUnknown === "boolean"
          ? { durationUnknown: curRec.data.durationUnknown }
          : {}),
      notes: notes.trim().slice(0, 4000),
      feeling: feeling && VALID_FEELINGS.has(feeling) ? feeling : null,
      source: normalizeWorkoutSource(curRec?.data.source ?? curMeta.source),
      rawPrompt: typeof rawPromptSource === "string" ? rawPromptSource.slice(0, 4000) : "",
      planId: isValidRecordId(rawPlanId) ? rawPlanId : null,
      planVersion,
      routineId: isValidRecordId(rawRoutineId) ? rawRoutineId : null,
      targetSnapshot: sanitizeTargetSnapshot(curRec?.data.targetSnapshot ?? curMeta.targetSnapshot),
      adjustments: Array.isArray(rawAdjustments) ? rawAdjustments.slice(0, 100) : [],
      exercises: sanitizedExercises,
      ...(isHistoricalEdit && !hadTiming ? {} : { timing: pausedTiming }),
      restEndsAt: resting && rest && Number.isFinite(rest.end) ? Math.round(rest.end) : null,
      restStartedAt: resting && rest && Number.isFinite(rest.start) ? Math.max(0, Math.round(rest.start)) : null,
    };

    const body = {
      opId: newId(),
      id: isValidRecordId(workoutId) ? workoutId : newId(),
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

  const submitWorkout = async (
    targetStatus: "active" | "completed",
    options?: { completeAllPending?: boolean },
  ) => {
    if (savingRef.current) return;
    if (!exercises.length && targetStatus === "completed") {
      setError("请至少添加一个动作后再结束训练");
      return;
    }

    let exercisesForSave = exercises;
    if (options?.completeAllPending) {
      const doneAt = new Date().toISOString();
      exercisesForSave = exercises.map((ex) => ({
        ...ex,
        sets: ex.sets.map((s) => (s.completed ? s : { ...s, completed: true, completedAt: s.completedAt ?? doneAt })),
      }));
      setExercises(exercisesForSave);
    }

    const curRec = savedRecordRef.current;
    const payloadPack = buildWorkoutPayload(targetStatus, { exercisesOverride: exercisesForSave });

    savingRef.current = true;
    setSaving(true);
    setError("");

    try {
      const res = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
        method: "POST",
        body: payloadPack.body,
      });
      clearDraft();
      triggerHaptic("success");
      bumpDataEpoch();
      const saved: RecordEnvelope<WorkoutData> = res.record ?? {
        id: workoutId,
        kind: "workout",
        version: (curRec?.version ?? 0) + 1,
        deleted: false,
        updatedAt: new Date().toISOString(),
        data: payloadPack.workoutData,
      };
      savedRecordRef.current = saved;
      setSavedRecord(saved);
      if (targetStatus === "completed" && syncSourceOnFinish && canSyncSource) {
        try {
          const syncRes = await apiFetch<{ syncedKind?: "plan" | "template"; syncedRoutineName?: string }>(
            "/api/web/plans/sync-routine",
            {
              method: "POST",
              body: { workoutId: saved.id },
            },
          );
          bumpDataEpoch();
          notify(
            `训练已保存，并已同步改动至${syncRes.syncedKind === "template" ? "模板" : "计划"}「${syncRes.syncedRoutineName || title}」`,
          );
        } catch (syncErr) {
          notify(`训练已保存，但同步回原${syncTargetLabel}失败：${(syncErr as Error)?.message || "请稍后在复盘页重试"}`);
        }
      }
      if (targetStatus === "completed" && onCompleted) {
        onCompleted(saved);
      } else {
        closeAllModals();
        if (!(targetStatus === "completed" && syncSourceOnFinish && canSyncSource)) {
          notify(targetStatus === "active" ? "训练草稿已保存至云端" : "训练已保存");
        }
      }
    } catch (err) {
      if (isNetworkError(err) && userId) {
        const storage = getOfflineStorage();
        const queued = enqueueMutation(storage, userId, {
          opId: payloadPack.body.opId,
          path: "/api/records",
          method: "POST",
          body: payloadPack.body,
          label: `训练：${payloadPack.cleanTitle}`,
        });
        if (queued == null) {
          setError("浏览器无法暂存离线记录。请保留此页面，联网后重新保存");
          return;
        }
        refreshPendingCount(userId);
        clearDraft();
        closeAllModals();
        notify("离线状态：训练已暂存，联网后自动同步");
        return;
      }
      setError((err as { status?: number })?.status === 409
        ? "这场训练已在其他设备更新。请核对该设备的记录后再保存，本机输入仍保留"
        : (err as Error)?.message || "保存训练失败");
    } finally {
      savingRef.current = false;
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
        clearDraft();
        bumpDataEpoch();
        closeAllModals();
        notify("已删除训练记录");
      },
    });
  };

  const restInfo = rest ? restProgress(rest, nowMs) : null;
  const isPausedClock = timing.runningSince == null;
  const onIos = isAppleMobileDevice();
  const appleEndUrl = buildAppleHubActionUrl("end", prefs);

  const liveMuscleProgress = useMemo(() => summarizeWorkoutMuscleSets(exercises), [exercises]);
  const liveMuscleScores = useMemo(() => {
    const map: Partial<Record<MuscleKey, number>> = {};
    for (const item of liveMuscleProgress) {
      map[item.muscle] = item.completedSets > 0 ? Math.max(0.45, item.ratio) : 0.25;
    }
    return map;
  }, [liveMuscleProgress]);

  const openMergeRoutineOverlay = async () => {
    setOpenMenu(false);
    setMergeRoutineOpen(true);
    setLoadingMergeOptions(true);
    try {
      const sched = await apiFetch<ScheduleResponse>("/api/web/schedule");
      const opts: Array<{ key: string; title: string; source: string; exercises: PlannedExercise[] }> = [
        ...(sched.activePlan?.routines ?? []).map((r) => ({
          key: `plan:${r.id}`,
          title: r.name,
          source: "当前计划",
          exercises: r.exercises,
        })),
        ...(sched.templates ?? []).map((t) => ({
          key: `tpl:${t.id}`,
          title: t.name,
          source: "训练模板",
          exercises: t.exercises,
        })),
      ];
      setMergeOptions(opts);
    } catch {
      setMergeOptions([]);
      notify("加载可合并训练日失败");
    } finally {
      setLoadingMergeOptions(false);
    }
  };

  const handleMergeRoutine = async (opt: { title: string; exercises: PlannedExercise[] }) => {
    if (!opt.exercises.length) return;
    try {
      const catMap = await resolveCatalogueMap(opt.exercises.map((e) => e.exerciseId));
      setExercises((prev) =>
        appendRoutineExercises(
          prev,
          opt.exercises,
          (exId) => {
            const ex = catMap.get(exId);
            return ex
              ? {
                  name: ex.name,
                  muscle: ex.muscle,
                  equipment: ex.equipment,
                  mode: ex.mode,
                  volumeMultiplier: ex.volumeMultiplier ?? 1,
                }
              : null;
          },
          newId,
        ),
      );
      setMergeRoutineOpen(false);
      triggerHaptic("light");
      notify(`已将「${opt.title}」的 ${opt.exercises.length} 个动作合并到本次训练`);
    } catch {
      notify("合并训练日失败");
    }
  };

  const toggleExerciseWeightUnit = (exIdx: number, nextUnit: WeightUnit) => {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const prevUnit: WeightUnit = ex.weightUnit ?? "kg";
        if (prevUnit === nextUnit) return ex;
        const convertedSets = ex.sets.map((s) => {
          if (!(s.weight > 0)) return s;
          const weightKg = weightToKg(s.weight, prevUnit);
          const rawNext = kgToUnit(weightKg, nextUnit);
          const step = nextUnit === "lb" ? 2.5 : 0.5;
          const rounded = Math.round(rawNext / step) * step;
          return { ...s, weight: round2(rounded) };
        });
        return { ...ex, weightUnit: nextUnit, sets: convertedSets };
      }),
    );
    triggerHaptic("light");
    notify(`已切换为 ${nextUnit}（统计自动统一折算 kg）`);
  };

  const sourceSyncDiff = useMemo(
    () => diffWorkoutAgainstSourceRoutine(exercises, sessionMetaRef.current.targetSnapshot),
    [exercises],
  );
  const syncTargetLabel = sessionMetaRef.current.planId ? "计划训练日" : "训练模板";
  const canSyncSource = Boolean(
    !isHistoricalEdit &&
      (sessionMetaRef.current.planId || sessionMetaRef.current.routineId) &&
      sourceSyncDiff.hasChanges,
  );

  const coachTargetRow = coachExIdx != null ? exercises[coachExIdx] ?? null : null;
  const coachAdvice = coachTargetRow ? buildCoachQuickAdvice(coachScenario, coachTargetRow, weightStepKg) : null;

  return (
    <div
      className={`dialog-form workout-form${showRir ? " show-rir" : ""}${!isHistoricalEdit ? " is-live" : ""} layout-${workoutLayout}`}
    >
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
                title="收起面板，保留悬浮计时与休息倒计时"
                onClick={handleMinimize}
              >
                收起
              </button>
              <button
                type="button"
                className="workout-finish-pill"
                disabled={saving}
                onClick={() => {
                  triggerHaptic("light");
                  setError("");
                  setFinishPanelOpen(true);
                }}
              >
                结束
              </button>
            </div>
          </div>

          <div className="workout-progress-strip">
            <progress value={doneSets} max={Math.max(1, totalSets)} />
            {liveMuscleProgress.length > 0 ? (
              <button
                type="button"
                className="workout-muscle-btn"
                title="查看本次训练练到哪些肌群"
                onClick={() => {
                  triggerHaptic("light");
                  setMuscleProgressOpen(true);
                }}
              >
                肌群进度 ({liveMuscleProgress.length})
              </button>
            ) : null}
            <span className="workout-live-vol">{fmt(liveVolume, 0)} kg</span>
          </div>
        </header>
      ) : null}

      {/* Live "本次练到哪里" Muscle Progress Overlay */}
      {muscleProgressOpen ? (
        <div className="session-menu-overlay" role="dialog" aria-label="本次训练肌群进度">
          <div className="picker-overlay-head">
            <strong>这次训练练到哪里</strong>
            <button type="button" className="secondary-button picker-close-btn" onClick={() => setMuscleProgressOpen(false)}>
              返回训练
            </button>
          </div>
          <div className="session-menu-body">
            <div className="live-muscle-map-wrap">
              <MuscleBodyMap size="md" showLabels scores={liveMuscleScores} />
            </div>
            <div className="live-muscle-list">
              {liveMuscleProgress.map((entry) => (
                <div key={entry.muscle} className="live-muscle-row">
                  <div className="live-muscle-row-head">
                    <strong>{MUSCLES[entry.muscle] ?? entry.muscle}</strong>
                    <span>
                      <b>{fmt(entry.completedSets, 1)}</b> / {fmt(entry.plannedSets, 1)} 组
                    </span>
                  </div>
                  <div className="live-muscle-bar-track">
                    <div
                      className="live-muscle-bar-fill"
                      style={{ width: `${Math.round(entry.ratio * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Merge Another Routine Overlay */}
      {mergeRoutineOpen ? (
        <div className="session-menu-overlay" role="dialog" aria-label="合并其他训练日">
          <div className="picker-overlay-head">
            <strong>合并其他训练日</strong>
            <button type="button" className="secondary-button picker-close-btn" onClick={() => setMergeRoutineOpen(false)}>
              取消
            </button>
          </div>
          <div className="session-menu-body">
            <p className="muted" style={{ marginTop: 0 }}>
              选择计划中的训练日或自定义模板，将其动作直接追加到本次训练末尾（不影响已完成组）。
            </p>
            {loadingMergeOptions ? (
              <div className="empty loading">正在加载训练日…</div>
            ) : mergeOptions.length === 0 ? (
              <div className="empty">暂无可合并的训练日或模板，可先到「计划」页创建。</div>
            ) : (
              <div className="merge-routine-list">
                {mergeOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className="merge-routine-item"
                    onClick={() => void handleMergeRoutine(opt)}
                  >
                    <div>
                      <strong>{opt.title}</strong>
                      <small className="muted">{opt.source} · {opt.exercises.length} 个动作</small>
                    </div>
                    <span className="secondary-button">+ 合并</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Contextual "问教练" Quick Scenario Overlay */}
      {coachExIdx != null && coachTargetRow && coachAdvice ? (
        <div className="session-menu-overlay" role="dialog" aria-label="训中问教练">
          <div className="picker-overlay-head">
            <strong>问教练 · {coachTargetRow.snapshot?.name ?? coachTargetRow.exerciseId}</strong>
            <button type="button" className="secondary-button picker-close-btn" onClick={() => setCoachExIdx(null)}>
              关闭
            </button>
          </div>
          <div className="session-menu-body">
            <div className="coach-scenario-grid" role="group" aria-label="选择现场情况">
              {COACH_QUICK_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  className={`coach-scenario-btn${coachScenario === sc.id ? " is-active" : ""}`}
                  aria-pressed={coachScenario === sc.id}
                  onClick={() => {
                    triggerHaptic("light");
                    setCoachScenario(sc.id);
                  }}
                >
                  <strong>{sc.label}</strong>
                  <small>{sc.subtitle}</small>
                </button>
              ))}
            </div>

            <div className="panel coach-advice-card">
              <h4>{coachAdvice.headline}</h4>
              <p className="muted">{coachAdvice.rationale}</p>
              <div className="coach-advice-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    const targetIdx = coachExIdx;
                    if (coachAdvice.actionKind === "swap_backup") {
                      setCoachExIdx(null);
                      void swapToBackupExercise(targetIdx);
                    } else if (coachAdvice.actionKind === "open_swap") {
                      setCoachExIdx(null);
                      openSwapExercisePicker(targetIdx);
                    } else if (coachAdvice.apply) {
                      const unitStep = (coachTargetRow.weightUnit ?? "kg") === "lb" ? 5 : weightStepKg;
                      setExercises((prev) =>
                        prev.map((ex, i) => (i === targetIdx ? coachAdvice.apply!(ex, unitStep) : ex)),
                      );
                      setCoachExIdx(null);
                      triggerHaptic("light");
                      notify(`已应用调整：${coachAdvice.actionLabel}`);
                    }
                  }}
                >
                  {coachAdvice.actionLabel}
                </button>
                {aiReady ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setCoachExIdx(null);
                      openAiAdaptWorkoutModal({
                        ensureSavedWorkout: ensureSavedDraft,
                        onApplied: (updated) => {
                          savedRecordRef.current = updated;
                          setSavedRecord(updated);
                          setExercises(updated.data.exercises);
                          bumpDataEpoch();
                          notify("已应用 AI 训中调整");
                        },
                      });
                    }}
                  >
                    让 AI 深度调整整场
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Quick In-Session Exercise History Drawer */}
      {historyModalEx ? (
        <div className="session-menu-overlay" role="dialog" aria-label="动作最近历史记录">
          <div className="picker-overlay-head">
            <strong>最近历史 · {historyModalEx.name}</strong>
            <button
              type="button"
              className="secondary-button picker-close-btn"
              onClick={() => setHistoryModalEx(null)}
            >
              返回训练
            </button>
          </div>
          <div className="session-menu-body">
            {historyModalEx.loading ? (
              <div className="empty loading">正在读取历史训练记录…</div>
            ) : historyModalEx.sessions.length === 0 ? (
              <div className="empty">该动作暂无历史完成记录，完成今日训练后将自动沉淀。</div>
            ) : (
              <div className="quick-history-list">
                {historyModalEx.sessions.map((sess) => (
                  <article key={`${sess.workoutId}-${sess.date}`} className="quick-history-card">
                    <div className="quick-history-head">
                      <div>
                        <strong>{sess.date}</strong>
                        <small className="muted">{sess.title}</small>
                      </div>
                      <div className="quick-history-kpis">
                        {historyModalEx.mode === "timed" ? (
                          sess.bestSeconds != null ? <span>最佳 {sess.bestSeconds}s</span> : null
                        ) : (
                          <>
                            {sess.estimated1rm != null ? <span>1RM {fmt(sess.estimated1rm, 1)}kg</span> : null}
                            {sess.volume > 0 ? <span>容量 {fmt(sess.volume, 0)}kg</span> : null}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="quick-history-sets">
                      {sess.sets.map((st, idx) => (
                        <span key={idx} className={`quick-history-set-pill${st.type !== "normal" ? " is-special" : ""}`}>
                          {historyModalEx.mode === "timed"
                            ? `${st.seconds}s`
                            : historyModalEx.mode === "assisted"
                              ? `辅助${fmt(st.weight)}×${st.reps}`
                              : `${fmt(st.weight)}×${st.reps}`}
                          {st.rir != null ? ` @RIR${st.rir}` : ""}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
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
            <div className="session-settings-group">
              <h4 className="session-settings-group-title">基本信息与扩展</h4>
              <label className="field">
                <span>训练名称</span>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field">
                <span>训练日期</span>
                <input type="date" value={date} min="1902-01-01" max={todayStr} onChange={(e) => setDate(e.target.value)} />
              </label>
              {!isHistoricalEdit ? (
                <button type="button" className="secondary-button" onClick={() => void openMergeRoutineOverlay()}>
                  <Icon name="plus" size={14} /> 合并其他训练日到本次训练
                </button>
              ) : null}
            </div>

            <div className="session-settings-group">
              <h4 className="session-settings-group-title">界面布局与场馆配置</h4>
              <div className="field">
                <span>训练界面布局</span>
                <div className="segments">
                  {WORKOUT_LAYOUT_PRESETS.map((lay) => (
                    <button
                      key={lay.id}
                      type="button"
                      aria-pressed={workoutLayout === lay.id}
                      onClick={() => {
                        updatePref("workoutLayout", lay.id);
                        if (!isHistoricalEdit) {
                          setViewMode(lay.id === "compact" ? "all" : "single");
                        }
                        notify(`已切换为「${lay.label}」布局`);
                      }}
                    >
                      {lay.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>动作示范动图展示</span>
                <div className="segments">
                  {DEMO_DISPLAY_PRESETS.map((modeOpt) => (
                    <button
                      key={modeOpt.id}
                      type="button"
                      aria-pressed={effectiveDemoMode === modeOpt.id}
                      onClick={() => {
                        updatePref("demoDisplayMode", modeOpt.id);
                        notify(`动作示范图已切换为「${modeOpt.label}」`);
                      }}
                    >
                      {modeOpt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>快速切换训练场馆（自动同步杆重与杠铃片库存）</span>
                <div className="segments">
                  {(goals?.equipmentProfiles?.length ? goals.equipmentProfiles : DEFAULT_EQUIPMENT_PROFILES).map((gp) => (
                    <button
                      key={gp.id}
                      type="button"
                      aria-pressed={barWeight === gp.barWeight && JSON.stringify(enabledPlates) === JSON.stringify(gp.enabledPlates)}
                      onClick={() => {
                        updatePref("barWeight", gp.barWeight);
                        updatePref("enabledPlates", gp.enabledPlates);
                        updatePref("platePairs", gp.platePairs);
                        notify(`已套用场馆「${gp.name}」配置（${gp.barWeight}kg 杆）`);
                      }}
                    >
                      {gp.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="session-settings-group">
              <h4 className="session-settings-group-title">记录与自动联动</h4>
              <div className="session-options">
                <label className="switch-chip">
                  <span>完成动作自动折叠</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={collapseCompletedExercises}
                    onChange={(e) => updatePref("collapseCompletedExercises", e.target.checked)}
                  />
                </label>
                <label className="switch-chip">
                  <span>休息语音播报（剩10秒/下组目标）</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={voiceRestCues}
                    onChange={(e) => {
                      const next = e.target.checked;
                      updatePref("voiceRestCues", next);
                      if (next) speakCue("已开启语音播报", { enabled: true });
                    }}
                  />
                </label>
                <label className="switch-chip">
                  <span>默认同步后续组</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={autoSyncSubsequent}
                    onChange={(e) => updatePref("autoSyncSubsequent", e.target.checked)}
                  />
                </label>
                <label className="switch-chip">
                  <span>自动沿用上次重量</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={autoPrefillLast}
                    onChange={(e) => updatePref("autoPrefillLast", e.target.checked)}
                  />
                </label>
                <label className="switch-chip">
                  <span>完组自动跳下一动作</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={autoAdvanceExercise}
                    onChange={(e) => updatePref("autoAdvanceExercise", e.target.checked)}
                  />
                </label>
                <label className="switch-chip">
                  <span>显示 RIR 储备</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={showRir}
                    onChange={(e) => updatePref("showRir", e.target.checked)}
                  />
                </label>
                <label className="switch-chip">
                  <span>杠铃配片提示</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={showPlateMath}
                    onChange={(e) => updatePref("showPlateMath", e.target.checked)}
                  />
                </label>
              </div>
            </div>

            <div className="session-settings-group">
              <h4 className="session-settings-group-title">组间休息与提醒</h4>
              <div className="session-options">
                <label className="switch-chip">
                  <span>完组自动倒计时</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={autoStartRestTimer}
                    onChange={(e) => updatePref("autoStartRestTimer", e.target.checked)}
                  />
                </label>
                <label className="switch-chip">
                  <span>休息结束提示音</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={soundOn}
                    onChange={(e) => {
                      const next = e.target.checked;
                      updatePref("soundOn", next);
                      if (next) audio.preview(soundStyle);
                    }}
                  />
                </label>
                <label className="switch-chip">
                  <span>触感震动反馈</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={hapticsOn}
                    onChange={(e) => {
                      const next = e.target.checked;
                      updatePref("hapticsOn", next);
                      if (next) triggerHaptic("light");
                    }}
                  />
                </label>
                <label className={`switch-chip${wakeActive ? " wake-active" : ""}`}>
                  <span>训练防息屏</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={screenAwakePref}
                    onChange={(e) => updatePref("screenAwake", e.target.checked)}
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
                      updatePref("notifyRest", next);
                    }}
                  />
                </label>
              </div>
              {soundOn ? (
                <div className="field">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span>提示音色</span>
                    <button type="button" className="quiet" onClick={() => audio.preview(soundStyle)}>
                      试听
                    </button>
                  </div>
                  <div className="segments">
                    {REST_SOUND_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={soundStyle === preset.id}
                        onClick={() => {
                          updatePref("soundStyle", preset.id);
                          audio.preview(preset.id);
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="field">
                <span>热身组休息时长</span>
                <div className="segments">
                  {WARMUP_REST_PRESETS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      aria-pressed={warmupRestSeconds === sec}
                      onClick={() => updatePref("warmupRestSeconds", sec)}
                    >
                      {sec === 0 ? "免休" : `${sec}s`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>休息计时增减步长</span>
                <div className="segments">
                  {REST_STEP_PRESETS.map((stepSec) => (
                    <button
                      key={stepSec}
                      type="button"
                      aria-pressed={restAdjustStep === stepSec}
                      onClick={() => updatePref("restAdjustStep", stepSec)}
                    >
                      ±{stepSec}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="session-settings-group">
              <h4 className="session-settings-group-title">器械与热身方案</h4>
              <div className="field">
                <span>重量递增步长</span>
                <div className="segments">
                  {WEIGHT_STEP_PRESETS.map((step) => (
                    <button
                      key={step}
                      type="button"
                      aria-pressed={weightStepKg === step}
                      onClick={() => updatePref("weightStepKg", step)}
                    >
                      ±{step}kg
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>杠铃空杆规格</span>
                <div className="segments">
                  {BAR_PRESETS.map(([bw, lbl]) => (
                    <button
                      key={bw}
                      type="button"
                      aria-pressed={barWeight === bw}
                      onClick={() => updatePref("barWeight", bw)}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>我的可用杠铃片（每侧自动配片）</span>
                <div className="plate-chip-grid">
                  {ALL_PLATES.map((plate) => {
                    const active = enabledPlates.includes(plate);
                    return (
                      <button
                        key={plate}
                        type="button"
                        className="plate-chip"
                        aria-pressed={active}
                        onClick={() => {
                          if (active) {
                            if (enabledPlates.length <= 1) {
                              notify("至少保留一种杠铃片规格");
                              return;
                            }
                            updatePref(
                              "enabledPlates",
                              enabledPlates.filter((p) => p !== plate),
                            );
                          } else {
                            updatePref("enabledPlates", [...enabledPlates, plate]);
                          }
                        }}
                      >
                        {plate}kg
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field">
                <span>热身组坡度方案</span>
                <div className="segments">
                  {WARMUP_SCHEMES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={warmupScheme === item.id}
                      onClick={() => updatePref("warmupScheme", item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <small className="muted">
                  当前梯度：{WARMUP_SCHEMES.find((s) => s.id === warmupScheme)?.desc ?? ""}
                </small>
              </div>
            </div>

            <div className="session-menu-quick">
              <button
                type="button"
                className="secondary-button"
                disabled={saving}
                onClick={() => {
                  setOpenMenu(false);
                  void submitWorkout("active");
                }}
              >
                <Icon name="upload" size={15} /> 保存云端草稿
              </button>
              {aiReady ? (
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
                        notify("已应用训中调整");
                      },
                    })
                  }
                >
                  <Icon name="bolt" size={15} /> 智能训中调整
                </button>
              ) : null}
              {savedRecord ? (
                <button type="button" className="danger" onClick={handleDeleteWorkout}>
                  删除本条记录
                </button>
              ) : (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    openConfirm({
                      title: "放弃未保存训练草稿",
                      message: `确定要放弃「${title || "本次训练"}」的未保存草稿吗？已录入的组数将被清空。`,
                      confirmLabel: "放弃草稿",
                      onConfirm: () => {
                        clearDraft();
                        closeAllModals();
                        notify("已放弃未保存草稿");
                      },
                    });
                  }}
                >
                  放弃未保存草稿
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Live Dedicated Finish Overlay */}
      {!isHistoricalEdit && finishPanelOpen ? (
        <div className="session-menu-overlay workout-finish-overlay" role="dialog" aria-label="结束训练确认">
          <div className="picker-overlay-head">
            <strong>结束本次训练</strong>
            <button type="button" className="secondary-button picker-close-btn" onClick={() => setFinishPanelOpen(false)}>
              继续练
            </button>
          </div>
          <div className="session-menu-body">
            <div className="finish-summary-strip">
              <div>
                <span>已用时</span>
                <strong>{formatClock(elapsedSeconds)}</strong>
              </div>
              <div>
                <span>已完成组</span>
                <strong>
                  {doneSets}/{totalSets}
                </strong>
              </div>
              <div>
                <span>总容量</span>
                <strong>{fmt(liveVolume, 0)} kg</strong>
              </div>
            </div>

            {doneSets === 0 && totalSets > 0 ? (
              <div className="finish-zero-tip">
                <p>当前尚未勾选完成任何组；若所有计划组均已完成，可直接一键勾选并结束。</p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => void submitWorkout("completed", { completeAllPending: true })}
                >
                  一键勾选全部组并结束
                </button>
              </div>
            ) : doneSets > 0 && doneSets < totalSets ? (
              <div className="finish-zero-tip">
                <p>
                  还有 <b>{totalSets - doneSets}</b> 组未勾选完成；可直接仅保存已勾选的 {doneSets} 组，或一键补勾全部剩余组。
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => void submitWorkout("completed", { completeAllPending: true })}
                >
                  一键补勾剩余 {totalSets - doneSets} 组并结束
                </button>
              </div>
            ) : null}

            <div className="finish-panel">
              <label className="field">
                <span>训练时长（分钟 · 可按实际微调，补录历史必填更准）</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={720}
                  value={manualDurationMin}
                  onChange={(e) => setManualDurationMin(e.target.value)}
                  placeholder={
                    date < todayStr
                      ? `留空则按计时（建议填约 ${Math.max(10, totalSets * 3)} 分钟）`
                      : `当前计时约 ${Math.max(1, Math.round(elapsedSeconds / 60))} 分钟`
                  }
                />
              </label>
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

              {canSyncSource ? (
                <div className="finish-sync-card">
                  <label className="toggle-row finish-sync-toggle">
                    <span>
                      <strong>同步改动回原{syncTargetLabel}</strong>
                      <small className="muted">检测到变动：{sourceSyncDiff.summary}</small>
                    </span>
                    <input
                      className="switch"
                      type="checkbox"
                      checked={syncSourceOnFinish}
                      onChange={(e) => {
                        triggerHaptic("light");
                        setSyncSourceOnFinish(e.target.checked);
                      }}
                    />
                  </label>
                </div>
              ) : null}

              {date === today() ? (
                onIos ? (
                  <a
                    href={appleEndUrl}
                    className="secondary-button"
                    style={{ textDecoration: "none", justifyContent: "center" }}
                    onClick={() => triggerHaptic("light")}
                  >
                    <Icon name="upload" size={14} /> 手动补传 Apple 心率/热量
                  </a>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      triggerHaptic("light");
                      triggerAppleHubAction("end", { prefs, notify });
                    }}
                  >
                    <Icon name="upload" size={14} /> 手动补传 Apple 心率/热量
                  </button>
                )
              ) : null}
            </div>

            <p className="form-error" role="alert" hidden={!error}>
              {error}
            </p>
          </div>

          <div className="dialog-foot">
            <button type="button" className="quiet" onClick={() => setFinishPanelOpen(false)}>
              继续练
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() => void submitWorkout("completed")}
            >
              {saving ? "保存中…" : `完成并保存训练 · ${doneSets} 组`}
            </button>
          </div>
        </div>
      ) : null}

      {/* Exercise Jump Bar */}
      <div className="session-control-stack">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="exercise-jump" role="navigation" aria-label="动作快捷跳转">
            {exercises.map((row, idx) => {
              const allDone = row.sets.length > 0 && row.sets.every((s) => s.completed);
              const isCurrent = safeExIdx === idx;
              return (
                <button
                  key={row.id}
                  ref={(el) => {
                    jumpRefs.current[idx] = el;
                  }}
                  type="button"
                  className={`jump-circle${allDone ? " finished" : ""}${isCurrent ? " is-active" : ""}`}
                  aria-pressed={isCurrent}
                  aria-current={isCurrent ? "step" : undefined}
                  title={row.snapshot?.name ?? row.exerciseId}
                  onClick={() => goToExercise(idx)}
                >
                  {idx + 1}
                  {row.supersetGroup ? <i className="jump-ss-sup">{row.supersetGroup}</i> : null}
                </button>
              );
            })}
          </div>
          <div className="exercise-bar-right">
            {!isHistoricalEdit && exercises.length > 1 ? (
              <button
                type="button"
                className="quiet workout-view-toggle"
                aria-pressed={viewMode === "all"}
                title={viewMode === "single" ? "切换为纵向总览所有动作" : "切换为一页单个动作专注模式"}
                onClick={() => {
                  triggerHaptic("light");
                  setViewMode((m) => (m === "single" ? "all" : "single"));
                }}
              >
                {viewMode === "single" ? "总览" : "单动作"}
              </button>
            ) : null}
            <button type="button" className="secondary-button" onClick={openAddExercisePicker}>
              <Icon name="plus" size={14} /> 加动作
            </button>
          </div>
        </div>
      </div>

      {/* Main Exercise Scroll Stack */}
      <div className="workout-scroll" ref={workoutScrollRef}>
        {isBackfillMode ? (
          <div className="backfill-banner" role="status">
            <span>
              <strong>历史补录模式（{date}）</strong> · 已自动关闭秒表与休息倒计时，保存时可直接填总时长
            </span>
          </div>
        ) : null}
        {prefs.deloadMode && !isHistoricalEdit ? (
          <div className="deload-banner" role="status">
            <span>
              <strong>减载周模式</strong> · 目标按重量 {prefs.deloadWeightPct}% / 组数 {prefs.deloadSetsPct}% 缩放
            </span>
            <button type="button" className="quiet" onClick={() => updatePref("deloadMode", false)}>
              退出减载
            </button>
          </div>
        ) : null}
        {isHistoricalEdit && finishPanelOpen ? (
          <div className="finish-panel">
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
              <label className="field">
                <span>训练时长（分钟）</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={720}
                  value={manualDurationMin}
                  onChange={(e) => setManualDurationMin(e.target.value)}
                  placeholder="例如：55"
                />
              </label>
            </div>

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

            <p className="form-error" role="alert" hidden={!error}>
              {error}
            </p>
            <div className="dialog-foot">
              <button type="button" className="danger" onClick={handleDeleteWorkout}>
                删除
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={saving}
                onClick={() => void submitWorkout("completed")}
              >
                {saving ? "保存中…" : "保存修改"}
              </button>
            </div>
          </div>
        ) : null}

        {exercises.length === 0 ? (
          <div className="workout-empty-state">
            <strong>选择第一个训练动作</strong>
            {recentQuickPicks.length > 0 ? (
              <div className="workout-empty-picks">
                <small className="muted">最近常练（点一下立即加入）：</small>
                <div className="launchpad-chips">
                  {recentQuickPicks.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="launchpad-chip"
                      onClick={() => {
                        triggerHaptic("light");
                        void resolveCatalogueMap([item.id]).then((map) => {
                          const cat = map.get(item.id);
                          appendExercises([
                            cat ?? {
                              id: item.id,
                              name: item.name,
                              englishName: item.englishName,
                              muscle: item.muscle,
                              equipment: item.equipment,
                              mode: item.mode,
                              volumeMultiplier: 1,
                              custom: item.custom,
                            },
                          ]);
                        });
                      }}
                    >
                      + {item.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button type="button" className="primary-button" onClick={openAddExercisePicker}>
              <Icon name="plus" size={16} /> 浏览全部动作库
            </button>
          </div>
        ) : (
          <div
            className="workout-swipe-stage"
            onTouchStart={handleStageTouchStart}
            onTouchMove={handleStageTouchMove}
            onTouchEnd={handleStageTouchEnd}
            onTouchCancel={handleStageTouchCancel}
            style={
              swipeOffsetX !== 0
                ? { transform: `translate3d(${swipeOffsetX}px, 0, 0)`, transition: "none" }
                : { transform: "translate3d(0, 0, 0)", transition: "transform 0.18s ease" }
            }
          >
            {(viewMode === "single" && !isHistoricalEdit
              ? exercises[safeExIdx]
                ? [{ row: exercises[safeExIdx]!, exIdx: safeExIdx }]
                : []
              : exercises.map((row, exIdx) => ({ row, exIdx }))
            ).map(({ row, exIdx }) => {
              const snap = row.snapshot;
              const mode: ExerciseMode = snap?.mode ?? "reps";
              const isTimed = mode === "timed";
              const isAssisted = mode === "assisted";
              const exUnit: WeightUnit = row.weightUnit ?? "kg";
              const exWeightStep = exUnit === "lb" ? 5 : weightStepKg;
              const isBarbell = snap?.equipment === "barbell" && exUnit === "kg";
              const exDoneCount = row.sets.filter((s) => s.completed).length;
              const exAllDone = row.sets.length > 0 && exDoneCount === row.sets.length;
              const isCollapsedDone =
                collapseCompletedExercises &&
                viewMode === "all" &&
                exAllDone &&
                !expandedDoneIds.has(row.id);
              const snapTarget = (
                sessionMetaRef.current.targetSnapshot as
                  | {
                      isDeload?: boolean;
                      exercises?: Array<{
                        exerciseId: string;
                        sets: number;
                        setsMax?: number;
                        repsMin: number;
                        repsMax: number;
                        progression?: string;
                        increment?: number;
                        targetRir?: number;
                      }>;
                    }
                  | null
                  | undefined
              );
              const plannedItem =
                row.targetIndex != null
                  ? snapTarget?.exercises?.[row.targetIndex]
                  : snapTarget?.exercises?.find((e) => e.exerciseId === row.exerciseId);
              const progRuleName =
                plannedItem?.progression === "triple"
                  ? "三重渐进"
                  : plannedItem?.progression === "linear"
                    ? "线性渐进"
                    : plannedItem?.progression === "greyskull"
                      ? "Greyskull"
                      : plannedItem?.progression === "manual"
                        ? "固定负荷"
                        : plannedItem
                          ? "双线性渐进"
                          : "";
              const progInlineText = plannedItem
                ? `${progRuleName} · 目标 ${plannedItem.sets}${plannedItem.progression === "triple" && plannedItem.setsMax ? `–${plannedItem.setsMax}` : ""} 组 × ${
                    plannedItem.repsMin === plannedItem.repsMax
                      ? `${plannedItem.repsMin}`
                      : `${plannedItem.repsMin}–${plannedItem.repsMax}`
                  } 次${plannedItem.increment && plannedItem.progression !== "manual" ? ` · 达标 +${plannedItem.increment}${exUnit}` : ""}${snapTarget?.isDeload ? " · 减载日" : ""}`
                : "";
              const exVolume = summarizeWorkoutRecord({
                date,
                title,
                startedAt: sessionStart,
                endedAt: null,
                status: "active",
                exercises: [row],
              }).volume;
              const nextIncompleteSetIdx = row.sets.findIndex((s) => !s.completed);
              const settingsExpanded = openSettingsIds.has(row.id);
              const refSets = refsByExId.get(row.exerciseId) ?? [];
              const refDate = refDatesByExId.get(row.exerciseId) ?? "";
              const validRefs = refSets.filter((r): r is NonNullable<typeof r> => Boolean(r));
              const mediaUrl = mediaByExId.get(row.exerciseId) || "";
              const prBaseline = prsByExId.get(row.exerciseId) ?? null;
              const benchmark = summarizeExerciseBenchmarks(
                validRefs,
                prBaseline,
                mode,
                row.weightUnit,
                snap?.volumeMultiplier ?? 1,
              );
              const exVolGain =
                benchmark.lastTotalVolumeKg > 0 && exVolume > benchmark.lastTotalVolumeKg
                  ? Math.round(exVolume - benchmark.lastTotalVolumeKg)
                  : 0;

              const prevBestE1rm = !isTimed && !isAssisted
                ? Math.max(0, ...validRefs.map((r) => estimated1RM(r.weight, r.reps)))
                : 0;
              const todayBestE1rm = !isTimed && !isAssisted
                ? Math.max(
                    0,
                    ...row.sets
                      .filter((s) => s.completed && s.type !== "warmup")
                      .map((s) => estimated1RM(s.weight, s.reps)),
                  )
                : 0;
              const e1rmGain = prevBestE1rm > 0 && todayBestE1rm > prevBestE1rm ? todayBestE1rm - prevBestE1rm : 0;

              if (isCollapsedDone) {
                return (
                  <section
                    key={row.id}
                    ref={(el) => {
                      cardRefs.current[row.id] = el;
                    }}
                    className="exercise-editor is-collapsed-done"
                  >
                    <button
                      type="button"
                      className="collapsed-ex-strip"
                      onClick={() =>
                        setExpandedDoneIds((prev) => {
                          const next = new Set(prev);
                          next.add(row.id);
                          return next;
                        })
                      }
                    >
                      <span className="collapsed-ex-check">✓</span>
                      <strong>{snap?.name ?? row.exerciseId}</strong>
                      <small className="muted">
                        {exDoneCount}/{row.sets.length} 组{exVolume > 0 ? ` · ${fmt(exVolume, 0)} kg` : ""}
                      </small>
                      <span className="quiet">展开</span>
                    </button>
                  </section>
                );
              }

              return (
                <section
                  key={row.id}
                  ref={(el) => {
                    cardRefs.current[row.id] = el;
                  }}
                  className={`exercise-editor${isTimed ? " timed-exercise" : ""} has-delete-cols`}
                >
                  <div className="ex-hero-head">
                    {effectiveDemoMode !== "hidden" ? (
                      <button
                        type="button"
                        className={`ex-hero-thumb${effectiveDemoMode === "small" && mediaUrl ? " has-media" : " is-fallback"}`}
                        aria-label={mediaUrl ? "放大查看动作示范或替换动作" : "替换动作"}
                        title={mediaUrl ? "点击放大动作示范图（替换请点右上角设置）" : "点击替换动作"}
                        onClick={() => {
                          if (mediaUrl && effectiveDemoMode === "small") {
                            triggerHaptic("light");
                            updatePref("demoDisplayMode", "large");
                          } else {
                            openSwapExercisePicker(exIdx);
                          }
                        }}
                      >
                        {effectiveDemoMode === "small" && mediaUrl ? (
                          <img src={mediaUrl} alt={snap?.name ?? row.exerciseId} loading="lazy" />
                        ) : (
                          <Icon name="workout" size={22} />
                        )}
                        <span className="ex-thumb-badge">
                          <Icon name={mediaUrl && effectiveDemoMode === "small" ? "book" : "swap"} size={10} />
                        </span>
                      </button>
                    ) : null}

                    <div className="ex-hero-title-col">
                      <div className="ex-hero-title-row">
                        <button
                          type="button"
                          className="ex-title-btn"
                          title="查看动作百科图解与个人历史曲线"
                          onClick={() => openExerciseDetailModal(row.exerciseId, snap?.name ?? row.exerciseId)}
                        >
                          <h3>{snap?.name ?? row.exerciseId}</h3>
                          <Icon name="book" size={14} />
                        </button>
                        <span className="ex-set-ratio">
                          {exDoneCount}/{row.sets.length} 组
                        </span>
                      </div>
                      <div className="ex-hero-tags">
                        {snap?.muscle ? <span className="ex-tag">{MUSCLES[snap.muscle] ?? snap.muscle}</span> : null}
                        {snap?.equipment ? (
                          <span className="ex-tag">{EQUIPMENT[snap.equipment] ?? snap.equipment}</span>
                        ) : null}
                        {exUnit === "lb" ? <span className="unit-pill">lb 磅</span> : null}
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

                  {effectiveDemoMode === "large" && mediaUrl ? (
                    <div className="ex-demo-large">
                      <img src={mediaUrl} alt={`${snap?.name ?? row.exerciseId} 动作示范`} loading="lazy" />
                      <div className="ex-demo-large-bar">
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => updatePref("demoDisplayMode", "small")}
                        >
                          缩小为缩略图
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => openExerciseDetailModal(row.exerciseId, snap?.name ?? row.exerciseId)}
                        >
                          百科要点 →
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="ex-quick-bar">
                    <span className="ex-quick-stat">
                      容量 <strong>{fmt(exVolume, 0)} kg</strong>
                      {exVolGain > 0 ? (
                        <em className="ex-vol-gain" title="单动作累计容量已超过上次整场容量">
                          +{fmt(exVolGain, 0)}
                        </em>
                      ) : null}
                    </span>
                    {isHistoricalEdit ? (
                      <span className="ex-quick-stat">休息 {row.restSeconds ?? 90}s</span>
                    ) : null}
                    <button
                      type="button"
                      className="ex-quick-rest-btn"
                      onClick={() => openQuickHistory(row.exerciseId, snap?.name ?? row.exerciseId, mode)}
                    >
                      历史
                    </button>
                    {!isHistoricalEdit ? (
                      <>
                        <button
                          type="button"
                          className="ex-quick-rest-btn"
                          onClick={() => {
                            triggerHaptic("light");
                            setCoachScenario("pain");
                            setCoachExIdx(exIdx);
                          }}
                        >
                          问教练
                        </button>
                        <button
                          type="button"
                          className="ex-quick-rest-btn"
                          onClick={() => {
                            const sec = Math.max(15, row.restSeconds ?? 90);
                            triggerHaptic("light");
                            audio.unlock();
                            restAlarmFiredForRef.current = null;
                            setRest(createRestTimer(sec, row.id));
                          }}
                        >
                          <Icon name="clock" size={12} /> 休息 {row.restSeconds ?? 90}s
                        </button>
                      </>
                    ) : null}
                  </div>

                  {progInlineText ? (
                    <div className="ex-inline-prog-strip" role="note">
                      <span className="ex-inline-prog-dot" aria-hidden="true" />
                      <span>{progInlineText}</span>
                    </div>
                  ) : null}

                  <div className="ex-cue-row" data-no-swipe="true">
                    {editingNoteExId === row.id ? (
                      <div className="ex-cue-editor">
                        <input
                          type="text"
                          maxLength={500}
                          value={noteDraft}
                          placeholder="例如：座椅第 4 格、肘部内收 45°"
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleSaveInlineNote(row.id, row.exerciseId);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              e.stopPropagation();
                              setEditingNoteExId(null);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={savingNote}
                          onClick={() => void handleSaveInlineNote(row.id, row.exerciseId)}
                        >
                          {savingNote ? "保存中" : "保存"}
                        </button>
                        <button type="button" className="quiet" onClick={() => setEditingNoteExId(null)}>
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`ex-cue-btn${notesByExId[row.exerciseId]?.note ? " has-note" : ""}`}
                        onClick={() => {
                          setEditingNoteExId(row.id);
                          setNoteDraft(notesByExId[row.exerciseId]?.note ?? "");
                        }}
                      >
                        <Icon name="bookmark" size={12} />
                        <span>
                          {notesByExId[row.exerciseId]?.note
                            ? `要点：${notesByExId[row.exerciseId]!.note}`
                            : "+ 动作要点（座椅格数 / 握距 / 提醒）"}
                        </span>
                      </button>
                    )}
                  </div>

                {benchmark.hasAny ? (
                  <div className="ex-benchmark-box">
                    <div className="ex-benchmark-strip" aria-label="动作重量与历史基准">
                      <div className="ex-benchmark-card is-primary">
                        <span>{benchmark.lastTopLabel}</span>
                        <strong>{benchmark.lastTopValue}</strong>
                      </div>
                      <div className="ex-benchmark-card">
                        <span>{benchmark.bestWeightLabel}</span>
                        <strong>{benchmark.bestWeightValue}</strong>
                      </div>
                      <div className="ex-benchmark-card">
                        <span>{benchmark.thirdLabel}</span>
                        <strong>{benchmark.thirdValue}</strong>
                      </div>
                    </div>

                    {benchmark.lastSummary || e1rmGain > 0 ? (
                      <div className="ex-benchmark-foot">
                        {benchmark.lastSummary ? (
                          <span className="ex-benchmark-sets" title="上次训练工作组记录">
                            上次{refDate ? ` (${shortDate(refDate)})` : ""}：{benchmark.lastSummary}
                          </span>
                        ) : null}
                        <div className="ex-benchmark-actions">
                          {e1rmGain > 0 ? (
                            <span className="ex-prog-pill is-pr">
                              ↗ E1RM +{fmt(e1rmGain, 1)} kg
                            </span>
                          ) : null}
                          {!isTimed && validRefs.length > 0 ? (
                            <>
                              <button
                                type="button"
                                className="ex-apply-ref"
                                onClick={() => {
                                  triggerHaptic("light");
                                  let updatedCount = 0;
                                  setExercises((prev) =>
                                    prev.map((ex, i) => {
                                      if (i !== exIdx) return ex;
                                      let workIdx = 0;
                                      return {
                                        ...ex,
                                        sets: ex.sets.map((s) => {
                                          if (s.type === "warmup") return s;
                                          const ref = validRefs[workIdx] ?? validRefs.at(-1);
                                          workIdx++;
                                          if (!ref || s.completed) return s;
                                          updatedCount++;
                                          return { ...s, weight: ref.weight, reps: ref.reps || s.reps };
                                        }),
                                      };
                                    }),
                                  );
                                  notify(updatedCount > 0 ? "已按上次工作组填入重量与次数" : "没有可填入的未完成工作组");
                                }}
                              >
                                沿用上次
                              </button>
                              <button
                                type="button"
                                className="ex-apply-prog"
                                onClick={() => {
                                  triggerHaptic("light");
                                  let updatedCount = 0;
                                  setExercises((prev) =>
                                    prev.map((ex, i) => {
                                      if (i !== exIdx) return ex;
                                      let workIdx = 0;
                                      return {
                                        ...ex,
                                        sets: ex.sets.map((s) => {
                                          if (s.type === "warmup") return s;
                                          const ref = validRefs[workIdx] ?? validRefs.at(-1);
                                          workIdx++;
                                          if (!ref || s.completed) return s;
                                          updatedCount++;
                                          if (isAssisted) {
                                            return ref.weight > 0
                                              ? {
                                                  ...s,
                                                  weight: Math.max(0, round2(ref.weight - weightStepKg)),
                                                  reps: ref.reps || s.reps,
                                                }
                                              : { ...s, reps: (ref.reps || s.reps) + 1 };
                                          }
                                          return ref.weight > 0
                                            ? {
                                                ...s,
                                                weight: round2(ref.weight + weightStepKg),
                                                reps: ref.reps || s.reps,
                                              }
                                            : { ...s, reps: (ref.reps || s.reps) + 1 };
                                        }),
                                      };
                                    }),
                                  );
                                  notify(updatedCount > 0 ? `已按渐进 +${weightStepKg}${exUnit} 预填未完成工作组` : "没有可预填的未完成工作组");
                                }}
                              >
                                渐进 +{exWeightStep}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
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
                        <label>重量单位</label>
                        <div className="rest-quick-pills">
                          {(["kg", "lb"] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              className="quiet"
                              aria-pressed={exUnit === u}
                              onClick={() => toggleExerciseWeightUnit(exIdx, u)}
                            >
                              {u === "kg" ? "公斤 (kg)" : "磅 (lb)"}
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
                            onClick={() => {
                              setExercises((prev) => {
                                const next = [...prev];
                                [next[exIdx - 1], next[exIdx]] = [next[exIdx]!, next[exIdx - 1]!];
                                return next;
                              });
                              if (activeExIdx === exIdx) setActiveExIdx(exIdx - 1);
                            }}
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            className="quiet"
                            disabled={exIdx === exercises.length - 1}
                            onClick={() => {
                              setExercises((prev) => {
                                const next = [...prev];
                                [next[exIdx], next[exIdx + 1]] = [next[exIdx + 1]!, next[exIdx]!];
                                return next;
                              });
                              if (activeExIdx === exIdx) setActiveExIdx(exIdx + 1);
                            }}
                          >
                            下移
                          </button>
                          {row.backupExerciseId ? (
                            <button
                              type="button"
                              className="quiet"
                              onClick={() => void swapToBackupExercise(exIdx)}
                            >
                              切备选：{row.backupExerciseName || "备选动作"}
                            </button>
                          ) : null}
                          <button type="button" className="quiet" onClick={() => openSwapExercisePicker(exIdx)}>
                            替换动作
                          </button>
                        </div>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            const hasWork = row.sets.some((s) => s.completed || s.weight > 0);
                            const removeNow = () => setExercises((prev) => prev.filter((_, i) => i !== exIdx));
                            if (!hasWork) {
                              removeNow();
                              return;
                            }
                            openConfirm({
                              title: "移除训练动作",
                              message: `确定移除「${snap?.name ?? row.exerciseId}」及其已记录的组数吗？`,
                              confirmLabel: "移除动作",
                              onConfirm: removeNow,
                            });
                          }}
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
                    <span>{isTimed ? "时长(秒)" : snap?.mode === "assisted" ? `辅助(${exUnit})` : `重量(${exUnit})`}</span>
                    {!isTimed ? <span>次数</span> : null}
                    <span className="col-rir">RIR</span>
                    <span>完成</span>
                    <span />
                  </div>

                  {row.sets.map((s, setIdx) => {
                    const prevSet = setIdx > 0 ? row.sets[setIdx - 1] : null;
                    let workSetIdx = 0;
                    for (let k = 0; k < setIdx; k++) {
                      if (row.sets[k]?.type !== "warmup") workSetIdx++;
                    }
                    const setRef = s.type === "warmup" ? null : (validRefs[workSetIdx] ?? validRefs.at(-1) ?? null);
                    const deltaHint =
                      showPlateMath && isBarbell && prevSet && s.weight > barWeight
                        ? plateDeltaLabel(prevSet.weight, s.weight, barWeight, enabledPlates, platePairs)
                        : "";
                    const platesInfo =
                      showPlateMath && isBarbell && s.weight > barWeight
                        ? plateBreakdown(s.weight, barWeight, enabledPlates, platePairs)
                        : null;
                    const typeInfo = SET_TYPES[s.type];
                    const overloadCue = describeSetOverloadCue(s, setRef, mode, row.weightUnit, prBaseline);
                    const isSetMenuOpen = openSetMenuId === s.id;
                    const showSetRefChip = Boolean(
                      !isHistoricalEdit &&
                        setIdx === nextIncompleteSetIdx &&
                        setRef &&
                        !s.completed &&
                        (isTimed
                          ? setRef.seconds > 0 && setRef.seconds !== s.seconds
                          : setRef.weight > 0 && (setRef.weight !== s.weight || setRef.reps !== s.reps)),
                    );
                    const hasInlineMeta =
                      Boolean(platesInfo?.valid) ||
                      showSetRefChip ||
                      Boolean(s.note) ||
                      editingSetNoteId === s.id ||
                      Boolean(overloadCue) ||
                      s.restAfterSeconds != null;

                    return (
                      <div key={s.id} className="set-block">
                        <div
                          className={`set-row${s.completed ? " is-complete" : ""}${
                            !isHistoricalEdit && setIdx === nextIncompleteSetIdx ? " is-next" : ""
                          }${isSetMenuOpen ? " has-open-menu" : ""}`}
                        >
                          <button
                            type="button"
                            className={`set-num-btn${isSetMenuOpen ? " is-menu-open" : ""}`}
                            data-type={s.type}
                            aria-expanded={isSetMenuOpen}
                            title={`组别：${typeInfo.label}（点击展开组操作菜单）`}
                            onClick={() => {
                              triggerHaptic("light");
                              setOpenSetMenuId((cur) => (cur === s.id ? null : s.id));
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
                                  aria-label={`减 ${exWeightStep}${exUnit}`}
                                  onClick={() => {
                                    triggerHaptic("light");
                                    updateSetAndCascade(exIdx, setIdx, (cur) => ({
                                      weight: Math.max(0, round2(cur.weight - exWeightStep)),
                                    }));
                                  }}
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="any"
                                  min={0}
                                  max={5000}
                                  value={s.weight}
                                  onFocus={(e) => {
                                    e.currentTarget.select();
                                    if (openSetMenuId) setOpenSetMenuId(null);
                                  }}
                                  onChange={(e) =>
                                    updateSetAndCascade(exIdx, setIdx, {
                                      weight: Math.max(0, Number(e.target.value) || 0),
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  aria-label={`加 ${exWeightStep}${exUnit}`}
                                  onClick={() => {
                                    triggerHaptic("light");
                                    updateSetAndCascade(exIdx, setIdx, (cur) => ({
                                      weight: round2(cur.weight + exWeightStep),
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
                                    updateSetAndCascade(exIdx, setIdx, (cur) => ({
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
                                  onFocus={(e) => {
                                    e.currentTarget.select();
                                    if (openSetMenuId) setOpenSetMenuId(null);
                                  }}
                                  onChange={(e) =>
                                    updateSetAndCascade(exIdx, setIdx, {
                                      reps: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  aria-label="加次数"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    updateSetAndCascade(exIdx, setIdx, (cur) => ({
                                      reps: Math.min(1000, cur.reps + 1),
                                    }));
                                  }}
                                >
                                  +
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="timed-set-cell">
                              <div className="num-stepper">
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    updateSetAndCascade(exIdx, setIdx, (cur) => ({
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
                                  onFocus={(e) => {
                                    e.currentTarget.select();
                                    if (openSetMenuId) setOpenSetMenuId(null);
                                  }}
                                  onChange={(e) =>
                                    updateSetAndCascade(exIdx, setIdx, {
                                      seconds: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  className="num-step-btn"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    updateSetAndCascade(exIdx, setIdx, (cur) => ({
                                      seconds: cur.seconds + 5,
                                    }));
                                  }}
                                >
                                  +
                                </button>
                              </div>
                              {!isHistoricalEdit ? (() => {
                                const isRunningThis = timedSetClock?.setId === s.id;
                                const leftTimedSec = isRunningThis
                                  ? Math.max(0, Math.ceil((timedSetClock.endAt - nowMs) / 1000))
                                  : null;
                                return (
                                  <button
                                    type="button"
                                    className={`timed-go-btn${isRunningThis ? " is-running" : ""}`}
                                    title={isRunningThis ? "停止倒计时" : "开始本组等长倒计时"}
                                    onClick={() => {
                                      triggerHaptic("light");
                                      audio.unlock();
                                      if (isRunningThis) {
                                        setTimedSetClock(null);
                                        timedCueSpokenSecRef.current = null;
                                      } else {
                                        const sec = Math.max(5, s.seconds || 30);
                                        timedCueSpokenSecRef.current = null;
                                        setTimedSetClock({
                                          exIdx,
                                          setIdx,
                                          setId: s.id,
                                          targetSeconds: sec,
                                          endAt: Date.now() + sec * 1000,
                                        });
                                        if (voiceRestCues) speakCue(`开始计时 ${sec} 秒`, { enabled: true });
                                      }
                                    }}
                                  >
                                    {isRunningThis ? `${leftTimedSec}s ⏹` : "▶ 倒计"}
                                  </button>
                                );
                              })() : null}
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
                            onClick={() => {
                              const deletedSet = s;
                              const exName = snap?.name ?? row.exerciseId;
                              setExercises((prev) =>
                                prev.map((ex, i) =>
                                  i === exIdx ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) } : ex,
                                ),
                              );
                              if (deletedSet.completed || deletedSet.weight > 0) {
                                setUndoDeletedSet({ exIdx, setIdx, set: deletedSet, exName });
                                if (undoSetTimerRef.current !== null) window.clearTimeout(undoSetTimerRef.current);
                                undoSetTimerRef.current = window.setTimeout(() => {
                                  undoSetTimerRef.current = null;
                                  setUndoDeletedSet(null);
                                }, 6000);
                              }
                            }}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </div>

                        {isSetMenuOpen ? (
                          <div className="set-action-menu" data-no-swipe="true">
                            <div className="set-action-section">
                              <span className="set-action-label">组别</span>
                              <div className="set-action-pills">
                                {SET_TYPE_ORDER.map((kind) => (
                                  <button
                                    key={kind}
                                    type="button"
                                    className="set-action-pill"
                                    aria-pressed={s.type === kind}
                                    onClick={() => {
                                      triggerHaptic("light");
                                      updateSet(exIdx, setIdx, (cur) => ({ ...cur, type: kind }));
                                      setOpenSetMenuId(null);
                                    }}
                                  >
                                    {SET_TYPES[kind].label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="set-action-section">
                              <span className="set-action-label">快捷</span>
                              <div className="set-action-pills">
                                <button
                                  type="button"
                                  className="set-action-pill"
                                  onClick={() => {
                                    triggerHaptic("light");
                                    setExercises((prev) =>
                                      prev.map((ex, i) =>
                                        i === exIdx
                                          ? { ...ex, sets: duplicateSetInList(ex.sets, setIdx, newId) }
                                          : ex,
                                      ),
                                    );
                                    setOpenSetMenuId(null);
                                  }}
                                >
                                  复制此组
                                </button>
                                {!isTimed ? (
                                  <>
                                    <button
                                      type="button"
                                      className="set-action-pill"
                                      onClick={() => {
                                        triggerHaptic("light");
                                        setExercises((prev) =>
                                          prev.map((ex, i) =>
                                            i === exIdx
                                              ? {
                                                  ...ex,
                                                  sets: insertDropSetAfter(ex.sets, setIdx, exWeightStep, newId),
                                                }
                                              : ex,
                                          ),
                                        );
                                        setOpenSetMenuId(null);
                                      }}
                                    >
                                      + 递减组 (80%)
                                    </button>
                                    <button
                                      type="button"
                                      className="set-action-pill"
                                      onClick={() => {
                                        triggerHaptic("light");
                                        setExercises((prev) =>
                                          prev.map((ex, i) =>
                                            i === exIdx
                                              ? { ...ex, sets: insertRestPauseSetAfter(ex.sets, setIdx, newId) }
                                              : ex,
                                          ),
                                        );
                                        setOpenSetMenuId(null);
                                      }}
                                    >
                                      + 休停组
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  className="set-action-pill"
                                  onClick={() => {
                                    setOpenSetMenuId(null);
                                    setEditingSetNoteId(s.id);
                                  }}
                                >
                                  {s.note ? "编辑备注" : "+ 组备注"}
                                </button>
                              </div>
                            </div>
                            <div className="set-action-section">
                              <span className="set-action-label">组后休息</span>
                              <div className="set-action-pills">
                                {([undefined, 0, 60, 90, 120, 180] as const).map((sec) => (
                                  <button
                                    key={sec ?? "default"}
                                    type="button"
                                    className="set-action-pill"
                                    aria-pressed={s.restAfterSeconds === sec}
                                    onClick={() => {
                                      triggerHaptic("light");
                                      updateSet(exIdx, setIdx, (cur) => {
                                        const next = { ...cur };
                                        if (sec == null) delete next.restAfterSeconds;
                                        else next.restAfterSeconds = sec;
                                        return next;
                                      });
                                      setOpenSetMenuId(null);
                                    }}
                                  >
                                    {sec == null ? "默认" : sec === 0 ? "免休" : `${sec}s`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {hasInlineMeta ? (
                          <div className="set-inline-meta">
                            {platesInfo?.valid ? (
                              <div className="set-inline-top">
                                <span className="set-plate-line">
                                  {barWeight}kg杆 每侧 {platesInfo.plates.length ? platesInfo.plates.join(" + ") : "空杆"}
                                  {!platesInfo.achievable && platesInfo.remainder > 0 ? ` (余 ${platesInfo.remainder}kg)` : ""}
                                </span>
                                {deltaHint ? <span className="set-plate-delta">{deltaHint}</span> : null}
                              </div>
                            ) : null}
                            {showSetRefChip || overloadCue || s.restAfterSeconds != null || s.note || editingSetNoteId === s.id ? (
                              <div className="set-inline-top">
                                {overloadCue ? (
                                  <span
                                    className={`set-overload-badge is-${overloadCue.tone}`}
                                    title={overloadCue.detail}
                                  >
                                    {overloadCue.badge}
                                  </span>
                                ) : null}
                                {s.restAfterSeconds != null ? (
                                  <span className="set-rest-override-badge">
                                    {s.restAfterSeconds === 0 ? "组后免休" : `组后休 ${s.restAfterSeconds}s`}
                                  </span>
                                ) : null}
                                {showSetRefChip && setRef ? (
                                  <button
                                    type="button"
                                    className="set-ref-chip"
                                    onClick={() => {
                                      triggerHaptic("light");
                                      updateSet(exIdx, setIdx, (cur) => ({
                                        ...cur,
                                        ...(isTimed
                                          ? { seconds: setRef.seconds }
                                          : { weight: setRef.weight, reps: setRef.reps || cur.reps }),
                                      }));
                                    }}
                                  >
                                    上次 {isTimed ? `${setRef.seconds}s` : isAssisted ? `辅助${setRef.weight}×${setRef.reps}` : `${setRef.weight}×${setRef.reps}`} · 填入
                                  </button>
                                ) : null}
                                {editingSetNoteId === s.id ? (
                                  <input
                                    type="text"
                                    className="set-note-input"
                                    maxLength={200}
                                    autoFocus
                                    placeholder="单组备注（如：暂停推 / 左肩微紧）"
                                    value={s.note ?? ""}
                                    onChange={(e) =>
                                      updateSet(exIdx, setIdx, (cur) => ({ ...cur, note: e.target.value }))
                                    }
                                    onBlur={() => setEditingSetNoteId(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === "Escape") {
                                        e.preventDefault();
                                        setEditingSetNoteId(null);
                                      }
                                    }}
                                  />
                                ) : s.note ? (
                                  <button
                                    type="button"
                                    className="set-note-chip has-note"
                                    onClick={() => setEditingSetNoteId(s.id)}
                                  >
                                    备注：{s.note}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {undoDeletedSet && undoDeletedSet.exIdx === exIdx ? (
                    <div className="set-undo-bar" role="status">
                      <span>已删除「{undoDeletedSet.exName}」第 {undoDeletedSet.setIdx + 1} 组</span>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ minHeight: 28, padding: "2px 10px", fontSize: 12 }}
                        onClick={() => {
                          const restore = undoDeletedSet;
                          if (undoSetTimerRef.current !== null) {
                            window.clearTimeout(undoSetTimerRef.current);
                            undoSetTimerRef.current = null;
                          }
                          setExercises((prev) =>
                            prev.map((ex, i) => {
                              if (i !== restore.exIdx) return ex;
                              const next = [...ex.sets];
                              const pos = Math.min(restore.setIdx, next.length);
                              next.splice(pos, 0, restore.set);
                              return { ...ex, sets: next };
                            }),
                          );
                          setUndoDeletedSet(null);
                          triggerHaptic("light");
                          notify("已撤销删除该组");
                        }}
                      >
                        撤销
                      </button>
                    </div>
                  ) : null}

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
                      {row.sets.filter((s) => !s.completed && s.type !== "warmup").length > 1 ? (
                        <>
                          <button
                            type="button"
                            className="sets-foot-pill sets-auto-sync-pill"
                            aria-pressed={autoSyncSubsequent}
                            title="开启后修改当前组重量或次数会自动同步到后续未完成工作组"
                            onClick={() => {
                              const next = !autoSyncSubsequent;
                              updatePref("autoSyncSubsequent", next);
                              triggerHaptic("light");
                              notify(
                                next
                                  ? "已开启：修改重量或次数将默认同步后续组"
                                  : "已关闭自动同步后续，可手动点击「同步后续」",
                              );
                            }}
                          >
                            {autoSyncSubsequent ? "自动同步后续: 开" : "自动同步: 关"}
                          </button>
                          {!autoSyncSubsequent ? (
                            <button
                              type="button"
                              className="sets-foot-pill"
                              title="将当前有效重量与次数同步到后续未完成工作组"
                              onClick={() => syncRemainingSets(exIdx)}
                            >
                              同步后续
                            </button>
                          ) : null}
                        </>
                      ) : null}
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
            })}
            {viewMode === "single" && !isHistoricalEdit && exercises.length > 1 ? (
              <p className="workout-swipe-hint">
                ← 左右滑动切换动作 · {safeExIdx + 1} / {exercises.length} →
              </p>
            ) : null}
          </div>
        )}

        {viewMode === "all" || isHistoricalEdit ? (
          <button
            type="button"
            className="secondary-button workout-inline-add-btn"
            onClick={openAddExercisePicker}
          >
            <Icon name="plus" size={16} /> 添加动作
          </button>
        ) : null}

        <p className="form-error" role="alert" hidden={!error}>
          {error}
        </p>
      </div>

      {!isHistoricalEdit && exercises.length > 0 && viewMode === "single" ? (
        <div className="workout-pager-bar">
          <button
            type="button"
            className="secondary-button workout-pager-prev"
            disabled={safeExIdx <= 0}
            onClick={() => goToExercise(safeExIdx - 1)}
          >
            ← 上一个
          </button>
          <div className="workout-pager-meta">
            <strong>
              {safeExIdx + 1} / {exercises.length}
            </strong>
            <small>
              {safeExIdx < exercises.length - 1
                ? `下一项：${exercises[safeExIdx + 1]?.snapshot?.name ?? "下一动作"}`
                : "最后一项动作"}
            </small>
          </div>
          {safeExIdx < exercises.length - 1 ? (
            <button
              type="button"
              className="primary-button workout-pager-next"
              onClick={() => goToExercise(safeExIdx + 1)}
            >
              下一个动作 →
            </button>
          ) : (
            <button
              type="button"
              className="primary-button workout-pager-next is-finish"
              disabled={saving}
              onClick={() => {
                triggerHaptic("light");
                setError("");
                setFinishPanelOpen(true);
              }}
            >
              完成并结束
            </button>
          )}
        </div>
      ) : null}

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
                    setRest((cur) => shiftRestTimer(cur, -restAdjustStep));
                  }}
                >
                  −{restAdjustStep}s
                </button>
                <button
                  type="button"
                  className="rest-pill-btn"
                  onClick={() => {
                    triggerHaptic("light");
                    setRest((cur) => shiftRestTimer(cur, restAdjustStep));
                  }}
                >
                  +{restAdjustStep}s
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
