import { describe, expect, it } from 'vitest';

import { toPublicDeepHealthReport, type DeepHealthReport } from './deep-health.js';

const checkedAt = '2026-09-07T10:00:00.000Z';

const report = (storageCors: DeepHealthReport['storageCors']): DeepHealthReport => ({
  ok: true,
  checkedAt,
  tenants: 2,
  failing: [],
  warnings: [],
  checks: [{
    name: 'storage-cors',
    ok: true,
    ms: 12,
    subjects: 2,
    error: null,
    skipped: null,
  }],
  storageCors,
});

describe('toPublicDeepHealthReport', () => {
  it('aggregates storage CORS without exposing per-tenant origins or counts', () => {
    const publicReport = toPublicDeepHealthReport(report([{
      tenantId: 'tenant-1',
      cached: false,
      results: [
        { origin: 'https://courses.example.org', status: 'ok' },
        { origin: 'https://members.example.org', status: 'blocked' },
      ],
    }]));
    const serialized = JSON.stringify(publicReport);

    expect(publicReport).toEqual({
      ok: true,
      checkedAt,
      failing: [],
      warnings: [],
      storageCors: 'warning',
      checks: [{ name: 'storage-cors', ok: true, ms: 12, error: null, skipped: null }],
    });
    expect(serialized).not.toContain('tenant-1');
    expect(serialized).not.toContain('courses.example.org');
    expect(serialized).not.toContain('members.example.org');
    expect(serialized).not.toContain('tenantId');
    expect(serialized).not.toContain('results');
    expect(serialized).not.toContain('tenants');
    expect(serialized).not.toContain('subjects');
  });

  it('reports storage CORS as not applicable when no tenant was probed', () => {
    expect(toPublicDeepHealthReport(report([])).storageCors).toBe('not-applicable');
  });
});
