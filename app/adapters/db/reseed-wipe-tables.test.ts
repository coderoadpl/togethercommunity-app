import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { DEMO_TENANT_WIPE_TABLES } from './reseed-wipe-tables.js';
import * as schema from './schema.js';

describe('DEMO_TENANT_WIPE_TABLES', () => {
  it('covers every tenant-scoped Drizzle table', () => {
    const tenantScopedTables = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .filter((table) => Object.values(getTableColumns(table))
        .some((column) => column.name === 'tenant_id'))
      .map(getTableName)
      .toSorted();
    const wipeTables = DEMO_TENANT_WIPE_TABLES.map(getTableName).toSorted();

    expect(wipeTables).toEqual(tenantScopedTables);
  });

  it('requires an explicit decision for every table without tenant_id', () => {
    const tablesWithoutTenantId = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .filter((table) => Object.values(getTableColumns(table))
        .every((column) => column.name !== 'tenant_id'))
      .map(getTableName)
      .toSorted();
    const allowedTablesWithoutTenantId = [
      schema.tenants,
      schema.schedulerRuns,
      schema.devEmails,
      schema.devMagicLinks,
      schema.user,
      schema.session,
      schema.account,
      schema.verification,
      schema.passkey,
      schema.twoFactor,
      schema.rateLimit,
      schema.apiKeyRateLimitBuckets,
      schema.rateLimitBuckets,
    ].map(getTableName).toSorted();

    expect(tablesWithoutTenantId).toEqual(allowedTablesWithoutTenantId);
  });

  it('lists every table before the tables it references', () => {
    const positionOf = new Map(
      DEMO_TENANT_WIPE_TABLES.map((table, index) => [getTableName(table), index]),
    );
    const violations = DEMO_TENANT_WIPE_TABLES.flatMap((table, childPosition) => {
      const child = getTableName(table);
      return getTableConfig(table).foreignKeys.flatMap((foreignKey) => {
        const parent = getTableName(foreignKey.reference().foreignTable);
        const parentPosition = positionOf.get(parent);
        if (parent === child || parentPosition === undefined) return [];
        return childPosition > parentPosition ? [`${child} is wiped after ${parent}`] : [];
      });
    });

    expect(violations).toEqual([]);
  });
});
