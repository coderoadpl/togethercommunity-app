import { describe, expect, it } from 'vitest';

import { magicLink, resetPassword, welcomeSetPassword } from './transactional-email.js';

describe('welcomeSetPassword', () => {
  it('renders the Polish template', () => {
    expect(
      welcomeSetPassword('pl', {
        tenantName: 'Acme Courses',
        actionUrl: 'https://acme.localhost/set-password?token=abc',
      }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Cześć!</p><p>Twoje konto na platformie Acme Courses zostało utworzone.</p><p>Zanim zaczniesz, ustaw swoje hasło: <a href="https://acme.localhost/set-password?token=abc">Ustaw hasło</a></p><p>Link do ustawienia hasła jest ważny jedną godzinę. Jeśli przestanie działać, poproś o nowy link resetowania hasła na stronie logowania.</p>",
        "subject": "Cześć, Twoje konto Acme Courses jest gotowe",
        "text": "Cześć!

      Twoje konto na platformie Acme Courses zostało utworzone.

      Zanim zaczniesz, ustaw swoje hasło: https://acme.localhost/set-password?token=abc

      Link do ustawienia hasła jest ważny jedną godzinę. Jeśli przestanie działać, poproś o nowy link resetowania hasła na stronie logowania.",
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
        "html": "<p>Cześć!</p><p>Kliknij poniższy link, aby zresetować hasło:</p><p><a href="https://acme.localhost/reset?token=abc">Zresetuj hasło</a></p><p>Link do zmiany hasła jest ważny jedną godzinę.</p>",
        "subject": "Zresetuj hasło",
        "text": "Cześć!

      Otwórz poniższy link, aby zresetować hasło:
      https://acme.localhost/reset?token=abc

      Link do zmiany hasła jest ważny jedną godzinę.",
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
        "html": "<p>Cześć!</p><p>Użyj tego linku, aby zalogować się do Acme Courses:</p><p><a href="https://acme.localhost/magic?token=abc">Zaloguj się</a></p><p>Jeśli nie prosisz o tę wiadomość, możesz ją zignorować.</p>",
        "subject": "Zaloguj się do Acme Courses",
        "text": "Cześć!

      Użyj tego linku, aby zalogować się do Acme Courses:
      https://acme.localhost/magic?token=abc

      Jeśli nie prosisz o tę wiadomość, możesz ją zignorować.",
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
