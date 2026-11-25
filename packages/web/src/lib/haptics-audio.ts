export type HapticKind = "light" | "medium" | "success" | "pr" | "timer";
export type SoundTapKind = "tick" | "check" | "uncheck" | "pr" | "step";
export type RestSoundStyle = "chime" | "marimba" | "bell";

export interface WorkoutTiming {
  elapsedSeconds: number;
  runningSince: string | null;
}

export interface RestTimerState {
  start: number;
  end: number;
  total: number;
  setId: string;
  pausedLeftMs?: number | null;
}

const MM = 60;

export function formatClock(seconds: number): string {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor(seconds / MM) % 60;
  const ss = seconds % MM;
  const parts = (hh ? [hh, mm, ss] : [mm, ss]).map((value) => String(value).padStart(2, "0"));
  return parts.join(":");
}

export function elapsedAt(timing: WorkoutTiming, now: number): number {
  const running = timing.runningSince
    ? Math.max(0, Math.floor((now - Date.parse(timing.runningSince)) / 1000))
    : 0;
  return timing.elapsedSeconds + running;
}

export function pauseAt(timing: WorkoutTiming, now: number): WorkoutTiming {
  return { elapsedSeconds: elapsedAt(timing, now), runningSince: null };
}

export function createRestTimer(seconds: number, setId: string, now = Date.now()): RestTimerState {
  const total = Math.max(1000, Math.round(seconds * 1000));
  return { start: now, end: now + total, total, setId };
}

export function resolveSetRestSeconds({
  setType = "normal",
  nextSetType = null,
  defaultRestSeconds = 90,
  warmupRestSeconds,
}: {
  setType?: string;
  nextSetType?: string | null;
  defaultRestSeconds?: number;
  warmupRestSeconds?: number;
} = {}): { seconds: number; reason: string } {
  const base = Math.max(0, Math.round(Number(defaultRestSeconds) || 0));
  if (nextSetType === "drop") return { seconds: 0, reason: "drop_chain" };
  if (setType === "rest_pause") return { seconds: base > 0 ? Math.min(base, 20) : 20, reason: "rest_pause" };
  if (setType === "warmup") {
    if (warmupRestSeconds !== undefined && Number.isFinite(warmupRestSeconds)) {
      if (warmupRestSeconds <= 0) return { seconds: 0, reason: "warmup_skip" };
      return { seconds: Math.round(warmupRestSeconds), reason: "warmup" };
    }
    return { seconds: base > 0 ? Math.min(base, 45) : 0, reason: "warmup" };
  }
  return { seconds: base, reason: "normal" };
}

export function normalizeRestTimer(rest: RestTimerState | null | undefined, now = Date.now()): RestTimerState | null {
  if (!rest) return null;
  if (rest.pausedLeftMs != null) {
    const left = Math.max(0, rest.pausedLeftMs);
    if (left <= 0) return null;
    const total = Math.max(1, rest.total ?? left);
    return { ...rest, pausedLeftMs: left, total };
  }
  if (rest.end <= now) return null;
  const total = Math.max(1, rest.total ?? rest.end - rest.start);
  return { ...rest, total };
}

export function pauseRestTimer(rest: RestTimerState | null | undefined, now = Date.now()): RestTimerState | null {
  if (!rest) return null;
  if (rest.pausedLeftMs != null) return rest;
  return { ...rest, pausedLeftMs: Math.max(0, rest.end - now) };
}

export function resumeRestTimer(rest: RestTimerState | null | undefined, now = Date.now()): RestTimerState | null {
  if (!rest) return null;
  if (rest.pausedLeftMs == null) return rest;
  const left = Math.max(0, rest.pausedLeftMs);
  const total = Math.max(1, rest.total ?? left);
  const end = now + left;
  const start = Math.max(0, Math.round(end - total));
  return { ...rest, start, end, total, pausedLeftMs: null };
}

export function shiftRestTimer(
  rest: RestTimerState | null | undefined,
  deltaSeconds: number,
  now = Date.now(),
): RestTimerState | null {
  if (!rest) return null;
  const deltaMs = deltaSeconds * 1000;
  if (rest.pausedLeftMs != null) {
    const pausedLeftMs = Math.max(0, rest.pausedLeftMs + deltaMs);
    const total = deltaMs > 0 ? Math.max(1, rest.total ?? 1, pausedLeftMs) : Math.max(1, rest.total ?? 1);
    return { ...rest, total, pausedLeftMs };
  }
  let total = Math.max(1, rest.total ?? rest.end - rest.start);
  if (deltaMs > 0 && rest.end <= now) total = 0;
  const end = Math.max(now, (deltaMs > 0 ? Math.max(now, rest.end) : rest.end) + deltaMs);
  if (deltaMs > 0) total = Math.max(1, total, end - now);
  const start = Math.max(0, Math.round(end - total));
  return { ...rest, start, end, total };
}

export function restProgress(rest: RestTimerState, now = Date.now()) {
  const paused = rest.pausedLeftMs != null;
  const total = Math.max(1, rest.total ?? rest.end - rest.start);
  const left = paused ? Math.max(0, rest.pausedLeftMs ?? 0) : Math.max(0, rest.end - now);
  return {
    total,
    left,
    fraction: Math.max(0, Math.min(1, left / total)),
    seconds: Math.ceil(left / 1000),
    paused,
  };
}

let iosHapticWrap: HTMLDivElement | null = null;
let iosHapticLabel: HTMLLabelElement | null = null;

function isIosTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iP(hone|ad|od)/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function triggerIosSwitchHaptic(): void {
  if (typeof document === "undefined" || !isIosTouchDevice()) return;
  try {
    const host = document.querySelector("dialog[open]") ?? document.body;
    if (!host) return;
    if (!iosHapticWrap || iosHapticWrap.parentElement !== host) {
      iosHapticWrap?.remove();
      const wrap = document.createElement("div");
      wrap.setAttribute("aria-hidden", "true");
      wrap.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;overflow:hidden;";
      const input = document.createElement("input");
      input.id = "ironlog-ios-haptic";
      input.type = "checkbox";
      input.tabIndex = -1;
      input.setAttribute("switch", "");
      input.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;";
      const label = document.createElement("label");
      label.htmlFor = "ironlog-ios-haptic";
      label.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none;margin:0;";
      wrap.append(input, label);
      host.appendChild(wrap);
      iosHapticWrap = wrap;
      iosHapticLabel = label;
    }
    iosHapticLabel?.click();
  } catch {}
}

export function triggerHaptic(
  type: HapticKind = "light",
  { skipIosSwitch = false, fromUserGesture = true }: { skipIosSwitch?: boolean; fromUserGesture?: boolean } = {},
): void {
  try {
    if (typeof localStorage !== "undefined") {
      const hPref = localStorage.getItem("ironlog-web-haptics");
      if (hPref === "0" || hPref === "off") return;
    }
  } catch {}
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
      else if (type === "timer") navigator.vibrate([60, 80, 90]);
      return;
    } catch {}
  }

  if (!skipIosSwitch && fromUserGesture) triggerIosSwitchHaptic();
}

export const haptic = triggerHaptic;

let sharedAudioCtx: AudioContext | null = null;
let sharedAudioPrimed = false;

function setAmbientAudioSession(): void {
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession && navigator.audioSession.type !== "ambient") {
      navigator.audioSession.type = "ambient";
    }
  } catch {}
}

export function primeSharedAudio(): AudioContext | null {
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

interface AcousticPhraseConfig {
  notes: ReadonlyArray<readonly [number, number, number, number]>;
  cutoffHz: number;
  overtoneRatio: number;
  overtoneGain: number;
  thirdRatio?: number;
  thirdGain?: number;
}

const REST_SOUND_PHRASES: Record<RestSoundStyle, AcousticPhraseConfig> = {
  chime: {
    notes: [
      [523.25, 0, 0.45, 0.58],
      [783.99, 0.16, 0.72, 0.64],
    ],
    cutoffHz: 2800,
    overtoneRatio: 2,
    overtoneGain: 0.28,
  },
  marimba: {
    notes: [
      [392.0, 0, 0.28, 0.58],
      [523.25, 0.12, 0.34, 0.62],
      [659.25, 0.24, 0.54, 0.66],
    ],
    cutoffHz: 2400,
    overtoneRatio: 2,
    overtoneGain: 0.24,
    thirdRatio: 4,
    thirdGain: 0.1,
  },
  bell: {
    notes: [
      [587.33, 0, 0.64, 0.56],
      [880.0, 0.1, 0.85, 0.6],
    ],
    cutoffHz: 3200,
    overtoneRatio: 2,
    overtoneGain: 0.3,
    thirdRatio: 3,
    thirdGain: 0.12,
  },
};

export function createRestAudio(enabled: () => boolean, getStyle?: () => RestSoundStyle) {
  function playAcousticPhrase(audio: AudioContext | null, config: AcousticPhraseConfig): boolean {
    if (!audio) return false;
    try {
      const baseTime = Math.max(audio.currentTime, 0);
      let outputNode: AudioNode = audio.destination;
      if (typeof audio.createDynamicsCompressor === "function") {
        const comp = audio.createDynamicsCompressor();
        comp.threshold.value = -3;
        comp.knee.value = 6;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.12;
        comp.connect(audio.destination);
        outputNode = comp;
      }
      let sink: AudioNode = outputNode;
      if (typeof audio.createBiquadFilter === "function") {
        const filter = audio.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = config.cutoffHz;
        filter.Q.value = 0.7;
        filter.connect(outputNode);
        sink = filter;
      }
      const master = audio.createGain();
      master.gain.value = 1;
      master.connect(sink);

      const triggerPartial = (freq: number, start: number, dur: number, peak: number) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const attack = Math.min(0.012, dur * 0.25);
        const holdEnd = start + attack + Math.min(0.14, dur * 0.35);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + attack);
        gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak * 0.72), holdEnd);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.03);
      };

      for (const [freq, delay, length, peak] of config.notes) {
        const start = baseTime + delay;
        triggerPartial(freq, start, length, peak);
        triggerPartial(freq * config.overtoneRatio, start, length * 0.45, peak * config.overtoneGain);
        if (config.thirdRatio && config.thirdGain) {
          triggerPartial(freq * config.thirdRatio, start, length * 0.28, peak * config.thirdGain);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function emitTap(audio: AudioContext | null, kind: SoundTapKind): boolean {
    if (kind === "check") {
      return playAcousticPhrase(audio, {
        notes: [[523.25, 0, 0.09, 0.32]],
        cutoffHz: 2200,
        overtoneRatio: 2,
        overtoneGain: 0.18,
      });
    }
    if (kind === "pr") {
      return playAcousticPhrase(audio, {
        notes: [
          [523.25, 0, 0.16, 0.48],
          [659.25, 0.08, 0.18, 0.52],
          [783.99, 0.16, 0.36, 0.58],
        ],
        cutoffHz: 2800,
        overtoneRatio: 2,
        overtoneGain: 0.22,
      });
    }
    return playAcousticPhrase(audio, {
      notes: [[kind === "uncheck" ? 440 : 523.25, 0, 0.05, 0.22]],
      cutoffHz: 1800,
      overtoneRatio: 2,
      overtoneGain: 0.12,
    });
  }

  function withRunningAudio(action: (audio: AudioContext) => void): void {
    const audio = primeSharedAudio();
    if (!audio) return;
    try {
      if (audio.state === "running") {
        action(audio);
      } else {
        void audio
          .resume()
          .then(() => {
            sharedAudioPrimed = true;
            action(audio);
          })
          .catch(() => {});
      }
    } catch {}
  }

  function playPreset(style: RestSoundStyle): void {
    const phrase = REST_SOUND_PHRASES[style] ?? REST_SOUND_PHRASES.chime;
    withRunningAudio((audio) => {
      playAcousticPhrase(audio, phrase);
    });
  }

  return {
    unlock(): void {
      if (enabled()) primeSharedAudio();
    },
    tap(kind: SoundTapKind = "tick"): void {
      if (!enabled()) return;
      withRunningAudio((audio) => {
        emitTap(audio, kind);
      });
    },
    preview(style?: RestSoundStyle): void {
      playPreset(style ?? getStyle?.() ?? "chime");
    },
    play(complete: boolean): void {
      if (complete) triggerHaptic("timer", { fromUserGesture: false });
      if (!enabled()) return;
      if (complete) {
        playPreset(getStyle?.() ?? "chime");
        return;
      }
      withRunningAudio((audio) => {
        playAcousticPhrase(audio, {
          notes: [[587.33, 0, 0.08, 0.28]],
          cutoffHz: 2000,
          overtoneRatio: 2,
          overtoneGain: 0.16,
        });
      });
    },
  };
}

export function keepWorkoutScreenAwake(isActive: () => boolean, onStatus: (active: boolean) => void) {
  let lock: WakeLockSentinel | undefined;
  let pending = false;
  let closed = false;
  const permitted = () => !closed && isActive() && document.visibilityState === "visible";

  async function refresh(): Promise<void> {
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
    } catch {
      if (!closed) onStatus(false);
    } finally {
      pending = false;
    }
  }

  function update(): void {
    void refresh();
  }

  document.addEventListener("visibilitychange", update);
  return {
    update,
    stop(): void {
      closed = true;
      document.removeEventListener("visibilitychange", update);
      void refresh();
    },
  };
}
