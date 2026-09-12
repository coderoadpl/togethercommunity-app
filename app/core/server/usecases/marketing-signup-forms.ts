import {
  err, ok, notFound, validation, deriveConsentState, marketingSignupFormInputSchema, marketingSignupFormUpdateSchema,
  isMarketingSignupHoneypot, marketingSignupSubmissionSchema, type AppError, type Result, type MarketingSignupForm, type MarketingSignupFormCounters,
  type Language, type MarketingConsent,
} from '#core/domain/index.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { MarketingSignupDeps, MarketingSignupRepos } from '../marketing-signup-ports.js';

type FormDetail = { form: MarketingSignupForm; counters: MarketingSignupFormCounters };
const validateReferences = async (tenantId: string, form: MarketingSignupForm, repos: MarketingSignupRepos): Promise<Result<void, AppError>> => {
  const definition = await repos.definitions.findById(tenantId, form.consentDefinitionId);
  if (definition === null || definition.kind !== 'optional_marketing' || definition.status !== 'active') return err(validation('An active optional marketing consent definition is required'));
  if (form.listId !== null) {
    const list = await repos.lists.findById(tenantId, form.listId);
    if (list === null || list.kind !== 'static' || list.archivedAt !== null) return err(validation('An active static list is required'));
  }
  return ok(undefined);
};
export const listMarketingSignupForms = async (ctx: Ctx, deps: MarketingSignupDeps): Promise<Result<{ forms: FormDetail[] }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:read');
  if (!tenant.ok) return tenant;
  const forms = await deps.forms.list(tenant.value);
  return ok({ forms: await Promise.all(forms.map(async (form) => ({ form, counters: await deps.forms.counters(tenant.value, form.id, deps.clock.nowIso()) }))) });
};
export const getMarketingSignupForm = async (ctx: Ctx, input: { slug: string }, deps: MarketingSignupDeps): Promise<Result<FormDetail, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:read');
  if (!tenant.ok) return tenant;
  const form = await deps.forms.findBySlug(tenant.value, input.slug);
  return form === null ? err(notFound('Signup form was not found')) : ok({ form, counters: await deps.forms.counters(tenant.value, form.id, deps.clock.nowIso()) });
};
export const createMarketingSignupForm = async (ctx: Ctx, input: unknown, deps: MarketingSignupDeps): Promise<Result<{ form: MarketingSignupForm }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingSignupFormInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid signup form', parsed.error.flatten()));
  const now = deps.clock.nowIso();
  return deps.transaction.run(tenant.value, async (repos) => {
    const consentVersion = (await repos.definitions.listVersions(tenant.value, parsed.data.consentDefinitionId)).at(-1);
    if (consentVersion === undefined) return err(validation('Consent wording is unavailable'));
    const form: MarketingSignupForm = { ...parsed.data, consentVersion, id: deps.ids.nextId(), tenantId: tenant.value, token: deps.tokens.nextToken(), revision: 1, createdAt: now, updatedAt: now };
    const valid = await validateReferences(tenant.value, form, repos);
    if (!valid.ok) return valid;
    const saved = await repos.forms.save(tenant.value, form, null);
    return saved.ok ? ok({ form: saved.value }) : saved;
  });
};
export const updateMarketingSignupForm = async (ctx: Ctx, input: unknown, deps: MarketingSignupDeps): Promise<Result<{ form: MarketingSignupForm }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:list:write');
  if (!tenant.ok) return tenant;
  const parsed = marketingSignupFormUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid signup form update', parsed.error.flatten()));
  return deps.transaction.run(tenant.value, async (repos) => {
    const existing = await repos.forms.findBySlugForUpdate(tenant.value, parsed.data.slug);
    if (existing === null) return err(notFound('Signup form was not found'));
    const { expectedRevision, ...fields } = parsed.data;
    const consentVersion = (await repos.definitions.listVersions(tenant.value, fields.consentDefinitionId)).at(-1);
    if (consentVersion === undefined) return err(validation('Consent wording is unavailable'));
    const consentChanged = fields.consentDefinitionId !== existing.consentDefinitionId || consentVersion.id !== existing.consentVersion.id;
    const form = { ...existing, ...fields, consentVersion, token: consentChanged ? deps.tokens.nextToken() : existing.token, revision: expectedRevision + 1, updatedAt: deps.clock.nowIso() };
    const valid = await validateReferences(tenant.value, form, repos);
    if (!valid.ok && (form.status !== 'archived' || form.listId !== existing.listId || form.consentDefinitionId !== existing.consentDefinitionId)) return valid;
    const saved = await repos.forms.save(tenant.value, form, expectedRevision);
    return saved.ok ? ok({ form: saved.value }) : saved;
  });
};
export const submitMarketingSignupForm = async (tenantId: string, slug: string, input: unknown, evidence: {
  ipHash: string; userAgent: string; confirmationBaseUrl: string; language: Language;
}, deps: MarketingSignupDeps): Promise<Result<{ status: 'pending' | 'subscribed'; form: MarketingSignupForm }, AppError>> => {
  return deps.transaction.run(tenantId, async (repos) => {
    const form = await repos.forms.findBySlugForUpdate(tenantId, slug);
    if (form === null || form.status !== 'active') return err(notFound('Signup form was not found'));
    const valid = await validateReferences(tenantId, form, repos);
    if (!valid.ok) return valid;
    const definition = await repos.definitions.findById(tenantId, form.consentDefinitionId);
    const version = form.consentVersion;
    if (definition === null || version === undefined) return err(validation('Consent wording is unavailable'));
    const status = definition.doubleOptIn ? 'pending' : 'subscribed';
    if (isMarketingSignupHoneypot(input)) return ok({ status, form });
    const parsed = marketingSignupSubmissionSchema.safeParse(input);
    if (!parsed.success) return err(validation('Invalid signup submission'));
    if (deps.abuseCheck !== undefined) {
      const allowed = await deps.abuseCheck(tenantId, { formId: form.id, ipHash: evidence.ipHash });
      if (!allowed.ok) return allowed;
    }
    if (parsed.data.token !== form.token) return err(validation('Invalid form token'));
    await repos.contacts.lockAddress(tenantId, parsed.data.email);
    const now = deps.clock.nowIso();
    const source = `form:${form.slug}`;
    const { contact } = await repos.contacts.upsertByEmail(tenantId, {
      email: parsed.data.email, ...(form.collectName && parsed.data.displayName ? { displayName: parsed.data.displayName } : {}), source, tags: form.tags,
    });
    if (contact.source === 'erasure') return ok({ status, form });
    if (contact.archivedAt !== null) await repos.contacts.archive(tenantId, { contactId: contact.id, archivedAt: null });
    const previous = deriveConsentState(await repos.consents.listByEmail(tenantId, parsed.data.email, definition.id), definition);
    const alreadyConfirmed = previous.active && definition.doubleOptIn;
    const consent: MarketingConsent = {
      id: deps.ids.nextId(), tenantId, memberId: contact.memberId, email: parsed.data.email,
      definitionId: definition.id, definitionVersion: version.version, wordingSnapshot: version.label,
      documentRefSnapshot: version.documentVersionRef, status: alreadyConfirmed ? 'confirmed' : 'granted', previousId: previous.row?.id ?? null, source: 'signup_form',
      evidence: { collectedAt: now, proofRef: source, source, ipHash: evidence.ipHash, userAgent: evidence.userAgent || 'unknown', formId: form.id, formRevision: form.revision }, occurredAt: now,
    };
    await repos.consents.record(tenantId, consent);
    const suppression = await repos.suppressions.findActive(tenantId, deps.hmac.compute(tenantId, parsed.data.email));
    const lift = suppression !== null && (suppression.reason === 'manual' || suppression.reason === 'unsubscribe_global');
    if (lift && suppression !== null) {
      await repos.suppressions.lift(tenantId, { ...suppression, liftedAt: now, liftedBy: source });
      await repos.directoryEvents.append(tenantId, { id: deps.ids.nextId(), tenantId, subjectKind: 'contact', subjectId: contact.id, type: 'suppression_lifted', actor: source, importId: null, payload: { suppressionId: suppression.id, consentId: consent.id }, occurredAt: now, createdAt: now });
    }
    if (form.listId !== null) await repos.lists.addMembers(tenantId, { listId: form.listId, contactIds: [contact.id] });
    await repos.forms.recordSubmission(tenantId, { id: deps.ids.nextId(), formId: form.id, consentId: consent.id, doubleOptIn: definition.doubleOptIn && !alreadyConfirmed, occurredAt: now });
    if (definition.doubleOptIn && !alreadyConfirmed && (suppression === null || lift)) {
      const token = deps.tokens.nextToken();
      await repos.confirmations.create(tenantId, { id: deps.ids.nextId(), tenantId, token, marketingConsentRowId: consent.id, createdAt: now, expiresAt: new Date(Date.parse(now) + 86_400_000).toISOString(), usedAt: null });
      const queued = await repos.outbox.enqueue({ id: deps.ids.nextId(), tenantId, to: consent.email, now, payload: { kind: 'marketing-consent-confirmation', language: evidence.language, wording: consent.wordingSnapshot, confirmationUrl: `${evidence.confirmationBaseUrl}/${token}` } });
      if (!queued.ok) return queued;
    }
    return ok({ status, form });
  });
};
