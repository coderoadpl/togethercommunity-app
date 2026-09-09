import { err, ok, appError, notFound, validation, marketingListCreateSchema, marketingListUpdateSchema, marketingListQuerySchema, marketingListMembershipChangeSchema, marketingContactListQuerySchema, marketingCanonicalJson, type MarketingList, type MarketingListPage, type MarketingListCounts, type MarketingContactPage, type MarketingListMembershipResult, type AppError, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { MarketingContactDeps } from '../marketing-contact-ports.js';

export const createMarketingList = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<{ list: MarketingList }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingListCreateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid list', parsed.error.flatten()));
  if (parsed.data.rule !== null && !await deps.lists.validateRule(tenant.value, parsed.data.rule)) return err(validation('Rule references an unknown tenant resource'));
  const now = deps.clock.nowIso();
  const saved = await deps.lists.save(tenant.value, { expectedRevision: null, list: { id: deps.ids.nextId(), tenantId: tenant.value, ...parsed.data, kind: parsed.data.rule === null ? 'static' : 'dynamic', revision: 1, createdAt: now, updatedAt: now, archivedAt: null } });
  return saved.ok ? ok({ list: saved.value }) : saved;
};
export const updateMarketingList = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<{ list: MarketingList }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingListUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid list update', parsed.error.flatten()));
  const list = await deps.lists.findById(tenant.value, parsed.data.listId);
  if (list === null) return err(notFound('List was not found'));
  if (list.archivedAt !== null) return err(validation('Archived lists cannot be edited'));
  if (parsed.data.rule !== undefined && (list.kind === 'static' || !await deps.lists.validateRule(tenant.value, parsed.data.rule))) return err(validation('List kind is immutable and rule references must belong to this tenant'));
  const saved = await deps.lists.save(tenant.value, { expectedRevision: parsed.data.expectedRevision, list: { ...list, name: parsed.data.name ?? list.name, rule: parsed.data.rule ?? list.rule, revision: list.revision + 1, updatedAt: deps.clock.nowIso() } });
  return saved.ok ? ok({ list: saved.value }) : saved;
};
export const archiveMarketingList = async (ctx: Ctx, input: { listId: string; expectedRevision: number }, deps: MarketingContactDeps): Promise<Result<{ list: MarketingList }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:write');
  if (!tenant.ok) return tenant;
  const list = await deps.lists.findById(tenant.value, input.listId);
  if (list === null) return err(notFound('List was not found'));
  const saved = await deps.lists.save(tenant.value, { expectedRevision: input.expectedRevision, list: { ...list, revision: list.revision + 1, archivedAt: deps.clock.nowIso(), updatedAt: deps.clock.nowIso() } });
  return saved.ok ? ok({ list: saved.value }) : saved;
};
export const listMarketingLists = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<MarketingListPage, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:read');
  if (!tenant.ok) return tenant;
  const parsed = marketingListQuerySchema.safeParse(input);
  return parsed.success ? ok(await deps.lists.listPage(tenant.value, parsed.data)) : err(validation('Invalid list query', parsed.error.flatten()));
};
export const getMarketingList = async (ctx: Ctx, input: { listId: string; consentDefinitionId?: string | undefined }, deps: MarketingContactDeps): Promise<Result<{ list: MarketingList; counts: MarketingListCounts }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:read');
  if (!tenant.ok) return tenant;
  const list = await deps.lists.findById(tenant.value, input.listId) ?? await deps.lists.findByKey(tenant.value, input.listId);
  if (list === null) return err(notFound('List was not found'));
  if (input.consentDefinitionId !== undefined && await deps.definitions.findById(tenant.value, input.consentDefinitionId) === null) return err(notFound('Consent definition was not found'));
  return ok({ list, counts: await deps.lists.counts(tenant.value, list.id, input.consentDefinitionId ?? null, deps.clock.nowIso()) });
};
const changeMembers = async (tenantId: string, input: unknown, deps: MarketingContactDeps, remove: boolean): Promise<Result<MarketingListMembershipResult, AppError>> => {
  const parsed = marketingListMembershipChangeSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid membership change', parsed.error.flatten()));
  return deps.transaction.run(tenantId, async (repos) => {
    await repos.imports.lock(tenantId, `list:${parsed.data.listId}`);
    const list = await repos.lists.findById(tenantId, parsed.data.listId);
    if (list === null) return err(notFound('List was not found'));
    if (list.kind !== 'static' || list.archivedAt !== null) return err(validation('Membership changes require an active static list'));
    for (const id of parsed.data.contactIds) if (await repos.contacts.findById(tenantId, id) === null) return err(notFound('Contact was not found'));
    return ok(await (remove ? repos.lists.removeMembers(tenantId, parsed.data) : repos.lists.addMembers(tenantId, parsed.data)));
  });
};
export const addMarketingListContacts = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<MarketingListMembershipResult, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:write');
  return tenant.ok ? changeMembers(tenant.value, input, deps, false) : tenant;
};
export const removeMarketingListContacts = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<MarketingListMembershipResult, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:write');
  return tenant.ok ? changeMembers(tenant.value, input, deps, true) : tenant;
};
export const previewMarketingList = async (ctx: Ctx, input: { listId: string; consentDefinitionId?: string | undefined; cursor?: string | undefined; limit?: number | undefined }, deps: MarketingContactDeps): Promise<Result<{ list: MarketingList; counts: MarketingListCounts } & MarketingContactPage, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:read');
  if (!tenant.ok) return tenant;
  const read = authorizeRequiredTenant(ctx, 'marketing:contact:read');
  if (!read.ok) return read;
  const detail = await getMarketingList(ctx, input, deps);
  if (!detail.ok) return detail;
  if (detail.value.list.archivedAt !== null) return err(validation('List is archived'));
  if (input.limit !== undefined && (input.limit < 1 || input.limit > 100)) return err(validation('Limit must be between 1 and 100'));
  if (detail.value.list.rule?.kind !== 'tag' && detail.value.list.kind === 'dynamic' && await deps.memberSync.next(tenant.value, deps.clock.nowIso()) !== null) return err(appError('conflict', 'Directory synchronization in progress'));
  const query = marketingContactListQuerySchema.parse({ listId: detail.value.list.id, ...(input.consentDefinitionId === undefined ? {} : { consentDefinitionId: input.consentDefinitionId }), ...(input.cursor === undefined ? {} : { cursor: input.cursor }), limit: input.limit ?? 20 });
  const { cursor, ...filters } = query;
  if (cursor !== undefined && !cursor.startsWith(`${deps.contentHash.sha256(marketingCanonicalJson(filters))}:`)) return err(validation('Cursor belongs to different filters'));
  const page = await deps.contacts.listPage(tenant.value, query, detail.value.counts.computedAt);
  return ok({ ...detail.value, ...page });
};
