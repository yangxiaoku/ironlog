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

/** Restore an active rest timer, preserving its reference total duration. */
export function normalizeRestTimer(rest, now = Date.now()) {
  if (!rest || rest.end <= now) return null;
  const total = Math.max(1, rest.total ?? (rest.end - rest.start));
  return { ...rest, total };
}

/** Shift rest deadline by +/- deltaSeconds without shrinking the reference ring total. */
export function shiftRestTimer(rest, deltaSeconds, now = Date.now()) {
  if (!rest) return null;
  const deltaMs = deltaSeconds * 1000;
  let total = Math.max(1, rest.total ?? (rest.end - rest.start));
  if (deltaMs > 0 && rest.end <= now) total = 0;
  const end = Math.max(now, (deltaMs > 0 ? Math.max(now, rest.end) : rest.end) + deltaMs);
  if (deltaMs > 0) total = Math.max(1, total, end - now);
  const start = Math.max(0, Math.round(end - total));
  return { ...rest, start, end, total };
}

/** Compute remaining rest clock seconds and 0..1 dial fraction. */
export function restProgress(rest, now = Date.now()) {
  const total = Math.max(1, rest.total ?? (rest.end - rest.start));
  const left = Math.max(0, rest.end - now);
  return {
    total,
    left,
    fraction: Math.max(0, Math.min(1, left / total)),
    seconds: Math.ceil(left / 1000),
  };
}

export function haptic(type = "light") {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      if (type === "light") navigator.vibrate(12);
      else if (type === "medium") navigator.vibrate(28);
      else if (type === "success") navigator.vibrate([16, 40, 20]);
      else if (type === "pr") navigator.vibrate([30, 45, 45, 45, 60]);
      else if (type === "timer") navigator.vibrate([120, 70, 120, 70, 200]);
    } catch {}
  }
}

export function createRestAudio(enabled) {
  let audio;
  function unlock() {
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!enabled() || !Context) return;
    try {
      audio ??= new Context();
      if (audio.state === "suspended") void audio.resume().catch(() => {});
    } catch {}
  }
  function play(complete) {
    if (complete) haptic("timer");
    if (!enabled() || audio?.state !== "running" || document.hidden) return;
    const tones = complete ? [[784, 0, 0.13], [988, 0.15, 0.24]] : [[660, 0, 0.075]];
    for (const [frequency, delay, length] of tones) {
      const start = audio.currentTime + delay;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.14, start + .015);
      gain.gain.exponentialRampToValueAtTime(.001, start + length);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + length);
    }
  }
  return { unlock, play };
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
