import {
  appError,
  customDomainRecords,
  CUSTOM_DOMAIN_ADDS_PER_HOUR,
  CUSTOM_DOMAIN_CHECKS_PER_HOUR,
  err,
  MAX_CUSTOM_DOMAINS_PER_TENANT,
  normalizeCustomDomain,
  notFound,
  ok,
  rateLimited,
  tenantDomainStatus,
  validation,
  type AppError,
  type Notification,
  type Result,
  type TenantDomain,
  type TenantDomainEventKind,
  type TenantRouting,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  DomainProvisioner,
  IdGenerator,
  NotificationRepository,
  PublicRateLimitRepository,
  RealtimeBusPort,
  TenantAccessReader,
  TenantDomainEventRepository,
  TenantDomainRepository,
} from '../ports.js';
import { tenantUrl, type TenantUrlDeps } from '../tenant-url.js';

export interface TenantRoutingDeps {
  tenantDomains: TenantDomainRepository;
  routing: TenantUrlDeps;
  customDomainTarget: string;
}

export interface TenantDomainDeps extends TenantRoutingDeps {
  domainEvents: TenantDomainEventRepository;
  provisioner: DomainProvisioner;
  rateLimit: PublicRateLimitRepository;
  notifications: NotificationRepository;
  tenantAccess: TenantAccessReader;
  realtimeBus: RealtimeBusPort;
  ids: IdGenerator;
  clock: Clock;
}

const HOUR_MS = 60 * 60 * 1000;
/** One message for every rejected attach: a specific one would report what other workspaces hold. */
const DOMAIN_UNAVAILABLE = 'This domain cannot be connected';
const MISCONFIGURED_ALERT_AFTER_MS = 24 * HOUR_MS;
const TENANT_DOMAIN_CHECK_BATCH = 25;
/**
 * A refresh spends up to five provider calls, so only one deadline for the whole
 * operation keeps it under the serverless `maxDuration` of 30 s.
 */
export const TENANT_DOMAIN_REFRESH_BUDGET_MS = 12_000;
export const TENANT_DOMAIN_CHECK_TIME_BUDGET_MS = 20_000;

const routingView = (
  tenantSlug: string | null,
  domains: TenantDomain[],
  deps: TenantRoutingDeps,
): TenantRouting => {
  const custom = domains.filter((domain) => domain.kind === 'custom');
  return {
    tenantHost: new URL(tenantUrl(tenantSlug, '/', deps.routing)).host,
    customDomains: custom.map((domain) => ({
      domain: domain.domain,
      verified: domain.verified,
      status: tenantDomainStatus(domain),
      records: customDomainRecords({
        domain: domain.domain,
        target: deps.customDomainTarget,
        verification: domain.verification,
      }),
      lastCheckedAt: domain.lastCheckedAt,
      lastError: domain.lastError,
    })),
    customDomainTarget: deps.customDomainTarget,
    canAddCustomDomain: custom.length < MAX_CUSTOM_DOMAINS_PER_TENANT,
  };
};

const readRouting = async (
  tenantId: string,
  tenantSlug: string | null,
  deps: TenantRoutingDeps,
): Promise<TenantRouting> =>
  routingView(tenantSlug, await deps.tenantDomains.listByTenant(tenantId), deps);

export const getTenantRouting = async (
  ctx: Ctx,
  deps: TenantRoutingDeps,
): Promise<Result<TenantRouting, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:domain:read');
  if (!tenant.ok) return tenant;
  return ok(await readRouting(tenant.value, ctx.identity.tenantSlug, deps));
};

const appendEvent = async (
  deps: TenantDomainDeps,
  input: {
    tenantId: string;
    domain: string;
    kind: TenantDomainEventKind;
    actorUserId: string | null;
    detail: string | null;
  },
): Promise<void> => {
  await deps.domainEvents.append(input.tenantId, {
    id: deps.ids.nextId(),
    tenantId: input.tenantId,
    domain: input.domain,
    kind: input.kind,
    actorUserId: input.actorUserId,
    detail: input.detail,
    at: deps.clock.nowIso(),
  });
};

const notifyOwners = async (
  deps: TenantDomainDeps,
  input: {
    tenantId: string;
    domainId: string;
    domain: string;
    kind: Extract<Notification['kind'], 'tenant-domain-verified' | 'tenant-domain-error'>;
  },
): Promise<boolean> => {
  const owners = (await deps.tenantAccess.listStaffForTenant(input.tenantId))
    .filter((staff) => staff.staffRole === 'owner');
  if (owners.length === 0) return false;
  const createdAt = deps.clock.nowIso();
  const inserted = await deps.notifications.insertMany(
    input.tenantId,
    owners.map((owner) => ({
      id: deps.ids.nextId(),
      tenantId: input.tenantId,
      recipientUserId: owner.userId,
      kind: input.kind,
      payload: {
        rootPostId: null,
        postId: null,
        contextKind: 'tenant' as const,
        contextId: null,
        courseId: null,
        eventId: null,
        domain: input.domain,
        lessonName: '',
        authorDisplay: null,
        authorAvatarUrl: null,
        snippet: '',
      },
      sourceKey: `${input.kind}:${input.domainId}`,
      readAt: null,
      createdAt,
    })),
  );
  for (const notification of inserted) {
    deps.realtimeBus.publish({
      kind: 'notification',
      tenantId: notification.tenantId,
      recipientUserId: notification.recipientUserId,
      notificationId: notification.id,
      notificationKind: notification.kind,
      createdAt: notification.createdAt,
    });
  }
  return inserted.length > 0;
};

const findCustomDomain = async (
  tenantId: string,
  domain: string,
  deps: TenantRoutingDeps,
): Promise<TenantDomain | null> =>
  (await deps.tenantDomains.listByTenant(tenantId))
    .find((row) => row.kind === 'custom' && row.domain === domain.trim().toLowerCase()) ?? null;

const claimHourlyBudget = async (
  input: { scope: string; tenantId: string; limit: number },
  deps: TenantDomainDeps,
): Promise<boolean> => {
  const now = Date.parse(deps.clock.nowIso());
  const windowStartedAt = now - (now % HOUR_MS);
  return deps.rateLimit.claim({
    scope: input.scope,
    key: input.tenantId,
    windowStartedAt: new Date(windowStartedAt).toISOString(),
    expiresAt: new Date(windowStartedAt + 2 * HOUR_MS).toISOString(),
    limit: input.limit,
  });
};

/**
 * The host is attached at the provider before any row references it, so a failing
 * insert would leave it attached forever — only an existing row is ever detached.
 * A `null` insert is not such a case: another workspace won the uniqueness race and
 * its row now references the same attachment.
 */
const insertOrDetach = async (
  deps: TenantDomainDeps,
  row: TenantDomain,
): Promise<TenantDomain | null> => {
  try {
    return await deps.tenantDomains.insert(row.tenantId, row);
  } catch (cause) {
    await deps.provisioner.remove(row.domain);
    throw cause;
  }
};

export const addTenantDomain = async (
  ctx: Ctx,
  input: { domain: string },
  deps: TenantDomainDeps,
): Promise<Result<TenantRouting, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const normalized = normalizeCustomDomain(input.domain, deps.routing.baseDomain);
  if (!normalized.ok) return normalized;
  const domain = normalized.value;
  if (domain === new URL(deps.routing.appBaseUrl).hostname) {
    return err(validation('That address already belongs to the platform'));
  }
  const owned = await deps.tenantDomains.listByTenant(tenant.value);
  if (owned.filter((row) => row.kind === 'custom').length >= MAX_CUSTOM_DOMAINS_PER_TENANT) {
    return err(appError(
      'conflict',
      `A workspace can hold at most ${String(MAX_CUSTOM_DOMAINS_PER_TENANT)} custom domains`,
    ));
  }
  // Claimed before the cross-tenant lookup so a caller cannot probe an unbounded
  // number of names for the ones other workspaces hold.
  const budget = await claimHourlyBudget(
    { scope: 'tenant-domain-add', tenantId: tenant.value, limit: CUSTOM_DOMAIN_ADDS_PER_HOUR },
    deps,
  );
  if (!budget) {
    return err(rateLimited('Too many domains added in the last hour. Try again later.'));
  }
  if (await deps.tenantDomains.findAnyByDomain(domain) !== null) {
    return err(appError('conflict', DOMAIN_UNAVAILABLE));
  }
  const added = await deps.provisioner.add(domain, {
    signal: AbortSignal.timeout(TENANT_DOMAIN_REFRESH_BUDGET_MS),
  });
  if (!added.ok) return added;
  const now = deps.clock.nowIso();
  // A provider reports `verified` as soon as the platform account owns the name, which
  // says nothing about where its DNS points. Only a check that also sees `misconfigured`
  // false may flip a row, because a verified row is a trusted auth origin.
  const inserted = await insertOrDetach(deps, {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    domain,
    kind: 'custom',
    verified: false,
    provider: deps.provisioner.provider,
    verification: added.value.verification,
    createdAt: now,
    verifiedAt: null,
    lastCheckedAt: null,
    lastError: null,
  });
  if (inserted === null) {
    return err(appError('conflict', DOMAIN_UNAVAILABLE));
  }
  await appendEvent(deps, {
    tenantId: tenant.value,
    domain,
    kind: 'domain_added',
    actorUserId: ctx.identity.userId,
    detail: deps.provisioner.provider,
  });
  return ok(await readRouting(tenant.value, ctx.identity.tenantSlug, deps));
};

/**
 * `status` reports what the provider already knows; `verify` asks it to re-read
 * DNS, which is what turns a freshly published record into a verified domain.
 */
const refreshTenantDomain = async (
  row: TenantDomain,
  deps: TenantDomainDeps,
  actorUserId: string | null,
  deadline: AbortSignal,
): Promise<Result<TenantDomain, AppError>> => {
  const observed = await deps.provisioner.status(row.domain, { signal: deadline });
  const state = observed.ok && !observed.value.verified
    ? await deps.provisioner.verify(row.domain, { signal: deadline })
    : observed;
  const now = deps.clock.nowIso();
  if (!state.ok) {
    // Our own deadline fired, so nothing was learned about the domain: recording a
    // failure would blame the provider for a budget the caller ran out of. The stamp
    // still moves, or the row this deadline keeps cutting short would be picked first
    // by every following tick and starve every other tenant.
    if (deadline.aborted) {
      await deps.tenantDomains.patch(row.tenantId, row.id, { lastCheckedAt: now });
      return state;
    }
    await deps.tenantDomains.patch(row.tenantId, row.id, {
      lastCheckedAt: now,
      lastError: state.error.message,
    });
    // The trail is evidence, and a domain that keeps failing the same way would add
    // one row per tick to it, so only a change is worth recording.
    if (row.lastError !== state.error.message) {
      await appendEvent(deps, {
        tenantId: row.tenantId,
        domain: row.domain,
        kind: 'domain_check_failed',
        actorUserId,
        detail: state.error.message,
      });
    }
    return state;
  }
  // A provisioner is never allowed to demote: manual mode has no opinion at all,
  // and an operator-verified row stays verified until an operator says otherwise.
  const progress = {
    verification: state.value.verification,
    lastCheckedAt: now,
    lastError: null,
  } as const;
  if (!row.verified && state.value.verified && !state.value.misconfigured) {
    const flipped = await deps.tenantDomains.markVerified(row.tenantId, row.id, {
      ...progress,
      verifiedAt: now,
    });
    if (flipped !== null) {
      await appendEvent(deps, {
        tenantId: row.tenantId,
        domain: row.domain,
        kind: 'domain_verified',
        actorUserId,
        detail: null,
      });
      await notifyOwners(deps, {
        tenantId: row.tenantId,
        domainId: row.id,
        domain: row.domain,
        kind: 'tenant-domain-verified',
      });
      return ok(flipped);
    }
  }
  const patched = await deps.tenantDomains.patch(row.tenantId, row.id, progress);
  if (patched === null) return err(notFound('This domain is no longer connected'));
  return ok(patched);
};

export const checkTenantDomain = async (
  ctx: Ctx,
  input: { domain: string },
  deps: TenantDomainDeps,
): Promise<Result<TenantRouting, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const row = await findCustomDomain(tenant.value, input.domain, deps);
  if (row === null) return err(notFound('This domain is not connected to your workspace'));
  const budget = await claimHourlyBudget(
    { scope: 'tenant-domain-check', tenantId: tenant.value, limit: CUSTOM_DOMAIN_CHECKS_PER_HOUR },
    deps,
  );
  if (!budget) {
    return err(rateLimited('Too many domain checks in the last hour. Try again later.'));
  }
  const refreshed = await refreshTenantDomain(
    row,
    deps,
    ctx.identity.userId,
    AbortSignal.timeout(TENANT_DOMAIN_REFRESH_BUDGET_MS),
  );
  if (!refreshed.ok) return refreshed;
  return ok(await readRouting(tenant.value, ctx.identity.tenantSlug, deps));
};

export interface TenantDomainRemoval {
  routing: TenantRouting;
  /** Set when the request itself arrived on the domain that just disappeared. */
  redirectTo: string | null;
}

export const removeTenantDomain = async (
  ctx: Ctx,
  input: { domain: string; requestHost?: string },
  deps: TenantDomainDeps,
): Promise<Result<TenantDomainRemoval, AppError>> => {
  const tenant = authorizeTenant(ctx, 'tenant:settings:write');
  if (!tenant.ok) return tenant;
  const row = await findCustomDomain(tenant.value, input.domain, deps);
  if (row === null) return err(notFound('This domain is not connected to your workspace'));
  const removed = await deps.provisioner.remove(row.domain);
  if (!removed.ok) return removed;
  await deps.tenantDomains.remove(tenant.value, row.id);
  await appendEvent(deps, {
    tenantId: tenant.value,
    domain: row.domain,
    kind: 'domain_removed',
    actorUserId: ctx.identity.userId,
    detail: null,
  });
  const requestHost = input.requestHost?.toLowerCase().replace(/:\d+$/, '') ?? null;
  return ok({
    routing: await readRouting(tenant.value, ctx.identity.tenantSlug, deps),
    redirectTo: requestHost === row.domain
      ? tenantUrl(ctx.identity.tenantSlug, '/panel/settings', deps.routing)
      : null,
  });
};

export interface TenantDomainCheckResult {
  checked: number;
  verified: number;
  failed: number;
  alerted: number;
}

export const runTenantDomainChecks = async (
  deps: TenantDomainDeps,
): Promise<Result<TenantDomainCheckResult, AppError>> => {
  const result: TenantDomainCheckResult = { checked: 0, verified: 0, failed: 0, alerted: 0 };
  // Manual mode reports no verification at all, so a tick could only learn nothing and
  // then blame correct DNS for the operator flip that is actually missing.
  if (deps.provisioner.provider === 'manual') return ok(result);
  const pending = await deps.tenantDomains.listOldestPendingPerTenant(TENANT_DOMAIN_CHECK_BATCH);
  const startedAt = Date.parse(deps.clock.nowIso());
  for (const row of pending) {
    // A row only starts when its own refresh deadline still fits the tick, and a row that
    // deadline did cut short is left for the next tick rather than counted as a provider
    // failure it never had. Progress is per row, so deferring costs nothing.
    const elapsed = Date.parse(deps.clock.nowIso()) - startedAt;
    if (elapsed + TENANT_DOMAIN_REFRESH_BUDGET_MS > TENANT_DOMAIN_CHECK_TIME_BUDGET_MS) break;
    const deadline = AbortSignal.timeout(TENANT_DOMAIN_REFRESH_BUDGET_MS);
    const refreshed = await refreshTenantDomain(row, deps, null, deadline);
    if (!refreshed.ok && deadline.aborted) break;
    result.checked += 1;
    if (!refreshed.ok) {
      result.failed += 1;
      continue;
    }
    if (refreshed.value.verified) {
      result.verified += 1;
      continue;
    }
    if (startedAt - Date.parse(row.createdAt) < MISCONFIGURED_ALERT_AFTER_MS) continue;
    const alerted = await notifyOwners(deps, {
      tenantId: row.tenantId,
      domainId: row.id,
      domain: row.domain,
      kind: 'tenant-domain-error',
    });
    if (alerted) result.alerted += 1;
  }
  return ok(result);
};
