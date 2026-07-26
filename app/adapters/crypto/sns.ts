import { createVerify } from 'node:crypto';

import { forbidden, integrationUnavailable, ok, validation, type AppError, type Result } from '@core/domain/index.js';
import type { SnsVerifier, VerifiedSnsEnvelope } from '@core/server/index.js';

interface SnsEnvelope {
  Type: 'SubscriptionConfirmation' | 'Notification';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: '1' | '2';
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const stringField = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

const parseEnvelope = (value: unknown): SnsEnvelope | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = Object.fromEntries(Object.entries(value));
  const Type = stringField(record, 'Type');
  const SignatureVersion = stringField(record, 'SignatureVersion');
  const MessageId = stringField(record, 'MessageId');
  const TopicArn = stringField(record, 'TopicArn');
  const Message = stringField(record, 'Message');
  const Timestamp = stringField(record, 'Timestamp');
  const Signature = stringField(record, 'Signature');
  const SigningCertURL = stringField(record, 'SigningCertURL');
  if ((Type !== 'SubscriptionConfirmation' && Type !== 'Notification')
    || (SignatureVersion !== '1' && SignatureVersion !== '2')
    || !MessageId || !TopicArn || Message === undefined || !Timestamp || !Signature || !SigningCertURL) return null;
  const Subject = stringField(record, 'Subject');
  const SubscribeURL = stringField(record, 'SubscribeURL');
  const Token = stringField(record, 'Token');
  return { Type, MessageId, TopicArn, Message, Timestamp, SignatureVersion, Signature, SigningCertURL,
    ...(Subject === undefined ? {} : { Subject }),
    ...(SubscribeURL === undefined ? {} : { SubscribeURL }),
    ...(Token === undefined ? {} : { Token }) };
};

const trustedUrl = (value: string, region: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === `sns.${region}.amazonaws.com`
      && url.port === ''
      && url.username === ''
      && url.password === '';
  } catch {
    return false;
  }
};

const canonicalFields = (envelope: SnsEnvelope): string[] => envelope.Type === 'Notification'
  ? ['Message', 'MessageId', ...(envelope.Subject === undefined ? [] : ['Subject']), 'Timestamp', 'TopicArn', 'Type']
  : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];

const canonicalValue = (envelope: SnsEnvelope, field: string): string => {
  const values: Record<string, string | undefined> = {
    Message: envelope.Message,
    MessageId: envelope.MessageId,
    Subject: envelope.Subject,
    SubscribeURL: envelope.SubscribeURL,
    Timestamp: envelope.Timestamp,
    Token: envelope.Token,
    TopicArn: envelope.TopicArn,
    Type: envelope.Type,
  };
  return values[field] ?? '';
};

const signatureInput = (envelope: SnsEnvelope): string => canonicalFields(envelope)
  .map((field) => `${field}\n${canonicalValue(envelope, field)}\n`)
  .join('');

export const createSnsVerifier = (input: {
  fetchText?: (url: string) => Promise<string>;
} = {}): SnsVerifier => {
  const fetchText = input.fetchText ?? (async (url: string) => {
    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  });
  const certs = new Map<string, string>();
  return {
    verify: async ({ rawBody, region }): Promise<Result<VerifiedSnsEnvelope, AppError>> => {
      const json: unknown = (() => {
        try { return JSON.parse(rawBody); } catch { return null; }
      })();
      const parsed = parseEnvelope(json);
      if (parsed === null) return { ok: false, error: validation('Malformed SNS envelope') };
      if (!trustedUrl(parsed.SigningCertURL, region)) return { ok: false, error: forbidden('Untrusted SNS certificate URL') };
      try {
        let cert = certs.get(parsed.SigningCertURL);
        if (cert === undefined) {
          cert = await fetchText(parsed.SigningCertURL);
          certs.set(parsed.SigningCertURL, cert);
        }
        const verifier = createVerify(parsed.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
        verifier.update(signatureInput(parsed));
        verifier.end();
        if (!verifier.verify(cert, parsed.Signature, 'base64')) {
          return { ok: false, error: forbidden('Invalid SNS signature') };
        }
        return ok({
          type: parsed.Type,
          topicArn: parsed.TopicArn,
          message: parsed.Message,
          subscribeUrl: parsed.SubscribeURL ?? null,
        });
      } catch (cause) {
        return { ok: false, error: forbidden(`SNS signature verification failed: ${String(cause)}`) };
      }
    },
    confirmSubscription: async ({ subscribeUrl, region }) => {
      if (!trustedUrl(subscribeUrl, region)) return { ok: false, error: forbidden('Untrusted SNS confirmation URL') };
      try {
        const response = await fetch(subscribeUrl, { redirect: 'error' });
        return response.ok
          ? ok(undefined)
          : { ok: false, error: integrationUnavailable(`SNS confirmation returned HTTP ${response.status}`) };
      } catch (cause) {
        return { ok: false, error: integrationUnavailable(`SNS confirmation failed: ${String(cause)}`) };
      }
    },
  };
};
