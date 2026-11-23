import {
  appError,
  CHANGE_PROPOSAL_DECIDED_FILTER,
  CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS,
  CHANGE_PROPOSAL_GROUP_LIMITS,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalEffectWithinLimit,
  changeProposalGroupOpen,
  changeProposalImageReferences,
  proposalImagePublicPath,
  err,
  sameProposalImage,
  QUARANTINED_IMAGE_LIMITS,
  sha256HexOfBytes,
  notFound,
  ok,
  validation,
  type AppError,
  type ChangeProposal,
  type ChangeProposalCountCap,
  type ChangeProposalEvent,
  type ChangeProposalEventKind,
  type ChangeProposalGroup,
  type ChangeProposalTarget,
  type ChangeProposalTargetPrice,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Notification,
  type Product,
  type ProductDownloadAsset,
  type ProductPrice,
  type ProposalImagePublication,
  type ProposalImageReference,
  type QuarantinedImageAsset,
  type QuarantinedImageUpload,
  type SalesLink,
  type ShopManagementKey,
  type StaffRole,
  type StockLevel,
  type TenantSettings,
} from '#core/domain/index.js';

import type { ChangeProposalOwnerViewDeps } from '../change-proposal-owner-facts.js';
import type { KeyDownloadFileRepository } from '../key-download-ports.js';
import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalGroupRepository,
  ChangeProposalGroupWithItems,
  ChangeProposalListQuery,
  ChangeProposalOwnerNotice,
  ChangeProposalOwnerNotifier,
  ChangeProposalPage,
  ChangeProposalPeopleReader,
  ChangeProposalRepositories,
  ChangeProposalRepository,
  ChangeProposalTargetLabelReader,
  ChangeProposalTransaction,
  ChangeProposalTransactionScope,
  ChangeProposalTransitionGuard,
  QuarantinedImageRelease,
  QuarantinedImageRepository,
  QuarantinedImageUploadResult,
  RealtimeEvent,
  SalesLinkRepository,
  TenantSecretResolver,
} from '../ports.js';
import type { StockRepository } from '../stock-ports.js';
import { noProposedFiles } from './key-download-fakes.js';

export interface FakeCatalogState {
  products: Product[];
  everPublished: string[];
  prices: ProductPrice[];
  stock: Array<StockLevel & { tenantId: string }>;
  stockEvents: number;
  entityVersions: number;
  entityVersionAuthors: Array<string | null>;
  contentVersionBumps: number;
  downloadAssets: ProductDownloadAsset[];
  salesLinks: Array<SalesLink & { deleted: boolean }>;
  settings: Array<{ tenantId: string; settings: TenantSettings }>;
  courses: Course[];
  modules: CourseModule[];
  lessons: CourseLesson[];
}

export const emptyCatalogState = (): FakeCatalogState => ({
  products: [],
  everPublished: [],
  prices: [],
  stock: [],
  stockEvents: 0,
  entityVersions: 0,
  entityVersionAuthors: [],
  contentVersionBumps: 0,
  downloadAssets: [],
  salesLinks: [],
  settings: [],
  courses: [],
  modules: [],
  lessons: [],
});

const unavailable = (name: string) => () => Promise.reject(new Error(`${name} is not part of the change proposal fake`));

const stockRepositoryOver = (state: FakeCatalogState): StockRepository => {
  const find = (tenantId: string, productId: string) =>
    state.stock.find((level) => level.tenantId === tenantId && level.productId === productId) ?? null;
  const view = (level: StockLevel): StockLevel => ({
    productId: level.productId,
    onHand: level.onHand,
    reserved: level.reserved,
    lowStockThreshold: level.lowStockThreshold,
    lowStockNotifiedAt: level.lowStockNotifiedAt,
    updatedAt: level.updatedAt,
  });
  return {
    find: async (tenantId, productId) => {
      const level = find(tenantId, productId);
      return level === null ? null : view(level);
    },
    listByProducts: async (tenantId, productIds) =>
      state.stock.filter((level) => level.tenantId === tenantId && productIds.includes(level.productId)).map(view),
    listByTenant: async (tenantId) => state.stock.filter((level) => level.tenantId === tenantId).map(view),
    enableTracking: async (tenantId, input) => {
      if (find(tenantId, input.productId) !== null) return err(appError('conflict', 'Stock tracking is already enabled for this product'));
      const level = { tenantId, productId: input.productId, onHand: input.onHand, reserved: 0, lowStockThreshold: input.lowStockThreshold, lowStockNotifiedAt: null, updatedAt: input.now };
      state.stock.push(level);
      state.stockEvents += 1;
      return ok(view(level));
    },
    adjust: async (tenantId, input) => {
      const level = find(tenantId, input.productId);
      if (level === null) return err(notFound('Stock tracking is not enabled for this product'));
      if (level.onHand + input.delta < 0) return err(validation('Stock on hand cannot go below zero'));
      level.onHand += input.delta;
      level.updatedAt = input.now;
      state.stockEvents += 1;
      return ok(view(level));
    },
    setThreshold: async (tenantId, input) => {
      const level = find(tenantId, input.productId);
      if (level === null) return err(notFound('Stock tracking is not enabled for this product'));
      level.lowStockThreshold = input.lowStockThreshold;
      level.updatedAt = input.now;
      return ok(view(level));
    },
    reserve: unavailable('stock.reserve'),
    release: unavailable('stock.release'),
    lockForCommit: unavailable('stock.lockForCommit'),
    commit: unavailable('stock.commit'),
    markLowStockNotified: unavailable('stock.markLowStockNotified'),
    releaseExpired: unavailable('stock.releaseExpired'),
  };
};

const salesLinkRepositoryOver = (state: FakeCatalogState): SalesLinkRepository => {
  const live = (tenantId: string) => state.salesLinks.filter((link) => link.tenantId === tenantId && !link.deleted);
  const view = (link: SalesLink & { deleted: boolean }): SalesLink => ({
    id: link.id, tenantId: link.tenantId, slug: link.slug, title: link.title, heading: link.heading, description: link.description,
    productIds: [...link.productIds], active: link.active, listed: link.listed, validFrom: link.validFrom, validTo: link.validTo,
    cancelReturnUrl: link.cancelReturnUrl ?? null, revision: link.revision, createdAt: link.createdAt, updatedAt: link.updatedAt,
  });
  return {
    list: async (tenantId) => live(tenantId).map(view),
    findById: async (tenantId, id) => {
      const found = live(tenantId).find((link) => link.id === id);
      return found === undefined ? null : view(found);
    },
    findBySlug: async (tenantId, slug) => {
      const found = live(tenantId).find((link) => link.slug === slug);
      return found === undefined ? null : view(found);
    },
    save: async (tenantId, link, expectedRevision) => {
      const existing = live(tenantId).find((candidate) => candidate.id === link.id);
      if (expectedRevision !== null && existing === undefined) return err(notFound('Sales link was not found'));
      if (expectedRevision !== null && existing?.revision !== expectedRevision) return err(appError('conflict', 'Sales link changed; reload before saving'));
      if (live(tenantId).some((candidate) => candidate.slug === link.slug && candidate.id !== link.id)) return err(appError('conflict', 'Sales-link slug already exists'));
      const saved = { ...structuredClone(link), tenantId, deleted: false };
      state.salesLinks = [...state.salesLinks.filter((candidate) => candidate !== existing), saved];
      return ok(view(saved));
    },
    delete: async (tenantId, id, occurredAt, expectedRevision) => {
      const existing = live(tenantId).find((link) => link.id === id);
      if (existing === undefined) return err(notFound('Sales link was not found'));
      if (expectedRevision !== undefined && existing.revision !== expectedRevision) return err(appError('conflict', 'Sales link changed; reload before deleting'));
      Object.assign(existing, { deleted: true, active: false, revision: existing.revision + 1, updatedAt: occurredAt });
      return ok(undefined);
    },
  };
};

const imageInLiveUse = (state: FakeCatalogState, tenantId: string, path: string): boolean =>
  state.products.some((candidate) => candidate.tenantId === tenantId && candidate.coverUrl === path)
  || state.settings.some(({ tenantId: owner, settings }) => owner === tenantId
    && [settings.logoUrl, settings.logoDarkUrl, settings.faviconUrl, settings.ogImageUrl].includes(path));

const sameImageRow = (row: QuarantinedImageAsset, tenantId: string, apiKeyId: string, image: ProposalImageReference): boolean =>
  row.tenantId === tenantId && row.apiKeyId === apiKeyId && row.kind === image.kind && row.digest === image.digest && row.extension === image.extension;

const samePublication = (row: FakeImagePublication, tenantId: string, attemptId: string, image: ProposalImageReference): boolean =>
  row.tenantId === tenantId && row.attemptId === attemptId && sameProposalImage(row.image, image);

const removeWhere = <T>(rows: T[], matches: (row: T) => boolean): void => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && matches(row)) rows.splice(index, 1);
  }
};

type FakeTransactionStore = Pick<FakeChangeProposalStore, 'repository' | 'events' | 'groups' | 'imageRows' | 'proposals' | 'imagePublications'>;

interface FakeCourseLock {
  courseIds: string[];
  targetLocksBefore: number;
}

const catalogRepositoriesOver = (
  state: FakeCatalogState,
  store: FakeTransactionStore,
  locks: ChangeProposalTarget[],
  courseLocks: FakeCourseLock[],
  repositoryCourseLocks: FakeCourseLock[],
): ChangeProposalRepositories => {
  const product = (tenantId: string, id: string) => state.products.find((candidate) => candidate.tenantId === tenantId && candidate.id === id) ?? null;
  return {
    products: {
      listByTenant: async (tenantId) => state.products.filter((candidate) => candidate.tenantId === tenantId),
      listPublishedByTenant: async (tenantId) => state.products.filter((candidate) => candidate.tenantId === tenantId && candidate.published),
      findById: async (tenantId, id) => {
        const found = product(tenantId, id);
        return found === null ? null : { ...found };
      },
      findByIds: async (tenantId, ids) =>
        state.products.filter((candidate) => candidate.tenantId === tenantId && ids.includes(candidate.id)).map((found) => ({ ...found })),
      create: async (tenantId, created) => {
        repositoryCourseLocks.push({ courseIds: created.accessItems.map((item) => item.courseId), targetLocksBefore: locks.length });
        if (state.products.some((candidate) => candidate.tenantId === tenantId && candidate.slug === created.slug)) return 'slug_taken';
        state.products.push({ ...created });
        return 'created';
      },
      update: async (tenantId, updated, version) => {
        const index = state.products.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === updated.id);
        const current = state.products[index];
        if (current === undefined) return null;
        const saved = { ...current, ...updated };
        state.products[index] = saved;
        state.entityVersions += 1;
        state.entityVersionAuthors.push(version.createdBy);
        return { ...saved };
      },
      updateAccessItems: async (tenantId, id, accessItems, version) => {
        repositoryCourseLocks.push({ courseIds: accessItems.map((item) => item.courseId), targetLocksBefore: locks.length });
        const referenced = new Set(accessItems.map((item) => item.courseId));
        if (state.courses.some((course) => course.tenantId === tenantId && referenced.has(course.id) && course.archivedAt)) return 'course_unavailable';
        const found = product(tenantId, id);
        if (found === null) return null;
        found.accessItems = structuredClone(accessItems);
        if (version !== undefined) {
          state.entityVersions += 1;
          state.entityVersionAuthors.push(version.createdBy);
        }
        return { ...found };
      },
      setPublished: async (tenantId, id, published) => {
        const found = product(tenantId, id);
        if (found === null) return;
        found.published = published;
        if (published && !state.everPublished.includes(id)) state.everPublished.push(id);
      },
      bumpContentVersion: async () => {
        state.contentVersionBumps += 1;
      },
    },
    prices: {
      listByProduct: async (tenantId, productId) => state.prices.filter((price) => price.tenantId === tenantId && price.productId === productId),
      listActiveByProducts: async (tenantId, productIds) =>
        state.prices.filter((price) => price.tenantId === tenantId && productIds.includes(price.productId) && price.active),
      findById: async (tenantId, id) => state.prices.find((price) => price.tenantId === tenantId && price.id === id) ?? null,
      create: async (_tenantId, price) => {
        state.prices.push({ ...price });
      },
      setActive: async (tenantId, id, active) => {
        const price = state.prices.find((candidate) => candidate.tenantId === tenantId && candidate.id === id);
        if (price === undefined) return null;
        price.active = active;
        return { ...price };
      },
    },
    tenants: {
      findSettings: async (tenantId) => {
        const found = state.settings.find((entry) => entry.tenantId === tenantId);
        return found === undefined ? null : structuredClone(found.settings);
      },
      changeSettings: async (tenantId, change) => {
        const found = state.settings.find((entry) => entry.tenantId === tenantId);
        if (found === undefined) return null;
        const changes = await change(structuredClone(found.settings));
        if (!changes.ok) return changes;
        found.settings = { ...found.settings, ...changes.value };
        state.contentVersionBumps += 1;
        return ok(structuredClone(found.settings));
      },
    },
    downloadAssets: {
      listByProduct: async (tenantId, productId) =>
        state.downloadAssets.filter((asset) => asset.tenantId === tenantId && asset.productId === productId),
      listReadyByProduct: async (tenantId, productId) =>
        state.downloadAssets.filter((asset) => asset.tenantId === tenantId && asset.productId === productId && asset.status === 'ready'),
    },
    spaces: { list: async () => [], findById: async () => null },
    courses: { findByIds: async (tenantId, ids) => state.courses.filter((course) => course.tenantId === tenantId && ids.includes(course.id)) },
    modules: {
      findByIds: async (tenantId, ids) => state.modules.filter((module) => module.tenantId === tenantId && ids.includes(module.id)),
      list: async (tenantId) => state.modules.filter((module) => module.tenantId === tenantId),
    },
    lessons: {
      existingIds: async (tenantId, ids) => state.lessons.filter((lesson) => lesson.tenantId === tenantId && ids.includes(lesson.id)).map((lesson) => lesson.id),
    },
    stock: stockRepositoryOver(state),
    productDrafts: {
      deleteDraft: async (tenantId, productId) => {
        const found = product(tenantId, productId);
        if (found === null) return { kind: 'not_found' };
        if (found.published || state.everPublished.includes(productId)) return { kind: 'refused', reason: 'published' };
        const assets = state.downloadAssets.filter((asset) => asset.tenantId === tenantId && asset.productId === productId);
        state.products = state.products.filter((candidate) => candidate !== found);
        state.prices = state.prices.filter((price) => !(price.tenantId === tenantId && price.productId === productId));
        state.downloadAssets = state.downloadAssets.filter((asset) => !assets.includes(asset));
        return { kind: 'deleted', assets };
      },
    },
    salesLinks: salesLinkRepositoryOver(state),
    changeProposals: store.repository,
    changeProposalEvents: store.events,
    changeProposalGroups: store.groups,
    targets: {
      lock: async (tenantId, target) => {
        locks.push(target);
        if (target.id === null) return target.kind !== 'price';
        if (target.kind === 'price') return state.prices.some((price) => price.tenantId === tenantId && price.id === target.id);
        if (target.kind === 'sales-link') return state.salesLinks.some((link) => link.tenantId === tenantId && link.id === target.id && !link.deleted);
        return product(tenantId, target.id) !== null;
      },
      lockCourses: async (_tenantId, courseIds) => {
        courseLocks.push({ courseIds: [...courseIds], targetLocksBefore: locks.length });
      },
    },
    keyDownloadAttach: { attach: unavailable('keyDownloadAttach.attach'), remove: unavailable('keyDownloadAttach.remove') },
    productFiles: {
      listReady: async (tenantId, productId) => state.downloadAssets
        .filter((asset) => asset.tenantId === tenantId && asset.productId === productId && asset.status === 'ready')
        .map((asset) => ({
          id: asset.id, lineageId: asset.lineageId, versionNumber: asset.versionNumber, latest: asset.supersededAt === null,
          fileName: asset.fileName, contentType: asset.contentType, sizeBytes: asset.sizeBytes, fingerprint: null, versionNote: asset.versionNote,
        })),
      lockStaged: async () => null,
    },
    quarantinedImages: {
      inLiveUse: async (tenantId, path) => imageInLiveUse(state, tenantId, path),
      lockForPublication: async (tenantId, apiKeyId, image) => {
        const row = store.imageRows.find((candidate) => sameImageRow(candidate, tenantId, apiKeyId, image));
        return row === undefined ? null : { ...row };
      },
      inAppliedProposal: async (tenantId, path) => store.proposals.some((proposal) => proposal.tenantId === tenantId && proposal.status === 'applied'
        && changeProposalImageReferences(proposal.operation, proposal.input).some((image) => proposalImagePublicPath(image) === path)),
      claimPublications: async (tenantId, attemptId, images) => images.every((image) => store.imagePublications.some((row) =>
        samePublication(row, tenantId, attemptId, image))),
      lockPublication: async (tenantId, attemptId, image, dueBefore) => {
        const row = store.imagePublications.find((candidate) => samePublication(candidate, tenantId, attemptId, image)
          && (dueBefore === undefined || (candidate.deleteUnresolvedAt ?? candidate.startedAt) < dueBefore));
        return row === undefined ? null : { deleteUnresolvedAt: row.deleteUnresolvedAt ?? null };
      },
      settlePublications: async (tenantId, attemptId) => {
        removeWhere(store.imagePublications, (row) => row.tenantId === tenantId && row.attemptId === attemptId);
      },
      deletePublication: async (tenantId, attemptId, image) => {
        removeWhere(store.imagePublications, (row) => samePublication(row, tenantId, attemptId, image));
      },
      deleteUnresolved: async (tenantId, image) => store.imagePublications.some((row) =>
        row.tenantId === tenantId && sameProposalImage(row.image, image) && row.deleteUnresolvedAt !== undefined),
      restartPublication: async (tenantId, attemptId, image, now) => {
        for (const row of store.imagePublications) {
          if (samePublication(row, tenantId, attemptId, image)) row.startedAt = now;
        }
      },
      markDeleteUnresolved: async (tenantId, attemptId, image, now) => {
        for (const row of store.imagePublications) {
          if (!samePublication(row, tenantId, attemptId, image)) continue;
          if (now === null) delete row.deleteUnresolvedAt;
          else row.deleteUnresolvedAt = now;
        }
      },
    },
  };
};

type FakeImagePublication = ProposalImagePublication & { tenantId: string; deleteUnresolvedAt?: string };

type FakeImageUpload = QuarantinedImageUpload & { tenantId: string; firstDeletedAt?: string; completed?: QuarantinedImageUploadResult };

const uploadDue = (createdBefore: string, deletedBefore: string) => (row: FakeImageUpload): boolean =>
  row.firstDeletedAt === undefined ? row.createdAt < createdBefore : row.firstDeletedAt < deletedBefore;

export interface FakeChangeProposalStore {
  repository: ChangeProposalRepository;
  events: ChangeProposalEventRepository;
  groups: ChangeProposalGroupRepository;
  proposals: ChangeProposal[];
  eventRows: ChangeProposalEvent[];
  groupRows: ChangeProposalGroup[];
  keys: ShopManagementKey[];
  imageRows: QuarantinedImageAsset[];
  releasedImageRows: QuarantinedImageAsset[];
  unresolvedImageDeletes: Map<QuarantinedImageAsset, string>;
  imageUploads: FakeImageUpload[];
  imagePublications: FakeImagePublication[];
  seed(proposal: ChangeProposal): void;
}

const byNewestFirst = (left: ChangeProposal, right: ChangeProposal): number =>
  right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);

export const createChangeProposalStoreFake = (keys: ShopManagementKey[] = []): FakeChangeProposalStore => {
  const proposals: ChangeProposal[] = [];
  const eventRows: ChangeProposalEvent[] = [];
  const imageRows: QuarantinedImageAsset[] = [];
  const imagesPresent = (tenantId: string, keyId: string, images: readonly ProposalImageReference[]): boolean =>
    images.every((image) => imageRows.some((row) => sameImageRow(row, tenantId, keyId, image)));
  const pendingAt = (proposal: ChangeProposal, now: string) => proposal.status === 'pending' && proposal.expiresAt > now;
  const matchesStatus = (proposal: ChangeProposal, query: ChangeProposalListQuery): boolean => {
    if (query.groupId !== undefined && proposal.groupId !== query.groupId) return false;
    if (query.status === undefined) return true;
    if (query.status === 'pending') return pendingAt(proposal, query.now);
    if (query.status === CHANGE_PROPOSAL_DECIDED_FILTER) return !pendingAt(proposal, query.now);
    if (query.status === 'expired') return proposal.status === 'pending' && proposal.expiresAt <= query.now;
    return proposal.status === query.status;
  };
  const appendEvent = (tenantId: string, proposalId: string, kind: ChangeProposalEventKind, draft: ChangeProposalEventDraft) => {
    const sequence = eventRows.filter((event) => event.tenantId === tenantId && event.proposalId === proposalId).length + 1;
    eventRows.push({ ...draft, tenantId, proposalId, sequence, kind });
  };
  const page = (rows: ChangeProposal[], query: ChangeProposalListQuery): ChangeProposalPage => {
    const sorted = rows.filter((proposal) => matchesStatus(proposal, query)).sort(byNewestFirst);
    const boundary = query.cursor === undefined ? undefined : rows.find((proposal) => proposal.id === query.cursor) ?? null;
    if (boundary === null) return { proposals: [], nextCursor: null };
    const after = boundary === undefined ? sorted : sorted.filter((proposal) => byNewestFirst(boundary, proposal) < 0);
    const slice = after.slice(0, query.limit);
    return { proposals: slice.map((proposal) => ({ ...proposal })), nextCursor: after.length > query.limit ? slice.at(-1)?.id ?? null : null };
  };
  const pendingRow = (tenantId: string, id: string, guard: ChangeProposalTransitionGuard = {}) =>
    proposals.find((proposal) => proposal.tenantId === tenantId
      && proposal.id === id
      && proposal.status === 'pending'
      && (guard.keyId === undefined || proposal.proposedByKeyId === guard.keyId)
      && (guard.unexpiredAt === undefined || proposal.expiresAt > guard.unexpiredAt)) ?? null;
  const countCapReached = (tenantId: string, keyId: string, now: string): ChangeProposalCountCap | null => {
    const workspace = proposals.filter((candidate) => candidate.tenantId === tenantId);
    const byKey = workspace.filter((candidate) => candidate.proposedByKeyId === keyId);
    if (byKey.filter((candidate) => pendingAt(candidate, now)).length >= CHANGE_PROPOSAL_LIMITS.pendingPerKey) return 'key_pending';
    if (workspace.filter((candidate) => pendingAt(candidate, now)).length >= CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace) return 'workspace_pending';
    const windowStart = new Date(Date.parse(now) - CHANGE_PROPOSAL_LIMITS.creationWindowMs).toISOString();
    if (byKey.filter((candidate) => candidate.createdAt > windowStart).length >= CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow) return 'key_daily';
    return null;
  };
  const keyActive = (tenantId: string, keyId: string, now: string): boolean => {
    const key = keys.find((candidate) => candidate.tenantId === tenantId && candidate.id === keyId);
    return key !== undefined && key.mode === 'propose' && key.revokedAt === null && key.expiresAt > now;
  };
  const transitionRow = (found: ChangeProposal, transition: Parameters<ChangeProposalRepository['transition']>[2]): ChangeProposal => {
    Object.assign(found, {
      status: transition.status,
      decidedByUserId: transition.decidedByUserId,
      decidedAt: transition.decidedAt,
      decisionNote: transition.decisionNote,
      appliedResourceId: transition.appliedResourceId,
      failureCode: transition.failureCode,
      failureMessage: transition.failureMessage,
    });
    appendEvent(found.tenantId, found.id, CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS[transition.status], transition.event);
    return { ...found };
  };
  const recordExpiry = (tenantId: string, id: string, event: ChangeProposalEventDraft): boolean => {
    const found = proposals.find((proposal) => proposal.tenantId === tenantId && proposal.id === id && proposal.status === 'pending' && proposal.expiresAt <= event.at);
    if (found === undefined) return false;
    if (eventRows.some((row) => row.tenantId === tenantId && row.proposalId === id && row.kind === 'expired')) return false;
    appendEvent(tenantId, id, 'expired', event);
    return true;
  };
  const repository: ChangeProposalRepository = {
    create: async (tenantId, proposal, event, now, images = []) => {
      if (!changeProposalEffectWithinLimit(proposal.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
      if (!keyActive(tenantId, proposal.proposedByKeyId, now)) return { kind: 'key_inactive' };
      if (!imagesPresent(tenantId, proposal.proposedByKeyId, images)) return { kind: 'image_missing' };
      const cap = countCapReached(tenantId, proposal.proposedByKeyId, now);
      if (cap !== null) return { kind: 'cap_exceeded', cap };
      proposals.push({ ...proposal });
      appendEvent(tenantId, proposal.id, 'proposed', event);
      return { kind: 'created', proposal: { ...proposal } };
    },
    countCapReached: async (tenantId, keyId, now) => countCapReached(tenantId, keyId, now),
    findById: async (tenantId, id) => {
      const found = proposals.find((proposal) => proposal.tenantId === tenantId && proposal.id === id);
      return found === undefined ? null : { ...found };
    },
    list: async (tenantId, query) => page(proposals.filter((proposal) => proposal.tenantId === tenantId), query),
    findByKey: async (tenantId, keyId, id) => {
      const found = proposals.find((proposal) => proposal.tenantId === tenantId && proposal.proposedByKeyId === keyId && proposal.id === id);
      return found === undefined ? null : { ...found };
    },
    listByKey: async (tenantId, keyId, query) =>
      page(proposals.filter((proposal) => proposal.tenantId === tenantId && proposal.proposedByKeyId === keyId), query),
    lockPending: async (tenantId, id, guard) => {
      const found = pendingRow(tenantId, id, guard);
      return found === null ? null : { ...found };
    },
    transition: async (tenantId, id, transition, guard) => {
      const found = pendingRow(tenantId, id, guard);
      return { kind: 'written', value: found === null ? null : transitionRow(found, transition) };
    },
    decide: async (tenantId, id, guard, decide) => {
      const found = proposals.find((proposal) => proposal.tenantId === tenantId && proposal.id === id
        && (guard.keyId === undefined || proposal.proposedByKeyId === guard.keyId));
      if (found === undefined) return { kind: 'not_found' };
      const decision = decide({ ...found });
      if (decision.kind === 'refuse') return { kind: 'decided', decision, proposal: { ...found } };
      if (decision.kind === 'record_expiry') {
        recordExpiry(tenantId, id, decision.event);
        return { kind: 'decided', decision, proposal: { ...found } };
      }
      if (found.status !== 'pending') throw new Error('A decision moved a proposal that is no longer pending');
      return { kind: 'decided', decision, proposal: transitionRow(found, decision.transition) };
    },
    recordExpiry: async (tenantId, id, event) => ({ kind: 'written', value: recordExpiry(tenantId, id, event) }),
    countPending: async (tenantId, now) => {
      const pending = proposals.filter((proposal) => proposal.tenantId === tenantId && pendingAt(proposal, now));
      return { proposals: pending.length, groups: new Set(pending.flatMap((proposal) => proposal.groupId === null ? [] : [proposal.groupId])).size };
    },
    hasAny: async (tenantId) => proposals.some((proposal) => proposal.tenantId === tenantId),
  };
  const groupRows: ChangeProposalGroup[] = [];
  const itemsOf = (tenantId: string, groupId: string): ChangeProposal[] =>
    proposals.filter((proposal) => proposal.tenantId === tenantId && proposal.groupId === groupId)
      .sort((left, right) => (left.groupPosition ?? 0) - (right.groupPosition ?? 0));
  const withItems = (group: ChangeProposalGroup | undefined): ChangeProposalGroupWithItems | null =>
    group === undefined ? null : { group: { ...group }, items: itemsOf(group.tenantId, group.id).map((item) => ({ ...item })) };
  const groupNamed = (tenantId: string, id: string, keyId?: string): ChangeProposalGroup | undefined =>
    groupRows.find((group) => group.tenantId === tenantId && group.id === id && (keyId === undefined || group.proposedByKeyId === keyId));
  const groups: ChangeProposalGroupRepository = {
    create: async (tenantId, group, now) => {
      if (!keyActive(tenantId, group.proposedByKeyId, now)) return { kind: 'key_inactive' };
      const open = groupRows.filter((candidate) => candidate.tenantId === tenantId && candidate.proposedByKeyId === group.proposedByKeyId
        && changeProposalGroupOpen(candidate, itemsOf(tenantId, candidate.id), now));
      if (open.length >= CHANGE_PROPOSAL_GROUP_LIMITS.openGroupsPerKey) return { kind: 'cap_exceeded' };
      groupRows.push({ ...group });
      return { kind: 'created', group: { ...group } };
    },
    findById: async (tenantId, id) => withItems(groupNamed(tenantId, id)),
    findByKey: async (tenantId, keyId, id) => withItems(groupNamed(tenantId, id, keyId)),
    listByIds: async (tenantId, ids) => groupRows.filter((group) => group.tenantId === tenantId && ids.includes(group.id)).map((group) => ({ ...group })),
    addItem: async (tenantId, proposal, event, clock, images = []) => {
      if (!changeProposalEffectWithinLimit(proposal.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
      if (!keyActive(tenantId, proposal.proposedByKeyId, clock.nowIso())) return { kind: 'key_inactive' };
      if (!imagesPresent(tenantId, proposal.proposedByKeyId, images)) return { kind: 'image_missing' };
      const current = withItems(groupNamed(tenantId, proposal.groupId ?? '', proposal.proposedByKeyId));
      if (current === null) return { kind: 'not_found' };
      const now = clock.nowIso();
      if (!changeProposalGroupOpen(current.group, current.items, now)) return { kind: 'group_closed', current, at: now };
      if (current.items.length >= CHANGE_PROPOSAL_GROUP_LIMITS.itemsPerGroup) return { kind: 'group_full' };
      const first = current.items[0];
      if (current.items.length + 1 !== proposal.groupPosition || (first !== undefined && first.expiresAt !== proposal.expiresAt)) {
        return { kind: 'group_changed' };
      }
      const cap = countCapReached(tenantId, proposal.proposedByKeyId, now);
      if (cap !== null) return { kind: 'cap_exceeded', cap };
      proposals.push({ ...proposal });
      appendEvent(tenantId, proposal.id, 'proposed', event);
      return { kind: 'created', proposal: { ...proposal } };
    },
    lock: async (tenantId, id) => withItems(groupNamed(tenantId, id)),
    decide: async (tenantId, id, guard, decide) => {
      const locked = withItems(groupNamed(tenantId, id, guard.keyId));
      if (locked === null) return { kind: 'not_found' };
      const decision = decide(locked);
      if (decision.kind === 'refuse') return { kind: 'decided', decision, ...locked };
      const items = itemsOf(tenantId, id);
      if (decision.kind === 'record_expiry') {
        for (const item of items) recordExpiry(tenantId, item.id, decision.event(item.id));
        return { kind: 'decided', decision, ...locked };
      }
      if (items.length !== decision.transitions.length || items.some((item, index) => item.id !== decision.transitions[index]?.id)) {
        throw new Error('A group decision named other items than the locked ones');
      }
      return {
        kind: 'decided',
        decision,
        group: locked.group,
        items: decision.transitions.map(({ transition }, index) => {
          const item = items[index];
          if (item === undefined) throw new Error('A group item vanished');
          return transitionRow(item, transition);
        }),
      };
    },
    transition: async (tenantId, id, transitions, guard = {}) => {
      const group = groupNamed(tenantId, id, guard.keyId);
      if (group === undefined) return null;
      const items = itemsOf(tenantId, id);
      const sameItems = items.length > 0 && items.length === transitions.length && items.every((item, index) => item.id === transitions[index]?.id);
      const movable = items.every((item) => item.status === 'pending' && (guard.unexpiredAt === undefined || item.expiresAt > guard.unexpiredAt));
      if (!sameItems || !movable) return null;
      return transitions.map(({ transition }, index) => {
        const item = items[index];
        if (item === undefined) throw new Error('A group item vanished');
        return transitionRow(item, transition);
      });
    },
    recordExpiry: async (tenantId, id, event) => {
      let recorded = false;
      for (const item of itemsOf(tenantId, id)) {
        if (recordExpiry(tenantId, item.id, event(item.id))) recorded = true;
      }
      return { kind: 'written', value: recorded };
    },
    deleteEmpty: async (tenantId, keyId, id) => {
      const group = groupNamed(tenantId, id, keyId);
      if (group === undefined || itemsOf(tenantId, id).length > 0) return { kind: 'written', value: false };
      groupRows.splice(groupRows.indexOf(group), 1);
      return { kind: 'written', value: true };
    },
  };
  const events: ChangeProposalEventRepository = {
    listByProposal: async (tenantId, proposalId) =>
      eventRows.filter((event) => event.tenantId === tenantId && event.proposalId === proposalId).sort((left, right) => left.sequence - right.sequence),
  };
  return {
    repository, events, groups, proposals, eventRows, groupRows, keys, imageRows,
    releasedImageRows: [], unresolvedImageDeletes: new Map(), imageUploads: [], imagePublications: [],
    seed: (proposal) => { proposals.push({ ...proposal }); },
  };
};

export const fakeContentHash = {
  sha256: (content: string | Uint8Array): string => sha256HexOfBytes(typeof content === 'string' ? new TextEncoder().encode(content) : content),
};

export interface FakeQuarantinedImages {
  repository: QuarantinedImageRepository;
  releases: QuarantinedImageRelease[];
}

export const createQuarantinedImagesFake = (
  state: FakeCatalogState,
  store: Pick<FakeChangeProposalStore, 'imageRows' | 'releasedImageRows' | 'unresolvedImageDeletes' | 'imageUploads' | 'imagePublications' | 'proposals' | 'keys'>,
  limits: { assetsPerKey: number; bytesPerKey: number; uploadsPerKey?: number } = QUARANTINED_IMAGE_LIMITS,
): FakeQuarantinedImages => {
  const rows = store.imageRows;
  const released = store.releasedImageRows;
  const releases: QuarantinedImageRelease[] = [];
  const unresolved = store.unresolvedImageDeletes;
  const graceEnd = (now: string): string => new Date(Date.parse(now) - QUARANTINED_IMAGE_LIMITS.unresolvedDeleteGraceMs).toISOString();
  const deleteSettled = (row: QuarantinedImageAsset, now: string): boolean => (unresolved.get(row) ?? '') < graceEnd(now);
  const keyActive = (row: QuarantinedImageAsset): boolean =>
    store.keys.some((key) => key.tenantId === row.tenantId && key.id === row.apiKeyId && key.revokedAt === null);
  const sweepable = (row: QuarantinedImageAsset, createdBefore: string): boolean => row.createdAt < createdBefore || !keyActive(row);
  const referenced = (row: QuarantinedImageAsset, now: string): boolean => store.proposals.some((proposal) =>
    proposal.tenantId === row.tenantId && proposal.proposedByKeyId === row.apiKeyId && proposal.status === 'pending' && proposal.expiresAt > now
    && changeProposalImageReferences(proposal.operation, proposal.input).some((image) => sameImageRow(row, row.tenantId, row.apiKeyId, image)));
  const ofKey = (selection: Extract<QuarantinedImageRelease, { kind: 'key' }>, tenantId: string) => (row: QuarantinedImageAsset): boolean =>
    row.tenantId === tenantId && row.apiKeyId === selection.apiKeyId
    && (selection.images === undefined || selection.images.some((image) => sameImageRow(row, tenantId, selection.apiKeyId, image)));
  const byAge = (left: QuarantinedImageAsset, right: QuarantinedImageAsset): number =>
    left.createdAt.localeCompare(right.createdAt) || left.apiKeyId.localeCompare(right.apiKeyId) || left.digest.localeCompare(right.digest);
  const repository: QuarantinedImageRepository = {
    inLiveUse: async (tenantId, path) => imageInLiveUse(state, tenantId, path),
    insert: async (tenantId, asset, object) => {
      if (released.some((row) => sameImageRow(row, tenantId, asset.apiKeyId, asset) && unresolved.has(row))) return { kind: 'busy' };
      const existing = rows.find((row) => sameImageRow(row, tenantId, asset.apiKeyId, asset));
      if (existing !== undefined) {
        const present = await object.present({ ...existing });
        if (!present.ok) return { kind: 'store_failed', error: present.error };
        const stored = present.value ? ok(undefined) : await object.store();
        return stored.ok ? { kind: 'existing', asset: { ...existing } } : { kind: 'store_failed', error: stored.error };
      }
      const keyRows = [...rows, ...released]
        .filter((row) => row.tenantId === tenantId && row.apiKeyId === asset.apiKeyId && !sameImageRow(row, tenantId, asset.apiKeyId, asset));
      if (keyRows.length >= limits.assetsPerKey) return { kind: 'cap_exceeded', cap: 'key_quarantined_images' };
      if (keyRows.reduce((total, row) => total + row.sizeBytes, 0) + asset.sizeBytes > limits.bytesPerKey) {
        return { kind: 'cap_exceeded', cap: 'key_quarantined_bytes' };
      }
      const revived = released.find((row) => sameImageRow(row, tenantId, asset.apiKeyId, asset));
      if (revived !== undefined) released.splice(released.indexOf(revived), 1);
      const row = { ...asset };
      rows.push(row);
      const stored = await object.store();
      if (!stored.ok) {
        rows.splice(rows.indexOf(row), 1);
        if (revived !== undefined) released.push(revived);
        return { kind: 'store_failed', error: stored.error };
      }
      return { kind: 'stored', asset: { ...asset } };
    },
    find: async (tenantId, apiKeyId, image) => {
      const found = rows.find((row) => sameImageRow(row, tenantId, apiKeyId, image));
      return found === undefined ? null : { ...found };
    },
    release: async (tenantId, selection, now) => {
      releases.push(selection);
      const earlier = released.filter(selection.kind === 'sweep' ? (row) => row.tenantId === tenantId && deleteSettled(row, now) : ofKey(selection, tenantId));
      const fresh = rows.filter(selection.kind === 'sweep'
        ? (row) => row.tenantId === tenantId && sweepable(row, selection.createdBefore) && !referenced(row, now)
        : ofKey(selection, tenantId));
      const candidates = [...earlier, ...fresh].sort(byAge);
      const selected = selection.kind === 'sweep' ? candidates.slice(0, selection.limit) : candidates;
      const answered: QuarantinedImageAsset[] = [];
      for (const row of selected) {
        if (earlier.includes(row)) answered.push({ ...row });
        else if (!referenced(row, now)) {
          rows.splice(rows.indexOf(row), 1);
          released.push(row);
          answered.push({ ...row });
        }
      }
      return { kind: 'written', value: answered };
    },
    finishRelease: async (tenantId, asset, removeObject, now) => {
      const row = released.find((candidate) => sameImageRow(candidate, tenantId, asset.apiKeyId, asset));
      if (row === undefined) return rows.some((candidate) => sameImageRow(candidate, tenantId, asset.apiKeyId, asset)) ? 'revived' : 'gone';
      if (!deleteSettled(row, now)) return 'busy';
      const removal = await removeObject();
      if (removal === 'unresolved') unresolved.set(row, now);
      if (removal !== 'deleted') return 'failed';
      released.splice(released.indexOf(row), 1);
      unresolved.delete(row);
      return 'removed';
    },
    listTenantIdsToSweep: async (createdBefore, now, limit) => [...new Set([
      ...released.filter((row) => deleteSettled(row, now)).map((row) => row.tenantId),
      ...rows.filter((row) => sweepable(row, createdBefore) && !referenced(row, now)).map((row) => row.tenantId),
    ])].sort().slice(0, limit),
    recordUpload: async (tenantId, upload, countedAfter) => {
      const recent = store.imageUploads.filter((row) => row.tenantId === tenantId && row.apiKeyId === upload.apiKeyId && row.createdAt > countedAfter);
      if (recent.length >= (limits.uploadsPerKey ?? QUARANTINED_IMAGE_LIMITS.uploadsPerKey)) return { kind: 'cap_exceeded', cap: 'key_image_uploads' };
      store.imageUploads.push({ tenantId, ...upload });
      return { kind: 'recorded' };
    },
    findUpload: async (tenantId, objectKey) => {
      const found = store.imageUploads.find((row) => row.tenantId === tenantId && row.objectKey === objectKey);
      return found === undefined ? null : { apiKeyId: found.apiKeyId, objectKey: found.objectKey, createdAt: found.createdAt, completed: found.completed ?? null };
    },
    markUploadCompleted: async (tenantId, objectKey, completed) => {
      for (const row of store.imageUploads) {
        if (row.tenantId === tenantId && row.objectKey === objectKey) row.completed = { ...completed };
      }
    },
    listTenantIdsWithUploadsBefore: async (createdBefore, deletedBefore, limit) =>
      [...new Set(store.imageUploads.filter(uploadDue(createdBefore, deletedBefore)).map((row) => row.tenantId))].sort().slice(0, limit),
    listUploadsBefore: async (tenantId, createdBefore, deletedBefore, limit) => store.imageUploads
      .filter((row) => row.tenantId === tenantId && uploadDue(createdBefore, deletedBefore)(row))
      .slice(0, limit)
      .map(({ apiKeyId, objectKey, createdAt, firstDeletedAt }) => ({ apiKeyId, objectKey, createdAt, deletedOnce: firstDeletedAt !== undefined })),
    markUploadDeleted: async (tenantId, objectKey, now) => {
      for (const row of store.imageUploads) {
        if (row.tenantId === tenantId && row.objectKey === objectKey) row.firstDeletedAt = now;
      }
    },
    deleteUpload: async (tenantId, objectKey) => {
      removeWhere(store.imageUploads, (row) => row.tenantId === tenantId && row.objectKey === objectKey);
    },
    markUploadAttempted: async () => undefined,
    publicationPending: async (tenantId, image) => store.imagePublications.some((row) => row.tenantId === tenantId && sameProposalImage(row.image, image)),
    recordPublications: async (tenantId, attemptId, images, startedAt) => {
      for (const image of images) {
        if (!store.imagePublications.some((row) => samePublication(row, tenantId, attemptId, image))) {
          store.imagePublications.push({ tenantId, attemptId, image: { ...image }, startedAt });
        }
      }
    },
    listTenantIdsWithPublicationsBefore: async (startedBefore, limit) =>
      [...new Set(store.imagePublications.filter((row) => (row.deleteUnresolvedAt ?? row.startedAt) < startedBefore).map((row) => row.tenantId))].sort().slice(0, limit),
    listPublicationsBefore: async (tenantId, startedBefore, limit) => store.imagePublications
      .filter((row) => row.tenantId === tenantId && (row.deleteUnresolvedAt ?? row.startedAt) < startedBefore)
      .slice(0, limit)
      .map(({ attemptId, image, startedAt }) => ({ attemptId, image: { ...image }, startedAt })),
    markPublicationAttempted: async () => undefined,
  };
  return { repository, releases };
};

export interface FakeProposalAccount {
  userId: string;
  email: string;
  emailVerified?: boolean;
  ownerOf?: string[];
  adminOf?: string[];
}

const fakeStaffRole = (account: FakeProposalAccount, tenantId: string): StaffRole | null => {
  if ((account.ownerOf ?? []).includes(tenantId)) return 'owner';
  return (account.adminOf ?? []).includes(tenantId) ? 'admin' : null;
};

export interface FakeChangeProposalPeople extends ChangeProposalPeopleReader {
  reads: Array<readonly string[]>;
}

const createChangeProposalPeopleFake = (accounts: readonly FakeProposalAccount[]): FakeChangeProposalPeople => {
  const reads: Array<readonly string[]> = [];
  return {
    reads,
    read: async (tenantId, userIds) => {
      reads.push([...userIds]);
      return accounts.filter((account) => userIds.includes(account.userId)).map((account) => ({
        userId: account.userId,
        email: account.email,
        emailVerified: account.emailVerified ?? true,
        staffRole: fakeStaffRole(account, tenantId),
      }));
    },
  };
};

const priceTermsOf = (price: ProductPrice): ChangeProposalTargetPrice => ({
  kind: price.kind, interval: price.interval, intervalCount: price.intervalCount ?? 1, amountCents: price.amountCents, currency: price.currency,
});

type FakeTargetLabel = Awaited<ReturnType<ChangeProposalTargetLabelReader['labels']>>[number];

export const changeProposalOwnerViewFakes = (
  state: FakeCatalogState,
  accounts: readonly FakeProposalAccount[] = [],
): Pick<ChangeProposalOwnerViewDeps, 'changeProposalTargetLabels'> & {
  changeProposalPeople: FakeChangeProposalPeople;
  keyDownloadFiles: Pick<KeyDownloadFileRepository, 'proposable' | 'release' | 'listProposed' | 'findStaged' | 'finishDeletion'>;
} => ({
  ...noProposedFiles(),
  changeProposalTargetLabels: {
    labels: async (tenantId, targets) => targets.flatMap((target): FakeTargetLabel[] => {
      const titleOf = (productId: string) => state.products.find((candidate) => candidate.tenantId === tenantId && candidate.id === productId)?.title;
      if (target.kind === 'price') {
        const price = state.prices.find((candidate) => candidate.tenantId === tenantId && candidate.id === target.id);
        const label = price === undefined ? undefined : titleOf(price.productId);
        return price === undefined || label === undefined ? [] : [{ ...target, label, price: priceTermsOf(price) }];
      }
      const label = target.kind === 'product'
        ? titleOf(target.id)
        : state.salesLinks.find((link) => link.tenantId === tenantId && link.id === target.id && !link.deleted)?.title;
      return label === undefined ? [] : [{ ...target, label, price: null }];
    }),
    accessTitles: async (tenantId, ids) => ({
      courses: state.courses.filter((row) => row.tenantId === tenantId && ids.courseIds.includes(row.id))
        .map((row) => ({ id: row.id, title: row.name, archived: Boolean(row.archivedAt) })),
      modules: state.modules.filter((row) => row.tenantId === tenantId && ids.moduleIds.includes(row.id)).map((row) => ({ id: row.id, title: row.name })),
      lessons: state.lessons.filter((row) => row.tenantId === tenantId && ids.lessonIds.includes(row.id)).map((row) => ({ id: row.id, title: row.name })),
    }),
  },
  changeProposalPeople: createChangeProposalPeopleFake(accounts),
});

const FAKE_NOTIFICATION_DEADLINE_MS = 1_000;

export interface FakeUnreadNotifications {
  changeProposalOwnerNotifier: ChangeProposalOwnerNotifier;
  realtimeBus: { publish(event: RealtimeEvent): void };
  rows: Notification[];
  published: RealtimeEvent[];
}

export const createUnreadNotificationsFake = (accounts: readonly FakeProposalAccount[] = []): FakeUnreadNotifications => {
  const rows: Notification[] = [];
  const published: RealtimeEvent[] = [];
  const ownerNotice = (tenantId: string, notification: Notification, notice: ChangeProposalOwnerNotice): Notification => {
    const existing = rows.find((row) => row.tenantId === tenantId && row.recipientUserId === notification.recipientUserId
      && row.sourceKey === notification.sourceKey);
    if (existing === undefined) {
      rows.push({ ...notification, tenantId });
      return { ...notification, tenantId };
    }
    if (existing.readAt === null || notice === 'signal') return { ...existing };
    Object.assign(existing, { id: notification.id, kind: notification.kind, payload: notification.payload, readAt: null, createdAt: notification.createdAt });
    return { ...existing };
  };
  return {
    rows,
    published,
    realtimeBus: { publish: (event) => { published.push(event); } },
    changeProposalOwnerNotifier: {
      deadlineMs: FAKE_NOTIFICATION_DEADLINE_MS,
      raiseForOwners: async (tenantId, build, notice) => ({
        kind: 'written',
        value: accounts
          .filter((account) => fakeStaffRole(account, tenantId) === 'owner')
          .map((account) => ownerNotice(tenantId, build(account.userId), notice)),
      }),
    },
  };
};

const withSalesLinkSaveError = (scope: ChangeProposalTransactionScope, error: AppError): ChangeProposalTransactionScope => ({
  ...scope,
  repositories: { ...scope.repositories, salesLinks: { ...scope.repositories.salesLinks, save: async () => err(error) } },
  savepoint: (operation) => scope.savepoint((nested) => operation(withSalesLinkSaveError(nested, error))),
});

export const failingSalesLinkSaves = (transaction: ChangeProposalTransaction, error: AppError): ChangeProposalTransaction => ({
  ...transaction,
  run: (tenantId, operation) => transaction.run(tenantId, (scope) => operation(withSalesLinkSaveError(scope, error))),
  dryRun: (tenantId, operation, options) => transaction.dryRun(tenantId, (scope) => operation(withSalesLinkSaveError(scope, error)), options),
});

export interface FakeChangeProposalTransaction extends ChangeProposalTransaction {
  calls: Array<'run' | 'dryRun'>;
  dryRunGroups: Array<string | null>;
  locks: ChangeProposalTarget[];
  courseLocks: FakeCourseLock[];
  repositoryCourseLocks: FakeCourseLock[];
  deferredDropped: number;
}

const noSecrets: TenantSecretResolver = { resolve: async (_tenantId, key) => err(notFound(`No "${key}" secret in the change proposal fake`)) };

export const createChangeProposalTransactionFake = (
  state: FakeCatalogState,
  store: FakeTransactionStore,
  secretResolver: TenantSecretResolver = noSecrets,
): FakeChangeProposalTransaction => {
  const calls: Array<'run' | 'dryRun'> = [];
  const dryRunGroups: Array<string | null> = [];
  const locks: ChangeProposalTarget[] = [];
  const courseLocks: FakeCourseLock[] = [];
  const repositoryCourseLocks: FakeCourseLock[] = [];
  const dropped = (count: number) => { fake.deferredDropped += count; };
  const scopeOver = (target: FakeCatalogState, effects: Array<() => Promise<void>>): ChangeProposalTransactionScope => ({
    repositories: catalogRepositoriesOver(target, store, locks, courseLocks, repositoryCourseLocks),
    secretResolver,
    afterCommit: { defer: (effect) => { effects.push(effect); } },
    savepoint: async (operation) => {
      const nested: Array<() => Promise<void>> = [];
      const working = structuredClone(target);
      const result = await operation(scopeOver(working, nested));
      if (result.ok) {
        Object.assign(target, working);
        effects.push(...nested);
      } else {
        dropped(nested.length);
      }
      return result;
    },
  });
  const fake: FakeChangeProposalTransaction = {
    calls,
    dryRunGroups,
    locks,
    courseLocks,
    repositoryCourseLocks,
    deferredDropped: 0,
    run: async (_tenantId, operation) => {
      calls.push('run');
      const effects: Array<() => Promise<void>> = [];
      const working = structuredClone(state);
      const publications = [...store.imagePublications];
      const rollBackPublications = () => { store.imagePublications.splice(0, store.imagePublications.length, ...publications); };
      const result = await operation(scopeOver(working, effects)).catch((cause: unknown) => {
        rollBackPublications();
        throw cause;
      });
      if (!result.ok) {
        rollBackPublications();
        dropped(effects.length);
        return result;
      }
      Object.assign(state, working);
      for (const effect of effects) await effect();
      return result;
    },
    dryRun: async (_tenantId, operation, options = {}) => {
      calls.push('dryRun');
      dryRunGroups.push(options.groupId ?? null);
      const effects: Array<() => Promise<void>> = [];
      const result = await operation(scopeOver(structuredClone(state), effects));
      dropped(effects.length);
      return result;
    },
  };
  return fake;
};
