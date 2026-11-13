import type {
  AppError,
  Result,
  ShipxEnvironment,
  ShipxLabel,
  ShipxOperationOutcome,
  ShipxRemoteShipment,
  ShipxSender,
  ShipxShipment,
  ShipxShipmentEventType,
  ShipxShipmentRequest,
} from '#core/domain/index.js';

export interface ShipxCredentials {
  organizationId: string;
  token: string;
  environment: ShipxEnvironment;
}

export interface ShipxClient {
  createShipment(credentials: ShipxCredentials, request: ShipxShipmentRequest): Promise<Result<ShipxRemoteShipment, AppError>>;
  getShipment(credentials: ShipxCredentials, shipmentId: string): Promise<Result<ShipxRemoteShipment, AppError>>;
  findShipmentByReference(credentials: ShipxCredentials, reference: string): Promise<Result<ShipxRemoteShipment | null, AppError>>;
  buyOffer(credentials: ShipxCredentials, shipmentId: string, offerId: string): Promise<Result<ShipxRemoteShipment, AppError>>;
  fetchLabel(credentials: ShipxCredentials, shipmentId: string): Promise<Result<ShipxLabel, AppError>>;
}

export interface ShipxClients {
  real: ShipxClient | null;
  fake: ShipxClient;
}

export interface ShipxShipmentRecord extends ShipxShipment {
  organizationId: string;
  operationToken: string | null;
  operationStartedAt: string | null;
}

export type ShipxShipmentAcquisition =
  | { kind: 'acquired'; shipment: ShipxShipmentRecord }
  | { kind: 'in_progress'; shipment: ShipxShipmentRecord };

interface ShipxClaimLost {
  kind: 'lost_lock';
}

export type ShipxOwnedUpdate = { kind: 'updated'; shipment: ShipxShipmentRecord } | ShipxClaimLost;

export interface ShipxShipmentPatch {
  shipxShipmentId?: string;
  status?: string;
  trackingNumber?: string | null;
  createAttemptedAt?: string;
  boughtAt?: string | null;
  updatedAt: string;
}

export type ShipxShipmentEventDetails = Record<string, string | number | null>;

export interface ShipxShipmentEvent {
  orderId: string;
  shipxShipmentId: string | null;
  type: ShipxShipmentEventType;
  actorUserId: string | null;
  operationToken: string | null;
  details: ShipxShipmentEventDetails | null;
  createdAt: string;
}

export interface ShipxShipmentStep {
  actorUserId: string | null;
  event: { type: Extract<ShipxShipmentEventType, 'attempt_marked' | 'shipment_created' | 'shipment_adopted' | 'payment_failed'>; details?: ShipxShipmentEventDetails } | null;
}

interface ShipxShipmentAudit {
  actorUserId: string | null;
  at: string;
}

interface ShipxOperationEnd extends ShipxShipmentAudit {
  outcome: ShipxOperationOutcome;
}

export interface ShipxShipmentRepository {
  findByOrder(tenantId: string, orderId: string): Promise<ShipxShipmentRecord | null>;
  acquire(tenantId: string, input: {
    id: string;
    orderId: string;
    token: string;
    environment: ShipxEnvironment;
    organizationId: string;
    now: string;
    leaseExpiredBefore: string;
    actorUserId: string | null;
  }): Promise<ShipxShipmentAcquisition>;
  update(tenantId: string, orderId: string, token: string, patch: ShipxShipmentPatch, step: ShipxShipmentStep): Promise<ShipxOwnedUpdate>;
  finishOperation(tenantId: string, orderId: string, token: string, end: ShipxOperationEnd): Promise<{ kind: 'finished' } | ShipxClaimLost>;
  release(tenantId: string, orderId: string, token: string, audit: ShipxShipmentAudit): Promise<{ kind: 'released' } | ShipxClaimLost>;
  refreshUnclaimed(
    tenantId: string,
    orderId: string,
    leaseExpiredBefore: string,
    patch: ShipxShipmentPatch,
    actorUserId: string | null,
  ): Promise<ShipxShipmentRecord | null>;
  markLabelFetched(tenantId: string, orderId: string, audit: ShipxShipmentAudit): Promise<void>;
  discardUnconfirmed(tenantId: string, orderId: string, leaseExpiredBefore: string, audit: ShipxShipmentAudit): Promise<boolean>;
  listEvents(tenantId: string, orderId: string): Promise<ShipxShipmentEvent[]>;
}

export interface ShipxSettings {
  environment: ShipxEnvironment;
  sender: ShipxSender | null;
}

export interface ShipxSettingsRepository {
  find(tenantId: string): Promise<ShipxSettings | null>;
  save(tenantId: string, settings: ShipxSettings): Promise<void>;
}
