import { describe, expect, it } from 'vitest';

import { envSchema } from './env.js';

describe('tenant creation policy', () => {
  it('defaults closed and accepts only declared modes', () => {
    const defaults = envSchema.parse({});

    expect(defaults.TENANT_CREATION).toBe('closed');
    expect(envSchema.safeParse({ TENANT_CREATION: 'open' }).success).toBe(true);
    expect(envSchema.safeParse({ TENANT_CREATION: 'staff' }).success).toBe(false);
  });
});
