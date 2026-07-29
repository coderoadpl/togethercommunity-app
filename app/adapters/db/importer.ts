import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

import type { AccessItem, Chapter, LessonBlock } from '#core/domain/index.js';
import { normalizeEmail } from '#core/domain/index.js';
import { isLessonAccessible } from '#core/server/index.js';
import type { EmailHmac } from '#core/server/index.js';
import type {
  ImportAuthGateway,
  ImportedUserOutcome,
  ImportedUserState,
} from '#adapters/auth/import-credential.js';

import type { Db } from './client.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createMemberCourseProgressRepository,
  createProductGrantRepository,
  createProductRepository,
} from './repositories.js';
import {
  account,
  courseLessons,
  courseModules,
  courses,
  erasedMemberImports,
  memberCourseProgress,
  members,
  productGrants,
  products,
  tenantAdmins,
  tenantDomains,
  tenants,
  user,
} from './schema.js';

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const SAMPLE_LIMIT = 5;
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export class ImportFailure extends Error {}

export interface ImportAnomaly {
  kind: string;
  subject: string;
  detail: string;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface UpdateSample {
  key: string;
  changes: FieldChange[];
}

export interface KindReport {
  kind: string;
  create: number;
  update: number;
  skip: number;
  dropped: number;
  anomalies: ImportAnomaly[];
  samples: UpdateSample[];
}

export interface BundleUser {
  legacyId: string;
  email: string;
  name: string | null;
  payloadPasswordMarker: string | null;
  role: 'admin' | 'student';
}

export interface BundleCourse {
  legacyId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  moduleOrder: string[];
}

export interface BundleModule {
  legacyId: string;
  courseLegacyIds: string[];
  title: string;
  prefix: string | null;
  chapters: Chapter[];
}

export interface BundleLesson {
  legacyId: string;
  name: string;
  contents: LessonBlock[];
}

export interface BundleProduct {
  legacyId: string;
  title: string;
  accessItems: AccessItem[];
}

export interface BundleMember {
  legacyId: string;
  email: string;
  displayName: string | null;
}

export interface BundleGrant {
  legacyId: string;
  memberLegacyId: string;
  productLegacyId: string;
  startsAt: string | null;
  expiresAt: string | null;
}

export interface BundleProgress {
  legacyId: string;
  userLegacyId: string;
  courseLegacyId: string;
  lastViewedLessonId: string | null;
  lastViewedModuleId: string | null;
  lastViewedChapterId: string | null;
  completedLessonIds: string[];
  updatedAt: string | null;
}

export interface TenantBundle {
  users: BundleUser[];
  courses: BundleCourse[];
  modules: BundleModule[];
  lessons: BundleLesson[];
  products: BundleProduct[];
  members: BundleMember[];
  grants: BundleGrant[];
  progress: BundleProgress[];
}

export interface TenantMapping {
  bundleSlug: string;
  target: string;
}

export interface ResolvedTenant {
  bundleSlug: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  created: boolean;
}

export interface ImportTarget {
  tenant: ResolvedTenant;
  bundle: TenantBundle;
}

export interface ImportRunOptions {
  apply: boolean;
  nowIso: () => string;
  emailHmac: EmailHmac;
}

export interface VerificationCount {
  kind: string;
  bundle: number;
  expectedInDb: number;
  matchedInDb: number;
  extraLegacyInDb: number;
  pass: boolean;
}

export interface SpotCheck {
  memberLegacyId: string;
  email: string;
  lessonLegacyId: string;
  expectedAccessible: boolean;
  actual: string;
  pass: boolean;
}

export interface TenantVerification {
  bundleSlug: string;
  tenantId: string;
  counts: VerificationCount[];
  markersTotal: number;
  markersVerified: number;
  spotChecks: SpotCheck[];
  pass: boolean;
}

export interface VerificationReport {
  tenants: TenantVerification[];
  pass: boolean;
}

export interface TenantImportResult {
  bundleSlug: string;
  tenantId: string;
  kinds: KindReport[];
}

export interface ImportRunResult {
  mode: 'dry-run' | 'apply';
  users: KindReport;
  tenants: TenantImportResult[];
  verification: VerificationReport | null;
}

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/;

/** Mongo ObjectIds carry their creation time in the first 4 bytes. */
const legacyObjectIdCreatedAt = (legacyId: string): string | null =>
  OBJECT_ID_PATTERN.test(legacyId)
    ? new Date(Number.parseInt(legacyId.slice(0, 8), 16) * 1000).toISOString()
    : null;

/**
 * Course links a module may keep: legacy rendered `course.modules` (the module
 * order) as the sole source of truth, so a module pointing at a course that
 * does not list it back was invisible there — usually a detached duplicate.
 */
const moduleOrderByCourse = (bundle: TenantBundle): Map<string, ReadonlySet<string>> =>
  new Map(bundle.courses.map((course) => [course.legacyId, new Set(course.moduleOrder)]));

const isModuleInCourseOrder = (
  orderByCourse: ReadonlyMap<string, ReadonlySet<string>>,
  moduleLegacyId: string,
  courseLegacyId: string,
): boolean => {
  const order = orderByCourse.get(courseLegacyId);
  return order === undefined || order.has(moduleLegacyId);
};

const emptyReport = (kind: string): KindReport => ({
  kind,
  create: 0,
  update: 0,
  skip: 0,
  dropped: 0,
  anomalies: [],
  samples: [],
});

const canonical = (value: unknown): unknown => {
  if (value === undefined || value === null) return null;
  const encoded: unknown = JSON.parse(JSON.stringify(value));
  return encoded;
};

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => deepEqual(entry, b[index]));
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const entriesA = Object.entries(a);
    const entriesB = new Map(Object.entries(b));
    if (entriesA.length !== entriesB.size) return false;
    return entriesA.every(([key, value]) => entriesB.has(key) && deepEqual(value, entriesB.get(key)));
  }
  return false;
};

const printValue = (value: unknown): string => {
  const raw = JSON.stringify(canonical(value)) ?? 'null';
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
};

const changedFields = (
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
): FieldChange[] => {
  const changes: FieldChange[] = [];
  for (const [field, after] of Object.entries(desired)) {
    const before = existing[field];
    if (!deepEqual(canonical(before), canonical(after))) {
      changes.push({ field, before: printValue(before), after: printValue(after) });
    }
  }
  return changes;
};

const chunk = <T>(rows: T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
};

type ClaimedIds = Record<
  'courses' | 'modules' | 'lessons' | 'products' | 'members' | 'grants' | 'progress',
  Set<string>
>;

const createClaimedIds = (): ClaimedIds => ({
  courses: new Set(),
  modules: new Set(),
  lessons: new Set(),
  products: new Set(),
  members: new Set(),
  grants: new Set(),
  progress: new Set(),
});

const planKindIds = async (args: {
  bundleLegacyIds: string[];
  existingIdByLegacy: ReadonlyMap<string, string>;
  takenIds: (candidates: string[]) => Promise<Set<string>>;
  claimed: Set<string>;
  tenantSlug: string;
}): Promise<Map<string, string>> => {
  const idByLegacy = new Map<string, string>();
  const fresh: string[] = [];
  for (const legacyId of args.bundleLegacyIds) {
    const existing = args.existingIdByLegacy.get(legacyId);
    if (existing !== undefined) {
      idByLegacy.set(legacyId, existing);
      args.claimed.add(existing);
    } else {
      fresh.push(legacyId);
    }
  }
  const candidates = fresh.flatMap((legacyId) => [legacyId, `${args.tenantSlug}-${legacyId}`]);
  const taken = await args.takenIds(candidates);
  for (const legacyId of fresh) {
    const fallback = `${args.tenantSlug}-${legacyId}`;
    const id =
      !taken.has(legacyId) && !args.claimed.has(legacyId)
        ? legacyId
        : !taken.has(fallback) && !args.claimed.has(fallback)
          ? fallback
          : null;
    if (id === null) throw new ImportFailure(`Cannot allocate a row id for legacyId ${legacyId}`);
    args.claimed.add(id);
    idByLegacy.set(legacyId, id);
  }
  return idByLegacy;
};

const mapReference = (
  idByLegacy: ReadonlyMap<string, string>,
  legacyId: string,
  report: KindReport,
  anomalyKind: string,
  subject: string,
): string => {
  const mapped = idByLegacy.get(legacyId);
  if (mapped !== undefined) return mapped;
  report.anomalies.push({
    kind: anomalyKind,
    subject,
    detail: `referenced id ${legacyId} is not part of the import; kept verbatim`,
  });
  return legacyId;
};

export const resolveImportTenants = async (
  db: Db,
  gateway: ImportAuthGateway,
  mappings: TenantMapping[],
  opts: { createMissing: boolean; ownerEmail: string | null; apply: boolean; nowIso: () => string },
): Promise<ResolvedTenant[]> => {
  const resolved: ResolvedTenant[] = [];
  for (const mapping of mappings) {
    const rows = await db
      .select()
      .from(tenants)
      .where(or(eq(tenants.id, mapping.target), eq(tenants.slug, mapping.target)))
      .limit(1);
    const row = rows[0];
    if (row) {
      if (opts.apply) {
        const ownerRows = await db
          .select({ id: tenantAdmins.id })
          .from(tenantAdmins)
          .where(and(eq(tenantAdmins.tenantId, row.id), eq(tenantAdmins.role, 'owner')))
          .limit(1);
        const ownerRow = ownerRows[0];
        if (ownerRow === undefined && opts.ownerEmail === null) {
          throw new ImportFailure(
            `Target tenant "${mapping.target}" has no owner admin; pass --owner-email to backfill it`,
          );
        }
        const owner = ownerRow === undefined && opts.ownerEmail !== null
          ? await gateway.ensureImportedUser({
              email: opts.ownerEmail,
              name: null,
              passwordMarker: null,
            })
          : null;
        await db.transaction(async (tx) => {
          if (owner !== null) {
            await tx
              .insert(tenantAdmins)
              .values({
                id: `admin-${row.slug}`,
                tenantId: row.id,
                userId: owner.userId,
                role: 'owner',
              })
              .onConflictDoNothing();
          }
          await tx
            .insert(tenantDomains)
            .values({
              id: `domain-${row.slug}`,
              tenantId: row.id,
              domain: `${row.slug}.localhost`,
              kind: 'subdomain',
              verified: true,
            })
            .onConflictDoNothing();
        });
      }
      resolved.push({
        bundleSlug: mapping.bundleSlug,
        tenantId: row.id,
        tenantSlug: row.slug,
        tenantName: row.name,
        created: false,
      });
      continue;
    }
    if (!opts.createMissing) {
      throw new ImportFailure(
        `Target tenant "${mapping.target}" (for bundle "${mapping.bundleSlug}") does not exist; create it first or pass --create-tenants with --owner-email`,
      );
    }
    if (opts.ownerEmail === null) {
      throw new ImportFailure('--create-tenants requires --owner-email');
    }
    if (!TENANT_SLUG_PATTERN.test(mapping.target)) {
      throw new ImportFailure(
        `Cannot create tenant "${mapping.target}": target must be a valid slug (3-63 lowercase letters, numbers or hyphens)`,
      );
    }
    const tenantId = `tenant-${mapping.target}`;
    if (opts.apply) {
      const owner = await gateway.ensureImportedUser({
        email: opts.ownerEmail,
        name: null,
        passwordMarker: null,
      });
      const now = opts.nowIso();
      await db.transaction(async (tx) => {
        await tx
          .insert(tenants)
          .values({ id: tenantId, slug: mapping.target, name: mapping.target, createdAt: now });
        await tx.insert(tenantAdmins).values({
          id: `admin-${mapping.target}`,
          tenantId,
          userId: owner.userId,
          role: 'owner',
        });
        await tx
          .insert(tenantDomains)
          .values({
            id: `domain-${mapping.target}`,
            tenantId,
            domain: `${mapping.target}.localhost`,
            kind: 'subdomain',
            verified: true,
          })
          .onConflictDoNothing();
      });
    }
    resolved.push({
      bundleSlug: mapping.bundleSlug,
      tenantId,
      tenantSlug: mapping.target,
      tenantName: mapping.target,
      created: true,
    });
  }
  return resolved;
};

interface UsersOutcome {
  report: KindReport;
  userIdByEmail: Map<string, string | null>;
  markerByEmail: Map<string, string>;
}

const mergeBundleUsers = (
  targets: ImportTarget[],
  report: KindReport,
): Map<string, BundleUser> => {
  const merged = new Map<string, BundleUser>();
  for (const target of targets) {
    for (const bundleUser of target.bundle.users) {
      const email = normalizeEmail(bundleUser.email);
      const previous = merged.get(email);
      if (previous === undefined) {
        merged.set(email, { ...bundleUser, email });
        continue;
      }
      if (previous.legacyId !== bundleUser.legacyId) {
        report.anomalies.push({
          kind: 'user-email-conflict',
          subject: `users/${bundleUser.legacyId}`,
          detail: `email ${email} is already imported as user ${previous.legacyId}; keeping the first occurrence`,
        });
      } else if (previous.payloadPasswordMarker !== bundleUser.payloadPasswordMarker) {
        report.anomalies.push({
          kind: 'user-marker-conflict',
          subject: `users/${bundleUser.legacyId}`,
          detail: `email ${email} appears with two different password markers; keeping the first occurrence`,
        });
      }
    }
  }
  return merged;
};

interface ErasedMemberLinks {
  legacyIds: Set<string>;
  emailHmacs: Set<string>;
  deletedMemberIds: Set<string>;
}

const emptyErasedMemberLinks = (): ErasedMemberLinks => ({
  legacyIds: new Set(),
  emailHmacs: new Set(),
  deletedMemberIds: new Set(),
});

const loadErasedMemberLinks = async (
  db: Db,
  tenantIds: string[],
): Promise<Map<string, ErasedMemberLinks>> => {
  const byTenant = new Map<string, ErasedMemberLinks>();
  if (tenantIds.length === 0) return byTenant;
  const linksFor = (tenantId: string): ErasedMemberLinks => {
    const existing = byTenant.get(tenantId);
    if (existing !== undefined) return existing;
    const created = emptyErasedMemberLinks();
    byTenant.set(tenantId, created);
    return created;
  };
  const [importRows, deletedRows] = await Promise.all([
    db
      .select()
      .from(erasedMemberImports)
      .where(inArray(erasedMemberImports.tenantId, tenantIds)),
    db
      .select({ id: members.id, tenantId: members.tenantId })
      .from(members)
      .where(and(inArray(members.tenantId, tenantIds), isNotNull(members.deletedAt))),
  ]);
  for (const row of importRows) {
    const links = linksFor(row.tenantId);
    if (row.legacyId !== null) links.legacyIds.add(row.legacyId);
    links.emailHmacs.add(row.emailHmac);
  }
  for (const row of deletedRows) linksFor(row.tenantId).deletedMemberIds.add(row.id);
  return byTenant;
};

const bundleMemberErased = (
  entry: BundleMember,
  tenant: { tenantId: string; tenantSlug: string },
  links: ErasedMemberLinks,
  emailHmac: EmailHmac,
): boolean =>
  links.legacyIds.has(entry.legacyId) ||
  links.emailHmacs.has(emailHmac.compute(tenant.tenantId, entry.email)) ||
  // Members erased before erased_member_imports existed carry no stable link,
  // so the importer's own row-id convention is the last remaining match.
  links.deletedMemberIds.has(entry.legacyId) ||
  links.deletedMemberIds.has(`${tenant.tenantSlug}-${entry.legacyId}`);

const erasedBundleMemberLegacyIds = (
  target: ImportTarget,
  links: ErasedMemberLinks,
  emailHmac: EmailHmac,
): Set<string> =>
  new Set(
    target.bundle.members
      .filter((entry) => bundleMemberErased(entry, target.tenant, links, emailHmac))
      .map((entry) => entry.legacyId),
  );

const importUsers = async (
  gateway: ImportAuthGateway,
  targets: ImportTarget[],
  apply: boolean,
  erasedByTenant: ReadonlyMap<string, ErasedMemberLinks>,
  emailHmac: EmailHmac,
): Promise<UsersOutcome> => {
  const report = emptyReport('users');
  const merged = mergeBundleUsers(targets, report);
  const userIdByEmail = new Map<string, string | null>();
  const markerByEmail = new Map<string, string>();
  const emails = [...merged.keys()].sort();
  for (const email of emails) {
    const bundleUser = merged.get(email);
    if (bundleUser === undefined) continue;
    const memberEntries = targets.flatMap((target) =>
      target.bundle.members
        .filter((member) => normalizeEmail(member.email) === email)
        .map((member) => ({ tenant: target.tenant, member })),
    );
    const erasedFromEveryMemberTarget =
      memberEntries.length > 0 &&
      memberEntries.every(({ tenant, member }) =>
        bundleMemberErased(
          member,
          tenant,
          erasedByTenant.get(tenant.tenantId) ?? emptyErasedMemberLinks(),
          emailHmac,
        ),
      );
    if (erasedFromEveryMemberTarget) {
      userIdByEmail.set(email, null);
      report.skip += 1;
      report.anomalies.push({
        kind: 'pseudonymized-user-skipped',
        subject: `users/${bundleUser.legacyId}`,
        detail: `${email} belongs only to previously pseudonymized target members; the auth account was skipped`,
      });
      continue;
    }
    if (bundleUser.payloadPasswordMarker !== null) {
      markerByEmail.set(email, bundleUser.payloadPasswordMarker);
    } else {
      report.anomalies.push({
        kind: 'user-without-credential',
        subject: `users/${bundleUser.legacyId}`,
        detail: `${email} has no password marker; account stays passwordless (magic link only)`,
      });
    }
    const input = {
      email,
      name: bundleUser.name,
      passwordMarker: bundleUser.payloadPasswordMarker,
    };
    const state: ImportedUserOutcome | ImportedUserState = apply
      ? await gateway.ensureImportedUser(input)
      : await gateway.inspectImportedUser(input);
    userIdByEmail.set(email, state.userId);
    if (state.credentialAction === 'keep-native') {
      report.anomalies.push({
        kind: 'credential-kept-native',
        subject: `users/${bundleUser.legacyId}`,
        detail: `${email} already has a native (non-imported) password; the legacy marker was not applied`,
      });
    }
    if (state.userAction === 'create') {
      report.create += 1;
      continue;
    }
    if (state.credentialAction === 'create' || state.credentialAction === 'update') {
      report.update += 1;
      if (report.samples.length < SAMPLE_LIMIT) {
        report.samples.push({
          key: email,
          changes: [
            {
              field: 'credential',
              before: state.credentialAction === 'create' ? '(no credential account)' : '(stale legacy marker)',
              after: '(imported legacy marker)',
            },
          ],
        });
      }
      continue;
    }
    report.skip += 1;
  }
  return { report, userIdByEmail, markerByEmail };
};

interface SimplePlan<TInsert, TPatch> {
  report: KindReport;
  creates: TInsert[];
  updates: { id: string; patch: TPatch }[];
}

const planSimpleKind = <
  TEntry extends { legacyId: string },
  TRow extends { id: string },
  TInsert,
  TPatch extends Record<string, unknown>,
>(args: {
  kind: string;
  entries: TEntry[];
  existingByLegacy: ReadonlyMap<string, TRow>;
  rowFields: (row: TRow) => Record<string, unknown>;
  desired: (entry: TEntry, report: KindReport) => TPatch;
  insert: (entry: TEntry, patch: TPatch) => TInsert;
}): SimplePlan<TInsert, TPatch> => {
  const report = emptyReport(args.kind);
  const creates: TInsert[] = [];
  const updates: { id: string; patch: TPatch }[] = [];
  for (const entry of args.entries) {
    const patch = args.desired(entry, report);
    const row = args.existingByLegacy.get(entry.legacyId);
    if (row === undefined) {
      report.create += 1;
      creates.push(args.insert(entry, patch));
      continue;
    }
    const changes = changedFields(args.rowFields(row), patch);
    if (changes.length === 0) {
      report.skip += 1;
      continue;
    }
    report.update += 1;
    if (report.samples.length < SAMPLE_LIMIT) {
      report.samples.push({ key: entry.legacyId, changes });
    }
    updates.push({ id: row.id, patch });
  }
  return { report, creates, updates };
};

const legacyRowsById = <TRow extends { legacyId: string | null }>(rows: TRow[]): Map<string, TRow> => {
  const byLegacy = new Map<string, TRow>();
  for (const row of rows) {
    if (row.legacyId !== null) byLegacy.set(row.legacyId, row);
  }
  return byLegacy;
};

const idsByLegacy = <TRow extends { id: string; legacyId: string | null }>(
  rows: TRow[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.legacyId !== null) map.set(row.legacyId, row.id);
  }
  return map;
};

const dedupeGrants = (grants: BundleGrant[], report: KindReport): BundleGrant[] => {
  const expiryRank = (value: string | null): string => value ?? '9999-12-31T23:59:59.999Z';
  const byPair = new Map<string, BundleGrant>();
  for (const grant of grants) {
    const key = `${grant.memberLegacyId}::${grant.productLegacyId}`;
    const current = byPair.get(key);
    if (current === undefined) {
      byPair.set(key, grant);
      continue;
    }
    const currentRank = `${expiryRank(current.expiresAt)}|${current.startsAt ?? ''}|${current.legacyId}`;
    const nextRank = `${expiryRank(grant.expiresAt)}|${grant.startsAt ?? ''}|${grant.legacyId}`;
    const winner = nextRank > currentRank ? grant : current;
    const loser = winner === grant ? current : grant;
    byPair.set(key, winner);
    report.dropped += 1;
    report.anomalies.push({
      kind: 'duplicate-grant-pair-dropped',
      subject: `grants/${loser.legacyId}`,
      detail: `member ${grant.memberLegacyId} already holds product ${grant.productLegacyId} via grant ${winner.legacyId}; the duplicate was dropped`,
    });
  }
  return [...byPair.values()];
};

const mergeProgressRows = (rows: BundleProgress[], report: KindReport): BundleProgress[] => {
  const byKey = new Map<string, BundleProgress>();
  for (const row of rows) {
    const key = `${row.userLegacyId}::${row.courseLegacyId}`;
    const current = byKey.get(key);
    if (current === undefined) {
      byKey.set(key, row);
      continue;
    }
    report.anomalies.push({
      kind: 'duplicate-progress-merged',
      subject: `progress/${row.legacyId}`,
      detail: `duplicate progress for user ${row.userLegacyId} course ${row.courseLegacyId}; completedLessons merged into ${current.legacyId}`,
    });
    byKey.set(key, {
      ...current,
      completedLessonIds: [...new Set([...current.completedLessonIds, ...row.completedLessonIds])],
      updatedAt:
        (row.updatedAt ?? '') > (current.updatedAt ?? '') ? row.updatedAt : current.updatedAt,
    });
  }
  return [...byKey.values()];
};

interface TenantMaps {
  courseIds: Map<string, string>;
  moduleIds: Map<string, string>;
  lessonIds: Map<string, string>;
  productIds: Map<string, string>;
  memberIds: Map<string, string>;
}

const importTenant = async (
  db: Db,
  target: ImportTarget,
  userIdByEmail: ReadonlyMap<string, string | null>,
  claimed: ClaimedIds,
  options: ImportRunOptions,
): Promise<TenantImportResult> => {
  const { tenantId, tenantSlug } = target.tenant;
  const bundle = target.bundle;
  const now = options.nowIso();

  const [courseRows, moduleRows, lessonRows, productRows, memberRows, grantRows, progressRows] =
    await Promise.all([
      db.select().from(courses).where(eq(courses.tenantId, tenantId)),
      db.select().from(courseModules).where(eq(courseModules.tenantId, tenantId)),
      db.select().from(courseLessons).where(eq(courseLessons.tenantId, tenantId)),
      db.select().from(products).where(eq(products.tenantId, tenantId)),
      db.select().from(members).where(eq(members.tenantId, tenantId)),
      db.select().from(productGrants).where(eq(productGrants.tenantId, tenantId)),
      db.select().from(memberCourseProgress).where(eq(memberCourseProgress.tenantId, tenantId)),
    ]);
  const activeMemberRows = memberRows.filter((row) => row.deletedAt === null);
  const deletedMemberIds = new Set(
    memberRows.filter((row) => row.deletedAt !== null).map((row) => row.id),
  );
  const erasedLinks =
    (await loadErasedMemberLinks(db, [tenantId])).get(tenantId) ?? emptyErasedMemberLinks();
  const pseudonymizedMemberLegacyIds = erasedBundleMemberLegacyIds(
    target,
    erasedLinks,
    options.emailHmac,
  );

  const takenIn =
    (table: typeof courses | typeof courseModules | typeof courseLessons | typeof products | typeof members | typeof productGrants | typeof memberCourseProgress) =>
    async (candidates: string[]): Promise<Set<string>> => {
      if (candidates.length === 0) return new Set();
      const rows = await db
        .select({ id: table.id })
        .from(table)
        .where(inArray(table.id, candidates));
      return new Set(rows.map((row) => row.id));
    };

  const maps: TenantMaps = {
    courseIds: await planKindIds({
      bundleLegacyIds: bundle.courses.map((row) => row.legacyId),
      existingIdByLegacy: idsByLegacy(courseRows),
      takenIds: takenIn(courses),
      claimed: claimed.courses,
      tenantSlug,
    }),
    moduleIds: await planKindIds({
      bundleLegacyIds: bundle.modules.map((row) => row.legacyId),
      existingIdByLegacy: idsByLegacy(moduleRows),
      takenIds: takenIn(courseModules),
      claimed: claimed.modules,
      tenantSlug,
    }),
    lessonIds: await planKindIds({
      bundleLegacyIds: bundle.lessons.map((row) => row.legacyId),
      existingIdByLegacy: idsByLegacy(lessonRows),
      takenIds: takenIn(courseLessons),
      claimed: claimed.lessons,
      tenantSlug,
    }),
    productIds: await planKindIds({
      bundleLegacyIds: bundle.products.map((row) => row.legacyId),
      existingIdByLegacy: idsByLegacy(productRows),
      takenIds: takenIn(products),
      claimed: claimed.products,
      tenantSlug,
    }),
    memberIds: await planKindIds({
      bundleLegacyIds: bundle.members.map((row) => row.legacyId),
      existingIdByLegacy: idsByLegacy(activeMemberRows),
      takenIds: takenIn(members),
      claimed: claimed.members,
      tenantSlug,
    }),
  };

  const grantIds = await planKindIds({
    bundleLegacyIds: bundle.grants.map((row) => row.legacyId),
    existingIdByLegacy: idsByLegacy(grantRows),
    takenIds: takenIn(productGrants),
    claimed: claimed.grants,
    tenantSlug,
  });
  const progressIds = await planKindIds({
    bundleLegacyIds: bundle.progress.map((row) => row.legacyId),
    existingIdByLegacy: new Map<string, string>(),
    takenIds: takenIn(memberCourseProgress),
    claimed: claimed.progress,
    tenantSlug,
  });

  const coursePlan = planSimpleKind({
    kind: 'courses',
    entries: bundle.courses,
    existingByLegacy: legacyRowsById(courseRows),
    rowFields: (row) => ({
      name: row.name,
      description: row.description,
      imageUrl: row.imageUrl,
      moduleOrder: row.moduleOrder,
    }),
    desired: (entry, report) => ({
      name: entry.name,
      description: entry.description,
      imageUrl: entry.imageUrl,
      moduleOrder: entry.moduleOrder.map((legacyId) =>
        mapReference(maps.moduleIds, legacyId, report, 'course-module-ref-unmapped', `courses/${entry.legacyId}`),
      ),
    }),
    insert: (entry, patch) => ({
      id: maps.courseIds.get(entry.legacyId) ?? entry.legacyId,
      tenantId,
      ...patch,
      legacyId: entry.legacyId,
      createdAt: now,
    }),
  });

  const courseOrderIndex = moduleOrderByCourse(bundle);
  const modulePlan = planSimpleKind({
    kind: 'modules',
    entries: bundle.modules,
    existingByLegacy: legacyRowsById(moduleRows),
    rowFields: (row) => ({
      courseIds: row.courseIds,
      title: row.title,
      prefix: row.prefix,
      chapters: row.chapters,
    }),
    desired: (entry, report) => ({
      courseIds: entry.courseLegacyIds
        .filter((courseLegacyId) => {
          if (isModuleInCourseOrder(courseOrderIndex, entry.legacyId, courseLegacyId)) return true;
          report.anomalies.push({
            kind: 'module-detached-from-course',
            subject: `modules/${entry.legacyId}`,
            detail: `module "${entry.title}" points at course ${courseLegacyId} which does not list it in its module order; legacy never rendered it, so the link was dropped`,
          });
          return false;
        })
        .map((legacyId) =>
          mapReference(maps.courseIds, legacyId, report, 'module-course-ref-unmapped', `modules/${entry.legacyId}`),
        )
        .sort(),
      title: entry.title,
      prefix: entry.prefix,
      chapters: entry.chapters.map((chapter) => ({
        ...chapter,
        contents: chapter.contents.map((content) => ({
          ...content,
          lessonId: mapReference(
            maps.lessonIds,
            content.lessonId,
            report,
            'chapter-lesson-ref-unmapped',
            `modules/${entry.legacyId}`,
          ),
        })),
      })),
    }),
    insert: (entry, patch) => ({
      id: maps.moduleIds.get(entry.legacyId) ?? entry.legacyId,
      tenantId,
      ...patch,
      legacyId: entry.legacyId,
      createdAt: now,
    }),
  });

  const lessonPlan = planSimpleKind({
    kind: 'lessons',
    entries: bundle.lessons,
    existingByLegacy: legacyRowsById(lessonRows),
    rowFields: (row) => ({ name: row.name, contents: row.contents }),
    desired: (entry) => ({ name: entry.name, contents: entry.contents }),
    insert: (entry, patch) => ({
      id: maps.lessonIds.get(entry.legacyId) ?? entry.legacyId,
      tenantId,
      ...patch,
      legacyId: entry.legacyId,
      createdAt: now,
    }),
  });

  const mapAccessItem = (
    item: AccessItem,
    report: KindReport,
    subject: string,
  ): AccessItem => {
    const courseId = mapReference(maps.courseIds, item.courseId, report, 'product-course-ref-unmapped', subject);
    if (item.level === 'course') {
      return item.excludedModuleIds === undefined
        ? { level: 'course', courseId }
        : {
            level: 'course',
            courseId,
            excludedModuleIds: item.excludedModuleIds.map((legacyId) =>
              mapReference(maps.moduleIds, legacyId, report, 'product-module-ref-unmapped', subject),
            ),
          };
    }
    if (item.level === 'modules') {
      return {
        level: 'modules',
        courseId,
        moduleIds: item.moduleIds.map((legacyId) =>
          mapReference(maps.moduleIds, legacyId, report, 'product-module-ref-unmapped', subject),
        ),
      };
    }
    return {
      level: 'lessons',
      courseId,
      lessonIds: item.lessonIds.map((legacyId) =>
        mapReference(maps.lessonIds, legacyId, report, 'product-lesson-ref-unmapped', subject),
      ),
    };
  };

  const productPlan = planSimpleKind({
    kind: 'products',
    entries: bundle.products,
    existingByLegacy: legacyRowsById(productRows),
    rowFields: (row) => ({ title: row.title, accessItems: row.accessItems }),
    desired: (entry, report) => ({
      title: entry.title,
      accessItems: entry.accessItems.map((item) =>
        mapAccessItem(item, report, `products/${entry.legacyId}`),
      ),
    }),
    insert: (entry, patch) => ({
      id: maps.productIds.get(entry.legacyId) ?? entry.legacyId,
      tenantId,
      ...patch,
      description: '',
      priceCents: 0,
      currency: 'PLN',
      published: false,
      legacyId: entry.legacyId,
      createdAt: now,
    }),
  });

  const memberReport = emptyReport('members');
  type MemberInsert = typeof members.$inferInsert;
  interface MemberPatch extends Record<string, unknown> {
    userId: string;
    email: string;
    displayName: string | null;
    legacyId: string;
    createdAt: string;
  }
  const memberCreates: MemberInsert[] = [];
  const memberUpdates: { id: string; patch: MemberPatch }[] = [];
  const membersByLegacy = legacyRowsById(activeMemberRows);
  const membersByUserId = new Map(activeMemberRows.map((row) => [row.userId, row]));
  const membersByEmail = new Map<string, (typeof memberRows)[number]>();
  for (const row of activeMemberRows) {
    const email = normalizeEmail(row.email);
    if (!membersByEmail.has(email)) membersByEmail.set(email, row);
  }
  const seenMemberEmails = new Set<string>();
  for (const entry of bundle.members) {
    if (pseudonymizedMemberLegacyIds.has(entry.legacyId)) {
      memberReport.skip += 1;
      memberReport.anomalies.push({
        kind: 'pseudonymized-member-skipped',
        subject: `members/${entry.legacyId}`,
        detail: `member ${entry.legacyId} was previously pseudonymized; the bundle row was skipped`,
      });
      maps.memberIds.delete(entry.legacyId);
      continue;
    }
    const email = normalizeEmail(entry.email);
    if (seenMemberEmails.has(email)) {
      memberReport.dropped += 1;
      memberReport.anomalies.push({
        kind: 'duplicate-member-email',
        subject: `members/${entry.legacyId}`,
        detail: `another bundle member already uses ${email} in this tenant; this row was dropped`,
      });
      maps.memberIds.delete(entry.legacyId);
      continue;
    }
    seenMemberEmails.add(email);
    const ensuredUserId = userIdByEmail.get(email) ?? null;
    const existing =
      membersByLegacy.get(entry.legacyId) ??
      (ensuredUserId !== null ? membersByUserId.get(ensuredUserId) : undefined) ??
      membersByEmail.get(email);
    if (existing === undefined) {
      memberReport.create += 1;
      memberCreates.push({
        id: maps.memberIds.get(entry.legacyId) ?? entry.legacyId,
        tenantId,
        userId: ensuredUserId ?? `(pending)-${entry.legacyId}`,
        email,
        displayName: entry.displayName,
        legacyId: entry.legacyId,
        createdAt: legacyObjectIdCreatedAt(entry.legacyId) ?? now,
      });
      continue;
    }
    maps.memberIds.set(entry.legacyId, existing.id);
    if (existing.legacyId !== entry.legacyId) {
      memberReport.anomalies.push({
        kind: 'member-adopted-existing',
        subject: `members/${entry.legacyId}`,
        detail: `an existing member row (${existing.id}) for ${email} was adopted and tagged with the legacyId`,
      });
    }
    const patch: MemberPatch = {
      userId: ensuredUserId ?? existing.userId,
      email,
      displayName: entry.displayName,
      legacyId: entry.legacyId,
      createdAt: legacyObjectIdCreatedAt(entry.legacyId) ?? existing.createdAt,
    };
    const changes = changedFields(
      {
        userId: existing.userId,
        email: normalizeEmail(existing.email),
        displayName: existing.displayName,
        legacyId: existing.legacyId,
        createdAt: existing.createdAt,
      },
      patch,
    );
    if (changes.length === 0) {
      memberReport.skip += 1;
      continue;
    }
    memberReport.update += 1;
    if (memberReport.samples.length < SAMPLE_LIMIT) {
      memberReport.samples.push({ key: entry.legacyId, changes });
    }
    memberUpdates.push({ id: existing.id, patch });
  }

  const grantReport = emptyReport('grants');
  type GrantInsert = typeof productGrants.$inferInsert;
  interface GrantPatch extends Record<string, unknown> {
    memberId: string;
    productId: string;
    startsAt: string;
    expiresAt: string | null;
    legacyId: string;
  }
  const grantCreates: GrantInsert[] = [];
  const grantUpdates: { id: string; patch: GrantPatch }[] = [];
  const grantsByLegacy = legacyRowsById(grantRows);
  const grantsByPair = new Map(grantRows.map((row) => [`${row.memberId}::${row.productId}`, row]));
  for (const entry of dedupeGrants(bundle.grants, grantReport)) {
    const subject = `grants/${entry.legacyId}`;
    if (pseudonymizedMemberLegacyIds.has(entry.memberLegacyId)) {
      grantReport.skip += 1;
      grantReport.anomalies.push({
        kind: 'pseudonymized-member-grant-skipped',
        subject,
        detail: `member ${entry.memberLegacyId} was previously pseudonymized; the grant was skipped`,
      });
      continue;
    }
    const memberId = maps.memberIds.get(entry.memberLegacyId);
    const productId = maps.productIds.get(entry.productLegacyId);
    if (memberId === undefined || productId === undefined) {
      grantReport.dropped += 1;
      grantReport.anomalies.push({
        kind: 'grant-reference-missing',
        subject,
        detail: `member ${entry.memberLegacyId} or product ${entry.productLegacyId} is not part of the import; grant dropped`,
      });
      continue;
    }
    if (entry.startsAt === null) {
      grantReport.anomalies.push({
        kind: 'grant-missing-startsAt',
        subject,
        detail: `startsAt was null in the legacy dump; backfilled to ${EPOCH_ISO}`,
      });
    }
    if (entry.expiresAt === null) {
      grantReport.anomalies.push({
        kind: 'grant-missing-expiresAt',
        subject,
        detail: 'expiresAt was null in the legacy dump; imported as never-expiring (legacy treated it as revoked)',
      });
    }
    const patch: GrantPatch = {
      memberId,
      productId,
      startsAt: entry.startsAt ?? EPOCH_ISO,
      expiresAt: entry.expiresAt,
      legacyId: entry.legacyId,
    };
    const legacyMatch = grantsByLegacy.get(entry.legacyId);
    if (legacyMatch !== undefined && deletedMemberIds.has(legacyMatch.memberId)) {
      grantReport.skip += 1;
      continue;
    }
    const existing = legacyMatch ?? grantsByPair.get(`${memberId}::${productId}`);
    if (existing === undefined) {
      grantReport.create += 1;
      grantCreates.push({
        id: grantIds.get(entry.legacyId) ?? entry.legacyId,
        tenantId,
        ...patch,
        source: 'manual',
        createdAt: now,
      });
      continue;
    }
    if (existing.legacyId !== entry.legacyId) {
      grantReport.anomalies.push({
        kind: 'grant-adopted-existing',
        subject,
        detail: `an existing grant (${existing.id}) for the same member and product was adopted and tagged with the legacyId`,
      });
    }
    const changes = changedFields(
      {
        memberId: existing.memberId,
        productId: existing.productId,
        startsAt: existing.startsAt,
        expiresAt: existing.expiresAt,
        legacyId: existing.legacyId,
      },
      patch,
    );
    if (changes.length === 0) {
      grantReport.skip += 1;
      continue;
    }
    grantReport.update += 1;
    if (grantReport.samples.length < SAMPLE_LIMIT) {
      grantReport.samples.push({ key: entry.legacyId, changes });
    }
    grantUpdates.push({ id: existing.id, patch });
  }

  const progressReport = emptyReport('progress');
  type ProgressInsert = typeof memberCourseProgress.$inferInsert;
  interface ProgressPatch extends Record<string, unknown> {
    lastViewedLessonId: string | null;
    lastViewedModuleId: string | null;
    lastViewedChapterId: string | null;
    completedLessonIds: string[];
  }
  const progressCreates: ProgressInsert[] = [];
  const progressUpdates: { id: string; patch: ProgressPatch; updatedAt: string }[] = [];
  const progressByPair = new Map(
    progressRows.map((row) => [`${row.memberId}::${row.courseId}`, row]),
  );
  const mapLessonRef = (legacyId: string, subject: string): string =>
    mapReference(maps.lessonIds, legacyId, progressReport, 'progress-lesson-ref-unmapped', subject);
  for (const entry of mergeProgressRows(bundle.progress, progressReport)) {
    const subject = `progress/${entry.legacyId}`;
    const memberId = maps.memberIds.get(entry.userLegacyId);
    const courseId = maps.courseIds.get(entry.courseLegacyId);
    if (memberId === undefined || courseId === undefined) {
      progressReport.dropped += 1;
      progressReport.anomalies.push({
        kind: 'progress-reference-missing',
        subject,
        detail: `member ${entry.userLegacyId} or course ${entry.courseLegacyId} is not part of the import; progress dropped`,
      });
      continue;
    }
    const completed = [...new Set(entry.completedLessonIds.map((id) => mapLessonRef(id, subject)))];
    const lastViewedLessonId =
      entry.lastViewedLessonId === null ? null : mapLessonRef(entry.lastViewedLessonId, subject);
    const lastViewedModuleId =
      entry.lastViewedModuleId === null
        ? null
        : mapReference(maps.moduleIds, entry.lastViewedModuleId, progressReport, 'progress-module-ref-unmapped', subject);
    const existing = progressByPair.get(`${memberId}::${courseId}`);
    if (existing === undefined) {
      progressReport.create += 1;
      progressCreates.push({
        id: progressIds.get(entry.legacyId) ?? entry.legacyId,
        tenantId,
        memberId,
        courseId,
        lastViewedLessonId,
        lastViewedModuleId,
        lastViewedChapterId: entry.lastViewedChapterId,
        completedLessonIds: completed,
        updatedAt: entry.updatedAt ?? now,
      });
      continue;
    }
    const union = [
      ...existing.completedLessonIds,
      ...completed.filter((id) => !existing.completedLessonIds.includes(id)),
    ];
    const patch: ProgressPatch = {
      lastViewedLessonId: existing.lastViewedLessonId ?? lastViewedLessonId,
      lastViewedModuleId: existing.lastViewedModuleId ?? lastViewedModuleId,
      lastViewedChapterId: existing.lastViewedChapterId ?? entry.lastViewedChapterId,
      completedLessonIds: union,
    };
    const changes = changedFields(
      {
        lastViewedLessonId: existing.lastViewedLessonId,
        lastViewedModuleId: existing.lastViewedModuleId,
        lastViewedChapterId: existing.lastViewedChapterId,
        completedLessonIds: existing.completedLessonIds,
      },
      patch,
    );
    if (changes.length === 0) {
      progressReport.skip += 1;
      continue;
    }
    progressReport.update += 1;
    if (progressReport.samples.length < SAMPLE_LIMIT) {
      progressReport.samples.push({ key: entry.legacyId, changes });
    }
    progressUpdates.push({ id: existing.id, patch, updatedAt: now });
  }

  if (options.apply) {
    await db.transaction(async (tx) => {
      for (const batch of chunk(coursePlan.creates, 100)) await tx.insert(courses).values(batch);
      for (const update of coursePlan.updates) {
        await tx
          .update(courses)
          .set(update.patch)
          .where(and(eq(courses.tenantId, tenantId), eq(courses.id, update.id)));
      }
    });
    await db.transaction(async (tx) => {
      for (const batch of chunk(modulePlan.creates, 100)) await tx.insert(courseModules).values(batch);
      for (const update of modulePlan.updates) {
        await tx
          .update(courseModules)
          .set(update.patch)
          .where(and(eq(courseModules.tenantId, tenantId), eq(courseModules.id, update.id)));
      }
    });
    await db.transaction(async (tx) => {
      for (const batch of chunk(lessonPlan.creates, 100)) await tx.insert(courseLessons).values(batch);
      for (const update of lessonPlan.updates) {
        await tx
          .update(courseLessons)
          .set(update.patch)
          .where(and(eq(courseLessons.tenantId, tenantId), eq(courseLessons.id, update.id)));
      }
    });
    await db.transaction(async (tx) => {
      for (const batch of chunk(productPlan.creates, 100)) await tx.insert(products).values(batch);
      for (const update of productPlan.updates) {
        await tx
          .update(products)
          .set(update.patch)
          .where(and(eq(products.tenantId, tenantId), eq(products.id, update.id)));
      }
    });
    await db.transaction(async (tx) => {
      for (const batch of chunk(memberCreates, 100)) await tx.insert(members).values(batch);
      for (const update of memberUpdates) {
        await tx
          .update(members)
          .set(update.patch)
          .where(and(eq(members.tenantId, tenantId), eq(members.id, update.id)));
      }
    });
    await db.transaction(async (tx) => {
      for (const batch of chunk(grantCreates, 100)) await tx.insert(productGrants).values(batch);
      for (const update of grantUpdates) {
        await tx
          .update(productGrants)
          .set(update.patch)
          .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, update.id)));
      }
    });
    await db.transaction(async (tx) => {
      for (const batch of chunk(progressCreates, 100)) {
        await tx.insert(memberCourseProgress).values(batch);
      }
      for (const update of progressUpdates) {
        await tx
          .update(memberCourseProgress)
          .set({ ...update.patch, updatedAt: update.updatedAt })
          .where(
            and(
              eq(memberCourseProgress.tenantId, tenantId),
              eq(memberCourseProgress.id, update.id),
            ),
          );
      }
    });
  }

  return {
    bundleSlug: target.tenant.bundleSlug,
    tenantId,
    kinds: [
      coursePlan.report,
      modulePlan.report,
      lessonPlan.report,
      productPlan.report,
      memberReport,
      grantReport,
      progressReport,
    ],
  };
};

const expectedKindCount = (report: KindReport): number =>
  report.create +
  report.update +
  report.skip -
  report.anomalies.filter(
    (anomaly) =>
      anomaly.kind === 'pseudonymized-member-skipped' ||
      anomaly.kind === 'pseudonymized-member-grant-skipped',
  ).length;

const verifyTenant = async (
  db: Db,
  target: ImportTarget,
  result: TenantImportResult,
  markerByEmail: ReadonlyMap<string, string>,
  options: ImportRunOptions,
): Promise<TenantVerification> => {
  const { tenantId } = target.tenant;
  const bundle = target.bundle;
  const counts: VerificationCount[] = [];

  const kindSpecs = [
    {
      kind: 'courses',
      bundleIds: bundle.courses.map((row) => row.legacyId),
      dbLegacyIds: (
        await db
          .select({ legacyId: courses.legacyId })
          .from(courses)
          .where(and(eq(courses.tenantId, tenantId), isNotNull(courses.legacyId)))
      ).flatMap((row) => (row.legacyId === null ? [] : [row.legacyId])),
    },
    {
      kind: 'modules',
      bundleIds: bundle.modules.map((row) => row.legacyId),
      dbLegacyIds: (
        await db
          .select({ legacyId: courseModules.legacyId })
          .from(courseModules)
          .where(and(eq(courseModules.tenantId, tenantId), isNotNull(courseModules.legacyId)))
      ).flatMap((row) => (row.legacyId === null ? [] : [row.legacyId])),
    },
    {
      kind: 'lessons',
      bundleIds: bundle.lessons.map((row) => row.legacyId),
      dbLegacyIds: (
        await db
          .select({ legacyId: courseLessons.legacyId })
          .from(courseLessons)
          .where(and(eq(courseLessons.tenantId, tenantId), isNotNull(courseLessons.legacyId)))
      ).flatMap((row) => (row.legacyId === null ? [] : [row.legacyId])),
    },
    {
      kind: 'products',
      bundleIds: bundle.products.map((row) => row.legacyId),
      dbLegacyIds: (
        await db
          .select({ legacyId: products.legacyId })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), isNotNull(products.legacyId)))
      ).flatMap((row) => (row.legacyId === null ? [] : [row.legacyId])),
    },
    {
      kind: 'members',
      bundleIds: bundle.members.map((row) => row.legacyId),
      dbLegacyIds: (
        await db
          .select({ legacyId: members.legacyId })
          .from(members)
          .where(and(eq(members.tenantId, tenantId), isNotNull(members.legacyId)))
      ).flatMap((row) => (row.legacyId === null ? [] : [row.legacyId])),
    },
    {
      kind: 'grants',
      bundleIds: bundle.grants.map((row) => row.legacyId),
      dbLegacyIds: (
        await db
          .select({ legacyId: productGrants.legacyId })
          .from(productGrants)
          .where(and(eq(productGrants.tenantId, tenantId), isNotNull(productGrants.legacyId)))
      ).flatMap((row) => (row.legacyId === null ? [] : [row.legacyId])),
    },
  ];

  const reportByKind = new Map(result.kinds.map((report) => [report.kind, report]));
  for (const spec of kindSpecs) {
    const bundleSet = new Set(spec.bundleIds);
    const dbSet = new Set(spec.dbLegacyIds);
    const matched = [...bundleSet].filter((id) => dbSet.has(id)).length;
    const extra = [...dbSet].filter((id) => !bundleSet.has(id)).length;
    const report = reportByKind.get(spec.kind);
    const expected = report === undefined ? bundleSet.size : expectedKindCount(report);
    counts.push({
      kind: spec.kind,
      bundle: bundleSet.size,
      expectedInDb: expected,
      matchedInDb: matched,
      extraLegacyInDb: extra,
      pass: matched === expected,
    });
  }

  const memberRowsNow = await db.select().from(members).where(eq(members.tenantId, tenantId));
  const memberIdByLegacy = idsByLegacy(memberRowsNow);
  const courseRowsNow = await db.select().from(courses).where(eq(courses.tenantId, tenantId));
  const courseIdByLegacy = idsByLegacy(courseRowsNow);
  const progressPairs = new Set(
    (
      await db
        .select({ memberId: memberCourseProgress.memberId, courseId: memberCourseProgress.courseId })
        .from(memberCourseProgress)
        .where(eq(memberCourseProgress.tenantId, tenantId))
    ).map((row) => `${row.memberId}::${row.courseId}`),
  );
  const progressReport = reportByKind.get('progress');
  const progressExpected =
    progressReport === undefined ? bundle.progress.length : expectedKindCount(progressReport);
  const progressMatched = bundle.progress.filter((row) => {
    const memberId = memberIdByLegacy.get(row.userLegacyId);
    const courseId = courseIdByLegacy.get(row.courseLegacyId);
    return (
      memberId !== undefined && courseId !== undefined && progressPairs.has(`${memberId}::${courseId}`)
    );
  }).length;
  counts.push({
    kind: 'progress',
    bundle: bundle.progress.length,
    expectedInDb: progressExpected,
    matchedInDb: progressMatched,
    extraLegacyInDb: 0,
    pass: progressMatched === progressExpected,
  });

  const tenantEmails = [...new Set(bundle.users.map((row) => normalizeEmail(row.email)))];
  let markersTotal = 0;
  let markersVerified = 0;
  if (tenantEmails.length > 0) {
    const credentialRows = await db
      .select({ email: user.email, password: account.password })
      .from(user)
      .innerJoin(account, eq(account.userId, user.id))
      .where(and(inArray(user.email, tenantEmails), eq(account.providerId, 'credential')));
    const passwordByEmail = new Map(credentialRows.map((row) => [row.email, row.password]));
    for (const email of tenantEmails) {
      const marker = markerByEmail.get(email);
      if (marker === undefined) continue;
      markersTotal += 1;
      if (passwordByEmail.get(email) === marker) markersVerified += 1;
    }
  }

  const spotChecks = await runSpotChecks(db, target, options);

  const pass =
    counts.every((count) => count.pass) &&
    markersVerified === markersTotal &&
    spotChecks.every((check) => check.pass);

  return {
    bundleSlug: target.tenant.bundleSlug,
    tenantId,
    counts,
    markersTotal,
    markersVerified,
    spotChecks,
    pass,
  };
};

const runSpotChecks = async (
  db: Db,
  target: ImportTarget,
  options: ImportRunOptions,
): Promise<SpotCheck[]> => {
  const { tenantId, tenantSlug, tenantName } = target.tenant;
  const bundle = target.bundle;
  const now = options.nowIso();

  const courseOrderIndex = moduleOrderByCourse(bundle);
  const moduleCourseIds = new Map<string, ReadonlySet<string>>(
    bundle.modules.map((module) => [
      module.legacyId,
      new Set(
        module.courseLegacyIds.filter((courseLegacyId) =>
          isModuleInCourseOrder(courseOrderIndex, module.legacyId, courseLegacyId),
        ),
      ),
    ]),
  );
  const lessonModuleIds = new Map<string, Set<string>>();
  for (const module of bundle.modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        const set = lessonModuleIds.get(content.lessonId) ?? new Set<string>();
        set.add(module.legacyId);
        lessonModuleIds.set(content.lessonId, set);
      }
    }
  }
  const lessonCourseIds = (lessonLegacyId: string): Set<string> => {
    const courseIds = new Set<string>();
    for (const moduleId of lessonModuleIds.get(lessonLegacyId) ?? []) {
      for (const courseId of moduleCourseIds.get(moduleId) ?? []) courseIds.add(courseId);
    }
    return courseIds;
  };

  const productByLegacy = new Map(bundle.products.map((product) => [product.legacyId, product]));
  const grantReportSink = emptyReport('spot-check');
  const dedupedGrants = dedupeGrants(bundle.grants, grantReportSink);
  const activeItemsByMember = new Map<string, AccessItem[]>();
  for (const grant of dedupedGrants) {
    const startsAt = grant.startsAt ?? EPOCH_ISO;
    const active = startsAt <= now && (grant.expiresAt === null || grant.expiresAt >= now);
    if (!active) {
      if (!activeItemsByMember.has(grant.memberLegacyId)) {
        activeItemsByMember.set(grant.memberLegacyId, []);
      }
      continue;
    }
    const product = productByLegacy.get(grant.productLegacyId);
    if (product === undefined) continue;
    const items = activeItemsByMember.get(grant.memberLegacyId) ?? [];
    items.push(...product.accessItems);
    activeItemsByMember.set(grant.memberLegacyId, items);
  }

  const expectedAccessible = (memberLegacyId: string, lessonLegacyId: string): boolean => {
    const items = activeItemsByMember.get(memberLegacyId) ?? [];
    const lessonCourses = lessonCourseIds(lessonLegacyId);
    const lessonModules = lessonModuleIds.get(lessonLegacyId) ?? new Set<string>();
    return items.some((item) => {
      if (item.level === 'course') return lessonCourses.has(item.courseId);
      if (item.level === 'modules') return item.moduleIds.some((id) => lessonModules.has(id));
      return item.lessonIds.includes(lessonLegacyId);
    });
  };

  const locatableLessons = bundle.lessons
    .map((lesson) => lesson.legacyId)
    .filter((legacyId) => lessonCourseIds(legacyId).size > 0)
    .sort();

  const memberRowsNow = await db.select().from(members).where(eq(members.tenantId, tenantId));
  const erasedLinks =
    (await loadErasedMemberLinks(db, [tenantId])).get(tenantId) ?? emptyErasedMemberLinks();
  const erasedLegacyIds = erasedBundleMemberLegacyIds(target, erasedLinks, options.emailHmac);
  const membersWithGrants = [...new Set(dedupedGrants.map((grant) => grant.memberLegacyId))]
    .filter((legacyId) => !erasedLegacyIds.has(legacyId))
    .sort()
    .slice(0, 3);
  const memberByLegacy = legacyRowsById(memberRowsNow);
  const lessonIdByLegacy = idsByLegacy(
    await db.select().from(courseLessons).where(eq(courseLessons.tenantId, tenantId)),
  );

  const deps = {
    grants: createProductGrantRepository(db),
    clock: { nowIso: () => now },
    courses: createCourseRepository(db),
    modules: createCourseModuleRepository(db),
    lessons: createCourseLessonRepository(db),
    progress: createMemberCourseProgressRepository(db),
    products: createProductRepository(db),
  };

  const checks: SpotCheck[] = [];
  for (const memberLegacyId of membersWithGrants) {
    const memberRow = memberByLegacy.get(memberLegacyId);
    if (memberRow === undefined) {
      checks.push({
        memberLegacyId,
        email: '(missing member row)',
        lessonLegacyId: '-',
        expectedAccessible: false,
        actual: 'member-not-imported',
        pass: false,
      });
      continue;
    }
    const accessibleLesson = locatableLessons.find((id) => expectedAccessible(memberLegacyId, id));
    const deniedLesson = locatableLessons.find((id) => !expectedAccessible(memberLegacyId, id));
    const lessonChecks = [
      ...(accessibleLesson === undefined ? [] : [{ lesson: accessibleLesson, expected: true }]),
      ...(deniedLesson === undefined ? [] : [{ lesson: deniedLesson, expected: false }]),
    ];
    for (const { lesson, expected } of lessonChecks) {
      const lessonId = lessonIdByLegacy.get(lesson);
      if (lessonId === undefined) {
        checks.push({
          memberLegacyId,
          email: memberRow.email,
          lessonLegacyId: lesson,
          expectedAccessible: expected,
          actual: 'lesson-not-imported',
          pass: false,
        });
        continue;
      }
      const ctx = {
        identity: {
          userId: memberRow.userId,
          email: memberRow.email,
          name: memberRow.displayName ?? memberRow.email,
          tenantId,
          tenantSlug,
          tenantName,
          staffRole: null,
          memberId: memberRow.id,
          memberBannedAt: null,
        },
      };
      const result = await isLessonAccessible(ctx, lessonId, deps);
      const actual = result.ok ? 'accessible' : result.error.code;
      const pass = result.ok
        ? expected
        : result.error.code === 'forbidden'
          ? !expected
          : false;
      checks.push({
        memberLegacyId,
        email: memberRow.email,
        lessonLegacyId: lesson,
        expectedAccessible: expected,
        actual,
        pass,
      });
    }
  }
  return checks;
};

export const runImport = async (
  db: Db,
  gateway: ImportAuthGateway,
  targets: ImportTarget[],
  options: ImportRunOptions,
): Promise<ImportRunResult> => {
  const erasedByTenant = await loadErasedMemberLinks(db, [
    ...new Set(targets.map((target) => target.tenant.tenantId)),
  ]);
  const usersOutcome = await importUsers(
    gateway,
    targets,
    options.apply,
    erasedByTenant,
    options.emailHmac,
  );
  const claimed = createClaimedIds();
  const tenantResults: TenantImportResult[] = [];
  for (const target of targets) {
    tenantResults.push(
      await importTenant(db, target, usersOutcome.userIdByEmail, claimed, options),
    );
  }
  let verification: VerificationReport | null = null;
  if (options.apply) {
    const tenantVerifications: TenantVerification[] = [];
    for (const [index, target] of targets.entries()) {
      const result = tenantResults[index];
      if (result === undefined) continue;
      tenantVerifications.push(
        await verifyTenant(db, target, result, usersOutcome.markerByEmail, options),
      );
    }
    verification = {
      tenants: tenantVerifications,
      pass: tenantVerifications.every((tenant) => tenant.pass),
    };
  }
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    users: usersOutcome.report,
    tenants: tenantResults,
    verification,
  };
};
