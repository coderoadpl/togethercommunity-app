import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { bearer, magicLink, twoFactor } from 'better-auth/plugins';
import { z } from 'zod';

import {
  normalizeEmail,
  type AppError,
  type EmailBranding,
  type Result,
} from '@core/domain/index.js';
import type { AuthPort, Clock, EmailOutboxRepository, IdGenerator } from '@core/server/index.js';
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
  emailOutbox: EmailOutboxRepository;
  ids: IdGenerator;
  clock: Clock;
  dispatchEmail(): void;
  defaultTenantName: string;
  /** Google OAuth credentials; the provider is wired only when both are present. */
  google: { clientId: string; clientSecret: string } | null;
  validateSignUpConsent?(input: {
    request: Request;
    accepted: boolean | undefined;
  }): Promise<Result<{ required: boolean }, AppError>>;
  recordSignUpConsent?(input: {
    request: Request;
    email: string;
  }): Promise<Result<{ recorded: boolean }, AppError>>;
}

export const BETTER_AUTH_API_PATH_PATTERN = '/api/auth/*';

export const BETTER_AUTH_MAGIC_LINK_PATH = '/api/auth/sign-in/magic-link';

export const BETTER_AUTH_PASSWORD_RESET_PATH = '/api/auth/request-password-reset';

const signUpConsentSchema = z.object({
  email: z.string().email(),
  termsAccepted: z.boolean().optional(),
});

const signUpEmailSchema = z.object({ email: z.string().email() });

const successfulSignUpSchema = z.object({
  user: z.object({ email: z.string().email() }),
});

const throwConsentError = (error: AppError): never => {
  throw APIError.from('BAD_REQUEST', {
    code: error.code,
    message: error.message,
  });
};

export interface MagicLinkDeliveryContext {
  tenantName?: string;
  language: string;
  /** 'email' sends a magic-link email; 'capture' returns the URL without sending. */
  mode: 'email' | 'capture';
  /** Host-derived base URL: the verify link is rebased onto this so it lands on the requesting domain. */
  baseUrl?: string;
  branding?: EmailBranding;
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
    rateLimit: {
      enabled: true,
      // The e-mail-sending endpoints carry the anti-bombing throttle (S3). The other
      // entries relax the tighter limits Better-Auth applies by default once rate
      // limiting is on, so token verification and password sign-in stay usable.
      customRules: {
        '/sign-in/magic-link': { window: 60, max: 20 },
        '/request-password-reset': { window: 60, max: 20 },
        '/magic-link/verify': { window: 60, max: 20 },
        '/sign-in/email': { window: 60, max: 20 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        if (settings.validateSignUpConsent === undefined) return;
        const email = signUpEmailSchema.safeParse(ctx.body);
        if (!email.success) return;
        const parsed = signUpConsentSchema.safeParse(ctx.body);
        const request = ctx.request ?? new Request(settings.baseUrl);
        const consent = await settings.validateSignUpConsent({
          request,
          accepted: parsed.success ? parsed.data.termsAccepted : undefined,
        });
        if (!consent.ok) throwConsentError(consent.error);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        if (settings.recordSignUpConsent === undefined) return;
        if (!successfulSignUpSchema.safeParse(ctx.context.returned).success) return;
        const parsed = signUpConsentSchema.safeParse(ctx.body);
        if (!parsed.success || parsed.data.termsAccepted !== true) return;
        const request = ctx.request ?? new Request(settings.baseUrl);
        const consent = await settings.recordSignUpConsent({ request, email: parsed.data.email });
        if (!consent.ok) throwConsentError(consent.error);
      }),
    },
    emailAndPassword: {
      enabled: true,
      password: { verify: verifyPasswordWithLegacyFallback },
      sendResetPassword: async ({ user, token }) => {
        const normalizedEmail = normalizeEmail(user.email);
        const context = resetPasswordContexts.get(normalizedEmail) ?? { language: 'pl' };
        resetPasswordContexts.delete(normalizedEmail);
        const actionUrl = resetPasswordUrl(context.baseUrl ?? settings.baseUrl, token);
        const queued = await settings.emailOutbox.enqueue({
          id: settings.ids.nextId(),
          tenantId: null,
          to: normalizedEmail,
          payload: { kind: 'reset-password', language: context.language, actionUrl },
          now: settings.clock.nowIso(),
        });
        if (!queued.ok) throw new Error(queued.error.message);
        settings.dispatchEmail();
      },
    },
    ...(settings.google
      ? { socialProviders: { google: settings.google } }
      : {}),
    plugins: [
      bearer(),
      // Magic-link auto-signup intentionally defers consent until first checkout because enrollment and login share this path.
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
            const queued = await settings.emailOutbox.enqueue({
              id: settings.ids.nextId(),
              tenantId: null,
              to: normalizedEmail,
              payload: {
                kind: 'magic-link',
                language: context.language,
                tenantName,
                url: deliveredUrl,
                ...(context.branding === undefined ? {} : { branding: context.branding }),
              },
              now: settings.clock.nowIso(),
            });
            if (!queued.ok) throw new Error(queued.error.message);
            settings.dispatchEmail();
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
  requestMagicLink: async ({ email, callbackURL, tenantName, language, baseUrl, branding }) => {
    const normalizedEmail = normalizeEmail(email);
    auth.setMagicLinkDeliveryContext(normalizedEmail, {
      tenantName: tenantName ?? 'Together',
      language: language ?? 'pl',
      mode: 'email',
      ...(baseUrl ? { baseUrl } : {}),
      ...(branding === undefined ? {} : { branding }),
    });
    await auth.api.signInMagicLink({
      body: { email: normalizedEmail, callbackURL },
      headers: new Headers(),
    });
  },
  createEnrollmentMagicLink: async ({ email, callbackURL, baseUrl, tenantName, language }) => {
    const normalizedEmail = normalizeEmail(email);
    auth.setMagicLinkDeliveryContext(normalizedEmail, {
      tenantName,
      language,
      mode: 'capture',
      baseUrl,
    });
    await auth.api.signInMagicLink({
      body: { email: normalizedEmail, callbackURL },
      headers: new Headers(),
    });
    const captured = auth.consumeCapturedMagicLink(normalizedEmail);
    if (!captured) throw new Error('Magic-link generation did not capture a URL');
    return { url: captured.url };
  },
});
