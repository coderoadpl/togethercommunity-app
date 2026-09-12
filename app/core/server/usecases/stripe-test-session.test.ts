import { describe, expect, it } from 'vitest';

import { ok, type Identity } from '#core/domain/index.js';

import { createStripeTestSession, hasStripeTestSession } from './stripe-test-session.js';

const identity: Identity = {
  userId: 'staff-1', email: 'staff@example.test', name: 'Staff', emailVerified: true, image: null,
  tenantId: 'tenant-1', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'admin', memberId: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null,
  memberVideoAutoplay: null,
};
const deps = {
  clock: { nowIso: () => '2026-09-12T12:00:00.000Z' },
  secretCrypto: {
    encrypt: (plaintext: string) => ({ ciphertext: plaintext, iv: 'iv', authTag: 'tag' }),
    decrypt: (encrypted: { ciphertext: string }) => ok(encrypted.ciphertext),
  },
};

describe('staff Stripe test session', () => {
  it('is off by default and refuses non-staff', () => {
    expect(hasStripeTestSession(identity, undefined, deps)).toBe(false);
    expect(createStripeTestSession({ identity: { ...identity, staffRole: null } }, deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('binds the flag to the current staff account, tenant and expiry', () => {
    const session = createStripeTestSession({ identity }, deps);
    if (!session.ok) throw new Error('Session fixture failed');
    expect(hasStripeTestSession(identity, session.value, deps)).toBe(true);
    expect(hasStripeTestSession({ ...identity, userId: 'another-user' }, session.value, deps)).toBe(false);
    expect(hasStripeTestSession({ ...identity, tenantId: 'another-tenant' }, session.value, deps)).toBe(false);
    expect(hasStripeTestSession({ ...identity, staffRole: null }, session.value, deps)).toBe(false);
    expect(hasStripeTestSession(null, session.value, deps)).toBe(false);
    expect(hasStripeTestSession(identity, session.value, { ...deps, clock: { nowIso: () => '2026-09-12T13:00:00.000Z' } })).toBe(false);
    expect(hasStripeTestSession(identity, 'invalid', deps)).toBe(false);
  });
});
