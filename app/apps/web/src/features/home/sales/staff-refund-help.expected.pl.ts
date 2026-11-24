export const expectedStaffRefundHelpPl = {
  cap: (amount: string) => `zwróć tam tylko niewypłaconą część kwoty ${amount} zleconej tutaj i nigdy więcej, niż Stripe pokazuje jako pozostałe do zwrotu z tej płatności`,
  refundAgain: (amount: string) => `Zleć ponownie zwrot ${amount}, wpisując tę kwotę jako zwrot częściowy, a nie całą pozostałą kwotę`,
};
