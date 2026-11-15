import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { newProductSchema, newProductPriceSchema, provisionTenantInputSchema, updateTenantSettingsInputSchema } from '#core/domain/index.js';
import { effectiveShopIntegrations, effectiveShopSettings, manifestWorkspaceSlug, productMetadata, shopManifestSchema } from '#core/domain/shop-manifest.js';
import { resolveManifestIntegrations } from './integrations.js';
import { driftManifest } from './drift.js';
import { applyManifest } from './apply.js';
import { createManifestFake } from './fake-client.js';

describe('shop manifest documentation', () => {
  it('keeps the complete JSON example valid against the manifest and existing write boundaries', async () => {
    const document = await readFile(new URL('../../../../docs/shop-manifest.md', import.meta.url), 'utf8');
    const json = /```json\n([\s\S]*?)\n```/u.exec(document)?.[1];
    if (json === undefined) throw new Error('Expected a JSON manifest example');
    const input: unknown = JSON.parse(json);
    const manifest = shopManifestSchema.parse(input);
    expect(manifest.shops.map((shop) => manifestWorkspaceSlug(shop.workspace))).toEqual(['acme', 'studio', 'akademia']);
    for (const shop of manifest.shops) {
      if (typeof shop.workspace !== 'string') {
        expect(provisionTenantInputSchema.safeParse({ slug: shop.workspace.slug, ...shop.workspace.provision }).success).toBe(true);
      }
      expect(resolveManifestIntegrations(effectiveShopIntegrations(manifest.company?.integrations, shop.integrations), {
        SHOP_STRIPE_TEST_KEY: 'rk_test_fixture', SHOP_SHIPX_ORGANIZATION_ID: '123',
        SHOP_SHIPX_TOKEN: 'shipx-fixture', SHOP_GEOWIDGET_PUBLIC_TOKEN: 'geowidget-fixture',
      }).ok).toBe(true);
      expect(updateTenantSettingsInputSchema.safeParse(effectiveShopSettings(manifest.company?.settings, shop.settings)).success).toBe(true);
      for (const product of shop.products) {
        expect(newProductSchema.safeParse({ ...productMetadata(product), slug: product.slug, type: product.type, priceCents: product.price.amountCents, currency: product.price.currency }).success).toBe(true);
        expect(newProductPriceSchema.safeParse({ productId: 'p1', kind: 'one_time', ...product.price }).success).toBe(true);
      }
    }
    const fakes = new Map(manifest.shops.map((shop) => {
      const slug = manifestWorkspaceSlug(shop.workspace);
      return [slug, createManifestFake(slug)] as const;
    }));
    const clientFor = (workspace: string) => {
      const fake = fakes.get(workspace);
      if (fake === undefined) throw new Error('Unexpected documentation workspace');
      return fake.api;
    };
    expect((await applyManifest(input, clientFor)).ok).toBe(true);
    expect(fakes.get('acme')?.state.products[0]).toMatchObject({ type: 'physical', published: true, deliveryMethod: 'shipping', parcelTemplate: 'small' });
    for (const fake of fakes.values()) {
      expect(fake.state.products).toHaveLength(1);
      expect(fake.state.products[0]?.published).toBe(true);
      fake.state.requests.length = 0;
    }
    expect(await applyManifest(input, clientFor)).toMatchObject({ ok: true, value: { applied: [] } });
    expect(await driftManifest(input, clientFor)).toMatchObject({ ok: true, value: { drifted: false } });
    for (const fake of fakes.values()) expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
  });

  it('limits the tool to multi-tenant instances because no response identifies a single-tenant one', async () => {
    const document = await readFile(new URL('../../../../docs/shop-manifest.md', import.meta.url), 'utf8');
    expect(document.replace(/\s+/gu, ' ')).toContain('The tool supports multi-tenant instances only');
    expect(document).toContain('APP_BASE_DOMAIN');
  });

  it.each(['shop-manifest.md', 'shop-integration.md'])('runs every --json example in %s without the script banner', async (name) => {
    const document = await readFile(new URL(`../../../../docs/${name}`, import.meta.url), 'utf8');
    const jsonExamples = document.split('\n').filter((line) => line.includes('--json') && line.includes('run cli'));
    expect(jsonExamples.length).toBeGreaterThan(0);
    for (const line of jsonExamples) expect(line).toMatch(/^pnpm --silent run cli /u);
  });
});
