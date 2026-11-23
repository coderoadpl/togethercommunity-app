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
  purchase: {
    heading: 'Dziękujemy za zakup',
    paymentReceived: (orderReference, tenantName) => `Otrzymaliśmy Twoją płatność za zamówienie ${orderReference} na platformie ${tenantName}.`,
    collectInPerson: 'Zamówienie odbierzesz osobiście — przy odbiorze pokaż kod QR z tej wiadomości.',
    nextSteps: {
      course: 'Kurs czeka na Ciebie na Twoim koncie.',
      digital_download: 'Pliki są gotowe do pobrania na Twoim koncie.',
      membership: 'Twoje członkostwo jest aktywne.',
      physical: 'Napiszemy ponownie, gdy paczka wyruszy w drogę.',
      unknown: 'Zakup jest dostępny na Twoim koncie.',
    },
    orderNumber: 'Numer zamówienia',
    lines: 'Zakupione pozycje',
    item: 'Pozycja',
    amount: 'Kwota brutto',
    vat: 'VAT',
    exempt: 'zw.',
    total: 'Razem',
    notInvoice: 'To potwierdzenie nie jest fakturą.',
    invoiceContact: (contact) => `Jeśli potrzebujesz faktury, ${contact}.`,
    contactLabel: 'napisz do sklepu',
    signInValidity: 'Link do logowania działa przez godzinę.',
    signInLater: (signInPage) => `Później zalogujesz się w każdej chwili na ${signInPage}.`,
    signInPageLabel: 'stronie logowania',
    subject: (orderReference, tenantName) => `Potwierdzenie zakupu — ${tenantName} (${orderReference})`,
    verification: 'Kod QR dla sprzedawcy: pokaż go, jeśli sprzedawca poprosi o potwierdzenie zamówienia.',
    verificationText: 'Jeśli sprzedawca poprosi o potwierdzenie zamówienia, pokaż kod QR z wersji HTML tej wiadomości.',
    qrAlt: 'Kod QR zamówienia',
    delivery: 'Dostawa',
    pickupPoint: 'Paczkomat',
    personalization: 'Personalizacja',
    personalizationCondition: 'Zaakceptowany warunek',
  },
  orderShipped: {
    items: 'Wysłane produkty',
    carrier: 'Przewoźnik',
    trackingNumber: 'Numer przesyłki',
    trackLabel: 'Śledź przesyłkę',
    carriers: { inpost: 'InPost' },
    render: ({ header, tenantName, tenantNameHtml, orderReference, orderReferenceHtml, track, items, delivery, tracking, socialLinks }) => ({
      subject: `Zamówienie wysłane — ${tenantName} (${orderReference})`,
      html: `${header}<p>Cześć!</p><p>Twoje zamówienie ${orderReferenceHtml} w ${tenantNameHtml} zostało wysłane.</p>${track.html}${items.html}${delivery.html}${tracking.html}${socialLinks.html}`,
      text: `Cześć!\n\nTwoje zamówienie ${orderReference} w ${tenantName} zostało wysłane.${track.text}${items.text}${delivery.text}${tracking.text}${socialLinks.text}`,
    }),
  },
  welcomeSignIn: {
    actionLabels: {
      course: 'Zaloguj się i otwórz kurs',
      digital_download: 'Zaloguj się i pobierz pliki',
      membership: 'Zaloguj się na swoje konto',
      physical: 'Zaloguj się na swoje konto',
      unknown: 'Zaloguj się na swoje konto',
    },
    render: ({ header, tenantName, tenantNameHtml, actionUrl, actionLink, actionLabel, socialLinks }) => ({
      subject: `Twoje konto na platformie ${tenantName} jest gotowe`,
      html: `${header}<p>Cześć!</p><p>Twoje konto na platformie ${tenantNameHtml} jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.</p><p>${actionLink}</p>${socialLinks.html}`,
      text: `Cześć!\n\nTwoje konto na platformie ${tenantName} jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.\n\n${actionLabel}: ${actionUrl}${socialLinks.text}`,
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
      subject: `Nowa odpowiedź w dyskusji „${lessonName}” — ${tenantName}`,
      html: `<p>Cześć!</p><p>${authorHtml} odpowiedział(a) w dyskusji „${lessonNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} odpowiedział(a) w dyskusji „${lessonName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz dyskusję: ${url}${footer.text}`,
    }),
  },
  lessonQuestion: {
    actionLabel: 'Otwórz pytanie',
    render: ({ tenantName, tenantNameHtml, lessonName, lessonNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowe pytanie pod lekcją „${lessonName}” — ${tenantName}`,
      html: `<p>Cześć!</p><p>${authorHtml} zadał(a) pytanie pod lekcją „${lessonNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} zadał(a) pytanie pod lekcją „${lessonName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz pytanie: ${url}${footer.text}`,
    }),
  },
  spacePost: {
    actionLabel: 'Otwórz przestrzeń',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowy wpis w przestrzeni „${spaceName}” — ${tenantName}`,
      html: `<p>Cześć!</p><p>${authorHtml} dodał(a) nowy wpis w przestrzeni „${spaceNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} dodał(a) nowy wpis w przestrzeni „${spaceName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz przestrzeń: ${url}${footer.text}`,
    }),
  },
  spaceEvent: {
    actionLabel: 'Otwórz wydarzenie',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowe wydarzenie w przestrzeni „${spaceName}” — ${tenantName}`,
      html: `<p>Cześć!</p><p>${authorHtml} zaplanował(a) wydarzenie w przestrzeni „${spaceNameHtml}” na platformie ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Cześć!\n\n${authorDisplay} zaplanował(a) wydarzenie w przestrzeni „${spaceName}” na platformie ${tenantName}:\n\n${snippetText}\n\nOtwórz wydarzenie: ${url}${footer.text}`,
    }),
  },
  directMessage: {
    actionLabel: 'Otwórz rozmowę',
    render: ({ tenantName, tenantNameHtml, senderDisplay, senderHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `Nowa wiadomość od ${senderDisplay} — ${tenantName}`,
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
    contactLabel: 'Napisz do obsługi',
    workspaceLabel: (tenantName) => `Otwórz stronę platformy ${tenantName}`,
    render: ({ header, tenantName, tenantNameHtml, productTitle, productTitleHtml, accessEndsAtText, accessEndsAtHtml, billingPortalUrl, portal, contactUrl, contactLink, workspaceUrl, workspaceLink, socialLinks }) => {
      const settle = `Aby zachować dostęp, skontaktuj się z obsługą platformy ${tenantName} i opłać subskrypcję.`;
      const settleHtml = `Aby zachować dostęp, skontaktuj się z obsługą platformy ${tenantNameHtml} i opłać subskrypcję.`;
      const fallbackLink = contactLink ?? workspaceLink;
      const actionHtml = billingPortalUrl !== null ? portal : `<p>${settleHtml}</p>${fallbackLink === null ? '' : `<p>${fallbackLink}</p>`}`;
      const fallbackText = contactUrl !== null
        ? `\n\nNapisz do obsługi: ${contactUrl}`
        : workspaceUrl === null ? '' : `\n\nOtwórz stronę platformy ${tenantName}: ${workspaceUrl}`;
      const actionText = billingPortalUrl !== null
        ? `\n\nZaktualizuj dane płatności: ${billingPortalUrl}`
        : `\n\n${settle}${fallbackText}`;
      return {
        subject: `Nie udało się pobrać płatności za „${productTitle}” — ${tenantName}`,
        html: `${header}<p>Cześć!</p><p>Nie udało się pobrać płatności za „${productTitleHtml}” na platformie ${tenantNameHtml}.</p><p>Bez opłacenia subskrypcji dostęp wygaśnie ${accessEndsAtHtml}.</p>${actionHtml}${socialLinks.html}`,
        text: `Cześć!\n\nNie udało się pobrać płatności za „${productTitle}” na platformie ${tenantName}.\n\nBez opłacenia subskrypcji dostęp wygaśnie ${accessEndsAtText}.${actionText}${socialLinks.text}`,
      };
    },
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
  orderOutOfStockEmail: {
    render: ({ tenantName, orderId, orderIdHtml, buyerEmail, buyerEmailHtml, refund, productTitles, productTitlesHtml, orderUrl, orderUrlHtml }) => {
      const summary = (amount: string | null) => amount === null
        ? 'Zamówienie wpłynęło po wyczerpaniu towaru, więc zostało anulowane. Stan magazynowy nie został zmniejszony, a ponieważ nie pobrano żadnej opłaty, nie ma czego zwracać.'
        : `Opłacone zamówienie wpłynęło po wyczerpaniu towaru, więc zostało anulowane. Stan magazynowy nie został zmniejszony, a zwrot całej kwoty ${amount} jest w toku.`;
      return {
        subject: `[${tenantName}] Zamówienie anulowane z braku towaru: ${orderId}`,
        html: `<p>${summary(refund?.amountHtml ?? null)}</p><p>Zamówienie: ${orderIdHtml}<br>Kupujący: ${buyerEmailHtml}<br>Brak towaru: ${productTitlesHtml}</p><p><a href="${orderUrlHtml}">Otwórz zamówienie</a></p>`,
        text: `${summary(refund?.amount ?? null)}\nZamówienie: ${orderId}\nKupujący: ${buyerEmail}\nBrak towaru: ${productTitles}\n${orderUrl}`,
      };
    },
  },
  orderSoldOutRefundEmail: {
    shopLabel: 'Przejdź do sklepu',
    render: ({ header, socialLinks, tenantName, tenantNameHtml, orderId, orderIdHtml, orderReference, orderReferenceHtml, productTitles, productTitlesHtml, refund, shopUrl, shopLink }) => {
      const timing = [
        'Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych.',
        'BLIK: zwrot trwa około 120 minut.',
        'Przelewy24: zwrot wpływa jako osobny przelew w ciągu 3 dni roboczych.',
        'Inne metody płatności: czas zależy od operatora płatności.',
      ];
      const refundText = refund === null
        ? 'Nie pobraliśmy żadnej opłaty, więc nie ma czego zwracać.'
        : `Automatycznie zleciliśmy zwrot całej kwoty ${refund.amount} na metodę płatności, której użyto. Nie musisz nic robić.\n\nKiedy pieniądze wrócą:\n${timing.map((line) => `- ${line}`).join('\n')}`;
      const refundHtml = refund === null
        ? '<p>Nie pobraliśmy żadnej opłaty, więc nie ma czego zwracać.</p>'
        : `<p>Automatycznie zleciliśmy zwrot całej kwoty ${refund.amountHtml} na metodę płatności, której użyto. Nie musisz nic robić.</p><p>Kiedy pieniądze wrócą:</p><ul>${timing.map((line) => `<li>${line}</li>`).join('')}</ul>`;
      return {
        subject: `Zamówienie anulowane, ${refund === null ? 'bez opłaty' : 'zwracamy całą kwotę'} — ${tenantName} (${orderReference})`,
        html: `${header}<p>Cześć!</p><p>Płatność za zamówienie ${orderReferenceHtml} na platformie ${tenantNameHtml} wpłynęła, gdy towar był już wyprzedany, więc całe zamówienie zostało anulowane i nic nie zostanie wysłane.</p><p>Numer zamówienia: ${orderIdHtml}<br>Wyprzedane: ${productTitlesHtml}</p>${refundHtml}<p>Przepraszamy za kłopot.</p><p>${shopLink}</p>${socialLinks.html}`,
        text: `Cześć!\n\nPłatność za zamówienie ${orderReference} na platformie ${tenantName} wpłynęła, gdy towar był już wyprzedany, więc całe zamówienie zostało anulowane i nic nie zostanie wysłane.\n\nNumer zamówienia: ${orderId}\nWyprzedane: ${productTitles}\n\n${refundText}\n\nPrzepraszamy za kłopot.\n\nPrzejdź do sklepu: ${shopUrl}${socialLinks.text}`,
      };
    },
  },
  orderRefundIssuedEmail: {
    shopLabel: 'Przejdź do sklepu',
    render: ({ header, socialLinks, tenantName, tenantNameHtml, orderReference, orderReferenceHtml, amount, amountHtml, shopUrl, shopLink }) => {
      const timing = [
        'Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie zwykle pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych, zależnie od banku.',
        'Inne metody płatności: czas zwykle zależy od metody płatności i banku.',
      ];
      return {
        subject: `Zwrot ${amount} w drodze — ${tenantName} (${orderReference})`,
        html: `${header}<p>Cześć!</p><p>Zwrot ${amountHtml} za zamówienie ${orderReferenceHtml} na platformie ${tenantNameHtml} został zlecony na metodę płatności, której użyto. Nie musisz nic robić.</p><p>Kiedy pieniądze wrócą:</p><ul>${timing.map((line) => `<li>${line}</li>`).join('')}</ul><p>${shopLink}</p>${socialLinks.html}`,
        text: `Cześć!\n\nZwrot ${amount} za zamówienie ${orderReference} na platformie ${tenantName} został zlecony na metodę płatności, której użyto. Nie musisz nic robić.\n\nKiedy pieniądze wrócą:\n${timing.map((line) => `- ${line}`).join('\n')}\n\nPrzejdź do sklepu: ${shopUrl}${socialLinks.text}`,
      };
    },
  },
  staffRefundAlertEmail: {
    subjects: {
      retrying: 'Zwrot zlecony przez zespół jeszcze niezrealizowany, ponawiamy',
      blocked_permission: 'Zwrot zlecony przez zespół zablokowany przez brak uprawnienia w Stripe',
      blocked_permission_failed: 'Zwrot zlecony przez zespół nadal zablokowany po 72 godzinach, niezrealizowany',
      failed: 'Zwrot zlecony przez zespół nie powiódł się, nic nie zwrócono',
      failed_after_submission: 'Zwrot zlecony przez zespół nie powiódł się po zleceniu',
      unconfirmed: 'Stripe nie potwierdził zwrotu zleconego przez zespół, sprawdź go',
    },
    retryingOutcomeUnknownSubject: 'Wynik zwrotu zleconego przez zespół jeszcze nieznany, ponawiamy',
    lastErrorLabel: 'Ostatni błąd',
    openOrder: 'Otwórz zamówienie',
    paragraphs: ({ alert, amount, orderId, mayHaveRefunded, reason, restocked, removedFromPackingList }) => {
      const checkInDashboard = 'Sprawdź płatność w panelu Stripe: jeśli ten zwrot jest tam widoczny, nic więcej nie trzeba robić; jeśli go nie ma, zwróć płatność tam, a zamówienie zaktualizuje się, gdy Stripe zgłosi zwrot.';
      const unconfirmedBecause = reason === 'create_outcome_unknown'
        ? 'Zlecenie tego zwrotu mogło dotrzeć do Stripe, ale nie udało się odczytać zwrotów płatności przed końcem automatycznych ponowień, więc nie wiadomo, czy zwrot został wypłacony.'
        : reason === 'awaiting_provider'
          ? 'Podczas ostatniego automatycznego sprawdzenia Stripe nadal realizował ten zwrot, a zwrot nie jest już sprawdzany automatycznie, więc nie wiadomo, czy został wypłacony.'
          : reason === 'refunded_outside'
            ? 'Płatność ma pełny zwrot zlecony poza platformą, którego klucz Stripe tej przestrzeni nie mógł potwierdzić, więc nie wiadomo, czy ten zwrot został wypłacony.'
            : 'Stripe nie potwierdził zwrotu, a zwrot nie jest już sprawdzany automatycznie, więc nie wiadomo, czy został wypłacony.';
      const states = {
        retrying: mayHaveRefunded
          ? 'Stripe mógł już otrzymać to zlecenie zwrotu, ale jego odpowiedź nie dotarła. To samo zlecenie jest powtarzane automatycznie przez 7 dni, więc zamówienie nigdy nie zostanie zwrócone dwa razy; jeśli nadal się nie uda, dostaniesz kolejną wiadomość.'
          : 'Zwrot nie dotarł jeszcze do Stripe, więc na razie nic nie zostało zwrócone. Będzie ponawiany automatycznie przez 7 dni; jeśli nadal się nie uda, dostaniesz kolejną wiadomość.',
        blocked_permission: 'Stripe go odrzucił, bo ograniczony klucz Stripe tej przestrzeni nie ma uprawnienia Charges and Refunds (zapis), więc na razie nic nie zostało zwrócone. Dodaj to uprawnienie do klucza w panelu Stripe; zwrot zostanie wtedy wypłacony przy najbliższej cogodzinnej próbie. Próby są ponawiane co godzinę przez 72 godziny.',
        blocked_permission_failed: 'Zwrot był nadal blokowany przez brak uprawnienia Charges and Refunds (zapis) po 72 godzinach cogodzinnych prób i nie będzie już ponawiany. Nic nie zostało zwrócone. Po dodaniu uprawnienia zleć zwrot ponownie na stronie zamówienia albo zwróć płatność ręcznie w panelu Stripe.',
        failed: 'Zwrot nie powiódł się i nie będzie już ponawiany. To zlecenie niczego nie zwróciło. Zleć zwrot ponownie na stronie zamówienia albo zwróć płatność ręcznie w panelu Stripe.',
        failed_after_submission: 'Stripe zgłasza, że zwrot nie powiódł się po zleceniu, więc pieniądze nie trafiły do kupującego. Zleć zwrot ponownie na stronie zamówienia albo zwróć pieniądze w inny sposób.',
        unconfirmed: `${unconfirmedBecause} ${checkInDashboard}`,
      } as const;
      const settled = alert !== 'retrying' && alert !== 'blocked_permission';
      const backToPacking = 'Jeśli zamówienie ma jednak zostać wysłane, przywróć je do pakowania na stronie zamówienia.';
      const kept = !settled ? null
        : restocked && removedFromPackingList ? `Towar przywrócony do magazynu i zamówienie zdjęte z listy do spakowania przy tym zwrocie pozostają bez zmian. ${backToPacking}`
          : restocked ? 'Towar przywrócony do magazynu przy tym zwrocie pozostaje w magazynie.'
            : removedFromPackingList ? `Zamówienie zdjęte z listy do spakowania przy tym zwrocie pozostaje poza nią. ${backToPacking}` : null;
      const access = alert === 'failed_after_submission'
        ? 'Jeśli Stripe zgłosił już wcześniej zwrot, zamówienie jest oznaczone jako zwrócone, a dostęp, który dawało, wygasł; ten dostęp nie wraca automatycznie: nadaj go ponownie na stronie uczestnika.'
        : null;
      return [`Osoba z zespołu zleciła zwrot ${amount} za zamówienie ${orderId}.`, states[alert], ...(kept === null ? [] : [kept]), ...(access === null ? [] : [access])];
    },
  },
  orderRefundAlertEmail: {
    render: ({ tenantName, alert, orderId, orderIdHtml, amount, amountHtml, error, errorHtml, orderUrl, orderUrlHtml }) => {
      const subjects = {
        retrying: 'Automatyczny zwrot nie powiódł się, ponawiamy',
        blocked_permission: 'Automatyczny zwrot zablokowany przez brak uprawnienia w Stripe',
        blocked_permission_failed: 'Automatyczny zwrot nadal zablokowany po 72 godzinach, zwróć ręcznie',
        failed: 'Automatyczny zwrot nie powiódł się, zwróć ręcznie',
        failed_after_submission: 'Zwrot nie powiódł się po zleceniu, zwróć ręcznie',
        unconfirmed: 'Stripe nie potwierdził zwrotu, sprawdź go ręcznie',
      } as const;
      const bodies = {
        retrying: [`Automatyczny zwrot ${amount} za anulowane zamówienie ${orderId} nie powiódł się. Będzie ponawiany automatycznie przez 7 dni; jeśli nadal się nie uda, dostaniesz kolejną wiadomość.`,
          `Automatyczny zwrot ${amountHtml} za anulowane zamówienie ${orderIdHtml} nie powiódł się. Będzie ponawiany automatycznie przez 7 dni; jeśli nadal się nie uda, dostaniesz kolejną wiadomość.`],
        blocked_permission: [`Zwrot ${amount} za anulowane zamówienie ${orderId} nie został zlecony, bo ograniczony klucz Stripe tej przestrzeni nie ma uprawnienia Charges and Refunds (zapis). Dodaj to uprawnienie do klucza w panelu Stripe; oczekujące zwroty zostaną wtedy wypłacone przy najbliższej cogodzinnej próbie. Próby są ponawiane co godzinę przez 72 godziny.`,
          `Zwrot ${amountHtml} za anulowane zamówienie ${orderIdHtml} nie został zlecony, bo ograniczony klucz Stripe tej przestrzeni nie ma uprawnienia Charges and Refunds (zapis). Dodaj to uprawnienie do klucza w panelu Stripe; oczekujące zwroty zostaną wtedy wypłacone przy najbliższej cogodzinnej próbie. Próby są ponawiane co godzinę przez 72 godziny.`],
        blocked_permission_failed: [`Zwrot ${amount} za anulowane zamówienie ${orderId} był nadal blokowany przez brak uprawnienia Charges and Refunds (zapis) po 72 godzinach cogodzinnych prób i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.`,
          `Zwrot ${amountHtml} za anulowane zamówienie ${orderIdHtml} był nadal blokowany przez brak uprawnienia Charges and Refunds (zapis) po 72 godzinach cogodzinnych prób i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.`],
        failed: [`Automatyczny zwrot ${amount} za anulowane zamówienie ${orderId} nie mógł zostać zrealizowany i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.`,
          `Automatyczny zwrot ${amountHtml} za anulowane zamówienie ${orderIdHtml} nie mógł zostać zrealizowany i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.`],
        failed_after_submission: [`Stripe zgłasza, że zwrot ${amount} za anulowane zamówienie ${orderId} nie powiódł się po zleceniu. Zwróć pieniądze kupującemu w inny sposób.`,
          `Stripe zgłasza, że zwrot ${amountHtml} za anulowane zamówienie ${orderIdHtml} nie powiódł się po zleceniu. Zwróć pieniądze kupującemu w inny sposób.`],
        unconfirmed: [`Stripe nie potwierdził zwrotu ${amount} za anulowane zamówienie ${orderId}, a zwrot nie jest już sprawdzany automatycznie. Sprawdź go w panelu Stripe; jeśli się nie powiódł lub został anulowany, zwróć pieniądze kupującemu w inny sposób.`,
          `Stripe nie potwierdził zwrotu ${amountHtml} za anulowane zamówienie ${orderIdHtml}, a zwrot nie jest już sprawdzany automatycznie. Sprawdź go w panelu Stripe; jeśli się nie powiódł lub został anulowany, zwróć pieniądze kupującemu w inny sposób.`],
      } as const;
      const [text, html] = bodies[alert];
      return {
        subject: `[${tenantName}] ${subjects[alert]}: ${orderId}`,
        html: `<p>${html}</p><p>Ostatni błąd: ${errorHtml}</p><p><a href="${orderUrlHtml}">Otwórz zamówienie</a></p>`,
        text: `${text}\nOstatni błąd: ${error}\n${orderUrl}`,
      };
    },
  },
  stockLowEmail: {
    noThreshold: 'nie ustawiono',
    render: ({ tenantName, productTitle, productTitleHtml, available, threshold, oversold, studioUrl, studioUrlHtml }) => ({
      subject: oversold ? `[${tenantName}] Sprzedano ponad stan: ${productTitle}` : `[${tenantName}] Niski stan magazynowy: ${productTitle}`,
      html: `<p>${oversold ? `Produkt ${productTitleHtml} został sprzedany po wyczerpaniu zapasu.` : `Kończy się zapas produktu ${productTitleHtml}.`}</p><p>Dostępne: ${available}<br>Próg niskiego stanu: ${threshold}</p>${oversold ? '<p>Opłacone zamówienie wpłynęło, gdy nie było już żadnej sztuki. Sprawdź zamówienie i popraw stan magazynowy.</p>' : ''}<p><a href="${studioUrlHtml}">Otwórz produkt</a></p>`,
      text: `${oversold ? `Produkt ${productTitle} został sprzedany po wyczerpaniu zapasu.` : `Kończy się zapas produktu ${productTitle}.`}\nDostępne: ${available}\nPróg niskiego stanu: ${threshold}\n${oversold ? 'Opłacone zamówienie wpłynęło, gdy nie było już żadnej sztuki. Sprawdź zamówienie i popraw stan magazynowy.\n' : ''}${studioUrl}`,
    }),
  },
};
