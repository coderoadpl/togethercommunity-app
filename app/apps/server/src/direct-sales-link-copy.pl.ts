import { directSalesLinkCopyEn } from './direct-sales-link-copy.en.js';

export const directSalesLinkCopyPl = {
  redirecting: 'Przekierowujemy do bezpiecznej płatności…',
  continueToPayment: 'Przejdź do płatności',
  checkoutUnavailable: directSalesLinkCopyEn.checkoutUnavailable,
  legalUrlsMissing: directSalesLinkCopyEn.legalUrlsMissing,
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `Akceptuję [Regulamin](${legal.termsUrl}) i [Politykę prywatności](${legal.privacyUrl}).`,
};
