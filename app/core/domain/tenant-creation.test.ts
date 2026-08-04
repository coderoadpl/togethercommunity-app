import { describe, expect, it } from 'vitest';

import { decideTenantCreation, type TenantCreationMode } from './tenant-creation.js';

describe('tenant creation policy', () => {
  it.each([
    { principalAllowed: true, mode: 'open', hasAnyTenant: false, allowed: true },
    { principalAllowed: true, mode: 'open', hasAnyTenant: true, allowed: true },
    { principalAllowed: true, mode: 'bootstrap', hasAnyTenant: false, allowed: true },
    { principalAllowed: true, mode: 'bootstrap', hasAnyTenant: true, allowed: false },
    { principalAllowed: true, mode: 'closed', hasAnyTenant: false, allowed: false },
    { principalAllowed: false, mode: 'open', hasAnyTenant: false, allowed: false },
  ] satisfies Array<{
    principalAllowed: boolean;
    mode: TenantCreationMode;
    hasAnyTenant: boolean;
    allowed: boolean;
  }>)('returns $allowed for $mode with principal=$principalAllowed and existing=$hasAnyTenant', (input) => {
    expect(decideTenantCreation(input).allowed).toBe(input.allowed);
  });

  it('preserves principal denial precedence', () => {
    expect(decideTenantCreation({
      principalAllowed: false,
      mode: 'closed',
      hasAnyTenant: true,
    })).toEqual({ allowed: false, reason: 'principal' });
  });
});
