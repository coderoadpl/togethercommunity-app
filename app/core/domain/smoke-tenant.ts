/**
 * Production carries one permanent synthetic tenant so the post-deploy smoke can
 * assert on known content. It is the seed's `acme` fixture — the same rows local
 * development and the e2e suites get — except for the password source, because
 * production must never store the shared demo password.
 */
export const SMOKE_TENANT_ID = 'tenant-acme';
export const SMOKE_TENANT_SLUG = 'acme';
export const SMOKE_TENANT_MEMBER_EMAIL = 'kontakt+smoke-member@togethercommunity.app';
export const SMOKE_TENANT_CREATOR_EMAIL = 'kontakt+smoke-creator@togethercommunity.app';
export const SMOKE_TENANT_COURSE_TITLE = 'Acme Course';

/** Every other seeded account lives on this domain; a real tenant never would. */
const SEED_ACCOUNT_EMAIL_DOMAIN = '@together.dev';

const SMOKE_ACCOUNT_EMAILS: readonly string[] = [
  SMOKE_TENANT_MEMBER_EMAIL,
  SMOKE_TENANT_CREATOR_EMAIL,
];

export const isSmokeTenant = (tenantId: string): boolean => tenantId === SMOKE_TENANT_ID;

export interface SmokeTenantPasswords {
  member: string;
  creator: string;
}

export type SmokeTenantPasswordResolution =
  | { ok: true; passwords: SmokeTenantPasswords }
  | { ok: false; reason: string };

type SinglePasswordResolution =
  | { ok: true; password: string }
  | { ok: false; reason: string };

const resolvePassword = (
  variable: string,
  input: { production: boolean; demoPassword: string; configured: string | undefined },
): SinglePasswordResolution => {
  const configured = input.configured?.trim() ?? '';
  if (!input.production) {
    return { ok: true, password: configured === '' ? input.demoPassword : configured };
  }
  if (configured === '') {
    return { ok: false, reason: `${variable} is required to seed the smoke tenant on production` };
  }
  if (configured === input.demoPassword) {
    return { ok: false, reason: `${variable} must not be the shared demo password` };
  }
  return { ok: true, password: configured };
};

export const resolveSmokeTenantPasswords = (input: {
  production: boolean;
  demoPassword: string;
  configured: { member: string | undefined; creator: string | undefined };
}): SmokeTenantPasswordResolution => {
  const member = resolvePassword('SMOKE_MEMBER_PASSWORD', {
    production: input.production,
    demoPassword: input.demoPassword,
    configured: input.configured.member,
  });
  if (!member.ok) return member;
  const creator = resolvePassword('SMOKE_CREATOR_PASSWORD', {
    production: input.production,
    demoPassword: input.demoPassword,
    configured: input.configured.creator,
  });
  if (!creator.ok) return creator;
  return { ok: true, passwords: { member: member.password, creator: creator.password } };
};

export interface SmokeTenantReseedSubject {
  tenant: { id: string; slug: string } | null;
  memberEmails: readonly string[];
  /**
   * The tenant's public surfaces (newsletter sign-up, checkout) leave rows that
   * carry no member, and the wipe would erase them along with their consent
   * evidence.
   */
  consentEmails: readonly string[];
}

const foreignEmail = (emails: readonly string[]): string | undefined =>
  emails.find((email) => {
    const normalized = email.trim().toLowerCase();
    return !normalized.endsWith(SEED_ACCOUNT_EMAIL_DOMAIN)
      && !SMOKE_ACCOUNT_EMAILS.includes(normalized);
  });

const outsideSeededAccounts = `outside ${SEED_ACCOUNT_EMAIL_DOMAIN} and the smoke accounts`;

export const smokeTenantReseedRefusal = (subject: SmokeTenantReseedSubject): string | null => {
  if (subject.tenant !== null && subject.tenant.slug !== SMOKE_TENANT_SLUG) {
    return `${SMOKE_TENANT_ID} carries slug "${subject.tenant.slug}" instead of "${SMOKE_TENANT_SLUG}"`;
  }
  if (foreignEmail(subject.memberEmails) !== undefined) {
    return `${SMOKE_TENANT_ID} has a member ${outsideSeededAccounts}`;
  }
  if (foreignEmail(subject.consentEmails) !== undefined) {
    return `${SMOKE_TENANT_ID} holds a marketing consent ${outsideSeededAccounts}`;
  }
  return null;
};

/** Separates a safety refusal from an infrastructure failure for the caller. */
export class SmokeTenantReseedRefused extends Error {}
