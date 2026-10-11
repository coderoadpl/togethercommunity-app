import { describe, expect, it } from 'vitest';

import { checkoutAppearanceSchema, resolveCheckoutBranding } from './checkout-appearance.js';
import { updateTenantSettingsInputSchema } from './tenant.js';

const settings = {
  name: 'Studio', logoUrl: '/api/public/assets/logo/logo.png',
  faviconUrl: 'https://cdn.example.test/icon.png', accentColor: '#123456',
};

describe('checkout appearance', () => {
  it('falls back to tenant branding with absolute HTTPS asset URLs', () => {
    expect(resolveCheckoutBranding(settings, 'https://studio.example.test')).toEqual({
      displayName: 'Studio', logoUrl: 'https://studio.example.test/api/public/assets/logo/logo.png',
      iconUrl: 'https://cdn.example.test/icon.png', buttonColor: '#123456',
    });
  });

  it('prefers every explicit checkout setting over tenant branding', () => {
    const checkoutAppearance = {
      displayName: 'Checkout', logoUrl: 'https://cdn.example.test/checkout.png',
      iconUrl: 'https://cdn.example.test/checkout-icon.png', backgroundColor: '#FFFFFF',
      buttonColor: '#654321', fontFamily: 'inter' as const, borderStyle: 'pill' as const,
    };
    expect(resolveCheckoutBranding({ ...settings, checkoutAppearance }, 'https://studio.example.test'))
      .toEqual(checkoutAppearance);
  });

  it('restores fallback values for cleared fields and omits completely empty branding', () => {
    const checkoutAppearance = checkoutAppearanceSchema.parse({ displayName: '', logoUrl: '', buttonColor: null });
    expect(resolveCheckoutBranding({ ...settings, checkoutAppearance }, 'https://studio.example.test'))
      .toMatchObject({ displayName: 'Studio', buttonColor: '#123456' });
    expect(resolveCheckoutBranding({ name: '', logoUrl: null, faviconUrl: null, accentColor: null }, 'https://studio.example.test'))
      .toBeUndefined();
  });

  it('omits non-HTTPS fallback assets', () => {
    expect(resolveCheckoutBranding({ ...settings, faviconUrl: 'http://cdn.example.test/icon.png' }, 'http://localhost:48730'))
      .toEqual({ displayName: 'Studio', buttonColor: '#123456' });
  });

  it.each([
    { logoUrl: 'http://cdn.example.test/logo.png' }, { iconUrl: '/icon.png' },
    { logoUrl: 'javascript:alert(1)' }, { backgroundColor: '#FFF' }, { buttonColor: 'red' },
    { fontFamily: 'serif' }, { borderStyle: 'square' },
  ])('rejects invalid appearance %j at the settings boundary', (checkoutAppearance) => {
    expect(updateTenantSettingsInputSchema.safeParse({ checkoutAppearance }).success).toBe(false);
  });

  it('accepts HTTPS URLs, full hex colours and supported font and corner values', () => {
    expect(updateTenantSettingsInputSchema.parse({ checkoutAppearance: {
      logoUrl: 'https://cdn.example.test/logo.png', iconUrl: 'https://cdn.example.test/icon.png',
      backgroundColor: '#aAbBcC', buttonColor: '#123456', fontFamily: 'default', borderStyle: 'rounded',
    } }).checkoutAppearance).toMatchObject({ backgroundColor: '#aAbBcC', fontFamily: 'default' });
  });
});
