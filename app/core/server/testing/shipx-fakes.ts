import { ok, type AppError, type Result, type ShipxRemoteShipment, type ShipxShipmentRequest } from '#core/domain/index.js';

import type {
  ShipxClient,
  ShipxCredentials,
  ShipxSettings,
  ShipxSettingsRepository,
  ShipxShipmentEvent,
  ShipxShipmentPatch,
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
  operationToken: null,
  operationStartedAt: null,
  ...change,
});

const applyPatch = (row: ShipxShipmentRecord, patch: ShipxShipmentPatch): ShipxShipmentRecord => ({
  ...row,
  ...(patch.shipxShipmentId === undefined ? {} : { shipxShipmentId: patch.shipxShipmentId }),
  ...(patch.status === undefined ? {} : { status: patch.status }),
  ...(patch.trackingNumber === undefined ? {} : { trackingNumber: patch.trackingNumber }),
  ...(patch.createAttemptedAt === undefined ? {} : { createAttemptedAt: patch.createAttemptedAt }),
  ...(patch.boughtAt === undefined ? {} : { boughtAt: row.boughtAt ?? patch.boughtAt }),
  updatedAt: patch.updatedAt,
});

export const createShipxShipmentRepositoryFake = () => {
  const rows = new Map<string, ShipxShipmentRecord>();
  const events: Array<{ tenantId: string; event: ShipxShipmentEvent }> = [];
  const key = (tenantId: string, orderId: string) => `${tenantId}/${orderId}`;
  const free = (row: ShipxShipmentRecord, leaseExpiredBefore: string) =>
    row.operationStartedAt === null || row.operationStartedAt < leaseExpiredBefore;
  const owned = (tenantId: string, orderId: string, token: string) => {
    const row = rows.get(key(tenantId, orderId));
    return row?.operationToken === token ? row : null;
  };
  const record = (tenantId: string, orderId: string, row: ShipxShipmentRecord, event: Omit<ShipxShipmentEvent, 'orderId' | 'shipxShipmentId'>) => {
    events.push({ tenantId, event: { ...event, orderId, shipxShipmentId: row.shipxShipmentId } });
  };
  const recordBought = (tenantId: string, orderId: string, before: ShipxShipmentRecord, after: ShipxShipmentRecord, actorUserId: string | null, operationToken: string | null, createdAt: string) => {
    if (before.boughtAt !== null || after.boughtAt === null) return;
    record(tenantId, orderId, after, {
      type: 'offer_bought', actorUserId, operationToken, details: { status: after.status, trackingNumber: after.trackingNumber }, createdAt,
    });
  };
  const attemptDetails = (row: ShipxShipmentRecord) => ({ status: row.status, createAttemptedAt: row.createAttemptedAt });
  const repository: ShipxShipmentRepository = {
    findByOrder: async (tenantId, orderId) => rows.get(key(tenantId, orderId)) ?? null,
    acquire: async (tenantId, input) => {
      const existing = rows.get(key(tenantId, input.orderId));
      const claim = { actorUserId: input.actorUserId, operationToken: input.token, createdAt: input.now };
      if (existing === undefined) {
        const shipment = shipmentRecord({
          environment: input.environment,
          organizationId: input.organizationId,
          operationToken: input.token,
          operationStartedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        });
        rows.set(key(tenantId, input.orderId), shipment);
        record(tenantId, input.orderId, shipment, { ...claim, type: 'attempt_claimed', details: { environment: input.environment } });
        return { kind: 'acquired', shipment };
      }
      if (!free(existing, input.leaseExpiredBefore)) return { kind: 'in_progress', shipment: existing };
      const taken = { ...existing, operationToken: input.token, operationStartedAt: input.now };
      rows.set(key(tenantId, input.orderId), taken);
      record(tenantId, input.orderId, taken, existing.operationToken === null
        ? { ...claim, type: 'attempt_claimed', details: { environment: taken.environment } }
        : { ...claim, type: 'lease_taken_over', details: { previousOperationToken: existing.operationToken, previousOperationStartedAt: existing.operationStartedAt } });
      return { kind: 'acquired', shipment: taken };
    },
    update: async (tenantId, orderId, token, patch, step) => {
      const existing = owned(tenantId, orderId, token);
      if (existing === null) return { kind: 'lost_lock' };
      const shipment = applyPatch(existing, patch);
      rows.set(key(tenantId, orderId), shipment);
      if (step.event !== null) {
        record(tenantId, orderId, shipment, {
          type: step.event.type, actorUserId: step.actorUserId, operationToken: token, details: step.event.details ?? null, createdAt: patch.updatedAt,
        });
      }
      recordBought(tenantId, orderId, existing, shipment, step.actorUserId, token, patch.updatedAt);
      return { kind: 'updated', shipment };
    },
    finishOperation: async (tenantId, orderId, token) => {
      const existing = owned(tenantId, orderId, token);
      if (existing === null) return { kind: 'lost_lock' };
      rows.set(key(tenantId, orderId), { ...existing, operationToken: null, operationStartedAt: null });
      return { kind: 'finished' };
    },
    release: async (tenantId, orderId, token, audit) => {
      const existing = owned(tenantId, orderId, token);
      if (existing === null || existing.shipxShipmentId !== null) return { kind: 'lost_lock' };
      rows.delete(key(tenantId, orderId));
      record(tenantId, orderId, existing, {
        type: 'attempt_released', actorUserId: audit.actorUserId, operationToken: token, details: attemptDetails(existing), createdAt: audit.at,
      });
      return { kind: 'released' };
    },
    refreshUnclaimed: async (tenantId, orderId, leaseExpiredBefore, patch, actorUserId) => {
      const existing = rows.get(key(tenantId, orderId));
      if (existing === undefined || !free(existing, leaseExpiredBefore)) return null;
      const shipment = applyPatch(existing, patch);
      rows.set(key(tenantId, orderId), shipment);
      recordBought(tenantId, orderId, existing, shipment, actorUserId, null, patch.updatedAt);
      return shipment;
    },
    markLabelFetched: async (tenantId, orderId, audit) => {
      const existing = rows.get(key(tenantId, orderId));
      if (existing === undefined) return;
      const shipment = { ...existing, labelFetchedAt: audit.at, updatedAt: audit.at };
      rows.set(key(tenantId, orderId), shipment);
      record(tenantId, orderId, shipment, { type: 'label_fetched', actorUserId: audit.actorUserId, operationToken: null, details: null, createdAt: audit.at });
    },
    discardUnconfirmed: async (tenantId, orderId, leaseExpiredBefore, audit) => {
      const existing = rows.get(key(tenantId, orderId));
      if (existing?.shipxShipmentId !== null || existing.createAttemptedAt === null || !free(existing, leaseExpiredBefore)) return false;
      rows.delete(key(tenantId, orderId));
      record(tenantId, orderId, existing, {
        type: 'attempt_discarded', actorUserId: audit.actorUserId, operationToken: null, details: attemptDetails(existing), createdAt: audit.at,
      });
      return true;
    },
    listEvents: async (tenantId, orderId) =>
      events.filter((entry) => entry.tenantId === tenantId && entry.event.orderId === orderId).map((entry) => entry.event),
  };
  return { repository, rows, events, key };
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
  find?: (reference: string) => Result<ShipxRemoteShipment | null, AppError>;
  buy?: (shipmentId: string) => Result<ShipxRemoteShipment, AppError> | Promise<Result<ShipxRemoteShipment, AppError>>;
  label?: Result<{ contentType: string; bytes: Uint8Array }, AppError>;
} = {}) => {
  const calls: {
    create: ShipxShipmentRequest[];
    get: string[];
    find: string[];
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
    findShipmentByReference: async (credentials, reference) => {
      calls.credentials.push(credentials);
      calls.find.push(reference);
      return options.find?.(reference) ?? ok(null);
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
