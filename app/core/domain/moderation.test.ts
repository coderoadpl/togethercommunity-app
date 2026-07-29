import { describe, expect, it } from 'vitest';

import {
  LINK_COUNT_FLAG_THRESHOLD,
  MAX_REPORT_NOTE_LENGTH,
  countLinks,
  heuristicSignalsFor,
  normalizeBodyForDuplicate,
  postReportSchema,
  reportPostInputSchema,
} from './moderation.js';

describe('moderation domain', () => {
  it('counts http, https, and bare www links', () => {
    expect(countLinks('See [one](https://one.test), http://two.test and www.three.test/x')).toBe(3);
    expect(countLinks('not-a-link.example')).toBe(0);
  });

  it('normalizes duplicate bodies idempotently', () => {
    const normalized = normalizeBodyForDuplicate('  Hello, WORLD!!!  A  test. ');
    expect(normalized).toBe('hello world a test');
    expect(normalizeBodyForDuplicate(normalized)).toBe(normalized);
  });

  it('flags links at the threshold', () => {
    const links = Array.from({ length: LINK_COUNT_FLAG_THRESHOLD }, (_, index) => `https://x${index}.test`);
    expect(heuristicSignalsFor({ body: links.slice(1).join(' '), recentBodies: [] })).toEqual([]);
    expect(heuristicSignalsFor({ body: links.join(' '), recentBodies: [] })).toContain('link-flood');
  });

  it('flags long normalized duplicates but exempts short bodies', () => {
    expect(heuristicSignalsFor({
      body: 'This is repeated meaningful content.',
      recentBodies: ['This is repeated, meaningful content!'],
    })).toContain('duplicate-body');
    expect(heuristicSignalsFor({ body: 'Thanks!', recentBodies: ['thanks'] })).toEqual([]);
  });

  it('round-trips a report and rejects an oversized note', () => {
    expect(postReportSchema.parse({
      id: 'r1',
      tenantId: 't1',
      postId: 'p1',
      reporterUserId: 'u1',
      reporterDisplay: 'Member',
      source: 'member',
      reason: 'spam',
      note: null,
      signals: null,
      status: 'open',
      createdAt: '2026-07-29T00:00:00.000Z',
      resolvedAt: null,
      resolvedByUserId: null,
    }).id).toBe('r1');
    expect(reportPostInputSchema.safeParse({
      postId: 'p1',
      reason: 'other',
      note: 'x'.repeat(MAX_REPORT_NOTE_LENGTH + 1),
    }).success).toBe(false);
  });
});
