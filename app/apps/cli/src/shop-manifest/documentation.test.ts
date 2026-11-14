import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { newProductSchema, newProductPriceSchema, updateTenantSettingsInputSchema } from '#core/domain/index.js';
import { effectiveShopSettings, productMetadata, shopManifestSchema } from '#core/domain/shop-manifest.js';
import { applyManifest } from './apply.js';
import { createManifestFake } from './fake-client.js';

describe('shop manifest documentation', () => {
  it('keeps the complete JSON example valid against the manifest and existing write boundaries', async () => {
    const document = await readFile(new URL('../../../../docs/shop-manifest.md', import.meta.url), 'utf8');
    const json = /```json\n([\s\S]*?)\n```/u.exec(document)?.[1];
    if (json === undefined) throw new Error('Expected a JSON manifest example');
    const input: unknown = JSON.parse(json);
    const manifest = shopManifestSchema.parse(input);
    for (const shop of manifest.shops) {
      expect(updateTenantSettingsInputSchema.safeParse(effectiveShopSettings(manifest.company?.settings, shop.settings)).success).toBe(true);
      for (const product of shop.products) {
        expect(newProductSchema.safeParse({ ...productMetadata(product), slug: product.slug, type: product.type, priceCents: product.price.amountCents, currency: product.price.currency }).success).toBe(true);
        expect(newProductPriceSchema.safeParse({ productId: 'p1', kind: 'one_time', ...product.price }).success).toBe(true);
      }
    }
    const { api, state } = createManifestFake();
    expect((await applyManifest(input, () => api)).ok).toBe(true);
    expect(state.products[0]).toMatchObject({ type: 'physical', published: true, deliveryMethod: 'shipping', parcelTemplate: 'small' });
    state.requests.length = 0;
    expect(await applyManifest(input, () => api)).toMatchObject({ ok: true, value: { applied: [] } });
    expect(state.requests.every((request) => request.startsWith('GET '))).toBe(true);
  });
});
