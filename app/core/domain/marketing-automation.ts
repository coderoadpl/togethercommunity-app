import { z } from 'zod';

import { campaignSendSchema, marketingConsentSourceSchema } from './marketing-email.js';

const marketingAutomationMessageSchema = z.object({
  to: z.string().email(),
  consentDefinitionId: z.string().min(1),
  templateId: z.string().min(1).optional(),
  bodyHtml: z.string().min(1).optional(),
  data: z.record(z.unknown()).default({}),
  campaignKey: z.string().min(1).max(120).optional(),
  subject: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if ((value.templateId === undefined) === (value.bodyHtml === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one of templateId or bodyHtml is required' });
  }
  if (value.bodyHtml !== undefined && value.subject === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject'], message: 'Inline messages require a subject' });
  }
});

export const marketingAutomationMessagesSchema = z.union([
  marketingAutomationMessageSchema.transform((message) => ({ messages: [message] })),
  z.object({ messages: z.array(marketingAutomationMessageSchema).min(1).max(50) }),
]);

export const marketingEligibilityQuerySchema = z.object({
  email: z.string().email(),
  definitionId: z.string().min(1).optional(),
});

export const marketingConsentApiSchema = z.object({
  email: z.string().email(),
  memberId: z.string().min(1).nullable().default(null),
  definitionId: z.string().min(1),
  collectedAt: z.string().datetime(),
  source: marketingConsentSourceSchema.default('api'),
  proofRef: z.string().min(1),
  ip: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
});

export const marketingSuppressionApiSchema = z.object({
  email: z.string().email(),
  reason: z.literal('manual'),
  sourceRef: z.string().min(1).nullable().default(null),
});

export const marketingSuppressionQuerySchema = z.object({
  email: z.string().email().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const marketingMessagesQuerySchema = z.object({
  campaignKey: z.string().min(1).optional(),
  email: z.string().email().optional(),
  status: campaignSendSchema.shape.status.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
