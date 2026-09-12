import { describe, expect, it, vi } from 'vitest';

import { ok, type MarketingSignupForm, type Suppression, type MarketingContact } from '#core/domain/index.js';
import type { MarketingSignupDeps, MarketingSignupRepos, MarketingSignupFormRepository } from '../marketing-signup-ports.js';
import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { InMemoryConsentDefinitionRepository, InMemoryMarketingConsentRepository, InMemoryConsentConfirmationTokenRepository, InMemoryEmailOutboxRepository, InMemorySuppressionRepository } from '../testing/marketing-fakes.js';
import { createMarketingSignupForm, submitMarketingSignupForm, updateMarketingSignupForm } from './marketing-signup-forms.js';

const now = '2026-09-12T10:00:00.000Z';
const setup = async (doubleOptIn = false, reason?: Suppression['reason'], stored?: Partial<MarketingContact>) => {
  const directory = marketingContactDeps();
  const definitions = new InMemoryConsentDefinitionRepository();
  const consents = new InMemoryMarketingConsentRepository();
  const suppressions = new InMemorySuppressionRepository();
  const outbox = new InMemoryEmailOutboxRepository();
  const confirmations = new InMemoryConsentConfirmationTokenRepository();
  const contacts: MarketingContact[] = [];
  const savedForms: MarketingSignupForm[] = [];
  const submissions = vi.fn(async () => undefined);
  const forms: MarketingSignupFormRepository = {
    list: async (tenantId) => savedForms.filter((form) => form.tenantId === tenantId),
    findBySlug: async (tenantId, slug) => savedForms.find((form) => form.tenantId === tenantId && form.slug === slug) ?? null,
    findBySlugForUpdate: async (tenantId, slug) => savedForms.find((form) => form.tenantId === tenantId && form.slug === slug) ?? null,
    save: async (_, form) => { savedForms.splice(0, savedForms.length, form); return ok(form); },
    counters: async () => ({ submissionsTotal: 0, submissions24h: 0, submissions7d: 0, confirmed: 0, pending: 0, computedAt: now }), recordSubmission: submissions,
  };
  const addMembers = vi.fn(async () => ({ changed: 1 }));
  const events = vi.fn(async () => undefined);
  const repos: MarketingSignupRepos = { ...directory, forms, definitions, consents, suppressions, outbox, confirmations,
    contacts: { ...directory.contacts, lockAddress: async () => undefined, upsertByEmail: async (tenantId, input) => {
      const contact: MarketingContact = { id: 'contact', tenantId, email: input.email, emailHmac: input.email, displayName: input.displayName ?? null, firstName: null, lastName: null, source: input.source ?? 'form', tags: input.tags ?? [], memberId: null, createdAt: now, updatedAt: now, archivedAt: null, ...stored };
      contacts.push(contact); return { contact, outcome: stored === undefined ? 'created' : 'unchanged' };
    } },
    lists: { ...directory.lists, findById: async (tenantId, id) => id === 'list' ? { id, tenantId, key: 'newsletter', name: 'Newsletter', kind: 'static', rule: null, revision: 1, createdAt: now, updatedAt: now, archivedAt: null } : null, addMembers },
    directoryEvents: { ...directory.directoryEvents, append: events },
  };
  let sequence = 0;
  const deps: MarketingSignupDeps = { forms, transaction: { run: async (_, operation) => operation(repos) }, clock: { nowIso: () => now }, ids: { nextId: () => `id-${++sequence}` }, tokens: { nextToken: () => `token-${++sequence}`.padEnd(32, 'x') }, hmac: { compute: (_, email) => email } };
  await definitions.create('tenant-a', { id: 'newsletter', tenantId: 'tenant-a', key: 'newsletter', kind: 'optional_marketing', channel: 'email', doubleOptIn, documentRef: { mode: 'url', url: 'https://example.org/privacy' }, status: 'active', createdAt: now, updatedAt: now }, { id: 'v1', tenantId: 'tenant-a', definitionId: 'newsletter', version: 1, label: 'I agree to receive the newsletter.', documentVersionRef: { mode: 'url', url: 'https://example.org/privacy' }, createdAt: now, createdBy: 'owner' });
  if (reason !== undefined) await suppressions.record('tenant-a', { id: 'suppression', tenantId: 'tenant-a', email: 'reader@example.org', emailHmac: 'reader@example.org', reason, sourceRef: null, meta: null, createdAt: now, liftedAt: null, liftedBy: null });
  const input = { slug: 'newsletter', name: 'Newsletter', consentDefinitionId: 'newsletter', listId: 'list', tags: ['newsletter'], collectName: true, successText: { en: 'Thank you', pl: 'Thank you' } };
  const created = await createMarketingSignupForm(marketingContactCtx(), input, deps);
  if (!created.ok) throw new Error(created.error.message);
  const form = created.value.form;
  const submit = (extra = {}, tenantId = 'tenant-a') => submitMarketingSignupForm(tenantId, form.slug, { email: ' Reader@Example.org ', displayName: 'Reader', token: form.token, ...extra }, { ipHash: 'hashed-ip', userAgent: 'test-browser', language: 'en', confirmationBaseUrl: 'https://acme.example.org/marketing/confirm' }, deps);
  return { deps, repos, form, input, submit, contacts, consents, suppressions, outbox, submissions, addMembers, events };
};
describe('public signup consent workflow', () => {
  it.each([false, true])('records explicit evidence, tags and membership with double opt-in=%s', async (doubleOptIn) => {
    const fixture = await setup(doubleOptIn);
    expect(await fixture.submit()).toMatchObject({ ok: true, value: { status: doubleOptIn ? 'pending' : 'subscribed' } });
    expect(fixture.contacts[0]).toMatchObject({ email: 'reader@example.org', displayName: 'Reader', source: 'form:newsletter', tags: ['newsletter'] });
    expect(fixture.consents.snapshot()[0]).toMatchObject({ status: 'granted', wordingSnapshot: 'I agree to receive the newsletter.', source: 'signup_form', occurredAt: now, evidence: { ipHash: 'hashed-ip', userAgent: 'test-browser', proofRef: 'form:newsletter' } });
    expect(fixture.addMembers).toHaveBeenCalledWith('tenant-a', { listId: 'list', contactIds: ['contact'] });
    expect(fixture.outbox.items).toHaveLength(doubleOptIn ? 1 : 0);
    if (doubleOptIn) expect(fixture.outbox.items[0]?.payload).toMatchObject({ kind: 'marketing-consent-confirmation', wording: 'I agree to receive the newsletter.', language: 'en' });
  });
  it.each(['hard_bounce', 'complaint', 'erasure', 'unsubscribe_global', 'manual'] as const)('handles %s suppression without discarding consent evidence', async (reason) => {
    const fixture = await setup(true, reason);
    expect(await fixture.submit()).toMatchObject({ ok: true, value: { status: 'pending' } });
    const lifted = ['unsubscribe_global', 'manual'].includes(reason);
    expect(await fixture.suppressions.isSuppressed('tenant-a', 'reader@example.org')).toBe(!lifted);
    expect(fixture.consents.snapshot()).toHaveLength(1);
    expect(fixture.outbox.items).toHaveLength(lifted ? 1 : 0);
    expect(fixture.events).toHaveBeenCalledTimes(lifted ? 1 : 0);
  });
  it('keeps a confirmed double opt-in subscriber confirmed when the address is submitted again', async () => {
    const fixture = await setup(true);
    await fixture.submit();
    const [granted] = fixture.consents.snapshot();
    if (granted === undefined) throw new Error('Missing granted consent');
    await fixture.consents.record('tenant-a', { ...granted, id: 'confirmed-consent', status: 'confirmed', previousId: granted.id, occurredAt: '2026-09-12T10:05:00.000Z' });
    expect(await fixture.submit()).toMatchObject({ ok: true, value: { status: 'pending' } });
    const rows = fixture.consents.snapshot();
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ status: 'confirmed', previousId: 'confirmed-consent', source: 'signup_form' });
    expect(fixture.outbox.items).toHaveLength(1);
  });
  it('does not restore an erased contact from an anonymous submission', async () => {
    const fixture = await setup(false, undefined, { source: 'erasure', email: 'erased+deleted@example.invalid', archivedAt: now });
    expect(await fixture.submit()).toMatchObject({ ok: true, value: { status: 'subscribed' } });
    expect(fixture.consents.snapshot()).toHaveLength(0);
    expect(fixture.addMembers).not.toHaveBeenCalled();
    expect(fixture.submissions).not.toHaveBeenCalled();
  });
  it('silently discards honeypots and rejects stale tokens and foreign tenants', async () => {
    const fixture = await setup();
    expect(await fixture.submit({ website: 'bot.example' })).toMatchObject({ ok: true });
    expect(fixture.contacts).toHaveLength(0);
    expect(fixture.submissions).not.toHaveBeenCalled();
    expect(await fixture.submit({ token: 'wrong'.repeat(8) })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await fixture.submit({}, 'tenant-b')).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
  it('keeps wording from the displayed form revision and rotates the token when the consent wording changes', async () => {
    const fixture = await setup();
    await fixture.repos.definitions.appendVersion('tenant-a', { ...fixture.form.consentVersion, id: 'v2', version: 2, label: 'Updated wording' });
    await fixture.submit();
    expect(fixture.consents.snapshot()[0]?.wordingSnapshot).toBe(fixture.form.consentVersion.label);
    const updated = await updateMarketingSignupForm(marketingContactCtx(), { ...fixture.input, expectedRevision: 1 }, fixture.deps);
    expect(updated).toMatchObject({ ok: true, value: { form: { consentVersion: { version: 2 } } } });
    expect(await fixture.submit()).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('keeps deployed embeds working when an edit leaves the consent wording untouched', async () => {
    const fixture = await setup();
    const renamed = await updateMarketingSignupForm(marketingContactCtx(), { ...fixture.input, name: 'Renamed newsletter', expectedRevision: 1 }, fixture.deps);
    expect(renamed).toMatchObject({ ok: true, value: { form: { token: fixture.form.token } } });
    expect(await fixture.submit()).toMatchObject({ ok: true });
  });
  it('requires staff authorization and tenant-owned references', async () => {
    const fixture = await setup();
    expect(await createMarketingSignupForm({ ...marketingContactCtx(), capabilities: [] }, fixture.input, fixture.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await createMarketingSignupForm(marketingContactCtx(), { ...fixture.input, listId: 'foreign' }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await updateMarketingSignupForm(marketingContactCtx(), { ...fixture.input, listId: 'foreign', status: 'archived', expectedRevision: 1 }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
