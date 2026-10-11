export const directSalesLinkCopyPl = {
  redirecting: 'Przekierowujemy do bezpiecznej płatności…',
  continueToPayment: 'Przejdź do płatności',
  checkoutUnavailable: 'Płatność jest niedostępna',
  legalUrlsMissing: 'Płatność jest niedostępna, dopóki nie zostaną skonfigurowane adresy regulaminu i polityki prywatności.',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `Akceptuję [Regulamin](${legal.termsUrl}) i [Politykę prywatności](${legal.privacyUrl}).`,
};
