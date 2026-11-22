import { type DirectSalesLinkMessages } from './direct-sales-link-copy.en.js';

export const directSalesLinkCopyPl = {
  couponUnavailable: 'Kod rabatowy nie może być zastosowany.',
  couponApplied: (code: string, discount: string, total: string): string => `Kod ${code}: −${discount}, do zapłaty ${total}`,
  couponLowestPrice: (price: string): string => `Najniższa cena z ostatnich 30 dni: ${price}`,
  redirecting: 'Przekierowujemy do bezpiecznej płatności…',
  continueToPayment: 'Przejdź do płatności',
  offerUnavailableTitle: 'Oferta niedostępna',
  unavailable: 'Ta oferta się zakończyła albo jest teraz niedostępna.',
  soldOut: 'Ta oferta została wyprzedana.',
  temporaryProblem: 'Nie udało się rozpocząć płatności z powodu chwilowego problemu. Spróbuj ponownie za chwilę.',
  tryAgain: 'Spróbuj ponownie',
  homeLink: 'Przejdź na stronę główną',
  termsAcceptanceMessage: (legal: { termsUrl: string; privacyUrl: string }): string =>
    `Akceptuję [Regulamin](${legal.termsUrl}) i [Politykę prywatności](${legal.privacyUrl}).`,
} satisfies DirectSalesLinkMessages;
