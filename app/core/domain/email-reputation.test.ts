import { describe, expect, it } from 'vitest';

import {
  deriveEmailReputation,
  reputationAlertDecision,
  reputationWindow,
} from './email-reputation.js';

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
    expect(deriveEmailReputation({ sends: 1_300, hardBounces: 5, complaints: 2 }).complaint.status).toBe('insufficient_data');
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

  it('alerts on degradation, throttles repeats, and clears the cursor on recovery', () => {
    const now = '2026-07-27T12:00:00.000Z';
    const day = 24 * 60 * 60 * 1000;
    expect(reputationAlertDecision({
      current: 'warn',
      lastAlerted: null,
      lastAlertedAt: null,
      now,
      repeatAfterMs: day,
    })).toEqual({ notify: true, nextStatus: 'warn', nextAlertedAt: now });
    expect(reputationAlertDecision({
      current: 'critical',
      lastAlerted: 'warn',
      lastAlertedAt: now,
      now,
      repeatAfterMs: day,
    })).toEqual({ notify: true, nextStatus: 'critical', nextAlertedAt: now });
    expect(reputationAlertDecision({
      current: 'critical',
      lastAlerted: 'critical',
      lastAlertedAt: now,
      now: '2026-07-28T11:59:59.999Z',
      repeatAfterMs: day,
    })).toEqual({
      notify: false,
      nextStatus: 'critical',
      nextAlertedAt: now,
    });
    expect(reputationAlertDecision({
      current: 'critical',
      lastAlerted: 'critical',
      lastAlertedAt: now,
      now: '2026-07-28T12:00:00.000Z',
      repeatAfterMs: day,
    })).toEqual({
      notify: true,
      nextStatus: 'critical',
      nextAlertedAt: '2026-07-28T12:00:00.000Z',
    });
    for (const current of ['ok', 'insufficient_data'] as const) {
      expect(reputationAlertDecision({
        current,
        lastAlerted: 'warn',
        lastAlertedAt: now,
        now,
        repeatAfterMs: day,
      })).toEqual({ notify: false, nextStatus: null, nextAlertedAt: null });
    }
  });
});
