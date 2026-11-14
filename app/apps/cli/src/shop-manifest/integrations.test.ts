import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '#core/client/index.js';
import { configureShipxInputSchema, configureStripeInputSchema, err, forbidden, ok, shipxSettingsViewSchema } from '#core/domain/index.js';
import { effectiveShopIntegrations, shopManifestSchema } from '#core/domain/shop-manifest.js';
import { applyManifest } from './apply.js';
import { planManifest } from './plan.js';
import { createManifestFake } from './fake-client.js';

const integrations = {
  stripe: { restrictedKeyEnv: 'SHOP_STRIPE_KEY', mode: 'test' as const },
  shipx: { environment: 'sandbox' as const, tokenEnv: 'SHOP_SHIPX_TOKEN', organizationIdEnv: 'SHOP_SHIPX_ORGANIZATION' },
  parcelLocker: { tokenEnv: 'SHOP_LOCKER_TOKEN' },
};
const environment = {
  SHOP_STRIPE_KEY: 'rk_test_fake-key', SHOP_SHIPX_TOKEN: 'private-shipx-token',
  SHOP_SHIPX_ORGANIZATION: '123', SHOP_LOCKER_TOKEN: 'private-locker-token',
};
const manifest = { version: 1, company: { integrations }, shops: [{ workspace: 'acme', products: [] }] };
const integrationFake = (workspace = 'acme') => {
  const fake = createManifestFake(workspace);
  const endpoints: Array<{ url: string; secret: string }> = [];
  const configureStripe = vi.fn<ApiClient['configureStripe']>(async (input) => {
    const parsed = configureStripeInputSchema.parse(input);
    const url = `https://${workspace}.togethercommunity.app/api/stripe/webhook?mode=${parsed.mode}`;
    endpoints.push({ url, secret: `signing-secret-${workspace}-${endpoints.length}` });
    return ok({ mode: parsed.mode, webhookUrl: url });
  });
  const shipxConfigure = vi.fn<ApiClient['shipxConfigure']>(async (input) => {
    configureShipxInputSchema.parse(input);
    return ok(shipxSettingsViewSchema.parse({ environment: 'sandbox', sender: null, organizationId: null, token: null, configured: true }));
  });
  return { ...fake, endpoints, api: { ...fake.api, configureStripe, shipxConfigure } };
};

const expectNoSecrets = (value: unknown) => {
  for (const secret of Object.values(environment)) expect(JSON.stringify(value)).not.toContain(secret);
};

describe('manifest integrations', () => {
  it('plans and applies without the flag without reading environment or configuring providers', async () => {
    const fake = integrationFake();
    const environmentAccess = vi.fn(() => { throw new Error('Environment must not be read'); });
    const protectedEnvironment = { get SHOP_STRIPE_KEY(): string { return environmentAccess(); } };
    const plan = await planManifest(manifest, () => fake.api);
    const apply = await applyManifest(manifest, () => fake.api, undefined, { environment: protectedEnvironment });
    for (const result of [plan, apply]) {
      expect(result).toMatchObject({ ok: true, value: { shops: [{ integrations: ['stripe', 'shipx', 'parcelLocker'].map((provider) => ({ provider, action: 'skipped without --integrations' })) }] } });
      expectNoSecrets(result);
    }
    expect(environmentAccess).not.toHaveBeenCalled();
    expect(fake.api.configureStripe).not.toHaveBeenCalled();
    expect(fake.api.shipxConfigure).not.toHaveBeenCalled();
    expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
  });

  it('configures each shop independently with the shared key and never reads or copies a webhook secret', async () => {
    const acme = integrationFake();
    const studio = integrationFake('studio');
    const input = { ...manifest, shops: ['acme', 'studio'].map((workspace) => ({ workspace, products: [] })) };
    const result = await applyManifest(input, (workspace) => workspace === 'acme' ? acme.api : studio.api, undefined, { integrations: true, environment });
    expect(result).toMatchObject({ ok: true, value: { applied: ['acme', 'studio'].flatMap((workspace) => ['stripe', 'shipx', 'parcelLocker'].map((provider) => ({ workspace, operation: `integration:${provider}` }))) } });
    for (const fake of [acme, studio]) {
      expect(fake.api.configureStripe).toHaveBeenCalledExactlyOnceWith({ restrictedKey: environment.SHOP_STRIPE_KEY, mode: 'test' });
      expect(fake.api.shipxConfigure).toHaveBeenCalledExactlyOnceWith({ environment: 'sandbox', organizationId: '123', token: environment.SHOP_SHIPX_TOKEN });
      expect(fake.state.settings.inpostGeowidgetToken).toBe(environment.SHOP_LOCKER_TOKEN);
      expect(fake.state.requests.some((request) => request.includes('secrets'))).toBe(false);
    }
    expect(acme.endpoints[0]?.url).not.toBe(studio.endpoints[0]?.url);
    expect(acme.endpoints[0]?.secret).not.toBe(studio.endpoints[0]?.secret);
    expectNoSecrets(result);
    expect(JSON.stringify(result)).not.toContain('signing-secret');
  });

  it('preflights all selected environments before settings or provisioning writes', async () => {
    const acme = integrationFake();
    const studio = integrationFake('studio');
    studio.state.exists = false;
    const operator = { provisionOperatorTenant: vi.fn<ApiClient['provisionOperatorTenant']>(async () => err(forbidden())) };
    const input = { ...manifest, company: { integrations, settings: { invoiceSellerName: 'Acme' } }, shops: [
      { workspace: 'acme', products: [] },
      { workspace: { slug: 'studio', provision: { name: 'Studio', ownerEmail: 'owner@togethercommunity.app' } }, integrations: { stripe: { restrictedKeyEnv: 'MISSING_KEY', mode: 'test' } }, products: [] },
    ] };
    const result = await applyManifest(input, (workspace) => workspace === 'acme' ? acme.api : studio.api, undefined, { integrations: true, environment, operator });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('MISSING_KEY'), details: { applied: [] } } });
    expect(acme.api.configureStripe).not.toHaveBeenCalled();
    expect(operator.provisionOperatorTenant).not.toHaveBeenCalled();
    expect(acme.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expectNoSecrets(result);
  });

  it.each([
    { ...environment, SHOP_STRIPE_KEY: 'rk_live_wrong-mode' },
    { ...environment, SHOP_SHIPX_ORGANIZATION: 'not-an-id' },
    { ...environment, SHOP_LOCKER_TOKEN: 'x'.repeat(4001) },
  ])('rejects invalid resolved configuration before mutations', async (environment) => {
    const fake = integrationFake();
    const result = await applyManifest(manifest, () => fake.api, undefined, { integrations: true, environment });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', details: { applied: [] } } });
    expect(fake.api.configureStripe).not.toHaveBeenCalled();
    expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expectNoSecrets(result);
  });

  it('merges company integration settings, replaces environment references and permits explicit opt-out', async () => {
    expect(effectiveShopIntegrations(integrations, { stripe: null, shipx: { tokenEnv: 'STUDIO_TOKEN' } })).toEqual({
      stripe: null, shipx: { ...integrations.shipx, tokenEnv: 'STUDIO_TOKEN' }, parcelLocker: integrations.parcelLocker,
    });
    const fake = integrationFake('studio');
    const input = { ...manifest, shops: [{ workspace: 'studio', integrations: { stripe: null, shipx: null, parcelLocker: null }, products: [] }] };
    expect(await applyManifest(input, () => fake.api, undefined, { integrations: true })).toMatchObject({ ok: true, value: { applied: [] } });
    expect(fake.api.configureStripe).not.toHaveBeenCalled();
  });

  it('stops at provider failure and redacts provider error and transport exception values', async () => {
    for (const throws of [false, true]) {
      const fake = integrationFake();
      fake.api.shipxConfigure.mockImplementation(async () => {
        if (throws) throw new Error(environment.SHOP_SHIPX_TOKEN);
        return { ok: false, error: forbidden(environment.SHOP_SHIPX_TOKEN) };
      });
      const result = await applyManifest(manifest, () => fake.api, undefined, { integrations: true, environment });
      expect(result).toMatchObject({ ok: false, error: { details: { failure: { operation: 'integration:shipx' }, applied: [{ workspace: 'acme', operation: 'integration:stripe' }] } } });
      expect(fake.state.settings.inpostGeowidgetToken).toBeUndefined();
      expectNoSecrets(result);
    }
  });

  it('refuses inline credentials and unknown integration or nested sender fields', () => {
    for (const invalid of [
      { stripe: { restrictedKey: environment.SHOP_STRIPE_KEY, mode: 'test' } },
      { stripe: { restrictedKeyEnv: 'rk_test_not-a-variable', mode: 'test' } },
      { shipx: { token: environment.SHOP_SHIPX_TOKEN } },
      { parcelLocker: { token: environment.SHOP_LOCKER_TOKEN } },
      { stripe: { ...integrations.stripe, webhookSecretEnv: 'FORBIDDEN' } },
      { shipx: { sender: { name: 'Acme', secret: 'forbidden' } } },
    ]) expect(shopManifestSchema.safeParse({ ...manifest, company: { integrations: invalid } }).success).toBe(false);
  });

  it('rejects conflicting parcel-locker management locations', async () => {
    const fake = integrationFake();
    const input = { ...manifest, company: { integrations, settings: { inpostGeowidgetToken: 'public-token' } } };
    expect(await planManifest(input, () => fake.api)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(fake.state.requests).toEqual([]);
  });
});
