import { z } from "zod";

export const appleWorkoutAnnotationInput = z.object({
  sessionId: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(4000),
  feeling: z.enum(["easy", "balanced", "fatigued"]).nullable(),
  distanceKm: z.string().trim().max(80),
  lapSeconds: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).max(1000),
});
export const appleWorkoutAnnotationSchema = appleWorkoutAnnotationInput.extend({
  updatedAt: z.iso.datetime(),
});
export type AppleWorkoutAnnotationInput = z.infer<typeof appleWorkoutAnnotationInput>;
export type AppleWorkoutAnnotation = z.infer<typeof appleWorkoutAnnotationSchema>;

export function latestAppleWorkoutAnnotation(
  first: AppleWorkoutAnnotation | undefined,
  second: AppleWorkoutAnnotation | undefined,
) {
  if (!first || (second && second.updatedAt > first.updatedAt)) return second;
  return first;
}
