import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { prerenderedTransactionalPayload } from './email-outbox.js';
import { paymentEventRejectedEmail } from './transactional-email.js';

// Literal copies from the release on production (779b7198); they must not follow this release's schemas.
const m2mTransactionalMessageFields = {
  to: z.string().email(),
  subject: z.string().trim().min(1).max(200),
  html: z.string().min(1).max(1_000_000).optional(),
  text: z.string().min(1).max(500_000).optional(),
  replyTo: z.string().email().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
};

const m2mTransactionalPayloadSchema = z.object({
  kind: z.literal('m2m-transactional'),
  subject: m2mTransactionalMessageFields.subject,
  html: m2mTransactionalMessageFields.html,
  text: m2mTransactionalMessageFields.text,
  replyTo: m2mTransactionalMessageFields.replyTo,
}).strict();

const emailMessageSchema = z.object({
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
});

const textFromHtml = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || html;

const htmlFromText = (value: string): string => `<pre>${value.replace(/[&<>]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
})[character] ?? character)}</pre>`;

const previousRender = (raw: unknown) => {
  const parsed = m2mTransactionalPayloadSchema.safeParse(raw);
  if (!parsed.success) return parsed;
  const value = parsed.data;
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
};

describe('the unrecorded payment alert as the previous release reads it', () => {
  it.each([
    ['en', 'Acme <Studio>', 'cs_live_a1b2c3', 'Checkout snapshot not found'],
    ['pl', 'Akademia "Studio"', null, 'Payment processing failed unexpectedly'],
    ['pl', 'W'.repeat(100), `cs_live_${'x'.repeat(66)}`, 'The payment could not be processed'],
  ] as const)('parses and renders the %s alert of %s unchanged', (language, tenantName, checkoutSessionId, reasonMessage) => {
    const message = paymentEventRejectedEmail(language, {
      tenantName, eventId: 'evt_1', checkoutSessionId, reasonCode: 'validation', reasonMessage,
      firstSeenAt: '2026-11-20T10:00:00.000Z', studioUrl: 'https://acme.togethercommunity.app/panel/sales',
    });
    const expected = message.subject.length > 200 ? { ...message, subject: `${message.subject.slice(0, 199)}…` } : message;
    expect(previousRender(prerenderedTransactionalPayload(message))).toStrictEqual({ success: true, data: expected });
  });
});
