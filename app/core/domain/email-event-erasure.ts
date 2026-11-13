import { z } from 'zod';

import { emailEventSchema, type EmailEvent } from './email-event.js';

const object = z.record(z.unknown());
const label = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const identifier = z.string().regex(/^[a-zA-Z0-9:._/-]{1,512}$/);
const timestamp = z.string().datetime();

const retain = (value: unknown, fields: Record<string, z.ZodType<unknown>>): Record<string, unknown> => {
  const parsed = object.safeParse(value);
  if (!parsed.success) return {};
  return Object.fromEntries(Object.entries(fields).flatMap(([key, schema]) => {
    const field = schema.safeParse(parsed.data[key]);
    return field.success ? [[key, field.data]] : [];
  }));
};

const scrubLink = (value: unknown): string => {
  if (typeof value !== 'string') return '[erased]';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '[erased]';
    let path = url.pathname;
    for (let depth = 0; depth < 8; depth += 1) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
    if (path.includes('@') || /%[0-9a-f]{2}/i.test(path)) return '[erased]';
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[erased]';
  }
};

export const scrubErasedEmailEvent = (event: EmailEvent): EmailEvent => {
  const meta = retain(event.meta, {
    sesMessageId: identifier, providerMessageId: identifier, campaignId: identifier,
    sendId: identifier, outboxId: identifier,
  });
  const raw = object.safeParse(event.meta?.['rawProviderPayload']);
  if (raw.success) {
    const payload: Record<string, unknown> = retain(raw.data, { eventType: label, notificationType: label });
    for (const [key, fields] of Object.entries({
      mail: { messageId: identifier, timestamp },
      delivery: { timestamp },
      bounce: { timestamp, bounceType: label, bounceSubType: label },
      complaint: { timestamp, complaintFeedbackType: label },
      open: { timestamp },
      click: { timestamp },
    })) {
      if (raw.data[key] !== undefined) payload[key] = retain(raw.data[key], fields);
    }
    meta['rawProviderPayload'] = payload;
  }
  if (event.type === 'bounced') {
    const classification = z.enum(['hard', 'soft', 'unresolved', 'complaint']).safeParse(event.meta.classification);
    meta['classification'] = classification.success ? classification.data : 'unresolved';
    meta['rawProviderPayload'] ??= {};
  }
  if (event.type === 'clicked') meta['linkUrl'] = scrubLink(event.meta.linkUrl);
  if (event.type === 'accepted') meta['sesMessageId'] ??= '[erased]';
  if (event.type === 'failed' || event.type === 'uncertain') meta['error'] = '[erased]';
  if (event.type === 'skipped') meta['reason'] = '[erased]';
  return emailEventSchema.parse({ ...event, meta });
};
