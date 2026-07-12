import { randomUUID } from 'node:crypto';

import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, magicLink, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';

import type { AuthPort } from '@core/server/index.js';
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
  /** Google OAuth credentials; the provider is wired only when both are present. */
  google: { clientId: string; clientSecret: string } | null;
}

export const BETTER_AUTH_API_PATH_PATTERN = '/api/auth/*';

export const createAuth = (db: Db, settings: AuthSettings) =>
  betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: settings.secret,
    baseURL: settings.baseUrl,
    trustedOrigins: settings.trustedOrigins,
    emailAndPassword: { enabled: true },
    ...(settings.google
      ? { socialProviders: { google: settings.google } }
      : {}),
    plugins: [
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, url, token }) => {
          if (!settings.exposeMagicLinks) return;
          await db
            .insert(devMagicLinks)
            .values({ email, url, token, createdAt: new Date().toISOString() })
            .onConflictDoUpdate({
              target: devMagicLinks.email,
              set: { url, token, createdAt: new Date().toISOString() },
            });
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
    const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
    const found = existing[0];
    if (found) return { userId: found.id, created: false };

    const id = randomUUID();
    const now = new Date();
    await db.insert(user).values({
      id,
      name: nameFromEmail(email),
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return { userId: id, created: true };
  },
  requestMagicLink: async ({ email, callbackURL }) => {
    await auth.api.signInMagicLink({
      body: { email, callbackURL },
      headers: new Headers(),
    });
  },
});
