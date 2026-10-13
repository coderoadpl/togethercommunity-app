export const directSalesLinkCopyEn = {
  haveCode: 'I have a discount code',
  discountCode: 'Discount code',
  couponUnavailable: 'This discount code cannot be used.',
  redirecting: 'Redirecting to secure payment…',
  continueToPayment: 'Continue to payment',
  checkoutUnavailable: 'Checkout is unavailable',
  legalUrlsMissing: 'Checkout is unavailable until terms and privacy URLs are configured.',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `I accept the [Terms](${legal.termsUrl}) and the [Privacy policy](${legal.privacyUrl}).`,
};

export type DirectSalesLinkMessages = typeof directSalesLinkCopyEn;
