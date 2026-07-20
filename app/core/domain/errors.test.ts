import { describe, expect, it } from 'vitest';

import {
  ERROR_CODES,
  appError,
  forbidden,
  integrationAuth,
  integrationNotConfigured,
  integrationUnavailable,
  internal,
  invalidCredentials,
  notFound,
  tenantNotFound,
  unauthorized,
  validation,
} from './errors.js';

describe('appError', () => {
  it('omits the details key entirely when details is undefined', () => {
    const error = appError('internal', 'boom');
    expect(error).toEqual({ code: 'internal', message: 'boom' });
    expect('details' in error).toBe(false);
  });

  it('keeps details when provided, including falsy-but-defined values', () => {
    expect(appError('validation', 'bad', { field: 'x' })).toEqual({
      code: 'validation',
      message: 'bad',
      details: { field: 'x' },
    });
    expect('details' in appError('validation', 'bad', null)).toBe(true);
  });
});

describe('error constructors', () => {
  it('each constructor stamps its own code and a sensible default message', () => {
    const cases = [
      [unauthorized(), 'unauthorized'],
      [invalidCredentials(), 'invalid_credentials'],
      [forbidden(), 'forbidden'],
      [notFound(), 'not_found'],
      [tenantNotFound(), 'tenant_not_found'],
      [integrationNotConfigured(), 'integration_not_configured'],
      [integrationAuth(), 'integration_auth'],
      [integrationUnavailable(), 'integration_unavailable'],
      [internal(), 'internal'],
    ] as const;
    for (const [error, code] of cases) {
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('lets callers override the message', () => {
    expect(forbidden('owner only').message).toBe('owner only');
    expect(validation('nope').code).toBe('validation');
  });

  it('every constructed code is a member of the ERROR_CODES tuple', () => {
    const constructed = [
      unauthorized(),
      invalidCredentials(),
      forbidden(),
      notFound(),
      validation('x'),
      tenantNotFound(),
      integrationNotConfigured(),
      integrationAuth(),
      integrationUnavailable(),
      internal(),
    ];
    for (const error of constructed) {
      expect(ERROR_CODES).toContain(error.code);
    }
  });
});
