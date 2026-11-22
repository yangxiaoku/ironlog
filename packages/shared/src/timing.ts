import type { Workout } from "./index.js";
import { localDate } from "./logic.js";

export function workoutDurationSeconds(workout: Workout, now = Date.now()): number | null {
  if (workout.durationUnknown && workout.status === "completed") return null;
  const end = workout.endedAt ? Date.parse(workout.endedAt) : now;
  if (workout.timing) {
    const running = workout.timing.runningSince
      ? Math.max(0, Math.floor((end - Date.parse(workout.timing.runningSince)) / 1000))
      : 0;
    return Math.min(Number.MAX_SAFE_INTEGER, workout.timing.elapsedSeconds + running);
  }
  if (workout.source === "ai" || (workout.status !== "active" && !workout.endedAt)) return null;
  return Math.max(0, Math.floor((end - Date.parse(workout.startedAt)) / 1000));
}

export function workoutTimerPaused(workout: Workout) {
  return workout.status === "active" && workout.timing?.runningSince === null;
}

export function latestCompletedSetAt(workout: Workout) {
  return Math.max(0, ...workout.exercises.flatMap((row) => row.sets
    .filter((set) => set.completed && set.completedAt)
    .map((set) => Date.parse(set.completedAt!))));
}

export function workoutInterruption(workout: Workout, checkpoint: number, now = Date.now()) {
  if (workout.status !== "active" || workoutTimerPaused(workout)) return null;
  const started = Date.parse(workout.startedAt);
  const lastSetAt = latestCompletedSetAt(workout);
  const running = workout.timing?.runningSince ? Date.parse(workout.timing.runningSince) : started;
  const cutoff = Math.max(running, started, checkpoint || 0, lastSetAt);
  const minutes = Math.floor((now - cutoff) / 60000);
  if (minutes < 45 && (minutes < 15 || localDate(cutoff) === localDate(now))) return null;
  return { cutoff, minutes, lastSetAt: lastSetAt >= started && lastSetAt <= now ? lastSetAt : 0 };
}

export function toggleWorkoutTimer(workout: Workout, now: number): Workout {
  if (workout.status !== "active") return workout;
  return {
    ...workout,
    timing: {
      elapsedSeconds: workoutDurationSeconds(workout, now) ?? 0,
      runningSince: workoutTimerPaused(workout) ? new Date(now).toISOString() : null,
    },
  };
}

export function correctWorkoutDuration(workout: Workout, seconds: number, now: number): Workout {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("请输入有效的训练时长");
  return {
    ...workout,
    ...(workout.durationUnknown ? { durationUnknown: false } : {}),
    timing: {
      elapsedSeconds: seconds,
      runningSince: workout.status === "active" && !workoutTimerPaused(workout)
        ? new Date(now).toISOString() : null,
    },
  };
}

export function stopWorkoutTimer(workout: Workout, now: number): Workout {
  const seconds = workoutDurationSeconds(workout, now);
  return seconds === null ? workout : {
    ...workout,
    timing: { elapsedSeconds: seconds, runningSince: null },
  };
}

export function durationFromMinutes(text: string): number | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const seconds = Math.round(Number(text) * 60);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

export function durationMinutesText(seconds: number | null) {
  return seconds === null ? "" : String(Math.round(seconds / 60 * 100) / 100);
}
