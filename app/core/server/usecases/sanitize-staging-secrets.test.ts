import { describe, expect, it } from 'vitest';

import {
  err,
  internal,
  ok,
  type PlatformAuditEvent,
  type TenantSecret,
} from '#core/domain/index.js';

import {
  sanitizeStagingSecrets,
  type SanitizeStagingSecretsDeps,
} from './sanitize-staging-secrets.js';

const NOW = '2026-09-05T12:00:00.000Z';

const storedSecret = (over: Partial<TenantSecret> & { id: string }): TenantSecret => ({
  tenantId: 'tenant-acme',
  key: 'stripe.restrictedKey',
  ciphertext: 'readable',
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: 'rk_***',
  updatedAt: NOW,
  ...over,
});

const deps = (
  stored: TenantSecret[],
  markers: Partial<Pick<SanitizeStagingSecretsDeps, 'production' | 'databaseFingerprint' | 'productionDatabaseFingerprint'>> = {},
): { deps: SanitizeStagingSecretsDeps; remaining: TenantSecret[]; recorded: PlatformAuditEvent[] } => {
  const remaining = [...stored];
  const recorded: PlatformAuditEvent[] = [];
  return {
    remaining,
    recorded,
    deps: {
      production: false,
      databaseFingerprint: 'staging-fingerprint',
      productionDatabaseFingerprint: 'production-fingerprint',
      ...markers,
      secrets: {
        listAll: async () => [...remaining],
        deleteById: async (id) => {
          const index = remaining.findIndex((candidate) => candidate.id === id);
          if (index === -1) return false;
          remaining.splice(index, 1);
          return true;
        },
      },
      secretCrypto: {
        encrypt: () => ({ ciphertext: 'readable', iv: 'iv', authTag: 'tag' }),
        decrypt: (input) =>
          input.ciphertext === 'readable'
            ? ok('plaintext')
            : err(internal('Stored secret failed integrity verification')),
      },
      platformAudit: {
        record: async (event) => {
          recorded.push(event);
        },
      },
      environment: 'staging',
      ids: { nextId: () => 'audit-1' },
      clock: { nowIso: () => NOW },
    },
  };
};

describe('sanitizeStagingSecrets', () => {
  it('keeps a secret that decrypts and removes one that does not', async () => {
    const harness = deps([
      storedSecret({ id: 'secret-readable' }),
      storedSecret({ id: 'secret-foreign', key: 's3.configuration', ciphertext: 'foreign-key' }),
      storedSecret({
        id: 'secret-foreign-globex',
        tenantId: 'tenant-globex',
        key: 'ses.accessKeyId',
        ciphertext: 'foreign-key',
      }),
    ]);

    const result = await sanitizeStagingSecrets(harness.deps);

    expect(result).toEqual({
      ok: true,
      value: {
        environment: 'staging',
        scanned: 3,
        kept: 1,
        removed: [
          { tenantId: 'tenant-acme', key: 's3.configuration' },
          { tenantId: 'tenant-globex', key: 'ses.accessKeyId' },
        ],
        durationMs: 0,
      },
    });
    expect(harness.remaining.map((secret) => secret.id)).toEqual(['secret-readable']);
  });

  it('records a platform audit event carrying the counts', async () => {
    const harness = deps([
      storedSecret({ id: 'secret-readable' }),
      storedSecret({ id: 'secret-foreign', key: 's3.configuration', ciphertext: 'foreign-key' }),
    ]);

    await sanitizeStagingSecrets(harness.deps);

    expect(harness.recorded).toEqual([expect.objectContaining({
      action: 'sanitize-staging-secrets',
      environment: 'staging',
      status: 'succeeded',
      detail: 'scanned=2 kept=1 removed=1 (tenant-acme:s3.configuration)',
    })]);
  });

  it('refuses a production deployment without reading a single secret', async () => {
    const harness = deps([storedSecret({ id: 'secret-foreign', ciphertext: 'foreign-key' })], {
      production: true,
    });

    const result = await sanitizeStagingSecrets(harness.deps);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'forbidden',
        message: 'Secret sanitize refused because the deployment identity reports production',
      },
    });
    expect(harness.remaining).toHaveLength(1);
    expect(harness.recorded).toEqual([]);
  });

  it('refuses a non-production deployment pointed at the production database', async () => {
    const harness = deps([storedSecret({ id: 'secret-foreign', ciphertext: 'foreign-key' })], {
      databaseFingerprint: 'production-fingerprint',
    });

    const result = await sanitizeStagingSecrets(harness.deps);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'forbidden',
        message:
          'Secret sanitize refused because the database fingerprint matches the production database',
      },
    });
    expect(harness.remaining).toHaveLength(1);
  });

  it('keeps an unexpected failure opaque while auditing it', async () => {
    const harness = deps([]);
    const failing: SanitizeStagingSecretsDeps = {
      ...harness.deps,
      secrets: {
        listAll: async () => {
          throw new Error('connection terminated unexpectedly');
        },
        deleteById: async () => false,
      },
    };

    const result = await sanitizeStagingSecrets(failing);

    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Secret sanitize failed' },
    });
    expect(harness.recorded).toEqual([expect.objectContaining({
      status: 'failed',
      detail: 'connection terminated unexpectedly',
    })]);
  });
});
