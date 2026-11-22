import { describe, expect, it } from 'vitest';

import { ERROR_CODES, type ErrorCode } from '#core/domain/index.js';

import { en } from './en.js';
import { localizeError, localizeErrorCode, localizeErrorCodeForPanel, localizeInvoiceError, localizePanelError, formatRetryDelay, retryAfterSecondsOf } from './errors.js';
import { pl } from './pl.js';

describe('localizeError', () => {
  it('keeps the generic panel message for draft refusal reasons and error codes', () => {
    const otherReason = { appError: { code: 'validation', details: { productDraftRefusal: 'orders' } } };
    const otherCode = { appError: { code: 'internal', details: { productDraftRefusal: 'orders' } } };
    expect(localizePanelError(otherReason, en)).toBe(en.errors.messageValidation);
    expect(localizePanelError(otherCode, en)).toBe(en.errors.messageInternal);
  });

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

  it('separates sending failures from the generic integrations message', () => {
    for (const code of ['ses_not_configured', 'broadcasts_disabled'] as const) {
      expect(localizeErrorCode(code, pl)).toBe(pl.errors.messageEmailSendingNotConfigured);
      expect(localizeErrorCode(code, en)).toBe(en.errors.messageEmailSendingNotConfigured);
    }
    expect(pl.errors.messageEmailSendingNotConfigured).not.toBe(pl.errors.messageIntegrationNotConfigured);
  });

  it('maps the exhausted platform pool to its own message', () => {
    expect(localizeErrorCode('transactional_platform_cap_reached', pl)).toBe(
      pl.errors.messagePlatformEmailPoolExhausted,
    );
    expect(localizeErrorCode('transactional_platform_cap_reached', en)).toBe(
      en.errors.messagePlatformEmailPoolExhausted,
    );
  });

  it('keeps member-facing setup errors free of creator-panel instructions', () => {
    for (const message of [
      pl.errors.messageIntegrationNotConfigured,
      pl.errors.messageIntegrationAuth,
      pl.errors.messageEmailSendingNotConfigured,
      pl.errors.messagePlatformEmailPoolExhausted,
    ]) {
      expect(message).not.toContain(pl.sections.integrations);
    }
    for (const message of [
      en.errors.messageIntegrationNotConfigured,
      en.errors.messageIntegrationAuth,
      en.errors.messageEmailSendingNotConfigured,
      en.errors.messagePlatformEmailPoolExhausted,
    ]) {
      expect(message).not.toContain('Integrations');
    }
    expect(pl.errors.messageInvoiceExemptionBasisMissing).not.toContain(pl.sections.settings);
    expect(en.errors.messageInvoiceExemptionBasisMissing).not.toContain('Settings');
  });

  it('points panel surfaces at the e-mail sub-tab for sending failures', () => {
    for (const code of [
      'ses_not_configured',
      'broadcasts_disabled',
      'transactional_platform_cap_reached',
    ] as const) {
      expect(localizeErrorCodeForPanel(code, pl)).toContain(
        code === 'transactional_platform_cap_reached'
          ? pl.errors.panelHintPlatformEmailPoolExhausted
          : pl.errors.panelHintEmailSendingNotConfigured,
      );
      expect(localizeErrorCodeForPanel(code, en)).toContain('Integrations → E-mail');
      expect(localizeErrorCodeForPanel(code, pl)).toContain(localizeErrorCode(code, pl));
    }
  });

  it('points panel surfaces at the integrations section for unconfigured and rejected integrations', () => {
    for (const code of ['integration_not_configured', 'integration_auth'] as const) {
      expect(localizeErrorCodeForPanel(code, pl)).toContain(pl.sections.integrations);
      expect(localizeErrorCodeForPanel(code, en)).toContain('Integrations');
    }
  });

  it('points panel surfaces at the invoicing settings for a missing exemption basis', () => {
    expect(localizeErrorCodeForPanel('invoice_exemption_basis_missing', pl)).toContain(
      pl.errors.panelHintInvoiceExemptionBasisMissing,
    );
    expect(localizeErrorCodeForPanel('invoice_exemption_basis_missing', en)).toContain(
      'Settings → Company → Automatic invoices',
    );
  });

  it('explains an invoice refused for an order cancelled out of stock and keeps other invoice errors generic', () => {
    const refused = { appError: { code: 'conflict', message: 'raw backend string', details: { invoiceRefusal: 'order_cancelled_out_of_stock' } } };
    expect(localizeInvoiceError(refused, en)).toBe(en.sales.invoiceOrderCancelledOutOfStock);
    expect(localizeInvoiceError(refused, pl)).toBe(pl.sales.invoiceOrderCancelledOutOfStock);
    expect(localizeInvoiceError({ appError: { code: 'conflict' } }, en)).toBe(localizePanelError({ appError: { code: 'conflict' } }, en));
  });

  it('leaves codes without a panel hint identical to the base message', () => {
    const hinted: readonly ErrorCode[] = [
      'integration_not_configured',
      'integration_auth',
      'ses_not_configured',
      'broadcasts_disabled',
      'transactional_platform_cap_reached',
      'invoice_exemption_basis_missing',
    ];
    for (const code of ERROR_CODES) {
      if (hinted.includes(code)) continue;
      expect(localizeErrorCodeForPanel(code, pl)).toBe(localizeErrorCode(code, pl));
    }
  });
});

describe('retryAfterSecondsOf', () => {
  it('reads only a positive whole retry delay from the error details', () => {
    const withDelay = (retryAfterSeconds: unknown) => ({ appError: { code: 'rate_limited', details: { retryAfterSeconds } } });
    expect(retryAfterSecondsOf(withDelay(42))).toBe(42);
    expect(retryAfterSecondsOf(withDelay(600))).toBe(600);
    expect([0, -3, 1.5, '42', null, 601, 1e21].map((value) => retryAfterSecondsOf(withDelay(value)))).toEqual([null, null, null, null, null, null, null]);
    expect(retryAfterSecondsOf({ appError: { code: 'rate_limited' } })).toBeNull();
    expect(retryAfterSecondsOf(null)).toBeNull();
  });
});

describe('formatRetryDelay', () => {
  it('states seconds under a minute and minutes with any remaining seconds from a minute', () => {
    expect([1, 42, 59, 60, 61, 120, 583, 600].map(formatRetryDelay)).toEqual([
      '1 s', '42 s', '59 s', '1 min', '1 min 1 s', '2 min', '9 min 43 s', '10 min',
    ]);
  });

  it.each([
    [42, 'Too many attempts. Try again in 42 s.', 'Zbyt wiele pr\u00f3b. Spr\u00f3buj ponownie za 42 s.', 'Send again (42 s)', 'Wy\u015blij ponownie (42 s)'],
    [60, 'Too many attempts. Try again in 1 min.', 'Zbyt wiele pr\u00f3b. Spr\u00f3buj ponownie za 1 min.', 'Send again (1 min)', 'Wy\u015blij ponownie (1 min)'],
    [583, 'Too many attempts. Try again in 9 min 43 s.', 'Zbyt wiele pr\u00f3b. Spr\u00f3buj ponownie za 9 min 43 s.', 'Send again (9 min 43 s)', 'Wy\u015blij ponownie (9 min 43 s)'],
  ])('reads a %i s delay the same way in the English and Polish alerts and resend button', (seconds, enAlert, plAlert, enResend, plResend) => {
    const delay = formatRetryDelay(seconds);
    expect([en.auth.signInRateLimitedRetryIn({ delay }), pl.auth.signInRateLimitedRetryIn({ delay })]).toEqual([enAlert, plAlert]);
    expect([en.auth.magicLinkResendCooldown({ delay }), pl.auth.magicLinkResendCooldown({ delay })]).toEqual([enResend, plResend]);
  });

  it('keeps the rate-limit cause in the heading and only the wait in the lead', () => {
    const delay = formatRetryDelay(583);
    expect([
      en.auth.signInRateLimitedTitle,
      en.auth.signInRateLimitedLeadRetryIn({ delay }),
      en.auth.signInRateLimitedRetryNow,
      en.auth.signInRateLimitedLeadWait,
    ]).toEqual(['Too many attempts', 'Try again in 9 min 43 s.', 'You can try again now.', 'Wait a moment, then try again.']);
    expect([
      pl.auth.signInRateLimitedTitle,
      pl.auth.signInRateLimitedLeadRetryIn({ delay }),
      pl.auth.signInRateLimitedRetryNow,
      pl.auth.signInRateLimitedLeadWait,
    ]).toEqual([
      'Zbyt wiele pr\u00f3b',
      'Spr\u00f3buj ponownie za 9 min 43 s.',
      'Mo\u017cesz spr\u00f3bowa\u0107 ponownie.',
      'Odczekaj chwil\u0119 i spr\u00f3buj ponownie.',
    ]);
  });
});
