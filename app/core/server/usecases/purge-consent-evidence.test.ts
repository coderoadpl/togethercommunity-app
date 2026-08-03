import { describe, expect, it } from 'vitest';

import type { ConsentEvidenceRetentionRepository } from '../ports.js';
import { InMemorySchedulerRunRepository } from '../testing/marketing-fakes.js';
import {
  CONSENT_EVIDENCE_PURGE_INTERVAL_MS,
  consentEvidenceRetentionCutoff,
  purgeExpiredConsentEvidence,
} from './purge-consent-evidence.js';

const WITHDRAWN_AT = '1992-07-21T10:00:00.000Z';
const CUTOFF_AT = new Date('1993-01-01T00:00:00+01:00').toISOString();
const WARSAW_NEW_YEAR_AT = new Date('1993-01-01T00:30:00+01:00').toISOString();

const setup = (now: string) => {
  const clock = { nowIso: () => now };
  const rows = [
    { id: 'terms-1', tenantId: 'tenant-1', retentionStartedAt: WITHDRAWN_AT },
    { id: 'marketing-1', tenantId: 'tenant-1', retentionStartedAt: WITHDRAWN_AT },
    { id: 'marketing-2', tenantId: 'tenant-2', retentionStartedAt: '1993-02-03T00:00:00.000Z' },
    { id: 'terms-cutoff', tenantId: 'tenant-3', retentionStartedAt: CUTOFF_AT },
    { id: 'terms-warsaw-new-year', tenantId: 'tenant-4', retentionStartedAt: WARSAW_NEW_YEAR_AT },
  ];
  const retention: ConsentEvidenceRetentionRepository = {
    listExpiredTenantIds: async (retentionStartedBefore) => [...new Set(rows
      .filter((row) => row.retentionStartedAt < retentionStartedBefore)
      .map((row) => row.tenantId))].sort(),
    purgeExpired: async (tenantId, retentionStartedBefore) => {
      const expired = rows.filter((row) =>
        row.tenantId === tenantId && row.retentionStartedAt < retentionStartedBefore
      );
      for (const row of expired) rows.splice(rows.findIndex((candidate) => candidate.id === row.id), 1);
      return expired.length;
    },
  };
  const runs = new InMemorySchedulerRunRepository();
  let nextId = 0;
  return {
    rows,
    runs,
    advanceTo: (iso: string) => {
      clock.nowIso = () => iso;
    },
    deps: { retention, runs, ids: { nextId: () => `purge-id-${String(++nextId)}` }, clock },
  };
};

describe('consent evidence retention purge', () => {
  it('retains evidence through December 31, purges on January 1, and is idempotent', async () => {
    const { rows, runs, advanceTo, deps } = setup('1998-12-31T23:59:59.999Z');
    const input = { trigger: 'cron' as const, minIntervalMs: 0 };

    await expect(purgeExpiredConsentEvidence(input, deps)).resolves.toEqual({
      ok: true,
      value: { purged: 0, tenantsProcessed: 0 },
    });
    expect(rows).toHaveLength(5);

    advanceTo('1999-01-01T00:00:00.000Z');
    await expect(purgeExpiredConsentEvidence(input, deps)).resolves.toEqual({
      ok: true,
      value: { purged: 2, tenantsProcessed: 1 },
    });
    await expect(purgeExpiredConsentEvidence(input, deps)).resolves.toEqual({
      ok: true,
      value: { purged: 0, tenantsProcessed: 0 },
    });
    expect(rows).toEqual([
      { id: 'marketing-2', tenantId: 'tenant-2', retentionStartedAt: '1993-02-03T00:00:00.000Z' },
      { id: 'terms-cutoff', tenantId: 'tenant-3', retentionStartedAt: CUTOFF_AT },
      { id: 'terms-warsaw-new-year', tenantId: 'tenant-4', retentionStartedAt: WARSAW_NEW_YEAR_AT },
    ]);

    const page = await runs.listPage({ kind: 'consent_evidence_purge', limit: 10 });
    expect(page.runs).toHaveLength(3);
    expect(page.runs.every((run) => run.status === 'completed' && run.trigger === 'cron')).toBe(true);
    const details = await Promise.all(page.runs.map((run) => runs.getWithTenants(run.id)));
    expect(details.find((detail) => detail?.tenants.length === 1)).toMatchObject({
      tenants: [{ tenantId: 'tenant-1', batchSize: 2 }],
    });
  });

  it('attributes retention starts to the Warsaw year and keeps the cutoff instant', async () => {
    const { rows, advanceTo, deps } = setup('1999-01-01T00:00:00.000Z');
    const input = { trigger: 'cron' as const, minIntervalMs: 0 };

    expect(consentEvidenceRetentionCutoff('1999-01-01T00:00:00.000Z')).toBe(CUTOFF_AT);
    await purgeExpiredConsentEvidence(input, deps);
    expect(rows).toEqual(expect.arrayContaining([
      { id: 'terms-cutoff', tenantId: 'tenant-3', retentionStartedAt: CUTOFF_AT },
      { id: 'terms-warsaw-new-year', tenantId: 'tenant-4', retentionStartedAt: WARSAW_NEW_YEAR_AT },
    ]));

    advanceTo('2000-01-01T00:00:00.000Z');
    await expect(purgeExpiredConsentEvidence(input, deps)).resolves.toEqual({
      ok: true,
      value: { purged: 3, tenantsProcessed: 3 },
    });
    expect(rows).toEqual([]);
  });

  it('records one run per interval so a per-minute scheduler tick does not rescan', async () => {
    const { runs, advanceTo, deps } = setup('1999-01-01T00:00:00.000Z');
    const input = { trigger: 'cron' as const, minIntervalMs: CONSENT_EVIDENCE_PURGE_INTERVAL_MS };

    await purgeExpiredConsentEvidence(input, deps);
    advanceTo('1999-01-01T00:01:00.000Z');
    await expect(purgeExpiredConsentEvidence(input, deps)).resolves.toEqual({
      ok: true,
      value: { purged: 0, tenantsProcessed: 0 },
    });
    expect((await runs.listPage({ kind: 'consent_evidence_purge', limit: 10 })).runs).toHaveLength(1);

    advanceTo('1999-01-02T00:00:00.000Z');
    await purgeExpiredConsentEvidence(input, deps);
    expect((await runs.listPage({ kind: 'consent_evidence_purge', limit: 10 })).runs).toHaveLength(2);
  });

  it.each(['manual', 'dev'] as const)('%s runs bypass the cron interval', async (trigger) => {
    const { runs, advanceTo, deps } = setup('1999-01-01T00:00:00.000Z');
    await purgeExpiredConsentEvidence({ trigger: 'cron', minIntervalMs: CONSENT_EVIDENCE_PURGE_INTERVAL_MS }, deps);

    advanceTo('1999-01-01T00:01:00.000Z');
    await expect(purgeExpiredConsentEvidence({ trigger, minIntervalMs: CONSENT_EVIDENCE_PURGE_INTERVAL_MS }, deps))
      .resolves.toEqual({ ok: true, value: { purged: 0, tenantsProcessed: 0 } });
    const page = await runs.listPage({ kind: 'consent_evidence_purge', limit: 10 });
    expect(page.runs).toHaveLength(2);
    expect(page.runs[0]?.trigger).toBe(trigger);
  });

  it('reports the failing tenant, keeps purging the rest, and finalizes the run as failed', async () => {
    const { runs, deps } = setup('2000-01-01T00:00:00.000Z');
    const retention: ConsentEvidenceRetentionRepository = {
      listExpiredTenantIds: async (before) => deps.retention.listExpiredTenantIds(before),
      purgeExpired: async (tenantId, before) => {
        if (tenantId === 'tenant-1') throw new Error('deadlock detected');
        return deps.retention.purgeExpired(tenantId, before);
      },
    };

    const input = { trigger: 'manual' as const, minIntervalMs: 0 };
    await expect(purgeExpiredConsentEvidence(input, { ...deps, retention })).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'deadlock detected' },
    });
    const [run] = (await runs.listPage({ kind: 'consent_evidence_purge', limit: 10 })).runs;
    expect(run).toMatchObject({ status: 'failed', error: 'deadlock detected' });
    expect((await runs.getWithTenants(run?.id ?? ''))?.tenants).toMatchObject([
      { tenantId: 'tenant-1', batchSize: 0, errors: ['deadlock detected'] },
      { tenantId: 'tenant-2', batchSize: 1, errors: [] },
      { tenantId: 'tenant-3', batchSize: 1, errors: [] },
      { tenantId: 'tenant-4', batchSize: 1, errors: [] },
    ]);
  });
});
