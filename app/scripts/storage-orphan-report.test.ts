import { describe, expect, it } from 'vitest';

import { parseStorageReportArgs } from './storage-orphan-report.js';

describe('storage report arguments', () => {
  it('defaults to a 24-hour report and supports JSON and an explicit grace period', () => {
    expect(parseStorageReportArgs(['--tenant', 'acme'])).toMatchObject({
      help: false, json: false, input: { tenantId: 'acme', graceHours: 24 },
    });
    expect(parseStorageReportArgs(['--tenant', 'acme', '--json', '--grace-hours', '72'])).toMatchObject({
      help: false, json: true, input: { tenantId: 'acme', graceHours: 72 },
    });
  });

  it('rejects apply mode, missing tenant and invalid grace periods', () => {
    for (const args of [[], ['--tenant', 'acme', '--apply'], ['--tenant', 'acme', '--grace-hours', '-1'],
      ['--tenant', 'acme', '--grace-hours', 'invalid']]) {
      expect(() => parseStorageReportArgs(args)).toThrow();
    }
  });

  it('offers help without requiring credentials', () => {
    expect(parseStorageReportArgs(['--help'])).toEqual({ help: true });
  });
});
