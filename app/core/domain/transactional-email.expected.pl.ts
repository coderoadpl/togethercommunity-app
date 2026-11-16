import type { EmailMessage } from './transactional-email.js';

export const expectedPurchaseConfirmationPl = {
  subject: 'Potwierdzenie zakupu order-42 — Workspace',
  total: 'Razem',
  notInvoice: 'To potwierdzenie zakupu nie jest fakturą. Jeśli potrzebujesz faktury, skontaktuj się z nami.',
};

export const purchaseDeliveryFixturesPl = {
  locker: { method: 'Paczkomat InPost', pickupPoint: { code: 'WAW01M', name: 'Paczkomat WAW01M', address: 'ul. Prosta 1, Warszawa' }, address: null },
  address: { method: 'Kurier', pickupPoint: null, address: { name: 'Jan Kowalski', line1: 'ul. Ogrodowa 5', line2: 'm. 2', postalCode: '00-950', city: 'Warszawa', country: 'PL' } },
};

export const expectedPurchaseDeliveryPl = {
  lockerHtml: '<p><strong>Dostawa</strong>: Paczkomat InPost<br>Paczkomat: WAW01M<br>Paczkomat WAW01M<br>ul. Prosta 1, Warszawa</p>',
  lockerText: '\n\nDostawa: Paczkomat InPost\nPaczkomat: WAW01M\nPaczkomat WAW01M\nul. Prosta 1, Warszawa',
  addressHtml: '<p><strong>Dostawa</strong>: Kurier<br>Jan Kowalski<br>ul. Ogrodowa 5<br>m. 2<br>00-950 Warszawa<br>PL</p>',
  addressText: '\n\nDostawa: Kurier\nJan Kowalski\nul. Ogrodowa 5\nm. 2\n00-950 Warszawa\nPL',
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
    subject: 'Twoje zamówienie order-42 zostało wysłane — Acme Courses',
    html: '<p>Cześć!</p><p>Twoje zamówienie order-42 w Acme Courses zostało wysłane.</p><p>Wysłane produkty</p><ul><li>Uchwyt drukowany</li><li>Podstawka</li></ul><p><strong>Dostawa</strong>: Paczkomat InPost<br>Paczkomat: WAW01M<br>Paczkomat WAW01M<br>ul. Prosta 1, Warszawa</p><p><strong>Przewoźnik</strong>: InPost<br>Numer przesyłki: 520000011395200025754311<br><a href="https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311">Śledź przesyłkę</a></p>',
    text: 'Cześć!\n\nTwoje zamówienie order-42 w Acme Courses zostało wysłane.\n\nWysłane produkty:\n- Uchwyt drukowany\n- Podstawka\n\nDostawa: Paczkomat InPost\nPaczkomat: WAW01M\nPaczkomat WAW01M\nul. Prosta 1, Warszawa\n\nPrzewoźnik: InPost\nNumer przesyłki: 520000011395200025754311\nŚledź przesyłkę: https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311',
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
  orderRefundAlertEmail: {
    subject: '[Acme] Automatyczny zwrot nie powiódł się, zwróć ręcznie: order-<1>',
    html: '<p>Automatyczny zwrot 40,99\u00a0zł za anulowane zamówienie order-&lt;1&gt; nie mógł zostać zrealizowany i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.</p><p>Ostatni błąd: The provided key does not have the required &lt;permissions&gt;</p><p><a href="https://acme.example.com/panel/sales/order-1">Otwórz zamówienie</a></p>',
    text: 'Automatyczny zwrot 40,99\u00a0zł za anulowane zamówienie order-<1> nie mógł zostać zrealizowany i nie będzie już ponawiany. Zwróć płatność ręcznie w panelu Stripe.\nOstatni błąd: The provided key does not have the required <permissions>\nhttps://acme.example.com/panel/sales/order-1',
  },
  orderSoldOutRefundEmail: {
    subject: 'Zamówienie order-<1> anulowane: towar wyprzedany, zwracamy całą kwotę',
    html: '<p>Cześć!</p><p>Płatność za zamówienie order-&lt;1&gt; na platformie Acme &lt;Shop&gt; wpłynęła, gdy towar był już wyprzedany, więc całe zamówienie zostało anulowane i nic nie zostanie wysłane.</p><p>Wyprzedane: Printed &lt;poster&gt;, Mug</p><p>Automatycznie zleciliśmy zwrot całej kwoty 40,99\u00a0zł na metodę płatności, której użyto. Nie musisz nic robić.</p><p>Kiedy pieniądze wrócą:</p><ul><li>Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych.</li><li>BLIK: zwrot trwa około 120 minut.</li><li>Przelewy24: zwrot wpływa jako osobny przelew w ciągu 3 dni roboczych.</li><li>Inne metody płatności: czas zależy od operatora płatności.</li></ul><p>Przepraszamy za kłopot.</p><p><a href="https://acme.example.com/">Przejdź do sklepu</a></p>',
    text: 'Cześć!\n\nPłatność za zamówienie order-<1> na platformie Acme <Shop> wpłynęła, gdy towar był już wyprzedany, więc całe zamówienie zostało anulowane i nic nie zostanie wysłane.\n\nWyprzedane: Printed <poster>, Mug\n\nAutomatycznie zleciliśmy zwrot całej kwoty 40,99\u00a0zł na metodę płatności, której użyto. Nie musisz nic robić.\n\nKiedy pieniądze wrócą:\n- Karta: zwrot zlecony wkrótce po płatności zwykle ma postać anulowania transakcji, więc obciążenie znika z wyciągu; w przeciwnym razie pojawia się jako osobny przelew zwrotny po około 5–10 dniach roboczych.\n- BLIK: zwrot trwa około 120 minut.\n- Przelewy24: zwrot wpływa jako osobny przelew w ciągu 3 dni roboczych.\n- Inne metody płatności: czas zależy od operatora płatności.\n\nPrzepraszamy za kłopot.\n\nPrzejdź do sklepu: https://acme.example.com/',
  },
  emailTransportTest: {
    subject: 'Together — wiadomość testowa (resend)',
    html: '<p>Transport resend jest poprawnie skonfigurowany.</p><p>Ta wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.</p>',
    text: 'Transport resend jest poprawnie skonfigurowany.\n\nTa wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.',
  },
  lessonQuestion: {
    subject: 'Nowe pytanie pod lekcją „Variables”',
    html: '<p>Cześć!</p><p>Alex zadał(a) pytanie pod lekcją „Variables” na platformie Acme Courses:</p><blockquote>Thanks!</blockquote><p><a href="https://acme.localhost/my/courses/c1/lessons/l1">Otwórz pytanie</a></p><p style="font-size:12px;color:#64646b"><a href="https://acme.localhost/my/courses/c1/lessons/l1">Zarządzaj powiadomieniami</a> (możesz wyciszyć ten wątek w dyskusji)</p>',
    text: 'Cześć!\n\nAlex zadał(a) pytanie pod lekcją „Variables” na platformie Acme Courses:\n\nThanks!\n\nOtwórz pytanie: https://acme.localhost/my/courses/c1/lessons/l1\n\nZarządzaj powiadomieniami (możesz wyciszyć ten wątek w dyskusji): https://acme.localhost/my/courses/c1/lessons/l1',
  },
  spaceEvent: {
    subject: 'Nowe wydarzenie w przestrzeni „Announcements”',
    html: '<p>Cześć!</p><p>Alex zaplanował(a) wydarzenie w przestrzeni „Announcements” na platformie Acme Courses:</p><blockquote>Thursday meetup</blockquote><p><a href="https://acme.test/community/s1/events/e1">Otwórz wydarzenie</a></p><p style="font-size:12px;color:#64646b"><a href="https://acme.test/community/s1/events/e1">Zarządzaj powiadomieniami</a> (możesz przestać obserwować tę przestrzeń)</p>',
    text: 'Cześć!\n\nAlex zaplanował(a) wydarzenie w przestrzeni „Announcements” na platformie Acme Courses:\n\nThursday meetup\n\nOtwórz wydarzenie: https://acme.test/community/s1/events/e1\n\nZarządzaj powiadomieniami (możesz przestać obserwować tę przestrzeń): https://acme.test/community/s1/events/e1',
  },
  directMessage: {
    subject: 'Nowa wiadomość od Alex',
    html: '<p>Cześć!</p><p>Alex wysłał(a) Ci wiadomość na platformie Acme Courses:</p><blockquote>Hello!</blockquote><p><a href="https://acme.test/messages/dc1">Otwórz rozmowę</a></p><p style="font-size:12px;color:#64646b"><a href="https://acme.test/messages/dc1">Zarządzaj powiadomieniami</a> (w ustawieniach konta możesz wyłączyć wiadomości od innych uczestników)</p>',
    text: 'Cześć!\n\nAlex wysłał(a) Ci wiadomość na platformie Acme Courses:\n\nHello!\n\nOtwórz rozmowę: https://acme.test/messages/dc1\n\nZarządzaj powiadomieniami (w ustawieniach konta możesz wyłączyć wiadomości od innych uczestników): https://acme.test/messages/dc1',
  },
};
