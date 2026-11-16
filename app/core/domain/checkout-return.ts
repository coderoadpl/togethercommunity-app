import { z } from 'zod';

export const CHECKOUT_RETURN_ORIGINS_MAX = 5;
export const CHECKOUT_RETURN_URL_MAX_LENGTH = 2000;

const ORIGIN_FORM = /^https:\/\/[^/?#\\@\s]+\/?$/iu;
const HOST_FORM = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])$/u;

const CHECKOUT_RETURN_ORIGIN_MESSAGE =
  'Each checkout return origin must be an https origin such as https://shop.example.test, with no path, query, fragment, credentials or wildcard';
const CHECKOUT_RETURN_URL_MESSAGE = 'must be an absolute https URL';
const CHECKOUT_RETURN_URL_CREDENTIALS_MESSAGE = 'must not contain a user name or password';

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const normalizeCheckoutReturnOrigin = (value: string): string | null => {
  if (!ORIGIN_FORM.test(value)) return null;
  const url = parseUrl(value);
  if (url === null || url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  if (!HOST_FORM.test(url.hostname)) return null;
  return url.origin;
};

export const checkoutReturnOriginSchema = z.string().trim().transform((value, context) => {
  const origin = normalizeCheckoutReturnOrigin(value);
  if (origin === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: CHECKOUT_RETURN_ORIGIN_MESSAGE });
    return z.NEVER;
  }
  return origin;
});

export const checkoutReturnOriginsSchema = z.array(checkoutReturnOriginSchema)
  .max(CHECKOUT_RETURN_ORIGINS_MAX, `At most ${String(CHECKOUT_RETURN_ORIGINS_MAX)} checkout return origins are allowed`)
  .refine((origins) => new Set(origins).size === origins.length, 'Checkout return origins must be unique');

export const checkoutReturnUrlSchema = z.string()
  .max(CHECKOUT_RETURN_URL_MAX_LENGTH, `must be at most ${String(CHECKOUT_RETURN_URL_MAX_LENGTH)} characters`)
  .superRefine((value, context) => {
    const url = parseUrl(value);
    if (url === null || url.protocol !== 'https:') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: CHECKOUT_RETURN_URL_MESSAGE });
      return;
    }
    if (url.username !== '' || url.password !== '') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: CHECKOUT_RETURN_URL_CREDENTIALS_MESSAGE });
    }
  });

export const resolveCheckoutReturnUrl = (value: string, allowedOrigins: readonly string[]): string | null => {
  if (!checkoutReturnUrlSchema.safeParse(value).success) return null;
  const url = parseUrl(value);
  if (url === null || !allowedOrigins.includes(url.origin)) return null;
  url.hash = '';
  return url.href.length > CHECKOUT_RETURN_URL_MAX_LENGTH ? null : url.href;
};

export const checkoutReturnLink = (
  returnUrl: string,
  result: { checkoutRef: string; status: 'paid' | 'pending'; clientReference?: string | null | undefined },
): string | null => {
  const url = parseUrl(returnUrl);
  if (url === null || url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  const params = new URLSearchParams({ checkout_ref: result.checkoutRef, status: result.status });
  if (result.clientReference != null) params.set('client_reference', result.clientReference);
  url.hash = '';
  url.search = url.search === '' ? `?${params.toString()}` : `${url.search}&${params.toString()}`;
  return url.href;
};
