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

const CHAR_HYPHEN = 45;
const CHAR_DOT = 46;
const CHAR_COLON = 58;
const CHAR_PLUS = 43;
const CHAR_DIGIT_FIRST = 48;
const CHAR_DIGIT_LAST = 57;
const CHAR_LOWER_FIRST = 97;
const CHAR_LOWER_LAST = 122;
const CHAR_PRINTABLE_FIRST = 32;
const CHAR_PRINTABLE_LAST = 126;
const SCHEME_SEPARATOR = '://';

const isDigit = (code: number): boolean =>
  code >= CHAR_DIGIT_FIRST && code <= CHAR_DIGIT_LAST;

const isLower = (code: number): boolean =>
  code >= CHAR_LOWER_FIRST && code <= CHAR_LOWER_LAST;

const isAlphanumeric = (code: number): boolean => isDigit(code) || isLower(code);

const isSchemeChar = (code: number): boolean =>
  isAlphanumeric(code) || code === CHAR_PLUS || code === CHAR_DOT || code === CHAR_HYPHEN;

const stripScheme = (value: string): string => {
  const separator = value.indexOf(SCHEME_SEPARATOR);
  if (separator <= 0 || !isLower(value.charCodeAt(0))) return value;
  for (let index = 1; index < separator; index += 1) {
    if (!isSchemeChar(value.charCodeAt(index))) return value;
  }
  return value.slice(separator + SCHEME_SEPARATOR.length);
};

const stripPort = (value: string): string => {
  let digitsStart = value.length;
  while (digitsStart > 0 && isDigit(value.charCodeAt(digitsStart - 1))) digitsStart -= 1;
  if (digitsStart === value.length || digitsStart === 0) return value;
  return value.charCodeAt(digitsStart - 1) === CHAR_COLON ? value.slice(0, digitsStart - 1) : value;
};

const stripTrailingDots = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === CHAR_DOT) end -= 1;
  return value.slice(0, end);
};

const hasNonPrintableAscii = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < CHAR_PRINTABLE_FIRST || code > CHAR_PRINTABLE_LAST) return true;
  }
  return false;
};

const isLabel = (label: string): boolean => {
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return false;
  if (!isAlphanumeric(label.charCodeAt(0))) return false;
  if (!isAlphanumeric(label.charCodeAt(label.length - 1))) return false;
  for (let index = 1; index < label.length - 1; index += 1) {
    const code = label.charCodeAt(index);
    if (!isAlphanumeric(code) && code !== CHAR_HYPHEN) return false;
  }
  return true;
};

/** An all-numeric last label is an IPv4 literal or an unroutable TLD, never a host. */
const isNumericLabel = (label: string): boolean => {
  for (let index = 0; index < label.length; index += 1) {
    if (!isDigit(label.charCodeAt(index))) return false;
  }
  return label.length > 0;
};

const isHostname = (value: string): boolean => {
  const labels = value.split('.');
  if (labels.length < 2) return false;
  if (isNumericLabel(labels[labels.length - 1] ?? '')) return false;
  return labels.every(isLabel);
};

export const normalizeCustomDomain = (
  input: string,
  baseDomain: string | null,
): Result<string, AppError> => {
  const lowercased = input.trim().toLowerCase();
  if (lowercased.length === 0) return err(validation('Enter a domain'));
  const withoutPath = stripScheme(lowercased).split('/')[0] ?? '';
  const domain = stripTrailingDots(stripPort(withoutPath));
  if (domain.length === 0) return err(validation('Enter a domain'));
  if (domain.length > MAX_DOMAIN_LENGTH) {
    return err(validation(`A domain cannot be longer than ${String(MAX_DOMAIN_LENGTH)} characters`));
  }
  if (hasNonPrintableAscii(domain)) {
    return err(validation('Enter the punycode (xn--) form of an international domain'));
  }
  if (!isHostname(domain)) {
    return err(validation('Enter a domain such as courses.example.com'));
  }
  const normalizedBase = stripTrailingDots(baseDomain?.trim().toLowerCase() ?? '');
  if (
    normalizedBase.length > 0
    && (domain === normalizedBase || domain.endsWith(`.${normalizedBase}`))
  ) {
    return err(validation(`${normalizedBase} addresses are handed out by the platform`));
  }
  return ok(domain);
};
