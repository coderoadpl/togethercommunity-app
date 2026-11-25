import { describe, expect, it } from 'vitest';

import { paymentEventRejectedOutboxId } from './payment-event-rejection.js';

describe('the outbox id of a rejected payment alert', () => {
  it('keys the recipient by a short hash of the trimmed lower-case address, never the address itself', () => {
    const id = paymentEventRejectedOutboxId('tenant-acme', 'evt_paid', ' Owner@TogetherCommunity.app ');

    expect(id).toBe('payment-event-rejected:tenant-acme:evt_paid:1cbe10476181a7b8');
    expect(id).not.toContain('togethercommunity');
    expect(paymentEventRejectedOutboxId('tenant-acme', 'evt_paid', 'owner@togethercommunity.app')).toBe(id);
  });

  it('differs per address, event and workspace', () => {
    const ids = [
      paymentEventRejectedOutboxId('tenant-acme', 'evt_paid', 'owner@togethercommunity.app'),
      paymentEventRejectedOutboxId('tenant-acme', 'evt_paid', 'admin@togethercommunity.app'),
      paymentEventRejectedOutboxId('tenant-acme', 'evt_other', 'owner@togethercommunity.app'),
      paymentEventRejectedOutboxId('tenant-studio', 'evt_paid', 'owner@togethercommunity.app'),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});
