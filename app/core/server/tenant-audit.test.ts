import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import { tenantAuditActor } from './tenant-audit.js';

const identity: Identity = {
  userId: 'user-owner',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantAccess: 'staff',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: null,
};

describe('tenantAuditActor', () => {
  it('records the shop management key behind a keyed request', () => {
    expect(tenantAuditActor({ identity, machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-key-1' } })).toEqual({
      actorUserId: 'user-owner',
      actorEmail: 'owner@example.test',
      actorApiKeyId: 'shop-key-1',
    });
  });

  it('records no key for a session request', () => {
    expect(tenantAuditActor({ identity })).toEqual({
      actorUserId: 'user-owner',
      actorEmail: 'owner@example.test',
      actorApiKeyId: null,
    });
  });
});
