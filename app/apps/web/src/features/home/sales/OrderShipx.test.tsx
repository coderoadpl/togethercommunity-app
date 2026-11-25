import { render, screen, waitFor, within } from '@testing-library/react';
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

const ready: ShipxOrderView = { available: true, reason: null, environment: 'production', service: 'inpost_locker_standard', parcelTemplate: 'large', shipment: null };

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
  it.each([
    [{ 'receiver.phone': ['invalid'] }, true],
    [{ 'receiver.address.city': ['required'] }, true],
    [{ 'sender.phone': ['invalid'] }, false],
    [{ organization_id: ['invalid'] }, false],
  ])('shows correction only for carrier receiver fields %o', (fields, visible) => {
    const onCorrectDelivery = vi.fn();
    renderWithProviders(<OrderShipx {...props} onCorrectDelivery={onCorrectDelivery} error={new ApiError({ code: 'shipx_rejected', message: 'InPost rejected the shipment data', details: { status: 400, error: 'validation_failed', fields } })} />);
    expect(screen.queryByRole('button', { name: 'Correct delivery details' }) !== null).toBe(visible);
  });
  it('opens the delivery correction from a receiver validation failure', async () => {
    const onCorrectDelivery = vi.fn();
    renderWithProviders(<OrderShipx {...props} onCorrectDelivery={onCorrectDelivery} error={new ApiError({ code: 'validation', message: 'Invalid receiver', details: { state: 'receiver_invalid', field: 'phone' } })} />);
    await userEvent.click(within(screen.getByTestId('order-shipx-error')).getByRole('button', { name: 'Correct delivery details' }));
    expect(onCorrectDelivery).toHaveBeenCalledOnce();
  });

  it('creates the shipment after a confirmation with the one-step checkbox off by default', async () => {
    const onCreate = vi.fn();
    renderWithProviders(<OrderShipx {...props} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create InPost shipment' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('InPost creates and charges a Parcel locker shipment, size Large (C, 41 × 38 × 64 cm). The label will be ready to print; the order stays to pack until you mark it as shipped.')).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: 'Mark as shipped right away and e-mail the buyer' })).not.toBeChecked();
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create shipment' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('offers the parcel size only when the click creates a shipment', async () => {
    const onCreate = vi.fn();
    renderWithProviders(<OrderShipx {...props} onCreate={onCreate} view={{ ...ready, shipment: shipment({ status: 'offer_selected', trackingNumber: null, boughtAt: null }) }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create InPost shipment' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('combobox', { name: 'Parcel size for this shipment' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create shipment' }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(undefined, false);
  });

  it('keeps the sandbox confirmation with or without the one-step opt-in', async () => {
    renderWithProviders(<OrderShipx {...props} order={{ ...toPack, mode: 'test' }} view={{ ...ready, environment: 'sandbox' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create InPost shipment' }));
    const dialog = within(await screen.findByRole('dialog'));
    const body = 'Test order: the InPost sandbox creates a Parcel locker shipment, size Large (C, 41 × 38 × 64 cm). Nothing is charged and no e-mail is sent.';
    expect(dialog.getByText(body)).toBeVisible();
    await userEvent.click(dialog.getByRole('checkbox', { name: 'Mark as shipped right away (no e-mail is sent)' }));
    expect(dialog.getByText(body)).toBeVisible();
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

  it.each([false, true])('warns about a canceled label without offering print or create (with conflict: %s)', (hasConflict) => {
    renderWithProviders(<OrderShipx
      {...props}
      order={{ ...toPack, label: { carrier: 'inpost', trackingNumber: '520000011395200025754311' } }}
      view={{ ...ready, shipment: shipment({ status: 'canceled' }) }}
      error={hasConflict ? new ApiError({ code: 'conflict', message: 'Label canceled', details: { state: 'label_canceled', trackingNumber: '520000011395200025754311', shipxShipmentId: '1001' } }) : null}
    />);
    expect(screen.getByRole('alert')).toHaveTextContent('This InPost label was canceled in Manager Paczek. Create a new label there and mark the order as shipped by hand.');
    expect(screen.queryByRole('button', { name: 'Print label' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create InPost shipment' })).toBeNull();
    expect(screen.queryByTestId('order-shipx-pending')).toBeNull();
  });

  it('only notes a canceled original label on an order that was shipped by hand', () => {
    renderWithProviders(<OrderShipx
      {...props}
      order={{ ...toPack, fulfilmentStatus: 'shipped', shipment: { carrier: 'other', trackingNumber: 'NEWLABEL1', shippedAt: '2026-11-08T10:00:00.000Z', shippedBy: 'staff' } }}
      view={{ ...ready, available: false, reason: 'not_to_pack', shipment: shipment({ status: 'canceled' }) }}
    />);
    expect(screen.getByTestId('order-shipx-label-canceled')).toHaveTextContent('The original InPost label for this order was canceled in Manager Paczek.');
    expect(screen.queryByRole('button', { name: 'Print label' })).toBeNull();
  });

  it('prints from the order label while the ShipX view has no shipment yet', () => {
    renderWithProviders(<OrderShipx
      {...props}
      order={{ ...toPack, fulfilmentStatus: 'shipped', label: { carrier: 'inpost', trackingNumber: '520000011395200025754311' }, shipment: { carrier: 'inpost', trackingNumber: '520000011395200025754311', shippedAt: '2026-11-08T10:00:00.000Z', shippedBy: 'staff' } }}
      view={{ ...ready, available: false, reason: 'not_to_pack', shipment: null }}
    />);
    expect(screen.getByRole('button', { name: 'Print label' })).toBeVisible();
  });

  it.each([
    ['matching InPost dispatch', { carrier: 'inpost', trackingNumber: ' 520000011395200025754311 ' }, true],
    ['different InPost tracking', { carrier: 'inpost', trackingNumber: 'LABEL1234' }, false],
    ['different carrier', { carrier: 'other', trackingNumber: '520000011395200025754311' }, false],
    ['missing dispatch', null, false],
  ] as const)('shows print only for the matching ShipX parcel: %s', (_name, dispatch, canPrint) => {
    renderWithProviders(<OrderShipx
      {...props}
      order={{ ...toPack, fulfilmentStatus: 'shipped', shipment: dispatch === null ? null : { ...dispatch, shippedAt: '2026-11-08T10:00:00.000Z', shippedBy: 'staff' } }}
      view={{ ...ready, available: false, reason: 'not_to_pack', shipment: shipment({ trackingNumber: '520000011395200025754311  ' }) }}
    />);
    const print = screen.queryByRole('button', { name: 'Print label' });
    if (canPrint) expect(print).toBeVisible();
    else expect(print).toBeNull();
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

  it('keeps an unpaid shipment that already carries a tracking number away from the label', () => {
    renderWithProviders(<OrderShipx {...props} view={{ ...ready, shipment: shipment({ status: 'offer_selected', boughtAt: null }) }} />);
    expect(screen.getByTestId('order-shipx-pending')).toHaveTextContent(/Refresh the order/);
    expect(screen.queryByRole('button', { name: 'Print label' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create InPost shipment' })).toBeVisible();
  });

  it('offers the label and no payment hint once the shipment is bought', () => {
    renderWithProviders(<OrderShipx {...props} view={{ ...ready, shipment: shipment() }} />);
    expect(screen.getByRole('button', { name: 'Print label' })).toBeVisible();
    expect(screen.queryByTestId('order-shipx-pending')).toBeNull();
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
    expect(screen.getByTestId('order-shipx-hint')).toHaveTextContent('Connect the InPost production account in Settings → Shipping');
    expect(screen.queryByRole('button', { name: 'Create InPost shipment' })).toBeNull();
    unmountMissing();
    renderWithProviders(<OrderShipx {...props} order={{ ...toPack, mode: 'test' }} view={{ ...ready, environment: 'sandbox', available: false, reason: 'credentials_missing' }} />);
    expect(screen.getByTestId('order-shipx-hint')).toHaveTextContent('This is a test-mode order: connect the InPost sandbox in Settings → Shipping');
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
      ['canceled label', failed('conflict', 'The InPost label LABEL1234 was canceled in Manager Paczek; create a new label there and mark the order as shipped by hand', { state: 'label_canceled', trackingNumber: 'LABEL1234', shipxShipmentId: '1001' }), pl.shipx.labelCanceled],
      ['off packing list', failed('conflict', 'The order left the packing list meanwhile; cancel the InPost label LABEL1234 in Manager Paczek', { trackingNumber: 'LABEL1234', shipxShipmentId: '1001' }), pl.shipx.failures.orderLeftPackingList({ trackingNumber: 'LABEL1234' })],
      ['environment mismatch', failed('conflict', 'The InPost shipment was created in the ShipX sandbox environment, but this order uses the production connection; finish the shipment in Manager Paczek', { state: 'environment_mismatch', environment: 'sandbox', settingsEnvironment: 'production' }), pl.shipx.failures.environmentMismatch({ environment: pl.shipx.environments.sandbox, settingsEnvironment: pl.shipx.environments.production })],
      ['organization mismatch', failed('conflict', 'The InPost shipment belongs to a different ShipX organization than the one in the settings; restore it or finish the shipment in Manager Paczek', { state: 'organization_mismatch' }), pl.shipx.failures.organizationMismatch],
      ['missing sandbox connection', failed('integration_not_configured', 'Save the InPost ShipX sandbox organization id and token in Settings → Shipping', { state: 'setup_missing', reason: 'credentials_missing', environment: 'sandbox' }), pl.shipx.unavailableReasons.credentials_missing.sandbox],
      ['missing production connection', failed('integration_not_configured', 'Save the InPost ShipX production organization id and token in Settings → Shipping', { state: 'setup_missing', reason: 'credentials_missing', environment: 'production' }), pl.shipx.unavailableReasons.credentials_missing.production],
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

it('passes the one-step opt-in only when checked', async () => {
  const onCreate = vi.fn();
  renderWithProviders(<OrderShipx {...props} onCreate={onCreate} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create InPost shipment' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('checkbox'));
  expect(within(dialog).getByText(`InPost creates and charges a Parcel locker shipment, size Large (C, 41 × 38 × 64 cm). The order is then marked as shipped and ${toPack.memberEmail} receives the tracking e-mail.`)).toBeVisible();
  expect(within(dialog).queryByText(/order stays to pack/)).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create shipment' }));
  expect(onCreate).toHaveBeenCalledExactlyOnceWith(undefined, true);
});

it('never offers another create for a bought label on an order still to pack', () => {
  renderWithProviders(<OrderShipx {...props} view={{ ...ready, shipment: shipment() }} />);
  expect(screen.queryByRole('button', { name: 'Create InPost shipment' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Print label' })).toBeVisible();
});

it('honours a bought label on the order even when the ShipX view offers create', () => {
  renderWithProviders(<OrderShipx {...props} order={{ ...toPack, label: { carrier: 'inpost', trackingNumber: 'LABEL1234' } }} />);
  expect(screen.queryByRole('button', { name: 'Create InPost shipment' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Print label' })).toBeVisible();
});

it.each(['Create InPost shipment', 'Discard the attempt and create again'])('does not reopen the confirmation for %s when create becomes available again', async (action) => {
  const view = { ...ready, shipment: shipment({ shipxShipmentId: null, status: 'creating', trackingNumber: null, boughtAt: null }) };
  const renderOrder = (availableView: ShipxOrderView | undefined) => <OrderShipx {...props} view={availableView} />;
  const { rerender } = render(renderOrder(view));
  await userEvent.click(screen.getByRole('button', { name: action }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  rerender(renderOrder(action === 'Create InPost shipment' ? { ...view, available: false } : undefined));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  rerender(renderOrder(view));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: action })).toBeVisible();
});
