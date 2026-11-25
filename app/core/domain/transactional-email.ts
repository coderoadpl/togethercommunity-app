import { z } from 'zod';

import { orderLineLabel } from './commerce.js';
import { translateDeletedEmailContent } from './deleted-content.js';
import { deriveLightAccent } from './color.js';
import type { TransactionalEmailTransport } from './email-send.js';
import type { EmailIntegrationTransport } from './integration.js';
import { languageOrDefault, languageSchema, type Language } from './language.js';
import type { OrderRefundAlert } from './order-refund-job.js';
import { currencyFractionDigits, type StaffRefundReason } from './order-staff-refund.js';
import { currencySchema, productTypeSchema } from './product.js';
import { productVatRateSchema } from './product-vat.js';
import { absoluteBrandingAssetUrl, resolveTenantLogo } from './tenant.js';
import { transactionalEmailMessagesEn } from './transactional-email.en.js';
import type { NotificationFooterKind, TransactionalEmailMessages, WelcomeSignInProductType } from './transactional-email-messages.js';
import { transactionalEmailMessagesPl } from './transactional-email.pl.js';

export const transactionalLanguageSchema = languageSchema;

type TransactionalLanguage = Language;

export const emailMessageSchema = z.object({
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
});

export type EmailMessage = z.output<typeof emailMessageSchema>;

const purchaseLineSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().min(1).optional(),
  grossCents: z.number().int().nonnegative(),
  vatRate: productVatRateSchema.nullable(),
});

const purchaseDeliverySchema = z.object({
  method: z.string().min(1),
  pickupPoint: z.object({ code: z.string().min(1), name: z.string().nullable(), address: z.string().nullable() }).nullable(),
  address: z.object({
    name: z.string(),
    line1: z.string(),
    line2: z.string().nullable(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
  }).nullable(),
});

const purchasePersonalizationSchema = z.object({
  name: z.string().min(1),
  text: z.string(),
  condition: z.string().nullable(),
});

export const welcomeSignInProductTypeSchema = z.union([productTypeSchema, z.literal('unknown')]);

export const purchaseEmailDetailsSchema = z.object({
  orderNumber: z.string().min(1),
  verificationUrl: z.string().url(),
  qrImageUrl: z.string().url(),
  lines: z.array(z.union([z.string().min(1), purchaseLineSchema])).min(1),
  currency: currencySchema.optional(),
  totalCents: z.number().int().nonnegative().optional(),
  delivery: purchaseDeliverySchema.optional(),
  personalizations: z.array(purchasePersonalizationSchema).optional(),
  productTypes: z.array(welcomeSignInProductTypeSchema).min(1).optional(),
  signInPageUrl: z.string().url().optional(),
  contactUrl: z.string().url().nullable().optional(),
}).refine((purchase) => (purchase.currency === undefined) === (purchase.totalCents === undefined), {
  message: 'Currency and total must both be present or both be absent',
});

export const orderShippedEmailDetailsSchema = z.object({
  orderNumber: z.string().min(1),
  items: z.array(z.string().min(1)).min(1),
  delivery: purchaseDeliverySchema,
  carrier: z.enum(['inpost', 'other']),
  trackingNumber: z.string().min(1),
  trackingUrl: z.string().url().nullable(),
});

export type OrderShippedEmailDetails = z.output<typeof orderShippedEmailDetailsSchema>;

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

const shortOrderReference = (orderId: string): string => `#${orderId.slice(0, 8).toUpperCase()}`;

const countryName = (language: TransactionalLanguage, code: string): string => {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  return new Intl.DisplayNames([language === 'pl' ? 'pl-PL' : 'en-GB'], { type: 'region' }).of(code) ?? code;
};

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

export const emailContactUrl = (
  settings: { supportEmail?: string | null | undefined; supportUrl?: string | null | undefined } | null,
  baseUrl: string,
): string | null => {
  if (settings === null) return null;
  if (settings.supportEmail !== null && settings.supportEmail !== undefined) return new URL('/account?support=open', baseUrl).toString();
  return settings.supportUrl ?? null;
};

export const emailBrandingFrom = (
  settings: {
    logoUrl: string | null;
    logoDarkUrl?: string | null | undefined;
    accentColor: string | null;
    accentLight?: string | null | undefined;
    socialLinks?: Array<{ label: string; url: string }> | undefined;
  },
  baseUrl: string,
): EmailBranding => ({
  logoUrl: absoluteBrandingAssetUrl(resolveTenantLogo(settings, 'light'), baseUrl),
  accentColor: settings.accentLight ?? (settings.accentColor === null ? null : deriveLightAccent(settings.accentColor)),
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

const purchaseItems = (
  language: string,
  purchase: z.output<typeof purchaseEmailDetailsSchema>,
  labels: TransactionalEmailMessages['purchase'],
): { html: string; text: string } => {
  if (purchase.currency === undefined || purchase.totalCents === undefined || !purchase.lines.every((line) => typeof line !== 'string')) {
    const names = purchase.lines.map((line) => typeof line === 'string' ? line : orderLineLabel(line));
    return {
      html: `<ul>${names.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`,
      text: names.map((name) => `- ${name}`).join('\n'),
    };
  }
  const formatter = new Intl.NumberFormat(languageOrDefault(language) === 'pl' ? 'pl-PL' : 'en-GB', {
    style: 'currency', currency: purchase.currency,
  });
  const lines = purchase.lines.map((line) => ({
    name: orderLineLabel(line),
    amount: formatter.format(line.grossCents / 100),
    vat: line.vatRate === null ? null : line.vatRate === 'exempt' ? labels.exempt : `${String(line.vatRate)}\u00a0%`,
  }));
  const total = formatter.format(purchase.totalCents / 100);
  const cell = 'padding:8px;text-align:left';
  const amountCell = 'padding:8px;text-align:right;white-space:nowrap';
  const totalCell = 'border-top:1px solid #d4d4d8';
  return {
    html: `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${cell}">${escapeHtml(labels.item)}</th><th style="${amountCell}">${escapeHtml(labels.amount)}</th><th style="${amountCell}">${escapeHtml(labels.vat)}</th></tr></thead><tbody>${lines.map((line) => `<tr><td style="${cell}">${escapeHtml(line.name)}</td><td style="${amountCell}">${escapeHtml(line.amount)}</td><td style="${amountCell}">${escapeHtml(line.vat ?? '—')}</td></tr>`).join('')}<tr><td style="${cell};${totalCell}"><strong>${escapeHtml(labels.total)}</strong></td><td style="${amountCell};${totalCell}"><strong>${escapeHtml(total)}</strong></td><td style="${amountCell};${totalCell}"></td></tr></tbody></table>`,
    text: `${lines.map((line) => `- ${line.name} — ${line.amount}${line.vat === null ? '' : ` (${line.vat})`}`).join('\n')}\n${labels.total}: ${total}`,
  };
};

const purchaseDelivery = (
  language: string,
  delivery: z.output<typeof purchaseDeliverySchema> | undefined,
  labels: TransactionalEmailMessages['purchase'],
): { html: string; text: string } => {
  if (delivery === undefined) return { html: '', text: '' };
  const point = delivery.pickupPoint;
  const address = delivery.address;
  const present = (value: string | null): value is string => value !== null && value !== '';
  const repeatsCode = (name: string | null, code: string) =>
    name !== null && name.toUpperCase().includes(code.toUpperCase());
  const destination = point !== null
    ? [`${labels.pickupPoint}: ${point.code}`, ...[repeatsCode(point.name, point.code) ? null : point.name, point.address].filter(present)]
    : address === null
      ? []
      : [address.name, address.line1, address.line2, `${address.postalCode} ${address.city}`.trim(), countryName(languageOrDefault(language), address.country)].filter(present);
  return {
    html: `<p><strong>${escapeHtml(labels.delivery)}</strong>: ${escapeHtml(delivery.method)}${destination.map((value) => `<br>${escapeHtml(value)}`).join('')}</p>`,
    text: `\n\n${labels.delivery}: ${delivery.method}${destination.map((value) => `\n${value}`).join('')}`,
  };
};

const purchasePersonalizations = (
  personalizations: z.output<typeof purchasePersonalizationSchema>[] | undefined,
  labels: TransactionalEmailMessages['purchase'],
): { html: string; text: string } => {
  const entries = personalizations ?? [];
  return {
    html: entries.map((entry) => `<p><strong>${escapeHtml(labels.personalization)}: ${escapeHtml(entry.name)}</strong><br>${escapeHtml(entry.text)}${entry.condition === null ? '' : `<br>${escapeHtml(labels.personalizationCondition)}: ${escapeHtml(entry.condition)}`}</p>`).join(''),
    text: entries.map((entry) => `\n\n${labels.personalization}: ${entry.name}\n${entry.text}${entry.condition === null ? '' : `\n${labels.personalizationCondition}: ${entry.condition}`}`).join(''),
  };
};

export const welcomeSignIn = (
  language: string,
  input: { tenantName: string; actionUrl: string; branding?: EmailBranding; productType?: WelcomeSignInProductType; purchase?: z.output<typeof purchaseEmailDetailsSchema> },
): EmailMessage => {
  const messages = messagesFor(language);
  const tenantName = escapeHtml(input.tenantName);
  const header = brandHeader(input.branding);
  const socialLinks = brandSocialLinks(input.branding);
  const productType = input.productType ?? 'course';
  const purchase = input.purchase;
  const actionLabel = messages.welcomeSignIn.actionLabels[productType];
  const actionLink = link(input.actionUrl, actionLabel);
  if (purchase !== undefined) {
    return purchaseConfirmation(language, { ...input, purchase, productType, actionLabel, actionLink, header, socialLinks });
  }
  return emailMessageSchema.parse(messages.welcomeSignIn.render({
    tenantName: input.tenantName,
    tenantNameHtml: tenantName,
    actionUrl: input.actionUrl,
    actionLink,
    actionLabel,
    header,
    socialLinks,
  }));
};

const purchaseConfirmation = (
  language: string,
  input: {
    tenantName: string;
    actionUrl: string;
    actionLabel: string;
    actionLink: string;
    productType: WelcomeSignInProductType;
    purchase: z.output<typeof purchaseEmailDetailsSchema>;
    header: string;
    socialLinks: { html: string; text: string };
  },
): EmailMessage => {
  const labels = messagesFor(language).purchase;
  const { purchase } = input;
  const items = purchaseItems(language, purchase, labels);
  const delivery = purchaseDelivery(language, purchase.delivery, labels);
  const personalizations = purchasePersonalizations(purchase.personalizations, labels);
  const productTypes = [...new Set(purchase.productTypes ?? [input.productType])];
  const nextSteps = productTypes.map((type) =>
    type === 'physical' && purchase.delivery === undefined ? labels.collectInPerson : labels.nextSteps[type]);
  const orderReference = shortOrderReference(purchase.orderNumber);
  const intro = [labels.paymentReceived(orderReference, input.tenantName), ...nextSteps].join(' ');
  const introHtml = [labels.paymentReceived(escapeHtml(orderReference), escapeHtml(input.tenantName)), ...nextSteps].join(' ');
  const signInLaterHtml = purchase.signInPageUrl === undefined
    ? ''
    : ` ${labels.signInLater(link(purchase.signInPageUrl, labels.signInPageLabel))}`;
  const signInLaterText = purchase.signInPageUrl === undefined
    ? ''
    : `\n${labels.signInLater(`${labels.signInPageLabel} (${purchase.signInPageUrl})`)}`;
  const contactUrl = purchase.contactUrl ?? null;
  const invoiceHtml = contactUrl === null
    ? escapeHtml(labels.notInvoice)
    : `${escapeHtml(labels.notInvoice)} ${labels.invoiceContact(link(contactUrl, labels.contactLabel))}`;
  const invoiceText = contactUrl === null
    ? labels.notInvoice
    : `${labels.notInvoice} ${labels.invoiceContact(`${labels.contactLabel} (${contactUrl})`)}`;
  return emailMessageSchema.parse({
    subject: labels.subject(orderReference, input.tenantName),
    html: `${input.header}<h1>${escapeHtml(labels.heading)}</h1><p>${introHtml}</p><p><strong>${escapeHtml(labels.orderNumber)}:</strong> ${escapeHtml(purchase.orderNumber)}</p><p><strong>${escapeHtml(labels.lines)}</strong></p>${items.html}${personalizations.html}${delivery.html}<p><strong>${input.actionLink}</strong></p><p>${escapeHtml(labels.signInValidity)}${signInLaterHtml}</p><p>${invoiceHtml}</p><p>${escapeHtml(labels.verification)}</p><img src="${escapeHtml(purchase.qrImageUrl)}" alt="${escapeHtml(labels.qrAlt)}" width="256" height="256" />${input.socialLinks.html}`,
    text: `${labels.heading}\n\n${intro}\n\n${labels.orderNumber}: ${purchase.orderNumber}\n${labels.lines}:\n${items.text}${personalizations.text}${delivery.text}\n\n${input.actionLabel}: ${input.actionUrl}\n${labels.signInValidity}${signInLaterText}\n\n${invoiceText}\n\n${labels.verificationText}${input.socialLinks.text}`,
  });
};

export const orderShipped = (
  language: string,
  input: { tenantName: string; shipment: OrderShippedEmailDetails; branding?: EmailBranding },
): EmailMessage => {
  const messages = messagesFor(language);
  const labels = messages.orderShipped;
  const { shipment } = input;
  const orderReference = shortOrderReference(shipment.orderNumber);
  const carrierLines = shipment.carrier === 'other' ? [] : [[labels.carrier, labels.carriers[shipment.carrier]] as const];
  const trackingLines = [
    [messages.purchase.orderNumber, shipment.orderNumber] as const,
    ...carrierLines,
    [labels.trackingNumber, shipment.trackingNumber] as const,
  ];
  return emailMessageSchema.parse(labels.render({
    tenantName: input.tenantName,
    tenantNameHtml: escapeHtml(input.tenantName),
    orderReference,
    orderReferenceHtml: escapeHtml(orderReference),
    track: shipment.trackingUrl === null
      ? { html: '', text: '' }
      : { html: `<p><strong>${link(shipment.trackingUrl, labels.trackLabel)}</strong></p>`, text: `\n\n${labels.trackLabel}: ${shipment.trackingUrl}` },
    items: {
      html: `<p>${escapeHtml(labels.items)}</p><ul>${shipment.items.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`,
      text: `\n\n${labels.items}:\n${shipment.items.map((name) => `- ${name}`).join('\n')}`,
    },
    delivery: purchaseDelivery(language, shipment.delivery, messages.purchase),
    tracking: {
      html: `<p>${trackingLines.map(([label, value]) => `${escapeHtml(label)}: ${escapeHtml(value)}`).join('<br>')}</p>`,
      text: `\n\n${trackingLines.map(([label, value]) => `${label}: ${value}`).join('\n')}`,
    },
    header: brandHeader(input.branding),
    socialLinks: brandSocialLinks(input.branding),
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
    contactUrl?: string | null;
    workspaceUrl?: string | null;
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
    contactUrl: input.contactUrl ?? null,
    contactLink: input.contactUrl === undefined || input.contactUrl === null
      ? null
      : link(input.contactUrl, messages.subscriptionPaymentFailed.contactLabel),
    workspaceUrl: input.workspaceUrl ?? null,
    workspaceLink: input.workspaceUrl === undefined || input.workspaceUrl === null
      ? null
      : link(input.workspaceUrl, messages.subscriptionPaymentFailed.workspaceLabel(input.tenantName)),
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

export const stockLowEmail = (
  language: string,
  input: {
    tenantName: string;
    productTitle: string;
    available: number;
    threshold: number | null;
    oversold: boolean;
    studioUrl: string;
  },
): EmailMessage => {
  const messages = messagesFor(language);
  return emailMessageSchema.parse(messages.stockLowEmail.render({
    tenantName: input.tenantName,
    productTitle: input.productTitle,
    productTitleHtml: escapeHtml(input.productTitle),
    available: String(input.available),
    threshold: input.threshold === null ? messages.stockLowEmail.noThreshold : String(input.threshold),
    oversold: input.oversold,
    studioUrl: input.studioUrl,
    studioUrlHtml: escapeHtml(input.studioUrl),
  }));
};

export const paymentEventRejectedEmail = (
  language: string,
  input: {
    tenantName: string;
    eventId: string;
    checkoutSessionId: string | null;
    reasonCode: string;
    reasonMessage: string;
    firstSeenAt: string;
    studioUrl: string;
  },
): EmailMessage => {
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage];
  const checkoutSession = input.checkoutSessionId ?? messages.paymentEventRejectedEmail.noCheckoutSession;
  const reason = `${input.reasonCode}: ${input.reasonMessage}`;
  const firstSeenText = localizedDate(resolvedLanguage, input.firstSeenAt);
  return emailMessageSchema.parse(messages.paymentEventRejectedEmail.render({
    tenantName: input.tenantName,
    reference: input.checkoutSessionId ?? input.eventId,
    eventId: input.eventId,
    eventIdHtml: escapeHtml(input.eventId),
    checkoutSession,
    checkoutSessionHtml: escapeHtml(checkoutSession),
    reason,
    reasonHtml: escapeHtml(reason),
    firstSeenText,
    firstSeenHtml: escapeHtml(firstSeenText),
    studioUrl: input.studioUrl,
    studioUrlHtml: escapeHtml(input.studioUrl),
  }));
};

export const orderOutOfStockEmail = (
  language: string,
  input: {
    tenantName: string;
    orderId: string;
    buyerEmail: string;
    amountCents: number;
    currency: string;
    productTitles: readonly string[];
    orderUrl: string;
  },
): EmailMessage => {
  const resolvedLanguage = languageOrDefault(language);
  const amount = new Intl.NumberFormat(resolvedLanguage === 'pl' ? 'pl-PL' : 'en-GB', { style: 'currency', currency: input.currency })
    .format(input.amountCents / 100);
  const productTitles = input.productTitles.join(', ');
  return emailMessageSchema.parse(transactionalMessages[resolvedLanguage].orderOutOfStockEmail.render({
    tenantName: input.tenantName,
    orderId: input.orderId,
    orderIdHtml: escapeHtml(input.orderId),
    buyerEmail: input.buyerEmail,
    buyerEmailHtml: escapeHtml(input.buyerEmail),
    refund: input.amountCents > 0 ? { amount, amountHtml: escapeHtml(amount) } : null,
    productTitles,
    productTitlesHtml: escapeHtml(productTitles),
    orderUrl: input.orderUrl,
    orderUrlHtml: escapeHtml(input.orderUrl),
  }));
};

export const orderSoldOutRefundEmail = (
  language: string,
  input: {
    tenantName: string;
    orderId: string;
    amountCents: number;
    currency: string;
    productTitles: readonly string[];
    shopUrl: string;
    branding?: EmailBranding;
  },
): EmailMessage => {
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage];
  const amount = new Intl.NumberFormat(resolvedLanguage === 'pl' ? 'pl-PL' : 'en-GB', { style: 'currency', currency: input.currency })
    .format(input.amountCents / 100);
  const productTitles = input.productTitles.join(', ');
  return emailMessageSchema.parse(messages.orderSoldOutRefundEmail.render({
    header: brandHeader(input.branding),
    socialLinks: brandSocialLinks(input.branding),
    tenantName: input.tenantName,
    tenantNameHtml: escapeHtml(input.tenantName),
    orderId: input.orderId,
    orderIdHtml: escapeHtml(input.orderId),
    orderReference: shortOrderReference(input.orderId),
    orderReferenceHtml: escapeHtml(shortOrderReference(input.orderId)),
    productTitles,
    productTitlesHtml: escapeHtml(productTitles),
    refund: input.amountCents > 0 ? { amount, amountHtml: escapeHtml(amount) } : null,
    shopUrl: input.shopUrl,
    shopLink: link(input.shopUrl, messages.orderSoldOutRefundEmail.shopLabel),
  }));
};

const minorUnitsAmount = (language: string, amountCents: number, currency: string): string =>
  new Intl.NumberFormat(language === 'pl' ? 'pl-PL' : 'en-GB', { style: 'currency', currency }).format(amountCents / 10 ** currencyFractionDigits(currency));

export const orderRefundIssuedEmail = (
  language: string,
  input: {
    tenantName: string;
    orderId: string;
    amountCents: number;
    currency: string;
    shopUrl: string;
    branding?: EmailBranding;
  },
): EmailMessage => {
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage];
  const amount = minorUnitsAmount(resolvedLanguage, input.amountCents, input.currency);
  const orderReference = shortOrderReference(input.orderId);
  return emailMessageSchema.parse(messages.orderRefundIssuedEmail.render({
    header: brandHeader(input.branding),
    socialLinks: brandSocialLinks(input.branding),
    tenantName: input.tenantName,
    tenantNameHtml: escapeHtml(input.tenantName),
    orderReference,
    orderReferenceHtml: escapeHtml(orderReference),
    amount,
    amountHtml: escapeHtml(amount),
    shopUrl: input.shopUrl,
    shopLink: link(input.shopUrl, messages.orderRefundIssuedEmail.shopLabel),
  }));
};

export const staffRefundAlertEmail = (
  language: string,
  input: {
    tenantName: string;
    alert: OrderRefundAlert;
    orderId: string;
    amountCents: number;
    currency: string;
    mayHaveRefunded: boolean;
    reason: StaffRefundReason | null;
    restocked: boolean;
    removedFromPackingList: boolean;
    diagnostic: string;
    orderUrl: string;
  },
): EmailMessage => {
  const resolvedLanguage = languageOrDefault(language);
  const messages = transactionalMessages[resolvedLanguage].staffRefundAlertEmail;
  const amount = minorUnitsAmount(resolvedLanguage, input.amountCents, input.currency);
  const paragraphs = (escape: (value: string) => string): string[] => [
    ...messages.paragraphs({ ...input, amount: escape(amount), orderId: escape(input.orderId) }),
    ...(input.diagnostic === '' ? [] : [`${messages.lastErrorLabel}: ${escape(input.diagnostic)}`]),
  ];
  return emailMessageSchema.parse({
    subject: `[${input.tenantName}] ${input.alert === 'retrying' && input.mayHaveRefunded ? messages.retryingOutcomeUnknownSubject : messages.subjects[input.alert]}: ${input.orderId}`,
    html: `${paragraphs(escapeHtml).map((paragraph) => `<p>${paragraph}</p>`).join('')}<p>${link(input.orderUrl, messages.openOrder)}</p>`,
    text: `${paragraphs((value) => value).join('\n')}\n${input.orderUrl}`,
  });
};

export const orderRefundAlertEmail = (
  language: string,
  input: {
    tenantName: string;
    alert: OrderRefundAlert;
    orderId: string;
    amountCents: number;
    currency: string;
    error: string;
    orderUrl: string;
  },
): EmailMessage => {
  const resolvedLanguage = languageOrDefault(language);
  const amount = new Intl.NumberFormat(resolvedLanguage === 'pl' ? 'pl-PL' : 'en-GB', { style: 'currency', currency: input.currency })
    .format(input.amountCents / 100);
  return emailMessageSchema.parse(transactionalMessages[resolvedLanguage].orderRefundAlertEmail.render({
    tenantName: input.tenantName,
    alert: input.alert,
    orderId: input.orderId,
    orderIdHtml: escapeHtml(input.orderId),
    amount,
    amountHtml: escapeHtml(amount),
    error: input.error,
    errorHtml: escapeHtml(input.error),
    orderUrl: input.orderUrl,
    orderUrlHtml: escapeHtml(input.orderUrl),
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
