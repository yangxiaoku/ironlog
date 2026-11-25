import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import {
  buildAppleCardioLaunchUrl,
  buildAppleHubActionUrl,
  isAppleMobileDevice,
  triggerAppleCardioLaunch,
  triggerAppleHubAction,
} from "../../lib/apple-fitness";
import {
  CARDIO_SESSION_EVENT,
  CARDIO_TARGET_MINUTES_OPTIONS,
  clearCardioSession,
  estimateCardioCalories,
  formatCardioPaceOrSpeed,
  formatStartClock,
  readCardioSession,
  recordCardioLap,
  saveCardioSession,
  toggleCardioSessionPause,
  type LiveCardioSession,
} from "../../lib/cardio-session";
import { today } from "../../lib/date";
import { FEELINGS, type FeelingKey, type RecordEnvelope, type WorkoutData } from "../../lib/domain";
import { elapsedAt, formatClock, pauseAt, triggerHaptic } from "../../lib/haptics-audio";
import { WORKOUT_PREFS_EVENT, readWorkoutPreferences } from "../../lib/workout-helpers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPrefs = () => setPrefs(readWorkoutPreferences());
    window.addEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
  }, []);

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

  const endShortcutUrl = buildAppleHubActionUrl("end", prefs);
  const relaunchUrl = onIos ? buildAppleCardioLaunchUrl(session.presetId, prefs) : null;

  const commitSession = (next: LiveCardioSession) => {
    setSession(next);
    saveCardioSession(userId, next);
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

  const schedulePostShortcutRefresh = () => {
    if (typeof window === "undefined") return;
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
  };

  const handleFinishWithShortcut = (viaNativeLink = false) => {
    triggerHaptic("success");
    void apiFetch("/api/integrations/apple-health/session-start", {
      method: "POST",
      body: {
        activityType: session.activityType,
        environment: session.environment,
        startedAt: session.startedAt,
        onlyIfIdle: true,
      },
    }).catch(() => {});
    clearCardioSession(userId);
    schedulePostShortcutRefresh();
    if (viaNativeLink) {
      notify(`已调用「${prefs.appleHubShortcutName}」结束并回传 Apple Watch 数据`);
      window.setTimeout(() => closeTopModal(), 260);
      return;
    }
    const res = triggerAppleHubAction("end", { prefs, notify });
    if (res.launched) {
      notify(`已调用「${prefs.appleHubShortcutName}」结束并回传 Apple Watch 数据`);
      window.setTimeout(() => closeTopModal(), 260);
    } else {
      closeTopModal();
    }
  };

  const handleSaveLocalCardio = async () => {
    if (savingLocal) return;
    triggerHaptic("success");
    setSavingLocal(true);
    try {
      const finishNow = Date.now();
      const finalTiming = pauseAt(session.timing, finishNow);
      const totalSec = Math.max(1, finalTiming.elapsedSeconds);
      const endedIso = new Date(finishNow).toISOString();
      const noteParts: string[] = [];
      if (session.distanceKm.trim()) noteParts.push(`距离：${session.distanceKm.trim()} km`);
      if (paceOrSpeed) noteParts.push(`${paceOrSpeed.label}：${paceOrSpeed.value}`);
      if (session.laps.length > 0) {
        noteParts.push(
          `分段：${session.laps.map((lap) => `#${lap.index} ${formatClock(lap.splitSeconds)}`).join(" / ")}`,
        );
      }
      if (session.notes.trim()) noteParts.push(session.notes.trim());

      const workoutId = `cardio-${session.id}`;
      const body = {
        id: workoutId,
        kind: "workout",
        data: {
          date: today(),
          title: session.label,
          startedAt: session.startedAt,
          endedAt: endedIso,
          status: "completed" as const,
          notes: noteParts.join(" · "),
          feeling: session.feeling,
          source: "manual",
          timing: finalTiming,
          exercises: [
            {
              id: `cardio-ex-${session.id}`,
              exerciseId: `cardio-${session.presetId}`,
              snapshot: {
                name: session.label,
                muscle: "cardio" as const,
                equipment: "bodyweight" as const,
                mode: "timed" as const,
                volumeMultiplier: 1,
              },
              sets: [
                {
                  id: `cardio-set-${session.id}`,
                  type: "normal" as const,
                  weight: 0,
                  reps: 0,
                  seconds: totalSec,
                  completed: true,
                  completedAt: endedIso,
                  rir: null,
                },
              ],
            },
          ],
        },
      };
      const res = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
        method: "POST",
        body,
      });
      clearCardioSession(userId);
      bumpDataEpoch();
      notify(`已保存「${session.label}」· ${formatClock(totalSec)}`);
      if (res.record && onFinishedLocal) {
        onFinishedLocal(res.record);
      } else {
        closeTopModal();
      }
    } catch (err) {
      notify((err as Error)?.message || "保存有氧记录失败");
    } finally {
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
    <div className="dialog-form cardio-session">
      <div className="cardio-session-hero">
        <div className="cardio-session-status-row">
          <span className={`cardio-live-badge${isRunning ? " is-running" : " is-paused"}`}>
            <span className="training-led" aria-hidden="true" />
            {isRunning ? "计时进行中" : "已暂停"}
          </span>
          <span className="cardio-env-tag">{session.environment === "outdoor" ? "室外" : "室内"}</span>
          <span className="cardio-bg-pill">
            <Icon name="clock" size={12} /> 切后台 / 锁屏持续计时
          </span>
        </div>

        <div className="cardio-clock-stage" aria-live="off">
          <div className="cardio-clock-sport">{session.label}</div>
          <div className="cardio-clock-digits">{formatClock(elapsedSeconds)}</div>
          <div className="cardio-clock-sub">
            <span>开始于 {formatStartClock(session.startedAt)}</span>
            {targetDelta != null ? (
              <span>
                {targetDelta >= 0
                  ? `距 ${session.targetMinutes} 分钟目标还剩 ${formatClock(targetDelta)}`
                  : `已超出 ${session.targetMinutes} 分钟目标 +${formatClock(Math.abs(targetDelta))}`}
              </span>
            ) : (
              <span>开放目标 · 当前段 {formatClock(currentSplitSeconds)}</span>
            )}
          </div>
          {targetProgress != null ? (
            <div className="cardio-target-bar" role="progressbar" aria-valuenow={Math.round(targetProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${Math.round(targetProgress * 100)}%` }} />
            </div>
          ) : null}
        </div>

        <div className="cardio-target-row" role="group" aria-label="设定有氧目标时长">
          <span className="cardio-target-label">目标</span>
          {CARDIO_TARGET_MINUTES_OPTIONS.map((mins) => {
            const active = session.targetMinutes === mins;
            return (
              <button
                key={mins ?? "open"}
                type="button"
                className={`cardio-target-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => handleTargetChange(mins)}
              >
                {mins == null ? "开放" : `${mins}m`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="cardio-telemetry-grid">
        <div className="cardio-telemetry-cell">
          <span>开始时间</span>
          <strong>{formatStartClock(session.startedAt)}</strong>
          <small>{session.appleWorkoutLabel}</small>
        </div>
        <div className="cardio-telemetry-cell">
          <span>参考消耗</span>
          <strong>~{estKcal} kcal</strong>
          <small>完练同步 Watch 实测</small>
        </div>
        <div className="cardio-telemetry-cell">
          <span>分段计圈</span>
          <strong>{session.laps.length > 0 ? `${session.laps.length} 段` : "—"}</strong>
          <small>{lastLap ? `上段 ${formatClock(lastLap.splitSeconds)}` : "点击下方记分段"}</small>
        </div>
        <div className="cardio-telemetry-cell">
          <span>{paceOrSpeed ? paceOrSpeed.label : "监测联动"}</span>
          <strong>{paceOrSpeed ? paceOrSpeed.value : "Watch 联动"}</strong>
          <small>{session.distanceKm.trim() ? `${session.distanceKm.trim()} km` : "可展开补充距离"}</small>
        </div>
      </div>

      <div className="cardio-control-row">
        <button
          type="button"
          className={`cardio-ctrl-btn${isRunning ? "" : " is-resume"}`}
          onClick={handleTogglePause}
        >
          <Icon name={isRunning ? "pause" : "play"} size={16} />
          <span>{isRunning ? "暂停计时" : "继续计时"}</span>
        </button>
        <button type="button" className="cardio-ctrl-btn" onClick={handleLap}>
          <Icon name="dial" size={16} />
          <span>记分段</span>
        </button>
        <button
          type="button"
          className="cardio-ctrl-btn"
          onClick={() => {
            triggerHaptic("light");
            notify("有氧计时已转入顶部状态栏，切后台也会继续走表");
            closeTopModal();
          }}
        >
          <Icon name="arrowDown" size={16} />
          <span>后台计时</span>
        </button>
      </div>

      {session.laps.length > 0 ? (
        <section className="cardio-laps-panel" aria-label="有氧分段记录">
          <header>
            <strong>分段计圈</strong>
            <small>共 {session.laps.length} 段</small>
          </header>
          <ol className="cardio-laps-list">
            {[...session.laps].reverse().map((lap) => (
              <li key={lap.id}>
                <span>第 {lap.index} 段</span>
                <strong>{formatClock(lap.splitSeconds)}</strong>
                <small>累计 {formatClock(lap.cumulativeSeconds)}</small>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="cardio-shortcut-strip">
        <div className="cardio-shortcut-copy">
          <strong>Apple Watch / 快捷指令联动</strong>
          <small>
            结束时将触发 <code>{prefs.appleHubShortcutName}</code>（入参 <code>end</code>）自动回传心率、热量与距离。
          </small>
        </div>
        {relaunchUrl ? (
          <a
            href={relaunchUrl}
            className="secondary-button cardio-relaunch-link"
            style={{ textDecoration: "none" }}
            onClick={() => triggerHaptic("light")}
          >
            <Icon name="heart" size={14} /> 重开健身 App
          </a>
        ) : (
          <button
            type="button"
            className="secondary-button cardio-relaunch-link"
            onClick={() => {
              triggerHaptic("light");
              triggerAppleCardioLaunch(session.presetId, { prefs, notify });
            }}
          >
            <Icon name="heart" size={14} /> 唤起健身 App
          </button>
        )}
      </div>

      <details className="settings-accordion cardio-extra-drawer">
        <summary>
          <span>补充距离、体感与备注（可选）</span>
          <span className="settings-accordion-meta">
            <span>{session.distanceKm.trim() ? `${session.distanceKm.trim()} km` : "选填"}</span>
            <Icon name="chevron" size={14} />
          </span>
        </summary>
        <div className="settings-accordion-body cardio-extra-body">
          <label className="field">
            <span>距离（km，跑步机 / 室内单车可手动填写以实时算配速）</span>
            <input
              type="text"
              inputMode="decimal"
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
            <span>备注</span>
            <input
              type="text"
              placeholder="坡度、配速策略、心率区间等"
              value={session.notes}
              onChange={(e) => commitSession({ ...session, notes: e.target.value })}
            />
          </label>
        </div>
      </details>

      <footer className="cardio-session-footer">
        {onIos ? (
          <a
            href={endShortcutUrl}
            className="primary-button cardio-finish-primary"
            style={{ textDecoration: "none" }}
            onClick={() => handleFinishWithShortcut(true)}
          >
            <Icon name="upload" size={16} /> 结束有氧并同步 Apple Watch
          </a>
        ) : (
          <button
            type="button"
            className="primary-button cardio-finish-primary"
            onClick={() => handleFinishWithShortcut(false)}
          >
            <Icon name="upload" size={16} /> 结束有氧并触发快捷指令同步
          </button>
        )}
        <div className="cardio-finish-secondary-row">
          <button
            type="button"
            className="secondary-button"
            disabled={savingLocal}
            onClick={() => void handleSaveLocalCardio()}
          >
            <Icon name="check" size={15} /> {savingLocal ? "保存中..." : "仅结束并保存记录"}
          </button>
          <button type="button" className="quiet" onClick={handleDiscard}>
            放弃本次
          </button>
        </div>
      </footer>
    </div>
  );
}
