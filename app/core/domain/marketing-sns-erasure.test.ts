import { expect, it } from 'vitest';

import { classifySesEvent } from './marketing-email.js';
import { readStoredMarketingSesEvents, scrubErasedMarketingSnsBody } from './marketing-sns-erasure.js';

const timestamp = '2026-11-01T12:00:00.000Z';
it('normalizes each recipient without losing distinct bounce classifications or correlation', () => {
  const body = JSON.stringify({ Message: JSON.stringify({ eventType: 'Bounce',
    mail: { messageId: 'provider', tags: { 'together-send-id': ['send'] }, destination: ['private@example.test'] },
    bounce: { timestamp, bounceType: 'Transient', bounceSubType: 'General', bouncedRecipients: [
      { emailAddress: 'private@example.test', status: '5.4.4', diagnosticCode: 'Private Person' },
      { emailAddress: 'other@example.test', status: '4.2.2', diagnosticCode: 'Other Person' },
    ] },
  }) });
  const scrubbed = scrubErasedMarketingSnsBody(body, 'topic');
  expect(scrubErasedMarketingSnsBody(scrubbed, 'topic')).toBe(scrubbed);
  for (const value of ['private', 'other@example', 'Person', 'emailAddress', 'diagnosticCode', '5.4.4']) expect(scrubbed).not.toContain(value);
  const events = readStoredMarketingSesEvents(scrubbed, 'topic');
  expect(events).toHaveLength(2);
  expect(events.map((event) => event.kind === 'bounce' ? classifySesEvent(event) : null)).toEqual(['hard', 'soft']);
  expect(events).toMatchObject([
    { topicArn: 'topic', messageId: 'provider', campaignSendId: 'send', occurredAt: timestamp },
    { topicArn: 'topic', messageId: 'provider', campaignSendId: 'send', occurredAt: timestamp },
  ]);
});

it('scrubs click URLs by the same policy as email events while preserving a processable receipt', () => {
  const body = JSON.stringify({ Message: JSON.stringify({ eventType: 'Click', mail: { messageId: 'provider' },
    click: { timestamp, link: 'https://example.test/news?email=private%40example.test#person', ipAddress: '192.0.2.1', userAgent: 'Private client' },
  }) });
  const scrubbed = scrubErasedMarketingSnsBody(body, 'topic');
  expect(readStoredMarketingSesEvents(scrubbed, 'topic')).toEqual([{
    kind: 'click', topicArn: 'topic', messageId: 'provider', occurredAt: timestamp, campaignSendId: undefined,
    linkUrl: 'https://example.test/news', raw: { eventType: 'Click', mail: { messageId: 'provider' }, click: { timestamp } },
  }]);
  expect(scrubErasedMarketingSnsBody(scrubbed, 'topic')).toBe(scrubbed);
});
