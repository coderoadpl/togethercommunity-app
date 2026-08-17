const LOCALE_BY_LANGUAGE: Record<string, string> = { pl: 'pl-PL', en: 'en-GB' };

const localeFor = (language: string): string => LOCALE_BY_LANGUAGE[language] ?? language;

export const formatPrice = (priceCents: number, currency: string, language: string) =>
  new Intl.NumberFormat(localeFor(language), {
    style: 'currency',
    currency,
  }).format(priceCents / 100);

export const formatOfferPrice = (
  priceCents: number,
  currency: string,
  language: string,
  freeLabel: string,
): string => (priceCents === 0 ? freeLabel : formatPrice(priceCents, currency, language));

export const formatDate = (value: string, language: string): string =>
  new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium' }).format(new Date(value));

export const formatTime = (value: string, language: string): string =>
  new Intl.DateTimeFormat(localeFor(language), { timeStyle: 'short' }).format(new Date(value));

export const formatDateTime = (value: string, language: string): string =>
  new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export const formatFileSize = (bytes: number, language: string): string => {
  const units = [
    { threshold: 1024 * 1024 * 1024, divisor: 1024 * 1024 * 1024, label: 'GB' },
    { threshold: 1024 * 1024, divisor: 1024 * 1024, label: 'MB' },
    { threshold: 0, divisor: 1024, label: 'KB' },
  ];
  const unit = units.find((candidate) => bytes >= candidate.threshold) ?? units[2];
  if (unit === undefined) return `${String(bytes)} B`;
  const value = Math.max(1, bytes / unit.divisor);
  const formatted = new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 1 }).format(value);
  return `${formatted} ${unit.label}`;
};

const RELATIVE_STEPS: Array<{ limitMs: number; unitMs: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limitMs: 60_000, unitMs: 1_000, unit: 'second' },
  { limitMs: 3_600_000, unitMs: 60_000, unit: 'minute' },
  { limitMs: 86_400_000, unitMs: 3_600_000, unit: 'hour' },
  { limitMs: 30 * 86_400_000, unitMs: 86_400_000, unit: 'day' },
];

export const formatRelativeTime = (value: string, language: string, nowMs = Date.now()): string => {
  const diffMs = new Date(value).getTime() - nowMs;
  const step = RELATIVE_STEPS.find((candidate) => Math.abs(diffMs) < candidate.limitMs);
  if (step === undefined) return formatDate(value, language);
  return new Intl.RelativeTimeFormat(localeFor(language), { numeric: 'auto' }).format(
    Math.trunc(diffMs / step.unitMs),
    step.unit,
  );
};
