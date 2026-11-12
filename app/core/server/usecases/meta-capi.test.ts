import { describe, expect, it, vi } from 'vitest';
import { err, notFound, ok, orderSchema, tenantSettingsSchema, type Identity, type MetaCapiEvent } from '#core/domain/index.js';
import type { MetaCapiJob, MetaCapiRepository } from '../meta-capi-ports.js';
import { dispatchMetaCapi, getMetaCapiConfig, listMetaCapiEvents, recordPublicMetaCapiConsent, withdrawMetaCapiConsent, type MetaCapiDispatchDeps } from './meta-capi.js';

const now = '2026-11-01T10:00:00.000Z';
const version = 'a'.repeat(64);
const identity: Identity = { userId: 'buyer', email: 'buyer@example.org', name: 'Buyer', emailVerified: true, image: null,
  tenantAccess: 'member', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: null,
  memberId: 'buyer', memberDisplayName: 'Buyer', memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
const harness = () => {
  let time = now;
  let pending = false;
  const events: MetaCapiEvent[] = [];
  const settings = tenantSettingsSchema.parse({ name: 'Workspace', billingPortalUrl: null, bunnyStreamLibraryId: null,
    privacyUrl: 'https://example.org/privacy', analyticsMetaPixelId: '1234567890', analyticsMetaCapiEnabled: true });
  const job: MetaCapiJob = {
    order: orderSchema.parse({ id: 'purchase', tenantId: 'workspace', memberId: 'buyer', productId: 'book', priceId: null,
      kind: 'one_time', status: 'paid', amountCents: 9900, currency: 'PLN', provider: 'stripe',
      providerObjectIds: { checkoutSession: 'cs_live_purchase' }, couponId: null, discountCents: 0, paidAt: now, createdAt: now }),
    consent: { consent: 'undecided', withdrawnAt: null }, consentAt: null, memberDeleted: false, email: 'buyer@example.org', sourceUrl: 'https://example.org/offer/book',
    attempts: 0, capture: { at: now, ip: null, userAgent: null, fbp: null, textVersion: version, textSnapshot: '{}' },
  };
  let due = now;
  const repository: MetaCapiRepository = {
    findOrder: async (tenantId) => tenantId === 'workspace' ? job : null,
    decide: async (tenantId, access, decide) => {
      if (tenantId !== 'workspace' || ('memberId' in access && access.memberId !== job.order.memberId)) return err(notFound());
      const result = await decide(job);
      if (!result.ok) return result;
      if (result.value.decision === 'withdrawn') { job.consent.withdrawnAt ??= time; pending = false; }
      else if (job.consent.consent === 'undecided' && job.consent.withdrawnAt === null) {
        job.consent.consent = result.value.decision;
        job.capture = result.value.capture; job.consentAt = time;
        pending = result.value.decision === 'granted';
      }
      return ok(job.consent);
    },
    processNext: async (_tenantId, at, process) => {
      if (!pending || due > at) return false;
      const result = await process(job);
      if ('event' in result) { events.push(result.event); pending = false; }
      else { due = result.retryAt; job.attempts += 1; }
      return true;
    },
    listEvents: async () => events,
    listMemberConsents: async () => [],
  };
  const send = vi.fn<MetaCapiDispatchDeps['gateway']['send']>(async () => ({ ok: true, fbtraceId: 'trace' }));
  const deps: MetaCapiDispatchDeps = { repository, tenants: { findSettings: async () => settings }, clock: { nowIso: () => time },
    hash: { sha256: () => version }, secrets: { resolve: async () => ok('secret-token') }, gateway: { send },
    directory: { listAll: async () => [{ id: 'workspace', slug: 'workspace', name: 'Workspace', status: 'active', plan: 'self_hosted', contentVersion: 1 }] } };
  const decide = (decision: 'granted' | 'denied' | 'withdrawn', textVersion = version) => recordPublicMetaCapiConsent('workspace',
    { sessionId: 'cs_live_purchase', decision, textVersion, fbp: 'fb.1.1793527200000.123' },
    { ip: '192.0.2.1', userAgent: 'Browser' }, deps);
  return { deps, job, settings, send, events, decide, setTime: (value: string) => { time = value; } };
};

describe('Meta CAPI use cases', () => {
  it.each(['en', 'pl'] as const)('records the exact displayed %s copy and rejects another locale or stale override', async (locale) => {
    const h = harness();
    const copies = new Map<string, string>();
    h.deps.hash.sha256 = (text) => {
      if (typeof text !== 'string') throw new Error('Consent snapshots must be text');
      const known = copies.get(text);
      if (known) return known;
      const hash = (copies.size + 1).toString(16).padStart(64, '0');
      copies.set(text, hash);
      return hash;
    };
    const config = await getMetaCapiConfig('workspace', 'cs_live_purchase', h.deps, locale);
    if (!config) throw new Error('Missing consent config');
    expect(config.locale).toBe(locale);
    const input = { sessionId: 'cs_live_purchase', decision: 'granted' as const, locale, textVersion: config.textVersion };
    const request = { ip: null, userAgent: null };
    expect(await recordPublicMetaCapiConsent('workspace', { ...input, locale: locale === 'en' ? 'pl' : 'en' }, request, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.job.consent.consent).toBe('undecided');
    h.settings.analyticsMetaCapiConsentHeading = 'Updated heading';
    expect(await recordPublicMetaCapiConsent('workspace', input, request, h.deps)).toMatchObject({ ok: false });
    const updated = await getMetaCapiConfig('workspace', 'cs_live_purchase', h.deps, locale);
    if (!updated) throw new Error('Missing updated consent config');
    expect(updated.heading).toBe('Updated heading');
    expect(await recordPublicMetaCapiConsent('workspace', { ...input, textVersion: updated.textVersion }, request, h.deps)).toMatchObject({ ok: true });
    expect(JSON.parse(h.job.capture.textSnapshot)).toEqual({ heading: updated.heading, body: updated.body,
      acceptLabel: updated.acceptLabel, declineLabel: updated.declineLabel, privacyUrl: updated.privacyUrl });
    expect(h.job.capture.textVersion).toBe(updated.textVersion);
  });
  it('rejects QR grants and denials before repository access', async () => {
    const h = harness();
    const decide = vi.spyOn(h.deps.repository, 'decide');
    for (const decision of ['granted', 'denied'] as const) {
      expect(await recordPublicMetaCapiConsent('workspace', { orderToken: 'q'.repeat(64), decision, textVersion: version },
        { ip: null, userAgent: null }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    expect(decide).not.toHaveBeenCalled();
    expect(await recordPublicMetaCapiConsent('workspace', { orderToken: 'q'.repeat(64), decision: 'withdrawn' },
      { ip: null, userAgent: null }, h.deps)).toMatchObject({ ok: true, value: { withdrawnAt: now } });
  });
  it('does not enqueue undecided or denied orders, and keeps the first answer', async () => {
    const h = harness();
    await dispatchMetaCapi(h.deps);
    await h.decide('denied');
    await h.decide('granted');
    await dispatchMetaCapi(h.deps);
    expect(h.job.consent.consent).toBe('denied');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('enqueues after consent, captures request identifiers, and sends one event on repeat ticks', async () => {
    const h = harness();
    expect(await getMetaCapiConfig('workspace', 'cs_live_purchase', h.deps)).toMatchObject({ enabled: true, textVersion: version });
    await h.decide('granted'); await h.decide('granted');
    expect(h.send).not.toHaveBeenCalled();
    await dispatchMetaCapi(h.deps); await dispatchMetaCapi(h.deps);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]?.[1].payload.user_data).toMatchObject({ em: [version], fbp: 'fb.1.1793527200000.123', client_ip_address: '192.0.2.1' });
    expect(h.events).toMatchObject([{ status: 'sent', transactionId: 'purchase', consentAt: now, sentAt: now }]);
    expect(JSON.stringify(h.events)).not.toMatch(/secret-token|buyer@example.org|192\.0\.2\.1/);
  });
  it('rejects a stale copy version without recording consent', async () => {
    const h = harness();
    expect(await h.decide('granted', 'b'.repeat(64))).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.job.consent.consent).toBe('undecided');
  });
  it('allows the owning member to withdraw but not another member', async () => {
    const h = harness(); await h.decide('granted');
    expect(await withdrawMetaCapiConsent({ identity: { ...identity, memberId: 'stranger' } }, { orderId: 'purchase' }, h.deps)).toMatchObject({ ok: false });
    expect(await withdrawMetaCapiConsent({ identity }, { orderId: 'purchase' }, h.deps)).toMatchObject({ ok: true, value: { withdrawnAt: now } });
    await dispatchMetaCapi(h.deps); expect(h.send).not.toHaveBeenCalled();
  });
  it('rechecks consent, settings, purchase mode and age at dispatch time', async () => {
    for (const reason of ['withdrawn', 'disabled', 'test', 'expired'] as const) {
      const h = harness(); await h.decide('granted');
      if (reason === 'withdrawn') h.job.consent.withdrawnAt = now;
      if (reason === 'disabled') h.settings.analyticsMetaCapiEnabled = false;
      if (reason === 'test') h.job.order.mode = 'test';
      if (reason === 'expired') h.setTime('2026-11-09T10:00:00.000Z');
      await dispatchMetaCapi(h.deps);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.events[0]?.status).toBe(reason === 'expired' ? 'expired' : 'blocked');
    }
  });
  it('retries transient failures three times and never retries permanent rejection', async () => {
    const h = harness(); await h.decide('granted');
    h.send.mockResolvedValue({ ok: false, retryable: true, error: 'http_503' });
    for (const at of [now, '2026-11-01T10:01:00.000Z', '2026-11-01T10:03:00.000Z', '2026-11-01T10:07:00.000Z']) {
      h.setTime(at); await dispatchMetaCapi(h.deps);
    }
    expect(h.send).toHaveBeenCalledTimes(4);
    expect(h.events).toMatchObject([{ status: 'failed', error: 'http_503' }]);
    const permanent = harness(); await permanent.decide('granted');
    permanent.send.mockResolvedValue({ ok: false, retryable: false, error: 'http_400' });
    await dispatchMetaCapi(permanent.deps); await dispatchMetaCapi(permanent.deps);
    expect(permanent.send).toHaveBeenCalledTimes(1);
  });
  it('isolates a failing tenant and logs no raw exception data', async () => {
    const h = harness();
    const tenants = await h.deps.directory.listAll();
    const tenant = tenants[0];
    if (!tenant) throw new Error('Missing test tenant');
    h.deps.directory.listAll = async () => [tenant, { ...tenant, id: 'next' }];
    const processNext = vi.fn<MetaCapiRepository['processNext']>(async (tenantId) => {
      if (tenantId === 'workspace') throw new Error('buyer@example.org secret-token');
      return false;
    });
    h.deps.repository.processNext = processNext;
    const warn = vi.fn();
    expect(await dispatchMetaCapi({ ...h.deps, logger: { warn } })).toEqual({ processed: 0 });
    expect(processNext.mock.calls.map(([tenantId]) => tenantId)).toEqual(['workspace', 'next']);
    expect(warn.mock.calls).toEqual([['[meta-capi] tenant_dispatch_failed']]);
  });
  it('rejects new consent and blocks dispatch for a deleted member', async () => {
    const h = harness();
    h.job.memberDeleted = true;
    expect(await h.decide('granted')).toMatchObject({ ok: false });
    expect(await getMetaCapiConfig('workspace', 'cs_live_purchase', h.deps)).toMatchObject({ enabled: false });
    h.job.memberDeleted = false;
    await h.decide('granted');
    h.job.memberDeleted = true;
    await dispatchMetaCapi(h.deps);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.events).toMatchObject([{ status: 'blocked' }]);
  });
  it('does not reveal the workspace evidence log to members', async () => {
    expect(await listMetaCapiEvents({ identity }, harness().deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
