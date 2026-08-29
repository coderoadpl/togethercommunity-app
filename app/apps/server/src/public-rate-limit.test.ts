import { describe, expect, it } from 'vitest';

import { selectPublicRateLimitPolicies } from './public-rate-limit.js';

describe('selectPublicRateLimitPolicies', () => {
  it('throttles production writes conservatively', () => {
    expect(selectPublicRateLimitPolicies({ NODE_ENV: 'production' })).toEqual({
      writesPerIp: { limit: 30, windowMs: 60_000 },
      writesPerTenant: { limit: 300, windowMs: 60_000 },
      authLinksPerEmail: { limit: 5, windowMs: 600_000 },
    });
  });

  it('keeps development and staging generous enough for end-to-end suites', () => {
    expect(selectPublicRateLimitPolicies({})).toMatchObject({
      writesPerIp: { limit: 3_000 },
      authLinksPerEmail: { limit: 500 },
    });
    expect(selectPublicRateLimitPolicies({ NODE_ENV: 'production', APP_ENV: 'staging' }))
      .toMatchObject({ writesPerIp: { limit: 3_000 } });
  });

  it('lets the environment override each bucket, including switching it off', () => {
    expect(selectPublicRateLimitPolicies({
      NODE_ENV: 'production',
      PUBLIC_RATE_LIMIT_WRITES_PER_IP_PER_MINUTE: 10,
      PUBLIC_RATE_LIMIT_WRITES_PER_TENANT_PER_MINUTE: 0,
      PUBLIC_RATE_LIMIT_AUTH_LINKS_PER_EMAIL_PER_10_MINUTES: 2,
    })).toEqual({
      writesPerIp: { limit: 10, windowMs: 60_000 },
      writesPerTenant: { limit: 0, windowMs: 60_000 },
      authLinksPerEmail: { limit: 2, windowMs: 600_000 },
    });
  });
});
