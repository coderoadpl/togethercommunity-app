export const directSalesLinkCopyPl = {
  redirecting: 'Przekierowujemy do bezpiecznej płatności…',
  continueToPayment: 'Przejdź do płatności',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `Akceptuję [Regulamin](${legal.termsUrl}) i [Politykę prywatności](${legal.privacyUrl}).`,
};
