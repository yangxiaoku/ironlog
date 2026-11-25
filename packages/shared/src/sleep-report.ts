export interface SleepReportDay {
  date: string;
  minutes: number | null;
  source: "intervals" | "summary" | null;
  window: { startAt: string; endAt: string } | null;
  stages: { core: number | null; deep: number | null; rem: number | null } | null;
}

interface SleepPeriodSummary {
  from: string;
  through: string;
  days: number;
  recordedDays: number;
  averageMinutes: number | null;
  referenceDays: number;
}

export interface SleepReport {
  current: SleepPeriodSummary;
  previous: SleepPeriodSummary;
  referenceMinutes: number;
  averageChangeMinutes: number | null;
  timing: { measuredDays: number; adjacentPairs: number; medianShiftMinutes: number | null };
  series: SleepReportDay[];
}
