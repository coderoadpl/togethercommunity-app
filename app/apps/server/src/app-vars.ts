import type { AppError, Identity, ImpersonationPrincipal } from '#core/domain/index.js';
import type { AuthenticatedUser } from '#core/server/index.js';

import type { ApiKeyAttribution } from './telemetry.js';

type ImpersonationCookieOperation = { kind: 'set'; token: string } | { kind: 'clear' };

export type AppVars = {
  Variables: {
    identity: Identity;
    actorAuth?: { user: AuthenticatedUser; identity: Identity };
    impersonation?: ImpersonationPrincipal;
    apiKeyAttribution?: ApiKeyAttribution;
    impersonationIdentity?: Identity;
    impersonationCookie?: ImpersonationCookieOperation;
    sessionId?: string;
    secureHeadersNonce?: string;
    signupRedirectOrigin?: string;
    signupRateLimit?: AppError;
    tenantRedirectHit?: { tenantId: string; redirectId: string };
  };
};
