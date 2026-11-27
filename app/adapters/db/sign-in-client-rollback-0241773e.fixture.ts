import { and, eq, getTableName, inArray, notExists, notInArray, sql } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';

import {
  SMOKE_TENANT_ID,
  SmokeTenantReseedRefused,
  smokeTenantReseedRefusal,
  type DeploymentResetMarkers,
  type SmokeTenantPasswords,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import { assertReseedAllowed } from './reseed-guard.js';
import * as schema from './schema.js';
import { applySeed, type SeedSummary } from './seed-data.js';
import { createSeedUsers } from './seed-users.js';
import { applySmokeTenantSeed, type SmokeTenantSeedSummary } from './smoke-tenant-seed.js';

const { marketingConsents, members, schedulerRuns, schedulerRunTenants, tenants } = schema;
type DemoTenantWipeTable = AnyPgTable & { tenantId: AnyPgColumn };

const DEMO_TENANT_WIPE_TABLES: readonly DemoTenantWipeTable[] = [
  schema.metaCapiOutbox, schema.metaCapiEvents, schema.metaCapiConsentEvidence,
  schema.telemetryOutbox, schema.telemetryConnections, schema.telemetryAccounting,
  schema.marketingOutbox, schema.marketingSignupSubmissions, schema.marketingSnsInboxEvents,
  schema.marketingSnsInbox, schema.marketingContactImportRows, schema.marketingListMemberships,
  schema.marketingDirectoryEvents, schema.marketingMemberSyncJobs, schema.surveyResponses,
  schema.surveyEvents, schema.surveys, schema.marketingSignupForms,
  schema.marketingLists, schema.marketingContactImports, schema.autoInvoiceJobs,
  schema.orderRefundJobs, schema.orderStaffRefunds, schema.checkoutConsentCaptures,
  schema.checkoutConsentJobs, schema.checkoutSnapshots, schema.orderIssueEvents,
  schema.stockEvents, schema.stockReservations, schema.productStock,
  schema.orderChanges, schema.orderFulfilmentEvents, schema.orderShipmentEvents,
  schema.orderShipments, schema.productDownloadAssets, schema.downloadCopies,
  schema.consentConfirmationTokens, schema.consentDefinitionVersions, schema.consents,
  schema.couponCheckoutSessions, schema.couponEvents, schema.couponRedemptionEvents,
  schema.lessonAttachments, schema.courseLessons, schema.courseModules,
  schema.emailEvents, schema.emailOutbox, schema.entityVersions,
  schema.erasedMemberImports, schema.fiscalArtifacts, schema.impersonationSessions,
  schema.tenantAuditEvents, schema.invoiceEvents, schema.ksefNumberAllocations,
  schema.ksefNumberSequences, schema.ksefSubmissionJobs, schema.marketingIdempotencyKeys,
  schema.marketingThrottleBuckets, schema.memberBlocks, schema.memberCourseProgress,
  schema.memberErasureRequestEvents, schema.memberEvents, schema.memberSubscriptions,
  schema.providerCustomerOwners, schema.notificationFanoutJobs, schema.notifications,
  schema.dmReports, schema.dmConversationStates, schema.dmMessages,
  schema.dmConversations, schema.postReactions, schema.postReportEvents,
  schema.paymentEventRejections, schema.processedPaymentEvents, schema.productGrants,
  schema.productPriceHistory, schema.salesLinkEvents, schema.salesLinks,
  schema.schedulerRunTenants, schema.snsWebhookDeliveries, schema.spaceEventRsvps,
  schema.spaceEvents, schema.spaceSeenMarks, schema.spaceSubscriptions,
  schema.storageCorsChecks, schema.suppressions, schema.tenantAdmins,
  schema.tenantAdminInvitations, schema.importAuditEvents, schema.shopManagementKeyEvents,
  schema.shopManagementKeys, schema.changeProposalImagePublications, schema.changeProposalImageUploads,
  schema.changeProposalImages, schema.changeProposalDownloadUploadEvents, schema.changeProposalDownloadDeletions,
  schema.changeProposalDownloadUploads, schema.changeProposalDownloadFiles, schema.changeProposalEvents,
  schema.changeProposals, schema.changeProposalGroups, schema.tenantApiKeys,
  schema.tenantDocumentVersions, schema.tenantDomainEvents, schema.tenantDomains,
  schema.tenantRedirects, schema.tenantConfigSources, schema.tenantSecrets,
  schema.tenantSesSettings, schema.tenantTransactionalEmailPools, schema.threadSubscriptions,
  schema.unsubscribeTokens, schema.campaignSends, schema.marketingCampaignAudienceContacts,
  schema.marketingCampaignAudienceSnapshots, schema.marketingContacts, schema.couponRedemptions,
  schema.courses, schema.invoices, schema.memberErasureRequests,
  schema.postReports, schema.spaces, schema.tenantDocuments,
  schema.campaigns, schema.marketingConsents, schema.orders,
  schema.posts, schema.consentDefinitions, schema.coupons,
  schema.emailLayouts, schema.members, schema.productPrices,
  schema.products,
];

const DEMO_TENANT_IDS = ['tenant-studio', 'tenant-acme', 'tenant-akademia'];

const RESEED_LOCK_KEY = 4_820_913;

interface ReseedSummary {
  demoTenantIds: string[];
  wiped: Array<{ table: string; rows: number }>;
  seed: SeedSummary;
}

export const runDemoReseed0241773e = async (
  db: Db,
  markers: DeploymentResetMarkers,
): Promise<ReseedSummary> => {
  assertReseedAllowed(markers);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RESEED_LOCK_KEY})`);

    const wiped: Array<{ table: string; rows: number }> = [];
    const record = (table: string, rows: unknown[]): void => {
      wiped.push({ table, rows: rows.length });
    };

    const nonDemoRunTenant = tx
      .select({ id: schedulerRunTenants.id })
      .from(schedulerRunTenants)
      .where(and(
        eq(schedulerRunTenants.runId, schedulerRuns.id),
        notInArray(schedulerRunTenants.tenantId, DEMO_TENANT_IDS),
      ));

    const wipeTenantTable = async (table: DemoTenantWipeTable): Promise<void> => {
      const rows = await tx
        .delete(table)
        .where(inArray(table.tenantId, DEMO_TENANT_IDS))
        .returning({ tenantId: table.tenantId });
      record(getTableName(table), rows);
    };

    for (const table of DEMO_TENANT_WIPE_TABLES) {
      await wipeTenantTable(table);
    }

    record(
      'scheduler_runs',
      await tx
        .delete(schedulerRuns)
        .where(notExists(nonDemoRunTenant))
        .returning({ id: schedulerRuns.id }),
    );

    record(
      'tenants',
      await tx
        .delete(tenants)
        .where(inArray(tenants.id, DEMO_TENANT_IDS))
        .returning({ id: tenants.id }),
    );

    return { demoTenantIds: DEMO_TENANT_IDS, wiped, seed: await applySeed(tx) };
  });
};

const SMOKE_TENANT_RESEED_LOCK_KEY = 4_820_914;

const DAY_MS = 24 * 60 * 60 * 1000;

interface SmokeTenantReseedSummary {
  tenantId: string;
  wiped: Array<{ table: string; rows: number }>;
  seed: SmokeTenantSeedSummary;
}

export const runSmokeReseed0241773e = async (
  db: Db,
  options: { passwords: SmokeTenantPasswords; nowIso: () => string },
): Promise<SmokeTenantReseedSummary> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SMOKE_TENANT_RESEED_LOCK_KEY})`);

    const [tenant] = await tx
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, SMOKE_TENANT_ID))
      .limit(1);
    const memberRows = await tx
      .select({ email: members.email })
      .from(members)
      .where(eq(members.tenantId, SMOKE_TENANT_ID));
    const consentRows = await tx
      .selectDistinct({ email: marketingConsents.email })
      .from(marketingConsents)
      .where(eq(marketingConsents.tenantId, SMOKE_TENANT_ID));

    const refusal = smokeTenantReseedRefusal({
      tenant: tenant ?? null,
      memberEmails: memberRows.map((row) => row.email),
      consentEmails: consentRows.map((row) => row.email),
    });
    if (refusal !== null) {
      throw new SmokeTenantReseedRefused(`Smoke tenant reseed refused because ${refusal}`);
    }

    const wiped: Array<{ table: string; rows: number }> = [];
    const wipeTenantTable = async (table: DemoTenantWipeTable): Promise<void> => {
      const rows = await tx
        .delete(table)
        .where(eq(table.tenantId, SMOKE_TENANT_ID))
        .returning({ tenantId: table.tenantId });
      wiped.push({ table: getTableName(table), rows: rows.length });
    };

    for (const table of DEMO_TENANT_WIPE_TABLES) {
      await wipeTenantTable(table);
    }

    const removedTenants = await tx
      .delete(tenants)
      .where(eq(tenants.id, SMOKE_TENANT_ID))
      .returning({ id: tenants.id });
    wiped.push({ table: getTableName(tenants), rows: removedTenants.length });

    const seedClock = { nowIso: options.nowIso };
    let sequence = 0;
    const seed = await applySmokeTenantSeed(tx, {
      users: createSeedUsers(tx, seedClock),
      passwords: options.passwords,
      nextIso: () => new Date(Date.parse(options.nowIso()) + sequence++ * 1000).toISOString(),
      relativeIso: (days) => new Date(Date.parse(options.nowIso()) + days * DAY_MS).toISOString(),
    });

    return { tenantId: SMOKE_TENANT_ID, wiped, seed };
  });
