import { describe, expect, it, vi } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type DnsRecord,
  type Identity,
  type Notification,
  type TenantDomain,
  type TenantDomainProvider,
} from '#core/domain/index.js';

import type {
  Clock,
  DomainProvisioner,
  DomainProvisionState,
  NotificationRepository,
  PublicRateLimitRepository,
  TenantAccessReader,
  TenantDomainEventInput,
  TenantDomainRepository,
} from '../ports.js';
import {
  createInMemoryTenantDomainRepository,
  tenantDomainFixture,
  tenantDomainRepositoryStub,
} from '../testing/tenant-domain-fakes.js';
import {
  addTenantDomain,
  checkTenantDomain,
  getTenantRouting,
  removeTenantDomain,
  runTenantDomainChecks,
  TENANT_DOMAIN_CHECK_TIME_BUDGET_MS,
  TENANT_DOMAIN_REFRESH_BUDGET_MS,
  type TenantDomainDeps,
} from './tenant-domains.js';

const identity: Identity = {
  userId: 'u-1',
  email: 'owner@together.dev',
  name: 'Owner',
  emailVerified: true,
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
};

const ctx = { identity };

const TXT_RECORD: DnsRecord = {
  type: 'TXT',
  name: '_vercel.kurs.coderoad.example',
  value: 'vc-domain-verify=kurs.coderoad.example,abc',
};

class FakeProvisioner implements DomainProvisioner {
  readonly provider: TenantDomainProvider;
  readonly calls: string[] = [];
  readonly statusSignals: (AbortSignal | undefined)[] = [];

  constructor(
    private readonly states: {
      provider?: TenantDomainProvider;
      add?: { verification: DnsRecord[]; verified: boolean };
      status?: DomainProvisionState;
      verify?: DomainProvisionState;
      failure?: string;
    } = {},
  ) {
    this.provider = states.provider ?? 'vercel';
  }

  async add(domain: string) {
    this.calls.push(`add:${domain}`);
    if (this.states.failure !== undefined) return err(integrationUnavailable(this.states.failure));
    return ok(this.states.add ?? { verification: [TXT_RECORD], verified: false });
  }

  async status(domain: string, options?: { signal?: AbortSignal | undefined }) {
    this.calls.push(`status:${domain}`);
    this.statusSignals.push(options?.signal);
    if (this.states.failure !== undefined) return err(integrationUnavailable(this.states.failure));
    return ok(this.states.status ?? { verified: false, misconfigured: true, verification: [TXT_RECORD] });
  }

  async verify(domain: string) {
    this.calls.push(`verify:${domain}`);
    if (this.states.failure !== undefined) return err(integrationUnavailable(this.states.failure));
    return ok(this.states.verify ?? { verified: false, misconfigured: true, verification: [TXT_RECORD] });
  }

  async remove(domain: string) {
    this.calls.push(`remove:${domain}`);
    if (this.states.failure !== undefined) return err(integrationUnavailable(this.states.failure));
    return ok(undefined);
  }
}

class DeadlineHonouringProvisioner implements DomainProvisioner {
  readonly provider = 'vercel' as const;
  readonly calls: string[] = [];

  private async untilAborted(signal: AbortSignal | undefined) {
    await new Promise<void>((resolve) => {
      if (signal === undefined || signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', () => { resolve(); }, { once: true });
    });
    return err(integrationUnavailable('Vercel is unreachable: The operation was aborted'));
  }

  async add(domain: string, options?: { signal?: AbortSignal | undefined }) {
    this.calls.push(`add:${domain}`);
    return this.untilAborted(options?.signal);
  }

  async status(domain: string, options?: { signal?: AbortSignal | undefined }) {
    this.calls.push(`status:${domain}`);
    return this.untilAborted(options?.signal);
  }

  async verify(domain: string, options?: { signal?: AbortSignal | undefined }) {
    this.calls.push(`verify:${domain}`);
    return this.untilAborted(options?.signal);
  }

  async remove(domain: string) {
    this.calls.push(`remove:${domain}`);
    return ok(undefined);
  }
}

const allowingRateLimit: PublicRateLimitRepository = {
  claim: async () => true,
  purgeExpired: async () => 0,
};

const tenantAccess = (): TenantAccessReader => ({
  listTenantsForStaff: async () => [],
  listStaffForTenant: async () => [
    { userId: 'u-1', email: 'owner@together.dev', staffRole: 'owner', language: null },
    { userId: 'u-2', email: 'admin@together.dev', staffRole: 'admin', language: null },
  ],
  findStaffGrant: async () => null,
  findMember: async () => null,
});

const harness = (input: {
  rows?: TenantDomain[];
  provisioner?: DomainProvisioner;
  rateLimit?: PublicRateLimitRepository;
  tenantDomains?: TenantDomainRepository;
  now?: string;
  clock?: Clock;
} = {}) => {
  const rows = input.rows ?? [];
  const events: TenantDomainEventInput[] = [];
  const notifications: Notification[] = [];
  let nextId = 0;
  const notificationRepository: NotificationRepository = {
    insert: async (_tenantId, notification) => notification,
    insertMany: async (_tenantId, batch) => {
      const fresh = batch.filter(
        (item) => !notifications.some((existing) =>
          existing.sourceKey === item.sourceKey && existing.recipientUserId === item.recipientUserId),
      );
      notifications.push(...fresh);
      return fresh;
    },
    listForRecipient: async () => ({ notifications: [], nextCursor: null }),
    markRead: async () => null,
    markAllRead: async () => 0,
    unreadCount: async () => 0,
    hasUnreadDmNotification: async () => false,
    markDmConversationRead: async () => 0,
  };
  const deps: TenantDomainDeps = {
    tenantDomains: input.tenantDomains ?? createInMemoryTenantDomainRepository(rows),
    domainEvents: {
      append: async (_tenantId, event) => {
        events.push(event);
      },
    },
    provisioner: input.provisioner ?? new FakeProvisioner(),
    rateLimit: input.rateLimit ?? allowingRateLimit,
    notifications: notificationRepository,
    tenantAccess: tenantAccess(),
    realtimeBus: { publish: () => undefined, subscribe: () => () => undefined },
    ids: { nextId: () => `id-${String((nextId += 1))}` },
    clock: input.clock ?? { nowIso: () => input.now ?? '2026-09-04T10:00:00.000Z' },
    routing: {
      appBaseUrl: 'https://start.together.example',
      baseDomain: 'together.example',
      singleTenantMode: false,
    },
    customDomainTarget: 'cname.vercel-dns.com',
  };
  return { deps, rows, events, notifications };
};

describe('getTenantRouting', () => {
  it('reports the tenant host, DNS records and status of every custom domain', async () => {
    const { deps } = harness({
      rows: [
        tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'acme.together.example', kind: 'subdomain', verified: true }),
        tenantDomainFixture({ id: 'd-2', tenantId: 't-acme', domain: 'kurs.coderoad.example', verified: true }),
        tenantDomainFixture({ id: 'd-3', tenantId: 't-acme', domain: 'nowa.coderoad.example', verification: [TXT_RECORD] }),
      ],
    });

    const result = await getTenantRouting(ctx, deps);

    expect(result).toEqual({
      ok: true,
      value: {
        tenantHost: 'acme.together.example',
        customDomains: [
          {
            domain: 'kurs.coderoad.example',
            verified: true,
            status: 'active',
            records: [{ type: 'CNAME', name: 'kurs.coderoad.example', value: 'cname.vercel-dns.com' }],
            lastCheckedAt: null,
            lastError: null,
          },
          {
            domain: 'nowa.coderoad.example',
            verified: false,
            status: 'provider-verification',
            records: [
              { type: 'CNAME', name: 'nowa.coderoad.example', value: 'cname.vercel-dns.com' },
              TXT_RECORD,
            ],
            lastCheckedAt: null,
            lastError: null,
          },
        ],
        customDomainTarget: 'cname.vercel-dns.com',
        canAddCustomDomain: true,
      },
    });
  });

  it('refuses a member without a staff role', async () => {
    const { deps } = harness();

    const result = await getTenantRouting(
      { identity: { ...identity, staffRole: null, memberId: 'm-1' } },
      deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses a caller that has not selected a tenant', async () => {
    const { deps } = harness();

    const result = await getTenantRouting(
      { identity: { ...identity, tenantId: null, tenantSlug: null } },
      deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});

describe('addTenantDomain', () => {
  it.each([
    ['HTTPS://Kurs.CodeRoad.Example/panel', 'kurs.coderoad.example'],
    ['kurs.coderoad.example:8443', 'kurs.coderoad.example'],
    ['  kurs.coderoad.example.  ', 'kurs.coderoad.example'],
  ])('normalises %s to %s', async (input, expected) => {
    const { deps, rows } = harness();

    const result = await addTenantDomain(ctx, { domain: input }, deps);

    expect(result.ok).toBe(true);
    expect(rows.map((row) => row.domain)).toEqual([expected]);
  });

  it('records the provider, its verification records and an audit event', async () => {
    const { deps, rows, events } = harness();

    const result = await addTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({
      provider: 'vercel',
      verified: false,
      verification: [TXT_RECORD],
      createdAt: '2026-09-04T10:00:00.000Z',
    });
    expect(events).toEqual([{
      id: 'id-2',
      tenantId: 't-acme',
      domain: 'kurs.coderoad.example',
      kind: 'domain_added',
      actorUserId: 'u-1',
      detail: 'vercel',
      at: '2026-09-04T10:00:00.000Z',
    }]);
  });

  it('leaves a domain the provider already holds pending until a check confirms its DNS', async () => {
    const { deps, rows, events } = harness({
      provisioner: new FakeProvisioner({ add: { verification: [], verified: true } }),
    });

    const result = await addTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        customDomains: [{ domain: 'kurs.coderoad.example', verified: false, status: 'pending-dns' }],
      },
    });
    expect(rows[0]).toMatchObject({ verified: false, verifiedAt: null, lastCheckedAt: null });
    expect(events.map((event) => event.kind)).toEqual(['domain_added']);
  });

  it('detaches the domain at the provider when the row cannot be stored', async () => {
    const provisioner = new FakeProvisioner();
    const { deps } = harness({
      provisioner,
      tenantDomains: tenantDomainRepositoryStub({
        insert: () => Promise.reject(new Error('insert failed')),
      }),
    });

    await expect(addTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps))
      .rejects.toThrow('insert failed');
    expect(provisioner.calls).toEqual([
      'add:kurs.coderoad.example',
      'remove:kurs.coderoad.example',
    ]);
  });

  it('keeps the attachment when another workspace wins the uniqueness race', async () => {
    const provisioner = new FakeProvisioner();
    const { deps } = harness({
      provisioner,
      tenantDomains: tenantDomainRepositoryStub({ insert: async () => null }),
    });

    const result = await addTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: 'This domain cannot be connected' },
    });
    expect(provisioner.calls).toEqual(['add:kurs.coderoad.example']);
  });

  it.each([
    ['together.example', 'the platform base domain'],
    ['acme.together.example', 'a platform subdomain'],
    ['kurs.coderoad.przykład', 'a non-punycode international domain'],
    ['localhost', 'a single-label host'],
    ['not a domain', 'a malformed host'],
  ])('refuses %s (%s)', async (domain) => {
    const { deps, rows } = harness();

    const result = await addTenantDomain(ctx, { domain }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(rows).toHaveLength(0);
  });

  it('refuses a domain another workspace already uses without naming that workspace', async () => {
    const { deps } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-globex', domain: 'kurs.coderoad.example' })],
    });

    const result = await addTenantDomain(ctx, { domain: 'KURS.coderoad.example' }, deps);

    expect(result).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'This domain cannot be connected' },
    });
  });

  it('refuses a fourth custom domain', async () => {
    const { deps } = harness({
      rows: [1, 2, 3].map((index) => tenantDomainFixture({
        id: `d-${String(index)}`,
        tenantId: 't-acme',
        domain: `kurs${String(index)}.coderoad.example`,
      })),
    });

    const result = await addTenantDomain(ctx, { domain: 'kurs4.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('refuses once the hourly budget is spent, without calling the provider', async () => {
    const provisioner = new FakeProvisioner();
    const { deps } = harness({
      provisioner,
      rateLimit: { claim: async () => false, purgeExpired: async () => 0 },
    });

    const result = await addTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(provisioner.calls).toEqual([]);
  });

  it('spends the budget before it reveals that another workspace holds the domain', async () => {
    const { deps } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-globex', domain: 'kurs.coderoad.example' })],
      rateLimit: { claim: async () => false, purgeExpired: async () => 0 },
    });

    const result = await addTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  it('surfaces the provider message and stores nothing when provisioning fails', async () => {
    const { deps, rows } = harness({
      provisioner: new FakeProvisioner({ failure: 'domain is used by another account' }),
    });

    const result = await addTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable', message: 'domain is used by another account' },
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses an admin who is not the owner', async () => {
    const { deps } = harness();

    const result = await addTenantDomain(
      { identity: { ...identity, staffRole: 'admin' } },
      { domain: 'kurs.coderoad.example' },
      deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('checkTenantDomain', () => {
  it('verifies the domain, records verifiedAt and notifies only the owners', async () => {
    const { deps, rows, events, notifications } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner: new FakeProvisioner({
        verify: { verified: true, misconfigured: false, verification: [] },
      }),
    });

    const result = await checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({
      verified: true,
      verifiedAt: '2026-09-04T10:00:00.000Z',
      lastCheckedAt: '2026-09-04T10:00:00.000Z',
      lastError: null,
    });
    expect(events.map((event) => event.kind)).toEqual(['domain_verified']);
    expect(notifications.map((item) => [item.recipientUserId, item.kind]))
      .toEqual([['u-1', 'tenant-domain-verified']]);
  });

  it('keeps a misconfigured domain pending and surfaces the DNS records', async () => {
    const { deps, rows } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner: new FakeProvisioner({
        verify: { verified: true, misconfigured: true, verification: [TXT_RECORD] },
      }),
    });

    const result = await checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({ verified: false, verification: [TXT_RECORD] });
    expect(result.ok && result.value.customDomains[0]?.records).toEqual([
      { type: 'CNAME', name: 'kurs.coderoad.example', value: 'cname.vercel-dns.com' },
      TXT_RECORD,
    ]);
  });

  it('skips the verify call when the provider already reports a healthy domain', async () => {
    const provisioner = new FakeProvisioner({
      status: { verified: true, misconfigured: false, verification: [] },
    });
    const { deps } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner,
    });

    await checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(provisioner.calls).toEqual(['status:kurs.coderoad.example']);
  });

  it('stores the provider message and returns it to the owner', async () => {
    const { deps, rows, events } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner: new FakeProvisioner({ failure: 'rate limited by the registrar' }),
    });

    const result = await checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable', message: 'rate limited by the registrar' },
    });
    expect(rows[0]).toMatchObject({ lastError: 'rate limited by the registrar' });
    expect(events.map((event) => event.kind)).toEqual(['domain_check_failed']);
  });

  it('never demotes a domain an operator verified by hand', async () => {
    const { deps, rows } = harness({
      rows: [tenantDomainFixture({
        id: 'd-1',
        tenantId: 't-acme',
        domain: 'kurs.coderoad.example',
        provider: 'manual',
        verified: true,
        verifiedAt: '2026-09-01T00:00:00.000Z',
      })],
      provisioner: new FakeProvisioner({
        status: { verified: false, misconfigured: false, verification: [] },
        verify: { verified: false, misconfigured: false, verification: [] },
      }),
    });

    await checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(rows[0]).toMatchObject({ verified: true, verifiedAt: '2026-09-01T00:00:00.000Z' });
  });

  it('refuses a domain that belongs to another workspace', async () => {
    const { deps } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-globex', domain: 'kurs.coderoad.example' })],
    });

    const result = await checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses once the hourly check budget is spent, without calling the provider', async () => {
    const provisioner = new FakeProvisioner();
    const { deps } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner,
      rateLimit: { claim: async () => false, purgeExpired: async () => 0 },
    });

    const result = await checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(provisioner.calls).toEqual([]);
  });

  it('records one verification even when two checks observe the same pending row', async () => {
    const { deps, events, notifications } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner: new FakeProvisioner({
        status: { verified: true, misconfigured: false, verification: [] },
      }),
    });

    const results = await Promise.all([
      checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps),
      checkTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(events.map((event) => event.kind)).toEqual(['domain_verified']);
    expect(notifications).toHaveLength(1);
  });
});

describe('removeTenantDomain', () => {
  it('detaches the domain at the provider, deletes the row and appends an event', async () => {
    const provisioner = new FakeProvisioner();
    const { deps, rows, events } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example', verified: true })],
      provisioner,
    });

    const result = await removeTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: true, value: { redirectTo: null } });
    expect(rows).toHaveLength(0);
    expect(provisioner.calls).toEqual(['remove:kurs.coderoad.example']);
    expect(events.map((event) => event.kind)).toEqual(['domain_removed']);
  });

  it('returns the platform URL when the request arrived on the removed domain', async () => {
    const { deps } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example', verified: true })],
    });

    const result = await removeTenantDomain(
      ctx,
      { domain: 'kurs.coderoad.example', requestHost: 'Kurs.CodeRoad.Example' },
      deps,
    );

    expect(result).toMatchObject({
      ok: true,
      value: { redirectTo: 'https://acme.together.example/panel/settings' },
    });
  });

  it('keeps the row when the provider refuses to detach the domain', async () => {
    const { deps, rows } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner: new FakeProvisioner({ failure: 'domain is locked' }),
    });

    const result = await removeTenantDomain(ctx, { domain: 'kurs.coderoad.example' }, deps);

    expect(result).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(rows).toHaveLength(1);
  });
});

describe('runTenantDomainChecks', () => {
  it('takes one pending domain per tenant and flips the ones the provider verified', async () => {
    const { deps, rows, notifications } = harness({
      rows: [
        tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'a.coderoad.example' }),
        tenantDomainFixture({ id: 'd-2', tenantId: 't-acme', domain: 'b.coderoad.example' }),
        tenantDomainFixture({ id: 'd-3', tenantId: 't-globex', domain: 'c.globex.example' }),
        tenantDomainFixture({ id: 'd-4', tenantId: 't-acme', domain: 'd.coderoad.example', verified: true }),
      ],
      provisioner: new FakeProvisioner({
        status: { verified: true, misconfigured: false, verification: [] },
      }),
    });

    const result = await runTenantDomainChecks(deps);

    expect(result).toEqual({ ok: true, value: { checked: 2, verified: 2, failed: 0, alerted: 0 } });
    expect(rows.filter((row) => row.verified).map((row) => row.id)).toEqual(['d-1', 'd-3', 'd-4']);
    expect(notifications).toHaveLength(2);
  });

  it('alerts the owner once a domain has been misconfigured for a day', async () => {
    const { deps, notifications } = harness({
      rows: [tenantDomainFixture({
        id: 'd-1',
        tenantId: 't-acme',
        domain: 'kurs.coderoad.example',
        createdAt: '2026-09-03T09:00:00.000Z',
      })],
      provisioner: new FakeProvisioner({
        status: { verified: false, misconfigured: true, verification: [TXT_RECORD] },
        verify: { verified: false, misconfigured: true, verification: [TXT_RECORD] },
      }),
    });

    const result = await runTenantDomainChecks(deps);

    expect(result).toMatchObject({ ok: true, value: { alerted: 1 } });
    expect(notifications.map((item) => item.kind)).toEqual(['tenant-domain-error']);

    expect(await runTenantDomainChecks(deps)).toMatchObject({ ok: true, value: { alerted: 0 } });
    expect(notifications).toHaveLength(1);
  });

  it('leaves the rest of the batch for the next tick once the time budget is spent', async () => {
    const start = Date.parse('2026-09-04T10:00:00.000Z');
    const headroom = TENANT_DOMAIN_CHECK_TIME_BUDGET_MS - TENANT_DOMAIN_REFRESH_BUDGET_MS;
    let reads = 0;
    const { deps, rows } = harness({
      rows: ['acme', 'globex', 'initech'].map((tenant, index) => tenantDomainFixture({
        id: `d-${String(index + 1)}`,
        tenantId: `t-${tenant}`,
        domain: `${tenant}.coderoad.example`,
        createdAt: '2026-09-04T09:00:00.000Z',
      })),
      clock: { nowIso: () => new Date(start + (reads++) * (headroom / 2)).toISOString() },
    });

    const result = await runTenantDomainChecks(deps);

    expect(result).toMatchObject({ ok: true, value: { checked: 1 } });
    expect(rows.filter((row) => row.lastCheckedAt === null)).toHaveLength(2);
  });

  it('hands every row its own deadline instead of the shared tick budget', async () => {
    const provisioner = new FakeProvisioner();
    const { deps, rows } = harness({
      rows: ['acme', 'globex'].map((tenant, index) => tenantDomainFixture({
        id: `d-${String(index + 1)}`,
        tenantId: `t-${tenant}`,
        domain: `${tenant}.coderoad.example`,
      })),
      provisioner,
    });

    await runTenantDomainChecks(deps);

    expect(new Set(provisioner.statusSignals).size).toBe(2);
    expect(provisioner.statusSignals.every((signal) => signal?.aborted === false)).toBe(true);
    expect(rows.every((row) => row.lastError === null)).toBe(true);
  });

  it('stays quiet while a fresh domain is still waiting for DNS', async () => {
    const { deps, notifications } = harness({
      rows: [tenantDomainFixture({
        id: 'd-1',
        tenantId: 't-acme',
        domain: 'kurs.coderoad.example',
        createdAt: '2026-09-04T09:00:00.000Z',
      })],
    });

    const result = await runTenantDomainChecks(deps);

    expect(result).toMatchObject({ ok: true, value: { checked: 1, alerted: 0 } });
    expect(notifications).toHaveLength(0);
  });

  it('stamps a row its own deadline cut short instead of recording a provider failure', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    const provisioner = new DeadlineHonouringProvisioner();
    const { deps, rows, events, notifications } = harness({
      rows: [tenantDomainFixture({
        id: 'd-1',
        tenantId: 't-acme',
        domain: 'kurs.coderoad.example',
        createdAt: '2026-09-01T09:00:00.000Z',
      })],
      provisioner,
    });

    try {
      const result = await runTenantDomainChecks(deps);

      expect(result).toEqual({ ok: true, value: { checked: 0, verified: 0, failed: 0, alerted: 0 } });
      expect(provisioner.calls).toEqual(['status:kurs.coderoad.example']);
      expect(rows[0]).toMatchObject({
        verified: false,
        lastCheckedAt: '2026-09-04T10:00:00.000Z',
        lastError: null,
      });
      expect(events).toEqual([]);
      expect(notifications).toEqual([]);
    } finally {
      timeout.mockRestore();
    }
  });

  it('counts a provider outage as a failure and keeps going', async () => {
    const { deps, rows } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner: new FakeProvisioner({ failure: 'gateway timeout' }),
    });

    const result = await runTenantDomainChecks(deps);

    expect(result).toMatchObject({ ok: true, value: { checked: 1, failed: 1, verified: 0 } });
    expect(rows[0]).toMatchObject({ lastError: 'gateway timeout' });
  });

  it('records a failure that repeats once and the failure that replaces it', async () => {
    const states = { failure: 'gateway timeout' };
    const { deps, events } = harness({
      rows: [tenantDomainFixture({ id: 'd-1', tenantId: 't-acme', domain: 'kurs.coderoad.example' })],
      provisioner: new FakeProvisioner(states),
    });

    await runTenantDomainChecks(deps);
    await runTenantDomainChecks(deps);
    states.failure = 'domain is locked';
    await runTenantDomainChecks(deps);

    expect(events.map((event) => event.kind)).toEqual(['domain_check_failed', 'domain_check_failed']);
    expect(events.map((event) => event.detail)).toEqual(['gateway timeout', 'domain is locked']);
  });

  it('skips the tick in manual mode, where only an operator verifies a domain', async () => {
    const provisioner = new FakeProvisioner({ provider: 'manual' });
    const { deps, notifications } = harness({
      rows: [tenantDomainFixture({
        id: 'd-1',
        tenantId: 't-acme',
        domain: 'kurs.coderoad.example',
        createdAt: '2026-09-01T09:00:00.000Z',
      })],
      provisioner,
    });

    const result = await runTenantDomainChecks(deps);

    expect(result).toEqual({ ok: true, value: { checked: 0, verified: 0, failed: 0, alerted: 0 } });
    expect(provisioner.calls).toEqual([]);
    expect(notifications).toEqual([]);
  });
});
