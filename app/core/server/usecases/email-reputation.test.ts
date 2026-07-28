import { describe, expect, it } from 'vitest';

import { emailEventSchema, type CampaignSend, type EmailEvent, type Identity } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { InMemoryCampaignSendRepository, InMemoryEmailEventRepository } from '../testing/marketing-fakes.js';
import { getEmailReputation } from './email-reputation.js';

const NOW = '2026-07-27T12:00:00.000Z';
const ctx: Ctx = { identity: {
  userId: 'staff-1',
  email: 'staff@example.test',
  name: 'Staff',
  tenantId: 'tenant-1',
  tenantSlug: 'tenant',
  tenantName: 'Tenant',
  staffRole: 'owner',
  memberId: null,
} satisfies Identity };

const event = (
  id: string,
  refId: string,
  type: EmailEvent['type'],
  occurredAt: string,
  meta: unknown,
): EmailEvent => emailEventSchema.parse({
  id,
  tenantId: 'tenant-1',
  mailKind: 'marketing',
  refId,
  type,
  occurredAt,
  meta,
  createdAt: occurredAt,
});

describe('get email reputation', () => {
  it('derives rates from distinct sends and events inside the trailing window', async () => {
    const events = new InMemoryEmailEventRepository();
    const sends = new InMemoryCampaignSendRepository(events);
    for (let index = 0; index < 2_000; index += 1) {
      const sentAt = index === 0 ? '2026-07-20T12:00:00.000Z' : '2026-07-25T12:00:00.000Z';
      const send: CampaignSend = {
        id: `send-${String(index)}`, runId: null, tenantId: 'tenant-1', campaignId: null,
        source: 'api', memberId: null, email: `member-${String(index)}@example.test`,
        subject: 'Reputation', consentRowId: 'consent-1', unsubscribeTokenId: null,
        status: 'sent', skipReason: null, sesMessageId: `ses-${String(index)}`,
        deliveryStatus: null, deliveryOccurredAt: null, idempotencySource: null,
        renderedBodyPurgedAt: null, createdAt: sentAt, sentAt,
      };
      await sends.claimRecipient('tenant-1', send);
    }
    for (let index = 0; index < 100; index += 1) {
      await events.append('tenant-1', event(
        `bounce-${String(index)}`,
        `send-${String(index)}`,
        'bounced',
        '2026-07-26T12:00:00.000Z',
        { classification: 'hard', rawProviderPayload: {} },
      ));
    }
    for (let index = 0; index < 3; index += 1) {
      await events.append('tenant-1', event(
        `complaint-${String(index)}`,
        `send-${String(index + 100)}`,
        'complained',
        '2026-07-26T12:00:00.000Z',
        {},
      ));
    }
    await events.append('tenant-1', event(
      'duplicate-complaint',
      'send-100',
      'complained',
      '2026-07-26T12:01:00.000Z',
      {},
    ));
    await events.append('tenant-1', event(
      'old-bounce',
      'send-old',
      'bounced',
      '2026-07-20T11:59:59.999Z',
      { classification: 'hard', rawProviderPayload: {} },
    ));

    const result = await getEmailReputation(ctx, { events, clock: { nowIso: () => NOW } });

    expect(result).toEqual({
      ok: true,
      value: {
        windowStart: '2026-07-20T12:00:00.000Z',
        windowEnd: NOW,
        hardBounce: { count: 100, sends: 2_000, rate: 0.05, status: 'warn' },
        complaint: { count: 3, sends: 2_000, rate: 0.0015, status: 'critical' },
        overallStatus: 'critical',
      },
    });
  });

  it('requires tenant staff identity', async () => {
    const result = await getEmailReputation({ identity: { ...ctx.identity, staffRole: null } }, {
      events: new InMemoryEmailEventRepository(),
      clock: { nowIso: () => NOW },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
