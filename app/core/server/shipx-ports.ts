import type {
  AppError,
  Result,
  ShipxEnvironment,
  ShipxLabel,
  ShipxRemoteShipment,
  ShipxSender,
  ShipxShipment,
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
  findShipmentByReference(
    credentials: ShipxCredentials,
    reference: string,
    createdAfter: string,
  ): Promise<Result<ShipxRemoteShipment | null, AppError>>;
  buyOffer(credentials: ShipxCredentials, shipmentId: string, offerId: string): Promise<Result<ShipxRemoteShipment, AppError>>;
  fetchLabel(credentials: ShipxCredentials, shipmentId: string): Promise<Result<ShipxLabel, AppError>>;
}

export interface ShipxClients {
  real: ShipxClient | null;
  fake: ShipxClient;
}

export interface ShipxShipmentRecord extends ShipxShipment {
  organizationId: string;
  operationStartedAt: string | null;
}

type ShipxShipmentAcquisition =
  | { kind: 'acquired'; shipment: ShipxShipmentRecord }
  | { kind: 'in_progress'; shipment: ShipxShipmentRecord };

interface ShipxShipmentPatch {
  shipxShipmentId?: string;
  status?: string;
  trackingNumber?: string | null;
  createAttemptedAt?: string;
  boughtAt?: string | null;
  labelFetchedAt?: string;
  updatedAt: string;
}

export interface ShipxShipmentRepository {
  findByOrder(tenantId: string, orderId: string): Promise<ShipxShipmentRecord | null>;
  acquire(tenantId: string, input: {
    id: string;
    orderId: string;
    environment: ShipxEnvironment;
    organizationId: string;
    now: string;
    leaseExpiredBefore: string;
  }): Promise<ShipxShipmentAcquisition>;
  update(tenantId: string, orderId: string, patch: ShipxShipmentPatch): Promise<ShipxShipmentRecord | null>;
  finishOperation(tenantId: string, orderId: string): Promise<void>;
  release(tenantId: string, orderId: string): Promise<void>;
  discardUnconfirmed(tenantId: string, orderId: string, leaseExpiredBefore: string): Promise<boolean>;
}

export interface ShipxSettings {
  environment: ShipxEnvironment;
  sender: ShipxSender | null;
}

export interface ShipxSettingsRepository {
  find(tenantId: string): Promise<ShipxSettings | null>;
  save(tenantId: string, settings: ShipxSettings): Promise<void>;
}
