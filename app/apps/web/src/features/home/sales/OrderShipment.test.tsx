import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OrderListItem } from '#core/domain/index.js';
import { renderWithProviders } from '../../../test/render.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { OrderShipment } from './OrderShipment.js';

const shipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23 as const, carrier: 'inpost' as const,
  pickupPoint: { provider: 'inpost' as const, code: 'WAW01M', name: null, address: null },
  address: { name: 'Alex Smith', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: null,
};

const toPack: OrderListItem = { ...sampleBundleOrder, mode: 'live', shipping, fulfilmentStatus: 'to_pack' };

describe('OrderShipment', () => {
  it('marks an order as shipped after the confirmation with the trimmed tracking number', async () => {
    const onShip = vi.fn();
    renderWithProviders(<OrderShipment order={toPack} canShip pending={false} error={null} onShip={onShip} />);
    const markShipped = screen.getByRole('button', { name: 'Mark as shipped' });
    expect(markShipped).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Tracking number'), '  ABC');
    expect(markShipped).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Tracking number'), 'D1234  ');
    await userEvent.click(markShipped);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/buyer@example\.org/)).toBeVisible();
    expect(within(dialog).getByText(/ABCD1234/)).toBeVisible();
    expect(onShip).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as shipped' }));
    expect(onShip).toHaveBeenCalledWith({ carrier: 'inpost', trackingNumber: 'ABCD1234' });
  });

  it('lets staff pick another carrier', async () => {
    const onShip = vi.fn();
    renderWithProviders(<OrderShipment order={toPack} canShip pending={false} error={null} onShip={onShip} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Carrier' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Other carrier' }));
    await userEvent.type(screen.getByLabelText('Tracking number'), 'RR123456789PL');
    await userEvent.click(screen.getByRole('button', { name: 'Mark as shipped' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark as shipped' }));
    expect(onShip).toHaveBeenCalledWith({ carrier: 'other', trackingNumber: 'RR123456789PL' });
  });

  it('shows the error of a failed shipment', () => {
    renderWithProviders(<OrderShipment order={toPack} canShip pending={false} error="This order has already been marked as shipped." onShip={() => undefined} />);
    expect(screen.getByText('This order has already been marked as shipped.')).toBeVisible();
  });

  it('offers no form without the write capability or for orders with nothing to ship', () => {
    const { unmount } = renderWithProviders(<OrderShipment order={toPack} canShip={false} pending={false} error={null} onShip={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Mark as shipped' })).toBeNull();
    unmount();
    renderWithProviders(<OrderShipment order={{ ...toPack, fulfilmentStatus: null }} canShip pending={false} error={null} onShip={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Mark as shipped' })).toBeNull();
  });

  it('summarises a shipped order with the tracking link, staff name and Warsaw time', () => {
    const shipped: OrderListItem = {
      ...toPack,
      fulfilmentStatus: 'shipped',
      shipment: { carrier: 'inpost', trackingNumber: 'ABCD1234', shippedAt: '2026-11-05T09:30:00.000Z', shippedBy: 'staff-1', shippedByDisplayName: 'Jordan Smith' },
    };
    renderWithProviders(<OrderShipment order={shipped} canShip pending={false} error={null} onShip={() => undefined} />);
    expect(screen.getByText('5 Nov 2026, 10:30')).toBeVisible();
    expect(screen.getByText('Jordan Smith')).toBeVisible();
    expect(screen.getByText('InPost')).toBeVisible();
    expect(screen.getByRole('link', { name: 'ABCD1234' })).toHaveAttribute('href', 'https://inpost.pl/sledzenie-przesylek?number=ABCD1234');
    expect(screen.queryByRole('button', { name: 'Mark as shipped' })).toBeNull();
  });

  it('shows the tracking number without a link for other carriers and hides staff identifiers', () => {
    const shipped: OrderListItem = {
      ...toPack,
      fulfilmentStatus: 'shipped',
      shipment: { carrier: 'other', trackingNumber: 'RR123456789PL', shippedAt: '2026-11-05T09:30:00.000Z', shippedBy: 'staff-1' },
    };
    renderWithProviders(<OrderShipment order={shipped} canShip pending={false} error={null} onShip={() => undefined} />);
    expect(screen.getByText('RR123456789PL')).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('staff-1')).toBeNull();
  });
});
