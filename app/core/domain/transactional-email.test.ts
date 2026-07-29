import { describe, expect, it } from 'vitest';

import {
  lessonQuestion,
  magicLink,
  resetPassword,
  spacePost,
  subscriptionEnded,
  subscriptionPaymentFailed,
  supportMessage,
  threadReply,
  welcomeSetPassword,
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
    expect(pl.html).not.toContain('<a ');

    const en = subscriptionPaymentFailed('en', {
      ...input,
      billingPortalUrl: 'https://billing.example.com/portal',
    });
    expect(en.subject).toContain('Payment failed');
    expect(en.html).toContain('https://billing.example.com/portal');
  });

  it('renders ended subscription copy in both languages with an offer link', () => {
    const offerUrl = 'https://acme.example.com/';
    expect(subscriptionEnded('pl', { ...input, offerUrl }).html).toContain('Zobacz ofertę');
    expect(subscriptionEnded('en', { ...input, offerUrl }).html).toContain('View the offer');
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
    const pl = supportMessage('pl', input);
    expect(pl.html).toContain('Acme &lt;Studio&gt;');
    expect(pl.html).not.toContain('<script>');
    expect(supportMessage('en', input).html).toContain('Reply to: member@example.com');
  });
});

describe('welcomeSetPassword', () => {
  it('renders the Polish template', () => {
    expect(
      welcomeSetPassword('pl', {
        tenantName: 'Acme Courses',
        actionUrl: 'https://acme.localhost/set-password?token=abc',
      }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Cześć!</p><p>Twoje konto na platformie Acme Courses zostało utworzone.</p><p>Zanim zaczniesz, ustaw swoje hasło: <a href="https://acme.localhost/set-password?token=abc">Ustaw hasło</a></p><p>Link do ustawienia hasła jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy link na stronie logowania.</p>",
        "subject": "Cześć, Twoje konto Acme Courses jest gotowe",
        "text": "Cześć!

      Twoje konto na platformie Acme Courses zostało utworzone.

      Zanim zaczniesz, ustaw swoje hasło: https://acme.localhost/set-password?token=abc

      Link do ustawienia hasła jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy link na stronie logowania.",
      }
    `);
  });

  it('renders the English template', () => {
    expect(
      welcomeSetPassword('en', {
        tenantName: 'Acme Courses',
        actionUrl: 'https://acme.localhost/set-password?token=abc',
      }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Hello!</p><p>Your account on Acme Courses has been created.</p><p>Before you start, set your password: <a href="https://acme.localhost/set-password?token=abc">Set password</a></p><p>The password setup link expires in one hour. If it stops working, request a new password reset from the login page.</p>",
        "subject": "Hello, your Acme Courses account is ready",
        "text": "Hello!

      Your account on Acme Courses has been created.

      Before you start, set your password: https://acme.localhost/set-password?token=abc

      The password setup link expires in one hour. If it stops working, request a new password reset from the login page.",
      }
    `);
  });

  it('falls back to Polish for unknown languages', () => {
    expect(welcomeSetPassword('de', { tenantName: 'Acme', actionUrl: 'https://x/y' }).subject).toBe(
      welcomeSetPassword('pl', { tenantName: 'Acme', actionUrl: 'https://x/y' }).subject,
    );
  });

  it('escapes HTML in the tenant name and action url', () => {
    expect(
      welcomeSetPassword('en', {
        tenantName: "Ben & Jerry's <Studio>",
        actionUrl: 'https://x/y?a=1&b=2',
      }).html,
    ).toMatchInlineSnapshot(`"<p>Hello!</p><p>Your account on Ben &amp; Jerry&#39;s &lt;Studio&gt; has been created.</p><p>Before you start, set your password: <a href="https://x/y?a=1&amp;b=2">Set password</a></p><p>The password setup link expires in one hour. If it stops working, request a new password reset from the login page.</p>"`);
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
      `<a href="${replyInput.url}">Zarządzaj powiadomieniami</a> (w dyskusji możesz wyciszyć ten wątek)`,
    );
    expect(pl.text).toContain(`Zarządzaj powiadomieniami (w dyskusji możesz wyciszyć ten wątek): ${replyInput.url}`);

    const en = threadReply('en', replyInput);
    expect(en.html).toContain(
      `<a href="${replyInput.url}">Manage notifications</a> (you can mute this thread in the discussion)`,
    );
    expect(en.text).toContain(`Manage notifications (you can mute this thread in the discussion): ${replyInput.url}`);
  });

  it('links space-unfollow management from the space-post mail in both languages', () => {
    const pl = spacePost('pl', postInput);
    expect(pl.html).toContain(
      `<a href="${postInput.url}">Zarządzaj powiadomieniami</a> (w strefie możesz przestać ją obserwować)`,
    );
    expect(pl.text).toContain(`Zarządzaj powiadomieniami (w strefie możesz przestać ją obserwować): ${postInput.url}`);

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
});

describe('email branding header', () => {
  const input = {
    tenantName: 'Akademia Samouka',
    actionUrl: 'https://akademia.localhost/set-password?token=abc',
  };

  it('is byte-identical to the unbranded mail when both branding fields are null', () => {
    expect(
      welcomeSetPassword('pl', { ...input, branding: { logoUrl: null, accentColor: null } }),
    ).toEqual(welcomeSetPassword('pl', input));
    expect(
      magicLink('en', {
        tenantName: input.tenantName,
        url: input.actionUrl,
        branding: { logoUrl: null, accentColor: null },
      }),
    ).toEqual(magicLink('en', { tenantName: input.tenantName, url: input.actionUrl }));
  });

  it('prepends the accent rule and logo to the welcome mail', () => {
    const message = welcomeSetPassword('pl', {
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
});
