const ACTIVITY_ALIAS_MAP: Record<string, string> = {
  traditionalstrength: "traditionalstrengthtraining",
  strengthtraining: "traditionalstrengthtraining",
  weighttraining: "traditionalstrengthtraining",
  functionalstrength: "functionalstrengthtraining",
  run: "running",
  indoorrunning: "running",
  outdoorrunning: "running",
  runningindoor: "running",
  runningoutdoor: "running",
  treadmill: "running",
  walk: "walking",
  indoorwalking: "walking",
  outdoorwalking: "walking",
  walkingindoor: "walking",
  walkingoutdoor: "walking",
  bike: "cycling",
  indoorcycling: "cycling",
  outdoorcycling: "cycling",
  cyclingindoor: "cycling",
  cyclingoutdoor: "cycling",
  handcycling: "cycling",
  stairstepper: "stairclimbing",
  stairmaster: "stairclimbing",
  stepmachine: "stairclimbing",
  ellipticaltrainer: "elliptical",
  row: "rowing",
  indoorrowing: "rowing",
  swim: "swimming",
  poolswimming: "swimming",
  openwaterswimming: "swimming",
  hiit: "highintensityintervaltraining",
  skipping: "jumprope",
  ropejump: "jumprope",
};

export function canonicalAppleActivityType(raw: string): string {
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/^hkworkoutactivitytype/, "")
    .replace(/[-_\s]/g, "");
  return ACTIVITY_ALIAS_MAP[clean] ?? clean;
}

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
  return `time:${canonicalAppleActivityType(workout.activityType)}:${workout.startedAt}:${workout.endedAt}`;
}
