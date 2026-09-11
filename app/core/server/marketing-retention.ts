export const MARKETING_RETENTION_DAYS = {
  rawSnsInboxDays: 7,
  renderedBodiesDays: 14,
  engagementEventsDays: 30,
  pendingConsentsDays: 30,
  schedulerRunsDays: 14,
  schedulerIdleRunsDays: 2,
} as const;

export const marketingRetentionCutoff = (now: string, days: number): string =>
  new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
