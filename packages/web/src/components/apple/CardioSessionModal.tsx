import { localDate } from "@ironlog/shared";
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
  parseCardioDistanceKm,
  readCardioSession,
  recordCardioLap,
  requestCardioAppleSync,
  saveCardioSession,
  toggleCardioSessionPause,
  type LiveCardioSession,
} from "../../lib/cardio-session";
import { FEELINGS, safeUuid, type FeelingKey, type RecordEnvelope, type WeightData, type WorkoutData } from "../../lib/domain";
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

type ActiveSheet = "none" | "menu" | "distance" | "finish";

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
  const setInnerOverlayDismiss = useUiStore((s) => s.setInnerOverlayDismiss);

  const [session, setSession] = useState<LiveCardioSession | null>(() => readCardioSession(userId));
  const [prefs, setPrefs] = useState(() => readWorkoutPreferences());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [savingLocal, setSavingLocal] = useState(false);
  const savingRef = useRef(false);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>("none");

  // #82: Resolve workout-date available weight (latest weigh-in <= date -> profile energyProfile.weightKg -> default 70 kg)
  const [weightBasis, setWeightBasis] = useState<{ kg: number; source: "weigh-in" | "profile" | "default"; date?: string }>({
    kg: 70,
    source: "default",
  });

  // #85: Focus management & inert isolation when any inner sheet is open
  const stageBodyRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const distanceBtnRef = useRef<HTMLButtonElement>(null);
  const finishBtnRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuCloseBtnRef = useRef<HTMLButtonElement>(null);
  const distanceInputRef = useRef<HTMLInputElement>(null);
  const finishCloseBtnRef = useRef<HTMLButtonElement>(null);

  const isRunningRef = useRef(Boolean(session?.timing.runningSince));
  isRunningRef.current = Boolean(session?.timing.runningSince);

  const sessionDate = session ? localDate(Date.parse(session.startedAt)) : "";

  useEffect(() => {
    if (!userId || !sessionDate) return;
    let active = true;
    void Promise.all([
      apiFetch<Array<RecordEnvelope<WeightData>>>("/api/records/weight").catch(() => []),
      apiFetch<{ profile?: { energyProfile?: { weightKg?: number } | null } }>("/api/web/profile").catch(() => null),
    ]).then(([weights, prof]) => {
      if (!active) return;
      const validWeights = (Array.isArray(weights) ? weights : [])
        .filter((r) => !r.deleted && r.data && r.data.date <= sessionDate && Number.isFinite(r.data.weight) && r.data.weight > 0)
        .sort((a, b) => b.data.date.localeCompare(a.data.date));
      if (validWeights[0]) {
        setWeightBasis({ kg: validWeights[0].data.weight, source: "weigh-in", date: validWeights[0].data.date });
        return;
      }
      const profileKg = prof?.profile?.energyProfile?.weightKg;
      if (typeof profileKg === "number" && Number.isFinite(profileKg) && profileKg > 0) {
        setWeightBasis({ kg: profileKg, source: "profile" });
        return;
      }
      setWeightBasis({ kg: 70, source: "default" });
    });
    return () => {
      active = false;
    };
  }, [userId, sessionDate]);

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

  const closeSheet = () => {
    setActiveSheet("none");
    window.setTimeout(() => {
      lastTriggerRef.current?.focus();
    }, 0);
  };

  // #84: Register inner overlay dismiss so mobile Back closes only the active sub-sheet, keeping timer open.
  useEffect(() => {
    if (activeSheet === "none") {
      setInnerOverlayDismiss(null);
      return;
    }
    setInnerOverlayDismiss(() => closeSheet());
    return () => setInnerOverlayDismiss(null);
  }, [activeSheet, setInnerOverlayDismiss]);

  // #85: Isolate underlying timer controls with `inert` and move focus cleanly into the opened sub-sheet.
  useEffect(() => {
    const bg = stageBodyRef.current as (HTMLDivElement & { inert?: boolean }) | null;
    if (bg) {
      bg.inert = activeSheet !== "none";
    }
    if (activeSheet === "menu") {
      window.setTimeout(() => menuCloseBtnRef.current?.focus(), 0);
    } else if (activeSheet === "distance") {
      window.setTimeout(() => distanceInputRef.current?.focus(), 0);
    } else if (activeSheet === "finish") {
      window.setTimeout(() => finishCloseBtnRef.current?.focus(), 0);
    }
  }, [activeSheet]);

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
  const estKcal = estimateCardioCalories(session.activityType, elapsedSeconds, weightBasis.kg);
  const parsedDistance = parseCardioDistanceKm(session.distanceKm);
  const paceOrSpeed = formatCardioPaceOrSpeed(session.activityType, elapsedSeconds, session.distanceKm);
  const targetSeconds = session.targetMinutes ? session.targetMinutes * 60 : null;
  const targetProgress = targetSeconds ? Math.min(1, elapsedSeconds / targetSeconds) : null;
  const targetDelta = targetSeconds ? targetSeconds - elapsedSeconds : null;
  const lastLap = session.laps.at(-1) ?? null;
  const currentSplitSeconds = Math.max(0, elapsedSeconds - (lastLap?.cumulativeSeconds ?? 0));
  const canRecordLap = currentSplitSeconds > 0;

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

  const openSheet = (sheet: ActiveSheet, trigger: HTMLButtonElement | null) => {
    lastTriggerRef.current = trigger;
    triggerHaptic("light");
    setActiveSheet(sheet);
  };

  const handleTogglePause = () => {
    triggerHaptic("light");
    commitSession(toggleCardioSessionPause(session, Date.now()));
  };

  const handleLap = () => {
    // #80: Ignore lap when no elapsed time accumulated since last lap (e.g., repeated taps while paused).
    if (!canRecordLap) return;
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
    setActiveSheet("none");
    notify("已请求 Apple 同步。收到对应训练后会清除计时");
  };

  const handleSaveLocalCardio = async () => {
    if (savingRef.current) return;
    if (session.distanceKm.trim() && !parsedDistance.valid) {
      notify("距离格式无效，请输入有效数字（如 5.5）");
      return;
    }
    const finished = finishCardioTiming(session);
    const desiredBody = buildCardioWorkoutMutation(finished, Date.now(), { weightKg: weightBasis.kg });
    savingRef.current = true;
    setSavingLocal(true);

    try {
      let savedRecord: RecordEnvelope<WorkoutData> | undefined;
      const priorPending = finished.pendingSave;

      if (priorPending) {
        // #78: Always confirm/replay the original pending payload with its original opId first to recover version cleanly.
        const samePayload = JSON.stringify(priorPending.payload) === JSON.stringify(desiredBody);
        const confirmRes = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
          method: "POST",
          body: priorPending.payload,
        });
        if (!confirmRes.record) throw new Error("服务器未确认保存，请重试");
        savedRecord = confirmRes.record;
        if (!samePayload) {
          // User edited notes/distance/feeling after a lost receipt: follow up with a fresh opId + confirmed baseVersion.
          const updateBody = buildCardioWorkoutMutation(finished, Date.now(), {
            weightKg: weightBasis.kg,
            opId: safeUuid(),
            baseVersion: savedRecord.version,
          });
          commitSession({
            ...finished,
            pendingSave: { opId: updateBody.opId, payload: updateBody, sentAt: new Date().toISOString() },
          });
          const updateRes = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
            method: "POST",
            body: updateBody,
          });
          if (!updateRes.record) throw new Error("服务器未确认更新，请重试");
          savedRecord = updateRes.record;
        }
      } else {
        // Record pendingSave BEFORE sending so any lost response can safely replay and follow up (#78).
        const sessionWithPending: LiveCardioSession = {
          ...finished,
          pendingSave: { opId: desiredBody.opId, payload: desiredBody, sentAt: new Date().toISOString() },
        };
        commitSession(sessionWithPending);
        const res = await apiFetch<{ record?: RecordEnvelope<WorkoutData> }>("/api/records", {
          method: "POST",
          body: desiredBody,
        });
        if (!res.record) throw new Error("服务器未确认保存，请重试");
        savedRecord = res.record;
      }

      if (readCardioSession(userId)?.id === session.id) clearCardioSession(userId);
      triggerHaptic("success");
      bumpDataEpoch();
      setActiveSheet("none");
      notify(`已保存「${session.label}」· ${formatClock(finished.timing.elapsedSeconds)}`);
      if (onFinishedLocal) {
        onFinishedLocal(savedRecord);
      } else {
        closeTopModal();
      }
    } catch (err) {
      notify((err as Error)?.message || "保存有氧记录失败，可核对后重试");
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

  const weightBasisHint =
    weightBasis.source === "weigh-in"
      ? `按 ${weightBasis.kg}kg 称重`
      : weightBasis.source === "profile"
        ? `按 ${weightBasis.kg}kg 资料`
        : "按默认 70kg";

  return (
    <div className="cardio-stage">
      <div
        ref={stageBodyRef}
        aria-hidden={activeSheet !== "none"}
        style={{ display: "contents" }}
      >
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
              ref={moreBtnRef}
              type="button"
              className="workout-circle-btn"
              aria-label="更多选项"
              title="记录距离与更多操作"
              aria-expanded={activeSheet === "menu"}
              onClick={() => openSheet("menu", moreBtnRef.current)}
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
              <small className="muted" style={{ fontSize: 10 }}>{weightBasisHint}</small>
            </div>
            <div>
              <span>{paceOrSpeed ? paceOrSpeed.label : "配速 / 距离"}</span>
              <strong>{paceOrSpeed ? paceOrSpeed.value : parsedDistance.valueKm != null ? `${parsedDistance.normalized} km` : "未填距离"}</strong>
              {/* R8 UX-2: Place direct "填距离" trigger right next to pace readout without affecting stopwatch */}
              <button
                ref={distanceBtnRef}
                type="button"
                className="micro-chip"
                style={{ marginTop: 4 }}
                onClick={() => openSheet("distance", distanceBtnRef.current)}
              >
                {parsedDistance.valueKm != null ? `${parsedDistance.normalized}km · 改` : "填距离"}
              </button>
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
            <button
              type="button"
              className="cardio-dock-btn"
              disabled={!canRecordLap}
              title={!canRecordLap ? "当前分段尚未产生新时长" : "记录当前分段"}
              onClick={handleLap}
            >
              <Icon name="dial" size={16} />
              <span>记分段</span>
            </button>
          </div>

          {/* R8 UX-1: Put both "保存到铁记" and "同步 Apple Watch" in the finish flow accessible at 320px */}
          <button
            ref={finishBtnRef}
            type="button"
            className="cardio-dock-finish"
            disabled={savingLocal}
            onClick={() => openSheet("finish", finishBtnRef.current)}
          >
            <Icon name="check" size={16} />
            <span>{savingLocal ? "保存中…" : session.appleSyncRequestedAt ? "结束有氧 / 选择保存方式" : "结束有氧"}</span>
          </button>
        </footer>
      </div>

      {/* R8 UX-2: Quick distance overlay next to pace, does not affect stopwatch */}
      {activeSheet === "distance" ? (
        <div className="session-menu-overlay" role="dialog" aria-modal="true" aria-label="填写运动距离">
          <header className="dialog-head" style={{ marginBottom: 4 }}>
            <h2>填写距离（km）</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="收起距离输入"
              onClick={() => {
                triggerHaptic("light");
                closeSheet();
              }}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="session-menu-body">
            <label className="field">
              <span>距离（km，支持 5.5 或 5,5，实时换算配速）</span>
              <input
                ref={distanceInputRef}
                type="text"
                inputMode="decimal"
                maxLength={40}
                placeholder="例如 5.0"
                value={session.distanceKm}
                onChange={(e) => commitSession({ ...session, distanceKm: e.target.value })}
              />
            </label>
            {session.distanceKm.trim() && !parsedDistance.valid ? (
              <p className="form-error" role="alert">请输入有效数字距离（0–500 km，例如 5.5）</p>
            ) : paceOrSpeed ? (
              <p className="muted" role="status">
                当前{paceOrSpeed.label}：<b>{paceOrSpeed.value}</b>（规范距离：{parsedDistance.normalized} km）
              </p>
            ) : null}
            <button
              type="button"
              className="primary-button"
              style={{ width: "100%" }}
              onClick={() => {
                if (parsedDistance.valid && parsedDistance.normalized && parsedDistance.normalized !== session.distanceKm) {
                  commitSession({ ...session, distanceKm: parsedDistance.normalized });
                }
                closeSheet();
              }}
            >
              确定并返回秒表
            </button>
          </div>
        </div>
      ) : null}

      {/* R8 UX-1 & UX-2: Unified finish flow with feeling, notes, "保存到铁记" AND "同步 Apple Watch" */}
      {activeSheet === "finish" ? (
        <div className="session-menu-overlay" role="dialog" aria-modal="true" aria-label="结束有氧并保存">
          <header className="dialog-head" style={{ marginBottom: 4 }}>
            <h2>结束有氧</h2>
            <button
              ref={finishCloseBtnRef}
              type="button"
              className="icon-button"
              aria-label="返回计时"
              onClick={() => {
                triggerHaptic("light");
                closeSheet();
              }}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="session-menu-body">
            <p className="muted" style={{ margin: 0 }}>
              本次 <b>{session.label}</b> · 用时 <b>{formatClock(elapsedSeconds)}</b>
              {parsedDistance.valueKm != null ? ` · ${parsedDistance.normalized} km` : ""}
              {paceOrSpeed ? ` · ${paceOrSpeed.value}` : ""} · 约 {estKcal} kcal（{weightBasisHint}）
            </p>
            <div className="field">
              <span>主观体感（选填）</span>
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
              <span>训练备注（选填）</span>
              <input
                type="text"
                placeholder="坡度、配速节奏、心率区间等"
                maxLength={4000}
                value={session.notes}
                onChange={(e) => commitSession({ ...session, notes: e.target.value })}
              />
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="primary-button"
                style={{ width: "100%", whiteSpace: "normal" }}
                disabled={savingLocal}
                onClick={() => void handleSaveLocalCardio()}
              >
                <Icon name="check" size={16} /> {savingLocal ? "正在保存到铁记…" : "保存到铁记"}
              </button>
              {onIos ? (
                <a
                  href={endShortcutUrl}
                  className="secondary-button"
                  style={{ width: "100%", textAlign: "center", justifyContent: "center", whiteSpace: "normal" }}
                  onClick={handleFinishWithShortcut}
                >
                  <Icon name="upload" size={16} /> {session.appleSyncRequestedAt ? "重试同步 Apple Watch" : "结束有氧并同步 Apple Watch"}
                </a>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  style={{ width: "100%", whiteSpace: "normal" }}
                  onClick={() => {
                    if (requestCardioAppleSync(userId, session)) {
                      setActiveSheet("none");
                      notify("已标记等待 Apple Watch 同步，可在 iPhone 快捷指令上传后自动关联");
                    }
                  }}
                >
                  <Icon name="upload" size={16} /> 结束有氧并同步 Apple Watch
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeSheet === "menu" ? (
        <div className="session-menu-overlay" role="dialog" aria-modal="true" aria-label="有氧附加选项">
          <header className="dialog-head" style={{ marginBottom: 4 }}>
            <h2>记录与联动选项</h2>
            <button
              ref={menuCloseBtnRef}
              type="button"
              className="icon-button"
              aria-label="收起选项"
              onClick={() => {
                triggerHaptic("light");
                closeSheet();
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
            {session.distanceKm.trim() && !parsedDistance.valid ? (
              <p className="form-error" role="alert">距离格式无效，请输入有效数字（如 5.5）</p>
            ) : null}

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

            <div className="cardio-menu-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={savingLocal}
                onClick={() => void handleSaveLocalCardio()}
              >
                <Icon name="check" size={15} /> {savingLocal ? "保存中…" : "直接保存到铁记"}
              </button>
              <button type="button" className="danger" onClick={handleDiscard}>
                放弃本次计时
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
