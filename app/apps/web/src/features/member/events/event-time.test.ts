import { describe, expect, it } from 'vitest';

import { formatEventRange, hasEnded } from './event-time.js';

describe('formatEventRange', () => {
  it('keeps a single-day event on one date and drops the repeated day', () => {
    const range = formatEventRange(
      '2026-09-10T16:00:00.000Z',
      '2026-09-10T17:30:00.000Z',
      'pl',
    );
    expect(range.split(' – ')).toHaveLength(2);
    const [start, end] = range.split(' – ');
    expect(start).toContain('2026');
    expect(end).not.toContain('2026');
  });

  it('spells out both dates when the event spans more than a day', () => {
    const range = formatEventRange(
      '2026-09-10T16:00:00.000Z',
      '2026-09-11T16:00:00.000Z',
      'pl',
    );
    const [start, end] = range.split(' – ');
    expect(start).toContain('2026');
    expect(end).toContain('2026');
    expect(start).not.toBe(end);
  });
});

describe('hasEnded', () => {
  const nowMs = Date.parse('2026-09-10T18:00:00.000Z');

  it('is false while the event is still running', () => {
    expect(hasEnded('2026-09-10T19:00:00.000Z', nowMs)).toBe(false);
  });

  it('is true once the end time passed', () => {
    expect(hasEnded('2026-09-10T17:59:00.000Z', nowMs)).toBe(true);
  });
});
