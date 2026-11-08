import { ok, type AppError, type Result, type ShipxRemoteShipment, type ShipxShipmentRequest } from '#core/domain/index.js';

import type {
  ShipxClient,
  ShipxCredentials,
  ShipxSettings,
  ShipxSettingsRepository,
  ShipxShipmentRecord,
  ShipxShipmentRepository,
} from '../shipx-ports.js';

export const shipmentRecord = (change: Partial<ShipxShipmentRecord> = {}): ShipxShipmentRecord => ({
  shipxShipmentId: null,
  status: 'creating',
  trackingNumber: null,
  environment: 'sandbox',
  createAttemptedAt: null,
  boughtAt: null,
  labelFetchedAt: null,
  createdAt: '2026-11-08T09:00:00.000Z',
  updatedAt: '2026-11-08T09:00:00.000Z',
  organizationId: '1234',
  operationStartedAt: null,
  ...change,
});

export const createShipxShipmentRepositoryFake = () => {
  const rows = new Map<string, ShipxShipmentRecord>();
  const key = (tenantId: string, orderId: string) => `${tenantId}/${orderId}`;
  const free = (row: ShipxShipmentRecord, leaseExpiredBefore: string) =>
    row.operationStartedAt === null || row.operationStartedAt < leaseExpiredBefore;
  const repository: ShipxShipmentRepository = {
    findByOrder: async (tenantId, orderId) => rows.get(key(tenantId, orderId)) ?? null,
    acquire: async (tenantId, input) => {
      const existing = rows.get(key(tenantId, input.orderId));
      if (existing === undefined) {
        const shipment = shipmentRecord({
          environment: input.environment,
          organizationId: input.organizationId,
          operationStartedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        });
        rows.set(key(tenantId, input.orderId), shipment);
        return { kind: 'acquired', shipment };
      }
      if (!free(existing, input.leaseExpiredBefore)) return { kind: 'in_progress', shipment: existing };
      const taken = { ...existing, operationStartedAt: input.now };
      rows.set(key(tenantId, input.orderId), taken);
      return { kind: 'acquired', shipment: taken };
    },
    update: async (tenantId, orderId, patch) => {
      const existing = rows.get(key(tenantId, orderId));
      if (existing === undefined) return null;
      const updated: ShipxShipmentRecord = {
        ...existing,
        ...(patch.shipxShipmentId === undefined ? {} : { shipxShipmentId: patch.shipxShipmentId }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.trackingNumber === undefined ? {} : { trackingNumber: patch.trackingNumber }),
        ...(patch.createAttemptedAt === undefined ? {} : { createAttemptedAt: patch.createAttemptedAt }),
        ...(patch.boughtAt === undefined ? {} : { boughtAt: existing.boughtAt ?? patch.boughtAt }),
        ...(patch.labelFetchedAt === undefined ? {} : { labelFetchedAt: patch.labelFetchedAt }),
        updatedAt: patch.updatedAt,
      };
      rows.set(key(tenantId, orderId), updated);
      return updated;
    },
    finishOperation: async (tenantId, orderId) => {
      const existing = rows.get(key(tenantId, orderId));
      if (existing !== undefined) rows.set(key(tenantId, orderId), { ...existing, operationStartedAt: null });
    },
    release: async (tenantId, orderId) => {
      if (rows.get(key(tenantId, orderId))?.shipxShipmentId === null) rows.delete(key(tenantId, orderId));
    },
    discardUnconfirmed: async (tenantId, orderId, leaseExpiredBefore) => {
      const existing = rows.get(key(tenantId, orderId));
      if (existing?.shipxShipmentId !== null || existing.createAttemptedAt === null || !free(existing, leaseExpiredBefore)) return false;
      rows.delete(key(tenantId, orderId));
      return true;
    },
  };
  return { repository, rows, key };
};

export const createShipxSettingsRepositoryFake = (initial: Record<string, ShipxSettings> = {}) => {
  const rows = new Map(Object.entries(initial));
  const repository: ShipxSettingsRepository = {
    find: async (tenantId) => rows.get(tenantId) ?? null,
    save: async (tenantId, settings) => {
      rows.set(tenantId, settings);
    },
  };
  return { repository, rows };
};

type Step = (shipmentId: string) => Result<ShipxRemoteShipment, AppError>;

export const remoteShipment = (id: string, change: Partial<ShipxRemoteShipment> = {}): ShipxRemoteShipment => ({
  id, status: 'created', trackingNumber: null, offers: [], selectedOffer: null, transactions: [], ...change,
});

export const createScriptedShipxClient = (options: {
  create?: (request: ShipxShipmentRequest) => Result<ShipxRemoteShipment, AppError> | Promise<Result<ShipxRemoteShipment, AppError>>;
  polls?: Step[];
  find?: (reference: string, createdAfter: string) => Result<ShipxRemoteShipment | null, AppError>;
  buy?: (shipmentId: string) => Result<ShipxRemoteShipment, AppError> | Promise<Result<ShipxRemoteShipment, AppError>>;
  label?: Result<{ contentType: string; bytes: Uint8Array }, AppError>;
} = {}) => {
  const calls: {
    create: ShipxShipmentRequest[];
    get: string[];
    find: Array<{ reference: string; createdAfter: string }>;
    buy: Array<{ shipmentId: string; offerId: string }>;
    label: string[];
    credentials: ShipxCredentials[];
  } = { create: [], get: [], find: [], buy: [], label: [], credentials: [] };
  const polls = [...(options.polls ?? [])];
  const confirmed: Step = (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: '520000011395200025754311' }));
  const client: ShipxClient = {
    createShipment: async (credentials, request) => {
      calls.credentials.push(credentials);
      calls.create.push(request);
      return await (options.create?.(request) ?? ok(remoteShipment('1001')));
    },
    getShipment: async (credentials, shipmentId) => {
      calls.credentials.push(credentials);
      calls.get.push(shipmentId);
      const step = polls.length > 1 ? polls.shift() : polls[0];
      return (step ?? confirmed)(shipmentId);
    },
    findShipmentByReference: async (credentials, reference, createdAfter) => {
      calls.credentials.push(credentials);
      calls.find.push({ reference, createdAfter });
      return options.find?.(reference, createdAfter) ?? ok(null);
    },
    buyOffer: async (credentials, shipmentId, offerId) => {
      calls.credentials.push(credentials);
      calls.buy.push({ shipmentId, offerId });
      return await (options.buy?.(shipmentId) ?? ok(remoteShipment(shipmentId, { status: 'offer_selected' })));
    },
    fetchLabel: async (credentials, shipmentId) => {
      calls.credentials.push(credentials);
      calls.label.push(shipmentId);
      return options.label ?? ok({ contentType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4 label') });
    },
  };
  return { client, calls };
};
