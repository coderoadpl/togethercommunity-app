import type { TransactionalEmailMessages } from './transactional-email-messages.js';

export const transactionalEmailMessagesPl: TransactionalEmailMessages = {
  manageNotifications: {
    label: 'Zarządzaj powiadomieniami',
    hints: {
      thread: 'możesz wyciszyć ten wątek w dyskusji',
      space: 'możesz przestać obserwować tę przestrzeń',
      direct: 'w ustawieniach konta możesz wyłączyć wiadomości od innych uczestników',
    },
  },
  welcomeSignIn: {
    actionLabel: 'Zaloguj się i otwórz kurs',
    render: ({ header, tenantName, tenantNameHtml, actionUrl, actionLink, socialLinks }) => ({
      subject: `Twoje konto na platformie ${tenantName} jest gotowe`,
      html: `${header}<p>Cześć!</p><p>Twoje konto na platformie ${tenantNameHtml} jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.</p><p>${actionLink}</p>${socialLinks.html}`,
      text: `Cześć!\n\nTwoje konto na platformie ${tenantName} jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.\n\nZaloguj się i otwórz kurs: ${actionUrl}${socialLinks.text}`,
    }),
  },
  resetPassword: {
    actionLabel: 'Zresetuj hasło',
    render: ({ actionUrl, actionLink }) => ({
      subject: 'Zresetuj hasło',
      html: `<p>Cześć!</p><p>Kliknij poniższy link, aby zresetować hasło:</p><p>${actionLink}</p><p>Link do zresetowania hasła jest ważny przez godzinę.</p>`,
      text: `Cześć!\n\nOtwórz poniższy link, aby zresetować hasło:\n${actionUrl}\n\nLink do zresetowania hasła jest ważny przez godzinę.`,
    }),
  },
  verifyEmail: {
    actionLabel: 'Potwierdź e-mail',
    render: ({ actionUrl, actionLink }) => ({
      subject: 'Potwierdź swój adres e-mail',
      html: `<p>Cześć!</p><p>Potwierdź, że ten adres e-mail należy do Ciebie:</p><p>${actionLink}</p><p>Możesz logować się i korzystać z Together przed potwierdzeniem adresu. Weryfikacja jest potrzebna tylko do założenia własnej platformy twórcy.</p><p>Link jest ważny przez godzinę.</p>`,
      text: `Cześć!\n\nPotwierdź, że ten adres e-mail należy do Ciebie:\n${actionUrl}\n\nMożesz logować się i korzystać z Together przed potwierdzeniem adresu. Weryfikacja jest potrzebna tylko do założenia własnej platformy twórcy.\n\nLink jest ważny przez godzinę.`,
    }),
  },
  threadReply: {
    actionLabel: 'Otwórz dyskusję',
    render: ({ tenantName, tenantNameHtml, lessonName, lessonNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowa odpowiedź w dyskusji „${lessonName}”`,
      html: `<p>Cześć!</p><p>${authorHtml} odpowiedział(a) w dyskusji „${lessonNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} odpowiedział(a) w dyskusji „${lessonName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz dyskusję: ${url}${footer.text}`,
    }),
  },
  lessonQuestion: {
    actionLabel: 'Otwórz pytanie',
    render: ({ tenantName, tenantNameHtml, lessonName, lessonNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowe pytanie pod lekcją „${lessonName}”`,
      html: `<p>Cześć!</p><p>${authorHtml} zadał(a) pytanie pod lekcją „${lessonNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} zadał(a) pytanie pod lekcją „${lessonName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz pytanie: ${url}${footer.text}`,
    }),
  },
  spacePost: {
    actionLabel: 'Otwórz przestrzeń',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowy wpis w przestrzeni „${spaceName}”`,
      html: `<p>Cześć!</p><p>${authorHtml} dodał(a) nowy wpis w przestrzeni „${spaceNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} dodał(a) nowy wpis w przestrzeni „${spaceName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz przestrzeń: ${url}${footer.text}`,
    }),
  },
  spaceEvent: {
    actionLabel: 'Otwórz wydarzenie',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowe wydarzenie w przestrzeni „${spaceName}”`,
      html: `<p>Cześć!</p><p>${authorHtml} zaplanował(a) wydarzenie w przestrzeni „${spaceNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} zaplanował(a) wydarzenie w przestrzeni „${spaceName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz wydarzenie: ${url}${footer.text}`,
    }),
  },
  directMessage: {
    actionLabel: 'Otwórz rozmowę',
    render: ({ tenantName, tenantNameHtml, senderDisplay, senderHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowa wiadomość od ${senderDisplay}`,
      html: `<p>Cześć!</p><p>${senderHtml} wysłał(a) Ci wiadomość na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${senderDisplay} wysłał(a) Ci wiadomość na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz rozmowę: ${url}${footer.text}`,
    }),
  },
  magicLink: {
    actionLabel: 'Zaloguj się',
    render: ({ header, tenantName, tenantNameHtml, url, actionLink, socialLinks }) => ({
      subject: `Zaloguj się do ${tenantName}`,
      html: `${header}<p>Cześć!</p><p>Użyj tego linku, aby zalogować się do ${tenantNameHtml}:</p><p>${actionLink}</p><p>Jeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.</p>${socialLinks.html}`,
      text: `Cześć!\n\nUżyj tego linku, aby zalogować się do ${tenantName}:\n${url}\n\nJeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.${socialLinks.text}`,
    }),
  },
  subscriptionPaymentFailed: {
    billingPortalLabel: 'Zaktualizuj dane płatności',
    render: ({ header, tenantName, tenantNameHtml, productTitle, productTitleHtml, accessEndsAtText, accessEndsAtHtml, billingPortalUrl, portal, socialLinks }) => ({
      subject: `Nie udało się pobrać płatności za „${productTitle}”`,
      html: `${header}<p>Cześć!</p><p>Nie udało się pobrać płatności za „${productTitleHtml}” na platformie ${tenantNameHtml}.</p><p>Bez opłacenia subskrypcji dostęp wygaśnie ${accessEndsAtHtml}.</p>${portal}${socialLinks.html}`,
      text: `Cześć!\n\nNie udało się pobrać płatności za „${productTitle}” na platformie ${tenantName}.\n\nBez opłacenia subskrypcji dostęp wygaśnie ${accessEndsAtText}.${billingPortalUrl === null ? '' : `\n\nZaktualizuj dane płatności: ${billingPortalUrl}`}${socialLinks.text}`,
    }),
  },
  subscriptionEnded: {
    offerLabel: 'Zobacz ofertę',
    render: ({ header, tenantName, tenantNameHtml, productTitle, productTitleHtml, accessEndsAtText, accessEndsAtHtml, offerUrl, offerLink, socialLinks }) => ({
      subject: `Subskrypcja „${productTitle}” została zakończona`,
      html: `${header}<p>Cześć!</p><p>Twoja subskrypcja „${productTitleHtml}” na platformie ${tenantNameHtml} została zakończona.</p><p>Dostęp do materiałów zachowasz do ${accessEndsAtHtml}.</p><p>${offerLink}</p>${socialLinks.html}`,
      text: `Cześć!\n\nTwoja subskrypcja „${productTitle}” na platformie ${tenantName} została zakończona.\n\nDostęp do materiałów zachowasz do ${accessEndsAtText}.\n\nZobacz ofertę: ${offerUrl}${socialLinks.text}`,
    }),
  },
  supportMessage: {
    render: ({ tenantName, tenantNameHtml, memberEmail, memberEmailHtml, memberDisplay, memberDisplayHtml, subject, subjectHtml, body, bodyHtml, header }) => ({
      subject: `[${tenantName}] ${subject}`,
      html: `${header}<p>Nowa wiadomość od uczestnika ${memberDisplayHtml} (platforma ${tenantNameHtml}).</p><p>Odpowiedz na adres: ${memberEmailHtml}</p><p><strong>${subjectHtml}</strong></p><blockquote>${bodyHtml}</blockquote>`,
      text: `Nowa wiadomość od uczestnika ${memberDisplay} (platforma ${tenantName}).\n\nOdpowiedz na adres: ${memberEmail}\n\n${subject}\n\n${body}`,
    }),
  },
  memberErasureRequestEmail: {
    render: ({ tenantName, memberEmail, memberEmailHtml, requestedAtText, requestedAtHtml, dueAtText, dueAtHtml, panelUrl, panelUrlHtml }) => ({
      subject: `[${tenantName}] Wniosek o usunięcie danych`,
      html: `<p>${memberEmailHtml} złożył(a) wniosek o usunięcie konta i danych.</p><p>Złożono: ${requestedAtHtml}<br>Termin realizacji: ${dueAtHtml}</p><p><a href="${panelUrlHtml}">Otwórz wniosek w panelu</a></p>`,
      text: `${memberEmail} złożył(a) wniosek o usunięcie konta i danych.\nZłożono: ${requestedAtText}\nTermin realizacji: ${dueAtText}\n${panelUrl}`,
    }),
  },
  emailTransportTest: {
    render: ({ transport, transportHtml }) => ({
      subject: `Together — wiadomość testowa (${transport})`,
      html: `<p>Transport ${transportHtml} jest poprawnie skonfigurowany.</p><p>Ta wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.</p>`,
      text: `Transport ${transport} jest poprawnie skonfigurowany.\n\nTa wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.`,
    }),
  },
  reputationAlertEmail: {
    statusLabels: { warn: 'ostrzeżenie', critical: 'stan krytyczny' },
    missingRate: 'brak danych',
    render: ({ tenantName, tenantNameHtml, status, hardBounceRate, complaintRate, windowStartText, windowStartHtml, windowEndText, windowEndHtml, dashboardUrl, dashboardUrlHtml }) => ({
      subject: `[${tenantName}] Reputacja nadawcy: ${status}`,
      html: `<p>Reputacja nadawcy e-mail platformy ${tenantNameHtml}: <strong>${status}</strong>.</p><p>Odsetek twardych odbić (hard bounce): ${hardBounceRate}<br>Odsetek zgłoszeń spamu: ${complaintRate}<br>Okres: ${windowStartHtml} – ${windowEndHtml}</p><p><a href="${dashboardUrlHtml}">Sprawdź reputację</a></p>`,
      text: `Reputacja nadawcy e-mail platformy ${tenantName}: ${status}.\nOdsetek twardych odbić (hard bounce): ${hardBounceRate}\nOdsetek zgłoszeń spamu: ${complaintRate}\nOkres: ${windowStartText} – ${windowEndText}\n${dashboardUrl}`,
    }),
  },
};
