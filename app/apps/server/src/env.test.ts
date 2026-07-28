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

describe('database driver policy', () => {
  it('rejects neon-http while runtime adapters require interactive transactions', () => {
    const parsed = envSchema.safeParse({ DB_DRIVER: 'neon-http' });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.DB_DRIVER).toContain(
        'DB_DRIVER must be node-postgres because runtime adapters require interactive transactions',
      );
    }
  });
});
