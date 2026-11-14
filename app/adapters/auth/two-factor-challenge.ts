// Mirrors safeReturnTo in apps/web/src/lib/auth-return.ts, which adapters may not import.
const safeReturnTo = (value: string | null): string | null => {
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

export const twoFactorChallengeUrl = (origin: string, continuation: URLSearchParams): string => {
  const url = new URL('/login?twoFactor=required', origin);
  if (continuation.get('verification') === 'verified') url.searchParams.set('verification', 'verified');
  const returnTo = safeReturnTo(continuation.get('returnTo'));
  if (returnTo !== null) url.searchParams.set('returnTo', returnTo);
  return url.toString();
};
