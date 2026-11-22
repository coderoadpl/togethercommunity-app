import { metaCapiDefaultCopy } from '#core/domain/meta-capi-copy.en.js';

export const metaCapiConfig = {
  enabled: true,
  locale: 'en' as const,
  consent: 'undecided' as const,
  withdrawnAt: null,
  textVersion: 'a'.repeat(64),
  ...metaCapiDefaultCopy,
  privacyUrl: 'https://example.org/privacy',
};
