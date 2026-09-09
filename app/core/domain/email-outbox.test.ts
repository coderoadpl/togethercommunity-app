import { describe, expect, it } from 'vitest';

import { emailOutboxPayloadSchema, isAuthBearingEmailPayload, renderEmailOutboxPayload } from './email-outbox.js';

const branding = { logoUrl: 'https://cdn.test/logo.png', accentColor: '#123456' };

describe('renderEmailOutboxPayload', () => {
  it('renders a welcome-sign-in payload with branding', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'welcome-sign-in',
      language: 'en',
      tenantName: 'Caravan',
      actionUrl: 'https://caravan.test/sign-in?token=abc',
      branding,
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('caravan.test/sign-in');
  });

  it('renders a reset-password payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'reset-password',
      language: 'en',
      actionUrl: 'https://acme.test/reset-password?token=xyz',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.subject).toBe('Reset your password');
  });

  it('renders an email verification message', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'verify-email',
      language: 'en',
      actionUrl: 'https://studio.example/verify?token=xyz',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.data.subject).toBe('Verify your email address');
      expect(rendered.data.text).toContain('studio.example');
    }
  });

  it('renders a welcome-sign-in payload without branding', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'welcome-sign-in',
      language: 'en',
      tenantName: 'Studio',
      actionUrl: 'https://studio.test/sign-in?token=abc',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('studio.test/sign-in');
  });

  it('renders a magic-link payload without branding', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'magic-link',
      language: 'en',
      tenantName: 'Studio',
      url: 'https://studio.test/verify?token=abc',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.subject).toBe('Sign in to Studio');
  });

  it('renders a magic-link payload with branding', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'magic-link',
      language: 'en',
      tenantName: 'Caravan',
      url: 'https://caravan.test/verify?token=abc',
      branding,
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('caravan.test/verify');
  });

  it('renders a thread-reply payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'thread-reply',
      language: 'en',
      tenantName: 'Caravan',
      lessonName: 'Hammock lesson',
      authorDisplay: 'Olivia',
      snippet: 'Great question!',
      url: 'https://caravan.test/my/courses/c1/lessons/l1',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.text).toContain('Olivia');
  });

  it('renders a lesson-question payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'lesson-question',
      language: 'en',
      tenantName: 'Caravan',
      lessonName: 'Hammock lesson',
      authorDisplay: 'Olivia',
      snippet: 'Where do I start?',
      url: 'https://caravan.test/my/courses/c1/lessons/l1',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.subject).toContain('Hammock lesson');
  });

  it('renders a space-post payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'space-post',
      language: 'en',
      tenantName: 'Caravan',
      spaceName: 'Community',
      authorDisplay: 'Olivia',
      snippet: 'Hello everyone',
      url: 'https://caravan.test/community/s1/posts/p1',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('Community');
  });

  it('renders subscription lifecycle payloads', () => {
    const failed = renderEmailOutboxPayload({
      kind: 'subscription-payment-failed',
      language: 'en',
      tenantName: 'Caravan',
      productTitle: 'Course',
      accessEndsAt: '1998-08-17T10:00:00.000Z',
      billingPortalUrl: null,
    });
    expect(failed.success).toBe(true);

    const ended = renderEmailOutboxPayload({
      kind: 'subscription-ended',
      language: 'en',
      tenantName: 'Caravan',
      productTitle: 'Course',
      accessEndsAt: '1998-08-14T10:00:00.000Z',
      offerUrl: 'https://caravan.test/',
    });
    expect(ended.success).toBe(true);
  });

  it('renders a reputation alert with the measured window and rates', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'reputation-alert',
      language: 'en',
      tenantName: 'Studio',
      status: 'critical',
      hardBounceRate: 0.1,
      complaintRate: 0.0015,
      windowStart: '1998-07-20T12:00:00.000Z',
      windowEnd: '1998-07-27T12:00:00.000Z',
      dashboardUrl: 'https://studio.test/panel/marketing',
    });

    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.data.subject).toContain('critical');
      expect(rendered.data.text).toContain('10.000%');
      expect(rendered.data.text).toContain('0.150%');
    }
  });

  it('renders API-submitted content and a canonical reply-to header', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'm2m-transactional',
      subject: 'Receipt',
      text: 'Paid',
      replyTo: 'support@example.test',
    });
    expect(rendered).toEqual({
      success: true,
      payload: { kind: 'm2m-transactional', subject: 'Receipt', text: 'Paid', replyTo: 'support@example.test' },
      data: {
        subject: 'Receipt',
        html: '<pre>Paid</pre>',
        text: 'Paid',
        headers: { 'Reply-To': 'support@example.test' },
      },
    });
    expect(renderEmailOutboxPayload({ kind: 'm2m-transactional', subject: 'Missing body' }).success)
      .toBe(false);
  });

  it('renders a marketing consent confirmation in English when the payload carries no language', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'marketing-consent-confirmation',
      wording: 'Newsletter',
      confirmationUrl: 'https://studio.test/marketing/confirm?token=abc',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.subject).toBe('Confirm your e-mail consent');
  });

  it('fails on an unknown payload kind', () => {
    const rendered = renderEmailOutboxPayload({ kind: 'nonsense', language: 'en' });
    expect(rendered.success).toBe(false);
  });

  it('fails on a structurally invalid payload', () => {
    const rendered = renderEmailOutboxPayload({ kind: 'magic-link', language: 'en', tenantName: 'Studio', url: 'not-a-url' });
    expect(rendered.success).toBe(false);
  });
});

describe('isAuthBearingEmailPayload', () => {
  it.each(emailOutboxPayloadSchema.options.map((option) => ({ kind: option.shape.kind.value })))(
    'classifies $kind for global auth bearer isolation',
    ({ kind }) => {
      expect(isAuthBearingEmailPayload({ kind })).toBe([
        'welcome-sign-in', 'reset-password', 'verify-email', 'magic-link',
      ].includes(kind));
    },
  );
});
