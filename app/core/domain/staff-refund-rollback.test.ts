import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { prerenderedTransactionalPayload } from './email-outbox.js';
import { ORDER_REFUND_ALERTS } from './order-refund-job.js';
import { orderRefundIssuedEmail, staffRefundAlertEmail } from './transactional-email.js';

// Literal copies from the release on production (8141fd15); they must not follow this release's schemas.
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

const longestTenantName = 'W'.repeat(100);

describe('the buyer refund notice as the previous release reads it', () => {
  it.each([
    ['en', 'Acme <Shop>', 4099, 'PLN'],
    ['pl', 'Acme <Shop>', 1500, 'PLN'],
    ['pl', longestTenantName, 99_999_999, 'EUR'],
    ['en', 'Acme <Shop>', 1200, 'JPY'],
  ] as const)('parses and renders the %s notice of %s unchanged', (language, tenantName, amountCents, currency) => {
    const message = orderRefundIssuedEmail(language, {
      tenantName, orderId: 'order-1', amountCents, currency, shopUrl: 'https://acme.example.com/',
      branding: { logoUrl: 'https://acme.example.com/logo.png', accentColor: '#123456', socialLinks: [] },
    });
    expect(previousRender(prerenderedTransactionalPayload(message))).toStrictEqual({ success: true, data: message });
  });
});

describe('the staff refund alerts as the previous release reads them', () => {
  it.each(ORDER_REFUND_ALERTS.flatMap((alert) => [
    ['en', alert, 'Acme <Shop>', 4099, 'PLN', true],
    ['pl', alert, longestTenantName, 99_999_999, 'JPY', false],
  ] as const))('parses and renders the %s %s alert of %s unchanged', (language, alert, tenantName, amountCents, currency, kept) => {
    const message = staffRefundAlertEmail(language, {
      tenantName, alert, orderId: 'order-1', amountCents, currency, mayHaveRefunded: !kept, restocked: kept, removedFromPackingList: kept,
      diagnostic: `The payment provider refused the refund, so nothing was refunded: ${'x'.repeat(2_000)}`, orderUrl: 'https://acme.example.com/panel/sales/order-1',
    });
    expect(previousRender(prerenderedTransactionalPayload(message))).toStrictEqual({ success: true, data: message });
  });
});
