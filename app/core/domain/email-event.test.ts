import { describe, expect, it } from 'vitest';

import { emailEventSchema, emailEventTypeSchema } from './email-event.js';

const event = {
  id: 'event-1',
  tenantId: 'tenant-1',
  mailKind: 'marketing',
  refId: 'send-1',
  type: 'queued',
  occurredAt: '2026-07-26T10:00:00.000Z',
  meta: null,
  createdAt: '2026-07-26T10:00:00.000Z',
} as const;

describe('email event domain', () => {
  it('keeps lifecycle event types closed', () => {
    expect(emailEventTypeSchema.options).toEqual([
      'queued',
      'claimed',
      'rendered',
      'accepted',
      'delivered',
      'bounced',
      'complained',
      'skipped',
      'failed',
      'retried',
      'suppressed_written',
      'unsubscribed',
    ]);
    expect(emailEventTypeSchema.safeParse('opened').success).toBe(false);
  });

  it('validates the immutable event envelope and structured metadata', () => {
    expect(emailEventSchema.parse(event)).toEqual(event);
    expect(emailEventSchema.safeParse({
      ...event,
      type: 'accepted',
      meta: { sesMessageId: 'ses-1' },
    }).success).toBe(true);
    expect(emailEventSchema.safeParse({
      ...event,
      type: 'accepted',
      meta: { sesMessageId: '' },
    }).success).toBe(false);
    expect(emailEventSchema.safeParse({
      ...event,
      type: 'bounced',
      meta: { classification: 'hard', rawProviderPayload: { bounceType: 'Permanent' } },
    }).success).toBe(true);
  });
});
