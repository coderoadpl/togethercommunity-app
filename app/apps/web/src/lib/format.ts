const LOCALE_BY_LANGUAGE: Record<string, string> = { pl: 'pl-PL', en: 'en-GB' };

export const localeFor = (language: string): string => LOCALE_BY_LANGUAGE[language] ?? language;

export const formatPrice = (priceCents: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(priceCents / 100);

export const formatDate = (value: string, language: string): string =>
  new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium' }).format(new Date(value));
