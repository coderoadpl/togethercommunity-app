import { describe, expect, it } from 'vitest';

import { marketingSesSettingsUpdateInputSchema } from './routes.js';

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
});
