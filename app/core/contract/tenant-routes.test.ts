import { describe, expect, it } from 'vitest';

import { tenantCreateInputSchema } from './routes.js';

describe('tenantCreateInputSchema', () => {
  it('uses the tenant name bounds and normalization from the read contract', () => {
    expect(tenantCreateInputSchema.parse({ slug: 'acme', name: '  Acme  ' })).toEqual({
      slug: 'acme',
      name: 'Acme',
    });
    expect(tenantCreateInputSchema.safeParse({ slug: 'acme', name: 'A'.repeat(101) }).success)
      .toBe(false);
  });
});
