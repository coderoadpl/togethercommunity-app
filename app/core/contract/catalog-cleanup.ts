import { z } from 'zod';

export {
  archiveCourseInputSchema as courseArchiveInputSchema,
  restoreCourseInputSchema as courseRestoreInputSchema,
} from '#core/domain/index.js';

export const coursesListQuerySchema = z.object({
  archived: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});
export const productDeleteInputSchema = z.object({ productId: z.string().min(1) });
export const productDeleteOutputSchema = z.object({ deleted: z.literal(true) });
