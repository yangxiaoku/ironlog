import { useEffect, useRef, useState, type MouseEvent } from "react";
import { apiFetch } from "../../lib/api";
import {
  buildAppleCardioLaunchUrl,
  buildAppleHubActionUrl,
  isAppleMobileDevice,
  triggerAppleCardioLaunch,
} from "../../lib/apple-fitness";
import {
  CARDIO_SESSION_EVENT,
  CARDIO_TARGET_MINUTES_OPTIONS,
  buildCardioWorkoutMutation,
  clearCardioSession,
  estimateCardioCalories,
  finishCardioTiming,
  formatCardioPaceOrSpeed,
  formatStartClock,
  readCardioSession,
  recordCardioLap,
  requestCardioAppleSync,
  saveCardioSession,
  toggleCardioSessionPause,
  type LiveCardioSession,
} from "../../lib/cardio-session";
import { FEELINGS, type FeelingKey, type RecordEnvelope, type WorkoutData } from "../../lib/domain";
import {
  elapsedAt,
  formatClock,
  keepWorkoutScreenAwake,
  triggerHaptic,
} from "../../lib/haptics-audio";
import { WORKOUT_PREFS_EVENT, readWorkoutPreferences } from "../../lib/workout-helpers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

const DOT_SEGMENTS = 24;

export function CardioSessionModal({
  onFinishedLocal,
  onOpenLauncher,
}: {
  onFinishedLocal?: (saved: RecordEnvelope<WorkoutData>) => void;
  onOpenLauncher?: () => void;
}) {
  const userId = useAuthStore((s) => s.userId);
  const closeTopModal = useUiStore((s) => s.closeTopModal);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const notify = useUiStore((s) => s.notify);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);

  const [session, setSession] = useState<LiveCardioSession | null>(() => readCardioSession(userId));
  const [prefs, setPrefs] = useState(() => readWorkoutPreferences());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [savingLocal, setSavingLocal] = useState(false);
  const savingRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isRunningRef = useRef(Boolean(session?.timing.runningSince));
  isRunningRef.current = Boolean(session?.timing.runningSince);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPrefs = () => setPrefs(readWorkoutPreferences());
    window.addEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const wake = keepWorkoutScreenAwake(() => isRunningRef.current, () => {});
    wake.update();
    return () => wake.stop();
  }, [Boolean(session?.timing.runningSince)]);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const syncSession = () => {
      setSession(readCardioSession(userId));
      setNowMs(Date.now());
    };
    syncSession();
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    const onVisible = () => {
      if (document.visibilityState === "visible") syncSession();
    };
    window.addEventListener(CARDIO_SESSION_EVENT, syncSession);
    window.addEventListener("focus", syncSession);
    window.addEventListener("pageshow", syncSession);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(CARDIO_SESSION_EVENT, syncSession);
      window.removeEventListener("focus", syncSession);
      window.removeEventListener("pageshow", syncSession);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  if (!session) {
    return (
      <div className="dialog-form cardio-session-empty">
        <p className="muted">当前没有进行中的有氧计时。</p>
        <footer>
          {onOpenLauncher ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                triggerHaptic("light");
                closeTopModal();
                onOpenLauncher();
              }}
            >
              <Icon name="heart" size={15} /> 选择有氧方式开始
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={closeTopModal}>
            关闭
          </button>
        </footer>
      </div>
    );
  }

  const onIos = isAppleMobileDevice();
  const isRunning = Boolean(session.timing.runningSince);
  const elapsedSeconds = elapsedAt(session.timing, nowMs);
  const estKcal = estimateCardioCalories(session.activityType, elapsedSeconds);
  const paceOrSpeed = formatCardioPaceOrSpeed(session.activityType, elapsedSeconds, session.distanceKm);
  const targetSeconds = session.targetMinutes ? session.targetMinutes * 60 : null;
  const targetProgress = targetSeconds ? Math.min(1, elapsedSeconds / targetSeconds) : null;
  const targetDelta = targetSeconds ? targetSeconds - elapsedSeconds : null;
  const lastLap = session.laps.at(-1) ?? null;
  const currentSplitSeconds = Math.max(0, elapsedSeconds - (lastLap?.cumulativeSeconds ?? 0));

  const litSegments = targetProgress != null
    ? Math.max(elapsedSeconds > 0 ? 1 : 0, Math.round(targetProgress * DOT_SEGMENTS))
    : elapsedSeconds > 0
      ? Math.max(1, Math.round(((elapsedSeconds % 60 || 60) / 60) * DOT_SEGMENTS))
      : 0;

  const endShortcutUrl = buildAppleHubActionUrl("end", prefs);
  const relaunchUrl = onIos ? buildAppleCardioLaunchUrl(session.presetId, prefs) : null;

  const commitSession = (next: LiveCardioSession) => {
    setSession(next);
    if (!saveCardioSession(userId, next)) notify("浏览器存储不可用，请在关闭页面前保存记录");
    setNowMs(Date.now());
  };

  const handleTogglePause = () => {
    triggerHaptic("light");
    commitSession(toggleCardioSessionPause(session, Date.now()));
  };

  const handleLap = () => {
    triggerHaptic("medium");
    commitSession(recordCardioLap(session, Date.now()));
  };

  const handleTargetChange = (minutes: number | null) => {
    triggerHaptic("light");
    commitSession({ ...session, targetMinutes: minutes });
  };

  const handleFinishWithShortcut = (event: MouseEvent<HTMLAnchorElement>) => {
    if (savingRef.current || !requestCardioAppleSync(userId, session)) {
      event.preventDefault();
      if (!savingRef.current) notify("浏览器无法保存计时，请先保存本次记录");
      return;
    }
    triggerHaptic("light");
    notify("已请求 Apple 同步。收到对应训练后会清除计时");
  };

  const handleSaveLocalCardio = async () => {
    if (savingRef.current) return;
    const finished = finishCardioTiming(session);
    const body = buildCardioWorkoutMutation(finished);
    savingRef.current = true;
    setSavingLocal(true);
    commitSession(finished);
    try {
      const res = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
        method: "POST",
        body,
      });
      if (!res.record) throw new Error("服务器未确认保存，请重试");
      if (readCardioSession(userId)?.id === session.id) clearCardioSession(userId);
      triggerHaptic("success");
      bumpDataEpoch();
      notify(`已保存「${session.label}」· ${formatClock(finished.timing.elapsedSeconds)}`);
      if (onFinishedLocal) {
        onFinishedLocal(res.record);
      } else {
        closeTopModal();
      }
    } catch (err) {
      notify((err as Error)?.message || "保存有氧记录失败");
    } finally {
      savingRef.current = false;
      setSavingLocal(false);
    }
  };

  const handleDiscard = () => {
    triggerHaptic("light");
    openConfirm({
      title: "放弃本次有氧计时",
      message: `确定放弃进行中的「${session.label}」（${formatClock(elapsedSeconds)}）吗？不会向服务器写入记录。`,
      confirmLabel: "放弃计时",
      onConfirm: () => {
        clearCardioSession(userId);
        notify("已放弃本次有氧计时");
        closeTopModal();
      },
    });
  };

  return (
    <div className="cardio-stage">
      <header className="cardio-topbar">
        <button
          type="button"
          className="workout-circle-btn"
          aria-label="后台计时"
          title="后台计时"
          onClick={() => {
            triggerHaptic("light");
            notify("有氧计时已转入顶部状态栏，切后台也会继续走表");
            closeTopModal();
          }}
        >
          <Icon name="arrowDown" size={16} />
        </button>

        <div className={`workout-topbar-center cardio-topbar-title${isRunning ? "" : " is-paused"}`}>
          <strong>{session.label}</strong>
          <span className="workout-topbar-sub">
            <i className="live-led" aria-hidden="true" />
            <span>{session.appleSyncRequestedAt ? "等待 Apple 回传" : isRunning ? "计时中" : "已暂停"}</span>
            <span aria-hidden="true">·</span>
            <span>{session.environment === "outdoor" ? "室外" : "室内"}</span>
            <span aria-hidden="true">·</span>
            <span>{formatStartClock(session.startedAt)}</span>
          </span>
        </div>

        <div className="workout-topbar-actions">
          {relaunchUrl ? (
            <a
              href={relaunchUrl}
              className="workout-circle-btn"
              aria-label="打开健身 App"
              title="打开健身 App"
              onClick={() => triggerHaptic("light")}
            >
              <Icon name="heart" size={15} />
            </a>
          ) : (
            <button
              type="button"
              className="workout-circle-btn"
              aria-label="打开健身 App"
              title="打开健身 App"
              onClick={() => {
                triggerHaptic("light");
                triggerAppleCardioLaunch(session.presetId, { prefs, notify });
              }}
            >
              <Icon name="heart" size={15} />
            </button>
          )}
          <button
            type="button"
            className="workout-circle-btn"
            aria-label="更多选项"
            title="记录距离与更多操作"
            aria-expanded={menuOpen}
            onClick={() => {
              triggerHaptic("light");
              setMenuOpen(true);
            }}
          >
            <Icon name="more" size={16} />
          </button>
        </div>
      </header>

      <div className="cardio-body">
        <section className="cardio-chrono" aria-label="有氧秒表">
          <div className={`cardio-digits${isRunning ? "" : " is-paused"}`} aria-live="off">
            {formatClock(elapsedSeconds)}
          </div>
          <div className="cardio-chrono-meta">
            {targetDelta != null
              ? targetDelta >= 0
                ? `距 ${session.targetMinutes} 分目标还剩 ${formatClock(targetDelta)}`
                : `已超出 ${session.targetMinutes} 分目标 +${formatClock(Math.abs(targetDelta))}`
              : session.laps.length > 0
                ? `第 ${session.laps.length + 1} 段 · ${formatClock(currentSplitSeconds)}`
                : `${session.appleWorkoutLabel} · 后台持续走表`}
          </div>

          <div
            className="dot-meter cardio-dot-meter"
            role={targetProgress != null ? "progressbar" : "img"}
            aria-label={targetProgress != null ? "目标时长进度" : "分钟秒表刻度"}
            aria-valuenow={targetProgress != null ? Math.round(targetProgress * 100) : undefined}
            aria-valuemin={targetProgress != null ? 0 : undefined}
            aria-valuemax={targetProgress != null ? 100 : undefined}
          >
            {Array.from({ length: DOT_SEGMENTS }, (_, idx) => (
              <i key={idx} className={idx < litSegments ? "lit" : undefined} />
            ))}
          </div>

          <div className="cardio-targets" role="group" aria-label="设定有氧目标时长">
            {CARDIO_TARGET_MINUTES_OPTIONS.map((mins) => {
              const active = session.targetMinutes === mins;
              return (
                <button
                  key={mins ?? "open"}
                  type="button"
                  className={active ? "is-active" : undefined}
                  aria-pressed={active}
                  onClick={() => handleTargetChange(mins)}
                >
                  {mins == null ? "开放目标" : `${mins} 分`}
                </button>
              );
            })}
          </div>
        </section>

        <section className="cardio-metrics" aria-label="实时数据">
          <div>
            <span>{session.laps.length > 0 ? `当前第 ${session.laps.length + 1} 段` : "当前分段"}</span>
            <strong>{formatClock(currentSplitSeconds)}</strong>
          </div>
          <div>
            <span>参考消耗</span>
            <strong>~{estKcal} kcal</strong>
          </div>
          <div>
            <span>{paceOrSpeed ? paceOrSpeed.label : "开始时间"}</span>
            <strong>{paceOrSpeed ? paceOrSpeed.value : formatStartClock(session.startedAt)}</strong>
          </div>
        </section>

        {session.laps.length > 0 ? (
          <section className="cardio-splits" aria-label="分段计圈">
            <header>
              <span>分段计圈</span>
              <span>{session.laps.length} 段</span>
            </header>
            <ol>
              {[...session.laps].reverse().map((lap) => (
                <li key={lap.id}>
                  <span>第 {String(lap.index).padStart(2, "0")} 段</span>
                  <strong>+{formatClock(lap.splitSeconds)}</strong>
                  <small>{formatClock(lap.cumulativeSeconds)}</small>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>

      <footer className="cardio-dock">
        <div className="cardio-dock-controls">
          <button
            type="button"
            className={`cardio-dock-btn${isRunning ? "" : " is-resume"}`}
            onClick={handleTogglePause}
          >
            <Icon name={isRunning ? "pause" : "play"} size={16} />
            <span>{isRunning ? "暂停计时" : "继续计时"}</span>
          </button>
          <button type="button" className="cardio-dock-btn" onClick={handleLap}>
            <Icon name="dial" size={16} />
            <span>记分段</span>
          </button>
        </div>

        {onIos ? (
          <a
            href={endShortcutUrl}
            className="cardio-dock-finish"
            onClick={handleFinishWithShortcut}
          >
            <Icon name="upload" size={16} />
            <span>{session.appleSyncRequestedAt ? "重试 Apple Watch 同步" : "结束有氧并同步 Apple Watch"}</span>
          </a>
        ) : (
          <button
            type="button"
            className="cardio-dock-finish"
            disabled={savingLocal}
            onClick={() => void handleSaveLocalCardio()}
          >
            <Icon name="check" size={16} />
            <span>{savingLocal ? "保存中…" : "结束并保存记录"}</span>
          </button>
        )}
      </footer>

      <div className="session-menu-overlay" hidden={!menuOpen} aria-label="有氧附加选项">
        <header className="dialog-head" style={{ marginBottom: 4 }}>
          <h2>记录与联动选项</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="收起选项"
            onClick={() => {
              triggerHaptic("light");
              setMenuOpen(false);
            }}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="session-menu-body">
          <label className="field">
            <span>距离（km · 跑步机或室内单车可补填计算配速）</span>
            <input
              type="text"
              inputMode="decimal"
              maxLength={80}
              placeholder="例如 5.0"
              value={session.distanceKm}
              onChange={(e) => commitSession({ ...session, distanceKm: e.target.value })}
            />
          </label>

          <div className="field">
            <span>主观体感</span>
            <div className="segments" role="group" aria-label="选择体感强度">
              {(["easy", "balanced", "fatigued"] as readonly FeelingKey[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  aria-pressed={session.feeling === lvl}
                  onClick={() => {
                    triggerHaptic("light");
                    commitSession({ ...session, feeling: session.feeling === lvl ? null : lvl });
                  }}
                >
                  {FEELINGS[lvl]}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>训练备注</span>
            <input
              type="text"
              placeholder="坡度、配速节奏、心率区间等"
              maxLength={4000}
              value={session.notes}
              onChange={(e) => commitSession({ ...session, notes: e.target.value })}
            />
          </label>

          <div className="cardio-menu-meta">
            <span>结束联动快捷指令</span>
            <code>{prefs.appleHubShortcutName}</code>
          </div>
        </div>

        <footer className="cardio-menu-foot">
          <button
            type="button"
            className="secondary-button"
            disabled={savingLocal}
            onClick={() => void handleSaveLocalCardio()}
          >
            <Icon name="check" size={15} /> {savingLocal ? "保存中..." : "仅结束并保存记录"}
          </button>
          <button type="button" className="danger" onClick={handleDiscard}>
            放弃本次计时
          </button>
        </footer>
      </div>
    </div>
  );
}
