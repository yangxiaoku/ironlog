import { localDate } from "@ironlog/shared";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { apiFetch } from "../lib/api";
import { buildAppleHubActionUrl, isAppleMobileDevice } from "../lib/apple-fitness";
import {
  CARDIO_SESSION_EVENT,
  buildCardioAppleAnnotation,
  clearCardioSession,
  matchesCardioAppleWorkout,
  readCardioSession,
  requestCardioAppleSync,
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
  pauseRestTimer,
  restProgress,
  resumeRestTimer,
  shiftRestTimer,
  triggerHaptic,
  triggerRestFinalCountdownBeep,
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
    if (!userId) return;
    let disposed = false;
    let checking = false;
    let lastCheckedAt = 0;
    const check = async (force = false) => {
      const session = readCardioSession(userId);
      if (checking || document.visibilityState !== "visible" || !session?.appleSyncRequestedAt) return;
      const waitedMs = Date.now() - Date.parse(session.appleSyncRequestedAt);
      // #74: Continue checking at a slower interval (20s) even after 90s while the tab stays visible,
      // so late-arriving Apple Health uploads still attach automatically without needing a tab switch.
      if (!force && waitedMs > 90_000 && Date.now() - lastCheckedAt < 20_000) return;
      checking = true;
      lastCheckedAt = Date.now();
      try {
        const from = localDate(Date.parse(session.startedAt));
        const through = localDate(Math.max(Date.now(), Date.parse(session.appleSyncRequestedAt)));
        const rows = await apiFetch<Array<Parameters<typeof matchesCardioAppleWorkout>[1] & { id: string }>>(
          `/api/integrations/apple-health/agenda?from=${from}&through=${through}`,
          { accountId: userId },
        );
        const current = readCardioSession(userId);
        const matched = rows.filter((row) => matchesCardioAppleWorkout(session, row));
        if (disposed || current?.id !== session.id || current.appleSyncRequestedAt !== session.appleSyncRequestedAt ||
          matched.length !== 1) return;
        const annotation = { ...buildCardioAppleAnnotation(current), source: "cardio_session" as const };
        const { ok } = await apiFetch<{ ok: boolean }>(
          `/api/integrations/apple-health/workouts/${encodeURIComponent(matched[0]!.id)}/annotation`,
          { method: "PUT", body: annotation, accountId: userId, skipMutateHook: true },
        );
        if (!ok) return;
        const saved = readCardioSession(userId);
        if (disposed || saved?.id !== session.id || saved.appleSyncRequestedAt !== session.appleSyncRequestedAt ||
          JSON.stringify(buildCardioAppleAnnotation(saved)) !== JSON.stringify(buildCardioAppleAnnotation(current))) return;
        clearCardioSession(userId);
        bumpDataEpoch();
        notify(`已收到「${session.label}」的 Apple 训练`);
      } catch (err) {
        if ((err as { status?: number })?.status === 409) {
          notify((err as Error)?.message || "该 Apple 训练已被另一场计时备注占用");
        }
      } finally {
        checking = false;
      }
    };
    const onReturn = () => void check(true);
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const timer = window.setInterval(() => void check(), 6500);
    onReturn();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [userId, bumpDataEpoch, notify]);

  useEffect(() => {
    if (!draft?.rest || draft.rest.pausedLeftMs != null) return;
    const leftSec = Math.ceil((draft.rest.end - nowMs) / 1000);
    if (leftSec >= 1 && leftSec <= 3 && nowMs < draft.rest.end) {
      triggerRestFinalCountdownBeep(draft.rest.end, leftSec, audio);
    }
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

  const handleFinishCardioShortcut = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!cardioSession || !requestCardioAppleSync(userId, cardioSession)) {
      event.preventDefault();
      notify("浏览器无法保存计时，请打开有氧计时页保存");
      return;
    }
    triggerHaptic("light");
    notify("已请求 Apple 同步，计时会保留到收到对应训练");
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

  const persistRestUpdate = (nextRest: RestTimerState | null) => {
    if (!draft) return;
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

  const handleExtendRest = () => {
    if (!draft?.rest) return;
    triggerHaptic("light");
    audio.unlock();
    persistRestUpdate(shiftRestTimer(draft.rest, prefs.restAdjustStep));
  };

  const handleTogglePauseRest = () => {
    if (!draft?.rest) return;
    triggerHaptic("light");
    const nextRest =
      draft.rest.pausedLeftMs != null
        ? resumeRestTimer(draft.rest, Date.now())
        : pauseRestTimer(draft.rest, Date.now());
    persistRestUpdate(nextRest);
  };

  const handleSkipRest = () => {
    if (!draft?.rest) return;
    triggerHaptic("light");
    persistRestUpdate(null);
    notify("已跳过组间休息");
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
                {cardioSession.appleSyncRequestedAt ? " · 等待 Apple 回传" : cardioSession.timing.runningSince ? " · 后台计时中" : " · 已暂停"}
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
                onClick={handleFinishCardioShortcut}
              >
                <Icon name="upload" size={13} /> {cardioSession.appleSyncRequestedAt ? "重试同步" : "结束同步"}
              </a>
            ) : (
              <button
                type="button"
                className="primary-button live-cardio-end-btn"
                onClick={openCardioSessionModal}
              >
                <Icon name="check" size={13} /> 保存计时
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
                {restInfo.paused ? "已暂停" : "休息"} {formatClock(restInfo.seconds)}
              </span>
              <button
                type="button"
                className="live-rest-plus"
                title={restInfo.paused ? "继续休息倒计时" : "暂停休息倒计时"}
                onClick={handleTogglePauseRest}
              >
                {restInfo.paused ? "继续" : "暂停"}
              </button>
              <button
                type="button"
                className="live-rest-plus"
                title={`组间休息加 ${prefs.restAdjustStep} 秒`}
                onClick={handleExtendRest}
              >
                +{prefs.restAdjustStep}s
              </button>
              <button
                type="button"
                className="live-rest-plus"
                title="跳过本次组间休息"
                onClick={handleSkipRest}
              >
                跳过
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
