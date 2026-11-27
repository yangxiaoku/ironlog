import { z } from "zod";

const annotationFeelingSchema = z.enum(["easy", "balanced", "fatigued"]).nullable();

export const appleWorkoutAnnotationBaseSchema = z.object({
  notes: z.string().trim().max(4000).optional(),
  feeling: annotationFeelingSchema.optional(),
  distanceKm: z.string().trim().max(80).optional(),
  lapSeconds: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).max(1000).optional(),
});

export const appleWorkoutAnnotationInput = z.object({
  sessionId: z.string().trim().min(1).max(100).optional(),
  source: z.enum(["manual", "cardio_session"]).optional(),
  notes: z.string().trim().max(4000).optional(),
  feeling: annotationFeelingSchema.optional(),
  distanceKm: z.string().trim().max(80).optional(),
  lapSeconds: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).max(1000).optional(),
  expectedUpdatedAt: z.string().nullable().optional(),
  base: appleWorkoutAnnotationBaseSchema.optional(),
});

export const appleWorkoutAnnotationSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  source: z.enum(["manual", "cardio_session"]).optional(),
  notes: z.string().trim().max(4000),
  feeling: annotationFeelingSchema,
  distanceKm: z.string().trim().max(80),
  lapSeconds: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).max(1000),
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
