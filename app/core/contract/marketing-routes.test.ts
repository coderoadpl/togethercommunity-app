import { describe, expect, it } from 'vitest';

import { integrationTestInputSchema, marketingSesSettingsUpdateInputSchema } from './routes.js';

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
});
