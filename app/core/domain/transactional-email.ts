import { z } from 'zod';

import { translateDeletedEmailContent } from './deleted-content.js';
import type { TransactionalEmailTransport } from './email-send.js';
import type { EmailIntegrationTransport } from './integration.js';
import { languageOrDefault, languageSchema, type Language } from './language.js';
import { absoluteBrandingAssetUrl, resolveTenantLogo } from './tenant.js';
import { transactionalEmailMessagesEn } from './transactional-email.en.js';
import type { NotificationFooterKind, TransactionalEmailMessages } from './transactional-email-messages.js';
import { transactionalEmailMessagesPl } from './transactional-email.pl.js';

export const transactionalLanguageSchema = languageSchema;

type TransactionalLanguage = Language;

export const emailMessageSchema = z.object({
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
});

export type EmailMessage = z.output<typeof emailMessageSchema>;

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

const dateFormatters: Record<TransactionalLanguage, Intl.DateTimeFormat> = {
  pl: new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Europe/Warsaw' }),
};

const localizedDate = (language: TransactionalLanguage, isoDateTime: string): string =>
  dateFormatters[language].format(new Date(isoDateTime));

const link = (href: string, label: string): string =>
  `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

const transactionalMessages: Record<TransactionalLanguage, TransactionalEmailMessages> = {
  pl: transactionalEmailMessagesPl,
  en: transactionalEmailMessagesEn,
};

const messagesFor = (language: string): TransactionalEmailMessages =>
  transactionalMessages[languageOrDefault(language)];

const manageNotificationsFooter = (
  messages: TransactionalEmailMessages,
  url: string,
  kind: NotificationFooterKind,
): { html: string; text: string } => {
  const hint = messages.manageNotifications.hints[kind];
  return {
    html: `<p style="font-size:12px;color:#64646b">${link(url, messages.manageNotifications.label)} (${escapeHtml(hint)})</p>`,
    text: `\n\n${messages.manageNotifications.label} (${hint}): ${url}`,
  };
};

export interface EmailBranding {
  logoUrl: string | null;
  accentColor: string | null;
  socialLinks?: Array<{ label: string; url: string }> | undefined;
}

export const emailBrandingFrom = (
  settings: {
    logoUrl: string | null;
    logoDarkUrl?: string | null | undefined;
    accentColor: string | null;
    socialLinks?: Array<{ label: string; url: string }> | undefined;
  },
  baseUrl: string,
): EmailBranding => ({
  logoUrl: absoluteBrandingAssetUrl(resolveTenantLogo(settings, 'light'), baseUrl),
  accentColor: settings.accentColor,
  socialLinks: settings.socialLinks,
});

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
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const actionLink = link(input.actionUrl, messages.welcomeSignIn.actionLabel);
  return emailMessageSchema.parse(messages.welcomeSignIn.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    actionUrl: input.actionUrl,
    actionLink,
    header,
    socialLinks,
  }));
};

export const resetPassword = (
  language: string,
  input: { actionUrl: string },
): EmailMessage => {
  const messages = messagesFor(language);
  const actionLink = link(input.actionUrl, messages.resetPassword.actionLabel);
  return emailMessageSchema.parse(messages.resetPassword.render({ actionUrl: input.actionUrl, actionLink }));
};

export const verifyEmail = (
  language: string,
  input: { actionUrl: string },
): EmailMessage => {
  const messages = messagesFor(language);
  const actionLink = link(input.actionUrl, messages.verifyEmail.actionLabel);
  return emailMessageSchema.parse(messages.verifyEmail.render({ actionUrl: input.actionUrl, actionLink }));
};

export const threadReply = (
  language: string,
  input: { tenantName: string; lessonName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const lessonName = escapeHtml(input.lessonName);
  const authorDisplay = translateDeletedEmailContent(input.authorDisplay, language);
  const snippetText = translateDeletedEmailContent(input.snippet, language);
  const author = escapeHtml(authorDisplay);
  const snippet = escapeHtml(snippetText);
  const footer = manageNotificationsFooter(messages, input.url, 'thread');
  const actionLink = link(input.url, messages.threadReply.actionLabel);
  return emailMessageSchema.parse(messages.threadReply.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    lessonName: input.lessonName,
    lessonNameHtml: lessonName,
    authorDisplay,
    authorHtml: author,
    snippetText,
    snippetHtml: snippet,
    url: input.url,
    actionLink,
    footer,
  }));
};

export const lessonQuestion = (
  language: string,
  input: { tenantName: string; lessonName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const lessonName = escapeHtml(input.lessonName);
  const authorDisplay = translateDeletedEmailContent(input.authorDisplay, language);
  const snippetText = translateDeletedEmailContent(input.snippet, language);
  const author = escapeHtml(authorDisplay);
  const snippet = escapeHtml(snippetText);
  const footer = manageNotificationsFooter(messages, input.url, 'thread');
  const actionLink = link(input.url, messages.lessonQuestion.actionLabel);
  return emailMessageSchema.parse(messages.lessonQuestion.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    lessonName: input.lessonName,
    lessonNameHtml: lessonName,
    authorDisplay,
    authorHtml: author,
    snippetText,
    snippetHtml: snippet,
    url: input.url,
    actionLink,
    footer,
  }));
};

export const spacePost = (
  language: string,
  input: { tenantName: string; spaceName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const spaceName = escapeHtml(input.spaceName);
  const authorDisplay = translateDeletedEmailContent(input.authorDisplay, language);
  const snippetText = translateDeletedEmailContent(input.snippet, language);
  const author = escapeHtml(authorDisplay);
  const snippet = escapeHtml(snippetText);
  const footer = manageNotificationsFooter(messages, input.url, 'space');
  const actionLink = link(input.url, messages.spacePost.actionLabel);
  return emailMessageSchema.parse(messages.spacePost.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    spaceName: input.spaceName,
    spaceNameHtml: spaceName,
    authorDisplay,
    authorHtml: author,
    snippetText,
    snippetHtml: snippet,
    url: input.url,
    actionLink,
    footer,
  }));
};

export const spaceEvent = (
  language: string,
  input: { tenantName: string; spaceName: string; authorDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const spaceName = escapeHtml(input.spaceName);
  const authorDisplay = translateDeletedEmailContent(input.authorDisplay, language);
  const snippetText = translateDeletedEmailContent(input.snippet, language);
  const author = escapeHtml(authorDisplay);
  const snippet = escapeHtml(snippetText);
  const footer = manageNotificationsFooter(messages, input.url, 'space');
  const actionLink = link(input.url, messages.spaceEvent.actionLabel);
  return emailMessageSchema.parse(messages.spaceEvent.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    spaceName: input.spaceName,
    spaceNameHtml: spaceName,
    authorDisplay,
    authorHtml: author,
    snippetText,
    snippetHtml: snippet,
    url: input.url,
    actionLink,
    footer,
  }));
};

export const directMessage = (
  language: string,
  input: { tenantName: string; senderDisplay: string; snippet: string; url: string },
): EmailMessage => {
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const senderDisplay = translateDeletedEmailContent(input.senderDisplay, language);
  const snippetText = translateDeletedEmailContent(input.snippet, language);
  const sender = escapeHtml(senderDisplay);
  const snippet = escapeHtml(snippetText);
  const footer = manageNotificationsFooter(messages, input.url, 'direct');
  const actionLink = link(input.url, messages.directMessage.actionLabel);
  return emailMessageSchema.parse(messages.directMessage.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    senderDisplay,
    senderHtml: sender,
    snippetText,
    snippetHtml: snippet,
    url: input.url,
    actionLink,
    footer,
  }));
};

export const magicLink = (
  language: string,
  input: { tenantName: string; url: string; branding?: EmailBranding },
): EmailMessage => {
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const actionLink = link(input.url, messages.magicLink.actionLabel);
  return emailMessageSchema.parse(messages.magicLink.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    url: input.url,
    actionLink,
    header,
    socialLinks,
  }));
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
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage];
  const tenantName = escapeHtml(input.tenantName);
  const productTitle = escapeHtml(input.productTitle);
  const accessEndsAtText = localizedDate(resolvedLanguage, input.accessEndsAt);
  const accessEndsAt = escapeHtml(accessEndsAtText);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const portal =
    input.billingPortalUrl === null
      ? ''
      : `<p>${link(input.billingPortalUrl, messages.subscriptionPaymentFailed.billingPortalLabel)}</p>`;

  return emailMessageSchema.parse(messages.subscriptionPaymentFailed.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    productTitle: input.productTitle,
    productTitleHtml: productTitle,
    accessEndsAtText,
    accessEndsAtHtml: accessEndsAt,
    billingPortalUrl: input.billingPortalUrl,
    portal,
    header,
    socialLinks,
  }));
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
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage];
  const tenantName = escapeHtml(input.tenantName);
  const productTitle = escapeHtml(input.productTitle);
  const accessEndsAtText = localizedDate(resolvedLanguage, input.accessEndsAt);
  const accessEndsAt = escapeHtml(accessEndsAtText);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const offerLink = link(input.offerUrl, messages.subscriptionEnded.offerLabel);

  return emailMessageSchema.parse(messages.subscriptionEnded.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    productTitle: input.productTitle,
    productTitleHtml: productTitle,
    accessEndsAtText,
    accessEndsAtHtml: accessEndsAt,
    offerUrl: input.offerUrl,
    offerLink,
    header,
    socialLinks,
  }));
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
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const memberEmail = escapeHtml(input.memberEmail);
  const memberDisplay = escapeHtml(input.memberDisplay);
  const subject = escapeHtml(input.subject);
  const body = escapeHtml(input.body);
  const header = brandHeader(input.branding);
  return emailMessageSchema.parse(messages.supportMessage.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    memberEmail: input.memberEmail,
    memberEmailHtml: memberEmail,
    memberDisplay: input.memberDisplay,
    memberDisplayHtml: memberDisplay,
    subject: input.subject,
    subjectHtml: subject,
    body: input.body,
    bodyHtml: body,
    header,
  }));
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
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage];
  const memberEmail = escapeHtml(input.memberEmail);
  const panelUrl = escapeHtml(input.panelUrl);
  const requestedAtText = localizedDate(resolvedLanguage, input.requestedAt);
  const dueAtText = localizedDate(resolvedLanguage, input.dueAt);
  const requestedAt = escapeHtml(requestedAtText);
  const dueAt = escapeHtml(dueAtText);
  return emailMessageSchema.parse(messages.memberErasureRequestEmail.render({
    tenantName: input.tenantName,
    memberEmail: input.memberEmail,
    memberEmailHtml: memberEmail,
    requestedAtText,
    requestedAtHtml: requestedAt,
    dueAtText,
    dueAtHtml: dueAt,
    panelUrl: input.panelUrl,
    panelUrlHtml: panelUrl,
  }));
};

export const emailTransportTest = (
  language: string,
  input: { transport: EmailIntegrationTransport | TransactionalEmailTransport },
): EmailMessage => {
  const messages = messagesFor(language);
  const transport = escapeHtml(input.transport);
  return emailMessageSchema.parse(messages.emailTransportTest.render({
    transport: input.transport,
    transportHtml: transport,
  }));
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
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage];
  const tenantName = escapeHtml(input.tenantName);
  const dashboardUrl = escapeHtml(input.dashboardUrl);
  const status = messages.reputationAlertEmail.statusLabels[input.status];
  const windowStartText = localizedDate(resolvedLanguage, input.windowStart);
  const windowEndText = localizedDate(resolvedLanguage, input.windowEnd);
  const windowStart = escapeHtml(windowStartText);
  const windowEnd = escapeHtml(windowEndText);
  const rate = (value: number | null, missing: string): string =>
    value === null ? missing : `${(value * 100).toFixed(3)}%`;
  const hardBounceRate = rate(input.hardBounceRate, messages.reputationAlertEmail.missingRate);
  const complaintRate = rate(input.complaintRate, messages.reputationAlertEmail.missingRate);
  return emailMessageSchema.parse(messages.reputationAlertEmail.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    status,
    hardBounceRate,
    complaintRate,
    windowStartText,
    windowStartHtml: windowStart,
    windowEndText,
    windowEndHtml: windowEnd,
    dashboardUrl: input.dashboardUrl,
    dashboardUrlHtml: dashboardUrl,
  }));
};
