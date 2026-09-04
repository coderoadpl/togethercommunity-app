import type { Capability, Identity, ImpersonationPrincipal } from '#core/domain/index.js';

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
