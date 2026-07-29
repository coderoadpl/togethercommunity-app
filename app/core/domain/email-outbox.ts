import { z } from 'zod';

import { marketingConsentConfirmation } from './marketing-email.js';
import { emailMessageSchema, magicLink, memberErasureRequestEmail, reputationAlertEmail, resetPassword, welcomeSetPassword, threadReply, lessonQuestion, spacePost, subscriptionEnded, subscriptionPaymentFailed, supportMessage } from './transactional-email.js';

const brandingSchema = z.object({ logoUrl: z.string().url().nullable(), accentColor: z.string().nullable() });

export const emailOutboxPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome-set-password'), language: z.string(), tenantName: z.string(), actionUrl: z.string().url(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('reset-password'), language: z.string(), actionUrl: z.string().url() }),
  z.object({ kind: z.literal('magic-link'), language: z.string(), tenantName: z.string(), url: z.string().url(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('thread-reply'), language: z.string(), tenantName: z.string(), lessonName: z.string(), authorDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('lesson-question'), language: z.string(), tenantName: z.string(), lessonName: z.string(), authorDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('space-post'), language: z.string(), tenantName: z.string(), spaceName: z.string(), authorDisplay: z.string(), snippet: z.string(), url: z.string().url() }),
  z.object({ kind: z.literal('subscription-payment-failed'), language: z.string(), tenantName: z.string(), productTitle: z.string(), accessEndsAt: z.string().datetime(), billingPortalUrl: z.string().url().nullable(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('subscription-ended'), language: z.string(), tenantName: z.string(), productTitle: z.string(), accessEndsAt: z.string().datetime(), offerUrl: z.string().url(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('support-message'), language: z.string(), tenantName: z.string(), memberEmail: z.string().email(), memberDisplay: z.string(), subject: z.string(), body: z.string(), branding: brandingSchema.optional() }),
  z.object({ kind: z.literal('member-erasure-request'), language: z.string(), tenantName: z.string(), memberEmail: z.string().email(), requestedAt: z.string().datetime(), dueAt: z.string().datetime(), panelUrl: z.string().url() }),
  z.object({ kind: z.literal('reputation-alert'), language: z.string(), tenantName: z.string(), status: z.enum(['warn', 'critical']), hardBounceRate: z.number().nonnegative().nullable(), complaintRate: z.number().nonnegative().nullable(), windowStart: z.string().datetime(), windowEnd: z.string().datetime(), dashboardUrl: z.string().url() }),
  z.object({ kind: z.literal('marketing-consent-confirmation'), wording: z.string().min(1), confirmationUrl: z.string().url() }),
]);

export type EmailOutboxPayload = z.output<typeof emailOutboxPayloadSchema>;

export const renderEmailOutboxPayload = (raw: unknown) => {
  const payload = emailOutboxPayloadSchema.safeParse(raw);
  if (!payload.success) return payload;
  const value = payload.data;
  const message = value.kind === 'welcome-set-password'
    ? welcomeSetPassword(value.language, { tenantName: value.tenantName, actionUrl: value.actionUrl, ...(value.branding === undefined ? {} : { branding: value.branding }) })
    : value.kind === 'reset-password'
      ? resetPassword(value.language, { actionUrl: value.actionUrl })
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
                        : marketingConsentConfirmation(value);
  return { success: true as const, data: emailMessageSchema.parse(message) };
};
