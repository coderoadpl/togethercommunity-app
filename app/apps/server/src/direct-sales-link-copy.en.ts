export const directSalesLinkCopyEn = {
  redirecting: 'Redirecting to secure payment…',
  continueToPayment: 'Continue to payment',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `I accept the [Terms](${legal.termsUrl}) and the [Privacy policy](${legal.privacyUrl}).`,
};
