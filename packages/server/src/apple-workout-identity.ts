export function appleWorkoutIdentity(
  workout: {
    activityType: string;
    startedAt: string;
    endedAt: string;
    externalWorkoutId?: string | null;
    clientSessionId?: string | null;
  },
  deviceId?: string,
): string {
  if (workout.externalWorkoutId) return `workout:${workout.externalWorkoutId.toLowerCase()}`;
  if (deviceId && workout.clientSessionId) return `session:${deviceId}:${workout.clientSessionId}`;
  return `time:${workout.activityType.toLowerCase()}:${workout.startedAt}:${workout.endedAt}`;
}
