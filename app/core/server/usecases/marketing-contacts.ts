import { err, ok, notFound, validation, marketingContactListQuerySchema, marketingContactUpsertSchema, marketingContactUpdateSchema, marketingContactPublicSchema, marketingCanonicalJson, type Result, type AppError, type MarketingContactPage, type MarketingContactPublic } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { MarketingContactDeps } from '../marketing-contact-ports.js';

export const listMarketingContacts = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<MarketingContactPage, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:contact:read');
  if (!tenant.ok) return tenant;
  const parsed = marketingContactListQuerySchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid contact query', parsed.error.flatten()));
  const { cursor, ...filters } = parsed.data;
  if (cursor !== undefined && !cursor.startsWith(`${deps.contentHash.sha256(marketingCanonicalJson(filters))}:`)) return err(validation('Cursor belongs to different filters'));
  if (parsed.data.listId !== undefined) {
    const list = await deps.lists.findById(tenant.value, parsed.data.listId);
    if (list === null || list.archivedAt !== null) return err(notFound('Active list was not found'));
  }
  if (parsed.data.consentDefinitionId !== undefined && await deps.definitions.findById(tenant.value, parsed.data.consentDefinitionId) === null) return err(notFound('Consent definition was not found'));
  return ok(await deps.contacts.listPage(tenant.value, parsed.data));
};
export const getMarketingContact = async (ctx: Ctx, input: { contactId: string }, deps: MarketingContactDeps): Promise<Result<{ contact: MarketingContactPublic; events: Awaited<ReturnType<MarketingContactDeps['directoryEvents']['list']>> }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:contact:read');
  if (!tenant.ok) return tenant;
  const contact = await deps.contacts.findById(tenant.value, input.contactId);
  return contact === null ? err(notFound('Contact was not found')) : ok({ contact: marketingContactPublicSchema.parse(contact), events: await deps.directoryEvents.list(tenant.value, 'contact', contact.id) });
};
export const upsertMarketingContact = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<{ contact: MarketingContactPublic; outcome: string }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:contact:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingContactUpsertSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid contact', parsed.error.flatten()));
  return deps.transaction.run(tenant.value, async (repos) => {
    await repos.contacts.lockAddress(tenant.value, parsed.data.email);
    const existing = await repos.contacts.findByEmail(tenant.value, parsed.data.email);
    if (new Set([...(existing?.tags ?? []), ...(parsed.data.tags ?? [])]).size > 50) return err(validation('Merged contact exceeds 50 tags'));
    const result = await repos.contacts.upsertByEmail(tenant.value, parsed.data);
    return ok({ contact: marketingContactPublicSchema.parse(result.contact), outcome: result.outcome });
  });
};
export const updateMarketingContact = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<{ contact: MarketingContactPublic }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:contact:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingContactUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid contact update', parsed.error.flatten()));
  const { contactId, ...fields } = parsed.data;
  const existing = await deps.contacts.findById(tenant.value, contactId);
  if (existing !== null && deps.hmac.compute(tenant.value, existing.email) !== existing.emailHmac) return err(validation('Erased contacts cannot be edited'));
  if (fields.source === '') return err(validation('Source cannot be empty'));
  const contact = await deps.contacts.update(tenant.value, contactId, fields);
  return contact === null ? err(notFound('Contact was not found')) : ok({ contact: marketingContactPublicSchema.parse(contact) });
};
export const archiveMarketingContact = async (ctx: Ctx, input: { contactId: string }, deps: MarketingContactDeps): Promise<Result<{ contact: MarketingContactPublic }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:contact:write');
  if (!tenant.ok) return tenant;
  const contact = await deps.contacts.archive(tenant.value, { ...input, archivedAt: deps.clock.nowIso() });
  return contact === null ? err(notFound('Contact was not found')) : ok({ contact: marketingContactPublicSchema.parse(contact) });
};
export const restoreMarketingContact = async (ctx: Ctx, input: { contactId: string }, deps: MarketingContactDeps): Promise<Result<{ contact: MarketingContactPublic }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:contact:write');
  if (!tenant.ok) return tenant;
  const existing = await deps.contacts.findById(tenant.value, input.contactId);
  if (existing !== null && deps.hmac.compute(tenant.value, existing.email) !== existing.emailHmac) return err(validation('Erased contacts cannot be restored'));
  const contact = await deps.contacts.archive(tenant.value, { ...input, archivedAt: null });
  return contact === null ? err(notFound('Contact was not found')) : ok({ contact: marketingContactPublicSchema.parse(contact) });
};
export const exportMarketingContacts = async (ctx: Ctx, input: unknown, deps: MarketingContactDeps): Promise<Result<MarketingContactPage, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:contact:read');
  if (!tenant.ok) return tenant;
  return listMarketingContacts(ctx, input, deps);
};
