import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '#core/client/index.js';
import type { ErrorCode, OrderListItem, ShipxOrderView, ShipxShipment } from '#core/domain/index.js';
import { LanguageProvider } from '../../../i18n/index.js';
import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { languagePreference } from '../../../theme-mode.js';
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
    expect(within(dialog).getByText('Discard the unconfirmed attempt?')).toBeVisible();
    expect(within(dialog).getByText(/second paid shipment/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard and create again' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('discards a claim left before any create attempt without sending staff to Manager Paczek', async () => {
    const onDiscard = vi.fn();
    renderWithProviders(<OrderShipx
      {...props}
      onDiscard={onDiscard}
      view={{ ...ready, shipment: shipment({ shipxShipmentId: null, status: 'creating', trackingNumber: null, boughtAt: null, createAttemptedAt: null }) }}
    />);
    expect(screen.queryByTestId('order-shipx-unconfirmed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print label' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Discard the attempt and create again' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Discard the interrupted attempt?')).toBeVisible();
    expect(within(dialog).getByText(/stopped before it was sent to InPost/)).toBeVisible();
    expect(dialog).not.toHaveTextContent(/Manager Paczek/);
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
    expect(screen.getByText('InPost rejected the shipment data.')).toBeVisible();
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

  describe('in Polish', () => {
    const failed = (code: ErrorCode, message: string, details?: unknown) => new ApiError({ code, message, ...(details === undefined ? {} : { details }) });

    const renderPolish = (error: ApiError) => {
      languagePreference.save('pl');
      renderWithProviders(<LanguageProvider><OrderShipx {...props} error={error} /></LanguageProvider>);
      return screen.getByTestId('order-shipx-error');
    };

    it.each([
      ['pending payment', failed('shipx_unavailable', 'InPost has not confirmed the payment yet; refresh the order in a moment', { state: 'pending', shipmentId: '1001', status: 'offers_prepared' }), pl.shipx.paymentPending],
      ['slow ShipX', failed('shipx_unavailable', 'InPost ShipX is answering slowly; refresh the order in a moment', { state: 'pending', shipmentId: null, status: 'unknown' }), pl.shipx.failures.slow],
      ['unconfirmed attempt', failed('shipx_unavailable', 'InPost ShipX did not confirm the shipment; the next attempt looks it up in ShipX before creating anything', { state: 'unconfirmed', cause: 'ShipX timed out' }), pl.shipx.failures.unconfirmed],
      ['unconfirmed attempt missing in ShipX', failed('conflict', 'ShipX did not confirm the previous attempt; check Manager Paczek', { state: 'unconfirmed', attemptedAt: '2026-11-08T09:55:00.000Z' }), pl.shipx.failures.unconfirmedNotFound],
      ['lost lock', failed('fulfilment_conflict', 'Another request took over the InPost shipment for this order; refresh the order in a moment', { state: 'lost_lock' }), pl.shipx.failures.lostLock],
      ['lease held', failed('fulfilment_conflict', 'Another request is creating the InPost shipment for this order; refresh the order in a moment', { state: 'lease_held' }), pl.shipx.failures.leaseHeld],
      ['manual ship', failed('fulfilment_conflict', 'The order was marked as shipped meanwhile; the InPost shipment 520000011395200025754311 exists as well, reconcile it in Manager Paczek', { state: 'manual_shipped', trackingNumber: '520000011395200025754311', shipxShipmentId: '1001' }), pl.shipx.failures.manualShipped({ trackingNumber: '520000011395200025754311' })],
      ['environment mismatch', failed('conflict', 'The InPost shipment was created in the ShipX sandbox environment, but the settings now use production; switch back or finish the shipment in Manager Paczek', { state: 'environment_mismatch', environment: 'sandbox', settingsEnvironment: 'production' }), pl.shipx.failures.environmentMismatch({ environment: pl.shipx.environments.sandbox, settingsEnvironment: pl.shipx.environments.production })],
      ['organization mismatch', failed('conflict', 'The InPost shipment belongs to a different ShipX organization than the one in the settings; restore it or finish the shipment in Manager Paczek', { state: 'organization_mismatch' }), pl.shipx.failures.organizationMismatch],
      ['missing sender', failed('integration_not_configured', 'Save the InPost sender details in Settings → Shipping', { state: 'setup_missing', reason: 'sender_missing' }), pl.shipx.unavailableReasons.sender_missing],
      ['unreadable building number', failed('validation', 'The building number cannot be read from the delivery address', { state: 'receiver_invalid', field: 'building_number' }), pl.shipx.failures.receiverInvalid.building_number],
      ['failed payment', failed('shipx_rejected', 'InPost could not charge the shipment; check the funds or the payment method in Manager Paczek', { status: 200, error: 'transaction_failed', description: null, fields: {}, state: 'failed' }), pl.shipx.failures.rejected.transaction_failed],
      ['rejected token', failed('shipx_rejected', 'InPost rejected the stored ShipX token', { status: 401, error: null, description: null, fields: {} }), pl.shipx.failures.tokenRejected],
      ['request without a structured state', failed('validation', 'The order has no unconfirmed InPost attempt to discard'), pl.errors.messageValidation],
    ])('localizes the %s without the English server text', (_name, error, expected) => {
      const alert = renderPolish(error);
      expect(alert).toHaveTextContent(expected);
      expect(alert).not.toHaveTextContent(error.message);
    });

    it('shows the vendor description and fields of a rejected shipment verbatim after the Polish sentence', () => {
      const alert = renderPolish(failed('shipx_rejected', 'InPost rejected the shipment data', {
        status: 400, error: 'validation_failed', description: 'Some data are invalid.', fields: { 'receiver.phone': ['invalid'] },
      }));
      expect(within(alert).getByText(pl.shipx.failures.rejected.validation_failed)).toBeVisible();
      expect(within(alert).getByText('InPost: Some data are invalid.; receiver.phone: invalid')).toBeVisible();
      expect(alert).not.toHaveTextContent('InPost rejected the shipment data');
    });
  });

  it('renders nothing for other carriers or staff who cannot write orders', () => {
    const { container, unmount } = renderWithProviders(<OrderShipx {...props} view={{ ...ready, service: null, reason: 'not_inpost', available: false }} />);
    expect(container.querySelector('[data-testid="order-shipx"]')).toBeNull();
    unmount();
    renderWithProviders(<OrderShipx {...props} canCreate={false} />);
    expect(screen.queryByTestId('order-shipx')).toBeNull();
  });
});
