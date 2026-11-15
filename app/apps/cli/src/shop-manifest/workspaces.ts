import type { ApiClient } from '#core/client/index.js';
import { err, ok, type AppError, type Result } from '#core/domain/index.js';
import { manifestOperationError } from './plan.js';

type OperatorClient = Pick<ApiClient, 'provisionOperatorTenant'>;

export const readConfirmedWorkspaces = async (account: Pick<ApiClient, 'listTenants'>): Promise<Result<Set<string>, AppError>> => {
  const listing = await account.listTenants();
  if (!listing.ok) return err(manifestOperationError(listing.error, null, 'account:workspaces'));
  return ok(new Set([
    ...listing.value.tenants.map((membership) => membership.tenant.slug),
    ...listing.value.memberTenants.map((tenant) => tenant.slug),
  ]));
};

export const confirmingOperator = (operator: OperatorClient, confirmed: Set<string>): OperatorClient => ({
  provisionOperatorTenant: async (input, secret) => {
    const result = await operator.provisionOperatorTenant(input, secret);
    if (result.ok && result.value.tenant.slug === input.slug) confirmed.add(input.slug);
    return result;
  },
});
