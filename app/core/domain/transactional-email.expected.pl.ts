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

export const expectedTransactionalEmailPl: Record<string, EmailMessage> = {
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
