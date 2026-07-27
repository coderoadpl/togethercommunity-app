import { describe, expect, it } from 'vitest';

import { deriveEmailReputation, reputationWindow } from './email-reputation.js';

describe('email reputation', () => {
  it('requires both the send and absolute-event floors', () => {
    expect(deriveEmailReputation({ sends: 99, hardBounces: 9, complaints: 3 })).toMatchObject({
      hardBounce: { status: 'insufficient_data', rate: null },
      complaint: { status: 'insufficient_data', rate: null },
      overallStatus: 'insufficient_data',
    });
    expect(deriveEmailReputation({ sends: 1_000, hardBounces: 4, complaints: 1 })).toMatchObject({
      hardBounce: { status: 'insufficient_data', rate: null },
      complaint: { status: 'insufficient_data', rate: null },
    });
  });

  it('classifies hard-bounce thresholds at five and ten percent', () => {
    expect(deriveEmailReputation({ sends: 1_000, hardBounces: 49, complaints: 2 }).hardBounce.status).toBe('ok');
    expect(deriveEmailReputation({ sends: 1_000, hardBounces: 50, complaints: 2 }).hardBounce.status).toBe('warn');
    expect(deriveEmailReputation({ sends: 1_000, hardBounces: 100, complaints: 2 }).hardBounce.status).toBe('critical');
  });

  it('classifies complaint thresholds at 0.075 and 0.15 percent', () => {
    expect(deriveEmailReputation({ sends: 4_000, hardBounces: 5, complaints: 2 }).complaint.status).toBe('ok');
    expect(deriveEmailReputation({ sends: 4_000, hardBounces: 5, complaints: 3 }).complaint.status).toBe('warn');
    expect(deriveEmailReputation({ sends: 2_000, hardBounces: 5, complaints: 3 }).complaint.status).toBe('critical');
  });

  it('uses the most severe evaluated metric as the overall status', () => {
    expect(deriveEmailReputation({ sends: 4_000, hardBounces: 400, complaints: 2 }).overallStatus).toBe('critical');
    expect(deriveEmailReputation({ sends: 4_000, hardBounces: 5, complaints: 3 }).overallStatus).toBe('warn');
    expect(deriveEmailReputation({ sends: 4_000, hardBounces: 5, complaints: 2 }).overallStatus).toBe('ok');
  });

  it('builds an exact trailing seven-day window', () => {
    expect(reputationWindow('2026-07-27T12:00:00.000Z')).toEqual({
      since: '2026-07-20T12:00:00.000Z',
      until: '2026-07-27T12:00:00.000Z',
    });
  });
});
