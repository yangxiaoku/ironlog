import { z } from "zod";

const dayMs = 86_400_000;
const stage = z.enum(["deep", "rem", "core", "asleep", "awake", "inBed"]);
const timestamp = z.number().int().min(Date.UTC(1900, 0, 1)).max(Date.UTC(9999, 11, 30));
const interval = z.tuple([timestamp, timestamp]).refine(([start, end]) => end > start && end - start <= dayMs);
const observation = z.union([
  z.object({ stage, interval }),
  z.object({ stage, minutes: z.number().positive().max(1440) }),
]);

export const sleepObservationsSchema = z.array(observation);
export type SleepObservation = z.infer<typeof observation>;
export type SleepStage = z.infer<typeof stage>;
