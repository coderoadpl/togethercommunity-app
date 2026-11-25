import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { PaymentEventRejection } from '#core/domain/index.js';

import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { RejectedPaymentsSection } from './RejectedPaymentsSection.js';

const rejection: PaymentEventRejection = {
  tenantId: 'tenant-acme',
  eventId: 'evt_1',
  eventType: 'checkout.session.completed',
  checkoutSessionId: 'cs_1',
  reasonCode: 'validation',
  reasonMessage: 'Checkout snapshot not found',
  firstSeenAt: '2026-11-20T10:00:00.000Z',
  lastSeenAt: '2026-11-20T12:00:00.000Z',
  attempts: 3,
  resolvedAt: null,
};

const reply = (rejections: PaymentEventRejection[]) =>
  server.use(http.get('*/api/orders/rejected-payments', () => HttpResponse.json({ ok: true, data: { rejections } })));

describe('RejectedPaymentsSection', () => {
  it('lists each payment that could not be recorded with its reason, sightings, attempts and ids', async () => {
    reply([rejection, { ...rejection, eventId: 'evt_2', checkoutSessionId: null, attempts: 1, reasonCode: 'internal', reasonMessage: 'Payment processing failed unexpectedly' }]);

    renderWithProviders(<RejectedPaymentsSection />);

    const section = await screen.findByTestId('rejected-payments');
    expect(within(section).getByText('Payments that could not be recorded')).toBeVisible();
    expect(section).toHaveTextContent('Stripe retries each delivery for up to three days. Do not refund or ask the buyer to pay again before support has checked it.');
    const rows = within(section).getAllByTestId('rejected-payment-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('validation: Checkout snapshot not found');
    expect(rows[0]).toHaveTextContent('3');
    expect(rows[0]).toHaveTextContent('evt_1');
    expect(rows[0]).toHaveTextContent('cs_1');
    expect(rows[1]).toHaveTextContent('internal: Payment processing failed unexpectedly');
    expect(rows[1]).toHaveTextContent('—');
  });

  it('shows nothing while every payment was recorded', async () => {
    let requested = false;
    server.use(http.get('*/api/orders/rejected-payments', () => {
      requested = true;
      return HttpResponse.json({ ok: true, data: { rejections: [] } });
    }));

    const { container } = renderWithProviders(<RejectedPaymentsSection />);

    await expect.poll(() => requested).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });
});
