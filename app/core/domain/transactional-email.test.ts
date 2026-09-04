import { describe, expect, it } from 'vitest';

import { emailOutboxPayloadSchema } from './email-outbox.js';
import { marketingConsentConfirmation } from './marketing-email.js';
import {
  directMessage,
  emailBrandingFrom,
  emailTransportTest,
  lessonQuestion,
  magicLink,
  memberErasureRequestEmail,
  reputationAlertEmail,
  resetPassword,
  spaceEvent,
  spacePost,
  subscriptionEnded,
  subscriptionPaymentFailed,
  supportMessage,
  threadReply,
  verifyEmail,
  welcomeSignIn,
  type EmailMessage,
} from './transactional-email.js';

describe('subscription lifecycle emails', () => {
  const input = {
    tenantName: 'Acme <Studio>',
    productTitle: 'Course "One"',
    accessEndsAt: '1998-08-17T10:00:00.000Z',
  };

  it('renders payment failure in both languages and omits an absent portal link', () => {
    const pl = subscriptionPaymentFailed('pl', { ...input, billingPortalUrl: null });
    expect(pl.subject).toContain('Course "One"');
    expect(pl.html).toContain('Acme &lt;Studio&gt;');
    expect(pl.html).toContain('Course &quot;One&quot;');
    expect(pl.html).toContain('Bez opłacenia subskrypcji dostęp wygaśnie 17 sierpnia 1998.');
    expect(pl.html).not.toContain('<a ');

    const plWithPortal = subscriptionPaymentFailed('pl', {
      ...input,
      billingPortalUrl: 'https://billing.example.com/portal',
    });
    expect(plWithPortal.html).toContain('Zaktualizuj dane płatności');

    const en = subscriptionPaymentFailed('en', {
      ...input,
      billingPortalUrl: 'https://billing.example.com/portal',
    });
    expect(en.subject).toContain('Payment failed');
    expect(en.html).toContain('https://billing.example.com/portal');
    expect(en.html).toContain('Your access ends on 17 August 1998.');
    expect(en.text).toContain('Your access ends on 17 August 1998.');
  });

  it('renders ended subscription copy in both languages with an offer link', () => {
    const offerUrl = 'https://acme.example.com/';
    const pl = subscriptionEnded('pl', { ...input, offerUrl });
    expect(pl.subject).toBe('Subskrypcja „Course "One"” została zakończona');
    expect(pl.html).toContain('Zobacz ofertę');
    expect(pl.text).toContain('Dostęp do materiałów zachowasz do 17 sierpnia 1998.');
    const en = subscriptionEnded('en', { ...input, offerUrl });
    expect(en.html).toContain('View the offer');
    expect(en.text).toContain('Your access ends on 17 August 1998.');
  });

  it('formats dates in the Warsaw timezone in both languages', () => {
    const lateEvening = {
      ...input,
      accessEndsAt: '1998-08-31T22:30:00.000Z',
      offerUrl: 'https://acme.example.com/',
    };
    expect(subscriptionEnded('pl', lateEvening).text).toContain('zachowasz do 1 września 1998.');
    expect(subscriptionEnded('en', lateEvening).text).toContain('Your access ends on 1 September 1998.');
  });
});

describe('member erasure request email', () => {
  const input = {
    tenantName: 'Acme',
    memberEmail: 'member@example.com',
    requestedAt: '1998-08-17T10:00:00.000Z',
    dueAt: '1998-09-16T10:00:00.000Z',
    panelUrl: 'https://acme.example.com/panel/members/member-1',
  };

  it('renders localized dates and the panel link in Polish', () => {
    const pl = memberErasureRequestEmail('pl', input);
    expect(pl.subject).toBe('[Acme] Wniosek o usunięcie danych');
    expect(pl.html).toContain('Złożono: 17 sierpnia 1998');
    expect(pl.html).toContain('Termin realizacji: 16 września 1998');
    expect(pl.html).toContain('Otwórz wniosek w panelu');
  });

  it('renders localized dates and the panel link in English', () => {
    const en = memberErasureRequestEmail('en', input);
    expect(en.subject).toBe('[Acme] Member erasure request');
    expect(en.html).toContain('Requested: 17 August 1998');
    expect(en.html).toContain('Due: 16 September 1998');
    expect(en.text).toContain('Due: 16 September 1998');
    expect(en.html).toContain('Review request');
  });
});

describe('reputation alert email', () => {
  const input = {
    tenantName: 'Acme',
    status: 'warn' as const,
    hardBounceRate: 0.0123,
    complaintRate: 0.001,
    windowStart: '1998-08-17T10:00:00.000Z',
    windowEnd: '1998-08-24T10:00:00.000Z',
    dashboardUrl: 'https://acme.example.com/panel/marketing',
  };

  it('translates the status and the reporting window in Polish', () => {
    const pl = reputationAlertEmail('pl', input);
    expect(pl.subject).toBe('[Acme] Reputacja nadawcy: ostrzeżenie');
    expect(pl.html).toContain('<strong>ostrzeżenie</strong>');
    expect(pl.html).toContain('Okres: 17 sierpnia 1998 – 24 sierpnia 1998');
    expect(reputationAlertEmail('pl', { ...input, status: 'critical' }).subject)
      .toBe('[Acme] Reputacja nadawcy: stan krytyczny');
  });

  it('translates the status and the reporting window in English', () => {
    const en = reputationAlertEmail('en', input);
    expect(en.subject).toBe('[Acme] E-mail reputation: warning');
    expect(en.html).toContain('<strong>warning</strong>');
    expect(en.html).toContain('Window: 17 August 1998 – 24 August 1998');
    expect(reputationAlertEmail('en', { ...input, status: 'critical' }).subject)
      .toBe('[Acme] E-mail reputation: critical');
  });

  it('replaces missing rates with a Polish placeholder', () => {
    const pl = reputationAlertEmail('pl', { ...input, hardBounceRate: null, complaintRate: null });
    expect(pl.text).toContain('Odsetek twardych odbić (hard bounce): brak danych');
    expect(pl.text).toContain('Odsetek zgłoszeń spamu: brak danych');
    expect(reputationAlertEmail('en', { ...input, hardBounceRate: null, complaintRate: null }).text)
      .toContain('Hard bounce rate: n/a');
  });
});

describe('support message email', () => {
  it('renders PL and EN while escaping sender-controlled content', () => {
    const input = {
      tenantName: 'Acme <Studio>',
      memberEmail: 'member@example.com',
      memberDisplay: 'Marta & Jan',
      subject: 'Help <now>',
      body: 'Please <script>alert(1)</script>',
    };
    const branding = {
      logoUrl: null,
      accentColor: null,
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
    };
    const pl = supportMessage('pl', { ...input, branding });
    expect(pl.html).toContain('Acme &lt;Studio&gt;');
    expect(pl.html).not.toContain('<script>');
    expect(pl.html).not.toContain('youtube.com');
    const en = supportMessage('en', { ...input, branding });
    expect(en.html).toContain('Reply to: member@example.com');
    expect(en.text).not.toContain('youtube.com');
  });
});

describe('email transport test message', () => {
  it('names the tested transport in PL and EN', () => {
    expect(emailTransportTest('pl', { transport: 'resend' })).toMatchObject({
      subject: 'Together — wiadomość testowa (resend)',
      text: expect.stringContaining('Transport resend jest poprawnie skonfigurowany.'),
    });
    expect(emailTransportTest('en', { transport: 'smtp' })).toMatchObject({
      subject: 'Together test e-mail (smtp)',
      text: expect.stringContaining('Your smtp transport is configured correctly.'),
    });
  });

  it('falls back to Polish for unknown languages', () => {
    expect(emailTransportTest('de', { transport: 'ses' }).subject).toBe('Together — wiadomość testowa (ses)');
  });
});

describe('welcomeSignIn', () => {
  it('renders the Polish template', () => {
    expect(
      welcomeSignIn('pl', {
        tenantName: 'Acme Courses',
        actionUrl: 'https://acme.localhost/sign-in?token=abc',
      }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Cześć!</p><p>Twoje konto na platformie Acme Courses jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.</p><p><a href="https://acme.localhost/sign-in?token=abc">Zaloguj się i otwórz kurs</a></p>",
        "subject": "Twoje konto na platformie Acme Courses jest gotowe",
        "text": "Cześć!

      Twoje konto na platformie Acme Courses jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.

      Zaloguj się i otwórz kurs: https://acme.localhost/sign-in?token=abc",
      }
    `);
  });

  it('renders the English template', () => {
    expect(
      welcomeSignIn('en', {
        tenantName: 'Acme Courses',
        actionUrl: 'https://acme.localhost/sign-in?token=abc',
      }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Hello!</p><p>Your account on Acme Courses is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.</p><p><a href="https://acme.localhost/sign-in?token=abc">Sign in and open your course</a></p>",
        "subject": "Hello, your Acme Courses account is ready",
        "text": "Hello!

      Your account on Acme Courses is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.

      Sign in and open your course: https://acme.localhost/sign-in?token=abc",
      }
    `);
  });

  it('falls back to Polish for unknown languages', () => {
    expect(welcomeSignIn('de', { tenantName: 'Acme', actionUrl: 'https://x/y' }).subject).toBe(
      welcomeSignIn('pl', { tenantName: 'Acme', actionUrl: 'https://x/y' }).subject,
    );
  });

  it('escapes HTML in the tenant name and action url', () => {
    expect(
      welcomeSignIn('en', {
        tenantName: "Ben & Jerry's <Studio>",
        actionUrl: 'https://x/y?a=1&b=2',
      }).html,
    ).toMatchInlineSnapshot(`"<p>Hello!</p><p>Your account on Ben &amp; Jerry&#39;s &lt;Studio&gt; is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.</p><p><a href="https://x/y?a=1&amp;b=2">Sign in and open your course</a></p>"`);
  });
});

describe('resetPassword', () => {
  it('renders the Polish template', () => {
    expect(resetPassword('pl', { actionUrl: 'https://acme.localhost/reset?token=abc' })).toMatchInlineSnapshot(`
      {
        "html": "<p>Cześć!</p><p>Kliknij poniższy link, aby zresetować hasło:</p><p><a href="https://acme.localhost/reset?token=abc">Zresetuj hasło</a></p><p>Link do zresetowania hasła jest ważny przez godzinę.</p>",
        "subject": "Zresetuj hasło",
        "text": "Cześć!

      Otwórz poniższy link, aby zresetować hasło:
      https://acme.localhost/reset?token=abc

      Link do zresetowania hasła jest ważny przez godzinę.",
      }
    `);
  });

  it('renders the English template', () => {
    expect(resetPassword('en', { actionUrl: 'https://acme.localhost/reset?token=abc' })).toMatchInlineSnapshot(`
      {
        "html": "<p>Hello!</p><p>Please click the link below to reset your password:</p><p><a href="https://acme.localhost/reset?token=abc">Reset password</a></p><p>The password reset link expires in one hour.</p>",
        "subject": "Reset your password",
        "text": "Hello!

      Please open the link below to reset your password:
      https://acme.localhost/reset?token=abc

      The password reset link expires in one hour.",
      }
    `);
  });
});

describe('magicLink', () => {
  it('renders the Polish template', () => {
    expect(
      magicLink('pl', { tenantName: 'Acme Courses', url: 'https://acme.localhost/magic?token=abc' }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Cześć!</p><p>Użyj tego linku, aby zalogować się do Acme Courses:</p><p><a href="https://acme.localhost/magic?token=abc">Zaloguj się</a></p><p>Jeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.</p>",
        "subject": "Zaloguj się do Acme Courses",
        "text": "Cześć!

      Użyj tego linku, aby zalogować się do Acme Courses:
      https://acme.localhost/magic?token=abc

      Jeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.",
      }
    `);
  });

  it('renders the English template', () => {
    expect(
      magicLink('en', { tenantName: 'Acme Courses', url: 'https://acme.localhost/magic?token=abc' }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Hello!</p><p>Use this link to sign in to Acme Courses:</p><p><a href="https://acme.localhost/magic?token=abc">Sign in</a></p><p>If you did not request this email, you can ignore it.</p>",
        "subject": "Sign in to Acme Courses",
        "text": "Hello!

      Use this link to sign in to Acme Courses:
      https://acme.localhost/magic?token=abc

      If you did not request this email, you can ignore it.",
      }
    `);
  });
});

describe('notification opt-out footer', () => {
  const replyInput = {
    tenantName: 'Acme Courses',
    lessonName: 'Zmienne',
    authorDisplay: 'Ola',
    snippet: 'Dzięki!',
    url: 'https://acme.localhost/my/courses/c1/lessons/l1',
  };
  const postInput = {
    tenantName: 'Acme Courses',
    spaceName: 'Społeczność',
    authorDisplay: 'Ola',
    snippet: 'Cześć wszystkim!',
    url: 'https://acme.localhost/community/s1/posts/p1',
  };

  it('links thread-mute management from the thread-reply mail in both languages', () => {
    const pl = threadReply('pl', replyInput);
    expect(pl.html).toContain(
      `<a href="${replyInput.url}">Zarządzaj powiadomieniami</a> (możesz wyciszyć ten wątek w dyskusji)`,
    );
    expect(pl.text).toContain(`Zarządzaj powiadomieniami (możesz wyciszyć ten wątek w dyskusji): ${replyInput.url}`);

    const en = threadReply('en', replyInput);
    expect(en.html).toContain(
      `<a href="${replyInput.url}">Manage notifications</a> (you can mute this thread in the discussion)`,
    );
    expect(en.text).toContain(`Manage notifications (you can mute this thread in the discussion): ${replyInput.url}`);
  });

  it('links space-unfollow management from the space-post mail in both languages', () => {
    const pl = spacePost('pl', postInput);
    expect(pl.html).toContain(
      `<a href="${postInput.url}">Zarządzaj powiadomieniami</a> (możesz przestać obserwować tę przestrzeń)`,
    );
    expect(pl.text).toContain(`Zarządzaj powiadomieniami (możesz przestać obserwować tę przestrzeń): ${postInput.url}`);

    const en = spacePost('en', postInput);
    expect(en.html).toContain(
      `<a href="${postInput.url}">Manage notifications</a> (you can unfollow the space there)`,
    );
    expect(en.text).toContain(`Manage notifications (you can unfollow the space there): ${postInput.url}`);
  });

  it('renders lesson-question copy and thread management in both languages', () => {
    const pl = lessonQuestion('pl', replyInput);
    expect(pl.subject).toBe('Nowe pytanie pod lekcją „Zmienne”');
    expect(pl.text).toContain('Ola zadał(a) pytanie pod lekcją „Zmienne”');
    expect(pl.text).toContain('Zarządzaj powiadomieniami');

    const en = lessonQuestion('en', replyInput);
    expect(en.subject).toBe('New question under “Zmienne”');
    expect(en.text).toContain('Ola asked a question under “Zmienne”');
    expect(en.text).toContain('Manage notifications');
  });

  it('escapes angle-bracketed post excerpts in every notification mail', () => {
    const snippet = 'Generic<T> plus <script>alert(1)</script>';
    const messages = [
      threadReply('pl', { ...replyInput, snippet }),
      lessonQuestion('en', { ...replyInput, snippet }),
      spacePost('pl', { ...postInput, snippet }),
      spaceEvent('en', { ...postInput, snippet }),
      directMessage('pl', {
        tenantName: postInput.tenantName,
        senderDisplay: postInput.authorDisplay,
        snippet,
        url: postInput.url,
      }),
    ];
    for (const message of messages) {
      expect(message.html).toContain('Generic&lt;T&gt; plus &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(message.html).not.toContain('<script>');
      expect(message.text).toContain(snippet);
    }
  });
});

describe('email branding header', () => {
  const input = {
    tenantName: 'Akademia Samouka',
    actionUrl: 'https://akademia.localhost/set-password?token=abc',
  };

  it('is byte-identical to the unbranded mail when both branding fields are null', () => {
    expect(
      welcomeSignIn('pl', { ...input, branding: { logoUrl: null, accentColor: null } }),
    ).toEqual(welcomeSignIn('pl', input));
    expect(
      magicLink('en', {
        tenantName: input.tenantName,
        url: input.actionUrl,
        branding: { logoUrl: null, accentColor: null },
      }),
    ).toEqual(magicLink('en', { tenantName: input.tenantName, url: input.actionUrl }));
  });

  it('prepends the accent rule and logo to the welcome mail', () => {
    const message = welcomeSignIn('pl', {
      ...input,
      branding: { logoUrl: 'https://akademia.localhost/assets/akademia-logo.svg', accentColor: '#0E7490' },
    });
    expect(message.html.startsWith('<div style="border-top:4px solid #0E7490;')).toBe(true);
    expect(message.html).toContain('<img src="https://akademia.localhost/assets/akademia-logo.svg"');
    expect(message.text).not.toContain('img');
  });

  it('brands the magic-link mail and escapes the logo URL', () => {
    const message = magicLink('pl', {
      tenantName: input.tenantName,
      url: input.actionUrl,
      branding: { logoUrl: 'https://x.dev/logo.svg?a=1&b=2', accentColor: null },
    });
    expect(message.html).toContain('<img src="https://x.dev/logo.svg?a=1&amp;b=2"');
    expect(message.html.startsWith('<div style="border-top:4px solid #191512;')).toBe(true);
  });

  it('renders social profiles in HTML and plain-text transactional mail', () => {
    const message = welcomeSignIn('en', {
      ...input,
      branding: {
        logoUrl: null,
        accentColor: null,
        socialLinks: [{ label: 'YouTube & more', url: 'https://youtube.com/@akademia?a=1&b=2' }],
      },
    });

    expect(message.html).toContain('YouTube &amp; more');
    expect(message.html).toContain('https://youtube.com/@akademia?a=1&amp;b=2');
    expect(message.text).toContain('YouTube & more: https://youtube.com/@akademia?a=1&b=2');
  });
});

describe('emailBrandingFrom', () => {
  const baseUrl = 'https://akademia.together.test/';

  it('resolves app-relative branding assets against the tenant base URL', () => {
    expect(
      emailBrandingFrom({ logoUrl: '/api/public/assets/logo/abc.png', accentColor: '#7C2D92' }, baseUrl),
    ).toEqual({
      logoUrl: 'https://akademia.together.test/api/public/assets/logo/abc.png',
      accentColor: '#7C2D92',
      socialLinks: undefined,
    });
  });

  it('keeps absolute logo URLs and a missing logo untouched', () => {
    expect(
      emailBrandingFrom({ logoUrl: 'https://cdn.test/logo.svg', accentColor: null }, baseUrl).logoUrl,
    ).toBe('https://cdn.test/logo.svg');
    expect(emailBrandingFrom({ logoUrl: null, accentColor: null }, baseUrl).logoUrl).toBeNull();
  });

  it('takes the light-background variant and ignores a dark one beside it', () => {
    expect(
      emailBrandingFrom(
        { logoUrl: '/light.svg', logoDarkUrl: '/dark.svg', accentColor: null },
        baseUrl,
      ).logoUrl,
    ).toBe('https://akademia.together.test/light.svg');
  });

  it('falls back to the dark variant when it is the only uploaded logo', () => {
    expect(
      emailBrandingFrom({ logoUrl: null, logoDarkUrl: '/dark.svg', accentColor: null }, baseUrl).logoUrl,
    ).toBe('https://akademia.together.test/dark.svg');
  });
});

describe('transactional message catalogue', () => {
  const notification = {
    tenantName: 'Acme Courses',
    lessonName: 'Lekcja 1',
    spaceName: 'Ogłoszenia',
    authorDisplay: 'Ola',
    senderDisplay: 'Ola',
    snippet: 'Cześć!',
    url: 'https://acme.test/thread',
  };
  const linkless = new Set(['support-message', 'email-transport-test']);
  const memberWrittenSubject = new Set(['support-message']);
  const catalogue: Array<[string, (language: string) => EmailMessage]> = [
    ['welcome-sign-in', (language) => welcomeSignIn(language, { tenantName: 'Acme Courses', actionUrl: 'https://acme.test/in' })],
    ['reset-password', (language) => resetPassword(language, { actionUrl: 'https://acme.test/reset' })],
    ['verify-email', (language) => verifyEmail(language, { actionUrl: 'https://acme.test/verify' })],
    ['magic-link', (language) => magicLink(language, { tenantName: 'Acme Courses', url: 'https://acme.test/in' })],
    ['thread-reply', (language) => threadReply(language, notification)],
    ['lesson-question', (language) => lessonQuestion(language, notification)],
    ['space-post', (language) => spacePost(language, notification)],
    ['space-event', (language) => spaceEvent(language, notification)],
    ['direct-message', (language) => directMessage(language, notification)],
    ['subscription-payment-failed', (language) => subscriptionPaymentFailed(language, {
      tenantName: 'Acme Courses', productTitle: 'Kurs', accessEndsAt: '1998-08-17T10:00:00.000Z',
      billingPortalUrl: 'https://acme.test/billing',
    })],
    ['subscription-ended', (language) => subscriptionEnded(language, {
      tenantName: 'Acme Courses', productTitle: 'Kurs', accessEndsAt: '1998-08-17T10:00:00.000Z',
      offerUrl: 'https://acme.test/offer',
    })],
    ['support-message', (language) => supportMessage(language, {
      tenantName: 'Acme Courses', memberEmail: 'ola@acme.test', memberDisplay: 'Ola',
      subject: 'Pytanie', body: 'Treść',
    })],
    ['member-erasure-request', (language) => memberErasureRequestEmail(language, {
      tenantName: 'Acme Courses', memberEmail: 'ola@acme.test',
      requestedAt: '1998-08-17T10:00:00.000Z', dueAt: '1998-09-17T10:00:00.000Z',
      panelUrl: 'https://acme.test/panel',
    })],
    ['reputation-alert', (language) => reputationAlertEmail(language, {
      tenantName: 'Acme Courses', status: 'warn', hardBounceRate: 0.02, complaintRate: null,
      windowStart: '1998-08-01T10:00:00.000Z', windowEnd: '1998-08-17T10:00:00.000Z',
      dashboardUrl: 'https://acme.test/reputation',
    })],
    ['email-transport-test', (language) => emailTransportTest(language, { transport: 'ses' })],
    ['marketing-consent-confirmation', (language) => marketingConsentConfirmation({
      language, wording: 'Nowości i promocje', confirmationUrl: 'https://acme.test/confirm',
    })],
  ];

  it('holds a rendering for every outbox payload kind built from a template', () => {
    const kindsWithoutTemplate = new Set<string>(['m2m-transactional']);
    const catalogued = catalogue.map(([kind]) => kind);
    for (const option of emailOutboxPayloadSchema.options) {
      const kind: string = option.shape.kind.value;
      if (kindsWithoutTemplate.has(kind)) continue;
      expect(catalogued).toContain(kind);
    }
  });

  it.each(catalogue)('renders %s with a subject, body and CTA in both languages', (kind, render) => {
    for (const language of ['pl', 'en']) {
      const message = render(language);
      expect(message.subject.trim()).not.toBe('');
      expect(message.html.trim()).not.toBe('');
      expect(message.text.trim()).not.toBe('');
      if (linkless.has(kind)) continue;
      expect(message.html).toContain('http');
      expect(message.text).toContain('http');
    }
  });

  it.each(catalogue)('renders %s differently in Polish and English', (kind, render) => {
    expect(render('en').text).not.toEqual(render('pl').text);
    if (memberWrittenSubject.has(kind)) return;
    expect(render('en').subject).not.toEqual(render('pl').subject);
  });

  it.each(catalogue)('falls back to Polish for %s when the language is unsupported', (_kind, render) => {
    expect(render('de')).toEqual(render('pl'));
  });
});

describe('verifyEmail', () => {
  it('renders both languages with the confirmation link', () => {
    expect(verifyEmail('pl', { actionUrl: 'https://acme.test/verify' })).toMatchObject({
      subject: 'Potwierdź swój adres e-mail',
      text: expect.stringContaining('https://acme.test/verify'),
    });
    expect(verifyEmail('en', { actionUrl: 'https://acme.test/verify' })).toMatchObject({
      subject: 'Verify your email address',
      text: expect.stringContaining('Confirm that this email address belongs to you'),
    });
  });
});

describe('spaceEvent', () => {
  const input = {
    tenantName: 'Acme Courses',
    spaceName: 'Ogłoszenia',
    authorDisplay: 'Ola',
    snippet: 'Spotkanie w czwartek',
    url: 'https://acme.test/community/s1/events/e1',
  };

  it('names the space in the subject in both languages', () => {
    expect(spaceEvent('pl', input).subject).toBe('Nowe wydarzenie w przestrzeni „Ogłoszenia”');
    expect(spaceEvent('en', input).subject).toBe('New event in “Ogłoszenia”');
  });
});

describe('directMessage', () => {
  const input = {
    tenantName: 'Acme Courses',
    senderDisplay: 'Ola',
    snippet: 'Cześć!',
    url: 'https://acme.test/messages/dc1',
  };

  it('names the sender in the subject in both languages', () => {
    expect(directMessage('pl', input).subject).toBe('Nowa wiadomość od Ola');
    expect(directMessage('en', input).subject).toBe('New message from Ola');
  });
});
