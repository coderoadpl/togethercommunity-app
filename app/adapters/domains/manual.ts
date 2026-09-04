import { ok } from '#core/domain/index.js';
import type { DomainProvisioner } from '#core/server/index.js';

/**
 * No provisioning API is configured, so the row itself is the whole record and
 * an operator flips `verified` once DNS points at the deployment. Self-hosted
 * installs behind their own proxy run on this permanently.
 */
export const createManualDomainProvisioner = (): DomainProvisioner => ({
  provider: 'manual',
  add: async () => ok({ verification: [], verified: false }),
  status: async () => ok({ verified: false, misconfigured: false, verification: [] }),
  verify: async () => ok({ verified: false, misconfigured: false, verification: [] }),
  remove: async () => ok(undefined),
});
