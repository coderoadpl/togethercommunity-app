import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createSnsVerifier } from './sns.js';

const envelope = (overrides: Record<string, unknown> = {}) => ({
  Type: 'Notification',
  MessageId: 'sns-message',
  TopicArn: 'arn:aws:sns:eu-central-1:123:topic',
  Message: '{}',
  Timestamp: '2026-07-22T00:00:00.000Z',
  SignatureVersion: '2',
  SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem',
  UnsubscribeURL: 'https://sns.eu-central-1.amazonaws.com/unsubscribe',
  ...overrides,
});

describe('SNS verifier', () => {
  it('rejects certificate and confirmation URLs outside the regional SNS host', async () => {
    const verifier = createSnsVerifier({ fetchText: async () => '' });
    const badCert = await verifier.verify({
      rawBody: JSON.stringify(envelope({ SigningCertURL: 'https://attacker.test/cert.pem', Signature: 'x' })),
      headers: {}, region: 'eu-central-1',
    });
    expect(badCert).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await verifier.confirmSubscription({
      subscribeUrl: 'https://attacker.test/confirm', region: 'eu-central-1',
    })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('verifies a signed notification and parses the trusted fields', async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const unsigned = envelope();
    const canonical = [
      'Message', '{}', 'MessageId', 'sns-message', 'Timestamp', '2026-07-22T00:00:00.000Z',
      'TopicArn', 'arn:aws:sns:eu-central-1:123:topic', 'Type', 'Notification',
    ].join('\n') + '\n';
    const signature = sign('RSA-SHA256', Buffer.from(canonical), keys.privateKey).toString('base64');
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const verifier = createSnsVerifier({ fetchText: async () => publicKey });
    const result = await verifier.verify({
      rawBody: JSON.stringify({ ...unsigned, Signature: signature }), headers: {}, region: 'eu-central-1',
    });
    expect(result).toEqual({ ok: true, value: {
      type: 'Notification', topicArn: 'arn:aws:sns:eu-central-1:123:topic', message: '{}', subscribeUrl: null,
    } });
  });
});
