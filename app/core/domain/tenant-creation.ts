export type TenantCreationMode = 'open' | 'bootstrap' | 'closed';

export type TenantCreationVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'principal' | 'closed' | 'bootstrap-complete' };

export const decideTenantCreation = (input: {
  principalAllowed: boolean;
  mode: TenantCreationMode;
  hasAnyTenant: boolean;
}): TenantCreationVerdict => {
  if (!input.principalAllowed) return { allowed: false, reason: 'principal' };
  if (input.mode === 'closed') return { allowed: false, reason: 'closed' };
  if (input.mode === 'bootstrap' && input.hasAnyTenant) {
    return { allowed: false, reason: 'bootstrap-complete' };
  }
  return { allowed: true };
};
