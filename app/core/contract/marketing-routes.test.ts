import { describe, expect, it } from 'vitest';

import {
  integrationTestInputSchema,
  marketingConsentDefinitionCreateInputSchema,
  marketingConsentDefinitionUpdateInputSchema,
  marketingSesSettingsUpdateInputSchema,
} from './routes.js';

describe('marketing route contracts', () => {
  it('does not accept caller-owned SES identity verification state', () => {
    const parsed = marketingSesSettingsUpdateInputSchema.parse({
      fromAddress: 'news@tenant.test',
      fromName: 'Tenant',
      identity: 'tenant.test',
      identityVerified: true,
      configurationSet: null,
      snsTopicArn: null,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      footerLegalName: '',
      footerAddress: '',
    });

    expect(parsed).not.toHaveProperty('identityVerified');
  });

  it('accepts email transports only for email provider diagnostics', () => {
    expect(integrationTestInputSchema.safeParse({ provider: 'email', emailTransport: 'resend' }).success).toBe(true);
    expect(integrationTestInputSchema.safeParse({ provider: 'storage', emailTransport: 'smtp' }).success).toBe(false);
    expect(integrationTestInputSchema.safeParse({ provider: 'payment', emailTransport: 'ses' }).success).toBe(false);
  });

  it('accepts a trimmed nullable footer label on consent definition writes', () => {
    const create = marketingConsentDefinitionCreateInputSchema.parse({
      key: 'product-news',
      label: 'Send me product news',
      footerLabel: '  Product news  ',
      documentRef: { mode: 'url', url: 'https://tenant.test/legal' },
    });
    expect(create.footerLabel).toBe('Product news');
    expect(marketingConsentDefinitionUpdateInputSchema.parse({
      definitionId: 'definition-1',
      label: 'Send me product news',
      doubleOptIn: true,
      footerLabel: null,
      documentRef: { mode: 'url', url: 'https://tenant.test/legal' },
      status: 'active',
    }).footerLabel).toBeNull();
    expect(marketingConsentDefinitionCreateInputSchema.safeParse({
      ...create,
      footerLabel: 'x'.repeat(201),
    }).success).toBe(false);
  });
});
