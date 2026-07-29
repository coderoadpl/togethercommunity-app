import { describe, expect, it } from 'vitest';

import { createEmailHmac } from './email-hmac.js';

const key = Buffer.alloc(32, 7).toString('base64');

describe('createEmailHmac', () => {
  it('normalizes e-mail input and separates tenant namespaces', () => {
    const hmac = createEmailHmac(key);
    expect(hmac.compute('tenant-1', ' Member@Example.Test ')).toBe(hmac.compute('tenant-1', 'member@example.test'));
    expect(hmac.compute('tenant-1', 'member@example.test')).not.toBe(hmac.compute('tenant-2', 'member@example.test'));
  });
});
