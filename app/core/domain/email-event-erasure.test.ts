import { describe, expect, it } from 'vitest';

import { emailEventSchema, type EmailEventType } from './email-event.js';
import { scrubErasedEmailEvent } from './email-event-erasure.js';

const now = '2026-11-01T12:00:00.000Z';
const event = (type: EmailEventType, meta: Record<string, unknown>) => emailEventSchema.parse({
  id: 'event', tenantId: 'tenant', mailKind: 'marketing', refId: 'send', type, meta, occurredAt: now, createdAt: now,
});
const personal = {
  recipient: 'PERSON@example.test', displayName: 'Private Person', ipAddress: '192.0.2.1', userAgent: 'Private client',
  'person%40example.test': ['person@example.test'],
};

describe('erased email event metadata', () => {
  it.each(['delivered', 'complained', 'opened', 'bounced', 'clicked', 'failed', 'uncertain', 'skipped', 'accepted'] as const)(
    'keeps %s parseable without recipient metadata', (type) => {
      const input = event(type, { ...personal, classification: 'hard', error: 'Private Person', reason: 'person@example.test',
        sesMessageId: 'provider-1', campaignId: 'campaign-1', linkUrl: 'https://example.test/article?email=person%40example.test#private',
        rawProviderPayload: { ...personal, mail: { messageId: 'provider-1', timestamp: now, destination: ['person@example.test'], commonHeaders: { to: ['Private Person'] } },
          bounce: { timestamp: now, bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'person@example.test' }] },
          complaint: { timestamp: now, complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'person@example.test' }] } },
      });
      const output = scrubErasedEmailEvent(input);
      expect(emailEventSchema.safeParse(output).success).toBe(true);
      expect(scrubErasedEmailEvent(output)).toEqual(output);
      expect(output).toMatchObject({ id: 'event', refId: 'send', occurredAt: now, meta: { sesMessageId: 'provider-1', campaignId: 'campaign-1',
        rawProviderPayload: { mail: { messageId: 'provider-1', timestamp: now }, bounce: { timestamp: now, bounceType: 'Permanent', bounceSubType: 'General' }, complaint: { timestamp: now, complaintFeedbackType: 'abuse' } } } });
      const serialized = JSON.stringify(output);
      for (const value of ['Private', 'person', 'PERSON', '192.0.2.1', 'userAgent', 'recipient']) expect(serialized).not.toContain(value);
      if (type === 'clicked') expect(output.meta).toHaveProperty('linkUrl', 'https://example.test/article');
      if (type === 'bounced') expect(output.meta).toHaveProperty('classification', 'hard');
    },
  );

  it.each(['mailto:person@example.test', 'not a url', 'https://person:secret@example.test/person%40example.test', 'https://example.test/person%2540example.test'])(
    'does not retain an address hidden in %s', (linkUrl) => {
      expect(scrubErasedEmailEvent(event('clicked', { linkUrl })).meta).toEqual({ linkUrl: '[erased]' });
    },
  );

  it('removes URL credentials, query strings and fragments', () => {
    expect(scrubErasedEmailEvent(event('clicked', { linkUrl: 'https://person:secret@example.test/path?q=private#person' })).meta)
      .toEqual({ linkUrl: 'https://example.test/path' });
  });
});
