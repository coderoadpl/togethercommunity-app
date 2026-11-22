export const directSalesLinkCopyEn = {
  couponUnavailable: 'Coupon cannot be applied.',
  couponApplied: (code: string, discount: string, total: string): string => `Code ${code}: −${discount}, amount to pay ${total}`,
  couponLowestPrice: (price: string): string => `Lowest price in the last 30 days: ${price}`,
  redirecting: 'Redirecting to secure payment…',
  continueToPayment: 'Continue to payment',
  offerUnavailableTitle: 'Offer not available',
  unavailable: 'This offer has ended or is not available right now.',
  soldOut: 'This offer is sold out.',
  temporaryProblem: 'The payment could not start because of a temporary problem. Try again in a moment.',
  tryAgain: 'Try again',
  homeLink: 'Go to the home page',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `I accept the [Terms](${legal.termsUrl}) and the [Privacy policy](${legal.privacyUrl}).`,
};

export type DirectSalesLinkMessages = typeof directSalesLinkCopyEn;
