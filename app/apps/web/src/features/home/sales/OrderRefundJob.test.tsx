import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OrderRefundJobView } from '#core/domain/index.js';
import { renderWithProviders } from '../../../test/render.js';
import { OrderRefundJob } from './OrderRefundJob.js';

const job: OrderRefundJobView = {
  status: 'blocked_permission', attempts: 1, nextAttemptAt: null, lastError: 'The provided key does not have the required permissions',
  amountCents: 4099, currency: 'PLN', idempotencyKey: 'oos-refund-order-1', providerRefundId: null, providerRefundStatus: null,
  submittedAt: null, createdAt: '2026-11-15T10:42:00.000Z', updatedAt: '2026-11-15T10:43:00.000Z',
};

describe('OrderRefundJob', () => {
  it('shows a blocked refund with its last error and tells staff to add the permission before the next hourly attempt', () => {
    renderWithProviders(<OrderRefundJob job={{ ...job, nextAttemptAt: '2026-11-15T11:42:00.000Z' }} />);
    const section = screen.getByTestId('order-refund-job');
    expect(within(section).getByText('Blocked: Stripe key lacks the refund permission')).toBeVisible();
    expect(within(section).getByText('The provided key does not have the required permissions')).toBeVisible();
    expect(within(section).getByRole('alert')).toHaveTextContent('Add the permission to the key in the Stripe Dashboard; the refund is then paid by the next hourly attempt.');
  });

  it('shows the Stripe refund of a refunded order without a warning', () => {
    renderWithProviders(<OrderRefundJob job={{ ...job, status: 'succeeded', lastError: null, providerRefundId: 're_123', providerRefundStatus: 'succeeded', submittedAt: '2026-11-15T10:43:00.000Z' }} />);
    const section = screen.getByTestId('order-refund-job');
    expect(within(section).getByText('Refunded')).toBeVisible();
    expect(within(section).getByText('re_123 (succeeded)')).toBeVisible();
    expect(within(section).queryByRole('alert')).toBeNull();
  });
});
