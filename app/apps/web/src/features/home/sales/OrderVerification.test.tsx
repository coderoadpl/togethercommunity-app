import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/render.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { OrderVerification, OrderVerificationLookup } from './OrderVerification.js';

describe('OrderVerification', () => {
  it('shows the buyer, lines and one physical issue action', async () => {
    const onIssue = vi.fn();
    renderWithProviders(<OrderVerification order={sampleBundleOrder} canIssue onIssue={onIssue} />);
    expect(screen.getByText('Paid')).toBeVisible();
    expect(screen.getByText('Placed: 8 Oct 2026, 12:00')).toBeVisible();
    expect(screen.getByText('Paid: 8 Oct 2026, 12:03')).toBeVisible();
    expect(screen.getByText('Alex Smith')).toBeVisible();
    expect(screen.getByText('buyer@example.org')).toBeVisible();
    expect(screen.getByText('Digital reference')).toBeVisible();
    expect(screen.getByText('Issued 0 of 1')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Mark as issued' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Mark as issued' }));
    expect(onIssue).toHaveBeenCalledWith('product-1');
  });

  it('uses the placed date for a paid order without a payment timestamp', () => {
    renderWithProviders(<OrderVerification order={{ ...sampleBundleOrder, paidAt: null }} canIssue onIssue={() => undefined} />);
    expect(screen.getByText('Placed: 8 Oct 2026, 12:00')).toBeVisible();
    expect(screen.getByText('Paid: 8 Oct 2026, 12:00')).toBeVisible();
  });

  it('shows no payment date for an unpaid order', () => {
    renderWithProviders(<OrderVerification order={{ ...sampleBundleOrder, status: 'pending', paidAt: null }} canIssue onIssue={() => undefined} />);
    expect(screen.getByText('Placed: 8 Oct 2026, 12:00')).toBeVisible();
    expect(screen.getByText('Paid: —')).toBeVisible();
  });

  it('shows the first issue and staff name on a second scan without offering another issue', () => {
    const order = { ...sampleBundleOrder, lines: sampleBundleOrder.lines?.map((line) => line.productType === 'physical' ? { ...line, issuedCount: 1, issuedAt: '2026-10-08T12:00:00.000Z', issuedBy: 'staff-1', issuedByDisplayName: 'Jordan Smith' } : line) };
    renderWithProviders(<OrderVerification order={order} canIssue onIssue={() => undefined} />);
    expect(screen.getByText('Issued 1 of 1')).toBeVisible();
    expect(screen.getByText(/First issued:/)).toBeVisible();
    expect(screen.getByText('Issued by: Jordan Smith')).toBeVisible();
    expect(screen.queryByText(/staff-1/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
  });

  it('names the units of a line above one and offers issuance until every unit is issued', () => {
    const withUnits = (issuedCount: number) => ({ ...sampleBundleOrder, lines: sampleBundleOrder.lines?.map((line) => line.productType === 'physical' ? { ...line, quantity: 2, issuedCount } : line) });
    const { unmount } = renderWithProviders(<OrderVerification order={withUnits(1)} canIssue onIssue={() => undefined} />);
    expect(screen.getByText('2 × Printed workbook')).toBeVisible();
    expect(screen.getByText('Issued 1 of 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mark as issued' })).toBeVisible();
    unmount();
    renderWithProviders(<OrderVerification order={withUnits(2)} canIssue onIssue={() => undefined} />);
    expect(screen.getByText('Issued 2 of 2')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
  });

  it('does not expose a staff identifier when the display name is unavailable', () => {
    const order = { ...sampleBundleOrder, lines: sampleBundleOrder.lines?.map((line) => line.productType === 'physical' ? { ...line, issuedCount: 1, issuedAt: '2026-10-08T12:00:00.000Z', issuedBy: 'staff-1' } : line) };
    renderWithProviders(<OrderVerification order={order} canIssue onIssue={() => undefined} />);
    expect(screen.getByText('Issued 1 of 1')).toBeVisible();
    expect(screen.queryByText(/Issued by:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
  });

  it('shows the sold-out cancellation and offers no issue action for a cancelled paid order', () => {
    renderWithProviders(<OrderVerification order={{ ...sampleBundleOrder, cancelReason: 'out_of_stock', refundJobStatus: 'blocked_permission' }} canIssue onIssue={() => undefined} />);
    expect(screen.getByTestId('order-cancelled-out-of-stock')).toBeVisible();
    expect(screen.getByText('This order was cancelled because it sold out and is being refunded. Do not hand over the goods.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
  });

  it.each(['pending', 'failed', 'refunded', 'partially_refunded'] as const)('prevents issuing a %s order', (status) => {
    renderWithProviders(<OrderVerification order={{ ...sampleBundleOrder, status }} canIssue onIssue={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
    expect(screen.getByText('Only paid orders can be issued.')).toBeVisible();
  });

  it('does not offer issuance without write capability', () => {
    renderWithProviders(<OrderVerification order={sampleBundleOrder} canIssue={false} onIssue={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Mark as issued' })).toBeNull();
  });

  it.each(['order-2026-001', 'a'.repeat(64)])('accepts manual reference %s', async (reference) => {
    const onFind = vi.fn();
    renderWithProviders(<OrderVerificationLookup onFind={onFind} />);
    expect(screen.getByRole('button', { name: 'Find order' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Token or order number'), ` ${reference} `);
    await userEvent.click(screen.getByRole('button', { name: 'Find order' }));
    expect(onFind).toHaveBeenCalledWith(reference);
  });
});
