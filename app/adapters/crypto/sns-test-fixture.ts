import { generateKeyPairSync, sign } from 'node:crypto';

import { createSnsVerifier } from './sns.js';

export const createSignedSnsNotification = (input: { message: string; messageId: string; timestamp: string; topicArn: string }) => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const canonical = ['Message', input.message, 'MessageId', input.messageId, 'Timestamp', input.timestamp,
    'TopicArn', input.topicArn, 'Type', 'Notification'].join('\n') + '\n';
  const signature = sign('RSA-SHA256', Buffer.from(canonical), keys.privateKey).toString('base64');
  return {
    envelope: { Type: 'Notification', MessageId: input.messageId, Timestamp: input.timestamp, TopicArn: input.topicArn,
      Message: input.message, SignatureVersion: '2', Signature: signature, SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem' },
    verifier: createSnsVerifier({ fetchText: async () => keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }),
  };
};
