import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '#core/client/index.js';
import { SHIPX_STATUS_CANCELED, type OrderShipping, type ShipxOrderView } from '#core/domain/index.js';
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
  it('saves, closes, refreshes order queries and does not discard shipment attempts', async () => {
    const order = { ...sampleBundleOrder, shipping, fulfilmentStatus: 'to_pack' as const };
    const save = vi.spyOn(actions.correctOrderDelivery, 'mutationFn').mockResolvedValue({ order, recreateShipment: false });
    const discard = vi.spyOn(actions.shipxDiscard, 'mutationFn');
    const view = { ...ready, shipment: { shipxShipmentId: null, status: 'creating', trackingNumber: null, environment: 'production' as const, createAttemptedAt: null, boughtAt: null, labelFetchedAt: null, createdAt: '2026-11-25T09:00:00.000Z', updatedAt: '2026-11-25T09:00:00.000Z' } };
    const { queryClient } = renderWithProviders(<OrderDeliveryCorrection order={order} view={view} canCorrect>{() => null}</OrderDeliveryCorrection>);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await userEvent.click(screen.getByTestId('order-delivery-correct'));
    fireEvent.change(screen.getByLabelText('Recipient name'), { target: { value: 'Corrected Buyer' } });
    await userEvent.click(screen.getByTestId('delivery-correction-save'));
    expect(await screen.findByText('Delivery details updated.')).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId('delivery-correction-dialog')).toBeNull());
    expect(save.mock.calls[0]?.[0]).toEqual({ orderId: order.id, expected: { recipientName: 'Example Buyer' }, recipientName: 'Corrected Buyer' });
    expect(invalidate).toHaveBeenCalledWith(actions.ordersInvalidates());
    expect(discard).not.toHaveBeenCalled();
  });
  it('offers delivery correction after a canceled InPost label', async () => {
    const order = { ...sampleBundleOrder, shipping, fulfilmentStatus: 'to_pack' as const };
    const canceled = { shipxShipmentId: 'shipment', status: SHIPX_STATUS_CANCELED, trackingNumber: 'TRACK001', environment: 'production' as const, createAttemptedAt: '2026-11-25T09:00:00.000Z', boughtAt: '2026-11-25T09:01:00.000Z', labelFetchedAt: null, createdAt: '2026-11-25T09:00:00.000Z', updatedAt: '2026-11-25T09:02:00.000Z' };
    renderWithProviders(<OrderDeliveryCorrection order={order} view={{ ...ready, shipment: canceled }} canCorrect>{() => null}</OrderDeliveryCorrection>);
    await userEvent.click(screen.getByTestId('order-delivery-correct'));
    expect(screen.getByRole('dialog', { name: 'Correct delivery details' })).toBeVisible();
  });
  it('keeps the country read-only and refuses a foreign locker phone inline', async () => {
    const h = dialog();
    expect(screen.getByLabelText('Country (read-only)')).toHaveAttribute('readonly');
    expect(screen.getByTestId('delivery-correction-save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Delivery phone'), { target: { value: '+44 7700 900000' } });
    expect(screen.getByTestId('delivery-correction-save')).toBeDisabled();
    expect(screen.getByText(/This is not a Polish mobile number/)).toBeVisible();
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
    expect(h.onSave).toHaveBeenCalledExactlyOnceWith({ orderId: 'order', expected: { recipientName: 'Example Buyer', pickupPoint: 'ABC01M', address: { line1: 'Street 1' } }, recipientName: 'Corrected Buyer', pickupPoint: { code: 'ABC02M' }, address: { line1: 'Street 2' } });
  });
  it('validates Polish postal codes and allows a foreign courier phone', async () => {
    const h = dialog({ shipping: { ...shipping, carrier: 'other', pickupPoint: null } });
    expect(screen.queryByLabelText('Parcel locker code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Delivery phone'), { target: { value: '+44 7700 900000' } });
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: '00001' } });
    expect(screen.getByText('Use the postal code format 00-000.')).toBeVisible();
    expect(screen.getByTestId('delivery-correction-save')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: '00-001' } });
    await userEvent.click(screen.getByTestId('delivery-correction-save'));
    expect(h.onSave).toHaveBeenCalledExactlyOnceWith({ orderId: 'order', expected: { phone: '+48500000000' }, phone: '+44 7700 900000' });
  });
  it('rejects a foreign InPost courier phone without advising courier delivery', () => {
    dialog({ shipping: { ...shipping, pickupPoint: null } });
    fireEvent.change(screen.getByLabelText('Delivery phone'), { target: { value: '+44 7700 900000' } });
    expect(screen.getByTestId('delivery-correction-save')).toBeDisabled();
    expect(screen.getByText(/This is not a Polish mobile number/)).not.toHaveTextContent('choose courier');
  });
  it('does not submit untouched legacy whitespace when another field changes', async () => {
    const h = dialog({ shipping: { ...shipping, address: { ...shipping.address, name: ' Example Buyer ', line1: ' Street 1 ' } } });
    fireEvent.change(screen.getByLabelText('Delivery phone'), { target: { value: '600000000' } });
    await userEvent.click(screen.getByTestId('delivery-correction-save'));
    expect(h.onSave).toHaveBeenCalledExactlyOnceWith({ orderId: 'order', phone: '600000000', expected: { phone: '+48500000000' } });
  });
  it('keeps the opening values when the order refreshes during editing', async () => {
    const onSave = vi.fn();
    const props = { orderId: 'order', pending: false, error: null, onSave, onClose: vi.fn() };
    const { rerender } = render(<OrderDeliveryCorrectionDialog {...props} shipping={shipping} />);
    fireEvent.change(screen.getByLabelText('Street and building number'), { target: { value: 'Street 2' } });
    rerender(<OrderDeliveryCorrectionDialog {...props} shipping={{ ...shipping, address: { ...shipping.address, city: 'Concurrent City' } }} />);
    await userEvent.click(screen.getByTestId('delivery-correction-save'));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ orderId: 'order', address: { line1: 'Street 2' }, expected: { address: { line1: 'Street 1' } } });
  });
  it('does not suggest courier delivery after a server phone refusal', () => {
    dialog({ error: new ApiError({ code: 'locker_phone_invalid', message: 'Invalid phone' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('This is not a Polish mobile number. Enter 9 digits.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('courier');
  });
  it('localizes a concurrent edit refusal', () => {
    dialog({ error: new ApiError({ code: 'delivery_correction_conflict', message: 'Conflict' }) });
    expect(screen.getByText('Someone just changed these details. Refresh and try again.')).toBeVisible();
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
