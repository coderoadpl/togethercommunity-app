import { describe, expect, it } from 'vitest';
import { installStoryClock } from './story-clock.js';
import { visualSeedTime } from './visual-request-policy.js';

describe('story clock', () => {
  it('preserves native constructors, static methods and restores the previous clock', () => {
    const OriginalDate = Date;
    const restore = installStoryClock();
    try {
      expect(new Date().toISOString()).toBe(visualSeedTime);
      expect(Date.now()).toBe(OriginalDate.parse(visualSeedTime));
      expect(Date()).toBe(new OriginalDate(visualSeedTime).toString());
      expect(new Date(0).getTime()).toBe(0);
      expect(new Date('2024-02-29').getTime()).toBe(new OriginalDate('2024-02-29').getTime());
      expect(new Date(new OriginalDate(42)).getTime()).toBe(42);
      expect(new Date(2024, 1).getTime()).toBe(new OriginalDate(2024, 1).getTime());
      expect(new Date(2024, 1, 29).getTime()).toBe(new OriginalDate(2024, 1, 29).getTime());
      expect(new Date(2024, 1, 29, 12).getTime()).toBe(new OriginalDate(2024, 1, 29, 12).getTime());
      expect(new Date(2024, 1, 29, 12, 34).getTime()).toBe(new OriginalDate(2024, 1, 29, 12, 34).getTime());
      expect(new Date(2024, 1, 29, 12, 34, 56).getTime()).toBe(new OriginalDate(2024, 1, 29, 12, 34, 56).getTime());
      expect(new Date(2024, 1, 29, 12, 34, 56, 789).getTime()).toBe(new OriginalDate(2024, 1, 29, 12, 34, 56, 789).getTime());
      expect(Number.isNaN(new Date('invalid').getTime())).toBe(true);
      expect(Date.UTC(2024, 1, 29)).toBe(OriginalDate.UTC(2024, 1, 29));
      expect(new Date()).toBeInstanceOf(OriginalDate);
    } finally { restore(); }
    expect(Date).toBe(OriginalDate);
  });
});
