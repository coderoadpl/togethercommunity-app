import { describe, expect, it } from 'vitest';

import { ERROR_CODES, type ErrorCode } from '#core/domain/index.js';

import { en } from './en.js';
import { localizeError, localizeErrorCode, localizeErrorCodeForPanel } from './errors.js';
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
      expect(message).not.toContain('Integracje');
    }
    for (const message of [
      en.errors.messageIntegrationNotConfigured,
      en.errors.messageIntegrationAuth,
      en.errors.messageEmailSendingNotConfigured,
      en.errors.messagePlatformEmailPoolExhausted,
    ]) {
      expect(message).not.toContain('Integrations');
    }
    expect(pl.errors.messageInvoiceExemptionBasisMissing).not.toContain('Ustawienia');
    expect(en.errors.messageInvoiceExemptionBasisMissing).not.toContain('Settings');
  });

  it('points panel surfaces at the e-mail sub-tab for sending failures', () => {
    for (const code of [
      'ses_not_configured',
      'broadcasts_disabled',
      'transactional_platform_cap_reached',
    ] as const) {
      expect(localizeErrorCodeForPanel(code, pl)).toContain('Integracje → E-mail');
      expect(localizeErrorCodeForPanel(code, en)).toContain('Integrations → E-mail');
      expect(localizeErrorCodeForPanel(code, pl)).toContain(localizeErrorCode(code, pl));
    }
  });

  it('points panel surfaces at the integrations section for unconfigured and rejected integrations', () => {
    for (const code of ['integration_not_configured', 'integration_auth'] as const) {
      expect(localizeErrorCodeForPanel(code, pl)).toContain('Integracje');
      expect(localizeErrorCodeForPanel(code, en)).toContain('Integrations');
    }
  });

  it('points panel surfaces at the invoicing settings for a missing exemption basis', () => {
    expect(localizeErrorCodeForPanel('invoice_exemption_basis_missing', pl)).toContain(
      'Ustawienia → Firma → Automatyczne faktury',
    );
    expect(localizeErrorCodeForPanel('invoice_exemption_basis_missing', en)).toContain(
      'Settings → Company → Automatic invoices',
    );
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
