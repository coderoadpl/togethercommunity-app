import {
  appError,
  CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalEffectWithinLimit,
  err,
  notFound,
  ok,
  validation,
  type ChangeProposal,
  type ChangeProposalEvent,
  type ChangeProposalEventKind,
  type Product,
  type ProductDownloadAsset,
  type ProductPrice,
  type ShopManagementKey,
  type StockLevel,
} from '#core/domain/index.js';

import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalListQuery,
  ChangeProposalPage,
  ChangeProposalRepositories,
  ChangeProposalRepository,
  ChangeProposalTarget,
  ChangeProposalTransaction,
  ChangeProposalTransactionScope,
  ChangeProposalTransitionGuard,
} from '../ports.js';
import type { StockRepository } from '../stock-ports.js';

export interface FakeCatalogState {
  products: Product[];
  everPublished: string[];
  prices: ProductPrice[];
  stock: Array<StockLevel & { tenantId: string }>;
  stockEvents: number;
  entityVersions: number;
  contentVersionBumps: number;
  downloadAssets: ProductDownloadAsset[];
}

export const emptyCatalogState = (): FakeCatalogState => ({
  products: [],
  everPublished: [],
  prices: [],
  stock: [],
  stockEvents: 0,
  entityVersions: 0,
  contentVersionBumps: 0,
  downloadAssets: [],
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
    commit: unavailable('stock.commit'),
    markLowStockNotified: unavailable('stock.markLowStockNotified'),
    releaseExpired: unavailable('stock.releaseExpired'),
  };
};

const catalogRepositoriesOver = (
  state: FakeCatalogState,
  proposals: ChangeProposalRepository,
  events: ChangeProposalEventRepository,
  locks: ChangeProposalTarget[],
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
      create: async (tenantId, created) => {
        if (state.products.some((candidate) => candidate.tenantId === tenantId && candidate.slug === created.slug)) return 'slug_taken';
        state.products.push({ ...created });
        return 'created';
      },
      update: async (tenantId, updated) => {
        const index = state.products.findIndex((candidate) => candidate.tenantId === tenantId && candidate.id === updated.id);
        const current = state.products[index];
        if (current === undefined) return null;
        const saved = { ...current, ...updated };
        state.products[index] = saved;
        state.entityVersions += 1;
        return { ...saved };
      },
      updateAccessItems: unavailable('products.updateAccessItems'),
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
    tenants: { findSettings: async () => null },
    downloadAssets: {
      listReadyByProduct: async (tenantId, productId) =>
        state.downloadAssets.filter((asset) => asset.tenantId === tenantId && asset.productId === productId && asset.status === 'ready'),
    },
    spaces: { list: async () => [] },
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
    changeProposals: proposals,
    changeProposalEvents: events,
    targets: {
      lock: async (tenantId, target) => {
        locks.push(target);
        if (target.id === null) return target.kind !== 'price';
        if (target.kind === 'price') return state.prices.some((price) => price.tenantId === tenantId && price.id === target.id);
        return product(tenantId, target.id) !== null;
      },
    },
  };
};

export interface FakeChangeProposalStore {
  repository: ChangeProposalRepository;
  events: ChangeProposalEventRepository;
  proposals: ChangeProposal[];
  eventRows: ChangeProposalEvent[];
  keys: ShopManagementKey[];
  seed(proposal: ChangeProposal): void;
}

const byNewestFirst = (left: ChangeProposal, right: ChangeProposal): number =>
  right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);

export const createChangeProposalStoreFake = (keys: ShopManagementKey[] = []): FakeChangeProposalStore => {
  const proposals: ChangeProposal[] = [];
  const eventRows: ChangeProposalEvent[] = [];
  const pendingAt = (proposal: ChangeProposal, now: string) => proposal.status === 'pending' && proposal.expiresAt > now;
  const matchesStatus = (proposal: ChangeProposal, query: ChangeProposalListQuery): boolean => {
    if (query.status === undefined) return true;
    if (query.status === 'pending') return pendingAt(proposal, query.now);
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
  const repository: ChangeProposalRepository = {
    create: async (tenantId, proposal, event, now) => {
      if (!changeProposalEffectWithinLimit(proposal.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
      const key = keys.find((candidate) => candidate.tenantId === tenantId && candidate.id === proposal.proposedByKeyId);
      if (key === undefined || key.mode !== 'propose' || key.revokedAt !== null || key.expiresAt <= now) return { kind: 'key_inactive' };
      const workspace = proposals.filter((candidate) => candidate.tenantId === tenantId);
      const byKey = workspace.filter((candidate) => candidate.proposedByKeyId === proposal.proposedByKeyId);
      if (byKey.filter((candidate) => pendingAt(candidate, now)).length >= CHANGE_PROPOSAL_LIMITS.pendingPerKey) return { kind: 'cap_exceeded', cap: 'key_pending' };
      if (workspace.filter((candidate) => pendingAt(candidate, now)).length >= CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace) return { kind: 'cap_exceeded', cap: 'workspace_pending' };
      const windowStart = new Date(Date.parse(now) - CHANGE_PROPOSAL_LIMITS.creationWindowMs).toISOString();
      if (byKey.filter((candidate) => candidate.createdAt > windowStart).length >= CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow) return { kind: 'cap_exceeded', cap: 'key_daily' };
      proposals.push({ ...proposal });
      appendEvent(tenantId, proposal.id, 'proposed', event);
      return { kind: 'created', proposal: { ...proposal } };
    },
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
      if (found === null) return null;
      Object.assign(found, {
        status: transition.status,
        decidedByUserId: transition.decidedByUserId,
        decidedAt: transition.decidedAt,
        decisionNote: transition.decisionNote,
        appliedResourceId: transition.appliedResourceId,
        failureCode: transition.failureCode,
        failureMessage: transition.failureMessage,
      });
      appendEvent(tenantId, id, CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS[transition.status], transition.event);
      return { ...found };
    },
    recordExpiry: async (tenantId, id, event) => {
      const found = proposals.find((proposal) => proposal.tenantId === tenantId && proposal.id === id && proposal.status === 'pending' && proposal.expiresAt <= event.at);
      if (found === undefined) return false;
      if (eventRows.some((row) => row.tenantId === tenantId && row.proposalId === id && row.kind === 'expired')) return false;
      appendEvent(tenantId, id, 'expired', event);
      return true;
    },
  };
  const events: ChangeProposalEventRepository = {
    listByProposal: async (tenantId, proposalId) =>
      eventRows.filter((event) => event.tenantId === tenantId && event.proposalId === proposalId).sort((left, right) => left.sequence - right.sequence),
  };
  return { repository, events, proposals, eventRows, keys, seed: (proposal) => { proposals.push({ ...proposal }); } };
};

export interface FakeChangeProposalTransaction extends ChangeProposalTransaction {
  calls: Array<'run' | 'dryRun'>;
  locks: ChangeProposalTarget[];
  deferredDropped: number;
}

export const createChangeProposalTransactionFake = (
  state: FakeCatalogState,
  store: Pick<FakeChangeProposalStore, 'repository' | 'events'>,
): FakeChangeProposalTransaction => {
  const calls: Array<'run' | 'dryRun'> = [];
  const locks: ChangeProposalTarget[] = [];
  const scopeOver = (target: FakeCatalogState, effects: Array<() => Promise<void>>): ChangeProposalTransactionScope => ({
    repositories: catalogRepositoriesOver(target, store.repository, store.events, locks),
    afterCommit: { defer: (effect) => { effects.push(effect); } },
    savepoint: (operation) => operation(scopeOver(target, effects)),
  });
  const fake: FakeChangeProposalTransaction = {
    calls,
    locks,
    deferredDropped: 0,
    run: async (_tenantId, operation) => {
      calls.push('run');
      const effects: Array<() => Promise<void>> = [];
      const scope = scopeOver(state, effects);
      const result = await operation(scope);
      if (result.ok) for (const effect of effects) await effect();
      else fake.deferredDropped += effects.length;
      return result;
    },
    dryRun: async (_tenantId, operation) => {
      calls.push('dryRun');
      const effects: Array<() => Promise<void>> = [];
      const result = await operation(scopeOver(structuredClone(state), effects));
      fake.deferredDropped += effects.length;
      return result;
    },
  };
  return fake;
};
