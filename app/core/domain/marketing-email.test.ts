import { describe, expect, it } from 'vitest';

import {
  bounceAction,
  buildEmailHeaders,
  campaignCanEditContent,
  campaignCanTransition,
  classifySesEvent,
  confirmationTokenIsValid,
  consumeUnsubscribeToken,
  deriveConsentState,
  deriveMarketingEligibility,
  emailLayoutSchema,
  liftSuppression,
  consentConfirmationTokenSchema,
  marketingConsentConfirmation,
  marketingConsentCreatorSchema,
  normalizeSesWebhookEndpoint,
  renderMarketingTemplate,
  snsWebhookDeliverySchema,
  snsWebhookDeliverySupersedes,
  snsWebhookMessageType,
  requiresConsentVersionBump,
  sesIdentityFreshness,
  suppressionMatchesEmail,
  tenantSesSettingsSchema,
  throttleBudget,
  unsubscribeTokenSchema,
  validateRenderedMarketingOutput,
  type ConsentDefinition,
  type MarketingConsent,
  type SnsWebhookDelivery,
  type SnsWebhookDeliveryOutcome,
  type Suppression,
  type UnsubscribeToken,
} from './marketing-email.js';

const definition = (doubleOptIn: boolean): ConsentDefinition => ({
  id: 'definition-1',
  tenantId: 'tenant-1',
  key: 'newsletter',
  kind: 'optional_marketing',
  channel: 'email',
  doubleOptIn,
  documentRef: { mode: 'url', url: 'https://tenant.test/privacy' },
  status: 'active',
  createdAt: '1998-07-01T00:00:00.000Z',
  updatedAt: '1998-07-01T00:00:00.000Z',
});

const consent = (status: MarketingConsent['status'], occurredAt: string): MarketingConsent => ({
  id: `${status}-${occurredAt}`,
  tenantId: 'tenant-1',
  memberId: 'member-1',
  email: 'member@example.com',
  definitionId: 'definition-1',
  definitionVersion: 1,
  wordingSnapshot: 'Send me news',
  documentRefSnapshot: { mode: 'url', url: 'https://tenant.test/privacy' },
  status,
  previousId: null,
  source: 'checkout',
  evidence: { collectedAt: occurredAt },
  occurredAt,
});

const suppression = (reason: Suppression['reason']): Suppression => ({
  id: 'suppression-1',
  tenantId: 'tenant-1',
  email: 'member@example.com',
  emailHmac: 'hmac:member@example.com',
  reason,
  sourceRef: 'event-1',
  createdAt: '1998-07-01T00:00:00.000Z',
  liftedAt: null,
  liftedBy: null,
});

describe('U1 consent state derivation', () => {
  it('uses the latest row and applies double opt-in rules', () => {
    const rows = [
      consent('confirmed', '1998-07-02T00:00:00.000Z'),
      consent('withdrawn', '1998-07-03T00:00:00.000Z'),
      consent('granted', '1998-07-01T00:00:00.000Z'),
    ];
    expect(deriveConsentState(rows, definition(true))).toMatchObject({ state: 'withdrawn', active: false });
    expect(deriveConsentState([...rows, consent('granted', '1998-07-04T00:00:00.000Z')], definition(true)))
      .toMatchObject({ state: 'pending_confirmation', active: false });
    expect(deriveConsentState([consent('granted', '1998-07-01T00:00:00.000Z')], definition(false)))
      .toMatchObject({ state: 'active', active: true });
    expect(deriveConsentState([consent('confirmed', '1998-07-01T00:00:00.000Z')], definition(true)))
      .toMatchObject({ state: 'active', active: true });
    expect(deriveConsentState([], definition(true))).toEqual({ state: 'none', active: false, row: null });
  });
});

describe('U2 consent creator validation', () => {
  it('rejects required or pre-ticked marketing and channels other than the single email channel', () => {
    const valid = { kind: 'optional_marketing', channel: 'email', required: false, preTicked: false };
    expect(marketingConsentCreatorSchema.safeParse(valid).success).toBe(true);
    expect(marketingConsentCreatorSchema.safeParse({ ...valid, required: true }).success).toBe(false);
    expect(marketingConsentCreatorSchema.safeParse({ ...valid, preTicked: true }).success).toBe(false);
    expect(marketingConsentCreatorSchema.safeParse({ ...valid, channel: ['email', 'sms'] }).success).toBe(false);
  });

  it('requires a version bump when wording or the document snapshot changes', () => {
    const current = { label: 'News', documentVersionRef: { mode: 'url' as const, url: 'https://x.test/v1' } };
    expect(requiresConsentVersionBump(current, current)).toBe(false);
    expect(requiresConsentVersionBump(current, { ...current, label: 'Product news' })).toBe(true);
    expect(requiresConsentVersionBump(current, {
      ...current,
      documentVersionRef: { mode: 'url', url: 'https://x.test/v2' },
    })).toBe(true);
  });
});

describe('U3 suppression precedence', () => {
  it('makes an active suppression override confirmed consent and normalizes email for HMAC matching', () => {
    expect(deriveMarketingEligibility({ consent: { state: 'active', active: true, row: consent('confirmed', '1998-07-01T00:00:00.000Z') }, suppressed: true }))
      .toEqual({ eligible: false, reason: 'suppressed' });
    expect(suppressionMatchesEmail(suppression('hard_bounce'), ' Member@Example.com ', (email) => `hmac:${email}`))
      .toBe(true);
  });

  it('forbids complaint lifts and requires complete hard-bounce audit fields', () => {
    expect(liftSuppression(suppression('complaint'), { actorId: 'staff-1', liftedAt: '1998-07-02T00:00:00.000Z' }).ok)
      .toBe(false);
    expect(liftSuppression(suppression('hard_bounce'), { actorId: '', liftedAt: '1998-07-02T00:00:00.000Z' }).ok)
      .toBe(false);
    expect(liftSuppression(suppression('hard_bounce'), { actorId: 'staff-1', liftedAt: '1998-07-02T00:00:00.000Z' }))
      .toMatchObject({ ok: true, value: { liftedBy: 'staff-1', liftedAt: '1998-07-02T00:00:00.000Z' } });
  });
});

describe('U4 token semantics', () => {
  const token: UnsubscribeToken = {
    id: 'token-1', tenantId: 'tenant-1', token: '0123456789abcdef0123456789abcdef',
    email: 'member@example.com', memberId: 'member-1', campaignSendId: 'send-1',
    scope: 'consent:definition-1', createdAt: '1998-07-01T00:00:00.000Z', usedAt: null,
  };

  it('accepts opaque non-expiring tokens, resolves scope, and consumes idempotently', () => {
    expect(unsubscribeTokenSchema.safeParse(token).success).toBe(true);
    expect('expiresAt' in token).toBe(false);
    const first = consumeUnsubscribeToken(token, '1998-07-02T00:00:00.000Z');
    expect(first).toMatchObject({ ok: true, value: { newlyUsed: true, scope: { kind: 'consent', definitionId: 'definition-1' } } });
    if (!first.ok) throw new Error('expected valid token');
    expect(consumeUnsubscribeToken(first.value.token, '2008-07-02T00:00:00.000Z'))
      .toMatchObject({ ok: true, value: { newlyUsed: false } });
    expect(consumeUnsubscribeToken({ ...token, token: 'short' }, '1998-07-02T00:00:00.000Z').ok).toBe(false);
  });

  it('expires confirmation tokens at the boundary', () => {
    const confirmation = {
      id: 'confirmation-1', tenantId: 'tenant-1', token: '0123456789abcdef0123456789abcdef',
      marketingConsentRowId: 'consent-1', createdAt: '1998-07-01T00:00:00.000Z',
      expiresAt: '1998-07-02T00:00:00.000Z', usedAt: null,
    };
    expect(consentConfirmationTokenSchema.safeParse(confirmation).success).toBe(true);
    expect(confirmationTokenIsValid(confirmation, '1998-07-01T23:59:59.999Z')).toBe(true);
    expect(confirmationTokenIsValid(confirmation, confirmation.expiresAt)).toBe(false);
    expect(confirmationTokenIsValid({ ...confirmation, usedAt: '1998-07-01T12:00:00.000Z' }, '1998-07-01T13:00:00.000Z'))
      .toBe(false);
  });
});

describe('U5 sandboxed renderer', () => {
  it('supports paths, nullish fallback, arrays, escaping, raw slots, and missing values', () => {
    const result = renderMarketingTemplate(
      '{{member.name}}|{{count ?? 7}}|{{empty ?? fallback}}|{{missing}}|{{tags}}|{{{trustedHtml}}}',
      { member: { name: '<Ala>' }, count: 0, empty: '', tags: ['a', '<b>'], trustedHtml: '<strong>ok</strong>' },
    );
    expect(result).toEqual({ ok: true, value: '&lt;Ala&gt;|0|||a, &lt;b&gt;|<strong>ok</strong>' });
  });

  it('rejects expressions outside property-path interpolation', () => {
    expect(renderMarketingTemplate('{{constructor.constructor("return 1")()}}', {}).ok).toBe(false);
    expect(renderMarketingTemplate('{{items[0]}}', { items: ['x'] }).ok).toBe(false);
  });

  it('requires tenant layouts to contain exactly one raw content slot', () => {
    const layout = {
      id: 'layout-1', tenantId: 'tenant-1', name: 'Default',
      bodyHtml: '<html><body>{{{content}}}</body></html>',
      createdAt: '1998-07-01T00:00:00.000Z', updatedAt: '1998-07-01T00:00:00.000Z',
    };
    expect(emailLayoutSchema.safeParse(layout).success).toBe(true);
    expect(emailLayoutSchema.safeParse({ ...layout, bodyHtml: '<html><body>No slot</body></html>' }).success).toBe(false);
    expect(emailLayoutSchema.safeParse({ ...layout, bodyHtml: '{{{content}}}{{{content}}}' }).success).toBe(false);
    expect(emailLayoutSchema.safeParse({ ...layout, bodyHtml: '{{content}}' }).success).toBe(false);
  });
});

describe('U6 rendered output gate', () => {
  const required = {
    unsubscribeUrl: 'https://tenant.test/u/token', legalName: 'Acme sp. z o.o.',
    address: 'ul. Testowa 1, Warszawa', consentReference: 'newsletter consent',
  };

  it('refuses output missing any mandatory rendered footer value', () => {
    const complete = Object.values(required).join(' ');
    expect(validateRenderedMarketingOutput(complete, required).ok).toBe(true);
    for (const missing of Object.values(required)) {
      expect(validateRenderedMarketingOutput(complete.replace(missing, ''), required).ok).toBe(false);
    }
  });
});

describe('U7 header builder', () => {
  it('adds the RFC 8058 pair and bulk trio only to marketing mail', () => {
    expect(buildEmailHeaders({ kind: 'marketing', unsubscribeUrl: 'https://tenant.test/u/token' }))
      .toMatchObject({ ok: true, value: {
        'List-Unsubscribe': '<https://tenant.test/u/token>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        Precedence: 'bulk', 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All',
      } });
    expect(buildEmailHeaders({ kind: 'transactional', callerHeaders: { 'List-Unsubscribe': '<https://bad.test>' } }))
      .toEqual({ ok: true, value: {} });
    expect(buildEmailHeaders({ kind: 'marketing' }).ok).toBe(false);
  });

  it('merges caller overrides case-insensitively and rejects header injection', () => {
    const merged = buildEmailHeaders({
      kind: 'marketing', unsubscribeUrl: 'https://tenant.test/u/token',
      callerHeaders: { precedence: 'list', 'X-Campaign': 'weekly' },
    });
    expect(merged).toMatchObject({ ok: true, value: { Precedence: 'list', 'X-Campaign': 'weekly' } });
    if (!merged.ok) throw new Error('expected headers');
    expect(Object.keys(merged.value).filter((name) => name.toLowerCase() === 'precedence')).toHaveLength(1);
    expect(buildEmailHeaders({ kind: 'marketing', unsubscribeUrl: 'https://tenant.test/u/token', callerHeaders: { X: 'ok\r\nBcc: victim@test' } }).ok)
      .toBe(false);
  });
});

describe('U8 campaign state machine', () => {
  it('accepts every legal transition and rejects all others', () => {
    const legal = [
      ['draft', 'scheduled'], ['draft', 'cancelled'], ['scheduled', 'draft'], ['scheduled', 'running'],
      ['scheduled', 'cancelled'], ['running', 'paused'], ['running', 'cancelled'], ['running', 'finished'],
      ['paused', 'running'], ['paused', 'cancelled'],
    ] as const;
    const statuses = ['draft', 'scheduled', 'running', 'paused', 'cancelled', 'finished'] as const;
    for (const from of statuses) {
      for (const to of statuses) {
        expect(campaignCanTransition(from, to)).toBe(legal.some(([legalFrom, legalTo]) =>
          legalFrom === from && legalTo === to));
      }
    }
    expect(campaignCanEditContent('draft')).toBe(true);
    expect(campaignCanEditContent('scheduled')).toBe(true);
    expect(campaignCanEditContent('running')).toBe(false);
  });
});

describe('U9 bounce classification', () => {
  it('classifies bounce and complaint events with fixed threshold actions', () => {
    expect(classifySesEvent({ kind: 'bounce', bounceType: 'Permanent', status: '5.1.1' })).toBe('hard');
    expect(classifySesEvent({ kind: 'bounce', bounceType: 'Transient', status: '4.2.2' })).toBe('soft');
    expect(classifySesEvent({ kind: 'bounce', bounceType: 'Transient', status: '5.4.4' })).toBe('hard');
    expect(classifySesEvent({ kind: 'bounce', bounceType: 'Unknown', status: null })).toBe('hard');
    expect(classifySesEvent({ kind: 'complaint' })).toBe('complaint');
    expect(bounceAction('soft')).toEqual({ threshold: 2, suppress: false, permanent: false });
    expect(bounceAction('hard')).toEqual({ threshold: 1, suppress: true, permanent: false });
    expect(bounceAction('complaint')).toEqual({ threshold: 1, suppress: true, permanent: true });
  });
});

describe('U10 throttle math', () => {
  it('caps rate budget by the daily remainder and blocks sandbox broadcasts', () => {
    expect(throttleBudget({ ratePerSecond: 14.5, tickSeconds: 10, dailyQuota: 1_000, sentLast24Hours: 900, inSandbox: false }))
      .toBe(100);
    expect(throttleBudget({ ratePerSecond: 2.5, tickSeconds: 3, dailyQuota: 1_000, sentLast24Hours: 0, inSandbox: false }))
      .toBe(7);
    expect(throttleBudget({ ratePerSecond: 100, tickSeconds: 60, dailyQuota: 1_000, sentLast24Hours: 1_100, inSandbox: false }))
      .toBe(0);
    expect(throttleBudget({ ratePerSecond: 100, tickSeconds: 60, dailyQuota: 1_000, sentLast24Hours: 0, inSandbox: true }))
      .toBe(0);
  });
});

describe('SES identity freshness', () => {
  const settings = tenantSesSettingsSchema.parse({
    tenantId: 'tenant-1',
    fromAddress: 'news@tenant.test',
    fromName: 'Tenant',
    identity: 'tenant.test',
    identityVerifiedAt: null,
    identityCheckedAt: null,
    identityCheckError: null,
    configurationSet: null,
    snsTopicArn: null,
    snsSubscriptionEndpoint: null,
    snsSubscriptionConfirmedAt: null,
    trackingEnabled: false,
    autoPauseOnCritical: false,
    webhookToken: 'webhook_token_123456789012345',
    quotaRatePerSec: 0,
    quotaDaily: 0,
    quotaSentLast24Hours: 0,
    quotaRefreshedAt: null,
    inSandbox: true,
    webhookVerifiedAt: null,
    footerLegalName: '',
    footerAddress: '',
    broadcastsEnabled: false,
    reputationAlertStatus: null,
    reputationAlertedAt: null,
  });

  it('distinguishes never checked, boundary-fresh, and stale identities', () => {
    const now = '1998-07-29T12:00:00.000Z';
    expect(sesIdentityFreshness(settings, now)).toBe('never-checked');
    expect(
      sesIdentityFreshness(
        { ...settings, identityCheckedAt: '1998-07-28T12:00:00.000Z' },
        now,
      ),
    ).toBe('fresh');
    expect(
      sesIdentityFreshness(
        { ...settings, identityCheckedAt: '1998-07-28T11:59:59.999Z' },
        now,
      ),
    ).toBe('stale');
  });
});

describe('marketingConsentConfirmation', () => {
  const input = { confirmationUrl: 'https://tenant.test/confirm?token=abc', wording: 'Newsletter „Nowości”' };

  it('renders the Polish message for a Polish tenant', () => {
    const message = marketingConsentConfirmation({ ...input, language: 'pl' });
    expect(message.subject).toBe('Potwierdź zgodę na wiadomości e-mail');
    expect(message.html).toContain('Potwierdzam zgodę');
    expect(message.html).toContain('tenant.test/confirm?token=abc');
    expect(message.text).toContain('Jeśli to nie Ty zapisujesz się na te wiadomości, zignoruj tę wiadomość.');
  });

  it('renders the English message for an English tenant', () => {
    const message = marketingConsentConfirmation({ ...input, language: 'en' });
    expect(message.subject).toBe('Confirm your e-mail consent');
    expect(message.html).toContain('Confirm consent');
    expect(message.text).toContain('If you did not give this consent, ignore this message.');
  });

  it('falls back to Polish for an unsupported language', () => {
    expect(marketingConsentConfirmation({ ...input, language: 'de' }).subject)
      .toBe('Potwierdź zgodę na wiadomości e-mail');
  });
});

describe('SNS webhook diagnostics', () => {
  it.each([
    ['HTTPS://Start.Together.Test/api/webhooks/ses/token', 'https://start.together.test/api/webhooks/ses/token'],
    ['https://start.together.test:443/api/webhooks/ses/token/', 'https://start.together.test/api/webhooks/ses/token'],
    ['not-a-url  ', 'not-a-url'],
  ])('normalizes %s for endpoint comparison', (endpoint, expected) => {
    expect(normalizeSesWebhookEndpoint(endpoint)).toBe(expected);
  });

  it('truncates the recorded error message and the caller-supplied headers', () => {
    const parsed = snsWebhookDeliverySchema.parse({
      tenantId: 'tenant-1',
      receivedAt: '2026-07-27T10:00:00.000Z',
      messageType: 'SubscriptionConfirmation',
      outcome: 'confirm_failed',
      errorMessage: 'x'.repeat(900),
      sourceIp: 'y'.repeat(900),
      userAgent: 'z'.repeat(900),
    });

    expect(parsed.errorMessage).toHaveLength(500);
    expect(parsed.sourceIp).toHaveLength(200);
    expect(parsed.userAgent).toHaveLength(200);
  });

  it.each([
    ['x-amz-sns-message-type: Notification', 'Notification', 'Notification'],
    ['an unlisted type', 'Delivery', 'unknown'],
    ['a missing header', undefined, 'unknown'],
  ])('maps %s to a known message type', (_case, header, expected) => {
    expect(snsWebhookMessageType(header)).toBe(expected);
  });

  it.each<{
    reason: string;
    stored: SnsWebhookDeliveryOutcome | null;
    outcome: SnsWebhookDeliveryOutcome;
    receivedAt: string;
    supersedes: boolean;
  }>([
    { reason: 'no row is stored yet', stored: null, outcome: 'recorded', receivedAt: '2026-07-27T10:00:00.000Z', supersedes: true },
    { reason: 'the outcome changed', stored: 'signature_failed', outcome: 'recorded', receivedAt: '2026-07-27T10:00:00.000Z', supersedes: true },
    { reason: 'the stored row aged out', stored: 'recorded', outcome: 'recorded', receivedAt: '2026-07-27T10:02:00.000Z', supersedes: true },
    { reason: 'the same outcome is still fresh', stored: 'recorded', outcome: 'recorded', receivedAt: '2026-07-27T10:00:30.000Z', supersedes: false },
  ])('overwrites the diagnostics row when $reason', ({ stored, outcome, receivedAt, supersedes }) => {
    const delivery = (overrides: Partial<SnsWebhookDelivery>): SnsWebhookDelivery => ({
      tenantId: 'tenant-1',
      receivedAt: '2026-07-27T10:00:00.000Z',
      messageType: 'Notification',
      outcome: 'recorded',
      errorMessage: null,
      sourceIp: null,
      userAgent: null,
      ...overrides,
    });

    expect(snsWebhookDeliverySupersedes(
      stored === null ? null : delivery({ outcome: stored }),
      delivery({ outcome, receivedAt }),
    )).toBe(supersedes);
  });
});
