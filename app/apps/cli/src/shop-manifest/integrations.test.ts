import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '#core/client/index.js';
import { configureShipxInputSchema, configureStripeInputSchema, err, forbidden, ok, shipxSettingsViewSchema } from '#core/domain/index.js';
import { effectiveShopIntegrations, integrationReferenceError, SHOP_OPERATOR_SECRET_ENV, shopManifestSchema } from '#core/domain/shop-manifest.js';
import { applyManifest } from './apply.js';
import { resolveManifestIntegrations } from './integrations.js';
import { planManifest } from './plan.js';
import { createManifestFake } from './fake-client.js';

const integrations = {
  stripe: { restrictedKeyEnv: 'SHOP_STRIPE_KEY', mode: 'test' as const },
  shipx: { environment: 'sandbox' as const, tokenEnv: 'SHOP_SHIPX_TOKEN', organizationIdEnv: 'SHOP_SHIPX_ORGANIZATION' },
  parcelLocker: { tokenEnv: 'SHOP_GEOWIDGET_PUBLIC_TOKEN' },
};
const environment = {
  SHOP_STRIPE_KEY: 'rk_test_fake-key', SHOP_SHIPX_TOKEN: 'private-shipx-token',
  SHOP_SHIPX_ORGANIZATION: '123', SHOP_GEOWIDGET_PUBLIC_TOKEN: 'private-locker-token',
};
const manifest = { version: 1, company: { integrations }, shops: [{ workspace: 'acme', products: [] }] };
const integrationFake = (workspace = 'acme') => {
  const fake = createManifestFake(workspace);
  const endpoints: Array<{ url: string; secret: string }> = [];
  const configureStripe = vi.fn<ApiClient['configureStripe']>(async (input) => {
    const parsed = configureStripeInputSchema.parse(input);
    const url = `https://${workspace}.togethercommunity.app/api/stripe/webhook?mode=${parsed.mode}`;
    endpoints.push({ url, secret: `signing-secret-${workspace}-${endpoints.length}` });
    fake.state.secretKeys = parsed.mode === 'test'
      ? ['stripe.testRestrictedKey', 'stripe.testWebhookSecret', 'stripe.testWebhookEndpointId']
      : ['stripe.restrictedKey', 'stripe.webhookSecret', 'stripe.webhookEndpointId'];
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
      expect(fake.state.settings.inpostGeowidgetToken).toBe(environment.SHOP_GEOWIDGET_PUBLIC_TOKEN);
      expect(fake.state.requests.filter((request) => request.includes('secrets'))).toEqual(['GET /api/tenant-secrets']);
    }
    expect(acme.endpoints[0]?.url).not.toBe(studio.endpoints[0]?.url);
    expect(acme.endpoints[0]?.secret).not.toBe(studio.endpoints[0]?.secret);
    expectNoSecrets(result);
    expect(JSON.stringify(result)).not.toContain('signing-secret');
  });

  it('does not configure a payment mode again once the workspace reports it as configured', async () => {
    const fake = integrationFake();
    expect(await planManifest(manifest, () => fake.api)).toMatchObject({ ok: true, value: { shops: [{ integrations: [{ provider: 'stripe', configured: false, action: 'skipped without --integrations' }, { provider: 'shipx' }, { provider: 'parcelLocker' }] }] } });
    expect((await applyManifest(manifest, () => fake.api, undefined, { integrations: true, environment })).ok).toBe(true);
    expect(fake.api.configureStripe).toHaveBeenCalledTimes(1);
    const stripeUnchanged = { provider: 'stripe', configured: true, action: 'unchanged' };
    expect(await planManifest(manifest, () => fake.api)).toMatchObject({ ok: true, value: { shops: [{ integrations: [stripeUnchanged, { provider: 'shipx' }, { provider: 'parcelLocker' }] }] } });
    const second = await applyManifest(manifest, () => fake.api, undefined, { integrations: true, environment });
    expect(second).toMatchObject({ ok: true, value: { shops: [{ integrations: [stripeUnchanged, { provider: 'shipx', action: 'configure' }, { provider: 'parcelLocker' }] }] } });
    if (!second.ok) throw new Error('Expected a successful apply');
    expect(second.value.applied.map((entry) => entry.operation)).not.toContain('integration:stripe');
    expect(fake.api.configureStripe).toHaveBeenCalledTimes(1);
    const live = { ...manifest, company: { integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_KEY', mode: 'live' } } } };
    expect(await planManifest(live, () => fake.api)).toMatchObject({ ok: true, value: { shops: [{ integrations: [{ provider: 'stripe', configured: false }] }] } });
    expect(fake.state.requests.filter((request) => request.includes('secrets')).every((request) => request === 'GET /api/tenant-secrets')).toBe(true);
    expectNoSecrets(second);
  });

  it('configures a configured payment mode again only with the explicit reconfigure option', async () => {
    const fake = integrationFake();
    fake.state.secretKeys = ['stripe.testRestrictedKey', 'stripe.testWebhookSecret', 'stripe.testWebhookEndpointId'];
    const result = await applyManifest(manifest, () => fake.api, undefined, { integrations: true, reconfigurePayments: true, environment });
    expect(result).toMatchObject({ ok: true, value: { applied: expect.arrayContaining([{ workspace: 'acme', operation: 'integration:stripe' }]), shops: [{ integrations: [{ provider: 'stripe', configured: true, action: 'configure' }, {}, {}] }] } });
    expect(fake.api.configureStripe).toHaveBeenCalledExactlyOnceWith({ restrictedKey: environment.SHOP_STRIPE_KEY, mode: 'test' });
    const refused = integrationFake();
    expect(await applyManifest(manifest, () => refused.api, undefined, { reconfigurePayments: true, environment })).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('--reconfigure-payments requires --integrations') } });
    expect(refused.state.requests).toEqual([]);
  });

  it('preflights all selected environments before settings or provisioning writes', async () => {
    const acme = integrationFake();
    const studio = integrationFake('studio');
    studio.state.exists = false;
    const operator = { provisionOperatorTenant: vi.fn<ApiClient['provisionOperatorTenant']>(async () => err(forbidden())) };
    const input = { ...manifest, company: { integrations, settings: { invoiceSellerName: 'Acme' } }, shops: [
      { workspace: 'acme', products: [] },
      { workspace: { slug: 'studio', provision: { name: 'Studio', ownerEmail: 'owner@togethercommunity.app' } }, integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_MISSING_KEY', mode: 'test' } }, products: [] },
    ] };
    const result = await applyManifest(input, (workspace) => workspace === 'acme' ? acme.api : studio.api, undefined, { integrations: true, environment, operator });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('SHOP_STRIPE_MISSING_KEY'), details: { applied: [] } } });
    expect(acme.api.configureStripe).not.toHaveBeenCalled();
    expect(operator.provisionOperatorTenant).not.toHaveBeenCalled();
    expect(acme.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expectNoSecrets(result);
  });

  it.each([
    { ...environment, SHOP_STRIPE_KEY: 'rk_live_wrong-mode' },
    { ...environment, SHOP_SHIPX_ORGANIZATION: 'not-an-id' },
    { ...environment, SHOP_GEOWIDGET_PUBLIC_TOKEN: 'x'.repeat(4001) },
  ])('rejects invalid resolved configuration before mutations', async (environment) => {
    const fake = integrationFake();
    const result = await applyManifest(manifest, () => fake.api, undefined, { integrations: true, environment });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', details: { applied: [] } } });
    expect(fake.api.configureStripe).not.toHaveBeenCalled();
    expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expectNoSecrets(result);
  });

  it('merges company integration settings, replaces environment references and permits explicit opt-out', async () => {
    expect(effectiveShopIntegrations(integrations, { stripe: null, shipx: { tokenEnv: 'SHOP_SHIPX_STUDIO_TOKEN' } })).toEqual({
      stripe: null, shipx: { ...integrations.shipx, tokenEnv: 'SHOP_SHIPX_STUDIO_TOKEN' }, parcelLocker: integrations.parcelLocker,
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
      { parcelLocker: { token: environment.SHOP_GEOWIDGET_PUBLIC_TOKEN } },
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

  describe('environment reference rules', () => {
    const rejected = (company: unknown, message: string) => {
      const parsed = shopManifestSchema.safeParse({ ...manifest, company: { integrations: company } });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(message);
    };

    it.each([
      ['an unprefixed variable', { stripe: { restrictedKeyEnv: 'STRIPE_SECRET_KEY', mode: 'test' } }],
      ['a lower-case variable', { shipx: { tokenEnv: 'SHOP_shipx' } }],
      ['the bare prefix', { shipx: { organizationIdEnv: 'SHOP_' } }],
      ['another platform variable', { shipx: { tokenEnv: 'DATABASE_URL' } }],
    ])('requires the SHOP_ prefix for %s', (_case, company) => {
      expect(shopManifestSchema.safeParse({ ...manifest, company: { integrations: company } }).success).toBe(false);
    });

    it('never lets a provider field reference the operator secret variable', () => {
      for (const company of [
        { stripe: { restrictedKeyEnv: SHOP_OPERATOR_SECRET_ENV, mode: 'test' } },
        { shipx: { tokenEnv: SHOP_OPERATOR_SECRET_ENV } },
        { parcelLocker: { tokenEnv: SHOP_OPERATOR_SECRET_ENV } },
      ]) expect(shopManifestSchema.safeParse({ ...manifest, company: { integrations: company } }).success).toBe(false);
      expect(integrationReferenceError({ shipx: { tokenEnv: SHOP_OPERATOR_SECRET_ENV } })).toBe('Integration variables must not reference the operator secret');
    });

    it('refuses one variable referenced by two provider fields', () => {
      rejected({ shipx: { tokenEnv: 'SHOP_SHIPX_SHARED', organizationIdEnv: 'SHOP_SHIPX_SHARED' } },
        'Each integration variable may be referenced by one provider field only');
    });

    it.each([
      ['a carrier name as the payment key', { stripe: { restrictedKeyEnv: 'SHOP_SHIPX_TOKEN', mode: 'test' } }, 'Stripe variables must be named SHOP_STRIPE_<NAME>'],
      ['a generic name as the payment key', { stripe: { restrictedKeyEnv: 'SHOP_KEY', mode: 'test' } }, 'Stripe variables must be named SHOP_STRIPE_<NAME>'],
      ['a bare namespace as the payment key', { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_', mode: 'test' } }, 'Stripe variables must be named SHOP_STRIPE_<NAME>'],
      ['a payment name as the carrier token', { shipx: { tokenEnv: 'SHOP_STRIPE_KEY' } }, 'ShipX variables must be named SHOP_SHIPX_<NAME>'],
      ['a payment name as the carrier organization', { shipx: { organizationIdEnv: 'SHOP_STRIPE_KEY' } }, 'ShipX variables must be named SHOP_SHIPX_<NAME>'],
      ['a doubled separator in a carrier name', { shipx: { tokenEnv: 'SHOP_SHIPX__TOKEN' } }, 'ShipX variables must be named SHOP_SHIPX_<NAME>'],
    ])('binds variable names to their provider: refuses %s', (_case, company, message) => {
      rejected(company, message);
    });

    it('accepts names inside each provider namespace', () => {
      expect(shopManifestSchema.safeParse({ ...manifest, company: { integrations: {
        stripe: { restrictedKeyEnv: 'SHOP_STRIPE_LIVE_KEY_2', mode: 'live' },
        shipx: { tokenEnv: 'SHOP_SHIPX_TOKEN', organizationIdEnv: 'SHOP_SHIPX_ORGANIZATION_ID' },
        parcelLocker: { tokenEnv: 'SHOP_GEOWIDGET_STUDIO_PUBLIC_TOKEN' },
      } } }).success).toBe(true);
    });

    it('requires the public pattern for the parcel-locker token and forbids the public marker on secret fields', () => {
      const publicName = 'The parcel-locker token variable must be named SHOP_GEOWIDGET_<NAME>_PUBLIC_TOKEN or SHOP_GEOWIDGET_PUBLIC_TOKEN';
      rejected({ parcelLocker: { tokenEnv: 'SHOP_GEOWIDGET_TOKEN' } }, publicName);
      rejected({ parcelLocker: { tokenEnv: 'SHOP_PUBLIC_TOKEN' } }, publicName);
      rejected({ parcelLocker: { tokenEnv: 'SHOP_LOCKER_PUBLIC_TOKEN' } }, publicName);
      rejected({ parcelLocker: { tokenEnv: 'SHOP_STRIPE_PUBLIC_TOKEN' } }, publicName);
      rejected({ stripe: { restrictedKeyEnv: 'SHOP_STRIPE_PUBLIC_TOKEN', mode: 'test' } }, 'Secret integration variables must not carry the PUBLIC marker');
      rejected({ shipx: { tokenEnv: 'SHOP_SHIPX_PUBLIC' } }, 'Secret integration variables must not carry the PUBLIC marker');
      expect(shopManifestSchema.safeParse({ ...manifest, company: { integrations: { parcelLocker: { tokenEnv: 'SHOP_GEOWIDGET_PUBLIC_TOKEN' } } } }).success).toBe(true);
    });

    it('rechecks provider namespaces on a merged configuration before resolving values', () => {
      expect(integrationReferenceError({ shipx: { tokenEnv: 'SHOP_STRIPE_KEY' } })).toBe('ShipX variables must be named SHOP_SHIPX_<NAME>');
      const result = resolveManifestIntegrations({ stripe: integrations.stripe, shipx: { tokenEnv: 'SHOP_STRIPE_KEY' } }, environment);
      expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(JSON.stringify(result)).not.toContain(environment.SHOP_STRIPE_KEY);
    });

    it.each([
      ['the carrier token', { shipx: { tokenEnv: 'SHOP_SHIPX_TOKEN' } }, 'SHOP_SHIPX_TOKEN'],
      ['the carrier organization', { shipx: { organizationIdEnv: 'SHOP_SHIPX_ORGANIZATION' } }, 'SHOP_SHIPX_ORGANIZATION'],
      ['the parcel-locker token', { parcelLocker: { tokenEnv: 'SHOP_GEOWIDGET_PUBLIC_TOKEN' } }, 'SHOP_GEOWIDGET_PUBLIC_TOKEN'],
    ])('refuses a payment key value in %s without printing it', async (_case, company, name) => {
      for (const key of ['rk_live_private-fixture', 'sk_test_private-fixture']) {
        const fake = integrationFake();
        const input = { ...manifest, company: { integrations: company } };
        const result = await applyManifest(input, () => fake.api, undefined, { integrations: true, environment: { ...environment, [name]: key } });
        expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('stripe.restrictedKeyEnv'), details: { applied: [] } } });
        expect(JSON.stringify(result)).not.toContain(key);
        expect(fake.api.shipxConfigure).not.toHaveBeenCalled();
        expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
      }
    });

    const sender = { company: null, email: 'shipping@togethercommunity.app', phone: '123456789', street: 'Example Street', buildingNumber: '1', city: 'Example City', postCode: '00-001' };
    it.each([
      ['an inline settings value', { company: { settings: { inpostGeowidgetToken: 'rk_live_private-fixture' } } }, ['company', 'settings', 'inpostGeowidgetToken']],
      ['a carrier sender field', { company: { integrations: { shipx: { sender: { ...sender, name: 'rk_test_private-fixture' } } } } }, ['company', 'integrations', 'shipx', 'sender', 'name']],
      ['a product description', { company: undefined, shops: [{ workspace: 'acme', products: [{ slug: 'paperback', title: 'Paperback', description: 'Key sk_live_private-fixture', price: { amountCents: 100, currency: 'PLN' }, published: false }] }] }, ['shops', 0, 'products', 0, 'description']],
    ])('refuses a payment key shape in %s of the manifest without printing it', async (_case, override, path) => {
      const input = { ...manifest, ...override };
      const parsed = shopManifestSchema.safeParse(input);
      expect(parsed.error?.issues).toContainEqual(expect.objectContaining({ path, message: 'A Stripe secret or restricted key may be supplied only through stripe.restrictedKeyEnv' }));
      const fake = integrationFake();
      const result = await planManifest(input, () => fake.api);
      expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(JSON.stringify(result)).not.toContain('private-fixture');
      expect(fake.state.requests).toEqual([]);
    });

    it('refuses to publish a secret through the parcel-locker token, including across company and shop merges', async () => {
      const published = vi.fn();
      for (const input of [
        { ...manifest, company: { integrations: { stripe: integrations.stripe, parcelLocker: { tokenEnv: 'SHOP_STRIPE_KEY' } } } },
        { ...manifest, company: { integrations: { parcelLocker: { tokenEnv: SHOP_OPERATOR_SECRET_ENV } } } },
        { ...manifest, company: { integrations: { shipx: { tokenEnv: 'SHOP_GEOWIDGET_PUBLIC_TOKEN' } } }, shops: [{ workspace: 'acme', integrations: { parcelLocker: { tokenEnv: 'SHOP_GEOWIDGET_PUBLIC_TOKEN' } }, products: [] }] },
        { ...manifest, company: { integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_LIVE_KEY', mode: 'live' } } }, shops: [{ workspace: 'acme', integrations: { shipx: { tokenEnv: 'SHOP_STRIPE_LIVE_KEY' } }, products: [] }] },
      ]) {
        const fake = integrationFake();
        fake.api.updateTenantSettings = published;
        const secrets = { ...environment, SHOP_STRIPE_LIVE_KEY: 'rk_live_private-fixture', [SHOP_OPERATOR_SECRET_ENV]: 'operator-private-fixture' };
        const result = await applyManifest(input, () => fake.api, undefined, { integrations: true, environment: secrets });
        expect(result).toMatchObject({ ok: false, error: { code: 'validation', details: { applied: [] } } });
        expect(fake.state.requests).toEqual([]);
        for (const value of Object.values(secrets)) expect(JSON.stringify(result)).not.toContain(value);
      }
      expect(published).not.toHaveBeenCalled();
    });

    it.each([
      ['the carrier token', { SHOP_GEOWIDGET_PUBLIC_TOKEN: ` ${environment.SHOP_SHIPX_TOKEN}\n` }],
      ['the carrier organization id', { SHOP_GEOWIDGET_PUBLIC_TOKEN: environment.SHOP_SHIPX_ORGANIZATION, SHOP_SHIPX_ORGANIZATION: ` ${environment.SHOP_SHIPX_ORGANIZATION}` }],
    ])('refuses a public parcel-locker token equal to %s without printing it', async (_case, override) => {
      const fake = integrationFake();
      const result = await applyManifest(manifest, () => fake.api, undefined, { integrations: true, environment: { ...environment, ...override } });
      expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('parcel-locker public token must differ'), details: { applied: [] } } });
      expect(fake.api.configureStripe).not.toHaveBeenCalled();
      expect(fake.api.shipxConfigure).not.toHaveBeenCalled();
      expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
      expectNoSecrets(result);
    });

    it('checks references again before resolving values', () => {
      const unchecked = { parcelLocker: { tokenEnv: 'SHOP_STRIPE_KEY' }, stripe: integrations.stripe };
      const result = resolveManifestIntegrations(unchecked, environment);
      expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(JSON.stringify(result)).not.toContain(environment.SHOP_STRIPE_KEY);
    });
  });
});
