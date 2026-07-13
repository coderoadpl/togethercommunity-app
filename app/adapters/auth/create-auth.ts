import { randomUUID } from 'node:crypto';

import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, magicLink, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';

import { magicLink as magicLinkTemplate, normalizeEmail } from '@core/domain/index.js';
import type { AuthPort, EmailPort } from '@core/server/index.js';
import { verifyPasswordWithLegacyFallback } from '@adapters/auth/legacy-password.js';
import type { Db } from '@adapters/db/client.js';
import { devMagicLinks, user } from '@adapters/db/schema.js';

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

interface MagicLinkDeliveryContext {
  tenantName: string;
  language: string;
  /** 'email' sends a magic-link email; 'capture' returns the URL without sending. */
  mode: 'email' | 'capture';
}

export const createAuth = (db: Db, settings: AuthSettings) => {
  const deliveryContexts = new Map<string, MagicLinkDeliveryContext>();
  const capturedLinks = new Map<string, { url: string; token: string }>();

  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: settings.secret,
    baseURL: settings.baseUrl,
    trustedOrigins: settings.trustedOrigins,
    emailAndPassword: { enabled: true, password: { verify: verifyPasswordWithLegacyFallback } },
    ...(settings.google
      ? { socialProviders: { google: settings.google } }
      : {}),
    plugins: [
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, url, token }) => {
          const normalizedEmail = normalizeEmail(email);
          const context = deliveryContexts.get(normalizedEmail) ?? {
            tenantName: settings.defaultTenantName,
            language: 'pl',
            mode: 'email' as const,
          };
          deliveryContexts.delete(normalizedEmail);
          if (context.mode === 'capture') {
            capturedLinks.set(normalizedEmail, { url, token });
          } else {
            const message = magicLinkTemplate(context.language, { tenantName: context.tenantName, url });
            const sent = await settings.email.send({ to: normalizedEmail, ...message });
            if (!sent.ok) throw new Error(sent.error.message);
          }
          if (settings.exposeMagicLinks) {
            await db
              .insert(devMagicLinks)
              .values({ email: normalizedEmail, url, token, createdAt: new Date().toISOString() })
              .onConflictDoUpdate({
                target: devMagicLinks.email,
                set: { url, token, createdAt: new Date().toISOString() },
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
 * ensureUser inserts a passwordless provider user directly via drizzle — the
 * installed better-auth server API has no first-class passwordless-create, and
 * the embedded topology owns its provider tables.
 */
export const createAuthPort = (auth: Auth, db: Db): AuthPort => ({
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
    const existing = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);
    const found = existing[0];
    if (found) return { userId: found.id, created: false };

    const id = randomUUID();
    const now = new Date();
    const inserted = await db
      .insert(user)
      .values({
        id,
        name: nameFromEmail(normalizedEmail),
        email: normalizedEmail,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: user.email })
      .returning({ userId: user.id });
    const insertedUser = inserted[0];
    if (insertedUser) return { userId: insertedUser.userId, created: true };

    const afterConflict = await db.select({ id: user.id }).from(user).where(eq(user.email, normalizedEmail)).limit(1);
    const existingAfterConflict = afterConflict[0];
    if (!existingAfterConflict) throw new Error('User create/read failed after email conflict');
    return { userId: existingAfterConflict.id, created: false };
  },
  requestMagicLink: async ({ email, callbackURL, tenantName, language }) => {
    const normalizedEmail = normalizeEmail(email);
    auth.setMagicLinkDeliveryContext(normalizedEmail, {
      tenantName: tenantName ?? 'Together',
      language: language ?? 'pl',
      mode: 'email',
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
