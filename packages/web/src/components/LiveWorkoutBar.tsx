import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { buildAppleHubActionUrl, isAppleMobileDevice, triggerAppleHubAction } from "../lib/apple-fitness";
import {
  CARDIO_SESSION_EVENT,
  clearCardioSession,
  readCardioSession,
  type LiveCardioSession,
} from "../lib/cardio-session";
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
import { openCardioSessionModal, resumeLocalWorkoutDraft } from "../lib/record-openers";
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
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);

  const hasWorkoutOpen = modals.some((m) => m.layout === "workout");
  const hasCardioOpen = modals.some((m) => m.layout === "cardio");
  const [draft, setDraft] = useState<ParsedLiveDraft | null>(() => (hasWorkoutOpen ? null : readParsedDraft(userId)));
  const [cardioSession, setCardioSession] = useState<LiveCardioSession | null>(() =>
    hasCardioOpen ? null : readCardioSession(userId),
  );
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
    if (!userId) {
      setDraft(null);
      setCardioSession(null);
      return;
    }
    const refresh = () => {
      setDraft(hasWorkoutOpen ? null : readParsedDraft(userId));
      setCardioSession(hasCardioOpen ? null : readCardioSession(userId));
      setNowMs(Date.now());
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(CARDIO_SESSION_EVENT, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(CARDIO_SESSION_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [userId, hasWorkoutOpen, hasCardioOpen, modals.length]);

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

  const showDraft = Boolean(userId && !hasWorkoutOpen && draft);
  const showCardio = Boolean(userId && !hasCardioOpen && cardioSession);
  if (!showDraft && !showCardio) return null;

  const onIos = isAppleMobileDevice();
  const endShortcutUrl = buildAppleHubActionUrl("end", prefs);

  const handleFinishCardioShortcut = (viaNativeLink = false) => {
    if (!cardioSession) return;
    triggerHaptic("success");
    void apiFetch("/api/integrations/apple-health/session-start", {
      method: "POST",
      body: {
        activityType: cardioSession.activityType,
        environment: cardioSession.environment,
        startedAt: cardioSession.startedAt,
        onlyIfIdle: true,
      },
    }).catch(() => {});
    clearCardioSession(userId);
    setCardioSession(null);
    if (typeof window !== "undefined") {
      const onReturn = () => {
        if (document.visibilityState === "visible") {
          bumpDataEpoch();
          document.removeEventListener("visibilitychange", onReturn);
        }
      };
      document.addEventListener("visibilitychange", onReturn);
      window.setTimeout(() => {
        bumpDataEpoch();
        document.removeEventListener("visibilitychange", onReturn);
      }, 6500);
    }
    if (viaNativeLink) {
      notify(`已调用「${prefs.appleHubShortcutName}」结束并回传 Apple Watch 数据`);
      return;
    }
    triggerAppleHubAction("end", { prefs, notify });
  };

  const handleDiscardCardio = () => {
    if (!cardioSession) return;
    const label = cardioSession.label;
    triggerHaptic("light");
    openConfirm({
      title: "放弃进行中的有氧计时",
      message: `确定放弃「${label}」的后台计时吗？`,
      confirmLabel: "放弃计时",
      onConfirm: () => {
        clearCardioSession(userId);
        setCardioSession(null);
        notify("已清除有氧计时");
      },
    });
  };

  const elapsed = draft ? elapsedAt(draft.timing, nowMs) : 0;
  const restInfo = draft?.rest ? restProgress(draft.rest, nowMs) : null;
  let totalSets = 0;
  let doneSets = 0;
  if (draft) {
    for (const ex of draft.exercises) {
      for (const s of ex.sets ?? []) {
        totalSets++;
        if (s.completed) doneSets++;
      }
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
    if (!draft?.rest) return;
    triggerHaptic("light");
    audio.unlock();
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

  const handleDiscard = () => {
    if (!draft) return;
    const draftKey = draft.key;
    const draftTitle = draft.title;
    triggerHaptic("light");
    openConfirm({
      title: "放弃本地训练草稿",
      message: `确定放弃「${draftTitle}」的未保存草稿吗？`,
      confirmLabel: "放弃草稿",
      onConfirm: () => {
        try {
          localStorage.removeItem(draftKey);
        } catch {}
        setDraft(null);
        bumpDataEpoch();
        notify("已清除本地训练草稿");
      },
    });
  };

  const cardioElapsed = cardioSession ? elapsedAt(cardioSession.timing, nowMs) : 0;

  return (
    <div className="live-workout-bar-stack">
      {showCardio && cardioSession ? (
        <div className="live-workout-bar" role="region" aria-label="进行中的有氧计时控制条">
          <button
            type="button"
            className="live-workout-bar-main"
            onClick={() => {
              triggerHaptic("light");
              openCardioSessionModal();
            }}
          >
            <span className="training-led" aria-hidden="true" />
            <span className="live-workout-bar-copy">
              <strong>{cardioSession.label}</strong>
              <small>
                {formatClock(cardioElapsed)}
                {cardioSession.timing.runningSince ? " · 后台计时中" : " · 已暂停"}
                {cardioSession.targetMinutes ? ` · 目标 ${cardioSession.targetMinutes}m` : ""}
              </small>
            </span>
          </button>

          <div className="live-workout-bar-actions">
            <button
              type="button"
              className="secondary-button live-workout-bar-resume"
              onClick={() => {
                triggerHaptic("light");
                openCardioSessionModal();
              }}
            >
              打开计时
            </button>
            {onIos ? (
              <a
                href={endShortcutUrl}
                className="primary-button live-cardio-end-btn"
                style={{ textDecoration: "none" }}
                onClick={() => handleFinishCardioShortcut(true)}
              >
                <Icon name="upload" size={13} /> 结束同步
              </a>
            ) : (
              <button
                type="button"
                className="primary-button live-cardio-end-btn"
                onClick={() => handleFinishCardioShortcut(false)}
              >
                <Icon name="upload" size={13} /> 结束同步
              </button>
            )}
            <button
              type="button"
              className="live-workout-bar-discard"
              aria-label="放弃进行中的有氧计时"
              title="放弃计时"
              onClick={handleDiscardCardio}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {showDraft && draft ? (
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

          <div className="live-workout-bar-actions">
            <button
              type="button"
              className="primary-button live-workout-bar-resume"
              disabled={resuming}
              onClick={() => void handleResume()}
            >
              {resuming ? "恢复中" : "继续训练"}
            </button>
            <button
              type="button"
              className="live-workout-bar-discard"
              aria-label="放弃本地训练草稿"
              title="放弃草稿"
              onClick={handleDiscard}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
