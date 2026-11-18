import { createHmac } from 'node:crypto';

const SECRET_FINGERPRINT_CONTEXT = 'together-secret-fingerprint-v1:';
const SECRET_FINGERPRINT_LENGTH = 16;

export const secretFingerprint = (name: string, value: string): string =>
  createHmac('sha256', Buffer.from(value, 'utf8'))
    .update(`${SECRET_FINGERPRINT_CONTEXT}${name}`, 'utf8')
    .digest('hex')
    .slice(0, SECRET_FINGERPRINT_LENGTH);
