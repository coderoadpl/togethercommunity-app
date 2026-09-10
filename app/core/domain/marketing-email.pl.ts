export const marketingConsentConfirmationPl = (input: { wording: string; confirmationUrl: string; htmlWording: string; htmlConfirmationUrl: string }): { subject: string; html: string; text: string } => {
  return {
    subject: 'Potwierdź zgodę na wiadomości e-mail',
    html: `<p>Cześć!</p><p>Potwierdź, że chcesz otrzymywać od nas wiadomości w zakresie:</p><blockquote>${input.htmlWording}</blockquote><p><a href="${input.htmlConfirmationUrl}">Potwierdzam zgodę</a></p><p>Jeśli to nie Ty zapisujesz się na te wiadomości, zignoruj tę wiadomość.</p>`,
    text: `Cześć!\n\nPotwierdź, że chcesz otrzymywać od nas wiadomości w zakresie:\n\n${input.wording}\n\nPotwierdzam zgodę: ${input.confirmationUrl}\n\nJeśli to nie Ty zapisujesz się na te wiadomości, zignoruj tę wiadomość.`,
  };
};

export const marketingFooterCopyPl = {
  unsubscribe: 'Wypisz się',
  basisPrefix: 'Wysyłamy Ci tę wiadomość na podstawie zgody: „',
  basisSuffix: '”.',
} as const;
