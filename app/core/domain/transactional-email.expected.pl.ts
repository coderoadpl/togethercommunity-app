import type { EmailMessage } from './transactional-email.js';

export const expectedPurchaseConfirmationPl = {
  subject: 'Potwierdzenie zakupu — Workspace (#ORDER-42)',
  total: 'Razem',
  notInvoice: 'To potwierdzenie nie jest fakturą.',
};

export const purchaseDeliveryFixturesPl = {
  locker: { method: 'Paczkomat InPost', pickupPoint: { code: 'WAW01M', name: 'Paczkomat WAW01M', address: 'ul. Prosta 1, Warszawa' }, address: null },
  address: { method: 'Kurier', pickupPoint: null, address: { name: 'Jan Kowalski', line1: 'ul. Ogrodowa 5', line2: 'm. 2', postalCode: '00-950', city: 'Warszawa', country: 'PL' } },
};

export const expectedPurchaseDeliveryPl = {
  lockerHtml: '<p><strong>Dostawa</strong>: Paczkomat InPost<br>Paczkomat: WAW01M<br>ul. Prosta 1, Warszawa</p>',
  lockerText: '\n\nDostawa: Paczkomat InPost\nPaczkomat: WAW01M\nul. Prosta 1, Warszawa',
  addressHtml: '<p><strong>Dostawa</strong>: Kurier<br>Jan Kowalski<br>ul. Ogrodowa 5<br>m. 2<br>00-950 Warszawa<br>Polska</p>',
  addressText: '\n\nDostawa: Kurier\nJan Kowalski\nul. Ogrodowa 5\nm. 2\n00-950 Warszawa\nPolska',
};

export const orderShippedFixturePl = {
  tenantName: 'Acme Courses',
  shipment: {
    orderNumber: 'order-42',
    items: ['Uchwyt drukowany', 'Podstawka'],
    delivery: purchaseDeliveryFixturesPl.locker,
    carrier: 'inpost' as const,
    trackingNumber: '520000011395200025754311',
    trackingUrl: 'https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311',
  },
};

export const expectedTransactionalEmailPl: Record<string, EmailMessage> = {
  orderShipped: {
    subject: 'Zamówienie wysłane — Acme Courses (#ORDER-42)',
    html: '<p>Cześć!</p><p>Twoje zamówienie #ORDER-42 w Acme Courses zostało wysłane.</p><p><strong><a href="https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311">Śledź przesyłkę</a></strong></p><p>Wysłane produkty</p><ul><li>Uchwyt drukowany</li><li>Podstawka</li></ul><p><strong>Dostawa</strong>: Paczkomat InPost<br>Paczkomat: WAW01M<br>ul. Prosta 1, Warszawa</p><p>Numer zamówienia: order-42<br>Przewoźnik: InPost<br>Numer przesyłki: 520000011395200025754311</p>',
    text: 'Cześć!\n\nTwoje zamówienie #ORDER-42 w Acme Courses zostało wysłane.\n\nŚledź przesyłkę: https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311\n\nWysłane produkty:\n- Uchwyt drukowany\n- Podstawka\n\nDostawa: Paczkomat InPost\nPaczkomat: WAW01M\nul. Prosta 1, Warszawa\n\nNumer zamówienia: order-42\nPrzewoźnik: InPost\nNumer przesyłki: 520000011395200025754311',
  },
  welcomeSignIn: {
    subject: 'Twoje konto na platformie Acme Courses jest gotowe',
    html: '<p>Cześć!</p><p>Twoje konto na platformie Acme Courses jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.</p><p><a href="https://acme.localhost/sign-in?token=abc">Zaloguj się i otwórz kurs</a></p>',
    text: 'Cześć!\n\nTwoje konto na platformie Acme Courses jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.\n\nZaloguj się i otwórz kurs: https://acme.localhost/sign-in?token=abc',
  },
  resetPassword: {
    subject: 'Zresetuj hasło',
    html: '<p>Cześć!</p><p>Kliknij poniższy link, aby zresetować hasło:</p><p><a href="https://acme.localhost/reset?token=abc">Zresetuj hasło</a></p><p>Link do zresetowania hasła jest ważny przez godzinę.</p>',
    text: 'Cześć!\n\nOtwórz poniższy link, aby zresetować hasło:\nhttps://acme.localhost/reset?token=abc\n\nLink do zresetowania hasła jest ważny przez godzinę.',
  },
  magicLink: {
    subject: 'Zaloguj się do Acme Courses',
    html: '<p>Cześć!</p><p>Użyj tego linku, aby zalogować się do Acme Courses:</p><p><a href="https://acme.localhost/magic?token=abc">Zaloguj się</a></p><p>Jeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.</p>',
    text: 'Cześć!\n\nUżyj tego linku, aby zalogować się do Acme Courses:\nhttps://acme.localhost/magic?token=abc\n\nJeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.',
  },
  memberErasureRequestEmail: {
    subject: '[Acme] Wniosek o usunięcie danych',
    html: '<p>member@example.com złożył(a) wniosek o usunięcie konta i danych.</p><p>Złożono: 17 sierpnia 1998<br>Termin realizacji: 16 września 1998</p><p><a href="https://acme.example.com/panel/members/member-1">Otwórz wniosek w panelu</a></p>',
    text: 'member@example.com złożył(a) wniosek o usunięcie konta i danych.\nZłożono: 17 sierpnia 1998\nTermin realizacji: 16 września 1998\nhttps://acme.example.com/panel/members/member-1',
  },
  stockLowEmail: {
    subject: '[Acme] Niski stan magazynowy: Printed <poster>',
    html: '<p>Kończy się zapas produktu Printed &lt;poster&gt;.</p><p>Dostępne: 1<br>Próg niskiego stanu: 2</p><p><a href="https://acme.example.com/panel/products/product-1">Otwórz produkt</a></p>',
    text: 'Kończy się zapas produktu Printed <poster>.\nDostępne: 1\nPróg niskiego stanu: 2\nhttps://acme.example.com/panel/products/product-1',
  },
  stockOversoldEmail: {
    subject: '[Acme] Sprzedano ponad stan: Printed <poster>',
    html: '<p>Produkt Printed &lt;poster&gt; został sprzedany po wyczerpaniu zapasu.</p><p>Dostępne: 0<br>Próg niskiego stanu: nie ustawiono</p><p>Opłacone zamówienie wpłynęło, gdy nie było już żadnej sztuki. Sprawdź zamówienie i popraw stan magazynowy.</p><p><a href="https://acme.example.com/panel/products/product-1">Otwórz produkt</a></p>',
    text: 'Produkt Printed <poster> został sprzedany po wyczerpaniu zapasu.\nDostępne: 0\nPróg niskiego stanu: nie ustawiono\nOpłacone zamówienie wpłynęło, gdy nie było już żadnej sztuki. Sprawdź zamówienie i popraw stan magazynowy.\nhttps://acme.example.com/panel/products/product-1',
  },
  orderOutOfStockEmail: {
    subject: '[Acme] Zamówienie anulowane z braku towaru: order-<1>',
    html: '<p>Opłacone zamówienie wpłynęło po wyczerpaniu towaru, więc zostało anulowane. Stan magazynowy nie został zmniejszony, a zwrot całej kwoty 40,99\u00a0zł jest w toku.</p><p>Zamówienie: order-&lt;1&gt;<br>Kupujący: buyer@example.com<br>Brak towaru: Printed &lt;poster&gt;, Mug</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Opłacone zamówienie wpłynęło po wyczerpaniu towaru, więc zostało anulowane. Stan magazynowy nie został zmniejszony, a zwrot całej kwoty 40,99\u00a0zł jest w toku.\nZamówienie: order-<1>\nKupujący: buyer@example.com\nBrak towaru: Printed <poster>, Mug\nhttps://acme.example.com/panel/sales/order-1',
  },
  orderOutOfStockNothingChargedEmail: {
    subject: '[Acme] Zamówienie anulowane z braku towaru: order-<1>',
    html: '<p>Zamówienie wpłynęło po wyczerpaniu towaru, więc zostało anulowane. Stan magazynowy nie został zmniejszony, a ponieważ nie pobrano żadnej opłaty, nie ma czego zwracać.</p><p>Zamówienie: order-&lt;1&gt;<br>Kupujący: buyer@example.com<br>Brak towaru: Printed &lt;poster&gt;, Mug</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Zamówienie wpłynęło po wyczerpaniu towaru, więc zostało anulowane. Stan magazynowy nie został zmniejszony, a ponieważ nie pobrano żadnej opłaty, nie ma czego zwracać.\nZamówienie: order-<1>\nKupujący: buyer@example.com\nBrak towaru: Printed <poster>, Mug\nhttps://acme.example.com/panel/sales/order-1',
  },
  orderRefundAlertEmail: {
    subject: '[Acme] Automatyczny zwrot nie powiódł się, zwróć ręcznie: order-<1>',
    html: '<p>Automatyczny zwrot 40,99\u00a0zł za anulowane zamówienie order-&lt;1&gt; nie mógł zostać zrealizowany i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.</p><p>Ostatni błąd: The provided key does not have the required &lt;permissions&gt;</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Automatyczny zwrot 40,99\u00a0zł za anulowane zamówienie order-<1> nie mógł zostać zrealizowany i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.\nOstatni błąd: The provided key does not have the required <permissions>\nhttps://acme.example.com/panel/sales/order-1',
  },
  staffRefundFailedAlertEmail: {
    subject: '[Acme] Zwrot zlecony przez zespół nie powiódł się, nic nie zwrócono: order-<1>',
    html: '<p>Osoba z zespołu zleciła zwrot 40,99\u00a0zł za zamówienie order-&lt;1&gt;.</p><p>Zwrot nie powiódł się i nie będzie już ponawiany. To zlecenie niczego nie zwróciło. Zleć zwrot ponownie na stronie zamówienia albo zwróć płatność ręcznie w panelu Stripe.</p><p>Towar przywrócony do magazynu i zamówienie zdjęte z listy do spakowania przy tym zwrocie pozostają bez zmian. Jeśli zamówienie ma jednak zostać wysłane, przywróć je do pakowania na stronie zamówienia.</p><p>Ostatni błąd: Stripe rejected the refund: &lt;declined&gt;</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Osoba z zespołu zleciła zwrot 40,99\u00a0zł za zamówienie order-<1>.\nZwrot nie powiódł się i nie będzie już ponawiany. To zlecenie niczego nie zwróciło. Zleć zwrot ponownie na stronie zamówienia albo zwróć płatność ręcznie w panelu Stripe.\nTowar przywrócony do magazynu i zamówienie zdjęte z listy do spakowania przy tym zwrocie pozostają bez zmian. Jeśli zamówienie ma jednak zostać wysłane, przywróć je do pakowania na stronie zamówienia.\nOstatni błąd: Stripe rejected the refund: <declined>\nhttps://acme.example.com/panel/sales/order-1',
  },
  staffRefundFailedAfterSubmissionAlertEmail: {
    subject: '[Acme] Zwrot zlecony przez zespół nie powiódł się po zleceniu: order-<1>',
    html: '<p>Osoba z zespołu zleciła zwrot 40,99\u00a0zł za zamówienie order-&lt;1&gt;.</p><p>Stripe zgłasza, że zwrot nie powiódł się po zleceniu, więc pieniądze nie trafiły do kupującego. Zleć zwrot ponownie na stronie zamówienia albo zwróć pieniądze w inny sposób.</p><p>Zamówienie zdjęte z listy do spakowania przy tym zwrocie pozostaje poza nią. Jeśli zamówienie ma jednak zostać wysłane, przywróć je do pakowania na stronie zamówienia.</p><p>Jeśli Stripe zgłosił już wcześniej zwrot, zamówienie jest oznaczone jako zwrócone, a dostęp, który dawało, wygasł; ten dostęp nie wraca automatycznie: nadaj go ponownie na stronie uczestnika.</p><p>Ostatni błąd: Stripe rejected the refund: &lt;declined&gt;</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Osoba z zespołu zleciła zwrot 40,99\u00a0zł za zamówienie order-<1>.\nStripe zgłasza, że zwrot nie powiódł się po zleceniu, więc pieniądze nie trafiły do kupującego. Zleć zwrot ponownie na stronie zamówienia albo zwróć pieniądze w inny sposób.\nZamówienie zdjęte z listy do spakowania przy tym zwrocie pozostaje poza nią. Jeśli zamówienie ma jednak zostać wysłane, przywróć je do pakowania na stronie zamówienia.\nJeśli Stripe zgłosił już wcześniej zwrot, zamówienie jest oznaczone jako zwrócone, a dostęp, który dawało, wygasł; ten dostęp nie wraca automatycznie: nadaj go ponownie na stronie uczestnika.\nOstatni błąd: Stripe rejected the refund: <declined>\nhttps://acme.example.com/panel/sales/order-1',
  },
  orderRefundBlockedAlertEmail: {
    subject: '[Acme] Automatyczny zwrot zablokowany przez brak uprawnienia w Stripe: order-<1>',
    html: '<p>Zwrot 40,99\u00a0zł za anulowane zamówienie order-&lt;1&gt; nie został zlecony, bo ograniczony klucz Stripe tej przestrzeni nie ma uprawnienia Charges and Refunds (zapis). Dodaj to uprawnienie do klucza w panelu Stripe; oczekujące zwroty zostaną wtedy wypłacone przy najbliższej cogodzinnej próbie. Próby są ponawiane co godzinę przez 72 godziny.</p><p>Ostatni błąd: The provided key does not have the required &lt;permissions&gt;</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Zwrot 40,99\u00a0zł za anulowane zamówienie order-<1> nie został zlecony, bo ograniczony klucz Stripe tej przestrzeni nie ma uprawnienia Charges and Refunds (zapis). Dodaj to uprawnienie do klucza w panelu Stripe; oczekujące zwroty zostaną wtedy wypłacone przy najbliższej cogodzinnej próbie. Próby są ponawiane co godzinę przez 72 godziny.\nOstatni błąd: The provided key does not have the required <permissions>\nhttps://acme.example.com/panel/sales/order-1',
  },
  orderRefundBlockedFailedAlertEmail: {
    subject: '[Acme] Automatyczny zwrot nadal zablokowany po 72 godzinach, zwróć ręcznie: order-<1>',
    html: '<p>Zwrot 40,99\u00a0zł za anulowane zamówienie order-&lt;1&gt; był nadal blokowany przez brak uprawnienia Charges and Refunds (zapis) po 72 godzinach cogodzinnych prób i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.</p><p>Ostatni błąd: The provided key does not have the required &lt;permissions&gt;</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Zwrot 40,99\u00a0zł za anulowane zamówienie order-<1> był nadal blokowany przez brak uprawnienia Charges and Refunds (zapis) po 72 godzinach cogodzinnych prób i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.\nOstatni błąd: The provided key does not have the required <permissions>\nhttps://acme.example.com/panel/sales/order-1',
  },
  orderRefundUnconfirmedAlertEmail: {
    subject: '[Acme] Stripe nie potwierdził zwrotu, sprawdź go ręcznie: order-<1>',
    html: '<p>Stripe nie potwierdził zwrotu 40,99\u00a0zł za anulowane zamówienie order-&lt;1&gt;, a zwrot nie jest już sprawdzany automatycznie. Sprawdź go w panelu Stripe; jeśli się nie powiódł lub został anulowany, zwróć pieniądze kupującemu w inny sposób.</p><p>Ostatni błąd: Refund still pending at the last scheduled status check</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Stripe nie potwierdził zwrotu 40,99\u00a0zł za anulowane zamówienie order-<1>, a zwrot nie jest już sprawdzany automatycznie. Sprawdź go w panelu Stripe; jeśli się nie powiódł lub został anulowany, zwróć pieniądze kupującemu w inny sposób.\nOstatni błąd: Refund still pending at the last scheduled status check\nhttps://acme.example.com/panel/sales/order-1',
  },
  orderSoldOutRefundEmail: {
    subject: 'Zamówienie anulowane, zwracamy całą kwotę — Acme <Shop> (#ORDER-<1)',
    html: '<p>Cześć!</p><p>Płatność za zamówienie #ORDER-&lt;1 na platformie Acme &lt;Shop&gt; wpłynęła, gdy towar był już wyprzedany, więc całe zamówienie zostało anulowane i nic nie zostanie wysłane.</p><p>Numer zamówienia: order-&lt;1&gt;<br>Wyprzedane: Printed &lt;poster&gt;, Mug</p><p>Automatycznie zleciliśmy zwrot całej kwoty 40,99\u00a0zł na metodę płatności, której użyto. Nie musisz nic robić.</p><p>Kiedy pieniądze wrócą:</p><ul><li>Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych.</li><li>BLIK: zwrot trwa około 120 minut.</li><li>Przelewy24: zwrot wpływa jako osobny przelew w ciągu 3 dni roboczych.</li><li>Inne metody płatności: czas zależy od operatora płatności.</li></ul><p>Przepraszamy za kłopot.</p><p><a href="https://acme.example.com/">Przejdź do sklepu</a></p>',
    text: 'Cześć!\n\nPłatność za zamówienie #ORDER-<1 na platformie Acme <Shop> wpłynęła, gdy towar był już wyprzedany, więc całe zamówienie zostało anulowane i nic nie zostanie wysłane.\n\nNumer zamówienia: order-<1>\nWyprzedane: Printed <poster>, Mug\n\nAutomatycznie zleciliśmy zwrot całej kwoty 40,99\u00a0zł na metodę płatności, której użyto. Nie musisz nic robić.\n\nKiedy pieniądze wrócą:\n- Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych.\n- BLIK: zwrot trwa około 120 minut.\n- Przelewy24: zwrot wpływa jako osobny przelew w ciągu 3 dni roboczych.\n- Inne metody płatności: czas zależy od operatora płatności.\n\nPrzepraszamy za kłopot.\n\nPrzejdź do sklepu: https://acme.example.com/',
  },
  orderRefundIssuedEmail: {
    subject: 'Zwrot 15,00\u00a0zł w drodze — Acme <Shop> (#ORDER-<1)',
    html: '<p>Cześć!</p><p>Zwrot 15,00\u00a0zł za zamówienie #ORDER-&lt;1 na platformie Acme &lt;Shop&gt; został zlecony na metodę płatności, której użyto. Nie musisz nic robić.</p><p>Kiedy pieniądze wrócą:</p><ul><li>Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie zwykle pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych, zależnie od banku.</li><li>Inne metody płatności: czas zwykle zależy od metody płatności i banku.</li></ul><p><a href="https://acme.example.com/">Przejdź do sklepu</a></p>',
    text: 'Cześć!\n\nZwrot 15,00\u00a0zł za zamówienie #ORDER-<1 na platformie Acme <Shop> został zlecony na metodę płatności, której użyto. Nie musisz nic robić.\n\nKiedy pieniądze wrócą:\n- Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie zwykle pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych, zależnie od banku.\n- Inne metody płatności: czas zwykle zależy od metody płatności i banku.\n\nPrzejdź do sklepu: https://acme.example.com/',
  },
  emailTransportTest: {
    subject: 'Together — wiadomość testowa (resend)',
    html: '<p>Transport resend jest poprawnie skonfigurowany.</p><p>Ta wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.</p>',
    text: 'Transport resend jest poprawnie skonfigurowany.\n\nTa wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.',
  },
  lessonQuestion: {
    subject: 'Nowe pytanie pod lekcją „Variables” — Acme Courses',
    html: '<p>Cześć!</p><p>Alex zadał(a) pytanie pod lekcją „Variables” na platformie Acme Courses:</p><blockquote>Thanks!</blockquote><p><a href="https://acme.localhost/my/courses/c1/lessons/l1">Otwórz pytanie</a></p><p style="font-size:12px;color:#64646b"><a href="https://acme.localhost/my/courses/c1/lessons/l1">Zarządzaj powiadomieniami</a> (możesz wyciszyć ten wątek w dyskusji)</p>',
    text: 'Cześć!\n\nAlex zadał(a) pytanie pod lekcją „Variables” na platformie Acme Courses:\n\nThanks!\n\nOtwórz pytanie: https://acme.localhost/my/courses/c1/lessons/l1\n\nZarządzaj powiadomieniami (możesz wyciszyć ten wątek w dyskusji): https://acme.localhost/my/courses/c1/lessons/l1',
  },
  spaceEvent: {
    subject: 'Nowe wydarzenie w przestrzeni „Announcements” — Acme Courses',
    html: '<p>Cześć!</p><p>Alex zaplanował(a) wydarzenie w przestrzeni „Announcements” na platformie Acme Courses:</p><blockquote>Thursday meetup</blockquote><p><a href="https://acme.test/community/s1/events/e1">Otwórz wydarzenie</a></p><p style="font-size:12px;color:#64646b"><a href="https://acme.test/community/s1/events/e1">Zarządzaj powiadomieniami</a> (możesz przestać obserwować tę przestrzeń)</p>',
    text: 'Cześć!\n\nAlex zaplanował(a) wydarzenie w przestrzeni „Announcements” na platformie Acme Courses:\n\nThursday meetup\n\nOtwórz wydarzenie: https://acme.test/community/s1/events/e1\n\nZarządzaj powiadomieniami (możesz przestać obserwować tę przestrzeń): https://acme.test/community/s1/events/e1',
  },
  directMessage: {
    subject: 'Nowa wiadomość od Alex — Acme Courses',
    html: '<p>Cześć!</p><p>Alex wysłał(a) Ci wiadomość na platformie Acme Courses:</p><blockquote>Hello!</blockquote><p><a href="https://acme.test/messages/dc1">Otwórz rozmowę</a></p><p style="font-size:12px;color:#64646b"><a href="https://acme.test/messages/dc1">Zarządzaj powiadomieniami</a> (w ustawieniach konta możesz wyłączyć wiadomości od innych uczestników)</p>',
    text: 'Cześć!\n\nAlex wysłał(a) Ci wiadomość na platformie Acme Courses:\n\nHello!\n\nOtwórz rozmowę: https://acme.test/messages/dc1\n\nZarządzaj powiadomieniami (w ustawieniach konta możesz wyłączyć wiadomości od innych uczestników): https://acme.test/messages/dc1',
  },
};

export const expectedPurchasePersonalizationPl = {
  conditionHtml: '<p><strong>Personalizacja: Printed &lt;book&gt;</strong><br>For &quot;Alex&quot; &amp; Sam<br>Zaakceptowany warunek: I understand a personalised item is made to my order.</p>',
  plainHtml: '<p><strong>Personalizacja: Card</strong><br>Hi</p>',
  conditionText: '\n\nPersonalizacja: Printed <book>\nFor "Alex" & Sam\nZaakceptowany warunek: I understand a personalised item is made to my order.',
  plainText: '\n\nPersonalizacja: Card\nHi',
};

export const expectedStaffRefundAlertPl = {
  retryingSubject: 'Zwrot zlecony przez zespół jeszcze niezrealizowany, ponawiamy',
  retrying: 'Zwrot nie dotarł jeszcze do Stripe, więc na razie nic nie zostało zwrócone. Będzie ponawiany automatycznie przez 7 dni; jeśli nadal się nie uda, dostaniesz kolejną wiadomość.',
  retryingOutcomeUnknownSubject: 'Wynik zwrotu zleconego przez zespół jeszcze nieznany, ponawiamy',
  retryingOutcomeUnknown: 'Stripe mógł już otrzymać to zlecenie zwrotu, ale jego odpowiedź nie dotarła. To samo zlecenie jest powtarzane automatycznie przez 7 dni, więc zamówienie nigdy nie zostanie zwrócone dwa razy; jeśli nadal się nie uda, dostaniesz kolejną wiadomość.',
  checkInDashboard: 'Sprawdź płatność w panelu Stripe: jeśli ten zwrot jest tam widoczny, nic więcej nie trzeba robić; jeśli go nie ma, zwróć płatność tam, a zamówienie zaktualizuje się, gdy Stripe zgłosi zwrot.',
  unconfirmedBecause: {
    create_outcome_unknown: 'Zlecenie tego zwrotu mogło dotrzeć do Stripe, ale nie udało się odczytać zwrotów płatności przed końcem automatycznych ponowień, więc nie wiadomo, czy zwrot został wypłacony.',
    awaiting_provider: 'Podczas ostatniego automatycznego sprawdzenia Stripe nadal realizował ten zwrot, a zwrot nie jest już sprawdzany automatycznie, więc nie wiadomo, czy został wypłacony.',
    refunded_outside: 'Płatność ma pełny zwrot zlecony poza platformą, którego klucz Stripe tej przestrzeni nie mógł potwierdzić, więc nie wiadomo, czy ten zwrot został wypłacony.',
    not_confirmed: 'Stripe nie potwierdził zwrotu, a zwrot nie jest już sprawdzany automatycznie, więc nie wiadomo, czy został wypłacony.',
  },
  refusalState: 'Zwrot nie powiódł się i nie będzie już ponawiany. To zlecenie niczego nie zwróciło.',
  lastErrorLabel: 'Ostatni błąd',
};
