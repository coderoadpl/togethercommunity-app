import { z } from 'zod';

import { err, ok, type Result } from './result.js';
import { validation, type AppError } from './errors.js';

export const MAX_CUSTOM_DOMAINS_PER_TENANT = 3;
export const CUSTOM_DOMAIN_ADDS_PER_HOUR = 10;
export const CUSTOM_DOMAIN_CHECKS_PER_HOUR = 60;

export const dnsRecordSchema = z.object({
  type: z.enum(['CNAME', 'TXT', 'A']),
  name: z.string().min(1),
  value: z.string().min(1),
});

export type DnsRecord = z.infer<typeof dnsRecordSchema>;

export type TenantDomainProvider = 'manual' | 'vercel';

export type TenantDomainEventKind =
  | 'domain_added'
  | 'domain_verified'
  | 'domain_check_failed'
  | 'domain_removed';

export const tenantDomainStatusSchema = z.enum([
  'active',
  'pending-dns',
  'provider-verification',
  'error',
]);

export type TenantDomainStatus = z.infer<typeof tenantDomainStatusSchema>;

export const tenantDomainStatus = (domain: {
  verified: boolean;
  verification: DnsRecord[];
  lastError: string | null;
}): TenantDomainStatus =>
  domain.verified
    ? 'active'
    : domain.lastError !== null
      ? 'error'
      : domain.verification.length > 0
        ? 'provider-verification'
        : 'pending-dns';

/** The routing record always comes first so the owner adds it before any ownership proof. */
export const customDomainRecords = (input: {
  domain: string;
  target: string;
  verification: DnsRecord[];
}): DnsRecord[] => [
  { type: 'CNAME', name: input.domain, value: input.target },
  ...input.verification,
];

const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const hostnamePattern =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** An all-numeric last label is an IPv4 literal or an unroutable TLD, never a host. */
const numericTopLabelPattern = /(^|\.)\d+$/;

const stripScheme = (value: string): string => value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');

export const normalizeCustomDomain = (
  input: string,
  baseDomain: string | null,
): Result<string, AppError> => {
  const lowercased = input.trim().toLowerCase();
  if (lowercased.length === 0) return err(validation('Enter a domain'));
  const withoutPath = stripScheme(lowercased).split('/')[0] ?? '';
  const withoutPort = withoutPath.replace(/:\d+$/, '');
  const domain = withoutPort.replace(/\.+$/, '');
  if (domain.length === 0) return err(validation('Enter a domain'));
  if (domain.length > MAX_DOMAIN_LENGTH) {
    return err(validation(`A domain cannot be longer than ${String(MAX_DOMAIN_LENGTH)} characters`));
  }
  if (/[^ -~]/.test(domain)) {
    return err(validation('Enter the punycode (xn--) form of an international domain'));
  }
  if (
    !hostnamePattern.test(domain)
    || !domain.includes('.')
    || numericTopLabelPattern.test(domain)
    || domain.split('.').some((label) => label.length > MAX_LABEL_LENGTH)
  ) {
    return err(validation('Enter a domain such as courses.example.com'));
  }
  const normalizedBase = baseDomain?.trim().toLowerCase().replace(/\.+$/, '') ?? '';
  if (
    normalizedBase.length > 0
    && (domain === normalizedBase || domain.endsWith(`.${normalizedBase}`))
  ) {
    return err(validation(`${normalizedBase} addresses are handed out by the platform`));
  }
  return ok(domain);
};
