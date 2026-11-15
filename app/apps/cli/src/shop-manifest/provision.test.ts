import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '#core/client/index.js';
import { forbidden, provisionTenantInputSchema } from '#core/domain/index.js';
import { SHOP_OPERATOR_SECRET_ENV } from '#core/domain/shop-manifest.js';
import { applyManifest } from './apply.js';
import { planManifest } from './plan.js';
import { createManifestFake, manifestFixture } from './fake-client.js';

const manifest = {
  ...manifestFixture,
  shops: [{ ...manifestFixture.shops[0], workspace: { slug: 'acme', provision: { name: 'Acme', ownerEmail: 'owner@togethercommunity.app' } } }],
};
const environment = { [SHOP_OPERATOR_SECRET_ENV]: 'operator-fixture' };
const fakeOperator = (fake: ReturnType<typeof createManifestFake>) => {
  const calls: unknown[] = [];
  const api = createApiClient({ baseUrl: 'https://togethercommunity.app', fetchImpl: async (url, init) => {
    expect(String(url)).toBe('https://togethercommunity.app/api/internal/tenants/provision');
    expect(new Headers(init?.headers).get('x-scheduler-operator-secret')).toBe('operator-fixture');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
    const input: unknown = JSON.parse(String(init?.body));
    const body = provisionTenantInputSchema.parse(input);
    calls.push(body);
    const created = !fake.state.exists;
    fake.state.exists = true;
    return Response.json({ ok: true, data: {
      tenant: { id: 't1', slug: body.slug, name: body.name }, created, ownerUserId: 'u1',
      readiness: { tenantExists: true, ownerGrantPresent: true, storageConfigured: false, lastProbeOk: false,
        lastProbeAt: null, stripeConfigured: false, mode: null, webhookEndpointRegistered: false, legalUrlsSet: false, publishedProducts: 0 },
    } });
  } });
  return { api, calls };
};

describe('manifest workspace provisioning', () => {
  it('plans a missing workspace without the operator secret and performs only identity reads', async () => {
    const fake = createManifestFake();
    fake.state.exists = false;
    const result = await planManifest(manifest, () => fake.api);
    expect(result).toMatchObject({ ok: true, value: { shops: [{ workspace: 'acme', provisioning: 'create', products: [{ product: 'create' }] }] } });
    expect(fake.state.requests).toEqual(['GET /api/me']);
    expect(JSON.stringify(result)).not.toContain('owner@');
  });

  it('fails before any shop write if the operator variable is missing', async () => {
    const acme = createManifestFake();
    const studio = createManifestFake('studio');
    studio.state.exists = false;
    const input = { ...manifest, shops: [manifestFixture.shops[0], { workspace: { slug: 'studio', provision: { name: 'Studio', ownerEmail: 'owner@togethercommunity.app' } }, products: [] }] };
    const result = await applyManifest(input, (slug) => slug === 'studio' ? studio.api : acme.api);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining(SHOP_OPERATOR_SECRET_ENV), details: { applied: [] } } });
    expect(acme.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
  });

  it('provisions through the operator client, re-reads and applies, and does not provision twice', async () => {
    const fake = createManifestFake();
    fake.state.exists = false;
    const operator = fakeOperator(fake);
    const result = await applyManifest(manifest, () => fake.api, undefined, { environment, operator: operator.api });
    expect(result).toMatchObject({ ok: true, value: { applied: [
      { workspace: 'acme', operation: 'workspace:provision' },
      ...['settings:update', 'product:create', 'price:add', 'stock:enable', 'cover:update', 'publication:publish'].map((operation) => expect.objectContaining({ operation })),
    ] } });
    expect(operator.calls).toEqual([{ slug: 'acme', name: 'Acme', ownerEmail: 'owner@togethercommunity.app' }]);
    expect(fake.state.requests.slice(0, 4)).toEqual(['GET /api/me', 'GET /api/me', 'GET /api/tenant/settings', 'GET /api/products']);
    fake.state.requests.length = 0;
    expect(await applyManifest(manifest, () => fake.api)).toMatchObject({ ok: true, value: { applied: [] } });
    expect(operator.calls).toHaveLength(1);
    expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('operator-fixture');
  });

  it('does not treat authentication, permission or generic not-found failures as a missing workspace', async () => {
    for (const code of ['unauthorized', 'forbidden', 'not_found'] as const) {
      const fake = createManifestFake();
      fake.state.failure = { path: '/api/me', error: { code, message: 'private diagnostic' } };
      const operator = fakeOperator(fake);
      expect(await applyManifest(manifest, () => fake.api, undefined, { environment, operator: operator.api })).toMatchObject({ ok: false, error: { code } });
      expect(operator.calls).toEqual([]);
    }
  });

  it('stops and redacts a provisioning failure before catalogue writes', async () => {
    const fake = createManifestFake();
    fake.state.exists = false;
    const operator = { provisionOperatorTenant: vi.fn(async () => ({ ok: false as const, error: forbidden('operator-fixture') })) };
    const result = await applyManifest(manifest, () => fake.api, undefined, { environment, operator });
    expect(result).toMatchObject({ ok: false, error: { details: { failure: { operation: 'workspace:provision' }, applied: [] } } });
    expect(fake.state.requests).toEqual(['GET /api/me']);
    expect(JSON.stringify(result)).not.toContain('operator-fixture');
  });
});
