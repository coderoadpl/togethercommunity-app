import type { Identity, ImpersonationPrincipal } from '#core/domain/index.js';
import type { AuthenticatedUser } from '#core/server/index.js';

type ImpersonationCookieOperation = { kind: 'set'; token: string } | { kind: 'clear' };

export type AppVars = {
  Variables: {
    identity: Identity;
    actorAuth?: { user: AuthenticatedUser; identity: Identity };
    impersonation?: ImpersonationPrincipal;
    impersonationIdentity?: Identity;
    impersonationCookie?: ImpersonationCookieOperation;
    sessionId?: string;
    secureHeadersNonce?: string;
  };
};
