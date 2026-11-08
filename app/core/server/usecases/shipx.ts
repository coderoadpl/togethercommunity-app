import {
  appError,
  buildShipxShipmentRequest,
  configureShipxInputSchema,
  DEFAULT_PARCEL_TEMPLATE,
  DEFAULT_SHIPX_ENVIRONMENT,
  err,
  integrationNotConfigured,
  largestParcelTemplate,
  notFound,
  ok,
  orderShipmentAllowed,
  productLines,
  SHIPX_OPERATION_DEADLINE_MS,
  SHIPX_OPERATION_LEASE_MS,
  SHIPX_POLL_ATTEMPTS,
  SHIPX_POLL_INTERVAL_MS,
  SHIPX_RECONCILE_LOOKBACK_MS,
  SHIPX_STATUS_UNCONFIRMED,
  shipxAttemptUnconfirmed,
  shipxClientKind,
  shipxFailedTransactions,
  shipxOfferToBuy,
  shipxOrderInputSchema,
  shipxPurchaseFailure,
  shipxReference,
  shipxServiceFor,
  shipxShipmentBought,
  shipxUnavailable,
  validation,
  type AppError,
  type OrderListItem,
  type OrderShipping,
  type ParcelTemplate,
  type Result,
  type ShipxEnvironment,
  type ShipxOrderView,
  type ShipxRemoteShipment,
  type ShipxSender,
  type ShipxService,
  type ShipxSettingsView,
  type ShipxShipment,
  type TenantSecret,
  type TenantSecretKey,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock,
  IdGenerator,
  OrderDetailRepository,
  ProductBatchReader,
  SecretCrypto,
  TenantSecretRepository,
  TenantSecretResolver,
} from '../ports.js';
import type {
  ShipxClient,
  ShipxClients,
  ShipxCredentials,
  ShipxSettings,
  ShipxSettingsRepository,
  ShipxShipmentRecord,
  ShipxShipmentRepository,
} from '../shipx-ports.js';
import { shipOrder, type ShipOrderDeps } from './order-fulfilment.js';
import { buildTenantSecret } from './tenant-secrets.js';

const SHIPX_SECRET_KEYS = ['shipx.organizationId', 'shipx.token'] as const satisfies readonly TenantSecretKey[];

export interface ShipxSettingsDeps {
  shipxSettings: ShipxSettingsRepository;
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  ids: IdGenerator;
  clock: Clock;
}

const settingsOf = async (tenantId: string, deps: { shipxSettings: ShipxSettingsRepository }): Promise<ShipxSettings> =>
  await deps.shipxSettings.find(tenantId) ?? { environment: DEFAULT_SHIPX_ENVIRONMENT, sender: null };

const settingsView = (settings: ShipxSettings, secrets: readonly TenantSecret[]): ShipxSettingsView => {
  const masked = (key: TenantSecretKey) => {
    const secret = secrets.find((row) => row.key === key);
    return secret === undefined ? null : { maskedPreview: secret.maskedPreview, updatedAt: secret.updatedAt };
  };
  const organizationId = masked('shipx.organizationId');
  const token = masked('shipx.token');
  return {
    environment: settings.environment,
    sender: settings.sender,
    organizationId,
    token,
    configured: organizationId !== null && token !== null && settings.sender !== null,
  };
};

export const getShipxSettings = async (
  ctx: Ctx,
  deps: Pick<ShipxSettingsDeps, 'shipxSettings' | 'tenantSecrets'>,
): Promise<Result<ShipxSettingsView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:read');
  if (!tenant.ok) return tenant;
  const [settings, secrets] = await Promise.all([settingsOf(tenant.value, deps), deps.tenantSecrets.listByTenant(tenant.value)]);
  return ok(settingsView(settings, secrets));
};

export const configureShipx = async (
  ctx: Ctx,
  input: unknown,
  deps: ShipxSettingsDeps,
): Promise<Result<ShipxSettingsView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write');
  if (!tenant.ok) return tenant;
  const parsed = configureShipxInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid InPost ShipX settings', parsed.error.flatten()));
  if (parsed.data.clearCredentials === true && (parsed.data.organizationId !== undefined || parsed.data.token !== undefined)) {
    return err(validation('Clearing the credentials cannot be combined with new credentials'));
  }
  const current = await settingsOf(tenant.value, deps);
  const next: ShipxSettings = {
    environment: parsed.data.environment ?? current.environment,
    sender: parsed.data.sender === undefined ? current.sender : parsed.data.sender,
  };
  await deps.shipxSettings.save(tenant.value, next);
  if (parsed.data.clearCredentials === true) {
    await Promise.all(SHIPX_SECRET_KEYS.map((key) => deps.tenantSecrets.delete(tenant.value, key)));
  }
  const written = [
    ...(parsed.data.organizationId === undefined ? [] : [buildTenantSecret(tenant.value, 'shipx.organizationId', parsed.data.organizationId, deps)]),
    ...(parsed.data.token === undefined ? [] : [buildTenantSecret(tenant.value, 'shipx.token', parsed.data.token, deps)]),
  ];
  if (written.length > 0) await deps.tenantSecrets.upsertMany(tenant.value, written);
  return ok(settingsView(next, await deps.tenantSecrets.listByTenant(tenant.value)));
};

export interface ShipxOrderDeps {
  orderDetails: OrderDetailRepository;
  products: ProductBatchReader;
  shipxShipments: ShipxShipmentRepository;
  shipxSettings: ShipxSettingsRepository;
  tenantSecrets: Pick<TenantSecretRepository, 'findByKey'>;
  secrets: TenantSecretResolver;
  shipx: ShipxClients;
  clock: Clock;
}

export interface CreateInpostShipmentDeps extends ShipxOrderDeps {
  ship: ShipOrderDeps;
  ids: IdGenerator;
  wait(milliseconds: number): Promise<void>;
}

const resolveCredentials = async (
  tenantId: string,
  settings: ShipxSettings,
  deps: Pick<ShipxOrderDeps, 'secrets'>,
): Promise<Result<ShipxCredentials, AppError>> => {
  const [organizationId, token] = await Promise.all([
    deps.secrets.resolve(tenantId, 'shipx.organizationId'),
    deps.secrets.resolve(tenantId, 'shipx.token'),
  ]);
  if (!organizationId.ok || !token.ok) {
    return err(integrationNotConfigured('Save the InPost ShipX organization id and token in Settings → Shipping'));
  }
  return ok({ organizationId: organizationId.value, token: token.value, environment: settings.environment });
};

const credentialsPresent = async (tenantId: string, deps: Pick<ShipxOrderDeps, 'tenantSecrets'>): Promise<boolean> => {
  const rows = await Promise.all(SHIPX_SECRET_KEYS.map((key) => deps.tenantSecrets.findByKey(tenantId, key)));
  return rows.every((row) => row !== null);
};

const clientFor = (environment: ShipxEnvironment, order: OrderListItem, clients: ShipxClients): Result<ShipxClient, AppError> => {
  if (clients.real === null) return ok(clients.fake);
  const kind = shipxClientKind(environment, order.mode === 'test' ? 'test' : 'live');
  if (!kind.ok) return kind;
  return ok(kind.value === 'real' ? clients.real : clients.fake);
};

const storedCredentials = (shipment: ShipxShipmentRecord, current: ShipxCredentials): Result<ShipxCredentials, AppError> => {
  if (shipment.environment !== current.environment) {
    return err(appError(
      'conflict',
      `The InPost shipment was created in the ShipX ${shipment.environment} environment, but the settings now use ${current.environment}; switch back or finish the shipment in Manager Paczek`,
      { environment: shipment.environment },
    ));
  }
  if (shipment.organizationId !== current.organizationId) {
    return err(appError(
      'conflict',
      'The InPost shipment belongs to a different ShipX organization than the one in the settings; restore it or finish the shipment in Manager Paczek',
    ));
  }
  return ok({ environment: shipment.environment, organizationId: shipment.organizationId, token: current.token });
};

const publicShipment = (record: ShipxShipmentRecord): ShipxShipment => ({
  shipxShipmentId: record.shipxShipmentId,
  status: record.status,
  trackingNumber: record.trackingNumber,
  environment: record.environment,
  createAttemptedAt: record.createAttemptedAt,
  boughtAt: record.boughtAt,
  labelFetchedAt: record.labelFetchedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const orderParcelTemplate = async (tenantId: string, order: OrderListItem, deps: Pick<ShipxOrderDeps, 'products'>): Promise<ParcelTemplate> => {
  const lines = productLines(order.lines ?? []);
  const productIds = [...new Set(lines.length === 0 ? [order.productId] : lines.map((line) => line.productId))];
  const products = await deps.products.findByIds(tenantId, productIds);
  return largestParcelTemplate(products.map((product) => product.parcelTemplate ?? DEFAULT_PARCEL_TEMPLATE));
};

const loadOrder = async (tenantId: string, orderId: string, deps: Pick<ShipxOrderDeps, 'orderDetails'>): Promise<Result<OrderListItem, AppError>> => {
  const order = await deps.orderDetails.findById(tenantId, orderId);
  return order === null ? err(notFound('Order was not found')) : ok(order);
};

const recordRemote = async (
  tenantId: string,
  orderId: string,
  remote: ShipxRemoteShipment,
  deps: Pick<ShipxOrderDeps, 'shipxShipments' | 'clock'>,
): Promise<ShipxShipmentRecord | null> => {
  const now = deps.clock.nowIso();
  return deps.shipxShipments.update(tenantId, orderId, {
    shipxShipmentId: remote.id,
    status: remote.status,
    trackingNumber: remote.trackingNumber,
    ...(shipxShipmentBought(remote) ? { boughtAt: now } : {}),
    updatedAt: now,
  });
};

const refreshedShipment = async (
  tenantId: string,
  order: OrderListItem,
  shipment: ShipxShipmentRecord,
  settings: ShipxSettings,
  deps: ShipxOrderDeps,
): Promise<ShipxShipmentRecord> => {
  if (shipment.shipxShipmentId === null || shipxShipmentBought(shipment)) return shipment;
  const current = await resolveCredentials(tenantId, settings, deps);
  const credentials = current.ok ? storedCredentials(shipment, current.value) : current;
  const client = clientFor(shipment.environment, order, deps.shipx);
  if (!credentials.ok || !client.ok) return shipment;
  const remote = await client.value.getShipment(credentials.value, shipment.shipxShipmentId);
  if (!remote.ok) return shipment;
  return await recordRemote(tenantId, order.id, remote.value, deps) ?? shipment;
};

export const getInpostShipment = async (
  ctx: Ctx,
  input: unknown,
  deps: ShipxOrderDeps,
): Promise<Result<ShipxOrderView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;
  const parsed = shipxOrderInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order', parsed.error.flatten()));
  const order = await loadOrder(tenant.value, parsed.data.orderId, deps);
  if (!order.ok) return order;
  const service = order.value.shipping == null ? null : shipxServiceFor(order.value.shipping);
  const [stored, parcelTemplate, settings, credentials] = await Promise.all([
    deps.shipxShipments.findByOrder(tenant.value, order.value.id),
    orderParcelTemplate(tenant.value, order.value, deps),
    settingsOf(tenant.value, deps),
    credentialsPresent(tenant.value, deps),
  ]);
  const reason = service === null
    ? 'not_inpost'
    : order.value.fulfilmentStatus !== 'to_pack'
      ? 'not_to_pack'
      : !credentials
        ? 'credentials_missing'
        : settings.sender === null
          ? 'sender_missing'
          : clientFor(settings.environment, order.value, deps.shipx).ok ? null : 'sandbox_environment';
  const shipment = stored === null || !credentials ? stored : await refreshedShipment(tenant.value, order.value, stored, settings, deps);
  return ok({ available: reason === null, reason, service, parcelTemplate, shipment: shipment === null ? null : publicShipment(shipment) });
};

const pendingPayment = (shipmentId: string, status: string | null): AppError =>
  shipxUnavailable('InPost has not confirmed the payment yet; refresh the order in a moment', { state: 'pending', shipmentId, status });

const pollUntilBought = async (
  client: ShipxClient,
  credentials: ShipxCredentials,
  shipmentId: string,
  service: ShipxService,
  allowBuy: boolean,
  deadline: number,
  deps: Pick<CreateInpostShipmentDeps, 'wait' | 'clock'>,
): Promise<{ outcome: Result<ShipxRemoteShipment, AppError>; latest: ShipxRemoteShipment | null }> => {
  let buyAttempted = false;
  let failuresBefore: number | null = allowBuy ? null : 0;
  let latest: ShipxRemoteShipment | null = null;
  for (let attempt = 0; attempt < SHIPX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      if (Date.parse(deps.clock.nowIso()) + SHIPX_POLL_INTERVAL_MS > deadline) break;
      await deps.wait(SHIPX_POLL_INTERVAL_MS);
    }
    const current = await client.getShipment(credentials, shipmentId);
    if (!current.ok) return { outcome: current, latest };
    latest = current.value;
    failuresBefore ??= shipxFailedTransactions(latest);
    if (shipxShipmentBought(latest)) return { outcome: ok(latest), latest };
    const offerId = allowBuy && !buyAttempted ? shipxOfferToBuy(latest, service) : null;
    if (offerId !== null) {
      buyAttempted = true;
      failuresBefore = shipxFailedTransactions(latest);
      const purchase = await client.buyOffer(credentials, shipmentId, offerId);
      if (!purchase.ok && purchase.error.code !== 'shipx_unavailable') return { outcome: purchase, latest };
      continue;
    }
    const failure = shipxPurchaseFailure(latest, service, failuresBefore);
    if (failure !== null) return { outcome: err(failure), latest };
  }
  return { outcome: err(pendingPayment(shipmentId, latest?.status ?? null)), latest };
};

const leaseExpiredBefore = (now: string): string => new Date(Date.parse(now) - SHIPX_OPERATION_LEASE_MS).toISOString();

interface ShipmentRun {
  tenantId: string;
  order: OrderListItem;
  shipping: OrderShipping;
  service: ShipxService;
  sender: ShipxSender;
  shipment: ShipxShipmentRecord;
  credentials: ShipxCredentials;
  deadline: number;
}

const createRemote = async (run: ShipmentRun, client: ShipxClient, deps: CreateInpostShipmentDeps): Promise<Result<ShipxRemoteShipment, AppError>> => {
  const request = buildShipxShipmentRequest({
    orderId: run.order.id,
    memberEmail: run.order.memberEmail,
    shipping: run.shipping,
    sender: run.sender,
    parcelTemplate: await orderParcelTemplate(run.tenantId, run.order, deps),
  });
  if (!request.ok) {
    await deps.shipxShipments.release(run.tenantId, run.order.id);
    return request;
  }
  const attemptedAt = deps.clock.nowIso();
  await deps.shipxShipments.update(run.tenantId, run.order.id, { status: SHIPX_STATUS_UNCONFIRMED, createAttemptedAt: attemptedAt, updatedAt: attemptedAt });
  const created = await client.createShipment(run.credentials, request.value);
  if (!created.ok) {
    if (created.error.code === 'shipx_unavailable') {
      return err(shipxUnavailable(
        'InPost ShipX did not confirm the shipment; the next attempt looks it up in ShipX before creating anything',
        { state: 'unconfirmed', cause: created.error.message },
      ));
    }
    await deps.shipxShipments.release(run.tenantId, run.order.id);
    return created;
  }
  await recordRemote(run.tenantId, run.order.id, created.value, deps);
  return created;
};

const reconcileRemote = async (
  run: ShipmentRun,
  attemptedAt: string,
  client: ShipxClient,
  deps: CreateInpostShipmentDeps,
): Promise<Result<ShipxRemoteShipment, AppError>> => {
  const createdAfter = new Date(Date.parse(attemptedAt) - SHIPX_RECONCILE_LOOKBACK_MS).toISOString();
  const found = await client.findShipmentByReference(run.credentials, shipxReference(run.order.id), createdAfter);
  if (!found.ok) return found;
  if (found.value === null) {
    return err(appError('conflict', 'ShipX did not confirm the previous attempt; check Manager Paczek', { state: 'unconfirmed', attemptedAt }));
  }
  await recordRemote(run.tenantId, run.order.id, found.value, deps);
  return ok(found.value);
};

const runShipment = async (
  ctx: Ctx,
  run: ShipmentRun,
  deps: CreateInpostShipmentDeps,
): Promise<Result<{ order: OrderListItem; shipment: ShipxShipment }, AppError>> => {
  const credentials = storedCredentials(run.shipment, run.credentials);
  if (!credentials.ok) return credentials;
  const client = clientFor(run.shipment.environment, run.order, deps.shipx);
  if (!client.ok) return client;
  const scoped = { ...run, credentials: credentials.value };

  let shipmentId = run.shipment.shipxShipmentId;
  let remote: ShipxRemoteShipment | null = null;
  let createdNow = false;
  if (shipmentId === null) {
    const attemptedAt = run.shipment.createAttemptedAt;
    const obtained = shipxAttemptUnconfirmed(run.shipment) && attemptedAt !== null
      ? await reconcileRemote(scoped, attemptedAt, client.value, deps)
      : await createRemote(scoped, client.value, deps);
    if (!obtained.ok) return obtained;
    createdNow = !shipxAttemptUnconfirmed(run.shipment);
    remote = obtained.value;
    shipmentId = remote.id;
  }

  let trackingNumber = run.shipment.trackingNumber;
  if (remote !== null || trackingNumber === null) {
    const polled = remote !== null && shipxShipmentBought(remote)
      ? { outcome: ok(remote), latest: remote }
      : await pollUntilBought(client.value, credentials.value, shipmentId, run.service, !createdNow, run.deadline, deps);
    if (polled.latest !== null) await recordRemote(run.tenantId, run.order.id, polled.latest, deps);
    if (!polled.outcome.ok) return polled.outcome;
    trackingNumber = polled.outcome.value.trackingNumber;
  }
  if (trackingNumber === null) return err(pendingPayment(shipmentId, null));

  const shipped = await shipOrder(ctx, { orderId: run.order.id, carrier: 'inpost', trackingNumber }, deps.ship);
  if (!shipped.ok) {
    if (shipped.error.code !== 'fulfilment_conflict') return shipped;
    return err(appError(
      'fulfilment_conflict',
      `The order was marked as shipped meanwhile; the InPost shipment ${trackingNumber} exists as well, reconcile it in Manager Paczek`,
      { trackingNumber, shipxShipmentId: shipmentId },
    ));
  }
  const shipment = await deps.shipxShipments.findByOrder(run.tenantId, run.order.id);
  if (shipment === null) return err(notFound('The InPost shipment was not found'));
  return ok({ order: shipped.value.order, shipment: publicShipment(shipment) });
};

export const createInpostShipment = async (
  ctx: Ctx,
  input: unknown,
  deps: CreateInpostShipmentDeps,
): Promise<Result<{ order: OrderListItem; shipment: ShipxShipment }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const parsed = shipxOrderInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order', parsed.error.flatten()));
  const order = await loadOrder(tenant.value, parsed.data.orderId, deps);
  if (!order.ok) return order;
  const allowed = orderShipmentAllowed(order.value);
  if (!allowed.ok) return allowed;
  const shipping = order.value.shipping;
  const service = shipping == null ? null : shipxServiceFor(shipping);
  if (shipping == null || service === null) return err(validation('The order does not use an InPost delivery option'));
  const settings = await settingsOf(tenant.value, deps);
  const credentials = await resolveCredentials(tenant.value, settings, deps);
  if (!credentials.ok) return credentials;
  if (settings.sender === null) return err(integrationNotConfigured('Save the InPost sender details in Settings → Shipping'));
  const selected = clientFor(settings.environment, order.value, deps.shipx);
  if (!selected.ok) return selected;

  const startedAt = deps.clock.nowIso();
  const acquired = await deps.shipxShipments.acquire(tenant.value, {
    id: deps.ids.nextId(),
    orderId: order.value.id,
    environment: settings.environment,
    organizationId: credentials.value.organizationId,
    now: startedAt,
    leaseExpiredBefore: leaseExpiredBefore(startedAt),
  });
  if (acquired.kind === 'in_progress') {
    return err(appError('fulfilment_conflict', 'Another request is creating the InPost shipment for this order; refresh the order in a moment'));
  }
  try {
    return await runShipment(ctx, {
      tenantId: tenant.value,
      order: order.value,
      shipping,
      service,
      sender: settings.sender,
      shipment: acquired.shipment,
      credentials: credentials.value,
      deadline: Date.parse(startedAt) + SHIPX_OPERATION_DEADLINE_MS,
    }, deps);
  } finally {
    await deps.shipxShipments.finishOperation(tenant.value, order.value.id);
  }
};

export const discardInpostShipmentAttempt = async (
  ctx: Ctx,
  input: unknown,
  deps: Pick<ShipxOrderDeps, 'orderDetails' | 'shipxShipments' | 'clock'>,
): Promise<Result<{ discarded: true }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const parsed = shipxOrderInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order', parsed.error.flatten()));
  const order = await loadOrder(tenant.value, parsed.data.orderId, deps);
  if (!order.ok) return order;
  const shipment = await deps.shipxShipments.findByOrder(tenant.value, order.value.id);
  if (shipment === null || !shipxAttemptUnconfirmed(shipment)) return err(validation('The order has no unconfirmed InPost attempt to discard'));
  const discarded = await deps.shipxShipments.discardUnconfirmed(tenant.value, order.value.id, leaseExpiredBefore(deps.clock.nowIso()));
  if (!discarded) {
    return err(appError('fulfilment_conflict', 'Another request is working on the InPost shipment for this order; refresh the order in a moment'));
  }
  return ok({ discarded: true });
};

export interface InpostLabelFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export const inpostShipmentLabel = async (
  ctx: Ctx,
  input: unknown,
  deps: ShipxOrderDeps,
): Promise<Result<InpostLabelFile, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;
  const parsed = shipxOrderInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order', parsed.error.flatten()));
  const order = await loadOrder(tenant.value, parsed.data.orderId, deps);
  if (!order.ok) return order;
  const shipment = await deps.shipxShipments.findByOrder(tenant.value, order.value.id);
  if (shipment?.shipxShipmentId == null) return err(notFound('The order has no InPost shipment'));
  const settings = await settingsOf(tenant.value, deps);
  const current = await resolveCredentials(tenant.value, settings, deps);
  if (!current.ok) return current;
  const credentials = storedCredentials(shipment, current.value);
  if (!credentials.ok) return credentials;
  const client = clientFor(shipment.environment, order.value, deps.shipx);
  if (!client.ok) return client;
  const label = await client.value.fetchLabel(credentials.value, shipment.shipxShipmentId);
  if (!label.ok) return label;
  await deps.shipxShipments.update(tenant.value, order.value.id, { labelFetchedAt: deps.clock.nowIso(), updatedAt: deps.clock.nowIso() });
  const name = (shipment.trackingNumber ?? shipment.shipxShipmentId).replace(/[^A-Za-z0-9-]/g, '');
  return ok({ filename: `inpost-${name}.pdf`, contentType: label.value.contentType, bytes: label.value.bytes });
};
