import { describe, expect, it } from 'vitest';

import { parseMarketingSesEvents } from './marketing-sns-inbox.js';

const NOW = '2026-09-10T10:00:00.000Z';

describe('parseMarketingSesEvents', () => {
  it.each(['notificationType', 'eventType'] as const)(
    'preserves bounce diagnostics from the %s payload shape',
    (discriminator) => {
      const events = parseMarketingSesEvents({
        [discriminator]: 'Bounce',
        mail: { messageId: 'ses-message-1' },
        bounce: {
          timestamp: NOW,
          bounceType: 'Undetermined',
          bounceSubType: 'Undetermined',
          bouncedRecipients: [{
            emailAddress: 'recipient@example.test',
            status: '5.0.0',
            diagnosticCode: 'smtp; 250 automated response',
            action: 'failed',
          }],
        },
      }, 'arn:aws:sns:eu-central-1:000000000000:events');

      expect(events).toMatchObject([{
        kind: 'bounce',
        bounceType: 'Undetermined',
        bounceSubType: 'Undetermined',
        status: '5.0.0',
        diagnosticCode: 'smtp; 250 automated response',
        action: 'failed',
      }]);
    },
  );

  it('normalizes omitted bounce diagnostics to null', () => {
    expect(parseMarketingSesEvents({
      eventType: 'Bounce',
      mail: { messageId: 'ses-message-2' },
      bounce: {
        timestamp: NOW,
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: 'recipient@example.test' }],
      },
    }, 'arn:aws:sns:eu-central-1:000000000000:events')).toMatchObject([{
      kind: 'bounce',
      bounceSubType: null,
      status: null,
      diagnosticCode: null,
      action: null,
    }]);
  });
});
