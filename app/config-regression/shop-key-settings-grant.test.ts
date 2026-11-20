import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const usecases = join(import.meta.dirname, '..', 'core', 'server', 'usecases');

describe('shop management key settings grant', () => {
  it('is named only by the shop settings update and the branding asset upload', () => {
    const naming = readdirSync(usecases)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => {
        const source = readFileSync(join(usecases, file), 'utf8');
        return source.includes("'tenant:settings:write'") && source.includes('ShopManagementKeySettingsGrant');
      });
    expect(naming).toEqual(['image-assets.ts', 'shop-settings.ts', 'tenant-settings.ts']);
  });
});
