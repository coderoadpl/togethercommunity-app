import { describe, expect, it, vi } from 'vitest';

import { capabilitiesForPrincipal, type Identity, type PlatformAuditEvent } from '#core/domain/index.js';

import { resetPlatformData, type PlatformDataResetDeps } from './platform-data-reset.js';

const identity: Identity = {
  userId: 'user-1',
  email: 'owner@example.test',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
};

const ownerCtx = { identity, capabilities: capabilitiesForPrincipal('platform-owner') };

const times = ['2026-09-03T10:00:00.000Z', '2026-09-03T10:00:12.500Z'];

const deps = (overrides: Partial<PlatformDataResetDeps> = {}) => {
  const recorded: PlatformAuditEvent[] = [];
  let tick = 0;
  const base: PlatformDataResetDeps = {
    dataReset: { run: async () => ({ wiped: [{ table: 'members', rows: 12 }] }) },
    platformAudit: { record: async (event) => { recorded.push(event); } },
    environment: 'staging',
    production: false,
    databaseFingerprint: 'aaaaaaaaaaaa',
    productionDatabaseFingerprint: null,
    ids: { nextId: () => 'audit-1' },
    clock: { nowIso: () => times[Math.min(tick++, times.length - 1)] ?? '' },
    ...overrides,
  };
  return { deps: base, recorded };
};

describe('resetPlatformData', () => {
  it('denies a caller without the platform-owner capability', async () => {
    const { deps: resetDeps, recorded } = deps();
    const run = vi.spyOn(resetDeps.dataReset, 'run');

    const result = await resetPlatformData({ identity }, { confirmation: 'staging' }, resetDeps);

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(run).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('denies a platform owner whose e-mail address is not verified', async () => {
    const { deps: resetDeps, recorded } = deps();
    const run = vi.spyOn(resetDeps.dataReset, 'run');

    const result = await resetPlatformData(
      { ...ownerCtx, identity: { ...identity, emailVerified: false } },
      { confirmation: 'staging' },
      resetDeps,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: expect.stringContaining('verified email') },
    });
    expect(run).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('refuses when the deployment identity reports production', async () => {
    const { deps: resetDeps, recorded } = deps({ production: true });
    const run = vi.spyOn(resetDeps.dataReset, 'run');

    const result = await resetPlatformData(ownerCtx, { confirmation: 'staging' }, resetDeps);

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(run).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('refuses when the live database fingerprint is the production one', async () => {
    const { deps: resetDeps } = deps({
      databaseFingerprint: 'deadbeef1234',
      productionDatabaseFingerprint: 'deadbeef1234',
    });
    const run = vi.spyOn(resetDeps.dataReset, 'run');

    const result = await resetPlatformData(ownerCtx, { confirmation: 'staging' }, resetDeps);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: expect.stringContaining('database fingerprint') },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs when a production fingerprint is configured but does not match', async () => {
    const { deps: resetDeps } = deps({ productionDatabaseFingerprint: 'deadbeef1234' });

    await expect(resetPlatformData(ownerCtx, { confirmation: 'staging' }, resetDeps))
      .resolves.toMatchObject({ ok: true });
  });

  it('requires the environment name as the confirmation', async () => {
    const { deps: resetDeps } = deps();
    const run = vi.spyOn(resetDeps.dataReset, 'run');

    const result = await resetPlatformData(ownerCtx, { confirmation: 'production' }, resetDeps);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(run).not.toHaveBeenCalled();
  });

  it('reseeds, times the run and records a succeeded audit entry', async () => {
    const { deps: resetDeps, recorded } = deps();

    const result = await resetPlatformData(ownerCtx, { confirmation: ' staging ' }, resetDeps);

    expect(result).toEqual({
      ok: true,
      value: {
        environment: 'staging',
        durationMs: 12_500,
        wiped: [{ table: 'members', rows: 12 }],
      },
    });
    expect(recorded).toEqual([{
      id: 'audit-1',
      action: 'platform:data-reset',
      actorUserId: 'user-1',
      actorEmail: 'owner@example.test',
      environment: 'staging',
      status: 'succeeded',
      detail: null,
      durationMs: 12_500,
      createdAt: times[1],
    }]);
  });

  it('records a failed audit entry and hides the internal reason', async () => {
    const { deps: resetDeps, recorded } = deps({
      dataReset: { run: () => Promise.reject(new Error('relation "members" does not exist')) },
    });

    const result = await resetPlatformData(ownerCtx, { confirmation: 'staging' }, resetDeps);

    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(recorded).toMatchObject([{
      status: 'failed',
      detail: 'relation "members" does not exist',
    }]);
  });
});
