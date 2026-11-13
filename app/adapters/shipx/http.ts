import {
  err,
  ok,
  sanitizeShipxError,
  SHIPX_RECONCILE_PAGE_SIZE,
  SHIPX_REQUEST_TIMEOUT_MS,
  shipxRejected,
  shipxUnavailable,
  type AppError,
  type Result,
  type ShipxEnvironment,
  type ShipxLabel,
  type ShipxRemoteShipment,
} from '#core/domain/index.js';
import type { ShipxClient, ShipxCredentials } from '#core/server/index.js';

import { toRemoteShipment, toWireShipmentRequest, wireShipmentListSchema, wireShipmentSchema } from './wire.js';

const SHIPX_BASE_URLS: Record<ShipxEnvironment, string> = {
  production: 'https://api-shipx-pl.easypack24.net/v1',
  sandbox: 'https://sandbox-api-shipx-pl.easypack24.net/v1',
};

const LABEL_MAX_BYTES = 5 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

export interface ShipxHttpClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ShipxRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  accept: 'application/json' | 'application/pdf';
  retry: boolean;
}

type Outcome<T> =
  | { kind: 'network' }
  | { kind: 'server'; status: number }
  | { kind: 'unreadable' }
  | { kind: 'done'; result: Result<T, AppError> };

type Reader<T> = (response: Response) => Promise<Result<T, AppError>>;

const segment = (value: string): string => encodeURIComponent(value);

const numericId = (value: string): string | number => /^\d+$/.test(value) ? Number(value) : value;

const readShipment: Reader<ShipxRemoteShipment> = async (response) => {
  const parsed = wireShipmentSchema.safeParse(await response.json());
  return parsed.success ? ok(toRemoteShipment(parsed.data)) : err(shipxUnavailable('InPost ShipX returned an unexpected shipment'));
};

const readShipmentList: Reader<ShipxRemoteShipment[]> = async (response) => {
  const parsed = wireShipmentListSchema.safeParse(await response.json());
  if (!parsed.success) return err(shipxUnavailable('InPost ShipX returned an unexpected shipment list'));
  return ok(parsed.data.items.flatMap((item) => {
    const shipment = wireShipmentSchema.safeParse(item);
    return shipment.success ? [toRemoteShipment(shipment.data)] : [];
  }));
};

const readLabel: Reader<ShipxLabel> = async (response) => {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > LABEL_MAX_BYTES) {
    await response.body?.cancel();
    return err(shipxUnavailable('The InPost label is unexpectedly large'));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > LABEL_MAX_BYTES || !PDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return err(shipxUnavailable('InPost ShipX did not return a PDF label'));
  }
  return ok({ contentType: 'application/pdf', bytes });
};

export const createShipxHttpClient = (options: ShipxHttpClientOptions = {}): ShipxClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SHIPX_REQUEST_TIMEOUT_MS;

  const attempt = async <T>(credentials: ShipxCredentials, request: ShipxRequest, read: Reader<T>): Promise<Outcome<T>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let answered = false;
    try {
      const response = await fetchImpl(`${SHIPX_BASE_URLS[credentials.environment]}${request.path}`, {
        method: request.method,
        headers: {
          authorization: `Bearer ${credentials.token}`,
          accept: request.accept,
          'accept-language': 'en_GB',
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: request.body === undefined ? null : JSON.stringify(request.body),
        redirect: 'error',
        signal: controller.signal,
      });
      answered = true;
      if (response.status >= 500) {
        await response.body?.cancel();
        return { kind: 'server', status: response.status };
      }
      if (!response.ok) {
        const body: unknown = await response.json().catch((cause: unknown) => {
          if (controller.signal.aborted) throw cause;
          return null;
        });
        return { kind: 'done', result: err(shipxRejected(sanitizeShipxError(response.status, body))) };
      }
      return { kind: 'done', result: await read(response) };
    } catch {
      return !answered || controller.signal.aborted ? { kind: 'network' } : { kind: 'unreadable' };
    } finally {
      clearTimeout(timer);
    }
  };

  const call = async <T>(credentials: ShipxCredentials, request: ShipxRequest, read: Reader<T>): Promise<Result<T, AppError>> => {
    let outcome = await attempt(credentials, request, read);
    if (request.retry && (outcome.kind === 'network' || outcome.kind === 'server')) outcome = await attempt(credentials, request, read);
    switch (outcome.kind) {
      case 'network':
        return err(shipxUnavailable('InPost ShipX did not answer in time; retry in a moment'));
      case 'server':
        return err(shipxUnavailable(`InPost ShipX is unavailable (HTTP ${String(outcome.status)}); retry in a moment`));
      case 'unreadable':
        return err(shipxUnavailable('InPost ShipX returned an unreadable answer'));
      case 'done':
        return outcome.result;
    }
  };

  return {
    createShipment: async (credentials, request) => call(credentials, {
      method: 'POST',
      path: `/organizations/${segment(credentials.organizationId)}/shipments`,
      body: toWireShipmentRequest(request),
      accept: 'application/json',
      retry: false,
    }, readShipment),
    getShipment: async (credentials, shipmentId) => call(credentials, {
      method: 'GET',
      path: `/shipments/${segment(shipmentId)}`,
      accept: 'application/json',
      retry: false,
    }, readShipment),
    findShipmentByReference: async (credentials, reference) => {
      const query = new URLSearchParams({ page: '1', per_page: String(SHIPX_RECONCILE_PAGE_SIZE), sort_by: 'created_at', sort_order: 'desc' });
      const listed = await call(credentials, {
        method: 'GET',
        path: `/organizations/${segment(credentials.organizationId)}/shipments?${query.toString()}`,
        accept: 'application/json',
        retry: false,
      }, readShipmentList);
      if (!listed.ok) return listed;
      return ok(listed.value.find((shipment) => shipment.reference === reference) ?? null);
    },
    buyOffer: async (credentials, shipmentId, offerId) => call(credentials, {
      method: 'POST',
      path: `/shipments/${segment(shipmentId)}/buy`,
      body: { offer_id: numericId(offerId) },
      accept: 'application/json',
      retry: false,
    }, readShipment),
    fetchLabel: async (credentials, shipmentId) => call(credentials, {
      method: 'POST',
      path: `/organizations/${segment(credentials.organizationId)}/shipments/labels`,
      body: { shipment_ids: [numericId(shipmentId)], format: 'Pdf', type: 'A6' },
      accept: 'application/pdf',
      retry: true,
    }, readLabel),
  };
};
