import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  capabilitiesForPrincipal,
  shopManagementCapabilities,
  type Identity,
  type UpdateTenantSettingsInput,
} from '#core/domain/index.js';
import type { Ctx } from '#core/server/context.js';
import type { TenantRepository } from '#core/server/ports.js';
import { updateTenantSettings, type TenantSettingsDeps } from '#core/server/usecases/tenant-settings.js';

import type { Db } from './client.js';
import { createTenantRepository } from './repositories.js';
import * as schema from './schema.js';
import { tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let loggingPool: pg.Pool;
let loggingDb: Db;
const loggedQueries: string[] = [];

const TENANT = 'acme';

const owner: Identity = {
  userId: 'owner-1',
  email: 'owner@acme.example.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantAccess: 'staff',
  tenantId: TENANT,
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
};

const ownerCapabilities = capabilitiesForPrincipal('owner');
const ownerSession: Ctx = { identity: owner };
const keyCtx: Ctx = {
  identity: owner,
  capabilities: shopManagementCapabilities(['shop:settings:read', 'shop:settings:write'], 'direct')
    .filter((capability) => ownerCapabilities.includes(capability)),
  machineActor: { kind: 'shop_management_key', apiKeyId: 'key-1', mode: 'direct' },
};

const depsFor = (tenantRepository: TenantRepository): TenantSettingsDeps => ({
  tenants: tenantRepository,
  spaces: {
    list: async () => [],
    findById: async () => null,
    findBySlug: async () => null,
    create: async () => undefined,
    update: async () => null,
    setArchived: async () => null,
    delete: async () => false,
    stats: async () => new Map(),
  },
  products: { bumpContentVersion: async () => undefined },
  personalisationMaxBytes: 1024,
});

const keyWrite = (patch: UpdateTenantSettingsInput, deps: TenantSettingsDeps) =>
  updateTenantSettings(keyCtx, patch, deps, {
    shopManagementKeyGrant: { operation: 'shop-settings:update', fields: Object.keys(patch) },
  });

const createGate = () => {
  let markReached = (): void => undefined;
  let release = (): void => undefined;
  const reached = new Promise<void>((resolve) => { markReached = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return {
    reached,
    release,
    pause: async (): Promise<void> => {
      markReached();
      await released;
    },
  };
};

const pausedBetweenReadAndWrite = (
  repository: TenantRepository,
  gate: ReturnType<typeof createGate>,
): TenantRepository => ({
  ...repository,
  findSettings: async (tenantId) => {
    const settings = await repository.findSettings(tenantId);
    await gate.pause();
    return settings;
  },
  changeSettings: async (tenantId, change) => repository.changeSettings(tenantId, async (current) => {
    await gate.pause();
    return change(current);
  }),
});

const sessionsWaitingOnLock = async (): Promise<number> => {
  const result = await loggingPool.query<{ waiting: number }>(
    "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
  );
  return result.rows[0]?.waiting ?? 0;
};

const settledOrBlocked = async (write: Promise<unknown>): Promise<'settled' | 'blocked'> => {
  let settled = false;
  const settledWrite = write.then(() => {
    settled = true;
    return 'settled' as const;
  });
  const blocked = (async () => {
    while (!settled) {
      if (await sessionsWaitingOnLock() > 0) return 'blocked' as const;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return 'settled' as const;
  })();
  return Promise.race([settledWrite, blocked]);
};

const interleave = async (
  paused: (repository: TenantRepository) => Promise<unknown>,
  between: (repository: TenantRepository) => Promise<unknown>,
): Promise<{ second: 'settled' | 'blocked'; results: [unknown, unknown] }> => {
  const gate = createGate();
  const first = paused(pausedBetweenReadAndWrite(createTenantRepository(database.db), gate));
  await gate.reached;
  const second = between(createTenantRepository(database.db));
  const secondState = await settledOrBlocked(second);
  gate.release();
  return { second: secondState, results: await Promise.all([first, second]) };
};

const storedSettings = async () => {
  const settings = await createTenantRepository(database.db).findSettings(TENANT);
  if (settings === null) throw new Error('The workspace has no settings');
  return settings;
};

const tenantUpdateColumns = (): string[][] => loggedQueries
  .filter((query) => query.startsWith('update "tenants" set '))
  .map((query) => {
    const assignments = query.slice('update "tenants" set '.length, query.indexOf(' where '));
    return [...assignments.matchAll(/(?:^|, )"([a-z0-9_]+)" = /g)].map((match) => match[1] ?? '').sort();
  });

beforeAll(async () => {
  database = await createTestDatabase('together_tenant_settings_concurrency', baseDatabaseUrl);
  loggingPool = new pg.Pool({ connectionString: database.url });
  loggingDb = drizzle(loggingPool, {
    schema,
    logger: { logQuery: (query) => { loggedQueries.push(query); } },
  });
}, 60_000);

afterAll(async () => {
  await loggingPool?.end();
  await database?.close();
});

beforeEach(async () => {
  loggedQueries.length = 0;
  await database.db.delete(tenants);
  await database.db.insert(tenants).values({
    id: TENANT,
    slug: 'acme',
    name: 'Acme',
    createdAt: '2026-11-01T09:00:00.000Z',
    supportUrl: 'https://acme.example.test/old-help',
    directMessagesEnabled: true,
    checkoutReturnOrigins: [],
    invoiceVatMode: 'rate',
    invoiceVatRatePercent: 23,
  });
});

describe('concurrent settings writes', () => {
  it('keeps the owner change of a field outside the key grant when a keyed write straddles it', async () => {
    const { second, results } = await interleave(
      (repository) => keyWrite({ supportUrl: 'https://acme.example.test/help' }, depsFor(repository)),
      (repository) => updateTenantSettings(ownerSession, {
        checkoutReturnOrigins: ['https://shop.example.test'],
        directMessagesEnabled: false,
      }, depsFor(repository)),
    );

    expect(second).toBe('blocked');
    expect(results).toMatchObject([{ ok: true }, { ok: true }]);
    expect(await storedSettings()).toMatchObject({
      supportUrl: 'https://acme.example.test/help',
      checkoutReturnOrigins: ['https://shop.example.test'],
      directMessagesEnabled: false,
    });
  });

  it('keeps a keyed change made between an owner read and write and the owner change of a protected field', async () => {
    const { second, results } = await interleave(
      (repository) => updateTenantSettings(ownerSession, {
        checkoutReturnOrigins: ['https://shop.example.test'],
      }, depsFor(repository)),
      (repository) => keyWrite({ supportUrl: 'https://acme.example.test/help' }, depsFor(repository)),
    );

    expect(second).toBe('blocked');
    expect(results).toMatchObject([{ ok: true }, { ok: true }]);
    expect(await storedSettings()).toMatchObject({
      supportUrl: 'https://acme.example.test/help',
      checkoutReturnOrigins: ['https://shop.example.test'],
    });
  });

  it('keeps both changes when two owner sessions write different fields concurrently', async () => {
    const { second, results } = await interleave(
      (repository) => updateTenantSettings(ownerSession, {
        checkoutReturnOrigins: ['https://shop.example.test'],
      }, depsFor(repository)),
      (repository) => updateTenantSettings(ownerSession, { directMessagesEnabled: false }, depsFor(repository)),
    );

    expect(second).toBe('blocked');
    expect(results).toMatchObject([{ ok: true }, { ok: true }]);
    expect(await storedSettings()).toMatchObject({
      checkoutReturnOrigins: ['https://shop.example.test'],
      directMessagesEnabled: false,
    });
  });
});

describe('keyed settings write columns', () => {
  it('updates only the granted column and the content version', async () => {
    expect(await keyWrite({ supportUrl: 'https://acme.example.test/help' }, depsFor(createTenantRepository(loggingDb))))
      .toMatchObject({ ok: true, value: { supportUrl: 'https://acme.example.test/help', directMessagesEnabled: true } });

    expect(tenantUpdateColumns()).toEqual([['content_version', 'support_url']]);
  });

  it('adds only the VAT field the coherence rule clears when a key switches to an exemption', async () => {
    expect(await keyWrite({
      invoiceVatMode: 'exempt',
      invoiceExemptionBasisKind: 'art_113_1',
      invoiceExemptionBasis: 'art. 113 ust. 1',
    }, depsFor(createTenantRepository(loggingDb)))).toMatchObject({
      ok: true,
      value: { invoiceVatMode: 'exempt', invoiceVatRatePercent: null, invoiceExemptionBasisKind: 'art_113_1' },
    });

    expect(tenantUpdateColumns()).toEqual([[
      'content_version',
      'invoice_exemption_basis',
      'invoice_exemption_basis_kind',
      'invoice_vat_mode',
      'invoice_vat_rate_percent',
    ]]);
    const [row] = await database.db.select({ rate: tenants.invoiceVatRatePercent }).from(tenants).where(eq(tenants.id, TENANT));
    expect(row?.rate).toBeNull();
  });
});
