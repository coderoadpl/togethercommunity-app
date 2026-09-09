import { createContentHash } from '../crypto/content-hash.js';
import { createCronMarketingScheduler } from '../scheduler/marketing.js';
import { createDeliveryFixture } from './marketing-delivery-test-fixture.js';
import { createMarketingImportTransaction, createMarketingImportTransactionRepos } from './marketing-contact-transactions.js';
import { createMarketingContactAudienceRepository } from './marketing-contact-audience.js';
import { createMarketingContactCampaignTransaction } from './marketing-contact-campaign-transactions.js';
import { createMarketingAudienceRepository } from './marketing-repositories.js';
import { createSchedulerRunRepository } from './scheduler-runs.js';

export const createContactCampaignFixture = async () => {
  const fixture = await createDeliveryFixture();
  const infrastructure = { clock: fixture.deps.clock, ids: fixture.deps.ids, hmac: fixture.deps.hmac, contentHash: createContentHash() };
  const directory = { ...createMarketingImportTransactionRepos(fixture.db, infrastructure), ...infrastructure, transaction: createMarketingImportTransaction(fixture.db, infrastructure) };
  const contactAudienceDeps = { directory, clock: infrastructure.clock, contactAudience: createMarketingContactAudienceRepository(fixture.db, infrastructure), contactCampaigns: createMarketingContactCampaignTransaction(fixture.db, infrastructure) };
  const deps = { ...fixture.deps, contactAudienceDeps, contactAudience: contactAudienceDeps.contactAudience, contacts: directory.contacts, audience: createMarketingAudienceRepository(fixture.db), scheduler: createCronMarketingScheduler(), runs: createSchedulerRunRepository(fixture.db) };
  return { ...fixture, directory, deps };
};
