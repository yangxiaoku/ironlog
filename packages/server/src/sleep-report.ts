import type { SleepReport, SleepReportDay } from "@ironlog/shared";
import { timedSleepProfile, type DailyHealthSnapshot } from "./apple-health-daily.js";
import { shiftDay } from "./web-statistics.js";

const REFERENCE_MINUTES = 7 * 60;
const DAY_MINUTES = 24 * 60;

function validMinutes(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= DAY_MINUTES ? Math.round(value) : null;
}

function buildDay(date: string, entry?: DailyHealthSnapshot): SleepReportDay {
  const missing: SleepReportDay = { date, minutes: null, source: null, window: null, stages: null };
  if (!entry) return missing;

  const timed = timedSleepProfile(entry);
  const minutes = validMinutes(timed?.minutes ?? entry.sleepMinutes);
  if (!minutes) return missing;

  const untimedStages = timed?.untimedStages ?? [];
  const isMixed = Boolean(timed && untimedStages.length > 0);
  const stages = timed
    ? timed.stages
    : {
        core: validMinutes(entry.sleepCoreMinutes),
        deep: validMinutes(entry.sleepDeepMinutes),
        rem: validMinutes(entry.sleepRemMinutes),
      };
  const hasStages = stages && Object.values(stages).some((value) => value != null);
  const stageTotal = Object.values(stages ?? {}).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return {
    date,
    minutes,
    source: isMixed ? "mixed" : timed ? "intervals" : "summary",
    window: timed?.window ?? null,
    stages: hasStages && stageTotal <= minutes + 1 ? stages : null,
    ...(untimedStages.length > 0 ? { untimedStages } : {}),
  };
}

function summarizePeriod(series: SleepReportDay[], from: string, through: string) {
  const samples = series.flatMap(({ minutes }) => minutes == null ? [] : [minutes]);
  return {
    from,
    through,
    days: series.length,
    recordedDays: samples.length,
    averageMinutes: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null,
    referenceDays: samples.filter((minutes) => minutes >= REFERENCE_MINUTES).length,
  };
}

function sleepMidpoint({ startAt, endAt }: NonNullable<SleepReportDay["window"]>) {
  const midpoint = (Date.parse(startAt) + Date.parse(endAt)) / 120_000;
  return ((midpoint % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

export function buildSleepReport(entries: DailyHealthSnapshot[], from: string, through: string, days: number): SleepReport {
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const daysFrom = (start: string) => Array.from({ length: days }, (_, i) => {
    const date = shiftDay(start, i);
    return buildDay(date, byDate.get(date));
  });

  const series = daysFrom(from);
  const previousFrom = shiftDay(from, -days);
  const current = summarizePeriod(series, from, through);
  const previous = summarizePeriod(daysFrom(previousFrom), previousFrom, shiftDay(from, -1));
  // Suppress comparisons of sparse periods. Coverage is a display rule, not a health threshold.
  const comparable = (period: typeof current) => period.recordedDays >= Math.max(3, Math.ceil(period.days / 2));
  const change = comparable(current) && comparable(previous) && current.averageMinutes != null && previous.averageMinutes != null
    ? Math.round(current.averageMinutes - previous.averageMinutes)
    : null;

  const shifts: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const first = series[i - 1]!.window;
    const next = series[i]!.window;
    if (!first || !next) continue;
    const difference = Math.abs(sleepMidpoint(first) - sleepMidpoint(next));
    shifts.push(Math.min(difference, DAY_MINUTES - difference));
  }
  shifts.sort((a, b) => a - b);
  const middle = Math.floor(shifts.length / 2);
  const medianShiftMinutes = shifts.length < 3 ? null : Math.round(
    shifts.length % 2 === 0 ? (shifts[middle - 1]! + shifts[middle]!) / 2 : shifts[middle]!,
  );
  return {
    current: { ...current, averageMinutes: current.averageMinutes == null ? null : Math.round(current.averageMinutes) },
    previous: { ...previous, averageMinutes: previous.averageMinutes == null ? null : Math.round(previous.averageMinutes) },
    referenceMinutes: REFERENCE_MINUTES,
    averageChangeMinutes: change,
    timing: { measuredDays: series.filter(({ window }) => window != null).length, adjacentPairs: shifts.length, medianShiftMinutes },
    series,
  };
}
