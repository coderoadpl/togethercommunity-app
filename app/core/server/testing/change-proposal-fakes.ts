import {
  appError,
  CHANGE_PROPOSAL_EVENT_KIND_BY_STATUS,
  CHANGE_PROPOSAL_GROUP_LIMITS,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalEffectWithinLimit,
  changeProposalGroupOpen,
  err,
  notFound,
  ok,
  validation,
  type ChangeProposal,
  type ChangeProposalCountCap,
  type ChangeProposalEvent,
  type ChangeProposalEventKind,
  type ChangeProposalGroup,
  type ChangeProposalTarget,
  type Product,
  type ProductDownloadAsset,
  type ProductPrice,
  type SalesLink,
  type ShopManagementKey,
  type StockLevel,
  type TenantSettings,
} from '#core/domain/index.js';

import type {
  ChangeProposalEventDraft,
  ChangeProposalEventRepository,
  ChangeProposalGroupRepository,
  ChangeProposalGroupWithItems,
  ChangeProposalListQuery,
  ChangeProposalPage,
  ChangeProposalRepositories,
  ChangeProposalRepository,
  ChangeProposalTransaction,
  ChangeProposalTransactionScope,
  ChangeProposalTransitionGuard,
  SalesLinkRepository,
  TenantSecretResolver,
} from '../ports.js';
import type { StockRepository } from '../stock-ports.js';

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

const catalogRepositoriesOver = (
  state: FakeCatalogState,
  store: Pick<FakeChangeProposalStore, 'repository' | 'events' | 'groups'>,
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
      findByIds: async (tenantId, ids) =>
        state.products.filter((candidate) => candidate.tenantId === tenantId && ids.includes(candidate.id)).map((found) => ({ ...found })),
      create: async (tenantId, created) => {
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
    },
  };
};

export interface FakeChangeProposalStore {
  repository: ChangeProposalRepository;
  events: ChangeProposalEventRepository;
  groups: ChangeProposalGroupRepository;
  proposals: ChangeProposal[];
  eventRows: ChangeProposalEvent[];
  groupRows: ChangeProposalGroup[];
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
    if (query.groupId !== undefined && proposal.groupId !== query.groupId) return false;
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
    create: async (tenantId, proposal, event, now) => {
      if (!changeProposalEffectWithinLimit(proposal.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
      if (!keyActive(tenantId, proposal.proposedByKeyId, now)) return { kind: 'key_inactive' };
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
      return found === null ? null : transitionRow(found, transition);
    },
    recordExpiry: async (tenantId, id, event) => recordExpiry(tenantId, id, event),
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
    addItem: async (tenantId, proposal, event, now) => {
      if (!changeProposalEffectWithinLimit(proposal.effect)) return { kind: 'cap_exceeded', cap: 'effect_size' };
      if (!keyActive(tenantId, proposal.proposedByKeyId, now)) return { kind: 'key_inactive' };
      const current = withItems(groupNamed(tenantId, proposal.groupId ?? '', proposal.proposedByKeyId));
      if (current === null) return { kind: 'not_found' };
      if (!changeProposalGroupOpen(current.group, current.items, now)) return { kind: 'group_closed', current };
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
      return recorded;
    },
    deleteEmpty: async (tenantId, keyId, id) => {
      const group = groupNamed(tenantId, id, keyId);
      if (group === undefined || itemsOf(tenantId, id).length > 0) return false;
      groupRows.splice(groupRows.indexOf(group), 1);
      return true;
    },
  };
  const events: ChangeProposalEventRepository = {
    listByProposal: async (tenantId, proposalId) =>
      eventRows.filter((event) => event.tenantId === tenantId && event.proposalId === proposalId).sort((left, right) => left.sequence - right.sequence),
  };
  return { repository, events, groups, proposals, eventRows, groupRows, keys, seed: (proposal) => { proposals.push({ ...proposal }); } };
};

export interface FakeChangeProposalTransaction extends ChangeProposalTransaction {
  calls: Array<'run' | 'dryRun'>;
  locks: ChangeProposalTarget[];
  deferredDropped: number;
}

const noSecrets: TenantSecretResolver = { resolve: async (_tenantId, key) => err(notFound(`No "${key}" secret in the change proposal fake`)) };

export const createChangeProposalTransactionFake = (
  state: FakeCatalogState,
  store: Pick<FakeChangeProposalStore, 'repository' | 'events' | 'groups'>,
  secretResolver: TenantSecretResolver = noSecrets,
): FakeChangeProposalTransaction => {
  const calls: Array<'run' | 'dryRun'> = [];
  const locks: ChangeProposalTarget[] = [];
  const dropped = (count: number) => { fake.deferredDropped += count; };
  const scopeOver = (target: FakeCatalogState, effects: Array<() => Promise<void>>): ChangeProposalTransactionScope => ({
    repositories: catalogRepositoriesOver(target, store, locks),
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
    locks,
    deferredDropped: 0,
    run: async (_tenantId, operation) => {
      calls.push('run');
      const effects: Array<() => Promise<void>> = [];
      const working = structuredClone(state);
      const result = await operation(scopeOver(working, effects));
      if (!result.ok) {
        dropped(effects.length);
        return result;
      }
      Object.assign(state, working);
      for (const effect of effects) await effect();
      return result;
    },
    dryRun: async (_tenantId, operation) => {
      calls.push('dryRun');
      const effects: Array<() => Promise<void>> = [];
      const result = await operation(scopeOver(structuredClone(state), effects));
      dropped(effects.length);
      return result;
    },
  };
  return fake;
};
