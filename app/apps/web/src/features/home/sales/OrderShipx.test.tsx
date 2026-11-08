import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '#core/client/index.js';
import type { OrderListItem, ShipxOrderView, ShipxShipment } from '#core/domain/index.js';
import { renderWithProviders } from '../../../test/render.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { OrderShipx } from './OrderShipx.js';

const shipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23 as const, carrier: 'inpost' as const,
  pickupPoint: { provider: 'inpost' as const, code: 'WAW01M', name: null, address: null },
  address: { name: 'Alex Smith', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: '+48500000000',
};

const toPack: OrderListItem = { ...sampleBundleOrder, mode: 'live', shipping, fulfilmentStatus: 'to_pack' };

const ready: ShipxOrderView = { available: true, reason: null, service: 'inpost_locker_standard', parcelTemplate: 'large', shipment: null };

const shipment = (change: Partial<ShipxShipment> = {}): ShipxShipment => ({
  shipxShipmentId: '1001', status: 'confirmed', trackingNumber: '520000011395200025754311', environment: 'production', createAttemptedAt: null,
  boughtAt: '2026-11-08T10:00:00.000Z', labelFetchedAt: null, createdAt: '2026-11-08T10:00:00.000Z', updatedAt: '2026-11-08T10:00:00.000Z',
  ...change,
});

const props = {
  order: toPack, view: ready, canCreate: true, pending: false, discarding: false, downloading: false, error: null,
  onCreate: () => undefined, onDiscard: () => undefined, onDownloadLabel: () => undefined,
};

describe('OrderShipx', () => {
  it('creates the shipment after a confirmation that names the service, size and buyer', async () => {
    const onCreate = vi.fn();
    renderWithProviders(<OrderShipx {...props} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create InPost shipment' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Parcel locker shipment, size Large/)).toBeVisible();
    expect(within(dialog).getByText(/buyer@example\.org/)).toBeVisible();
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create shipment' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('says that a test order is answered by the simulated InPost', async () => {
    renderWithProviders(<OrderShipx {...props} order={{ ...toPack, mode: 'test' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create InPost shipment' }));
    expect(within(await screen.findByRole('dialog')).getByText(/simulated InPost/)).toBeVisible();
  });

  it('downloads the label of a bought shipment through the API client', async () => {
    const onDownloadLabel = vi.fn();
    renderWithProviders(<OrderShipx {...props} onDownloadLabel={onDownloadLabel} view={{ ...ready, available: false, reason: 'not_to_pack', shipment: shipment() }} />);
    expect(screen.queryByRole('link', { name: 'Print label' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Print label' }));
    expect(onDownloadLabel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Create InPost shipment' })).toBeNull();
    expect(screen.getByText('InPost shipment status: confirmed')).toBeVisible();
  });

  it('warns about an unconfirmed attempt and discards it only after a confirmation', async () => {
    const onDiscard = vi.fn();
    renderWithProviders(<OrderShipx
      {...props}
      onDiscard={onDiscard}
      view={{ ...ready, shipment: shipment({ shipxShipmentId: null, status: 'unknown', trackingNumber: null, boughtAt: null, createAttemptedAt: '2026-11-08T09:55:00.000Z' }) }}
    />);
    expect(screen.getByTestId('order-shipx-unconfirmed')).toHaveTextContent(/check Manager Paczek/);
    expect(screen.queryByTestId('order-shipx-status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print label' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Discard the attempt and create again' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/second paid shipment/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard and create again' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('tells staff to refresh while InPost has not confirmed the payment', () => {
    renderWithProviders(<OrderShipx {...props} view={{ ...ready, shipment: shipment({ status: 'offer_selected', trackingNumber: null, boughtAt: null }) }} />);
    expect(screen.getByTestId('order-shipx-pending')).toHaveTextContent(/Refresh the order/);
    expect(screen.getByRole('button', { name: 'Create InPost shipment' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Discard the attempt and create again' })).toBeNull();
  });

  it('shows the ShipX reason of a failure and how to finish the setup', () => {
    const error = new ApiError({
      code: 'shipx_rejected',
      message: 'InPost rejected the shipment data',
      details: { status: 400, error: 'validation_failed', description: 'Some data are invalid.', fields: { 'receiver.phone': ['invalid'] } },
    });
    const { unmount } = renderWithProviders(<OrderShipx {...props} error={error} />);
    expect(screen.getByText('InPost rejected the request.')).toBeVisible();
    expect(screen.getByText('InPost: Some data are invalid.; receiver.phone: invalid')).toBeVisible();
    unmount();
    const { unmount: unmountMissing } = renderWithProviders(<OrderShipx {...props} view={{ ...ready, available: false, reason: 'credentials_missing' }} />);
    expect(screen.getByText(/Save the InPost ShipX credentials/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create InPost shipment' })).toBeNull();
    unmountMissing();
    renderWithProviders(<OrderShipx {...props} view={{ ...ready, available: false, reason: 'sandbox_environment' }} />);
    expect(screen.getByText(/serves test orders only/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create InPost shipment' })).toBeNull();
  });

  it('renders nothing for other carriers or staff who cannot write orders', () => {
    const { container, unmount } = renderWithProviders(<OrderShipx {...props} view={{ ...ready, service: null, reason: 'not_inpost', available: false }} />);
    expect(container.querySelector('[data-testid="order-shipx"]')).toBeNull();
    unmount();
    renderWithProviders(<OrderShipx {...props} canCreate={false} />);
    expect(screen.queryByTestId('order-shipx')).toBeNull();
  });
});
