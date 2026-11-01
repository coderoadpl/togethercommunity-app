import { type DirectSalesLinkMessages } from './direct-sales-link-copy.en.js';

export const directSalesLinkCopyPl = {
  couponUnavailable: 'Kod rabatowy nie może być zastosowany.',
  couponApplied: (code: string, discount: string, total: string): string => `Kod ${code}: −${discount}, do zapłaty ${total}`,
  redirecting: 'Przekierowujemy do bezpiecznej płatności…',
  continueToPayment: 'Przejdź do płatności',
  checkoutUnavailable: 'Płatność jest w tej chwili niedostępna.',
  legalUrlsMissing: 'Płatność będzie dostępna, gdy zostaną ustawione adresy regulaminu i polityki prywatności.',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `Akceptuję [Regulamin](${legal.termsUrl}) i [Politykę prywatności](${legal.privacyUrl}).`,
} satisfies DirectSalesLinkMessages;
