import { context, trace } from '@opentelemetry/api';

import { createBetterAuthClientAdapter } from '@adapters/auth/client-adapter.js';
import {
  authConfigQuery,
  createApiClient,
  createTenantMutation,
  devMagicLinkQuery,
  createProductMutation,
  enableTwoFactorMutation,
  meQuery,
  membersQuery,
  membersExportQuery,
  myProductsInvalidates,
  myProductsQuery,
  productsInvalidates,
  publicOfferQuery,
  productsQuery,
  publishProductMutation,
  registerPasskeyMutation,
  requestMagicLinkMutation,
  signInMutation,
  signInWithGoogleMutation,
  signInWithPasskeyMutation,
  signOutMutation,
  signUpMutation,
  simulatePurchaseMutation,
  tenantsQuery,
  verifyTotpMutation,
} from '@core/client/index.js';
import type { MemberExportFormat } from '@core/domain/index.js';

/**
 * W3C `traceparent` for the active span, formatted from the OTel facade so FE→BE
 * trace unification is a one-place binding here. Absent (clean no-op) whenever
 * no tracing context is active — the SDK-free default on both deploy targets.
 */
const traceparent = (): string | undefined => {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext) return undefined;
  const flags = spanContext.traceFlags.toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
};

/** Same-origin: the SPA is always served from the tenant's own domain. */
const apiClient = createApiClient({ baseUrl: '', traceparent });
const authClient = createBetterAuthClientAdapter('');

/**
 * The one binding site. Core/client action factories are bound to their
 * transport (ApiClient, AuthClientPort) exactly once here; features import
 * these ready actions and never see a client, a port or an adapter.
 */
export const actions = {
  me: meQuery(apiClient),
  publicOffer: publicOfferQuery(apiClient),
  authConfig: authConfigQuery(apiClient),
  tenants: tenantsQuery(apiClient),
  createTenant: createTenantMutation(apiClient),
  products: productsQuery(apiClient),
  createProduct: createProductMutation(apiClient),
  publishProduct: publishProductMutation(apiClient),
  productsInvalidates,
  myProducts: myProductsQuery(apiClient),
  members: membersQuery(apiClient),
  membersExport: (format: MemberExportFormat) => membersExportQuery(apiClient, format),
  simulatePurchase: simulatePurchaseMutation(apiClient),
  myProductsInvalidates,
  signUp: signUpMutation(authClient),
  signIn: signInMutation(authClient),
  requestMagicLink: requestMagicLinkMutation(authClient),
  devMagicLink: (email: string) => devMagicLinkQuery(apiClient, email),
  signOut: signOutMutation(authClient),
  registerPasskey: registerPasskeyMutation(authClient),
  signInWithPasskey: signInWithPasskeyMutation(authClient),
  enableTwoFactor: enableTwoFactorMutation(authClient),
  verifyTotp: verifyTotpMutation(authClient),
  signInWithGoogle: signInWithGoogleMutation(authClient),
};
