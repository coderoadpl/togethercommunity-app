import { describe, expect, it } from 'vitest';
import { capabilitiesForApiKey, createApiKeyInputSchema } from './api-key.js';
import { activitySummaryQuerySchema, memberActivityQuerySchema } from './activity-report.js';

const from = '1998-08-01T00:00:00Z';
const to = '1998-09-01T00:00:00Z';

describe('read-only report keys', () => {
  it('accepts a report key without expiry and grants only report access', () => {
    expect(createApiKeyInputSchema.safeParse({ name: 'Reporting', scopes: ['report:read'] }).success).toBe(true);
    expect(capabilitiesForApiKey({ scopes: ['report:read'] })).toEqual(['report:read']);
    expect(capabilitiesForApiKey({ scopes: null })).not.toContain('report:read');
  });
  it.each(['enrollment', 'marketing', 'transactional', 'import:content', 'import:users'] as const)('rejects report access combined with %s', (scope) => {
    expect(createApiKeyInputSchema.safeParse({ name: 'Reporting', scopes: ['report:read', scope], expiresAt: to }).success).toBe(false);
    expect(capabilitiesForApiKey({ scopes: [scope] })).not.toContain('report:read');
  });
  it('validates ranges, ISO offsets and pagination limits', () => {
    expect(activitySummaryQuerySchema.parse({ from: '1998-08-01T02:00:00+02:00', to }).from).toBe('1998-08-01T00:00:00.000Z');
    expect(activitySummaryQuerySchema.safeParse({ from: to, to: from }).success).toBe(false);
    expect(activitySummaryQuerySchema.safeParse({ from, to: from }).success).toBe(false);
    expect(memberActivityQuerySchema.safeParse({ from, to, pivot: from, limit: 501 }).success).toBe(false);
    expect(memberActivityQuerySchema.parse({ from, to, pivot: from, limit: '500' }).limit).toBe(500);
  });
});
