import {
  adoptStripeSubscriptionInputSchema, adoptionRefusal, err, listStripeSubscriptionsInputSchema,
  normalizeEmail, notFound, ok, productPriceSchema, validation,
  type AdoptStripeSubscriptionInput, type AdoptStripeSubscriptionResult,
  type AppError, type ListStripeSubscriptionsInput, type Member, type MemberSubscription,
  type Product, type ProductPrice, type Result, type StripeSubscriptionListEntry, type StripeSubscriptionSnapshot,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  Clock, IdGenerator, MemberSubscriptionRepository, PaymentProvider,
  StripeWebhookOwnershipReader, SubscriptionAdoptionRepositories, SubscriptionAdoptionTransaction,
} from '../ports.js';
import { requireLiveMember } from './member-status.js';

export interface StripeSubscriptionAdoptionDeps {
  payment: Pick<PaymentProvider, 'retrieveStripeSubscription' | 'listStripeSubscriptions'>;
  stripeWebhookOwnership: StripeWebhookOwnershipReader;
  subscriptionAdoptionTransaction: SubscriptionAdoptionTransaction;
  clock: Clock;
  ids: IdGenerator;
}

type RemoteOwnership = Pick<StripeSubscriptionListEntry, 'id' | 'customerId' | 'metadataTenantId'>;

const hasForeignOwner = (tenantId: string, remote: RemoteOwnership, ownership: StripeWebhookOwnershipReader) =>
  ownership.hasForeignOwner(tenantId, { subscription: remote.id, customer: remote.customerId });

const adoptableByTenant = async (
  tenantId: string,
  remote: RemoteOwnership,
  ownership: StripeWebhookOwnershipReader,
): Promise<boolean> => (remote.metadataTenantId === null || remote.metadataTenantId === tenantId)
  && !await hasForeignOwner(tenantId, remote, ownership);

const foreignOwnerRefusal = () =>
  err(adoptionRefusal('conflict', 'conflict', 'Stripe subscription belongs to another workspace'));

type AdoptionRepositories = SubscriptionAdoptionRepositories
  & Pick<StripeSubscriptionAdoptionDeps, 'clock' | 'ids'>;

interface GrantOutcome {
  grantId: string;
  grantCreated: boolean;
  grantExtended: boolean;
}

const resolvePrice = async (
  tenantId: string,
  productId: string,
  priceId: string | undefined,
  remote: StripeSubscriptionSnapshot,
  now: string,
  deps: AdoptionRepositories,
): Promise<Result<{ price: ProductPrice; created: boolean }, AppError>> => {
  const prices = await deps.prices.listByProduct(tenantId, productId);
  const selected = priceId === undefined
    ? prices.find((price) => price.providerPriceId === remote.price.id)
    : prices.find((price) => price.id === priceId);
  if (priceId !== undefined && selected === undefined) {
    return err(adoptionRefusal('validation', 'price', 'Price does not belong to the selected product'));
  }
  if (selected !== undefined) {
    if (selected.kind !== 'recurring') {
      return err(adoptionRefusal('validation', 'price', 'Only a recurring price can carry a subscription'));
    }
    if ((selected.providerPriceId ?? null) !== null && selected.providerPriceId !== remote.price.id) {
      return err(adoptionRefusal('validation', 'price', 'Price belongs to a different Stripe price'));
    }
    return ok({ price: selected, created: false });
  }
  const price = productPriceSchema.parse({
    id: deps.ids.nextId(), tenantId, productId, kind: 'recurring',
    interval: remote.price.interval, intervalCount: remote.price.intervalCount,
    amountCents: remote.price.amountCents, currency: remote.price.currency,
    providerPriceId: remote.price.id, imported: true, active: false, createdAt: now,
  });
  await deps.prices.create(tenantId, price);
  return ok({ price, created: true });
};

const reconcileGrant = async (
  tenantId: string,
  memberId: string,
  productId: string,
  periodEnd: string,
  now: string,
  deps: AdoptionRepositories,
): Promise<GrantOutcome> => {
  const grant = await deps.grants.findGrant(tenantId, memberId, productId);
  if (grant === null) {
    const grantId = deps.ids.nextId();
    await deps.grants.createGrant(tenantId, {
      id: grantId, tenantId, memberId, productId, source: 'stripe', mode: 'live',
      startsAt: now, expiresAt: periodEnd, legacyId: null, createdAt: now,
    });
    return { grantId, grantCreated: true, grantExtended: false };
  }
  const grantExtended = grant.expiresAt !== null && grant.expiresAt < periodEnd;
  if (grantExtended || grant.startsAt > now) {
    await deps.grants.setGrantWindow(tenantId, grant.id, {
      startsAt: grant.startsAt > now ? now : grant.startsAt,
      expiresAt: grantExtended ? periodEnd : grant.expiresAt,
      occurredAt: now,
    });
  }
  return { grantId: grant.id, grantCreated: false, grantExtended };
};

const reconcileAdoption = async (
  tenantId: string,
  input: AdoptStripeSubscriptionInput,
  existing: MemberSubscription,
  member: Member,
  product: Product,
  remote: StripeSubscriptionSnapshot,
  deps: AdoptionRepositories,
): Promise<Result<AdoptStripeSubscriptionResult, AppError>> => {
  if (existing.memberId !== member.id || existing.productId !== product.id
    || (input.priceId !== undefined && input.priceId !== existing.priceId)) {
    return err(adoptionRefusal('conflict', 'conflict', 'Stripe subscription is already assigned to another member, product or price'));
  }
  const now = deps.clock.nowIso();
  const known = await deps.prices.findById(tenantId, existing.priceId);
  const resolved = known === null
    ? await resolvePrice(tenantId, product.id, undefined, remote, now, deps)
    : ok({ price: known, created: false });
  if (!resolved.ok) return resolved;
  if (member.externalCustomerIds['stripe'] === undefined) {
    await deps.members.recordStripeCustomerId(tenantId, member.id, remote.customerId);
  }
  const billable: Partial<Pick<MemberSubscription, 'status' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'>> =
    remote.status === 'active' || remote.status === 'past_due'
      ? { status: remote.status, currentPeriodEnd: remote.currentPeriodEnd, cancelAtPeriodEnd: remote.cancelAtPeriodEnd }
      : {};
  const refreshed: MemberSubscription = {
    ...existing, priceId: resolved.value.price.id, ...billable, updatedAt: now,
  };
  const drifted = refreshed.priceId !== existing.priceId || refreshed.status !== existing.status
    || refreshed.currentPeriodEnd !== existing.currentPeriodEnd
    || refreshed.cancelAtPeriodEnd !== existing.cancelAtPeriodEnd;
  if (drifted) await deps.subscriptions.update(tenantId, refreshed);
  const subscription = drifted ? refreshed : existing;
  const grant = await reconcileGrant(
    tenantId, subscription.memberId, subscription.productId, subscription.currentPeriodEnd, now, deps,
  );
  return ok({ subscription, price: resolved.value.price, subscriptionCreated: false,
    priceCreated: resolved.value.created, ...grant });
};

const saveAdoption = async (
  tenantId: string,
  input: AdoptStripeSubscriptionInput,
  remote: StripeSubscriptionSnapshot,
  deps: AdoptionRepositories,
): Promise<Result<AdoptStripeSubscriptionResult, AppError>> => {
  const found = input.memberId === undefined
    ? await deps.members.findByEmail(tenantId, normalizeEmail(input.email ?? ''))
    : await deps.members.findById(tenantId, input.memberId);
  if (found === null && input.memberId === undefined) {
    return err(notFound('No member with that e-mail address in this tenant'));
  }
  const member = requireLiveMember(found, input.memberId ?? '');
  if (!member.ok) return member;
  const product = await deps.products.findById(tenantId, input.productId);
  if (product === null) return err(notFound('Product was not found'));
  if (!product.published) return err(validation('Product must be published before adopting a subscription'));
  const existing = await deps.subscriptions.findByProviderSubscriptionId(tenantId, input.subscriptionId);
  if (existing !== null) {
    return reconcileAdoption(tenantId, input, existing, member.value, product, remote, deps);
  }
  if (remote.status !== 'active' && remote.status !== 'past_due') {
    return err(adoptionRefusal('validation', 'status', 'Only active or past_due Stripe subscriptions can be adopted'));
  }
  if (input.allowEmailMismatch !== true && (remote.customerEmail === null
    || normalizeEmail(remote.customerEmail) !== normalizeEmail(member.value.email))) {
    return err(adoptionRefusal('validation', 'email-mismatch', 'Stripe customer email does not match the member'));
  }
  if (!await deps.members.recordStripeCustomerId(tenantId, member.value.id, remote.customerId)) {
    return err(adoptionRefusal('conflict', 'conflict', 'Member is linked to a different Stripe customer'));
  }
  const now = deps.clock.nowIso();
  const resolved = await resolvePrice(tenantId, product.id, input.priceId, remote, now, deps);
  if (!resolved.ok) return resolved;
  const subscription: MemberSubscription = {
    id: deps.ids.nextId(), tenantId, memberId: member.value.id, productId: product.id,
    priceId: resolved.value.price.id, provider: 'stripe', providerSubscriptionId: remote.id,
    status: remote.status, currentPeriodEnd: remote.currentPeriodEnd, mode: 'live',
    cancelAtPeriodEnd: remote.cancelAtPeriodEnd, couponId: null,
    couponDiscountCents: 0, couponRecurringDuration: null, createdAt: now, updatedAt: now,
  };
  await deps.subscriptions.create(tenantId, subscription);
  const grant = await reconcileGrant(
    tenantId, member.value.id, product.id, remote.currentPeriodEnd, now, deps,
  );
  await deps.memberEvents.append(tenantId, {
    id: deps.ids.nextId(), memberId: member.value.id, type: 'subscription-adopted',
    payload: { subscriptionId: subscription.id, providerSubscriptionId: remote.id,
      productId: product.id, priceId: resolved.value.price.id }, occurredAt: now,
  });
  return ok({ subscription, price: resolved.value.price, subscriptionCreated: true,
    priceCreated: resolved.value.created, ...grant });
};

export const m2mAdoptStripeSubscription = async (
  tenantId: string,
  input: AdoptStripeSubscriptionInput,
  deps: StripeSubscriptionAdoptionDeps,
): Promise<Result<AdoptStripeSubscriptionResult, AppError>> => {
  const parsed = adoptStripeSubscriptionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid subscription adoption payload'));
  if (deps.payment.retrieveStripeSubscription === undefined) return err(validation('Stripe subscription adoption is unavailable'));
  const remote = await deps.payment.retrieveStripeSubscription(tenantId, parsed.data.subscriptionId);
  if (!remote.ok) return remote;
  if (remote.value.id !== parsed.data.subscriptionId) return err(validation('Stripe returned a different subscription'));
  if (!await adoptableByTenant(tenantId, remote.value, deps.stripeWebhookOwnership)) return foreignOwnerRefusal();
  const stripe = { subscriptionId: remote.value.id, customerId: remote.value.customerId };
  return deps.subscriptionAdoptionTransaction.run(tenantId, stripe, async (repositories) =>
    await hasForeignOwner(tenantId, remote.value, repositories.stripeWebhookOwnership)
      ? foreignOwnerRefusal()
      : saveAdoption(tenantId, parsed.data, remote.value, { ...repositories, clock: deps.clock, ids: deps.ids }));
};

export const adoptStripeSubscription = async (
  ctx: Ctx,
  input: AdoptStripeSubscriptionInput,
  deps: StripeSubscriptionAdoptionDeps,
): Promise<Result<AdoptStripeSubscriptionResult, AppError>> => {
  const tenant = authorizeTenant(ctx, 'subscriptions:adopt');
  if (!tenant.ok) return tenant;
  return m2mAdoptStripeSubscription(tenant.value, input, deps);
};

interface ListStripeSubscriptionsDeps {
  payment: Pick<PaymentProvider, 'retrieveStripeSubscription' | 'listStripeSubscriptions'>;
  subscriptions: Pick<MemberSubscriptionRepository, 'listKnownProviderSubscriptionIds'>;
  stripeWebhookOwnership: StripeWebhookOwnershipReader;
}

export const m2mListStripeSubscriptions = async (
  tenantId: string,
  input: ListStripeSubscriptionsInput,
  deps: ListStripeSubscriptionsDeps,
) => {
  const parsed = listStripeSubscriptionsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid Stripe subscription query'));
  if (deps.payment.listStripeSubscriptions === undefined) return err(validation('Stripe subscription listing is unavailable'));
  const remote = await deps.payment.listStripeSubscriptions(tenantId, parsed.data);
  if (!remote.ok) return remote;
  const owned = await Promise.all(remote.value.subscriptions.map((subscription) =>
    adoptableByTenant(tenantId, subscription, deps.stripeWebhookOwnership)));
  const visible = remote.value.subscriptions.filter((_subscription, index) => owned[index] === true);
  const adopted = new Set(await deps.subscriptions.listKnownProviderSubscriptionIds(
    tenantId, visible.map((subscription) => subscription.id),
  ));
  const subscriptions = visible.map(({ id, status, providerPriceId }) => ({
    id, status, providerPriceId, adopted: adopted.has(id),
  }));
  return ok({ subscriptions: parsed.data.unadopted === true ? subscriptions.filter((subscription) => !subscription.adopted) : subscriptions,
    nextCursor: remote.value.nextCursor });
};

export const listStripeSubscriptions = async (
  ctx: Ctx,
  input: ListStripeSubscriptionsInput,
  deps: ListStripeSubscriptionsDeps,
) => {
  const tenant = authorizeTenant(ctx, 'subscriptions:read');
  if (!tenant.ok) return tenant;
  return m2mListStripeSubscriptions(tenant.value, input, deps);
};
