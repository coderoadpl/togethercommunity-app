import { describe, expect, it } from 'vitest';

import { renderEmailOutboxPayload } from './email-outbox.js';

const branding = { logoUrl: 'https://cdn.test/logo.png', accentColor: '#123456' };

describe('renderEmailOutboxPayload', () => {
  it('renders a welcome-set-password payload with branding', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'welcome-set-password',
      language: 'pl',
      tenantName: 'Kamperowo',
      actionUrl: 'https://kamperowo.test/set-password?token=abc',
      branding,
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('kamperowo.test/set-password');
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

  it('renders a welcome-set-password payload without branding', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'welcome-set-password',
      language: 'en',
      tenantName: 'Studio',
      actionUrl: 'https://studio.test/set-password?token=abc',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('studio.test/set-password');
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
      language: 'pl',
      tenantName: 'Kamperowo',
      url: 'https://kamperowo.test/verify?token=abc',
      branding,
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('kamperowo.test/verify');
  });

  it('renders a thread-reply payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'thread-reply',
      language: 'pl',
      tenantName: 'Kamperowo',
      lessonName: 'Lekcja o hamakach',
      authorDisplay: 'Ola',
      snippet: 'Świetne pytanie!',
      url: 'https://kamperowo.test/my/courses/c1/lessons/l1',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.text).toContain('Ola');
  });

  it('renders a lesson-question payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'lesson-question',
      language: 'en',
      tenantName: 'Kamperowo',
      lessonName: 'Lekcja o hamakach',
      authorDisplay: 'Ola',
      snippet: 'Where do I start?',
      url: 'https://kamperowo.test/my/courses/c1/lessons/l1',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.subject).toContain('Lekcja o hamakach');
  });

  it('renders a space-post payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'space-post',
      language: 'pl',
      tenantName: 'Kamperowo',
      spaceName: 'Społeczność',
      authorDisplay: 'Ola',
      snippet: 'Cześć wszystkim',
      url: 'https://kamperowo.test/community/s1/posts/p1',
    });
    expect(rendered.success).toBe(true);
    if (rendered.success) expect(rendered.data.html).toContain('Społeczność');
  });

  it('renders subscription lifecycle payloads', () => {
    const failed = renderEmailOutboxPayload({
      kind: 'subscription-payment-failed',
      language: 'pl',
      tenantName: 'Kamperowo',
      productTitle: 'Kurs',
      accessEndsAt: '2026-08-17T10:00:00.000Z',
      billingPortalUrl: null,
    });
    expect(failed.success).toBe(true);

    const ended = renderEmailOutboxPayload({
      kind: 'subscription-ended',
      language: 'en',
      tenantName: 'Kamperowo',
      productTitle: 'Course',
      accessEndsAt: '2026-08-14T10:00:00.000Z',
      offerUrl: 'https://kamperowo.test/',
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
      windowStart: '2026-07-20T12:00:00.000Z',
      windowEnd: '2026-07-27T12:00:00.000Z',
      dashboardUrl: 'https://studio.test/panel/marketing',
    });

    expect(rendered.success).toBe(true);
    if (rendered.success) {
      expect(rendered.data.subject).toContain('critical');
      expect(rendered.data.text).toContain('10.000%');
      expect(rendered.data.text).toContain('0.150%');
    }
  });

  it('fails on an unknown payload kind', () => {
    const rendered = renderEmailOutboxPayload({ kind: 'nonsense', language: 'pl' });
    expect(rendered.success).toBe(false);
  });

  it('fails on a structurally invalid payload', () => {
    const rendered = renderEmailOutboxPayload({ kind: 'magic-link', language: 'en', tenantName: 'Studio', url: 'not-a-url' });
    expect(rendered.success).toBe(false);
  });
});
