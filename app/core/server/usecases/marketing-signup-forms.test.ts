import { InMemoryMarketingSignupFormRepository } from '../testing/marketing-signup-fakes.js';
import { confirmMarketingConsent } from './marketing-email.js';
import { describe, expect, it, vi } from 'vitest';

import { type Suppression, type MarketingContact } from '#core/domain/index.js';
import type { MarketingSignupDeps, MarketingSignupRepos } from '../marketing-signup-ports.js';
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
  const forms = new InMemoryMarketingSignupFormRepository();
  const submissions = vi.spyOn(forms, 'recordSubmission');
  if (stored !== undefined) contacts.push({ id: 'contact', tenantId: 'tenant-a', email: 'reader@example.org', emailHmac: 'reader@example.org', displayName: 'Real Name', firstName: null, lastName: null, source: 'import', tags: ['existing'], memberId: null, createdAt: now, updatedAt: now, archivedAt: now, ...stored });
  const addMembers = vi.fn(async () => ({ changed: 1 }));
  const events = vi.fn(async () => undefined);
  const repos: MarketingSignupRepos = { ...directory, forms, definitions, consents, suppressions, outbox, confirmations,
    contacts: { ...directory.contacts, lockAddress: vi.fn(async () => undefined),
      findByEmail: vi.fn(async (tenantId, email) => contacts.find((contact) => contact.tenantId === tenantId && contact.emailHmac === email) ?? null),
      update: vi.fn(async (tenantId, contactId, input) => {
        const contact = contacts.find((row) => row.tenantId === tenantId && row.id === contactId);
        if (contact === undefined) return null;
        Object.assign(contact, input); return contact;
      }),
      archive: vi.fn(async (tenantId, input) => {
        const contact = contacts.find((row) => row.tenantId === tenantId && row.id === input.contactId);
        if (contact === undefined) return null;
        contact.archivedAt = input.archivedAt; return contact;
      }),
      upsertByEmail: vi.fn(async (tenantId, input) => {
        const contact: MarketingContact = { id: 'contact', tenantId, email: input.email, emailHmac: input.email, displayName: input.displayName ?? null, firstName: null, lastName: null, source: input.source ?? 'form', tags: input.tags ?? [], memberId: null, createdAt: now, updatedAt: now, archivedAt: null };
        contacts.push(contact); return { contact, outcome: 'created' as const };
      }),
    },
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
  return { deps, repos, form, input, submit, contacts, consents, suppressions, outbox, submissions, addMembers, events, confirmations };
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
  it.each(['hard_bounce', 'complaint', 'erasure', 'unsubscribe_global', 'manual'] as const)('silently preserves %s suppression without mutations', async (reason) => {
    const fixture = await setup(true, reason, {});
    const before = structuredClone(fixture.contacts);
    const lift = vi.spyOn(fixture.suppressions, 'lift');
    expect(await fixture.submit()).toMatchObject({ ok: true, value: { status: 'pending' } });
    expect(await fixture.suppressions.isSuppressed('tenant-a', 'reader@example.org')).toBe(true);
    expect(fixture.contacts).toEqual(before);
    expect(fixture.consents.snapshot()).toHaveLength(0);
    expect(fixture.outbox.items).toHaveLength(0);
    expect(fixture.events).not.toHaveBeenCalled();
    expect(fixture.submissions).not.toHaveBeenCalled();
    expect(fixture.addMembers).not.toHaveBeenCalled();
    expect(fixture.repos.contacts.upsertByEmail).not.toHaveBeenCalled();
    expect(fixture.repos.contacts.update).not.toHaveBeenCalled();
    expect(fixture.repos.contacts.archive).not.toHaveBeenCalled();
    expect(lift).not.toHaveBeenCalled();
  });
  it('preserves manual suppression and confirmed consent on single opt-in submission', async () => {
    const fixture = await setup(false, undefined, {});
    await fixture.submit();
    const granted = fixture.consents.snapshot()[0];
    if (granted === undefined) throw new Error('Missing consent');
    await fixture.consents.record('tenant-a', { ...granted, id: 'confirmed', status: 'confirmed', previousId: granted.id });
    await fixture.suppressions.record('tenant-a', { id: 'manual', tenantId: 'tenant-a', email: 'reader@example.org', emailHmac: 'reader@example.org', reason: 'manual', sourceRef: null, meta: null, createdAt: now, liftedAt: null, liftedBy: null });
    const before = structuredClone(fixture.contacts);
    const consents = fixture.consents.snapshot();
    expect(await fixture.submit({ displayName: 'Fake' })).toMatchObject({ ok: true, value: { status: 'subscribed' } });
    expect(fixture.contacts).toEqual(before);
    expect(fixture.consents.snapshot()).toEqual(consents);
    expect(fixture.outbox.items).toHaveLength(0);
    expect(await fixture.suppressions.isSuppressed('tenant-a', 'reader@example.org')).toBe(true);
  });
  it('never lifts a suppression whose reason changes to complaint after the read', async () => {
    const fixture = await setup(true, 'manual');
    const findActive = fixture.suppressions.findActive.bind(fixture.suppressions);
    vi.spyOn(fixture.suppressions, 'findActive').mockImplementation(async (tenantId, emailHmac) => {
      const row = await findActive(tenantId, emailHmac);
      if (row !== null) await fixture.suppressions.record(tenantId, { ...row, reason: 'complaint' });
      return row;
    });
    const lift = vi.spyOn(fixture.suppressions, 'lift');
    expect(await fixture.submit()).toMatchObject({ ok: true });
    expect(lift).not.toHaveBeenCalled();
    expect(await findActive('tenant-a', 'reader@example.org')).toMatchObject({ reason: 'complaint', liftedAt: null });
    expect(fixture.consents.snapshot()).toHaveLength(0);
    expect(fixture.outbox.items).toHaveLength(0);
  });
  it('defers existing contact effects until confirmation and preserves name and source', async () => {
    const fixture = await setup(true, undefined, {});
    const before = structuredClone(fixture.contacts);
    expect(await fixture.submit({ displayName: 'Fake' })).toMatchObject({ ok: true, value: { status: 'pending' } });
    expect(fixture.contacts).toEqual(before);
    expect(fixture.addMembers).not.toHaveBeenCalled();
    expect(fixture.repos.contacts.update).not.toHaveBeenCalled();
    expect(fixture.repos.contacts.archive).not.toHaveBeenCalled();
    expect(fixture.consents.snapshot()).toHaveLength(1);
    expect(fixture.submissions).toHaveBeenCalledOnce();
    const token = fixture.confirmations.rows[0]?.token;
    if (token === undefined) throw new Error('Missing confirmation');
    expect(fixture.outbox.items[0]?.payload).toMatchObject({ confirmationUrl: `https://acme.example.org/marketing/confirm/${token}` });
    const confirmed = await confirmMarketingConsent(marketingContactCtx(), { token, evidence: { collectedAt: now } }, { ...fixture.repos, ...fixture.deps });
    expect(confirmed).toMatchObject({ ok: true, value: { consent: { status: 'confirmed' } } });
    expect(fixture.contacts[0]).toMatchObject({ displayName: 'Real Name', source: 'import', archivedAt: null, tags: ['existing', 'newsletter'] });
    expect(fixture.addMembers).toHaveBeenCalledWith('tenant-a', { listId: 'list', contactIds: ['contact'] });
    await confirmMarketingConsent(marketingContactCtx(), { token, evidence: { collectedAt: now } }, { ...fixture.repos, ...fixture.deps });
    expect(fixture.addMembers).toHaveBeenCalledOnce();
  });
  it('merges single opt-in effects without changing an existing name or source', async () => {
    const fixture = await setup(false, undefined, {});
    expect(await fixture.submit({ displayName: 'Fake' })).toMatchObject({ ok: true, value: { status: 'subscribed' } });
    expect(fixture.contacts[0]).toMatchObject({ displayName: 'Real Name', source: 'import', archivedAt: null, tags: ['existing', 'newsletter'] });
    expect(fixture.addMembers).toHaveBeenCalledWith('tenant-a', { listId: 'list', contactIds: ['contact'] });
    expect(fixture.outbox.items).toHaveLength(0);
  });
  it('keeps a confirmed double opt-in subscriber confirmed when the address is submitted again', async () => {
    const fixture = await setup(true);
    await fixture.submit();
    const [granted] = fixture.consents.snapshot();
    if (granted === undefined) throw new Error('Missing granted consent');
    await fixture.consents.record('tenant-a', { ...granted, id: 'confirmed-consent', status: 'confirmed', previousId: granted.id, occurredAt: '2026-09-12T10:05:00.000Z' });
    const contact = fixture.contacts[0];
    if (contact === undefined) throw new Error('Missing contact');
    contact.archivedAt = now;
    contact.tags = ['existing'];
    expect(await fixture.submit({ displayName: 'Fake' })).toMatchObject({ ok: true, value: { status: 'pending' } });
    expect(contact).toMatchObject({ displayName: 'Reader', source: 'form:newsletter', archivedAt: null, tags: ['existing', 'newsletter'] });
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
