import { describe, expect, it } from 'vitest';

import { shipxSenderSchema, shipxShipmentBought, type ShipxShipmentRequest } from '#core/domain/index.js';
import type { ShipxCredentials } from '#core/server/index.js';

import { createFakeShipxClient, fakeShipxShipmentId, fakeShipxTrackingNumber } from './fake.js';

const credentials: ShipxCredentials = { organizationId: '1', token: 'unused', environment: 'sandbox' };

const request: ShipxShipmentRequest = {
  reference: 'order-1',
  service: 'inpost_locker_standard',
  parcelTemplate: 'small',
  targetPoint: 'WAW01M',
  receiver: { firstName: 'Jane', lastName: 'Buyer', email: 'buyer@example.org', phone: '500000000', address: null },
  sender: shipxSenderSchema.parse({
    name: 'Anna Sender', email: 'shop@example.org', phone: '500600700', street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001',
  }),
};

describe('fake ShipX client', () => {
  it('answers deterministically from the order reference', async () => {
    const client = createFakeShipxClient();
    const first = await client.createShipment(credentials, request);
    const second = await client.createShipment(credentials, request);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, value: { id: fakeShipxShipmentId('order-1'), status: 'created' } });
    expect(fakeShipxShipmentId('order-2')).not.toBe(fakeShipxShipmentId('order-1'));
  });

  it('confirms on the first read with a 24-digit tracking number and returns a PDF label', async () => {
    const client = createFakeShipxClient();
    const id = fakeShipxShipmentId('order-1');
    const shipment = await client.getShipment(credentials, id);
    expect(shipment.ok && shipxShipmentBought(shipment.value)).toBe(true);
    expect(fakeShipxTrackingNumber(id)).toMatch(/^\d{24}$/);
    const label = await client.fetchLabel(credentials, id);
    expect(label.ok && new TextDecoder().decode(label.value.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('finds the shipment of an order reference like the one it creates', async () => {
    const client = createFakeShipxClient();
    expect(await client.findShipmentByReference(credentials, 'order-1', '2026-11-08T09:50:00.000Z')).toMatchObject({
      ok: true,
      value: { id: fakeShipxShipmentId('order-1'), reference: 'order-1', status: 'confirmed' },
    });
  });

  it('rejects requests ShipX would reject', async () => {
    const client = createFakeShipxClient();
    expect(await client.createShipment(credentials, { ...request, targetPoint: null })).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', details: { error: 'validation_failed', fields: { 'custom_attributes.target_point': ['required'] } } },
    });
    expect(await client.createShipment(credentials, { ...request, service: 'inpost_courier_standard', targetPoint: null })).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected' },
    });
  });
});
