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

let iosHapticLabel = null;
function triggerIosSwitchHaptic() {
  if (typeof document === "undefined") return;
  try {
    if (!iosHapticLabel || !iosHapticLabel.isConnected) {
      const wrap = document.createElement("label");
      wrap.setAttribute("aria-hidden", "true");
      wrap.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      wrap.appendChild(input);
      document.body?.appendChild(wrap);
      iosHapticLabel = wrap;
    }
    iosHapticLabel?.click();
  } catch {}
}

export function haptic(type = "light") {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      if (type === "light") navigator.vibrate(12);
      else if (type === "medium") navigator.vibrate(28);
      else if (type === "success") navigator.vibrate([16, 40, 20]);
      else if (type === "pr") navigator.vibrate([30, 45, 45, 45, 60]);
      else if (type === "timer") navigator.vibrate([120, 70, 120, 70, 200]);
      return;
    } catch {}
  }
  triggerIosSwitchHaptic();
}

function buildChimeWavDataUri(tones, sampleRate = 22050) {
  const totalSec = tones.reduce((max, [, delay, len]) => Math.max(max, delay + len), 0) + 0.04;
  const numSamples = Math.max(1, Math.floor(totalSec * sampleRate));
  const pcm = new Int16Array(numSamples);
  for (const [freq, delay, len] of tones) {
    const startIdx = Math.floor(delay * sampleRate);
    const count = Math.floor(len * sampleRate);
    for (let i = 0; i < count && startIdx + i < numSamples; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.012);
      const decay = Math.exp((-3.2 * t) / len);
      const sample = Math.sin(2 * Math.PI * freq * t) * attack * decay * 0.42;
      const mixed = pcm[startIdx + i] + Math.round(sample * 32767);
      pcm[startIdx + i] = Math.max(-32768, Math.min(32767, mixed));
    }
  }
  const byteLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + byteLen);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + byteLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, byteLen, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

let cachedCompleteWav = null;
let cachedTickWav = null;
let cachedSilentWav = null;

export function createRestAudio(enabled) {
  let audio;
  let htmlAudio = null;
  let webAudioPrimed = false;
  let htmlAudioPrimed = false;
  let playingChimeUntil = 0;

  function ensureWavs() {
    cachedCompleteWav ??= buildChimeWavDataUri([[784, 0, 0.14], [988, 0.14, 0.16], [1175, 0.30, 0.28]]);
    cachedTickWav ??= buildChimeWavDataUri([[660, 0, 0.08]]);
    cachedSilentWav ??= buildChimeWavDataUri([[440, 0, 0.005]]);
  }

  function scheduleWebAudioTones(tones, complete) {
    if (!audio) return false;
    try {
      const baseTime = Math.max(audio.currentTime, 0);
      for (const [frequency, delay, length] of tones) {
        const start = baseTime + delay;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(complete ? 0.36 : 0.18, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + length);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + length + 0.02);
      }
      return true;
    } catch {
      return false;
    }
  }

  function unlock() {
    if (!enabled()) return;
    try {
      if (typeof navigator !== "undefined" && navigator.audioSession && navigator.audioSession.type !== "playback") {
        navigator.audioSession.type = "playback";
      }
    } catch {}
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (Context) {
      try {
        audio ??= new Context();
        if (audio.state !== "running") {
          void audio.resume().catch(() => {});
        }
        if (!webAudioPrimed || audio.state !== "running") {
          const silent = audio.createBuffer(1, 1, 22050);
          const src = audio.createBufferSource();
          src.buffer = silent;
          src.connect(audio.destination);
          src.start(0);
          if (audio.state === "running") webAudioPrimed = true;
        }
      } catch {}
    }
    if (typeof Audio !== "undefined" && !htmlAudioPrimed && Date.now() >= playingChimeUntil) {
      try {
        ensureWavs();
        htmlAudio ??= new Audio();
        htmlAudio.volume = 0.01;
        htmlAudio.src = cachedSilentWav;
        const p = htmlAudio.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            htmlAudioPrimed = true;
            if (Date.now() >= playingChimeUntil) {
              htmlAudio.pause();
              htmlAudio.currentTime = 0;
            }
            htmlAudio.volume = 1;
          }).catch(() => {});
        }
      } catch {}
    }
  }

  function play(complete) {
    if (complete) haptic("timer");
    if (!enabled()) return;
    const tones = complete
      ? [[784, 0, 0.14], [988, 0.14, 0.16], [1175, 0.30, 0.28]]
      : [[660, 0, 0.08]];
    playingChimeUntil = Date.now() + (complete ? 650 : 150);

    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    let playedViaWebAudio = false;
    if (Context) {
      try {
        audio ??= new Context();
        if (audio.state === "running") {
          playedViaWebAudio = scheduleWebAudioTones(tones, complete);
        } else {
          void audio.resume().then(() => {
            scheduleWebAudioTones(tones, complete);
          }).catch(() => {});
        }
      } catch {}
    }
    if (!playedViaWebAudio && typeof Audio !== "undefined") {
      try {
        ensureWavs();
        htmlAudio ??= new Audio();
        htmlAudio.volume = 1;
        htmlAudio.src = complete ? cachedCompleteWav : cachedTickWav;
        void htmlAudio.play().catch(() => {});
      } catch {}
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
