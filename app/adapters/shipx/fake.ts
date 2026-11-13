import {
  err,
  ok,
  shipxRejected,
  type ShipxRemoteShipment,
  type ShipxService,
} from '#core/domain/index.js';
import type { ShipxClient } from '#core/server/index.js';

const FAKE_ID_PREFIX = '9';
const FAKE_TRACKING_PREFIX = '6';
const TRACKING_LENGTH = 24;

const fnv1a = (value: string): number => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

export const fakeShipxShipmentId = (reference: string): string => `${FAKE_ID_PREFIX}${String(fnv1a(reference)).padStart(10, '0')}`;

export const fakeShipxTrackingNumber = (shipmentId: string): string =>
  `${FAKE_TRACKING_PREFIX}${shipmentId.replace(/\D/g, '').padStart(TRACKING_LENGTH - 1, '0')}`;

const offer = (shipmentId: string, service: ShipxService | null, status: string) => ({
  id: `${shipmentId}1`,
  status,
  service,
});

const confirmed = (shipmentId: string): ShipxRemoteShipment => ({
  id: shipmentId,
  status: 'confirmed',
  trackingNumber: fakeShipxTrackingNumber(shipmentId),
  offers: [],
  selectedOffer: offer(shipmentId, null, 'bought'),
  transactions: [{ status: 'success' }],
});

const rejected = (field: string) => err(shipxRejected({
  status: 400,
  error: 'validation_failed',
  description: 'Some of data sent in payload are invalid. Check details for more information.',
  fields: { [field]: ['required'] },
}));

const pdfLabel = (trackingNumber: string): Uint8Array => new TextEncoder().encode([
  '%PDF-1.4',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 298 420] >> endobj',
  `% InPost test label ${trackingNumber}`,
  'trailer << /Root 1 0 R >>',
  '%%EOF',
  '',
].join('\n'));

export const createFakeShipxClient = (): ShipxClient => ({
  createShipment: async (_credentials, request) => {
    if (request.service === 'inpost_locker_standard' && request.targetPoint === null) return rejected('custom_attributes.target_point');
    if (request.service === 'inpost_courier_standard' && request.receiver.address === null) return rejected('receiver.address');
    if (request.receiver.phone === '') return rejected('receiver.phone');
    const id = fakeShipxShipmentId(request.reference);
    return ok({ id, status: 'created', trackingNumber: null, offers: [], selectedOffer: null, transactions: [] });
  },
  getShipment: async (_credentials, shipmentId) => ok(confirmed(shipmentId)),
  findShipmentByReference: async (_credentials, reference) => ok({ ...confirmed(fakeShipxShipmentId(reference)), reference }),
  buyOffer: async (_credentials, shipmentId) => ok({
    ...confirmed(shipmentId),
    status: 'offer_selected',
    trackingNumber: null,
    transactions: [{ status: 'initiated' }],
  }),
  fetchLabel: async (_credentials, shipmentId) => ok({
    contentType: 'application/pdf',
    bytes: pdfLabel(fakeShipxTrackingNumber(shipmentId)),
  }),
});
