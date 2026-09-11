import { describe, expect, it } from 'vitest';

import { MARKETING_RETENTION_DAYS, marketingRetentionCutoff } from './marketing-retention.js';

describe('marketingRetentionCutoff', () => {
  it.each([
    { days: MARKETING_RETENTION_DAYS.rawSnsInboxDays, cutoff: '2026-09-03T10:15:30.000Z' },
    { days: MARKETING_RETENTION_DAYS.renderedBodiesDays, cutoff: '2026-08-27T10:15:30.000Z' },
    { days: MARKETING_RETENTION_DAYS.engagementEventsDays, cutoff: '2026-08-11T10:15:30.000Z' },
    { days: MARKETING_RETENTION_DAYS.schedulerIdleRunsDays, cutoff: '2026-09-08T10:15:30.000Z' },
  ])('subtracts $days days from the reference instant', ({ days, cutoff }) => {
    expect(marketingRetentionCutoff('2026-09-10T10:15:30.000Z', days)).toBe(cutoff);
  });

  it('normalizes a non-UTC reference instant to UTC', () => {
    expect(marketingRetentionCutoff('2026-09-10T12:15:30.000+02:00', 1)).toBe('2026-09-09T10:15:30.000Z');
  });

  it('crosses a daylight saving boundary by exact elapsed time', () => {
    expect(marketingRetentionCutoff('2026-10-26T00:30:00.000Z', 1)).toBe('2026-10-25T00:30:00.000Z');
  });

  it('returns the reference instant for a zero window', () => {
    expect(marketingRetentionCutoff('2026-09-10T10:15:30.000Z', 0)).toBe('2026-09-10T10:15:30.000Z');
  });
});
