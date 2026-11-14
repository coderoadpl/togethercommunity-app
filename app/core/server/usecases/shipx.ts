import {
  buildShipxShipmentRequest,
  configureShipxInputSchema,
  DEFAULT_PARCEL_TEMPLATE,
  DEFAULT_SHIPX_ENVIRONMENT,
  err,
  largestParcelTemplate,
  notFound,
  ok,
  orderShipmentAllowed,
  productLines,
  SHIPX_OPERATION_DEADLINE_MS,
  SHIPX_OPERATION_LEASE_MS,
  SHIPX_POLL_ATTEMPTS,
  SHIPX_POLL_INTERVAL_MS,
  SHIPX_STATUS_UNCONFIRMED,
  shipxAttemptUnconfirmed,
  shipxClientKind,
  shipxErrorStateSchema,
  shipxFailedTransactions,
  shipxOfferToBuy,
  shipxOrderInputSchema,
  shipxPurchaseFailure,
  shipxReference,
  shipxServiceFor,
  shipxShipmentBought,
  shipxStateError,
  validation,
  type AppError,
  type OrderListItem,
  type OrderShipping,
  type ParcelTemplate,
  type Result,
  type ShipxEnvironment,
  type ShipxErrorState,
  type ShipxOperationOutcome,
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
  ShipxShipmentPatch,
  ShipxShipmentRecord,
  ShipxShipmentRepository,
  ShipxShipmentStep,
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
    return err(shipxStateError(
      'integration_not_configured',
      'Save the InPost ShipX organization id and token in Settings → Shipping',
      { state: 'setup_missing', reason: 'credentials_missing' },
    ));
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
    return err(shipxStateError(
      'conflict',
      `The InPost shipment was created in the ShipX ${shipment.environment} environment, but the settings now use ${current.environment}; switch back or finish the shipment in Manager Paczek`,
      { state: 'environment_mismatch', environment: shipment.environment, settingsEnvironment: current.environment },
    ));
  }
  if (shipment.organizationId !== current.organizationId) {
    return err(shipxStateError(
      'conflict',
      'The InPost shipment belongs to a different ShipX organization than the one in the settings; restore it or finish the shipment in Manager Paczek',
      { state: 'organization_mismatch' },
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

const remotePatch = (remote: ShipxRemoteShipment, now: string): ShipxShipmentPatch => ({
  shipxShipmentId: remote.id,
  status: remote.status,
  trackingNumber: remote.trackingNumber,
  ...(shipxShipmentBought(remote) ? { boughtAt: now } : {}),
  updatedAt: now,
});

const leaseExpiredBefore = (now: string): string => new Date(Date.parse(now) - SHIPX_OPERATION_LEASE_MS).toISOString();

const refreshedShipment = async (
  tenantId: string,
  actorUserId: string,
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
  const now = deps.clock.nowIso();
  return await deps.shipxShipments.refreshUnclaimed(tenantId, order.id, leaseExpiredBefore(now), remotePatch(remote.value, now), actorUserId) ?? shipment;
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
  const shipment = stored === null || !credentials ? stored : await refreshedShipment(tenant.value, ctx.identity.userId, order.value, stored, settings, deps);
  return ok({ available: reason === null, reason, service, parcelTemplate, shipment: shipment === null ? null : publicShipment(shipment) });
};

const pendingPayment = (shipmentId: string, status: string | null): AppError =>
  shipxStateError('shipx_unavailable', 'InPost has not confirmed the payment yet; refresh the order in a moment', { state: 'pending', shipmentId, status });

const pendingShipment = (status: string): AppError =>
  shipxStateError('shipx_unavailable', 'InPost ShipX is answering slowly; refresh the order in a moment', { state: 'pending', shipmentId: null, status });

const lostLock = (): AppError =>
  shipxStateError('fulfilment_conflict', 'Another request took over the InPost shipment for this order; refresh the order in a moment', { state: 'lost_lock' });

interface ShipmentRun {
  tenantId: string;
  actorUserId: string;
  order: OrderListItem;
  shipping: OrderShipping;
  service: ShipxService;
  sender: ShipxSender;
  shipment: ShipxShipmentRecord;
  credentials: ShipxCredentials;
  token: string;
  deadline: number;
  lease: { released: boolean };
}

const pastDeadline = (run: ShipmentRun, deps: Pick<CreateInpostShipmentDeps, 'clock'>): boolean =>
  Date.parse(deps.clock.nowIso()) >= run.deadline;

type ShipmentStepEvent = ShipxShipmentStep['event'];

const save = async (
  run: ShipmentRun,
  patch: ShipxShipmentPatch,
  event: ShipmentStepEvent,
  deps: Pick<CreateInpostShipmentDeps, 'shipxShipments'>,
): Promise<Result<ShipxShipmentRecord, AppError>> => {
  const saved = await deps.shipxShipments.update(run.tenantId, run.order.id, run.token, patch, { actorUserId: run.actorUserId, event });
  return saved.kind === 'lost_lock' ? err(lostLock()) : ok(saved.shipment);
};

const saveRemote = async (
  run: ShipmentRun,
  remote: ShipxRemoteShipment,
  event: ShipmentStepEvent,
  deps: Pick<CreateInpostShipmentDeps, 'shipxShipments' | 'clock'>,
): Promise<Result<ShipxRemoteShipment, AppError>> => {
  const saved = await save(run, remotePatch(remote, deps.clock.nowIso()), event, deps);
  return saved.ok ? ok(remote) : saved;
};

const paymentFailed = (status: string | null, failure: AppError): ShipmentStepEvent => ({ type: 'payment_failed', details: { status, reason: failure.message } });

const releaseAttempt = async <T>(
  run: ShipmentRun,
  outcome: Result<T, AppError>,
  deps: Pick<CreateInpostShipmentDeps, 'shipxShipments' | 'clock'>,
): Promise<Result<T, AppError>> => {
  const released = await deps.shipxShipments.release(run.tenantId, run.order.id, run.token, { actorUserId: run.actorUserId, at: deps.clock.nowIso() });
  if (released.kind === 'lost_lock') return err(lostLock());
  run.lease.released = true;
  return outcome;
};

const pollUntilBought = async (
  run: ShipmentRun,
  client: ShipxClient,
  shipmentId: string,
  allowBuy: boolean,
  deps: CreateInpostShipmentDeps,
): Promise<Result<ShipxRemoteShipment, AppError>> => {
  let buyAttempted = false;
  let failuresBefore: number | null = allowBuy ? null : 0;
  let latest: ShipxRemoteShipment | null = null;
  for (let attempt = 0; attempt < SHIPX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      if (Date.parse(deps.clock.nowIso()) + SHIPX_POLL_INTERVAL_MS > run.deadline) break;
      await deps.wait(SHIPX_POLL_INTERVAL_MS);
    }
    if (pastDeadline(run, deps)) break;
    const current = await client.getShipment(run.credentials, shipmentId);
    if (!current.ok) return current;
    latest = current.value;
    failuresBefore ??= shipxFailedTransactions(latest);
    const failure = shipxPurchaseFailure(latest, run.service, failuresBefore);
    const saved = await saveRemote(run, latest, failure === null ? null : paymentFailed(latest.status, failure), deps);
    if (!saved.ok) return saved;
    if (shipxShipmentBought(latest)) return ok(latest);
    if (failure !== null) return err(failure);
    const offerId = allowBuy && !buyAttempted ? shipxOfferToBuy(latest, run.service) : null;
    if (offerId === null) continue;
    if (pastDeadline(run, deps)) break;
    buyAttempted = true;
    const purchase = await client.buyOffer(run.credentials, shipmentId, offerId);
    if (!purchase.ok && purchase.error.code !== 'shipx_unavailable') {
      const recorded = await save(run, { updatedAt: deps.clock.nowIso() }, paymentFailed(latest.status, purchase.error), deps);
      return recorded.ok ? purchase : recorded;
    }
  }
  return err(pendingPayment(shipmentId, latest?.status ?? null));
};

const createRemote = async (run: ShipmentRun, client: ShipxClient, deps: CreateInpostShipmentDeps): Promise<Result<ShipxRemoteShipment, AppError>> => {
  const request = buildShipxShipmentRequest({
    orderId: run.order.id,
    memberEmail: run.order.memberEmail,
    shipping: run.shipping,
    sender: run.sender,
    parcelTemplate: await orderParcelTemplate(run.tenantId, run.order, deps),
  });
  if (!request.ok) return releaseAttempt(run, request, deps);
  if (pastDeadline(run, deps)) return err(pendingShipment(run.shipment.status));
  const attemptedAt = deps.clock.nowIso();
  const marked = await save(
    run,
    { status: SHIPX_STATUS_UNCONFIRMED, createAttemptedAt: attemptedAt, updatedAt: attemptedAt },
    { type: 'attempt_marked', details: { createAttemptedAt: attemptedAt } },
    deps,
  );
  if (!marked.ok) return marked;
  if (pastDeadline(run, deps)) return releaseAttempt(run, err(pendingShipment(run.shipment.status)), deps);
  const created = await client.createShipment(run.credentials, request.value);
  if (!created.ok) {
    if (created.error.code !== 'shipx_unavailable') return releaseAttempt(run, created, deps);
    return err(shipxStateError(
      'shipx_unavailable',
      'InPost ShipX did not confirm the shipment; the next attempt looks it up in ShipX before creating anything',
      { state: 'unconfirmed', cause: created.error.message },
    ));
  }
  return saveRemote(run, created.value, { type: 'shipment_created', details: { status: created.value.status } }, deps);
};

const reconcileRemote = async (
  run: ShipmentRun,
  attemptedAt: string,
  client: ShipxClient,
  deps: CreateInpostShipmentDeps,
): Promise<Result<ShipxRemoteShipment, AppError>> => {
  if (pastDeadline(run, deps)) return err(pendingShipment(run.shipment.status));
  const found = await client.findShipmentByReference(run.credentials, shipxReference(run.order.id));
  if (!found.ok) return found;
  if (found.value === null) {
    return err(shipxStateError('conflict', 'ShipX did not confirm the previous attempt; check Manager Paczek', { state: 'unconfirmed', attemptedAt }));
  }
  return saveRemote(run, found.value, { type: 'shipment_adopted', details: { status: found.value.status } }, deps);
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
  if (remote !== null || !shipxShipmentBought(run.shipment)) {
    const bought = remote !== null && shipxShipmentBought(remote)
      ? ok(remote)
      : await pollUntilBought(scoped, client.value, shipmentId, !createdNow, deps);
    if (!bought.ok) return bought;
    trackingNumber = bought.value.trackingNumber;
  }
  if (trackingNumber === null) return err(pendingPayment(shipmentId, null));

  const shipped = await shipOrder(ctx, { orderId: run.order.id, carrier: 'inpost', trackingNumber }, deps.ship);
  if (!shipped.ok) {
    if (shipped.error.code !== 'fulfilment_conflict') return shipped;
    return err(shipxStateError(
      'fulfilment_conflict',
      `The order was marked as shipped meanwhile; the InPost shipment ${trackingNumber} exists as well, reconcile it in Manager Paczek`,
      { state: 'manual_shipped', trackingNumber, shipxShipmentId: shipmentId },
    ));
  }
  const shipment = await deps.shipxShipments.findByOrder(run.tenantId, run.order.id);
  if (shipment === null) return err(notFound('The InPost shipment was not found'));
  return ok({ order: shipped.value.order, shipment: publicShipment(shipment) });
};

const OUTCOME_BY_STATE: Record<ShipxErrorState['state'], ShipxOperationOutcome> = {
  pending: 'pending',
  unconfirmed: 'unconfirmed',
  lost_lock: 'lost_lock',
  manual_shipped: 'bought',
  lease_held: 'failed',
  environment_mismatch: 'failed',
  organization_mismatch: 'failed',
  setup_missing: 'failed',
  receiver_invalid: 'failed',
};

const operationOutcome = (result: Result<unknown, AppError>, released: boolean): ShipxOperationOutcome => {
  if (released) return 'released';
  if (result.ok) return 'bought';
  const state = shipxErrorStateSchema.safeParse(result.error.details);
  return state.success ? OUTCOME_BY_STATE[state.data.state] : 'failed';
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
  if (settings.sender === null) {
    return err(shipxStateError('integration_not_configured', 'Save the InPost sender details in Settings → Shipping', { state: 'setup_missing', reason: 'sender_missing' }));
  }
  const selected = clientFor(settings.environment, order.value, deps.shipx);
  if (!selected.ok) return selected;

  const startedAt = deps.clock.nowIso();
  const token = deps.ids.nextId();
  const acquired = await deps.shipxShipments.acquire(tenant.value, {
    id: deps.ids.nextId(),
    orderId: order.value.id,
    token,
    environment: settings.environment,
    organizationId: credentials.value.organizationId,
    now: startedAt,
    leaseExpiredBefore: leaseExpiredBefore(startedAt),
    actorUserId: ctx.identity.userId,
  });
  if (acquired.kind === 'in_progress') {
    return err(shipxStateError('fulfilment_conflict', 'Another request is creating the InPost shipment for this order; refresh the order in a moment', { state: 'lease_held' }));
  }
  const run: ShipmentRun = {
    tenantId: tenant.value,
    actorUserId: ctx.identity.userId,
    order: order.value,
    shipping,
    service,
    sender: settings.sender,
    shipment: acquired.shipment,
    credentials: credentials.value,
    token,
    deadline: Date.parse(startedAt) + SHIPX_OPERATION_DEADLINE_MS,
    lease: { released: false },
  };
  let outcome: ShipxOperationOutcome = 'failed';
  try {
    const result = await runShipment(ctx, run, deps);
    outcome = operationOutcome(result, run.lease.released);
    return result;
  } finally {
    await deps.shipxShipments.finishOperation(tenant.value, order.value.id, token, { actorUserId: ctx.identity.userId, at: deps.clock.nowIso(), outcome });
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
  const now = deps.clock.nowIso();
  const discarded = await deps.shipxShipments.discardUnconfirmed(tenant.value, order.value.id, leaseExpiredBefore(now), { actorUserId: ctx.identity.userId, at: now });
  if (!discarded) {
    return err(shipxStateError('fulfilment_conflict', 'Another request is working on the InPost shipment for this order; refresh the order in a moment', { state: 'lease_held' }));
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
  await deps.shipxShipments.markLabelFetched(tenant.value, order.value.id, { actorUserId: ctx.identity.userId, at: deps.clock.nowIso() });
  const name = (shipment.trackingNumber ?? shipment.shipxShipmentId).replace(/[^A-Za-z0-9-]/g, '');
  return ok({ filename: `inpost-${name}.pdf`, contentType: label.value.contentType, bytes: label.value.bytes });
};
