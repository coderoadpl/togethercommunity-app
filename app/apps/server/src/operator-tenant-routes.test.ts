import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { API_PATHS, SCHEDULER_OPERATOR_SECRET_HEADER, operatorTenantReadinessSchema, provisionTenantOutputSchema, envelopeSchema } from '#core/contract/index.js';
import type { TenantSecretKey } from '#core/domain/index.js';
import { operatorTenantHarness } from '#core/server/testing/operator-tenant-fakes.js';

import type { AppVars } from './app-vars.js';
import { registerOperatorTenantRoutes } from './operator-tenant-routes.js';

const secret = 'operator-test-only-secret';
const headers = { [SCHEDULER_OPERATOR_SECRET_HEADER]: secret, 'content-type': 'application/json' };
const body = JSON.stringify({ slug: 'acme', name: 'Acme', ownerEmail: 'owner@example.test' });
const readinessPath = API_PATHS.operatorTenantReadiness.replace(':slug', 'acme');
const harness = () => {
  const h = operatorTenantHarness();
  const app = new Hono<AppVars>();
  registerOperatorTenantRoutes(app, { ...h.deps, operatorSecret: secret });
  return { ...h, app };
};

describe('operator tenant routes', () => {
  it.each([undefined, 'wrong-secret'])('rejects an invalid secret before touching the database', async (candidate) => {
    const h = harness();
    const invalidHeaders = candidate === undefined ? {} : { [SCHEDULER_OPERATOR_SECRET_HEADER]: candidate };
    expect((await h.app.request(API_PATHS.operatorTenantProvision, { method: 'POST', headers: invalidHeaders, body })).status).toBe(401);
    expect((await h.app.request(readinessPath, { headers: invalidHeaders })).status).toBe(401);
    expect(h.state.calls).toBe(0);
    expect(h.tenants).toEqual([]);
  });

  it('returns a strict, secret-free creation response and supports replay', async () => {
    const h = harness();
    for (const created of [true, false]) {
      const response = await h.app.request(API_PATHS.operatorTenantProvision, { method: 'POST', headers, body });
      expect(response.status).toBe(200);
      const payload = envelopeSchema(provisionTenantOutputSchema).parse(await response.json());
      expect(payload).toMatchObject({ ok: true, data: { created, readiness: { storageConfigured: false, stripeConfigured: false } } });
      expect(JSON.stringify(payload)).not.toContain(secret);
      expect(JSON.stringify(payload)).not.toContain('owner@example.test');
    }
    expect(h.audits).toHaveLength(1);
  });

  it('rejects configuration secrets and malformed JSON without provisioning', async () => {
    const h = harness();
    for (const payload of ['{', JSON.stringify({ slug: 'acme', name: 'Acme', ownerEmail: 'owner@example.test', storage: { secretAccessKey: 'never-return-this' } })]) {
      const response = await h.app.request(API_PATHS.operatorTenantProvision, { method: 'POST', headers, body: payload });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('never-return-this');
    }
    expect(h.state.calls).toBe(0);
  });

  it('reports missing, empty and configured tenants using only readiness facts', async () => {
    const h = harness();
    const read = async () => {
      const response = await h.app.request(readinessPath, { headers });
      expect(response.status).toBe(200);
      return envelopeSchema(operatorTenantReadinessSchema).parse(await response.json());
    };
    expect(await read()).toMatchObject({ ok: true, data: { tenantExists: false, ownerGrantPresent: false } });
    await h.app.request(API_PATHS.operatorTenantProvision, { method: 'POST', headers, body });
    expect(await read()).toMatchObject({ ok: true, data: { tenantExists: true, ownerGrantPresent: true, storageConfigured: false, lastProbeOk: false, stripeConfigured: false, mode: null, webhookEndpointRegistered: false, legalUrlsSet: false, publishedProducts: 0 } });
    const keys: TenantSecretKey[] = ['s3.configuration', 'stripe.restrictedKey', 'stripe.webhookSecret', 'stripe.webhookEndpointId'];
    h.secrets.push(...keys.map((key) => ({
      id: key, tenantId: 'id-1', key, ciphertext: 'hidden-ciphertext', iv: 'hidden-iv',
      authTag: 'hidden-tag', maskedPreview: 'hidden-preview', updatedAt: h.deps.clock.nowIso(),
    })));
    h.state.settings.termsUrl = 'https://example.test/terms';
    h.state.settings.privacyUrl = 'https://example.test/privacy';
    h.state.probe = { checkedAt: h.deps.clock.nowIso(), results: [{ origin: 'https://acme.example.test', status: 'ok' }] };
    h.products.push({
      id: 'product-1', tenantId: 'id-1', type: 'course', slug: 'sample', title: 'Sample',
      description: '', coverUrl: null, priceCents: 100, currency: 'USD', published: true,
      visibility: 'listed', accessItems: [], legacyId: null, createdAt: h.deps.clock.nowIso(),
    });
    const configured = await read();
    expect(configured).toMatchObject({ ok: true, data: { storageConfigured: true, lastProbeOk: true, stripeConfigured: true, mode: 'live', webhookEndpointRegistered: true, legalUrlsSet: true, publishedProducts: 1 } });
    expect(JSON.stringify(configured)).not.toMatch(/hidden-|example.test|ciphertext|maskedPreview|ownerEmail/);
    h.state.probe.results[0] = { origin: 'https://acme.example.test', status: 'blocked' };
    expect(await read()).toMatchObject({ ok: true, data: { lastProbeOk: false } });
    h.secrets.splice(1);
    h.secrets.push(...keys.slice(1, 3).map((key) => ({
      id: key, tenantId: 'id-1', key: key === 'stripe.restrictedKey' ? 'stripe.testRestrictedKey' as const : 'stripe.testWebhookSecret' as const,
      ciphertext: 'hidden', iv: 'hidden', authTag: 'hidden', maskedPreview: 'hidden', updatedAt: h.deps.clock.nowIso(),
    })));
    expect(await read()).toMatchObject({ ok: true, data: { stripeConfigured: true, mode: 'test', webhookEndpointRegistered: false } });
  });
});
