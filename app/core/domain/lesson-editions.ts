import { z } from 'zod';

export const lessonEditionNumberSchema = z.string().max(12).regex(/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,2}(?![\s\S])/);
export const lessonEditionInputSchema = z.object({
  number: lessonEditionNumberSchema,
  note: z.string().max(200).optional(),
});
export type LessonEditionInput = z.infer<typeof lessonEditionInputSchema>;
export const lessonEditionSchema = z.object({
  versionId: z.string().min(1),
  number: lessonEditionNumberSchema,
  note: z.string().max(200).nullable(),
  markedAt: z.string().datetime(),
});
export type LessonEdition = z.infer<typeof lessonEditionSchema>;
export const markLessonEditionInputSchema = z.object({
  edition: lessonEditionInputSchema,
  lessonId: z.string().min(1),
  versionId: z.string().min(1).optional(),
});
export const unmarkLessonEditionInputSchema = z.object({
  lessonId: z.string().min(1),
  number: lessonEditionNumberSchema,
});
export const compareLessonEditionNumbers = (left: string, right: string): number => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
};
