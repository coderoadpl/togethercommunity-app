import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#core/domain/index.js';

import { en } from './en.js';
import { localizeError, localizeErrorCode } from './errors.js';
import { pl } from './pl.js';

describe('localizeError', () => {
  it('maps every ApiError-shaped code to its localized dictionary message, never a raw backend string', () => {
    for (const code of ERROR_CODES) {
      const error = { appError: { code, message: 'raw backend string' } };
      const message = localizeError(error, pl);
      expect(message).toBe(localizeErrorCode(code, pl));
      expect(message).not.toBe('raw backend string');
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the generic unknown message for anything that is not an ApiError', () => {
    expect(localizeError(new Error('boom'), pl)).toBe(pl.errors.messageUnknown);
    expect(localizeError('nope', en)).toBe(en.errors.messageUnknown);
    expect(localizeError(null, pl)).toBe(pl.errors.messageUnknown);
    expect(localizeError(undefined, en)).toBe(en.errors.messageUnknown);
    expect(localizeError({ appError: { code: 'not-a-real-code' } }, pl)).toBe(pl.errors.messageUnknown);
  });

  it('uses a slug-free generic message for reserved addresses', () => {
    expect(localizeErrorCode('slug_reserved', en)).toBe(en.errors.messageSlugReservedGeneric);
    expect(localizeErrorCode('slug_reserved', pl)).not.toContain('…');
  });

  it('points sending failures at the e-mail sub-tab instead of the generic integrations message', () => {
    for (const code of ['ses_not_configured', 'broadcasts_disabled'] as const) {
      expect(localizeErrorCode(code, pl)).toBe(pl.errors.messageEmailSendingNotConfigured);
      expect(localizeErrorCode(code, en)).toBe(en.errors.messageEmailSendingNotConfigured);
    }
    expect(pl.errors.messageEmailSendingNotConfigured).toContain('Integracje → E-mail');
    expect(en.errors.messageEmailSendingNotConfigured).toContain('Integrations → E-mail');
  });

  it('tells the owner to configure an own provider when the platform pool is exhausted', () => {
    expect(localizeErrorCode('transactional_platform_cap_reached', pl)).toBe(
      pl.errors.messagePlatformEmailPoolExhausted,
    );
    expect(localizeErrorCode('transactional_platform_cap_reached', en)).toBe(
      en.errors.messagePlatformEmailPoolExhausted,
    );
    expect(pl.errors.messagePlatformEmailPoolExhausted).toContain('Integracje → E-mail');
  });
});
