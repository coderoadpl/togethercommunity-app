import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@core/domain/index.js';

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
});
