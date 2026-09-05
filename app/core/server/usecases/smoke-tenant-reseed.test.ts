import { describe, expect, it } from 'vitest';

import {
  SMOKE_TENANT_ID,
  SmokeTenantReseedRefused,
  type PlatformAuditEvent,
} from '#core/domain/index.js';

import { reseedSmokeTenant, type SmokeTenantReseedDeps } from './smoke-tenant-reseed.js';

const deps = (
  run: SmokeTenantReseedDeps['reseed']['run'],
): { deps: SmokeTenantReseedDeps; recorded: PlatformAuditEvent[] } => {
  const recorded: PlatformAuditEvent[] = [];
  return {
    recorded,
    deps: {
      reseed: { run },
      platformAudit: {
        record: async (event) => {
          recorded.push(event);
        },
      },
      environment: 'production',
      ids: { nextId: () => 'audit-1' },
      clock: { nowIso: () => '2026-09-05T12:00:00.000Z' },
    },
  };
};

describe('reseedSmokeTenant', () => {
  it('reports the wipe and records a reseed-acme audit event', async () => {
    const harness = deps(async () => ({
      tenantId: SMOKE_TENANT_ID,
      wiped: [{ table: 'members', rows: 2 }],
    }));

    const result = await reseedSmokeTenant(harness.deps);

    expect(result).toEqual({
      ok: true,
      value: {
        tenantId: SMOKE_TENANT_ID,
        environment: 'production',
        durationMs: 0,
        wiped: [{ table: 'members', rows: 2 }],
      },
    });
    expect(harness.recorded).toEqual([expect.objectContaining({
      action: 'reseed-acme',
      environment: 'production',
      status: 'succeeded',
      detail: null,
    })]);
  });

  it('reports a refusal to the caller instead of an infrastructure failure', async () => {
    const harness = deps(async () => {
      throw new SmokeTenantReseedRefused(
        'Smoke tenant reseed refused because tenant-acme has a member outside @together.dev',
      );
    });

    const result = await reseedSmokeTenant(harness.deps);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'conflict',
        message: expect.stringContaining('has a member outside @together.dev'),
      },
    });
    expect(harness.recorded).toEqual([expect.objectContaining({
      action: 'reseed-acme',
      status: 'failed',
      detail: expect.stringContaining('outside @together.dev'),
    })]);
  });

  it('keeps an unexpected failure opaque', async () => {
    const harness = deps(async () => {
      throw new Error('connection terminated unexpectedly');
    });

    const result = await reseedSmokeTenant(harness.deps);

    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'Smoke tenant reseed failed' },
    });
    expect(harness.recorded).toEqual([expect.objectContaining({
      status: 'failed',
      detail: 'connection terminated unexpectedly',
    })]);
  });
});
