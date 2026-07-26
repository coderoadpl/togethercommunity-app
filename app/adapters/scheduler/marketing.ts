import { ok } from '@core/domain/index.js';
import type { SchedulerPort } from '@core/server/index.js';

export interface DevMarketingScheduler extends SchedulerPort {
  setCampaignHandler(handler: (tenantId: string, campaignId: string) => Promise<void>): void;
}

export const createCronMarketingScheduler = (): SchedulerPort => ({
  enqueueCampaignTick: async () => ok(undefined),
  scheduleCampaignTick: async () => ok(undefined),
  enqueueRetentionJobs: async () => ok(undefined),
});

export const createDevMarketingScheduler = (): DevMarketingScheduler => {
  let handler: ((tenantId: string, campaignId: string) => Promise<void>) | null = null;
  const run = (tenantId: string, campaignId: string): void => {
    if (handler !== null) void handler(tenantId, campaignId);
  };
  return {
    setCampaignHandler: (next) => { handler = next; },
    enqueueCampaignTick: async (tenantId, campaignId) => {
      queueMicrotask(() => run(tenantId, campaignId));
      return ok(undefined);
    },
    scheduleCampaignTick: async (tenantId, campaignId, runAt) => {
      const delay = Math.max(0, Math.min(Date.parse(runAt) - Date.now(), 2_147_483_647));
      setTimeout(() => run(tenantId, campaignId), delay).unref();
      return ok(undefined);
    },
    enqueueRetentionJobs: async () => ok(undefined),
  };
};
