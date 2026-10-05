import { lessonEditionNumberSchema } from '#core/domain/index.js';

export const parseLessonEditionNumber = (input: unknown): string | undefined => {
  const parsed = lessonEditionNumberSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
};
