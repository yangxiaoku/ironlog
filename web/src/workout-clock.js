const MM = 60;

export function formatClock(seconds) {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor(seconds / MM) % 60;
  const ss = seconds % MM;
  const parts = (hh ? [hh, mm, ss] : [mm, ss]).map((value) => String(value).padStart(2, "0"));
  return parts.join(":");
}

export function elapsedAt(timing, now) {
  const running = timing.runningSince ? Math.max(0, Math.floor((now - Date.parse(timing.runningSince)) / 1000)) : 0;
  return timing.elapsedSeconds + running;
}

export function pauseAt(timing, now) {
  return { elapsedSeconds: elapsedAt(timing, now), runningSince: null };
}

export function recoverClock(workout, now) {
  const timing = workout.timing;
  if (!timing) return { elapsedSeconds: 0, runningSince: null };
  if (!timing.runningSince) return timing;
  const resumedAt = Date.parse(timing.runningSince);
  const checkIns = workout.exercises.flatMap((row) => row.sets)
    .filter((set) => set.completed && set.completedAt)
    .map((set) => Date.parse(set.completedAt))
    .filter((date) => date >= resumedAt && date <= now);
  const last = Math.max(resumedAt, ...checkIns);
  return pauseAt(timing, now - last > 45 * 60000 ? last : now);
}

/** Create a rest timer anchored to an explicit reference total in ms. */
export function createRestTimer(seconds, setId, now = Date.now()) {
  const total = Math.max(1000, Math.round(seconds * 1000));
  return { start: now, end: now + total, total, setId };
}

/** Determine rest duration based on completed set type and upcoming set type. */
export function resolveSetRestSeconds({ setType = "normal", nextSetType = null, defaultRestSeconds = 90 } = {}) {
  const base = Math.max(0, Math.round(Number(defaultRestSeconds) || 0));
  if (nextSetType === "drop") {
    return { seconds: 0, reason: "drop_chain" };
  }
  if (setType === "rest_pause") {
    return { seconds: base > 0 ? Math.min(base, 20) : 20, reason: "rest_pause" };
  }
  if (setType === "warmup") {
    return { seconds: base > 0 ? Math.min(base, 45) : 0, reason: "warmup" };
  }
  return { seconds: base, reason: "normal" };
}

/** Restore an active or paused rest timer, preserving its reference total duration. */
export function normalizeRestTimer(rest, now = Date.now()) {
  if (!rest) return null;
  if (rest.pausedLeftMs != null) {
    const left = Math.max(0, rest.pausedLeftMs);
    if (left <= 0) return null;
    const total = Math.max(1, rest.total ?? left);
    return { ...rest, pausedLeftMs: left, total };
  }
  if (rest.end <= now) return null;
  const total = Math.max(1, rest.total ?? (rest.end - rest.start));
  return { ...rest, total };
}

/** Pause an active rest timer, storing remaining milliseconds. */
export function pauseRestTimer(rest, now = Date.now()) {
  if (!rest) return null;
  if (rest.pausedLeftMs != null) return rest;
  const left = Math.max(0, rest.end - now);
  return { ...rest, pausedLeftMs: left };
}

/** Resume a paused rest timer from the stored remaining milliseconds. */
export function resumeRestTimer(rest, now = Date.now()) {
  if (!rest) return null;
  if (rest.pausedLeftMs == null) return rest;
  const left = Math.max(0, rest.pausedLeftMs);
  const total = Math.max(1, rest.total ?? left);
  const end = now + left;
  const start = Math.max(0, Math.round(end - total));
  return { ...rest, start, end, total, pausedLeftMs: null };
}

/** Shift rest deadline by +/- deltaSeconds without shrinking the reference ring total. */
export function shiftRestTimer(rest, deltaSeconds, now = Date.now()) {
  if (!rest) return null;
  const deltaMs = deltaSeconds * 1000;
  if (rest.pausedLeftMs != null) {
    const pausedLeftMs = Math.max(0, rest.pausedLeftMs + deltaMs);
    const total = deltaMs > 0
      ? Math.max(1, rest.total ?? 1, pausedLeftMs)
      : Math.max(1, rest.total ?? 1);
    return { ...rest, total, pausedLeftMs };
  }
  let total = Math.max(1, rest.total ?? (rest.end - rest.start));
  if (deltaMs > 0 && rest.end <= now) total = 0;
  const end = Math.max(now, (deltaMs > 0 ? Math.max(now, rest.end) : rest.end) + deltaMs);
  if (deltaMs > 0) total = Math.max(1, total, end - now);
  const start = Math.max(0, Math.round(end - total));
  return { ...rest, start, end, total };
}

/** Compute remaining rest clock seconds and 0..1 dial fraction. */
export function restProgress(rest, now = Date.now()) {
  const paused = rest?.pausedLeftMs != null;
  const total = Math.max(1, rest.total ?? (rest.end - rest.start));
  const left = paused ? Math.max(0, rest.pausedLeftMs) : Math.max(0, rest.end - now);
  return {
    total,
    left,
    fraction: Math.max(0, Math.min(1, left / total)),
    seconds: Math.ceil(left / 1000),
    paused,
  };
}

let iosHapticWrap = null;
let iosHapticLabel = null;
function triggerIosSwitchHaptic() {
  if (typeof document === "undefined") return;
  try {
    const host = document.querySelector("dialog[open]") ?? document.body;
    if (!host) return;
    if (!iosHapticWrap || iosHapticWrap.parentElement !== host) {
      iosHapticWrap?.remove();
      const wrap = document.createElement("div");
      wrap.setAttribute("aria-hidden", "true");
      wrap.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;overflow:hidden;";
      const input = document.createElement("input");
      input.id = "ironlog-ios-haptic";
      input.type = "checkbox";
      input.tabIndex = -1;
      input.setAttribute("switch", "");
      input.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;";
      const label = document.createElement("label");
      label.htmlFor = "ironlog-ios-haptic";
      label.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;";
      wrap.append(input, label);
      host.appendChild(wrap);
      iosHapticWrap = wrap;
      iosHapticLabel = label;
    }
    iosHapticLabel?.click();
  } catch {}
}

export function triggerHaptic(type = "light", { skipIosSwitch = false, fromUserGesture = true } = {}) {
  const nativeHaptics = globalThis.Capacitor?.Plugins?.Haptics ?? globalThis.Haptics;
  if (nativeHaptics) {
    try {
      if ((type === "success" || type === "pr" || type === "timer") && typeof nativeHaptics.notification === "function") {
        void Promise.resolve(nativeHaptics.notification({ type: type === "timer" ? "WARNING" : "SUCCESS" })).catch(() => {});
        return;
      }
      if (typeof nativeHaptics.impact === "function") {
        const style = type === "light" ? "LIGHT" : type === "medium" ? "MEDIUM" : "HEAVY";
        void Promise.resolve(nativeHaptics.impact({ style })).catch(() => {});
        return;
      }
    } catch {}
  }
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      if (type === "light") navigator.vibrate(15);
      else if (type === "medium") navigator.vibrate(28);
      else if (type === "success") navigator.vibrate([16, 40, 20]);
      else if (type === "pr") navigator.vibrate([30, 45, 45, 45, 60]);
      else if (type === "timer") navigator.vibrate([120, 70, 120, 70, 200]);
      return;
    } catch {}
  }
  if (!skipIosSwitch && fromUserGesture) triggerIosSwitchHaptic();
}

export const haptic = triggerHaptic;

let sharedAudioCtx = null;
let sharedAudioPrimed = false;

function setAmbientAudioSession() {
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession && navigator.audioSession.type !== "ambient") {
      navigator.audioSession.type = "ambient";
    }
  } catch {}
}

/** Lazily initialize and unlock a single ambient Web Audio context inside user gestures. */
export function primeSharedAudio() {
  setAmbientAudioSession();
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) return null;
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new Context();
      sharedAudioPrimed = false;
    }
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume().then(() => {
        sharedAudioPrimed = true;
      }).catch(() => {});
    }
    if (!sharedAudioPrimed) {
      const silent = sharedAudioCtx.createBuffer(1, 1, 22050);
      const src = sharedAudioCtx.createBufferSource();
      src.buffer = silent;
      src.connect(sharedAudioCtx.destination);
      src.start(0);
      if (sharedAudioCtx.state === "running") sharedAudioPrimed = true;
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function createRestAudio(enabled) {
  function scheduleWebAudioTones(audio, tones, wave = "sine", peak = 0.36) {
    if (!audio) return false;
    try {
      const baseTime = Math.max(audio.currentTime, 0);
      for (const [frequency, delay, length] of tones) {
        const start = baseTime + delay;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = wave;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + length);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.015);
      }
      return true;
    } catch {
      return false;
    }
  }

  function emitTap(audio, kind) {
    if (!audio) return false;
    try {
      if (kind === "tick") {
        const start = Math.max(audio.currentTime, 0);
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(1150, start);
        osc.frequency.exponentialRampToValueAtTime(580, start + 0.022);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.24, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.022);
        osc.connect(gain).connect(audio.destination);
        osc.start(start);
        osc.stop(start + 0.028);
        return true;
      }
      if (kind === "check") {
        return scheduleWebAudioTones(audio, [[660, 0, 0.05], [1046, 0.055, 0.10]], "sine", 0.30);
      }
      if (kind === "uncheck") {
        return scheduleWebAudioTones(audio, [[520, 0, 0.04], [380, 0.04, 0.05]], "sine", 0.16);
      }
      if (kind === "pr") {
        return scheduleWebAudioTones(audio, [[880, 0, 0.08], [1175, 0.08, 0.09], [1568, 0.17, 0.18]], "sine", 0.36);
      }
      return scheduleWebAudioTones(audio, [[740, 0, 0.04]], "triangle", 0.20);
    } catch {
      return false;
    }
  }

  function unlock() {
    if (!enabled()) return;
    primeSharedAudio();
  }

  function tap(kind = "tick") {
    if (!enabled()) return;
    const audio = primeSharedAudio();
    if (!audio) return;
    try {
      if (audio.state === "running") {
        emitTap(audio, kind);
      } else {
        void audio.resume().then(() => {
          sharedAudioPrimed = true;
          emitTap(audio, kind);
        }).catch(() => {});
      }
    } catch {}
  }

  function play(complete) {
    if (complete) triggerHaptic("timer", { fromUserGesture: false });
    if (!enabled()) return;
    const audio = primeSharedAudio();
    if (!audio) return;
    const tones = complete
      ? [[880, 0, 0.13], [1175, 0.13, 0.15], [1568, 0.28, 0.24], [1175, 0.56, 0.13], [1568, 0.70, 0.28]]
      : [[784, 0, 0.07]];
    try {
      if (audio.state === "running") {
        scheduleWebAudioTones(audio, tones, complete ? "sine" : "triangle", complete ? 0.52 : 0.22);
      } else {
        void audio.resume().then(() => {
          sharedAudioPrimed = true;
          scheduleWebAudioTones(audio, tones, complete ? "sine" : "triangle", complete ? 0.52 : 0.22);
        }).catch(() => {});
      }
    } catch {}
  }
  return { unlock, play, tap };
}

export function keepWorkoutScreenAwake(isActive, onStatus) {
  let lock, pending = false, closed = false;
  const permitted = () => !closed && isActive() && document.visibilityState === "visible";
  async function refresh() {
    if (!permitted()) {
      const previous = lock;
      lock = undefined;
      if (previous && !previous.released) await previous.release().catch(() => {});
      if (!closed) onStatus(false);
      return;
    }
    if ((lock && !lock.released) || pending) return;
    pending = true;
    try {
      const current = await navigator.wakeLock.request("screen");
      if (!permitted()) {
        await current.release();
        return;
      }
      lock = current;
      onStatus(true);
      current.addEventListener("release", () => {
        if (lock === current) {
          lock = undefined;
          if (!closed) onStatus(false);
        }
      }, { once: true });
    } catch { if (!closed) onStatus(false); }
    finally { pending = false; }
  }
  function update() { void refresh(); }
  document.addEventListener("visibilitychange", update);
  return { update, stop() {
    closed = true;
    document.removeEventListener("visibilitychange", update);
    void refresh();
  } };
}
