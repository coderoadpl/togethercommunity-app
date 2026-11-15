import type { InstanceDescription } from '#core/domain/index.js';

export type InstanceDescriptionDeps = {
  baseDomain: string;
  singleTenantMode: boolean;
  databaseIdentity: string | null;
};

export const describeInstance = (deps: InstanceDescriptionDeps): InstanceDescription => ({
  baseDomain: deps.singleTenantMode ? null : deps.baseDomain,
  singleTenant: deps.singleTenantMode,
  databaseIdentity: deps.databaseIdentity,
});
