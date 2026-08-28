import { z } from 'zod';

import { DEFAULT_LANGUAGE } from './language.js';
import { marketingConsentConfirmation } from './marketing-email.js';
import { SOCIAL_LINKS_MAX_COUNT, tenantSocialLinkSchema } from './tenant.js';
import { emailMessageSchema, magicLink, memberErasureRequestEmail, reputationAlertEmail, resetPassword, verifyEmail, welcomeSignIn, threadReply, directMessage, lessonQuestion, spaceEvent, spacePost, subscriptionEnded, subscriptionPaymentFailed, supportMessage } from './transactional-email.js';

const brandingSchema = z.object({
  logoUrl: z.string().url().nullable(),
  accentColor: z.string().nullable(),
  socialLinks: z.array(tenantSocialLinkSchema).max(SOCIAL_LINKS_MAX_COUNT).optional(),
});

const m2mTransactionalMessageFields = {
  to: z.string().email(),
  subject: z.string().trim().min(1).max(200),
  html: z.string().min(1).max(1_000_000).optional(),
  text: z.string().min(1).max(500_000).optional(),
  replyTo: z.string().email().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
};

export const m2mTransactionalMessageInputSchema = z.object(m2mTransactionalMessageFields).strict().refine((value) => value.html !== undefined || value.text !== undefined, {
  message: 'At least one of html or text is required',
  path: ['html'],
});

export type M2mTransactionalMessageInput = z.input<typeof m2mTransactionalMessageInputSchema>;

const m2mTransactionalPayloadSchema = z.object({
  kind: z.literal('m2m-transactional'),
  subject: m2mTransactionalMessageFields.subject,
  html: m2mTransactionalMessageFields.html,
  text: m2mTransactionalMessageFields.text,
  replyTo: m2mTransactionalMessageFields.replyTo,
}).strict();

export const emailOutboxPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome-sign-in'), language: z.string(), tenantName: z.string(), actionUrl: z.string().url(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('reset-password'), language: z.string(), actionUrl: z.string().url() }),
  z.object({ kind: z.literal('verify-email'), language: z.string(), actionUrl: z.string().url() }),
  z.object({ kind: z.literal('magic-link'), language: z.string(), tenantName: z.string(), url: z.string().url(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('thread-reply'), language: z.string(), tenantName: z.string(), lessonName: z.string(), authorDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('lesson-question'), language: z.string(), tenantName: z.string(), lessonName: z.string(), authorDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('space-post'), language: z.string(), tenantName: z.string(), spaceName: z.string(), authorDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('direct-message'), language: z.string(), tenantName: z.string(), senderDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('space-event'), language: z.string(), tenantName: z.string(), spaceName: z.string(), authorDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('subscription-payment-failed'), language: z.string(), tenantName: z.string(), productTitle: z.string(), accessEndsAt: z.string().datetime(), billingPortalUrl: z.string().url().nullable(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('subscription-ended'), language: z.string(), tenantName: z.string(), productTitle: z.string(), accessEndsAt: z.string().datetime(), offerUrl: z.string().url(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('support-message'), language: z.string(), tenantName: z.string(), memberEmail: z.string().email(), memberDisplay: z.string(), subject: z.string(), body: z.string(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('member-erasure-request'), language: z.string(), tenantName: z.string(), memberEmail: z.string().email(), requestedAt: z.string().datetime(), dueAt: z.string().datetime(), panelUrl: z.string().url() }),
  z.object({ kind: z.literal('reputation-alert'), language: z.string(), tenantName: z.string(), status: z.enum(['warn', 'critical']), hardBounceRate: z.number().nonnegative().nullable(), complaintRate: z.number().nonnegative().nullable(), windowStart: z.string().datetime(), windowEnd: z.string().datetime(), dashboardUrl: z.string().url() }),
  z.object({ kind: z.literal('marketing-consent-confirmation'), language: z.string().default(DEFAULT_LANGUAGE), wording: z.string().min(1), confirmationUrl: z.string().url() }),
  m2mTransactionalPayloadSchema,
]);

export type EmailOutboxPayload = z.output<typeof emailOutboxPayloadSchema>;

const textFromHtml = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || html;

const htmlFromText = (value: string): string => `<pre>${value.replace(/[&<>]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
})[character] ?? character)}</pre>`;

export const renderEmailOutboxPayload = (raw: unknown) => {
  const payload = emailOutboxPayloadSchema.safeParse(raw);
  if (!payload.success) return payload;
  const value = payload.data;
  if (value.kind === 'm2m-transactional') {
    if (value.html === undefined && value.text === undefined) return emailMessageSchema.safeParse({});
    return {
      success: true as const,
      data: {
        ...emailMessageSchema.parse({
          subject: value.subject,
          html: value.html ?? htmlFromText(value.text ?? ''),
          text: value.text ?? textFromHtml(value.html ?? ''),
        }),
        ...(value.replyTo === undefined ? {} : { headers: { 'Reply-To': value.replyTo } }),
      },
    };
  }
  const message = value.kind === 'welcome-sign-in'
    ? welcomeSignIn(value.language, { tenantName: value.tenantName, actionUrl: value.actionUrl, ...(value.branding === undefined ? {} : { branding: value.branding }) })
    : value.kind === 'reset-password'
      ? resetPassword(value.language, { actionUrl: value.actionUrl })
      : value.kind === 'verify-email'
        ? verifyEmail(value.language, { actionUrl: value.actionUrl })
      : value.kind === 'magic-link'
        ? magicLink(value.language, { tenantName: value.tenantName, url: value.url, ...(value.branding === undefined ? {} : { branding: value.branding }) })
        : value.kind === 'thread-reply'
          ? threadReply(value.language, value)
          : value.kind === 'lesson-question'
            ? lessonQuestion(value.language, value)
            : value.kind === 'space-post'
              ? spacePost(value.language, value)
              : value.kind === 'subscription-payment-failed'
                ? subscriptionPaymentFailed(value.language, {
                    tenantName: value.tenantName,
                    productTitle: value.productTitle,
                    accessEndsAt: value.accessEndsAt,
                    billingPortalUrl: value.billingPortalUrl,
                    ...(value.branding === undefined ? {} : { branding: value.branding }),
                  })
                : value.kind === 'subscription-ended'
                  ? subscriptionEnded(value.language, {
                      tenantName: value.tenantName,
                      productTitle: value.productTitle,
                      accessEndsAt: value.accessEndsAt,
                      offerUrl: value.offerUrl,
                      ...(value.branding === undefined ? {} : { branding: value.branding }),
                    })
                  : value.kind === 'support-message'
                    ? supportMessage(value.language, {
                        tenantName: value.tenantName,
                        memberEmail: value.memberEmail,
                        memberDisplay: value.memberDisplay,
                        subject: value.subject,
                        body: value.body,
                        ...(value.branding === undefined ? {} : { branding: value.branding }),
                      })
                    : value.kind === 'member-erasure-request'
                      ? memberErasureRequestEmail(value.language, value)
                      : value.kind === 'reputation-alert'
                        ? reputationAlertEmail(value.language, value)
                        : value.kind === 'direct-message'
                          ? directMessage(value.language, value)
                          : value.kind === 'space-event'
                            ? spaceEvent(value.language, value)
                            : marketingConsentConfirmation(value);
  return { success: true as const, data: emailMessageSchema.parse(message) };
};
