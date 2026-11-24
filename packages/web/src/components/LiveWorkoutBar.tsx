import { useEffect, useMemo, useRef, useState } from "react";
import { formatWeekdayZh } from "../lib/date";
import {
  findLocalWorkoutDraft,
  type WorkoutExercise,
} from "../lib/domain";
import {
  createRestAudio,
  elapsedAt,
  formatClock,
  normalizeRestTimer,
  restProgress,
  shiftRestTimer,
  triggerHaptic,
  type RestTimerState,
  type WorkoutTiming,
} from "../lib/haptics-audio";
import { resumeLocalWorkoutDraft } from "../lib/record-openers";
import {
  WORKOUT_PREFS_EVENT,
  readWorkoutPreferences,
  type WorkoutPreferences,
} from "../lib/workout-helpers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";
import { Icon } from "./Icon";

interface ParsedLiveDraft {
  key: string;
  recordId?: string;
  title: string;
  date?: string;
  exercises: WorkoutExercise[];
  timing: WorkoutTiming;
  rest: RestTimerState | null;
}

function readParsedDraft(userId: string): ParsedLiveDraft | null {
  if (!userId) return null;
  const found = findLocalWorkoutDraft(userId);
  if (!found) return null;
  try {
    const parsed = JSON.parse(found.raw) as {
      title?: string;
      date?: string;
      exercises?: WorkoutExercise[];
      timing?: WorkoutTiming;
      rest?: RestTimerState | null;
    };
    const prefix = `ironlog-web-draft:${userId}:`;
    const suffix = found.key.startsWith(prefix) ? found.key.slice(prefix.length) : "new";
    const recordId = suffix && suffix !== "new" ? suffix : undefined;
    return {
      key: found.key,
      recordId,
      title: parsed.title?.trim() || "自由训练",
      date: parsed.date,
      exercises: Array.isArray(parsed.exercises) ? parsed.exercises : [],
      timing: parsed.timing ?? { elapsedSeconds: 0, runningSince: new Date().toISOString() },
      rest: normalizeRestTimer(parsed.rest ?? null),
    };
  } catch {
    return null;
  }
}

export function LiveWorkoutBar() {
  const userId = useAuthStore((s) => s.userId);
  const modals = useUiStore((s) => s.modals);
  const notify = useUiStore((s) => s.notify);

  const hasWorkoutOpen = modals.some((m) => m.layout === "workout");
  const [draft, setDraft] = useState<ParsedLiveDraft | null>(() => (hasWorkoutOpen ? null : readParsedDraft(userId)));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [resuming, setResuming] = useState(false);
  const [prefs, setPrefs] = useState<WorkoutPreferences>(() => readWorkoutPreferences());

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const audio = useMemo(
    () =>
      createRestAudio(
        () => prefsRef.current.soundOn,
        () => prefsRef.current.soundStyle,
      ),
    [],
  );
  const firedRestEndRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setPrefs(readWorkoutPreferences());
    window.addEventListener(WORKOUT_PREFS_EVENT, sync);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, sync);
  }, []);

  useEffect(() => {
    if (hasWorkoutOpen || !userId) {
      setDraft(null);
      return;
    }
    const refresh = () => {
      setDraft(readParsedDraft(userId));
      setNowMs(Date.now());
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [userId, hasWorkoutOpen, modals.length]);

  useEffect(() => {
    if (!draft?.rest || draft.rest.pausedLeftMs != null) return;
    if (nowMs >= draft.rest.end && firedRestEndRef.current !== draft.rest.end) {
      firedRestEndRef.current = draft.rest.end;
      if (nowMs - draft.rest.end <= 60_000) {
        audio.play(true);
        notify("组间休息结束 · 准备下一组");
      }
      try {
        const raw = localStorage.getItem(draft.key);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          parsed.rest = null;
          localStorage.setItem(draft.key, JSON.stringify(parsed));
          setDraft((prev) => (prev ? { ...prev, rest: null } : prev));
        }
      } catch {}
    }
  }, [draft, nowMs, audio, notify]);

  if (!userId || hasWorkoutOpen || !draft) return null;

  const elapsed = elapsedAt(draft.timing, nowMs);
  const restInfo = draft.rest ? restProgress(draft.rest, nowMs) : null;
  let totalSets = 0;
  let doneSets = 0;
  for (const ex of draft.exercises) {
    for (const s of ex.sets ?? []) {
      totalSets++;
      if (s.completed) doneSets++;
    }
  }

  const handleResume = async () => {
    if (resuming) return;
    triggerHaptic("light");
    setResuming(true);
    try {
      await resumeLocalWorkoutDraft(userId);
    } finally {
      setResuming(false);
    }
  };

  const handleExtendRest = () => {
    if (!draft.rest) return;
    triggerHaptic("light");
    const nextRest = shiftRestTimer(draft.rest, prefs.restAdjustStep);
    try {
      const raw = localStorage.getItem(draft.key);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        parsed.rest = nextRest;
        localStorage.setItem(draft.key, JSON.stringify(parsed));
      }
    } catch {}
    setDraft((prev) => (prev ? { ...prev, rest: nextRest } : prev));
    setNowMs(Date.now());
  };

  return (
    <div className="live-workout-bar" role="region" aria-label="进行中的训练控制条">
      <button
        type="button"
        className="live-workout-bar-main"
        disabled={resuming}
        onClick={() => void handleResume()}
      >
        <span className="training-led" aria-hidden="true" />
        <span className="live-workout-bar-copy">
          <strong>{draft.title}</strong>
          <small>
            {formatClock(elapsed)} · {doneSets}/{totalSets} 组
            {draft.date ? ` · ${formatWeekdayZh(draft.date)}` : ""}
          </small>
        </span>
      </button>

      {restInfo ? (
        <div className="live-workout-bar-rest">
          <span className="live-rest-pill">
            <Icon name="rest" size={13} />
            休息 {formatClock(restInfo.seconds)}
          </span>
          <button
            type="button"
            className="live-rest-plus"
            title={`组间休息加 ${prefs.restAdjustStep} 秒`}
            onClick={handleExtendRest}
          >
            +{prefs.restAdjustStep}s
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="primary-button live-workout-bar-resume"
        disabled={resuming}
        onClick={() => void handleResume()}
      >
        {resuming ? "恢复中" : "继续训练"}
      </button>
    </div>
  );
}
