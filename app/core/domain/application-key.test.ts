import { describe, expect, it } from 'vitest';

import {
  applicationKeyCapabilities,
  applicationKeyPublicSchema,
  applicationKeySchema,
  createApplicationKeyInputSchema,
  storedApplicationKeySchema,
} from './application-key.js';

const storedRow = {
  id: 'ak-1',
  tenantId: 't-acme',
  name: 'Companion app',
  keyHash: 'hash',
  scopes: ['entitlements:check', 'later:scope'],
  productIds: null,
  issuedByUserId: 'user-owner',
  createdAt: '2026-11-20T12:00:00.000Z',
  expiresAt: '2026-12-20T12:00:00.000Z',
  revokedAt: null,
};

describe('application key scopes', () => {
  it('drops a stored scope this release does not know instead of refusing the row', () => {
    expect(storedApplicationKeySchema.parse(storedRow).scopes).toEqual(['entitlements:check']);
    expect(storedApplicationKeySchema.parse({ ...storedRow, scopes: ['later:scope'] }).scopes).toEqual([]);
    expect(applicationKeyCapabilities([])).toEqual([]);
  });

  it('reads a listed key with a scope a later release adds', () => {
    expect(applicationKeyPublicSchema.parse(storedRow).scopes).toEqual(['entitlements:check']);
  });

  it('still refuses an unknown scope when a key is created', () => {
    const input = { name: 'Companion app', scopes: ['entitlements:check', 'later:scope'], expiresAt: '2026-12-20T12:00:00.000Z' };
    expect(createApplicationKeyInputSchema.safeParse(input).success).toBe(false);
    expect(applicationKeySchema.safeParse(storedRow).success).toBe(false);
  });
});
