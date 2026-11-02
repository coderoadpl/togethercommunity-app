export const directSalesLinkCopyEn = {
  couponUnavailable: 'Coupon cannot be applied.',
  couponApplied: (code: string, discount: string, total: string): string => `Code ${code}: −${discount}, amount to pay ${total}`,
  couponLowestPrice: (price: string): string => `Lowest price in the last 30 days: ${price}`,
  redirecting: 'Redirecting to secure payment…',
  continueToPayment: 'Continue to payment',
  checkoutUnavailable: 'Checkout is unavailable',
  legalUrlsMissing: 'Checkout is unavailable until terms and privacy URLs are configured.',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `I accept the [Terms](${legal.termsUrl}) and the [Privacy policy](${legal.privacyUrl}).`,
};

export type DirectSalesLinkMessages = typeof directSalesLinkCopyEn;
