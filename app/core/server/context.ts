import type { Capability, Identity, ImpersonationPrincipal, OrganizationRole } from '#core/domain/index.js';

/** Every tenant-scoped use-case takes this as its first argument. */
export interface Ctx {
  identity: Identity;
  capabilities?: readonly Capability[];
  /**
   * Present only while an operator views the community as a member: `identity`
   * then resolves the subject, while this carries the acting staff account.
   */
  impersonation?: ImpersonationPrincipal;
}

/** Every organisation-scoped use-case takes this as its first argument. */
export interface OrganizationCtx {
  identity: Pick<Identity, 'userId' | 'email' | 'emailVerified'>;
  /** Read from the store for this request only; never cached across requests. */
  membership: { organizationId: string; role: OrganizationRole } | null;
  capabilities?: readonly Capability[];
}
