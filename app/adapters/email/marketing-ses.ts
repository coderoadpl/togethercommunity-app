import { GetSendQuotaCommand, SendRawEmailCommand, SESClient } from '@aws-sdk/client-ses';

import { appError, integrationUnavailable, ok, validation, marketingReplyToSchema, type AppError, type Result } from '#core/domain/index.js';
import type { SesMarketingCredentials, SesMarketingSender } from '#core/server/index.js';

export interface RawSesClient {
  sendRaw(input: { raw: Uint8Array; configurationSet: string | null; campaignSendId?: string; timeoutMs?: number }): Promise<{ messageId: string | null }>;
  getQuota(): Promise<{ maxSendRate: number; max24HourSend: number; sentLast24Hours: number }>;
}

const awsClient = (credentials: SesMarketingCredentials): RawSesClient => {
  const client = new SESClient({
    region: credentials.region,
    maxAttempts: 1,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
  });
  return {
    sendRaw: async ({ raw, configurationSet, campaignSendId, timeoutMs }) => {
      const output = await client.send(new SendRawEmailCommand({
        RawMessage: { Data: raw },
        ...(campaignSendId === undefined ? {} : { Tags: [{ Name: 'together-send-id', Value: campaignSendId }] }),
        ...(configurationSet === null ? {} : { ConfigurationSetName: configurationSet }),
      }), { abortSignal: AbortSignal.timeout(timeoutMs ?? 10000) });
      return { messageId: output.MessageId ?? null };
    },
    getQuota: async () => {
      const output = await client.send(new GetSendQuotaCommand({}), { abortSignal: AbortSignal.timeout(5000) });
      return {
        maxSendRate: output.MaxSendRate ?? 0,
        max24HourSend: output.Max24HourSend ?? 0,
        sentLast24Hours: output.SentLast24Hours ?? 0,
      };
    },
  };
};

const hasLineBreak = (value: string): boolean => value.includes('\r') || value.includes('\n');

const encodedWords = (value: string): string => {
  const bytes = Buffer.from(value);
  const words: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 30) {
    words.push(`=?UTF-8?B?${bytes.subarray(offset, offset + 30).toString('base64')}?=`);
  }
  return words.join(' ');
};

const foldHeader = (name: string, value: string): string[] => {
  const prefix = `${name}: `;
  const words = value.split(' ');
  const lines: string[] = [];
  let line = prefix;
  for (const word of words) {
    const candidate = line === prefix ? `${line}${word}` : `${line} ${word}`;
    if (candidate.length <= 78 || line === prefix) line = candidate;
    else {
      lines.push(line);
      line = ` ${word}`;
    }
  }
  lines.push(line);
  return lines;
};

const base64Lines = (value: string): string[] => Buffer.from(value)
  .toString('base64')
  .match(/.{1,76}/g) ?? [''];

const rawMessage = (input: Parameters<SesMarketingSender['send']>[0]): Result<Uint8Array, AppError> => {
  const fields = [input.from.address, input.from.name, input.to, input.subject];
  const replyTo = marketingReplyToSchema.safeParse(input.replyTo ?? input.from.address);
  if (!replyTo.success) return { ok: false, error: validation('Invalid Reply-To address') };
  const headerEntries = Object.entries(input.headers).filter(([name]) => name.toLowerCase() !== 'reply-to');
  if (fields.some(hasLineBreak) || headerEntries.some(([name, value]) =>
    hasLineBreak(name) || hasLineBreak(value) || name.includes(':') || name.trim() === '')) {
    return { ok: false, error: validation('Email headers cannot contain line breaks or invalid names') };
  }
  const boundary = `together-${Buffer.from(`${input.to}:${input.subject}`).toString('base64url').slice(0, 32)}`;
  const headerLines = [
    ...foldHeader('From', `${encodedWords(input.from.name)} <${input.from.address}>`),
    ...foldHeader('To', input.to),
    ...foldHeader('Reply-To', replyTo.data),
    ...foldHeader('Subject', encodedWords(input.subject)),
    'MIME-Version: 1.0',
    ...foldHeader('Content-Type', `multipart/alternative; boundary="${boundary}"`),
    ...headerEntries.flatMap(([name, value]) => foldHeader(name, value)),
  ];
  const bodyLines = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...base64Lines(input.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...base64Lines(input.html),
    `--${boundary}--`,
    '',
  ];
  return ok(new TextEncoder().encode([...headerLines, '', ...bodyLines].join('\r\n')));
};

export const createSesMarketingSender = (
  clientFor: (credentials: SesMarketingCredentials) => RawSesClient = awsClient,
): SesMarketingSender => ({
  send: async (input) => {
    const raw = rawMessage(input);
    if (!raw.ok) return raw;
    try {
      const sent = await clientFor(input.credentials).sendRaw({ raw: raw.value, configurationSet: input.configurationSet, ...(input.campaignSendId === undefined ? {} : { campaignSendId: input.campaignSendId }), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) });
      if (sent.messageId === null) return { ok: false, error: integrationUnavailable('SES did not return a message id') };
      return ok({ messageId: sent.messageId });
    } catch (cause) {
      if (cause instanceof Error && ['Throttling', 'ThrottlingException'].includes(cause.name)) return { ok: false, error: appError('rate_limited', 'SES throttled the request before acceptance') };
      if (cause instanceof Error && cause.name === 'MessageRejected') return { ok: false, error: validation('SES rejected the message before acceptance') };
      return { ok: false, error: integrationUnavailable(`Could not send marketing e-mail: ${String(cause)}`) };
    }
  },
});

export const readSesQuota = async (
  credentials: SesMarketingCredentials,
  clientFor: (value: SesMarketingCredentials) => RawSesClient = awsClient,
): Promise<Result<{ ratePerSecond: number; daily: number; sentLast24Hours: number; inSandbox: boolean }, AppError>> => {
  try {
    const quota = await clientFor(credentials).getQuota();
    return ok({
      ratePerSecond: quota.maxSendRate,
      daily: Math.floor(quota.max24HourSend),
      sentLast24Hours: Math.floor(quota.sentLast24Hours),
      inSandbox: quota.max24HourSend <= 200,
    });
  } catch (cause) {
    return { ok: false, error: integrationUnavailable(`Could not refresh SES quota: ${String(cause)}`) };
  }
};
