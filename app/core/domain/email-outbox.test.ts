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

  it('fails on an unknown payload kind', () => {
    const rendered = renderEmailOutboxPayload({ kind: 'nonsense', language: 'pl' });
    expect(rendered.success).toBe(false);
  });

  it('fails on a structurally invalid payload', () => {
    const rendered = renderEmailOutboxPayload({ kind: 'magic-link', language: 'en', tenantName: 'Studio', url: 'not-a-url' });
    expect(rendered.success).toBe(false);
  });
});
