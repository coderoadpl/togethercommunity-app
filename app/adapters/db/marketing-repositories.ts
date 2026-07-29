import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import {
  automationIdempotencyKeySchema,
  campaignSchema,
  campaignSendSchema,
  consentConfirmationTokenSchema,
  consentDefinitionSchema,
  consentDefinitionVersionSchema,
  emailLayoutSchema,
  emailEventSchema,
  marketingConsentSchema,
  normalizeEmail,
  suppressionSchema,
  tenantDocumentSchema,
  tenantDocumentVersionSchema,
  tenantSesSettingsSchema,
  unsubscribeTokenSchema,
  type Campaign,
  type CampaignEngagementStats,
  type CampaignSend,
} from '#core/domain/index.js';
import type {
  AutomationIdempotencyRepository,
  CampaignRepository,
  CampaignSendRepository,
  ConsentConfirmationTokenRepository,
  ConsentDefinitionRepository,
  EmailLayoutRepository,
  MarketingAudienceRepository,
  MarketingConsentRepository,
  MarketingJobRepository,
  MarketingThrottleRepository,
  SuppressionRepository,
  TenantDocumentRepository,
  TenantSesSettingsRepository,
  UnsubscribeTokenRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import {
  campaigns,
  campaignSends,
  consentConfirmationTokens,
  consentDefinitions,
  consentDefinitionVersions,
  emailLayouts,
  emailEvents,
  marketingConsents,
  marketingIdempotencyKeys,
  marketingThrottleBuckets,
  members,
  productGrants,
  suppressions,
  tenantDocuments,
  tenantDocumentVersions,
  tenantSesSettings,
  unsubscribeTokens,
} from './schema.js';
import { uniqueViolation } from './pg-errors.js';

const iso = (value: string): string => new Date(value).toISOString();
const nullableIso = (value: string | null): string | null => value === null ? null : iso(value);
const parseConsent = (row: typeof marketingConsents.$inferSelect) => marketingConsentSchema.parse({ ...row, occurredAt: iso(row.occurredAt) });
const parseConfirmation = (row: typeof consentConfirmationTokens.$inferSelect) => consentConfirmationTokenSchema.parse({
  ...row, createdAt: iso(row.createdAt), expiresAt: iso(row.expiresAt), usedAt: nullableIso(row.usedAt),
});
const parseDefinition = (row: typeof consentDefinitions.$inferSelect) => consentDefinitionSchema.parse({
  ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
});
const parseDefinitionVersion = (row: typeof consentDefinitionVersions.$inferSelect) => consentDefinitionVersionSchema.parse({ ...row, createdAt: iso(row.createdAt) });
const parseLayout = (row: typeof emailLayouts.$inferSelect) => emailLayoutSchema.parse({
  ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
});
const parseDocument = (row: typeof tenantDocuments.$inferSelect) => tenantDocumentSchema.parse({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });
const parseDocumentVersion = (row: typeof tenantDocumentVersions.$inferSelect) => tenantDocumentVersionSchema.parse({
  ...row, publishedAt: nullableIso(row.publishedAt), createdAt: iso(row.createdAt),
});
const parseCampaign = (row: typeof campaigns.$inferSelect) => campaignSchema.parse({
  ...row, sendAt: nullableIso(row.sendAt), lockedUntil: nullableIso(row.lockedUntil),
  startedAt: nullableIso(row.startedAt), finishedAt: nullableIso(row.finishedAt), createdAt: iso(row.createdAt),
});
const parseSend = (row: typeof campaignSends.$inferSelect) => campaignSendSchema.parse({
  ...row, deliveryOccurredAt: nullableIso(row.deliveryOccurredAt), renderedBodyPurgedAt: nullableIso(row.renderedBodyPurgedAt),
  createdAt: iso(row.createdAt), sentAt: nullableIso(row.sentAt),
});
const parseSuppression = (row: typeof suppressions.$inferSelect) => suppressionSchema.parse({
  ...row, createdAt: iso(row.createdAt), liftedAt: nullableIso(row.liftedAt),
});
const parseUnsubscribe = (row: typeof unsubscribeTokens.$inferSelect) => unsubscribeTokenSchema.parse({
  ...row, createdAt: iso(row.createdAt), usedAt: nullableIso(row.usedAt),
});
const parseSesSettings = (row: typeof tenantSesSettings.$inferSelect) => tenantSesSettingsSchema.parse({
  ...row, identityVerifiedAt: nullableIso(row.identityVerifiedAt), identityCheckedAt: nullableIso(row.identityCheckedAt),
  quotaRefreshedAt: nullableIso(row.quotaRefreshedAt), webhookVerifiedAt: nullableIso(row.webhookVerifiedAt),
  reputationAlertedAt: nullableIso(row.reputationAlertedAt),
});
const parseIdempotency = (row: typeof marketingIdempotencyKeys.$inferSelect) => automationIdempotencyKeySchema.parse({
  ...row, claimedAt: iso(row.claimedAt), expiresAt: iso(row.expiresAt),
});

export const createMarketingConsentRepository = (db: Db): MarketingConsentRepository => ({
  record: async (tenantId, consent) => {
    await db.insert(marketingConsents).values(marketingConsentSchema.parse({ ...consent, tenantId }));
  },
  listByEmail: async (tenantId, email, definitionId) => {
    const filters = [eq(marketingConsents.tenantId, tenantId), eq(marketingConsents.email, normalizeEmail(email))];
    if (definitionId !== undefined) filters.push(eq(marketingConsents.definitionId, definitionId));
    const rows = await db.select().from(marketingConsents).where(and(...filters)).orderBy(asc(marketingConsents.occurredAt), asc(marketingConsents.id));
    return rows.map(parseConsent);
  },
  latestByEmail: async (tenantId, email, definitionId) => {
    const [row] = await db.select().from(marketingConsents).where(and(
      eq(marketingConsents.tenantId, tenantId),
      eq(marketingConsents.email, normalizeEmail(email)),
      eq(marketingConsents.definitionId, definitionId),
    )).orderBy(desc(marketingConsents.occurredAt), desc(marketingConsents.id)).limit(1);
    return row === undefined ? null : parseConsent(row);
  },
  findById: async (tenantId, consentId) => {
    const [row] = await db.select().from(marketingConsents).where(and(eq(marketingConsents.tenantId, tenantId), eq(marketingConsents.id, consentId))).limit(1);
    return row === undefined ? null : parseConsent(row);
  },
  purgeStalePending: async (tenantId, olderThan, definitionIds) => {
    if (definitionIds.length === 0) return 0;
    const deleted = await db.delete(marketingConsents).where(and(
      eq(marketingConsents.tenantId, tenantId),
      inArray(marketingConsents.definitionId, definitionIds),
      eq(marketingConsents.status, 'granted'),
      lt(marketingConsents.occurredAt, olderThan),
      sql`not exists (select 1 from ${marketingConsents} newer where newer.tenant_id = ${marketingConsents.tenantId} and newer.previous_id = ${marketingConsents.id})`,
    )).returning({ id: marketingConsents.id });
    return deleted.length;
  },
});

export const createConsentConfirmationTokenRepository = (db: Db): ConsentConfirmationTokenRepository => ({
  create: async (tenantId, token) => {
    await db.insert(consentConfirmationTokens).values(consentConfirmationTokenSchema.parse({ ...token, tenantId }));
  },
  findByToken: async (tenantId, token) => {
    const [row] = await db.select().from(consentConfirmationTokens).where(and(eq(consentConfirmationTokens.tenantId, tenantId), eq(consentConfirmationTokens.token, token))).limit(1);
    return row === undefined ? null : parseConfirmation(row);
  },
  consume: async (tenantId, token, usedAt) => {
    const [row] = await db.update(consentConfirmationTokens).set({ usedAt }).where(and(
      eq(consentConfirmationTokens.tenantId, tenantId), eq(consentConfirmationTokens.token, token),
      isNull(consentConfirmationTokens.usedAt), gt(consentConfirmationTokens.expiresAt, usedAt),
    )).returning();
    return row === undefined ? null : parseConfirmation(row);
  },
});

export const createConsentDefinitionRepository = (db: Db): ConsentDefinitionRepository => ({
  create: async (tenantId, definition, version) => {
    await db.transaction(async (tx) => {
      await tx.insert(consentDefinitions).values(consentDefinitionSchema.parse({ ...definition, tenantId }));
      await tx.insert(consentDefinitionVersions).values(consentDefinitionVersionSchema.parse({ ...version, tenantId, definitionId: definition.id }));
    });
  },
  findById: async (tenantId, definitionId) => {
    const [row] = await db.select().from(consentDefinitions).where(and(eq(consentDefinitions.tenantId, tenantId), eq(consentDefinitions.id, definitionId))).limit(1);
    return row === undefined ? null : parseDefinition(row);
  },
  list: async (tenantId, status) => {
    const condition = status === undefined
      ? eq(consentDefinitions.tenantId, tenantId)
      : and(eq(consentDefinitions.tenantId, tenantId), eq(consentDefinitions.status, status));
    return (await db.select().from(consentDefinitions).where(condition).orderBy(asc(consentDefinitions.key)))
      .map(parseDefinition);
  },
  update: async (tenantId, definition) => {
    const parsed = consentDefinitionSchema.parse({ ...definition, tenantId });
    const [row] = await db.update(consentDefinitions).set(parsed).where(and(
      eq(consentDefinitions.tenantId, tenantId), eq(consentDefinitions.id, parsed.id),
    )).returning();
    return row === undefined ? null : parseDefinition(row);
  },
  appendVersion: async (tenantId, version) => {
    await db.insert(consentDefinitionVersions).values(consentDefinitionVersionSchema.parse({ ...version, tenantId }));
  },
  listVersions: async (tenantId, definitionId) => (await db.select().from(consentDefinitionVersions).where(and(
    eq(consentDefinitionVersions.tenantId, tenantId), eq(consentDefinitionVersions.definitionId, definitionId),
  )).orderBy(asc(consentDefinitionVersions.version))).map(parseDefinitionVersion),
});

export const createTenantDocumentRepository = (db: Db): TenantDocumentRepository => {
  const find = async (tenantId: string, slug: string, version?: number) => {
    const filters = [
      eq(tenantDocuments.tenantId, tenantId), eq(tenantDocuments.slug, slug),
      eq(tenantDocuments.status, 'published'), eq(tenantDocumentVersions.tenantId, tenantId),
      sql`${tenantDocumentVersions.publishedAt} is not null`,
    ];
    if (version !== undefined) filters.push(eq(tenantDocumentVersions.version, version));
    const [row] = await db.select({ document: tenantDocuments, version: tenantDocumentVersions })
      .from(tenantDocuments)
      .innerJoin(tenantDocumentVersions, eq(tenantDocumentVersions.documentId, tenantDocuments.id))
      .where(and(...filters)).orderBy(desc(tenantDocumentVersions.version)).limit(1);
    return row === undefined ? null : {
      document: parseDocument(row.document), version: parseDocumentVersion(row.version),
    };
  };
  return {
    create: async (tenantId, document, draft) => {
      await db.transaction(async (tx) => {
        await tx.insert(tenantDocuments).values(tenantDocumentSchema.parse({ ...document, tenantId }));
        await tx.insert(tenantDocumentVersions).values(tenantDocumentVersionSchema.parse({ ...draft, tenantId, documentId: document.id }));
      });
    },
    findById: async (tenantId, documentId) => {
      const [row] = await db.select().from(tenantDocuments).where(and(
        eq(tenantDocuments.tenantId, tenantId), eq(tenantDocuments.id, documentId),
      )).limit(1);
      return row === undefined ? null : parseDocument(row);
    },
    list: async (tenantId) => (await db.select().from(tenantDocuments)
      .where(eq(tenantDocuments.tenantId, tenantId)).orderBy(asc(tenantDocuments.title), asc(tenantDocuments.id)))
      .map(parseDocument),
    listVersions: async (tenantId, documentId) => (await db.select().from(tenantDocumentVersions).where(and(
      eq(tenantDocumentVersions.tenantId, tenantId), eq(tenantDocumentVersions.documentId, documentId),
    )).orderBy(asc(tenantDocumentVersions.version))).map(parseDocumentVersion),
    saveDraft: async (tenantId, document, draft) => db.transaction(async (tx) => {
      const parsedDocument = tenantDocumentSchema.parse({ ...document, tenantId });
      const [storedDocument] = await tx.update(tenantDocuments).set(parsedDocument).where(and(
        eq(tenantDocuments.tenantId, tenantId), eq(tenantDocuments.id, parsedDocument.id),
      )).returning();
      if (storedDocument === undefined) return null;
      const [unpublished] = await tx.select().from(tenantDocumentVersions).where(and(
        eq(tenantDocumentVersions.tenantId, tenantId),
        eq(tenantDocumentVersions.documentId, parsedDocument.id),
        isNull(tenantDocumentVersions.publishedAt),
      )).orderBy(desc(tenantDocumentVersions.version)).limit(1);
      if (unpublished !== undefined) {
        const [updated] = await tx.update(tenantDocumentVersions).set({ content: draft.content }).where(and(
          eq(tenantDocumentVersions.tenantId, tenantId), eq(tenantDocumentVersions.id, unpublished.id),
        )).returning();
        return updated === undefined ? null : parseDocumentVersion(updated);
      }
      const parsedDraft = tenantDocumentVersionSchema.parse({ ...draft, tenantId, documentId: parsedDocument.id });
      const [inserted] = await tx.insert(tenantDocumentVersions).values(parsedDraft).returning();
      return inserted === undefined ? null : parseDocumentVersion(inserted);
    }),
    publishDraft: async (tenantId, documentId, publishedAt) => db.transaction(async (tx) => {
      const [version] = await tx.update(tenantDocumentVersions).set({ publishedAt }).where(and(
        eq(tenantDocumentVersions.tenantId, tenantId), eq(tenantDocumentVersions.documentId, documentId),
        isNull(tenantDocumentVersions.publishedAt),
      )).returning();
      if (version === undefined) return null;
      const [document] = await tx.update(tenantDocuments).set({ status: 'published', updatedAt: publishedAt }).where(and(
        eq(tenantDocuments.tenantId, tenantId), eq(tenantDocuments.id, documentId),
      )).returning();
      return document === undefined ? null : { document: parseDocument(document), version: parseDocumentVersion(version) };
    }),
    findPublishedVersionById: async (tenantId, versionId) => {
      const [row] = await db.select({ document: tenantDocuments, version: tenantDocumentVersions })
        .from(tenantDocumentVersions)
        .innerJoin(tenantDocuments, eq(tenantDocuments.id, tenantDocumentVersions.documentId))
        .where(and(
          eq(tenantDocumentVersions.tenantId, tenantId),
          eq(tenantDocumentVersions.id, versionId),
          eq(tenantDocuments.tenantId, tenantId),
          eq(tenantDocuments.status, 'published'),
          sql`${tenantDocumentVersions.publishedAt} is not null`,
        ))
        .limit(1);
      return row === undefined ? null : {
        document: parseDocument(row.document),
        version: parseDocumentVersion(row.version),
      };
    },
    findLatestPublished: (tenantId, slug) => find(tenantId, slug),
    findPublishedVersion: (tenantId, slug, version) => find(tenantId, slug, version),
  };
};

const campaignValues = (tenantId: string, campaign: Campaign): Campaign => campaignSchema.parse({ ...campaign, tenantId });

export const createEmailLayoutRepository = (db: Db): EmailLayoutRepository => ({
  create: async (tenantId, layout) => {
    await db.insert(emailLayouts).values(emailLayoutSchema.parse({ ...layout, tenantId }));
  },
  findById: async (tenantId, layoutId) => {
    const [row] = await db.select().from(emailLayouts).where(and(
      eq(emailLayouts.tenantId, tenantId), eq(emailLayouts.id, layoutId),
    )).limit(1);
    return row === undefined ? null : parseLayout(row);
  },
  list: async (tenantId) => (await db.select().from(emailLayouts)
    .where(eq(emailLayouts.tenantId, tenantId)).orderBy(asc(emailLayouts.name), asc(emailLayouts.id)))
    .map(parseLayout),
  update: async (tenantId, layout) => {
    const parsed = emailLayoutSchema.parse({ ...layout, tenantId });
    const [row] = await db.update(emailLayouts).set(parsed).where(and(
      eq(emailLayouts.tenantId, tenantId), eq(emailLayouts.id, parsed.id),
    )).returning();
    return row === undefined ? null : parseLayout(row);
  },
});

export const createCampaignRepository = (db: Db): CampaignRepository => ({
  create: async (tenantId, campaign) => { await db.insert(campaigns).values(campaignValues(tenantId, campaign)); },
  findById: async (tenantId, campaignId) => {
    const [row] = await db.select().from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId))).limit(1);
    return row === undefined ? null : parseCampaign(row);
  },
  list: async (tenantId) => (await db.select().from(campaigns).where(eq(campaigns.tenantId, tenantId)).orderBy(desc(campaigns.createdAt), desc(campaigns.id))).map(parseCampaign),
  delete: async (tenantId, campaignId) => (await db.delete(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId))).returning({ id: campaigns.id })).length > 0,
  update: async (tenantId, campaign) => {
    const [row] = await db.update(campaigns).set(campaignValues(tenantId, campaign)).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaign.id))).returning();
    return row === undefined ? null : parseCampaign(row);
  },
  acquireLease: async (tenantId, campaignId, input) => (await db.update(campaigns).set({ lockedBy: input.workerId, lockedUntil: input.lockedUntil }).where(and(
    eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId),
    or(isNull(campaigns.lockedUntil), lte(campaigns.lockedUntil, input.now)),
  )).returning({ id: campaigns.id })).length > 0,
  advanceCursor: async (tenantId, campaignId, input) => {
    const [row] = await db.update(campaigns).set({
      cursorMemberId: input.cursorMemberId,
      sent: sql`${campaigns.sent} + ${input.sentDelta}`,
      failed: sql`${campaigns.failed} + ${input.failedDelta}`,
    }).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId))).returning();
    return row === undefined ? null : parseCampaign(row);
  },
});

export const createMarketingJobRepository = (db: Db): MarketingJobRepository => ({
  listRunnableCampaigns: async (now) => (await db.select({
    tenantId: campaigns.tenantId,
    campaignId: campaigns.id,
  }).from(campaigns).where(or(
    eq(campaigns.status, 'running'),
    and(eq(campaigns.status, 'scheduled'), lte(campaigns.sendAt, now)),
  )).orderBy(asc(campaigns.sendAt), asc(campaigns.createdAt), asc(campaigns.id))),
  listRetentionTenantIds: async () => {
    const [consentTenants, sendTenants, idempotencyTenants] = await Promise.all([
      db.selectDistinct({ tenantId: marketingConsents.tenantId }).from(marketingConsents),
      db.selectDistinct({ tenantId: campaignSends.tenantId }).from(campaignSends),
      db.selectDistinct({ tenantId: marketingIdempotencyKeys.tenantId }).from(marketingIdempotencyKeys),
    ]);
    return [...new Set([...consentTenants, ...sendTenants, ...idempotencyTenants].map((row) => row.tenantId))].sort();
  },
  listSesIdentityRefreshTenantIds: async (checkedBefore) =>
    (
      await db
        .select({ tenantId: tenantSesSettings.tenantId })
        .from(tenantSesSettings)
        .where(
          or(
            isNull(tenantSesSettings.identityCheckedAt),
            lte(tenantSesSettings.identityCheckedAt, checkedBefore),
          ),
        )
        .orderBy(asc(tenantSesSettings.tenantId))
    ).map((row) => row.tenantId),
  listSesTenantIds: async (checkedBefore) =>
    (
      await db
        .select({ tenantId: tenantSesSettings.tenantId })
        .from(tenantSesSettings)
        .where(
          or(
            isNull(tenantSesSettings.identityCheckedAt),
            lte(tenantSesSettings.identityCheckedAt, checkedBefore),
          ),
        )
        .orderBy(asc(tenantSesSettings.tenantId))
    ).map((row) => row.tenantId),
});

export const createMarketingThrottleRepository = (db: Db): MarketingThrottleRepository => ({
  claim: async (tenantId, input) => {
    const capacity = Math.max(1, input.ratePerSecond);
    await db.insert(marketingThrottleBuckets).values({
      tenantId,
      tokens: capacity,
      lastRefillAt: input.now,
      quotaSnapshotAt: input.quotaSnapshotAt,
      reservedSinceSnapshot: 0,
    }).onConflictDoNothing();
    const available = sql<number>`least(${capacity}, ${marketingThrottleBuckets.tokens} + greatest(0, extract(epoch from (${input.now}::timestamptz - ${marketingThrottleBuckets.lastRefillAt}))) * ${input.ratePerSecond})`;
    const reserved = sql<number>`case when ${marketingThrottleBuckets.quotaSnapshotAt} = ${input.quotaSnapshotAt}::timestamptz then ${marketingThrottleBuckets.reservedSinceSnapshot} else 0 end`;
    const [claimed] = await db.update(marketingThrottleBuckets).set({
      tokens: sql`${available} - ${input.requested}`,
      lastRefillAt: input.now,
      quotaSnapshotAt: input.quotaSnapshotAt,
      reservedSinceSnapshot: sql`${reserved} + ${input.requested}`,
    }).where(and(
      eq(marketingThrottleBuckets.tenantId, tenantId),
      sql`${available} >= ${input.requested}`,
      sql`${input.sentLast24Hours} + ${reserved} + ${input.requested} <= ${input.dailyQuota}`,
    )).returning({ tenantId: marketingThrottleBuckets.tenantId });
    return claimed !== undefined;
  },
});

const sendValues = (tenantId: string, send: CampaignSend): CampaignSend => campaignSendSchema.parse({ ...send, tenantId });

export const createCampaignSendRepository = (db: Db): CampaignSendRepository => ({
  claimRecipient: async (tenantId, send, events = []) => {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(campaignSends).values(sendValues(tenantId, send));
        if (events.length > 0) {
          await tx.insert(emailEvents).values(events.map((event) =>
            emailEventSchema.parse({ ...event, tenantId })
          ));
        }
      });
      return true;
    } catch (cause) {
      if (uniqueViolation(cause)) return false;
      throw cause;
    }
  },
  findById: async (tenantId, sendId) => {
    const [row] = await db.select().from(campaignSends).where(and(eq(campaignSends.tenantId, tenantId), eq(campaignSends.id, sendId))).limit(1);
    return row === undefined ? null : parseSend(row);
  },
  update: async (tenantId, send, events = []) => {
    return db.transaction(async (tx) => {
      const [row] = await tx.update(campaignSends).set(sendValues(tenantId, send)).where(and(eq(campaignSends.tenantId, tenantId), eq(campaignSends.id, send.id))).returning();
      if (row !== undefined && events.length > 0) {
        await tx.insert(emailEvents).values(events.map((event) =>
          emailEventSchema.parse({ ...event, tenantId })
        ));
      }
      return row === undefined ? null : parseSend(row);
    });
  },
  correlateBySesMessageId: async (tenantId, messageId) => {
    const [row] = await db.select().from(campaignSends).where(and(eq(campaignSends.tenantId, tenantId), eq(campaignSends.sesMessageId, messageId))).limit(1);
    return row === undefined ? null : parseSend(row);
  },
  listByCampaign: async (tenantId, campaignId) => (await db.select().from(campaignSends).where(and(eq(campaignSends.tenantId, tenantId), eq(campaignSends.campaignId, campaignId))).orderBy(asc(campaignSends.id))).map(parseSend),
  listAll: async (tenantId) => (await db.select().from(campaignSends).where(eq(campaignSends.tenantId, tenantId)).orderBy(asc(campaignSends.id))).map(parseSend),
  engagementStats: async (tenantId, campaignIds) => {
    if (campaignIds.length === 0) return new Map();
    const rows = await db.select({
      campaignId: campaignSends.campaignId,
      uniqueOpens: sql<number>`count(distinct ${emailEvents.refId}) filter (where ${emailEvents.type} = 'opened')::int`,
      totalOpens: sql<number>`count(*) filter (where ${emailEvents.type} = 'opened')::int`,
      uniqueClicks: sql<number>`count(distinct ${emailEvents.refId}) filter (where ${emailEvents.type} = 'clicked')::int`,
      totalClicks: sql<number>`count(*) filter (where ${emailEvents.type} = 'clicked')::int`,
    }).from(campaignSends).innerJoin(emailEvents, and(
      eq(emailEvents.tenantId, campaignSends.tenantId),
      eq(emailEvents.mailKind, 'marketing'),
      eq(emailEvents.refId, campaignSends.id),
      inArray(emailEvents.type, ['opened', 'clicked']),
    )).where(and(
      eq(campaignSends.tenantId, tenantId),
      inArray(campaignSends.campaignId, campaignIds),
    )).groupBy(campaignSends.campaignId);
    return new Map(rows.flatMap((row): Array<[string, CampaignEngagementStats]> =>
      row.campaignId === null ? [] : [[row.campaignId, {
        uniqueOpens: row.uniqueOpens,
        totalOpens: row.totalOpens,
        uniqueClicks: row.uniqueClicks,
        totalClicks: row.totalClicks,
      }]]
    ));
  },
  listPage: async (tenantId, query) => {
    const filters = [eq(campaignSends.tenantId, tenantId)];
    if (query.campaignId !== undefined) filters.push(eq(campaignSends.campaignId, query.campaignId));
    if (query.email !== undefined) filters.push(eq(campaignSends.email, normalizeEmail(query.email)));
    if (query.status !== undefined) filters.push(eq(campaignSends.status, query.status));
    if (query.cursor !== undefined) filters.push(gt(campaignSends.id, query.cursor));
    const rows = await db.select().from(campaignSends).where(and(...filters)).orderBy(asc(campaignSends.id)).limit(query.limit + 1);
    return { sends: rows.slice(0, query.limit).map(parseSend), nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null };
  },
  hasPendingByCampaign: async (tenantId, campaignId) => (await db.select({ id: campaignSends.id }).from(campaignSends).where(and(
    eq(campaignSends.tenantId, tenantId), eq(campaignSends.campaignId, campaignId), inArray(campaignSends.status, ['pending', 'sending']),
  )).limit(1)).length > 0,
  pseudonymizeMember: async (tenantId, input) => (await db.update(campaignSends).set({ memberId: null, email: input.tombstoneEmail }).where(and(
    eq(campaignSends.tenantId, tenantId), eq(campaignSends.memberId, input.memberId), eq(campaignSends.email, normalizeEmail(input.email)),
  )).returning({ id: campaignSends.id })).length,
  ageOutRenderedBodies: async (tenantId, olderThan, purgedAt) => (await db.update(campaignSends).set({ renderedBodyPurgedAt: purgedAt }).where(and(
    eq(campaignSends.tenantId, tenantId), lt(campaignSends.createdAt, olderThan), isNull(campaignSends.renderedBodyPurgedAt),
  )).returning({ id: campaignSends.id })).length,
});

export const createSuppressionRepository = (db: Db): SuppressionRepository => ({
  record: async (tenantId, suppression, event) => {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(suppressions).values(suppressionSchema.parse({ ...suppression, tenantId }));
        if (event !== undefined) {
          await tx.insert(emailEvents).values(emailEventSchema.parse({ ...event, tenantId }));
        }
      });
      return true;
    } catch (cause) {
      if (uniqueViolation(cause)) return false;
      throw cause;
    }
  },
  findActive: async (tenantId, emailHmac) => {
    const [row] = await db.select().from(suppressions).where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.emailHmac, emailHmac), isNull(suppressions.liftedAt))).limit(1);
    return row === undefined ? null : parseSuppression(row);
  },
  isSuppressed: async (tenantId, emailHmac) => (await db.select({ id: suppressions.id }).from(suppressions).where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.emailHmac, emailHmac), isNull(suppressions.liftedAt))).limit(1)).length > 0,
  lift: async (tenantId, suppression) => {
    const parsed = suppressionSchema.parse({ ...suppression, tenantId });
    const [row] = await db.update(suppressions).set({ liftedAt: parsed.liftedAt, liftedBy: parsed.liftedBy }).where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.id, parsed.id), isNull(suppressions.liftedAt))).returning();
    return row === undefined ? null : parseSuppression(row);
  },
  findById: async (tenantId, id) => {
    const [row] = await db.select().from(suppressions).where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.id, id))).limit(1);
    return row === undefined ? null : parseSuppression(row);
  },
  list: async (tenantId, query) => {
    const filters = [eq(suppressions.tenantId, tenantId)];
    if (query.emailHmac !== undefined) filters.push(eq(suppressions.emailHmac, query.emailHmac));
    if (query.cursor !== undefined) filters.push(gt(suppressions.id, query.cursor));
    const rows = await db.select().from(suppressions).where(and(...filters)).orderBy(asc(suppressions.id)).limit(query.limit + 1);
    return { suppressions: rows.slice(0, query.limit).map(parseSuppression), nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null };
  },
});

export const createUnsubscribeTokenRepository = (db: Db): UnsubscribeTokenRepository => ({
  create: async (tenantId, token) => { await db.insert(unsubscribeTokens).values(unsubscribeTokenSchema.parse({ ...token, tenantId })); },
  findByToken: async (tenantId, token) => {
    const [row] = await db.select().from(unsubscribeTokens).where(and(eq(unsubscribeTokens.tenantId, tenantId), eq(unsubscribeTokens.token, token))).limit(1);
    return row === undefined ? null : parseUnsubscribe(row);
  },
  consume: async (tenantId, token, usedAt, event) => {
    const [changed] = await db.transaction(async (tx) => {
      const rows = await tx.update(unsubscribeTokens).set({ usedAt }).where(and(eq(unsubscribeTokens.tenantId, tenantId), eq(unsubscribeTokens.token, token), isNull(unsubscribeTokens.usedAt))).returning();
      if (rows[0] !== undefined && event !== undefined) {
        await tx.insert(emailEvents).values(emailEventSchema.parse({ ...event, tenantId }));
      }
      return rows;
    });
    if (changed !== undefined) return { token: parseUnsubscribe(changed), newlyUsed: true };
    const [existing] = await db.select().from(unsubscribeTokens).where(and(eq(unsubscribeTokens.tenantId, tenantId), eq(unsubscribeTokens.token, token))).limit(1);
    return existing === undefined ? null : { token: parseUnsubscribe(existing), newlyUsed: false };
  },
});

export const createTenantSesSettingsRepository = (db: Db): TenantSesSettingsRepository => ({
  findByTenant: async (tenantId) => {
    const [row] = await db.select().from(tenantSesSettings).where(eq(tenantSesSettings.tenantId, tenantId)).limit(1);
    return row === undefined ? null : parseSesSettings(row);
  },
  findByWebhookToken: async (token) => {
    const [row] = await db.select().from(tenantSesSettings).where(eq(tenantSesSettings.webhookToken, token)).limit(1);
    return row === undefined ? null : parseSesSettings(row);
  },
  upsert: async (tenantId, settings) => {
    const parsed = tenantSesSettingsSchema.parse({ ...settings, tenantId });
    const [row] = await db.insert(tenantSesSettings).values(parsed).onConflictDoUpdate({ target: tenantSesSettings.tenantId, set: parsed }).returning();
    if (row === undefined) throw new Error('SES settings upsert returned no row');
    return parseSesSettings(row);
  },
});

export const createAutomationIdempotencyRepository = (db: Db): AutomationIdempotencyRepository => ({
  claim: async (tenantId, recordValue) => {
    const parsed = automationIdempotencyKeySchema.parse({ ...recordValue, tenantId });
    const [inserted] = await db.insert(marketingIdempotencyKeys).values(parsed).onConflictDoNothing().returning();
    if (inserted !== undefined) return null;
    const [existing] = await db.select().from(marketingIdempotencyKeys).where(and(eq(marketingIdempotencyKeys.tenantId, tenantId), eq(marketingIdempotencyKeys.key, parsed.key))).limit(1);
    return existing === undefined ? null : parseIdempotency(existing);
  },
  release: async (tenantId, key) => { await db.delete(marketingIdempotencyKeys).where(and(eq(marketingIdempotencyKeys.tenantId, tenantId), eq(marketingIdempotencyKeys.key, key))); },
  sweepExpired: async (now) => (await db.delete(marketingIdempotencyKeys).where(lte(marketingIdempotencyKeys.expiresAt, now)).returning({ id: marketingIdempotencyKeys.id })).length,
});

export const createMarketingAudienceRepository = (db: Db): MarketingAudienceRepository => {
  const candidates = async (tenantId: string, input: { definitionId: string; productIds: string[]; afterMemberId: string | null; maxMemberId?: string; limit?: number }) => {
    const [definition] = await db.select({ id: consentDefinitions.id }).from(consentDefinitions).where(and(eq(consentDefinitions.tenantId, tenantId), eq(consentDefinitions.id, input.definitionId))).limit(1);
    if (definition === undefined) return [];
    const filters = [eq(members.tenantId, tenantId), isNull(members.deletedAt)];
    if (input.afterMemberId !== null) filters.push(gt(members.id, input.afterMemberId));
    if (input.maxMemberId !== undefined) filters.push(lte(members.id, input.maxMemberId));
    if (input.productIds.length > 0) filters.push(inArray(members.id, db.select({ memberId: productGrants.memberId }).from(productGrants).where(and(
      eq(productGrants.tenantId, tenantId), inArray(productGrants.productId, input.productIds),
      or(isNull(productGrants.expiresAt), gt(productGrants.expiresAt, new Date().toISOString())),
    ))));
    filters.push(sql`exists (select 1 from ${marketingConsents} mc where mc.tenant_id = ${tenantId} and mc.email = lower(trim(${members.email})) and mc.definition_id = ${input.definitionId})`);
    const candidates = await db.select({ id: members.id, email: members.email, displayName: members.displayName }).from(members).where(and(...filters)).orderBy(asc(members.id)).limit(input.limit === undefined ? 100000 : Math.max(input.limit * 4, input.limit));
    const output = [];
    for (const member of candidates) {
      const grants = await db.select({ productId: productGrants.productId }).from(productGrants).where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.memberId, member.id)));
      output.push({ memberId: member.id, email: normalizeEmail(member.email), displayName: member.displayName, productIds: grants.map((grant) => grant.productId) });
      if (input.limit !== undefined && output.length >= input.limit) break;
    }
    return output;
  };
  return {
    snapshot: async (tenantId, input) => {
      const rows = await candidates(tenantId, { ...input, afterMemberId: null });
      return { maxMemberId: rows.at(-1)?.memberId ?? null, count: rows.length };
    },
    fetchEligibleBatch: (tenantId, input) => candidates(tenantId, input),
  };
};
