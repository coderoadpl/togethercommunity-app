import { z } from 'zod';

const SUPPORT_SUBJECT_MAX = 200;
const SUPPORT_BODY_MAX = 5000;

export const sendSupportMessageInputSchema = z.object({
  subject: z.string().trim().min(1).max(SUPPORT_SUBJECT_MAX),
  body: z.string().trim().min(1).max(SUPPORT_BODY_MAX),
});
