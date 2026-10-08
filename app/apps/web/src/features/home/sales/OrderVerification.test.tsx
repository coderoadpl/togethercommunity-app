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
    expect(screen.getByText('Alex Smith')).toBeVisible();
    expect(screen.getByText('buyer@example.org')).toBeVisible();
    expect(screen.getByText('Digital reference')).toBeVisible();
    expect(screen.getByText('Issued 0 of 1')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Mark as issued' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Mark as issued' }));
    expect(onIssue).toHaveBeenCalledWith('product-1');
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

  it('does not expose a staff identifier when the display name is unavailable', () => {
    const order = { ...sampleBundleOrder, lines: sampleBundleOrder.lines?.map((line) => line.productType === 'physical' ? { ...line, issuedCount: 1, issuedAt: '2026-10-08T12:00:00.000Z', issuedBy: 'staff-1' } : line) };
    renderWithProviders(<OrderVerification order={order} canIssue onIssue={() => undefined} />);
    expect(screen.getByText('Issued 1 of 1')).toBeVisible();
    expect(screen.queryByText(/Issued by:/)).toBeNull();
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
