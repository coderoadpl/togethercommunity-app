import { z } from 'zod';

import type { EmailEvent } from './email-event.js';
import { campaignSchema, type Campaign } from './marketing-email.js';

export const campaignWithoutStatisticsSchema = campaignSchema.omit({
  candidateCount: true, skipped: true, toSend: true, sent: true, failed: true, errorCount: true,
}).extend({ statisticsUnavailable: z.literal(true) });
export const campaignWithoutStatistics = (campaign: Campaign) => campaignWithoutStatisticsSchema.parse({ ...campaign, statisticsUnavailable: true });

export const sendWithoutEngagement = <T extends { events: EmailEvent[] }>(detail: T): T =>
  ({ ...detail, events: detail.events.filter((event) => event.type !== 'opened' && event.type !== 'clicked') });
