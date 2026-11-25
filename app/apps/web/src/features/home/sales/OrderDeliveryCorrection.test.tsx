import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '#core/client/index.js';
import type { OrderShipping, ShipxOrderView } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { renderWithProviders } from '../../../test/render.js';
import { sampleBundleOrder } from '../../../test/sales-link-fixtures.js';
import { OrderDeliveryCorrection, OrderDeliveryCorrectionDialog } from './OrderDeliveryCorrection.js';
import { OrderDeliveryCorrectionHistory } from './OrderDeliveryCorrectionHistory.js';

const shipping: OrderShipping = {
  rateId: 'locker', label: 'Locker', amountCents: 1200, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'ABC01M', name: null, address: null }, phone: '+48500000000',
  address: { name: 'Example Buyer', line1: 'Street 1', line2: null, postalCode: '00-001', city: 'Example City', country: 'PL' },
};
const ready: ShipxOrderView = { available: true, reason: null, environment: 'production', service: 'inpost_locker_standard', parcelTemplate: 'small', shipment: null };
const dialog = (change: Partial<Parameters<typeof OrderDeliveryCorrectionDialog>[0]> = {}) => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<OrderDeliveryCorrectionDialog orderId="order" shipping={shipping} pending={false} error={null} onSave={onSave} onClose={onClose} {...change} />);
  return { onSave, onClose };
};

afterEach(() => { vi.restoreAllMocks(); });

describe('delivery correction UI', () => {
  it('saves, closes, refreshes order queries and shows the draft reminder without discarding', async () => {
    const order = { ...sampleBundleOrder, shipping, fulfilmentStatus: 'to_pack' as const };
    const save = vi.spyOn(actions.correctOrderDelivery, 'mutationFn').mockResolvedValue({ order, recreateShipment: true });
    const discard = vi.spyOn(actions.shipxDiscard, 'mutationFn');
    const view = { ...ready, shipment: { shipxShipmentId: null, status: 'creating', trackingNumber: null, environment: 'production' as const, createAttemptedAt: null, boughtAt: null, labelFetchedAt: null, createdAt: '2026-11-25T09:00:00.000Z', updatedAt: '2026-11-25T09:00:00.000Z' } };
    const { queryClient } = renderWithProviders(<OrderDeliveryCorrection order={order} view={view} canCorrect>{() => null}</OrderDeliveryCorrection>);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await userEvent.click(screen.getByTestId('order-delivery-correct'));
    fireEvent.change(screen.getByLabelText('Recipient name'), { target: { value: 'Corrected Buyer' } });
    await userEvent.click(screen.getByTestId('delivery-correction-save'));
    expect(await screen.findByText('Delivery details updated.')).toBeVisible();
    expect(screen.getByText('Discard the draft shipment and create it again so InPost gets the new details.')).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId('delivery-correction-dialog')).toBeNull());
    expect(save.mock.calls[0]?.[0]).toEqual({ orderId: order.id, recipientName: 'Corrected Buyer' });
    expect(invalidate).toHaveBeenCalledWith(actions.ordersInvalidates());
    expect(discard).not.toHaveBeenCalled();
  });
  it('keeps the country read-only and refuses a foreign locker phone inline', async () => {
    const h = dialog();
    expect(screen.getByLabelText('Country (read-only)')).toHaveAttribute('readonly');
    expect(screen.getByTestId('delivery-correction-save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Delivery phone'), { target: { value: '+44 7700 900000' } });
    expect(screen.getByTestId('delivery-correction-save')).toBeDisabled();
    expect(screen.getByText(/InPost sends the pick-up code by SMS only to a Polish mobile number/)).toBeVisible();
    expect(h.onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onClose).toHaveBeenCalledOnce();
  });
  it('submits only changed fields with an editable address for locker orders', async () => {
    const h = dialog();
    fireEvent.change(screen.getByLabelText('Recipient name'), { target: { value: ' Corrected Buyer ' } });
    fireEvent.change(screen.getByLabelText('Street and building number'), { target: { value: 'Street 2' } });
    fireEvent.change(screen.getByLabelText('Parcel locker code'), { target: { value: 'abc02m' } });
    await userEvent.click(screen.getByTestId('delivery-correction-save'));
    expect(h.onSave).toHaveBeenCalledExactlyOnceWith({ orderId: 'order', recipientName: 'Corrected Buyer', pickupPoint: { code: 'ABC02M' }, address: { line1: 'Street 2', line2: null, postalCode: '00-001', city: 'Example City' } });
  });
  it('validates Polish postal codes and allows a foreign courier phone', async () => {
    const h = dialog({ shipping: { ...shipping, pickupPoint: null } });
    expect(screen.queryByLabelText('Parcel locker code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Delivery phone'), { target: { value: '+44 7700 900000' } });
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: '00001' } });
    expect(screen.getByText('Use the postal code format 00-000.')).toBeVisible();
    expect(screen.getByTestId('delivery-correction-save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: '00-001' } });
    await userEvent.click(screen.getByTestId('delivery-correction-save'));
    expect(h.onSave).toHaveBeenCalledExactlyOnceWith({ orderId: 'order', phone: '+44 7700 900000' });
  });
  it('localizes server validation failures and prevents closing while pending', () => {
    const h = dialog({ pending: true, error: new ApiError({ code: 'validation', message: 'Unavailable', details: { deliveryCorrection: 'locker_unavailable' } }) });
    expect(screen.getByText('The parcel locker directory is unavailable. Try again later.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(h.onClose).not.toHaveBeenCalled();
  });
  it.each(['bought', 'shipped', 'read-only', 'unknown-shipment'] as const)('hides the correction action for %s', (state) => {
    const view = state === 'unknown-shipment' ? undefined : state === 'bought' ? { ...ready, shipment: { shipxShipmentId: 'shipment', status: 'confirmed', trackingNumber: 'TRACK001', environment: 'production' as const, createAttemptedAt: null, boughtAt: null, labelFetchedAt: null, createdAt: '2026-11-25T09:00:00.000Z', updatedAt: '2026-11-25T09:00:00.000Z' } } : ready;
    renderWithProviders(<OrderDeliveryCorrection order={{ ...sampleBundleOrder, shipping, fulfilmentStatus: state === 'shipped' ? 'shipped' : 'to_pack' }} view={view} canCorrect={state !== 'read-only'}>{() => null}</OrderDeliveryCorrection>);
    expect(screen.queryByTestId('order-delivery-correct')).toBeNull();
    if (state === 'bought') expect(screen.getByText(/The shipment is already bought/)).toBeVisible();
    if (state === 'shipped') expect(screen.getByText(/This order has already been shipped/)).toBeVisible();
  });
  it('renders the audit only when present', () => {
    const { rerender } = renderWithProviders(<OrderDeliveryCorrectionHistory shipping={shipping} />);
    expect(screen.queryByTestId('order-delivery-history')).toBeNull();
    rerender(<OrderDeliveryCorrectionHistory shipping={{ ...shipping, corrections: [{ field: 'phone', from: null, to: '+48500000000', at: '2026-11-25T10:00:00.000Z', byUserId: 'staff', byEmail: 'staff@example.org' }] }} />);
    const history = within(screen.getByTestId('order-delivery-history'));
    expect(history.getByText(/staff@example.org/)).toBeVisible();
    expect(history.getByText(/Phone: — → \+48500000000/)).toBeVisible();
  });
});
