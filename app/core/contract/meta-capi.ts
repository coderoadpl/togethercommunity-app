export { metaCapiStateSchema, metaCapiDecisionSchema, metaCapiWithdrawSchema, metaCapiEventsOutputSchema, metaCapiConsentsOutputSchema } from '#core/domain/meta-capi.js';
export type { MetaCapiDecisionInput } from '#core/domain/meta-capi.js';

export const META_CAPI_ROUTES = {
  publicMetaCapiConsent: { method: 'POST', path: '/api/public/meta-capi/consent' },
  metaCapiEvents: { method: 'GET', path: '/api/meta-capi/events' },
  metaCapiConsents: { method: 'GET', path: '/api/me/meta-capi/consents' },
  withdrawMetaCapiConsent: { method: 'POST', path: '/api/me/meta-capi/withdraw' },
} as const;
