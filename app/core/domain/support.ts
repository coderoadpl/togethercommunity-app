import { z } from 'zod';

export const SUPPORT_SUBJECT_MAX = 200;
export const SUPPORT_BODY_MAX = 5000;

export const sendSupportMessageInputSchema = z.object({
  subject: z.string().trim().min(1).max(SUPPORT_SUBJECT_MAX),
  body: z.string().trim().min(1).max(SUPPORT_BODY_MAX),
});

export type SendSupportMessageInput = z.input<typeof sendSupportMessageInputSchema>;
