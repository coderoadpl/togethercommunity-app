import {
  appError,
  buildShipxShipmentRequest,
  configureShipxInputSchema,
  DEFAULT_PARCEL_TEMPLATE,
  err,
  largestParcelTemplate,
  notFound,
  ok,
  orderLabel,
  orderShipmentAllowed,
  productLines,
  SHIPX_LEGACY_SECRET_KEYS,
  SHIPX_ENVIRONMENTS,
  SHIPX_OPERATION_DEADLINE_MS,
  SHIPX_OPERATION_LEASE_MS,
  SHIPX_POLL_ATTEMPTS,
  SHIPX_POLL_INTERVAL_MS,
  SHIPX_SLOT_SECRET_KEYS,
  SHIPX_STATUS_CANCELED,
  SHIPX_STATUS_UNCONFIRMED,
  shipxAttemptUnconfirmed,
  shipxBoughtLabelDetailsSchema,
  shipxCreateInputSchema,
  shipxEnvironmentForMode,
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
  type ShipxSlotSecretKeys,
  type ShipxSlotView,
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
  ShipxSettingsRepository,
  ShipxShipmentPatch,
  ShipxShipmentRecord,
  ShipxShipmentRepository,
  ShipxShipmentStep,
} from '../shipx-ports.js';
import { shipOrder, type ShipOrderDeps } from './order-fulfilment.js';
import { buildTenantSecret } from './tenant-secrets.js';

export interface ShipxSettingsDeps {
  shipxSettings: ShipxSettingsRepository;
  tenantSecrets: TenantSecretRepository;
  secretCrypto: SecretCrypto;
  ids: IdGenerator;
  clock: Clock;
}

const slotKeys = (keys: ShipxSlotSecretKeys): readonly TenantSecretKey[] => [keys.organizationId, keys.token];

type SlotFields<T> = Record<keyof ShipxSlotSecretKeys, T | null>;

const once = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let loaded: Promise<T> | null = null;
  return () => (loaded ??= load());
};

const legacyEnvironmentOf = (tenantId: string, deps: Pick<ShipxSettingsDeps, 'shipxSettings'>) =>
  once(() => deps.shipxSettings.legacyEnvironment(tenantId));

const slotFields = async <T>(
  environment: ShipxEnvironment,
  read: (key: TenantSecretKey) => Promise<T | null>,
  legacyEnvironment: () => Promise<ShipxEnvironment | null>,
): Promise<SlotFields<T>> => {
  const keys = SHIPX_SLOT_SECRET_KEYS[environment];
  const [organizationId, token] = await Promise.all([read(keys.organizationId), read(keys.token)]);
  if ((organizationId !== null && token !== null) || await legacyEnvironment() !== environment) return { organizationId, token };
  const [legacyOrganizationId, legacyToken] = await Promise.all([
    organizationId ?? read(SHIPX_LEGACY_SECRET_KEYS.organizationId),
    token ?? read(SHIPX_LEGACY_SECRET_KEYS.token),
  ]);
  return { organizationId: legacyOrganizationId, token: legacyToken };
};

const slotView = async (
  environment: ShipxEnvironment,
  secrets: readonly TenantSecret[],
  legacyEnvironment: () => Promise<ShipxEnvironment | null>,
): Promise<ShipxSlotView> => {
  const masked = async (key: TenantSecretKey) => {
    const secret = secrets.find((row) => row.key === key);
    return secret === undefined ? null : { maskedPreview: secret.maskedPreview, updatedAt: secret.updatedAt };
  };
  const { organizationId, token } = await slotFields(environment, masked, legacyEnvironment);
  return { organizationId, token, configured: organizationId !== null && token !== null };
};

const settingsView = async (tenantId: string, deps: Pick<ShipxSettingsDeps, 'shipxSettings' | 'tenantSecrets'>): Promise<ShipxSettingsView> => {
  const [sender, secrets] = await Promise.all([deps.shipxSettings.findSender(tenantId), deps.tenantSecrets.listByTenant(tenantId)]);
  const legacyEnvironment = legacyEnvironmentOf(tenantId, deps);
  const [sandbox, production] = await Promise.all([
    slotView('sandbox', secrets, legacyEnvironment),
    slotView('production', secrets, legacyEnvironment),
  ]);
  return { sender, sandbox, production };
};

export const getShipxSettings = async (
  ctx: Ctx,
  deps: Pick<ShipxSettingsDeps, 'shipxSettings' | 'tenantSecrets'>,
): Promise<Result<ShipxSettingsView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:read');
  if (!tenant.ok) return tenant;
  return ok(await settingsView(tenant.value, deps));
};

const clearSlot = async (tenantId: string, environment: ShipxEnvironment, deps: ShipxSettingsDeps): Promise<void> => {
  const legacy = await deps.shipxSettings.legacyEnvironment(tenantId);
  const keys = [
    ...slotKeys(SHIPX_SLOT_SECRET_KEYS[environment]),
    ...(legacy === environment ? slotKeys(SHIPX_LEGACY_SECRET_KEYS) : []),
  ];
  await Promise.all(keys.map((key) => deps.tenantSecrets.delete(tenantId, key)));
};

export const configureShipx = async (
  ctx: Ctx,
  input: unknown,
  deps: ShipxSettingsDeps,
): Promise<Result<ShipxSettingsView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:secret:write', { shopManagementKeyGrant: { operation: 'shipx:configure' } });
  if (!tenant.ok) return tenant;
  const parsed = configureShipxInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid InPost ShipX settings', parsed.error.flatten()));
  const slots = SHIPX_ENVIRONMENTS.flatMap((environment) => {
    const slot = parsed.data[environment];
    return slot === undefined ? [] : [{ environment, keys: SHIPX_SLOT_SECRET_KEYS[environment], ...slot }];
  });
  const mixed = slots.find((slot) => slot.clearCredentials === true && (slot.organizationId !== undefined || slot.token !== undefined));
  if (mixed !== undefined) {
    return err(validation(`Clearing the ${mixed.environment} credentials cannot be combined with new ${mixed.environment} credentials`));
  }
  const written = slots.flatMap((slot) => [
    ...(slot.organizationId === undefined ? [] : [buildTenantSecret(tenant.value, slot.keys.organizationId, slot.organizationId, deps)]),
    ...(slot.token === undefined ? [] : [buildTenantSecret(tenant.value, slot.keys.token, slot.token, deps)]),
  ]);
  if (parsed.data.sender !== undefined) await deps.shipxSettings.saveSender(tenant.value, parsed.data.sender);
  for (const slot of slots) {
    if (slot.clearCredentials === true) await clearSlot(tenant.value, slot.environment, deps);
  }
  if (written.length > 0) await deps.tenantSecrets.upsertMany(tenant.value, written);
  return ok(await settingsView(tenant.value, deps));
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

const orderEnvironment = (order: OrderListItem): ShipxEnvironment => shipxEnvironmentForMode(order.mode === 'test' ? 'test' : 'live');

const credentialsMissing = (environment: ShipxEnvironment): AppError => shipxStateError(
  'integration_not_configured',
  `Save the InPost ShipX ${environment} organization id and token in Settings → Shipping`,
  { state: 'setup_missing', reason: 'credentials_missing', environment },
);

const resolveCredentials = async (
  tenantId: string,
  environment: ShipxEnvironment,
  deps: Pick<ShipxOrderDeps, 'secrets' | 'shipxSettings'>,
): Promise<Result<ShipxCredentials, AppError>> => {
  const resolved = async (key: TenantSecretKey): Promise<Result<string, AppError> | null> => {
    const value = await deps.secrets.resolve(tenantId, key);
    return !value.ok && value.error.code === 'not_found' ? null : value;
  };
  const { organizationId, token } = await slotFields(environment, resolved, legacyEnvironmentOf(tenantId, deps));
  if (organizationId?.ok !== true || token?.ok !== true) return err(credentialsMissing(environment));
  return ok({ organizationId: organizationId.value, token: token.value, environment });
};

const credentialsPresent = async (
  tenantId: string,
  environment: ShipxEnvironment,
  deps: Pick<ShipxOrderDeps, 'tenantSecrets' | 'shipxSettings'>,
): Promise<boolean> => {
  const rows = await slotFields(environment, (key) => deps.tenantSecrets.findByKey(tenantId, key), legacyEnvironmentOf(tenantId, deps));
  return rows.organizationId !== null && rows.token !== null;
};

const clientOf = (clients: ShipxClients): ShipxClient => clients.real ?? clients.fake;

const storedCredentials = (shipment: ShipxShipmentRecord, current: ShipxCredentials): Result<ShipxCredentials, AppError> => {
  if (shipment.environment !== current.environment) {
    return err(shipxStateError(
      'conflict',
      `The InPost shipment was created in the ShipX ${shipment.environment} environment, but this order uses the ${current.environment} connection; finish the shipment in Manager Paczek`,
      { state: 'environment_mismatch', environment: shipment.environment, settingsEnvironment: current.environment },
    ));
  }
  if (shipment.organizationId !== current.organizationId) {
    return err(shipxStateError(
      'conflict',
      `The InPost shipment belongs to a different ShipX organization than the ${current.environment} connection in the settings; restore it or finish the shipment in Manager Paczek`,
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
  const physical = lines.filter((line) => line.productType === 'physical');
  const sized = physical.length === 0 ? lines : physical;
  const productIds = [...new Set(sized.length === 0 ? [order.productId] : sized.map((line) => line.productId))];
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
  deps: ShipxOrderDeps,
): Promise<ShipxShipmentRecord> => {
  if (shipment.shipxShipmentId === null || shipxShipmentBought(shipment)) return shipment;
  const current = await resolveCredentials(tenantId, orderEnvironment(order), deps);
  const credentials = current.ok ? storedCredentials(shipment, current.value) : current;
  if (!credentials.ok) return shipment;
  const remote = await clientOf(deps.shipx).getShipment(credentials.value, shipment.shipxShipmentId);
  if (!remote.ok) return shipment;
  const now = deps.clock.nowIso();
  return await deps.shipxShipments.refreshUnclaimed(tenantId, order.id, leaseExpiredBefore(now), shipment, remotePatch(remote.value, now), actorUserId) ?? shipment;
};

type ShipxViewDeps = Pick<ShipxOrderDeps, 'orderDetails' | 'products' | 'shipxShipments' | 'tenantSecrets' | 'shipxSettings'>;

interface OrderShipmentState {
  order: OrderListItem;
  view: Omit<ShipxOrderView, 'shipment'>;
  stored: ShipxShipmentRecord | null;
  credentials: boolean;
}

const orderShipmentState = async (tenantId: string, input: unknown, deps: ShipxViewDeps): Promise<Result<OrderShipmentState, AppError>> => {
  const parsed = shipxOrderInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order', parsed.error.flatten()));
  const order = await loadOrder(tenantId, parsed.data.orderId, deps);
  if (!order.ok) return order;
  const service = order.value.shipping == null ? null : shipxServiceFor(order.value.shipping);
  const environment = orderEnvironment(order.value);
  const [stored, parcelTemplate, credentials] = await Promise.all([
    deps.shipxShipments.findByOrder(tenantId, order.value.id),
    orderParcelTemplate(tenantId, order.value, deps),
    credentialsPresent(tenantId, environment, deps),
  ]);
  const reason = service === null
    ? 'not_inpost'
    : order.value.fulfilmentStatus !== 'to_pack'
      ? 'not_to_pack'
      : credentials ? null : 'credentials_missing';
  return ok({ order: order.value, view: { available: reason === null, reason, environment, service, parcelTemplate }, stored, credentials });
};

const orderShipmentView = (state: OrderShipmentState, shipment: ShipxShipmentRecord | null): ShipxOrderView =>
  ({ ...state.view, shipment: shipment === null ? null : { ...publicShipment(shipment), operationClaimed: shipment.operationToken !== null } });

export const getInpostShipment = async (
  ctx: Ctx,
  input: unknown,
  deps: ShipxViewDeps,
): Promise<Result<ShipxOrderView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;
  const state = await orderShipmentState(tenant.value, input, deps);
  if (!state.ok) return state;
  return ok(orderShipmentView(state.value, state.value.stored));
};

export const refreshInpostShipment = async (
  ctx: Ctx,
  input: unknown,
  deps: ShipxOrderDeps,
): Promise<Result<ShipxOrderView, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const state = await orderShipmentState(tenant.value, input, deps);
  if (!state.ok) return state;
  const { order, stored, credentials } = state.value;
  const shipment = stored === null || !credentials ? stored : await refreshedShipment(tenant.value, ctx.identity.userId, order, stored, deps);
  return ok(orderShipmentView(state.value, shipment));
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
  sender: ShipxSender | null;
  shipment: ShipxShipmentRecord;
  credentials: ShipxCredentials;
  parcelTemplate: ParcelTemplate | null;
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
    if (latest.status === SHIPX_STATUS_CANCELED) return err(labelCanceled(latest.trackingNumber, shipmentId));
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

const labelCanceled = (trackingNumber: string | null, shipxShipmentId: string): AppError => shipxStateError(
  'conflict',
  `The InPost label${trackingNumber === null ? '' : ` ${trackingNumber}`} was canceled in Manager Paczek; create a new label there and mark the order as shipped by hand`,
  { state: 'label_canceled', trackingNumber, shipxShipmentId },
);

const createRemote = async (run: ShipmentRun, client: ShipxClient, deps: CreateInpostShipmentDeps): Promise<Result<ShipxRemoteShipment, AppError>> => {
  const request = buildShipxShipmentRequest({
    orderId: run.order.id,
    memberEmail: run.order.memberEmail,
    shipping: run.shipping,
    sender: run.sender,
    parcelTemplate: run.parcelTemplate ?? await orderParcelTemplate(run.tenantId, run.order, deps),
  });
  if (!request.ok) return releaseAttempt(run, request, deps);
  if (pastDeadline(run, deps)) return releaseAttempt(run, err(pendingShipment(run.shipment.status)), deps);
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
  const found = await client.findShipmentByReference(run.credentials, shipxReference(run.order.id), attemptedAt);
  if (!found.ok) return found;
  if (found.value === null) {
    return err(shipxStateError('conflict', 'ShipX did not confirm the previous attempt; check Manager Paczek', { state: 'unconfirmed', attemptedAt }));
  }
  return saveRemote(run, found.value, { type: 'shipment_adopted', details: { status: found.value.status } }, deps);
};

const orderAfterLabelPurchase = async (
  run: ShipmentRun,
  label: { trackingNumber: string; shipxShipmentId: string },
  orderDetails: CreateInpostShipmentDeps['orderDetails'],
  dispatchError?: AppError,
): Promise<Result<{ order: OrderListItem }, AppError>> => {
  const order = await orderDetails.findById(run.tenantId, run.order.id);
  if (order === null) return err(dispatchError ?? notFound('Order was not found'));
  if (order.fulfilmentStatus === 'to_pack') return dispatchError === undefined ? ok({ order }) : err(dispatchError);
  if (order.fulfilmentStatus === 'shipped') {
    if (order.shipment?.carrier === 'inpost' && order.shipment.trackingNumber.trim() === label.trackingNumber.trim()) return ok({ order });
    return err(shipxStateError(
      'fulfilment_conflict',
      `The order was marked as shipped meanwhile; the InPost shipment ${label.trackingNumber} exists as well, reconcile it in Manager Paczek`,
      { ...label, state: 'manual_shipped' },
    ));
  }
  return err(appError('conflict', `The order left the packing list meanwhile; cancel the InPost label ${label.trackingNumber} in Manager Paczek`, label));
};

const runShipment = async (
  ctx: Ctx,
  run: ShipmentRun,
  markShipped: boolean,
  deps: CreateInpostShipmentDeps,
): Promise<Result<{ order: OrderListItem; shipment: ShipxShipment }, AppError>> => {
  const credentials = storedCredentials(run.shipment, run.credentials);
  if (!credentials.ok) return credentials;
  const client = clientOf(deps.shipx);
  const scoped = { ...run, credentials: credentials.value };

  let shipmentId = run.shipment.shipxShipmentId;
  let remote: ShipxRemoteShipment | null = null;
  let createdNow = false;
  if (shipmentId === null) {
    const attemptedAt = run.shipment.createAttemptedAt;
    const obtained = shipxAttemptUnconfirmed(run.shipment) && attemptedAt !== null
      ? await reconcileRemote(scoped, attemptedAt, client, deps)
      : await createRemote(scoped, client, deps);
    if (!obtained.ok) return obtained;
    createdNow = !shipxAttemptUnconfirmed(run.shipment);
    remote = obtained.value;
    shipmentId = remote.id;
  }

  const known = remote ?? run.shipment;
  if (known.status === SHIPX_STATUS_CANCELED) return err(labelCanceled(known.trackingNumber, shipmentId));
  let labelShipment: Pick<ShipxShipment, 'status' | 'trackingNumber'> = run.shipment;
  if (remote !== null || !shipxShipmentBought(run.shipment)) {
    const bought = remote !== null && shipxShipmentBought(remote)
      ? ok(remote)
      : await pollUntilBought(scoped, client, shipmentId, !createdNow, deps);
    if (!bought.ok) return bought;
    labelShipment = bought.value;
  }
  const { trackingNumber } = labelShipment;
  if (trackingNumber === null) return err(pendingPayment(shipmentId, null));
  if (labelShipment.status === SHIPX_STATUS_CANCELED) return err(labelCanceled(trackingNumber, shipmentId));

  const dispatch = markShipped ? await shipOrder(ctx, { orderId: run.order.id, carrier: 'inpost', trackingNumber }, deps.ship) : null;
  const order = dispatch?.ok === true
    ? dispatch
    : await orderAfterLabelPurchase(run, { trackingNumber, shipxShipmentId: shipmentId }, deps.orderDetails, dispatch?.error);
  if (!order.ok) return order;
  const shipment = await deps.shipxShipments.findByOrder(run.tenantId, run.order.id);
  if (shipment === null) return err(notFound('The InPost shipment was not found'));
  return ok({ order: { ...order.value.order, label: orderLabel(shipment) }, shipment: publicShipment(shipment) });
};

const OUTCOME_BY_STATE: Record<ShipxErrorState['state'], ShipxOperationOutcome> = {
  pending: 'pending',
  unconfirmed: 'unconfirmed',
  lost_lock: 'lost_lock',
  manual_shipped: 'bought',
  label_canceled: 'failed',
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
  if (state.success) return OUTCOME_BY_STATE[state.data.state];
  if (result.error.code === 'conflict' && shipxBoughtLabelDetailsSchema.safeParse(result.error.details).success) return 'bought';
  return 'failed';
};

export const createInpostShipment = async (
  ctx: Ctx,
  input: unknown,
  deps: CreateInpostShipmentDeps,
): Promise<Result<{ order: OrderListItem; shipment: ShipxShipment }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const parsed = shipxCreateInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid InPost shipment request', parsed.error.flatten()));
  const order = await loadOrder(tenant.value, parsed.data.orderId, deps);
  if (!order.ok) return order;
  const allowed = orderShipmentAllowed(order.value);
  if (!allowed.ok) return allowed;
  const shipping = order.value.shipping;
  const service = shipping == null ? null : shipxServiceFor(shipping);
  if (shipping == null || service === null) return err(validation('The order does not use an InPost delivery option'));
  const environment = orderEnvironment(order.value);
  const credentials = await resolveCredentials(tenant.value, environment, deps);
  if (!credentials.ok) return credentials;
  const sender = await deps.shipxSettings.findSender(tenant.value);

  const startedAt = deps.clock.nowIso();
  const token = deps.ids.nextId();
  const acquired = await deps.shipxShipments.acquire(tenant.value, {
    id: deps.ids.nextId(),
    orderId: order.value.id,
    token,
    environment,
    organizationId: credentials.value.organizationId,
    now: startedAt,
    leaseExpiredBefore: leaseExpiredBefore(startedAt),
    actorUserId: ctx.identity.userId,
    orderShippable: (locked) => locked !== null && orderShipmentAllowed(locked).ok,
  });
  if (acquired.kind === 'order_changed') {
    return err(appError('conflict', 'The order is no longer waiting to be packed, for example because a staff refund took it off the packing list; refresh the order'));
  }
  if (acquired.kind === 'in_progress') {
    return err(shipxStateError('fulfilment_conflict', 'Another request is creating the InPost shipment for this order; refresh the order in a moment', { state: 'lease_held' }));
  }
  const run: ShipmentRun = {
    tenantId: tenant.value,
    actorUserId: ctx.identity.userId,
    order: order.value,
    shipping,
    service,
    sender,
    shipment: acquired.shipment,
    credentials: credentials.value,
    parcelTemplate: parsed.data.parcelTemplate ?? null,
    token,
    deadline: Date.parse(startedAt) + SHIPX_OPERATION_DEADLINE_MS,
    lease: { released: false },
  };
  let outcome: ShipxOperationOutcome = 'failed';
  try {
    const current = await loadOrder(tenant.value, order.value.id, deps);
    if (!current.ok) return current;
    if (current.value.shipping == null) return err(validation('Order has no delivery details'));
    const result = await runShipment(ctx, { ...run, order: current.value, shipping: current.value.shipping }, parsed.data.markShipped, deps);
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
  if (shipment?.shipxShipmentId !== null) return err(validation('The order has no unconfirmed InPost attempt to discard'));
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
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const parsed = shipxOrderInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid order', parsed.error.flatten()));
  const order = await loadOrder(tenant.value, parsed.data.orderId, deps);
  if (!order.ok) return order;
  const shipment = await deps.shipxShipments.findByOrder(tenant.value, order.value.id);
  if (shipment?.shipxShipmentId == null) return err(notFound('The order has no InPost shipment'));
  if (shipment.status === SHIPX_STATUS_CANCELED) return err(validation('The InPost label was canceled in Manager Paczek'));
  const current = await resolveCredentials(tenant.value, orderEnvironment(order.value), deps);
  if (!current.ok) return current;
  const credentials = storedCredentials(shipment, current.value);
  if (!credentials.ok) return credentials;
  const label = await clientOf(deps.shipx).fetchLabel(credentials.value, shipment.shipxShipmentId);
  if (!label.ok) return label;
  await deps.shipxShipments.markLabelFetched(tenant.value, order.value.id, { actorUserId: ctx.identity.userId, at: deps.clock.nowIso() });
  const name = (shipment.trackingNumber ?? shipment.shipxShipmentId).replace(/[^A-Za-z0-9-]/g, '');
  return ok({ filename: `inpost-${name}.pdf`, contentType: label.value.contentType, bytes: label.value.bytes });
};
