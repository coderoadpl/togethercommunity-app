export const START_PATH = '/start';

export const safeReturnTo = (value: string | null): string | null => {
  if (value === null) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    return new URL(value, 'https://together-return.local').origin === 'https://together-return.local'
      ? value
      : null;
  } catch {
    return null;
  }
};

export const returnToFromSearch = (search: string): string | null =>
  safeReturnTo(new URLSearchParams(search).get('returnTo'));

export const pathWithSearch = (location: { pathname: string; searchStr: string }): string =>
  `${location.pathname}${location.searchStr}`;

export const loginPathWithReturnTo = (returnTo: string): string => {
  const safe = safeReturnTo(returnTo);
  if (safe === null) return '/login';
  const search = new URLSearchParams({ returnTo: safe });
  return `/login?${search.toString()}`;
};

export const loginCallbackUrl = (returnTo: string | null): string => {
  const url = new URL('/login?verification=verified', window.location.origin);
  const safe = safeReturnTo(returnTo);
  if (safe !== null) url.searchParams.set('returnTo', safe);
  return url.toString();
};

export const validateLoginSearch = (search: Record<string, unknown>) => ({
  ...(typeof search['returnTo'] === 'string' && safeReturnTo(search['returnTo']) !== null
    ? { returnTo: search['returnTo'] }
    : {}),
  ...(search['verification'] === 'verified' ? { verification: 'verified' } : {}),
  ...(typeof search['error'] === 'string' ? { error: search['error'] } : {}),
  ...(search['twoFactor'] === 'required' ? { twoFactor: 'required' } : {}),
});
