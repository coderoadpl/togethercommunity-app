import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, magicLink, twoFactor } from 'better-auth/plugins';

import {
  magicLink as magicLinkTemplate,
  normalizeEmail,
  resetPassword as resetPasswordTemplate,
} from '@core/domain/index.js';
import type { AuthPort, EmailPort } from '@core/server/index.js';
import { verifyPasswordWithLegacyFallback } from '@adapters/auth/legacy-password.js';
import type { Db } from '@adapters/db/client.js';
import { devMagicLinks } from '@adapters/db/schema.js';

export interface AuthSettings {
  secret: string;
  /** Public URL of the API, e.g. http://localhost:48730 */
  baseUrl: string;
  /** Cookie domain root so sessions survive tenant subdomains, e.g. "localhost". */
  baseDomain: string;
  trustedOrigins: string[] | ((request?: Request) => string[] | Promise<string[]>);
  secureCookies: boolean;
  /** Dev-only: persist issued magic links into dev_magic_links (no mailer in the PoC). */
  exposeMagicLinks: boolean;
  email: EmailPort;
  defaultTenantName: string;
  /** Google OAuth credentials; the provider is wired only when both are present. */
  google: { clientId: string; clientSecret: string } | null;
}

export const BETTER_AUTH_API_PATH_PATTERN = '/api/auth/*';

export const BETTER_AUTH_MAGIC_LINK_PATH = '/api/auth/sign-in/magic-link';

export const BETTER_AUTH_PASSWORD_RESET_PATH = '/api/auth/request-password-reset';

export interface MagicLinkDeliveryContext {
  tenantName?: string;
  language: string;
  /** 'email' sends a magic-link email; 'capture' returns the URL without sending. */
  mode: 'email' | 'capture';
  /** Host-derived base URL: the verify link is rebased onto this so it lands on the requesting domain. */
  baseUrl?: string;
}

const rebaseUrl = (rawUrl: string, base: string): string => {
  try {
    const target = new URL(base);
    const rebased = new URL(rawUrl);
    rebased.protocol = target.protocol;
    rebased.host = target.host;
    return rebased.toString();
  } catch {
    return rawUrl;
  }
};

export interface ResetPasswordDeliveryContext {
  language: string;
  /** Host-derived base URL: the reset page link is built on this so it lands on the requesting domain. */
  baseUrl?: string;
}

export const createAuth = (db: Db, settings: AuthSettings) => {
  const deliveryContexts = new Map<string, MagicLinkDeliveryContext>();
  const resetPasswordContexts = new Map<string, ResetPasswordDeliveryContext>();
  const capturedLinks = new Map<string, { url: string; token: string }>();

  const resetPasswordUrl = (base: string, token: string): string => {
    const url = new URL('/reset-password', base);
    url.searchParams.set('token', token);
    return url.toString();
  };

  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: settings.secret,
    baseURL: settings.baseUrl,
    trustedOrigins: settings.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      password: { verify: verifyPasswordWithLegacyFallback },
      sendResetPassword: async ({ user, token }) => {
        const normalizedEmail = normalizeEmail(user.email);
        const context = resetPasswordContexts.get(normalizedEmail) ?? { language: 'pl' };
        resetPasswordContexts.delete(normalizedEmail);
        const actionUrl = resetPasswordUrl(context.baseUrl ?? settings.baseUrl, token);
        const message = resetPasswordTemplate(context.language, { actionUrl });
        const sent = await settings.email.send({ to: normalizedEmail, ...message });
        if (!sent.ok) throw new Error(sent.error.message);
      },
    },
    ...(settings.google
      ? { socialProviders: { google: settings.google } }
      : {}),
    plugins: [
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, url, token }) => {
          const normalizedEmail = normalizeEmail(email);
          const context = deliveryContexts.get(normalizedEmail) ?? {
            language: 'pl',
            mode: 'email' as const,
          };
          deliveryContexts.delete(normalizedEmail);
          const tenantName = context.tenantName ?? settings.defaultTenantName;
          const deliveredUrl = context.baseUrl ? rebaseUrl(url, context.baseUrl) : url;
          if (context.mode === 'capture') {
            capturedLinks.set(normalizedEmail, { url: deliveredUrl, token });
          } else {
            const message = magicLinkTemplate(context.language, { tenantName, url: deliveredUrl });
            const sent = await settings.email.send({ to: normalizedEmail, ...message });
            if (!sent.ok) throw new Error(sent.error.message);
          }
          if (settings.exposeMagicLinks) {
            await db
              .insert(devMagicLinks)
              .values({ email: normalizedEmail, url: deliveredUrl, token, createdAt: new Date().toISOString() })
              .onConflictDoUpdate({
                target: devMagicLinks.email,
                set: { url: deliveredUrl, token, createdAt: new Date().toISOString() },
              });
          }
        },
      }),
      passkey(),
      twoFactor(),
    ],
    advanced: {
      useSecureCookies: settings.secureCookies,
      // Browsers reject Domain=.localhost cookies, so sessions are per-subdomain
      // in local dev; on a real base domain they span all tenant subdomains.
      ...(settings.baseDomain === 'localhost'
        ? {}
        : { crossSubDomainCookies: { enabled: true, domain: `.${settings.baseDomain}` } }),
    },
  });
  return {
    ...auth,
    setMagicLinkDeliveryContext: (email: string, context: MagicLinkDeliveryContext) => {
      deliveryContexts.set(normalizeEmail(email), context);
    },
    setResetPasswordDeliveryContext: (email: string, context: ResetPasswordDeliveryContext) => {
      resetPasswordContexts.set(normalizeEmail(email), context);
    },
    consumeCapturedMagicLink: (email: string) => {
      const normalizedEmail = normalizeEmail(email);
      const captured = capturedLinks.get(normalizedEmail) ?? null;
      capturedLinks.delete(normalizedEmail);
      return captured;
    },
  };
};

export type Auth = ReturnType<typeof createAuth>;

const nameFromEmail = (email: string): string => email.split('@')[0] ?? email;

/**
 * AuthPort implementation: the only place the core's identity touches Better Auth.
 * ensureUser provisions a passwordless account through Better Auth's own
 * `internalAdapter` (reached via `auth.$context`) instead of a hand-rolled
 * insert — the adapter owns id generation, field mapping and creation hooks, so
 * this stays correct if Better Auth reshapes the user model. The credential
 * account (and thus a password) is only ever created on real sign-up/import;
 * these accounts sign in via magic link or passkey.
 */
export const createAuthPort = (auth: Auth): AuthPort => ({
  getAuthenticatedUser: async (requestHeaders) => {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  },
  ensureUser: async (email) => {
    const normalizedEmail = normalizeEmail(email);
    const { internalAdapter } = await auth.$context;
    const existing = await internalAdapter.findUserByEmail(normalizedEmail);
    if (existing) return { userId: existing.user.id, created: false };

    try {
      const created = await internalAdapter.createUser({
        name: nameFromEmail(normalizedEmail),
        email: normalizedEmail,
        emailVerified: true,
      });
      return { userId: created.id, created: true };
    } catch (cause) {
      // A concurrent ensureUser may have won the unique-email race; re-read.
      const afterConflict = await internalAdapter.findUserByEmail(normalizedEmail);
      if (!afterConflict) throw cause;
      return { userId: afterConflict.user.id, created: false };
    }
  },
  requestMagicLink: async ({ email, callbackURL, tenantName, language, baseUrl }) => {
    const normalizedEmail = normalizeEmail(email);
    auth.setMagicLinkDeliveryContext(normalizedEmail, {
      tenantName: tenantName ?? 'Together',
      language: language ?? 'pl',
      mode: 'email',
      ...(baseUrl ? { baseUrl } : {}),
    });
    await auth.api.signInMagicLink({
      body: { email: normalizedEmail, callbackURL },
      headers: new Headers(),
    });
  },
  createEnrollmentMagicLink: async ({ email, callbackURL, tenantName, language }) => {
    const normalizedEmail = normalizeEmail(email);
    auth.setMagicLinkDeliveryContext(normalizedEmail, { tenantName, language, mode: 'capture' });
    await auth.api.signInMagicLink({
      body: { email: normalizedEmail, callbackURL },
      headers: new Headers(),
    });
    const captured = auth.consumeCapturedMagicLink(normalizedEmail);
    if (!captured) throw new Error('Magic-link generation did not capture a URL');
    return { url: captured.url };
  },
});
