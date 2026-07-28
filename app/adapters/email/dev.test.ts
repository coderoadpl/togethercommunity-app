import { describe, expect, it } from 'vitest';

import { magicLink, normalizeEmail } from '#core/domain/index.js';
import { createDb } from '#adapters/db/client.js';
import { createDevEmailReader } from '#adapters/db/repositories.js';

import { createDevEmailPort } from './dev.js';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

describe('createDevEmailPort', () => {
  it('stores a magic-link email for a recipient that the dev reader can read back', async () => {
    const db = createDb('node-postgres', connectionString);
    const port = createDevEmailPort(db);
    const reader = createDevEmailReader(db);
    const recipient = `dev-email-${Date.now()}@together.dev`;
    const rendered = magicLink('pl', {
      tenantName: 'Acme Courses',
      url: 'https://acme.localhost/magic?token=xyz',
    });

    const sent = await port.send({ to: recipient, ...rendered });
    expect(sent).toMatchObject({ ok: true, value: { messageId: expect.stringMatching(/^dev-/) } });

    const stored = await reader.findByRecipient(normalizeEmail(recipient));
    expect(stored?.subject).toBe(rendered.subject);
    expect(stored?.html).toBe(rendered.html);
    expect(stored?.text).toBe(rendered.text);
    expect(stored?.headers).toEqual({});
    expect(stored?.messageId).toBe(sent.ok ? sent.value.messageId : null);
    expect(stored?.to).toBe(normalizeEmail(recipient));
  });

  it('keeps only the last message per recipient', async () => {
    const db = createDb('node-postgres', connectionString);
    const port = createDevEmailPort(db);
    const reader = createDevEmailReader(db);
    const recipient = `dev-email-last-${Date.now()}@together.dev`;

    await port.send({ to: recipient, subject: 'first', html: '<p>first</p>', text: 'first' });
    await port.send({ to: recipient, subject: 'second', html: '<p>second</p>', text: 'second' });

    const stored = await reader.findByRecipient(normalizeEmail(recipient));
    expect(stored?.subject).toBe('second');
  });
});
