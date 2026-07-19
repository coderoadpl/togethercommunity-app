import { z } from 'zod';

import { languageSchema, type Language } from './language.js';

export const transactionalLanguageSchema = languageSchema;

export type TransactionalLanguage = Language;

export const emailMessageSchema = z.object({
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
});

export type EmailMessage = z.output<typeof emailMessageSchema>;

const languageOrDefault = (language: string): TransactionalLanguage =>
  transactionalLanguageSchema.safeParse(language).success && language === 'en' ? 'en' : 'pl';

const escapeHtmlCharacter = (character: string): string => {
  switch (character) {
    case '&':
      return '&amp;';
    case '<':
      return '&lt;';
    case '>':
      return '&gt;';
    case '"':
      return '&quot;';
    case "'":
      return '&#39;';
    default:
      return character;
  }
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, escapeHtmlCharacter);

const link = (href: string, label: string): string =>
  `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

export const welcomeSetPassword = (
  language: string,
  input: { tenantName: string; actionUrl: string },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const actionLink = link(input.actionUrl, languageOrDefault(language) === 'en' ? 'Set password' : 'Ustaw hasło');

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `Hello, your ${input.tenantName} account is ready`,
      html: `<p>Hello!</p><p>Your account on ${tenantName} has been created.</p><p>Before you start, set your password: ${actionLink}</p><p>The password setup link expires in one hour. If it stops working, request a new password reset from the login page.</p>`,
      text: `Hello!\n\nYour account on ${input.tenantName} has been created.\n\nBefore you start, set your password: ${input.actionUrl}\n\nThe password setup link expires in one hour. If it stops working, request a new password reset from the login page.`,
    });
  }

  return emailMessageSchema.parse({
    subject: `Cześć, Twoje konto ${input.tenantName} jest gotowe`,
    html: `<p>Cześć!</p><p>Twoje konto na platformie ${tenantName} zostało utworzone.</p><p>Zanim zaczniesz, ustaw swoje hasło: ${actionLink}</p><p>Link do ustawienia hasła jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy link na stronie logowania.</p>`,
    text: `Cześć!\n\nTwoje konto na platformie ${input.tenantName} zostało utworzone.\n\nZanim zaczniesz, ustaw swoje hasło: ${input.actionUrl}\n\nLink do ustawienia hasła jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy link na stronie logowania.`,
  });
};

export const resetPassword = (
  language: string,
  input: { actionUrl: string },
): EmailMessage => {
  const actionLink = link(input.actionUrl, languageOrDefault(language) === 'en' ? 'Reset password' : 'Zresetuj hasło');

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: 'Reset your password',
      html: `<p>Hello!</p><p>Please click the link below to reset your password:</p><p>${actionLink}</p><p>The password reset link expires in one hour.</p>`,
      text: `Hello!\n\nPlease open the link below to reset your password:\n${input.actionUrl}\n\nThe password reset link expires in one hour.`,
    });
  }

  return emailMessageSchema.parse({
    subject: 'Zresetuj hasło',
    html: `<p>Cześć!</p><p>Kliknij poniższy link, aby zresetować hasło:</p><p>${actionLink}</p><p>Link do zresetowania hasła jest ważny przez godzinę.</p>`,
    text: `Cześć!\n\nOtwórz poniższy link, aby zresetować hasło:\n${input.actionUrl}\n\nLink do zresetowania hasła jest ważny przez godzinę.`,
  });
};

export const threadReply = (
  language: string,
  input: { tenantName: string; lessonName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const lessonName = escapeHtml(input.lessonName);
  const author = escapeHtml(input.authorDisplay);
  const snippet = escapeHtml(input.snippet);

  if (languageOrDefault(language) === 'en') {
    const actionLink = link(input.url, 'Open the discussion');
    return emailMessageSchema.parse({
      subject: `New reply in the "${input.lessonName}" discussion`,
      html: `<p>Hello!</p><p>${author} replied in the "${lessonName}" discussion on ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>`,
      text: `Hello!\n\n${input.authorDisplay} replied in the "${input.lessonName}" discussion on ${input.tenantName}:\n\n${input.snippet}\n\nOpen the discussion: ${input.url}`,
    });
  }

  const actionLink = link(input.url, 'Otwórz dyskusję');
  return emailMessageSchema.parse({
    subject: `Nowa odpowiedź w dyskusji „${input.lessonName}”`,
    html: `<p>Cześć!</p><p>${author} odpowiedział(a) w dyskusji „${lessonName}” na platformie ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>`,
    text: `Cześć!\n\n${input.authorDisplay} odpowiedział(a) w dyskusji „${input.lessonName}” na platformie ${input.tenantName}:\n\n${input.snippet}\n\nOtwórz dyskusję: ${input.url}`,
  });
};

export const magicLink = (
  language: string,
  input: { tenantName: string; url: string },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const actionLink = link(input.url, languageOrDefault(language) === 'en' ? 'Sign in' : 'Zaloguj się');

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `Sign in to ${input.tenantName}`,
      html: `<p>Hello!</p><p>Use this link to sign in to ${tenantName}:</p><p>${actionLink}</p><p>If you did not request this email, you can ignore it.</p>`,
      text: `Hello!\n\nUse this link to sign in to ${input.tenantName}:\n${input.url}\n\nIf you did not request this email, you can ignore it.`,
    });
  }

  return emailMessageSchema.parse({
    subject: `Zaloguj się do ${input.tenantName}`,
    html: `<p>Cześć!</p><p>Użyj tego linku, aby zalogować się do ${tenantName}:</p><p>${actionLink}</p><p>Jeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.</p>`,
    text: `Cześć!\n\nUżyj tego linku, aby zalogować się do ${input.tenantName}:\n${input.url}\n\nJeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.`,
  });
};
