import { z } from 'zod';

import type { TransactionalEmailTransport } from './email-send.js';
import type { EmailIntegrationTransport } from './integration.js';
import { languageSchema, type Language } from './language.js';

export const transactionalLanguageSchema = languageSchema;

type TransactionalLanguage = Language;

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

/**
 * Community notifications are recurring, so PL/EU e-privacy rules require an
 * opt-out path. The link lands on the surface that owns the toggle (thread
 * mute / space unfollow); tokenized one-click unsubscribe is future backlog.
 */
const manageNotificationsFooter = (
  language: TransactionalLanguage,
  url: string,
  hint: { pl: string; en: string },
): { html: string; text: string } =>
  language === 'en'
    ? {
        html: `<p style="font-size:12px;color:#64646b">${link(url, 'Manage notifications')} (${escapeHtml(hint.en)})</p>`,
        text: `\n\nManage notifications (${hint.en}): ${url}`,
      }
    : {
        html: `<p style="font-size:12px;color:#64646b">${link(url, 'Zarządzaj powiadomieniami')} (${escapeHtml(hint.pl)})</p>`,
        text: `\n\nZarządzaj powiadomieniami (${hint.pl}): ${url}`,
      };

export interface EmailBranding {
  logoUrl: string | null;
  accentColor: string | null;
  socialLinks?: Array<{ label: string; url: string }> | undefined;
}

/** Branding assets may be stored as app-relative paths; mail clients need absolute URLs. */
export const emailBrandingFrom = (
  settings: {
    logoUrl: string | null;
    accentColor: string | null;
    socialLinks?: Array<{ label: string; url: string }> | undefined;
  },
  baseUrl: string,
): EmailBranding => ({
  logoUrl: settings.logoUrl === null ? null : new URL(settings.logoUrl, baseUrl).toString(),
  accentColor: settings.accentColor,
  socialLinks: settings.socialLinks,
});

/** Tenant-branded header; an empty string (byte-identical mail) without branding. */
const brandHeader = (branding: EmailBranding | undefined): string => {
  if (branding === undefined || (branding.logoUrl === null && branding.accentColor === null)) return '';
  const rule = `<div style="border-top:4px solid ${escapeHtml(branding.accentColor ?? '#191512')};margin-bottom:16px"></div>`;
  const logo =
    branding.logoUrl === null
      ? ''
      : `<img src="${escapeHtml(branding.logoUrl)}" alt="" height="32" style="display:block;height:32px;margin-bottom:16px" />`;
  return `${rule}${logo}`;
};

const brandSocialLinks = (
  branding: EmailBranding | undefined,
): { html: string; text: string } => {
  const socialLinks = branding?.socialLinks ?? [];
  if (socialLinks.length === 0) return { html: '', text: '' };
  return {
    html: `<p style="font-size:12px;margin-top:24px">${socialLinks
      .map((item) => link(item.url, item.label))
      .join(' &middot; ')}</p>`,
    text: `\n\n${socialLinks.map((item) => `${item.label}: ${item.url}`).join(' · ')}`,
  };
};

export const welcomeSignIn = (
  language: string,
  input: { tenantName: string; actionUrl: string; branding?: EmailBranding },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const actionLink = link(
    input.actionUrl,
    languageOrDefault(language) === 'en'
      ? 'Sign in and open your course'
      : 'Zaloguj się i otwórz kurs',
  );

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `Hello, your ${input.tenantName} account is ready`,
      html: `${header}<p>Hello!</p><p>Your account on ${tenantName} is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.</p><p>${actionLink}</p>${socialLinks.html}`,
      text: `Hello!\n\nYour account on ${input.tenantName} is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.\n\nSign in and open your course: ${input.actionUrl}${socialLinks.text}`,
    });
  }

  return emailMessageSchema.parse({
    subject: `Cześć, Twoje konto ${input.tenantName} jest gotowe`,
    html: `${header}<p>Cześć!</p><p>Twoje konto na platformie ${tenantName} jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.</p><p>${actionLink}</p>${socialLinks.html}`,
    text: `Cześć!\n\nTwoje konto na platformie ${input.tenantName} jest gotowe. Kliknij, aby się zalogować — link jest ważny przez godzinę. Jeśli przestanie działać, poproś o nowy na stronie logowania.\n\nZaloguj się i otwórz kurs: ${input.actionUrl}${socialLinks.text}`,
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

export const verifyEmail = (
  language: string,
  input: { actionUrl: string },
): EmailMessage => {
  const actionLink = link(input.actionUrl, languageOrDefault(language) === 'en' ? 'Verify email' : 'Potwierdź e-mail');

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: 'Verify your email address',
      html: `<p>Hello!</p><p>Confirm that this email address belongs to you:</p><p>${actionLink}</p><p>You can sign in and use Together before confirming it. Verification is required only to create a new workspace.</p><p>The link expires in one hour.</p>`,
      text: `Hello!\n\nConfirm that this email address belongs to you:\n${input.actionUrl}\n\nYou can sign in and use Together before confirming it. Verification is required only to create a new workspace.\n\nThe link expires in one hour.`,
    });
  }

  return emailMessageSchema.parse({
    subject: 'Potwierdź swój adres e-mail',
    html: `<p>Cześć!</p><p>Potwierdź, że ten adres e-mail należy do Ciebie:</p><p>${actionLink}</p><p>Możesz logować się i korzystać z Together przed potwierdzeniem adresu. Weryfikacja jest wymagana tylko do utworzenia nowej przestrzeni.</p><p>Link jest ważny przez godzinę.</p>`,
    text: `Cześć!\n\nPotwierdź, że ten adres e-mail należy do Ciebie:\n${input.actionUrl}\n\nMożesz logować się i korzystać z Together przed potwierdzeniem adresu. Weryfikacja jest wymagana tylko do utworzenia nowej przestrzeni.\n\nLink jest ważny przez godzinę.`,
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
  const footer = manageNotificationsFooter(languageOrDefault(language), input.url, {
    pl: 'w dyskusji możesz wyciszyć ten wątek',
    en: 'you can mute this thread in the discussion',
  });

  if (languageOrDefault(language) === 'en') {
    const actionLink = link(input.url, 'Open the discussion');
    return emailMessageSchema.parse({
      subject: `New reply in the "${input.lessonName}" discussion`,
      html: `<p>Hello!</p><p>${author} replied in the "${lessonName}" discussion on ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${input.authorDisplay} replied in the "${input.lessonName}" discussion on ${input.tenantName}:\n\n${input.snippet}\n\nOpen the discussion: ${input.url}${footer.text}`,
    });
  }

  const actionLink = link(input.url, 'Otwórz dyskusję');
  return emailMessageSchema.parse({
    subject: `Nowa odpowiedź w dyskusji „${input.lessonName}”`,
    html: `<p>Cześć!</p><p>${author} odpowiedział(a) w dyskusji „${lessonName}” na platformie ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
    text: `Cześć!\n\n${input.authorDisplay} odpowiedział(a) w dyskusji „${input.lessonName}” na platformie ${input.tenantName}:\n\n${input.snippet}\n\nOtwórz dyskusję: ${input.url}${footer.text}`,
  });
};

export const lessonQuestion = (
  language: string,
  input: { tenantName: string; lessonName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const lessonName = escapeHtml(input.lessonName);
  const author = escapeHtml(input.authorDisplay);
  const snippet = escapeHtml(input.snippet);
  const footer = manageNotificationsFooter(languageOrDefault(language), input.url, {
    pl: 'w dyskusji możesz wyciszyć ten wątek',
    en: 'you can mute this thread in the discussion',
  });

  if (languageOrDefault(language) === 'en') {
    const actionLink = link(input.url, 'Open the question');
    return emailMessageSchema.parse({
      subject: `New question under “${input.lessonName}”`,
      html: `<p>Hello!</p><p>${author} asked a question under “${lessonName}” on ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${input.authorDisplay} asked a question under “${input.lessonName}” on ${input.tenantName}:\n\n${input.snippet}\n\nOpen the question: ${input.url}${footer.text}`,
    });
  }

  const actionLink = link(input.url, 'Otwórz pytanie');
  return emailMessageSchema.parse({
    subject: `Nowe pytanie pod lekcją „${input.lessonName}”`,
    html: `<p>Cześć!</p><p>${author} zadał(a) pytanie pod lekcją „${lessonName}” na platformie ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
    text: `Cześć!\n\n${input.authorDisplay} zadał(a) pytanie pod lekcją „${input.lessonName}” na platformie ${input.tenantName}:\n\n${input.snippet}\n\nOtwórz pytanie: ${input.url}${footer.text}`,
  });
};

export const spacePost = (
  language: string,
  input: { tenantName: string; spaceName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const spaceName = escapeHtml(input.spaceName);
  const author = escapeHtml(input.authorDisplay);
  const snippet = escapeHtml(input.snippet);
  const footer = manageNotificationsFooter(languageOrDefault(language), input.url, {
    pl: 'w przestrzeni możesz przestać ją obserwować',
    en: 'you can unfollow the space there',
  });

  if (languageOrDefault(language) === 'en') {
    const actionLink = link(input.url, 'Open the space');
    return emailMessageSchema.parse({
      subject: `New post in “${input.spaceName}”`,
      html: `<p>Hello!</p><p>${author} posted in “${spaceName}” on ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${input.authorDisplay} posted in “${input.spaceName}” on ${input.tenantName}:\n\n${input.snippet}\n\nOpen the space: ${input.url}${footer.text}`,
    });
  }

  const actionLink = link(input.url, 'Otwórz przestrzeń');
  return emailMessageSchema.parse({
    subject: `Nowy wpis w przestrzeni „${input.spaceName}”`,
    html: `<p>Cześć!</p><p>${author} opublikował(a) wpis w przestrzeni „${spaceName}” na platformie ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
    text: `Cześć!\n\n${input.authorDisplay} opublikował(a) wpis w przestrzeni „${input.spaceName}” na platformie ${input.tenantName}:\n\n${input.snippet}\n\nOtwórz przestrzeń: ${input.url}${footer.text}`,
  });
};

export const spaceEvent = (
  language: string,
  input: { tenantName: string; spaceName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const spaceName = escapeHtml(input.spaceName);
  const author = escapeHtml(input.authorDisplay);
  const snippet = escapeHtml(input.snippet);
  const footer = manageNotificationsFooter(languageOrDefault(language), input.url, {
    pl: 'w przestrzeni możesz przestać ją obserwować',
    en: 'you can unfollow the space there',
  });

  if (languageOrDefault(language) === 'en') {
    const actionLink = link(input.url, 'Open the event');
    return emailMessageSchema.parse({
      subject: `New event in “${input.spaceName}”`,
      html: `<p>Hello!</p><p>${author} scheduled an event in “${spaceName}” on ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${input.authorDisplay} scheduled an event in “${input.spaceName}” on ${input.tenantName}:\n\n${input.snippet}\n\nOpen the event: ${input.url}${footer.text}`,
    });
  }

  const actionLink = link(input.url, 'Otwórz wydarzenie');
  return emailMessageSchema.parse({
    subject: `Nowe wydarzenie w przestrzeni „${input.spaceName}”`,
    html: `<p>Cześć!</p><p>${author} zaplanował(a) wydarzenie w przestrzeni „${spaceName}” na platformie ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
    text: `Cześć!\n\n${input.authorDisplay} zaplanował(a) wydarzenie w przestrzeni „${input.spaceName}” na platformie ${input.tenantName}:\n\n${input.snippet}\n\nOtwórz wydarzenie: ${input.url}${footer.text}`,
  });
};

export const directMessage = (
  language: string,
  input: { tenantName: string; senderDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const sender = escapeHtml(input.senderDisplay);
  const snippet = escapeHtml(input.snippet);
  const footer = manageNotificationsFooter(languageOrDefault(language), input.url, {
    pl: 'w ustawieniach konta możesz wyłączyć wiadomości od członków społeczności',
    en: 'you can turn off messages from community members in your account settings',
  });

  if (languageOrDefault(language) === 'en') {
    const actionLink = link(input.url, 'Open the conversation');
    return emailMessageSchema.parse({
      subject: `New message from ${input.senderDisplay}`,
      html: `<p>Hello!</p><p>${sender} sent you a message on ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${input.senderDisplay} sent you a message on ${input.tenantName}:\n\n${input.snippet}\n\nOpen the conversation: ${input.url}${footer.text}`,
    });
  }

  const actionLink = link(input.url, 'Otwórz rozmowę');
  return emailMessageSchema.parse({
    subject: `Nowa wiadomość od ${input.senderDisplay}`,
    html: `<p>Cześć!</p><p>${sender} wysłał(a) Ci wiadomość na platformie ${tenantName}:</p><blockquote>${snippet}</blockquote><p>${actionLink}</p>${footer.html}`,
    text: `Cześć!\n\n${input.senderDisplay} wysłał(a) Ci wiadomość na platformie ${input.tenantName}:\n\n${input.snippet}\n\nOtwórz rozmowę: ${input.url}${footer.text}`,
  });
};

export const magicLink = (
  language: string,
  input: { tenantName: string; url: string; branding?: EmailBranding },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const actionLink = link(input.url, languageOrDefault(language) === 'en' ? 'Sign in' : 'Zaloguj się');

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `Sign in to ${input.tenantName}`,
      html: `${header}<p>Hello!</p><p>Use this link to sign in to ${tenantName}:</p><p>${actionLink}</p><p>If you did not request this email, you can ignore it.</p>${socialLinks.html}`,
      text: `Hello!\n\nUse this link to sign in to ${input.tenantName}:\n${input.url}\n\nIf you did not request this email, you can ignore it.${socialLinks.text}`,
    });
  }

  return emailMessageSchema.parse({
    subject: `Zaloguj się do ${input.tenantName}`,
    html: `${header}<p>Cześć!</p><p>Użyj tego linku, aby zalogować się do ${tenantName}:</p><p>${actionLink}</p><p>Jeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.</p>${socialLinks.html}`,
    text: `Cześć!\n\nUżyj tego linku, aby zalogować się do ${input.tenantName}:\n${input.url}\n\nJeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość.${socialLinks.text}`,
  });
};

export const subscriptionPaymentFailed = (
  language: string,
  input: {
    tenantName: string;
    productTitle: string;
    accessEndsAt: string;
    billingPortalUrl: string | null;
    branding?: EmailBranding;
  },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const productTitle = escapeHtml(input.productTitle);
  const accessEndsAt = escapeHtml(input.accessEndsAt);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const portal =
    input.billingPortalUrl === null
      ? ''
      : `<p>${link(input.billingPortalUrl, languageOrDefault(language) === 'en' ? 'Update billing details' : 'Zaktualizuj płatność')}</p>`;

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `Payment failed for ${input.productTitle}`,
      html: `${header}<p>Hello!</p><p>We could not collect payment for ${productTitle} on ${tenantName}.</p><p>Your access ends on ${accessEndsAt}.</p>${portal}${socialLinks.html}`,
      text: `Hello!\n\nWe could not collect payment for ${input.productTitle} on ${input.tenantName}.\n\nYour access ends on ${input.accessEndsAt}.${input.billingPortalUrl === null ? '' : `\n\nUpdate billing details: ${input.billingPortalUrl}`}${socialLinks.text}`,
    });
  }

  return emailMessageSchema.parse({
    subject: `Nie udało się pobrać płatności za ${input.productTitle}`,
    html: `${header}<p>Cześć!</p><p>Nie udało się pobrać płatności za ${productTitle} na platformie ${tenantName}.</p><p>Twój dostęp wygaśnie ${accessEndsAt}.</p>${portal}${socialLinks.html}`,
    text: `Cześć!\n\nNie udało się pobrać płatności za ${input.productTitle} na platformie ${input.tenantName}.\n\nTwój dostęp wygaśnie ${input.accessEndsAt}.${input.billingPortalUrl === null ? '' : `\n\nZaktualizuj płatność: ${input.billingPortalUrl}`}${socialLinks.text}`,
  });
};

export const subscriptionEnded = (
  language: string,
  input: {
    tenantName: string;
    productTitle: string;
    accessEndsAt: string;
    offerUrl: string;
    branding?: EmailBranding;
  },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const productTitle = escapeHtml(input.productTitle);
  const accessEndsAt = escapeHtml(input.accessEndsAt);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);

  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `Your ${input.productTitle} subscription has ended`,
      html: `${header}<p>Hello!</p><p>Your subscription to ${productTitle} on ${tenantName} has ended.</p><p>Your access ends on ${accessEndsAt}.</p><p>${link(input.offerUrl, 'View the offer')}</p>${socialLinks.html}`,
      text: `Hello!\n\nYour subscription to ${input.productTitle} on ${input.tenantName} has ended.\n\nYour access ends on ${input.accessEndsAt}.\n\nView the offer: ${input.offerUrl}${socialLinks.text}`,
    });
  }

  return emailMessageSchema.parse({
    subject: `Twoja subskrypcja ${input.productTitle} zakończyła się`,
    html: `${header}<p>Cześć!</p><p>Twoja subskrypcja ${productTitle} na platformie ${tenantName} zakończyła się.</p><p>Twój dostęp wygaśnie ${accessEndsAt}.</p><p>${link(input.offerUrl, 'Zobacz ofertę')}</p>${socialLinks.html}`,
    text: `Cześć!\n\nTwoja subskrypcja ${input.productTitle} na platformie ${input.tenantName} zakończyła się.\n\nTwój dostęp wygaśnie ${input.accessEndsAt}.\n\nZobacz ofertę: ${input.offerUrl}${socialLinks.text}`,
  });
};

export const supportMessage = (
  language: string,
  input: {
    tenantName: string;
    memberEmail: string;
    memberDisplay: string;
    subject: string;
    body: string;
    branding?: EmailBranding;
  },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const memberEmail = escapeHtml(input.memberEmail);
  const memberDisplay = escapeHtml(input.memberDisplay);
  const subject = escapeHtml(input.subject);
  const body = escapeHtml(input.body);
  const header = brandHeader(input.branding);
  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `[${input.tenantName}] ${input.subject}`,
      html: `${header}<p>Support message from ${memberDisplay} on ${tenantName}.</p><p>Reply to: ${memberEmail}</p><p><strong>${subject}</strong></p><blockquote>${body}</blockquote>`,
      text: `Support message from ${input.memberDisplay} on ${input.tenantName}.\n\nReply to: ${input.memberEmail}\n\n${input.subject}\n\n${input.body}`,
    });
  }
  return emailMessageSchema.parse({
    subject: `[${input.tenantName}] ${input.subject}`,
    html: `${header}<p>Wiadomość do wsparcia od ${memberDisplay} na platformie ${tenantName}.</p><p>Odpowiedz do: ${memberEmail}</p><p><strong>${subject}</strong></p><blockquote>${body}</blockquote>`,
    text: `Wiadomość do wsparcia od ${input.memberDisplay} na platformie ${input.tenantName}.\n\nOdpowiedz do: ${input.memberEmail}\n\n${input.subject}\n\n${input.body}`,
  });
};

export const memberErasureRequestEmail = (
  language: string,
  input: {
    tenantName: string;
    memberEmail: string;
    requestedAt: string;
    dueAt: string;
    panelUrl: string;
  },
): EmailMessage => {
  const memberEmail = escapeHtml(input.memberEmail);
  const panelUrl = escapeHtml(input.panelUrl);
  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `[${input.tenantName}] Member erasure request`,
      html: `<p>${memberEmail} requested account erasure.</p><p>Requested: ${input.requestedAt}<br>Due: ${input.dueAt}</p><p><a href="${panelUrl}">Review request</a></p>`,
      text: `${input.memberEmail} requested account erasure.\nRequested: ${input.requestedAt}\nDue: ${input.dueAt}\n${input.panelUrl}`,
    });
  }
  return emailMessageSchema.parse({
    subject: `[${input.tenantName}] Wniosek o usunięcie danych`,
    html: `<p>${memberEmail} wysłał(a) wniosek o usunięcie danych.</p><p>Złożono: ${input.requestedAt}<br>Termin: ${input.dueAt}</p><p><a href="${panelUrl}">Sprawdź wniosek</a></p>`,
    text: `${input.memberEmail} wysłał(a) wniosek o usunięcie danych.\nZłożono: ${input.requestedAt}\nTermin: ${input.dueAt}\n${input.panelUrl}`,
  });
};

export const emailTransportTest = (
  language: string,
  input: { transport: EmailIntegrationTransport | TransactionalEmailTransport },
): EmailMessage => {
  const transport = escapeHtml(input.transport);
  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `Together test e-mail (${input.transport})`,
      html: `<p>Your ${transport} transport is configured correctly.</p><p>This message was sent from the panel to confirm delivery.</p>`,
      text: `Your ${input.transport} transport is configured correctly.\n\nThis message was sent from the panel to confirm delivery.`,
    });
  }
  return emailMessageSchema.parse({
    subject: `Together — wiadomość testowa (${input.transport})`,
    html: `<p>Transport ${transport} jest poprawnie skonfigurowany.</p><p>Ta wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.</p>`,
    text: `Transport ${input.transport} jest poprawnie skonfigurowany.\n\nTa wiadomość została wysłana z panelu, aby potwierdzić dostarczanie.`,
  });
};

export const reputationAlertEmail = (
  language: string,
  input: {
    tenantName: string;
    status: 'warn' | 'critical';
    hardBounceRate: number | null;
    complaintRate: number | null;
    windowStart: string;
    windowEnd: string;
    dashboardUrl: string;
  },
): EmailMessage => {
  const tenantName = escapeHtml(input.tenantName);
  const dashboardUrl = escapeHtml(input.dashboardUrl);
  const hardBounceRate =
    input.hardBounceRate === null
      ? 'n/a'
      : `${(input.hardBounceRate * 100).toFixed(3)}%`;
  const complaintRate =
    input.complaintRate === null
      ? 'n/a'
      : `${(input.complaintRate * 100).toFixed(3)}%`;
  if (languageOrDefault(language) === 'en') {
    return emailMessageSchema.parse({
      subject: `[${input.tenantName}] E-mail reputation ${input.status}`,
      html: `<p>E-mail reputation for ${tenantName} is <strong>${input.status}</strong>.</p><p>Hard bounce rate: ${hardBounceRate}<br>Complaint rate: ${complaintRate}<br>Window: ${input.windowStart} – ${input.windowEnd}</p><p><a href="${dashboardUrl}">Review reputation</a></p>`,
      text: `E-mail reputation for ${input.tenantName} is ${input.status}.\nHard bounce rate: ${hardBounceRate}\nComplaint rate: ${complaintRate}\nWindow: ${input.windowStart} – ${input.windowEnd}\n${input.dashboardUrl}`,
    });
  }
  return emailMessageSchema.parse({
    subject: `[${input.tenantName}] Reputacja e-mail: ${input.status}`,
    html: `<p>Reputacja e-mail dla ${tenantName} ma status <strong>${input.status}</strong>.</p><p>Współczynnik trwałych odbić: ${hardBounceRate}<br>Współczynnik skarg: ${complaintRate}<br>Okres: ${input.windowStart} – ${input.windowEnd}</p><p><a href="${dashboardUrl}">Sprawdź reputację</a></p>`,
    text: `Reputacja e-mail dla ${input.tenantName} ma status ${input.status}.\nWspółczynnik trwałych odbić: ${hardBounceRate}\nWspółczynnik skarg: ${complaintRate}\nOkres: ${input.windowStart} – ${input.windowEnd}\n${input.dashboardUrl}`,
  });
};
