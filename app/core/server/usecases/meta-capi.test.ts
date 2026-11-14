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
    listDueTenantIds: async () => (await deps.directory.listAll()).map(({ id }) => id),
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
  it('gives a later tenant a turn before draining a busy tenant', async () => {
    const h = harness();
    await h.decide('granted');
    const [tenant] = await h.deps.directory.listAll();
    if (!tenant) throw new Error('Missing test tenant');
    h.deps.directory.listAll = async () => [tenant, { ...tenant, id: 'later' }];
    let laterPending = true;
    const processed: string[] = [];
    h.deps.repository.processNext = async (tenantId, _at, process) => {
      if (tenantId === 'later' && !laterPending) return false;
      if (tenantId === 'later') laterPending = false;
      await process({ ...h.job, order: { ...h.job.order, tenantId } });
      processed.push(tenantId);
      return true;
    };
    expect(await dispatchMetaCapi(h.deps)).toEqual({ processed: 20 });
    expect(processed.slice(0, 2)).toEqual(['workspace', 'later']);
    expect(processed.filter((id) => id === 'workspace')).toHaveLength(19);
    expect(h.send).toHaveBeenCalledTimes(20);
  });
  it('rotates the first tenant so every busy tenant beyond the tick budget gets a turn', async () => {
    const h = harness();
    const [tenant] = await h.deps.directory.listAll();
    if (!tenant) throw new Error('Missing test tenant');
    const tenants = Array.from({ length: 45 }, (_, index) => ({ ...tenant, id: `tenant-${String(index)}` }));
    h.deps.directory.listAll = async () => tenants;
    const processNext = vi.fn<MetaCapiRepository['processNext']>(async () => true);
    h.deps.repository.processNext = processNext;
    const visited = new Set<string>();
    for (let tick = 0; tick < tenants.length; tick += 1) {
      h.setTime(new Date(Date.parse(now) + tick * 60_000).toISOString());
      processNext.mockClear();
      expect(await dispatchMetaCapi(h.deps)).toEqual({ processed: 20 });
      const ids = processNext.mock.calls.map(([id]) => id);
      expect(new Set(ids).size).toBe(20);
      for (const id of ids) visited.add(id);
    }
    expect([...visited].sort()).toEqual(tenants.map(({ id }) => id).sort());
  });
  it('stops round-robin passes at the shared deadline and rotates after slow ticks', async () => {
    const h = harness();
    const [tenant] = await h.deps.directory.listAll();
    if (!tenant) throw new Error('Missing test tenant');
    h.deps.directory.listAll = async () => [tenant, { ...tenant, id: 'later' }];
    const processNext = vi.fn<MetaCapiRepository['processNext']>(async () => {
      h.setTime(new Date(Date.parse(h.deps.clock.nowIso()) + 20_000).toISOString());
      return true;
    });
    h.deps.repository.processNext = processNext;
    expect(await dispatchMetaCapi(h.deps)).toEqual({ processed: 1 });
    h.setTime('2026-11-01T10:01:00.000Z');
    expect(await dispatchMetaCapi(h.deps)).toEqual({ processed: 1 });
    expect(processNext.mock.calls.map(([id]) => id)).toEqual(['workspace', 'later']);
  });
  it('costs one query and opens no tenant transaction when nothing is due', async () => {
    const h = harness();
    const listDue = vi.fn<MetaCapiRepository['listDueTenantIds']>(async () => []);
    const listAll = vi.spyOn(h.deps.directory, 'listAll');
    const processNext = vi.spyOn(h.deps.repository, 'processNext');
    h.deps.repository.listDueTenantIds = listDue;
    expect(await dispatchMetaCapi(h.deps)).toEqual({ processed: 0 });
    expect(listDue).toHaveBeenCalledExactlyOnceWith(now);
    expect(listAll).not.toHaveBeenCalled();
    expect(processNext).not.toHaveBeenCalled();
  });
  it('visits only tenants with due jobs in the rotated tenant order', async () => {
    const h = harness();
    const [tenant] = await h.deps.directory.listAll();
    if (!tenant) throw new Error('Missing test tenant');
    const tenants = ['a', 'b', 'c', 'd'].map((id) => ({ ...tenant, id }));
    h.deps.directory.listAll = async () => tenants;
    h.deps.repository.listDueTenantIds = async () => ['d', 'b'];
    const processNext = vi.fn<MetaCapiRepository['processNext']>(async () => false);
    h.deps.repository.processNext = processNext;
    expect(await dispatchMetaCapi(h.deps)).toEqual({ processed: 0 });
    expect(processNext.mock.calls.map(([id]) => id)).toEqual(['b', 'd']);
    h.setTime(new Date(Date.parse(now) + 3 * 60_000).toISOString());
    processNext.mockClear();
    await dispatchMetaCapi(h.deps);
    expect(processNext.mock.calls.map(([id]) => id)).toEqual(['d', 'b']);
  });
  it('starts no job unless the time left before the deadline covers the gateway timeout', async () => {
    for (const [elapsed, processed] of [[15_000, 2], [15_001, 1]] as const) {
      const h = harness();
      let started = 0;
      h.deps.repository.processNext = vi.fn<MetaCapiRepository['processNext']>(async () => {
        started += 1;
        if (started === 1) h.setTime(new Date(Date.parse(now) + elapsed).toISOString());
        return started <= 2;
      });
      expect(await dispatchMetaCapi(h.deps)).toEqual({ processed });
    }
  });
  it('asks for consent only while the workspace access token is stored', async () => {
    const h = harness();
    const resolve = vi.fn<MetaCapiDispatchDeps['secrets']['resolve']>(async () => err(notFound()));
    h.deps.secrets = { resolve };
    expect(await getMetaCapiConfig('workspace', 'cs_live_purchase', h.deps)).toMatchObject({ enabled: false, consent: 'undecided', withdrawnAt: null });
    expect(resolve).toHaveBeenCalledWith('workspace', 'analyticsMetaCapiAccessToken');
    resolve.mockResolvedValue(ok('secret-token'));
    const config = await getMetaCapiConfig('workspace', 'cs_live_purchase', h.deps);
    expect(config).toMatchObject({ enabled: true });
    expect(JSON.stringify(config)).not.toContain('secret-token');
  });
  it.each(['granted', 'denied'] as const)('rejects a %s decision without recording it while the access token is missing', async (decision) => {
    const h = harness();
    h.deps.secrets = { resolve: vi.fn<MetaCapiDispatchDeps['secrets']['resolve']>(async () => err(notFound())) };
    expect(await h.decide(decision)).toMatchObject({ ok: false, error: { code: 'validation', message: 'Meta conversion consent is unavailable' } });
    expect(h.job.consent).toEqual({ consent: 'undecided', withdrawnAt: null });
    expect(h.job.consentAt).toBeNull();
    await dispatchMetaCapi(h.deps);
    expect(h.events).toEqual([]);
  });
  it('withdraws a recorded grant without resolving the access token', async () => {
    const h = harness();
    await h.decide('granted');
    const resolve = vi.fn<MetaCapiDispatchDeps['secrets']['resolve']>(async () => err(notFound()));
    h.deps.secrets = { resolve };
    expect(await h.decide('withdrawn')).toMatchObject({ ok: true, value: { consent: 'granted', withdrawnAt: now } });
    expect(await withdrawMetaCapiConsent({ identity }, { orderId: 'purchase' }, h.deps)).toMatchObject({ ok: true, value: { withdrawnAt: now } });
    expect(resolve).not.toHaveBeenCalled();
  });
  it('does not resolve the access token for a repeated decision on a decided order', async () => {
    const h = harness();
    await h.decide('denied');
    const resolve = vi.fn<MetaCapiDispatchDeps['secrets']['resolve']>(async () => err(notFound()));
    h.deps.secrets = { resolve };
    expect(await h.decide('granted')).toMatchObject({ ok: true, value: { consent: 'denied' } });
    expect(resolve).not.toHaveBeenCalled();
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
