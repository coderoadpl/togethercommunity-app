import { directSalesLinkCopyEn, type DirectSalesLinkMessages } from './direct-sales-link-copy.en.js';

export const directSalesLinkCopyPl = {
  ...directSalesLinkCopyEn,
  redirecting: 'Przekierowujemy do bezpiecznej płatności…',
  continueToPayment: 'Przejdź do płatności',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `Akceptuję [Regulamin](${legal.termsUrl}) i [Politykę prywatności](${legal.privacyUrl}).`,
} satisfies DirectSalesLinkMessages;
