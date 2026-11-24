export const expectedStaffRefundHelpPl = {
  cap: (amount: string) => `zwróć tam tylko niewypłaconą część kwoty ${amount} zleconej tutaj i nigdy więcej, niż Stripe pokazuje jako pozostałe do zwrotu z tej płatności`,
  refundAgain: (amount: string) => `Zleć ponownie zwrot ${amount}, wpisując tę kwotę jako zwrot częściowy, a nie całą pozostałą kwotę`,
  refundAgainOrByHand: (amount: string) => `Zleć ponownie zwrot ${amount}, wpisując tę kwotę jako zwrot częściowy, a nie całą pozostałą kwotę, albo zwróć ręcznie w panelu Stripe najwyżej ${amount}.`,
  checkAccess: 'Sprawdź dostęp uczestnika i przywróć go tylko wtedy, gdy został odebrany i ma zostać przywrócony: zwrot częściowy nigdy nie kończy dostępu, a dostęp mógł utrzymać inny zakup.',
  or: 'lub',
};
