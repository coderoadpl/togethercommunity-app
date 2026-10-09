import { describe, expect, it } from 'vitest';

import { contrastRatio, deriveLightAccent } from './color.js';
import { emailOutboxPayloadSchema } from './email-outbox.js';
import { marketingConsentConfirmation } from './marketing-email.js';
import { expectedTransactionalEmailPl } from './transactional-email.expected.pl.js';
import { transactionalEmailMessagesEn } from './transactional-email.en.js';
import { transactionalEmailMessagesPl } from './transactional-email.pl.js';
import {
  directMessage,
  emailBrandingFrom,
  emailTransportTest,
  lessonQuestion,
  magicLink,
  memberErasureRequestEmail,
  purchaseEmailDetailsSchema,
  reputationAlertEmail,
  resetPassword,
  spaceEvent,
  spacePost,
  subscriptionEnded,
  subscriptionPaymentFailed,
  supportMessage,
  threadReply,
  verifyEmail,
  welcomeSignIn,
  type EmailMessage,
} from './transactional-email.js';

const plDate = (isoDateTime: string): string =>
  new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' })
    .format(new Date(isoDateTime));

describe('subscription lifecycle emails', () => {
  const input = {
    tenantName: 'Acme <Studio>',
    productTitle: 'Course "One"',
    accessEndsAt: '1998-08-17T10:00:00.000Z',
  };

  it('renders payment failure in both languages and omits an absent portal link', () => {
    const pl = subscriptionPaymentFailed('pl', { ...input, billingPortalUrl: null });
    expect(pl.subject).toContain('Course "One"');
    expect(pl.html).toContain('Acme &lt;Studio&gt;');
    expect(pl.html).toContain('Course &quot;One&quot;');
    expect(pl.html).toContain(plDate(input.accessEndsAt));
    expect(pl.html).not.toContain('<a ');

    const plWithPortal = subscriptionPaymentFailed('pl', {
      ...input,
      billingPortalUrl: 'https://billing.example.com/portal',
    });
    expect(plWithPortal.html).toContain(transactionalEmailMessagesPl.subscriptionPaymentFailed.billingPortalLabel);

    const en = subscriptionPaymentFailed('en', {
      ...input,
      billingPortalUrl: 'https://billing.example.com/portal',
    });
    expect(en.subject).toContain('Payment failed');
    expect(en.html).toContain('https://billing.example.com/portal');
    expect(en.html).toContain('Your access ends on 17 August 1998.');
    expect(en.text).toContain('Your access ends on 17 August 1998.');
  });

  it('renders ended subscription copy in both languages with an offer link', () => {
    const offerUrl = 'https://acme.example.com/';
    const pl = subscriptionEnded('pl', { ...input, offerUrl });
    expect(pl.subject).toContain('Course "One"');
    expect(pl.html).toContain(transactionalEmailMessagesPl.subscriptionEnded.offerLabel);
    expect(pl.text).toContain(plDate(input.accessEndsAt));
    const en = subscriptionEnded('en', { ...input, offerUrl });
    expect(en.html).toContain('View the offer');
    expect(en.text).toContain('Your access ends on 17 August 1998.');
  });

  it('formats dates in the Warsaw timezone in both languages', () => {
    const lateEvening = {
      ...input,
      accessEndsAt: '1998-08-31T22:30:00.000Z',
      offerUrl: 'https://acme.example.com/',
    };
    expect(subscriptionEnded('pl', lateEvening).text).toContain(plDate(lateEvening.accessEndsAt));
    expect(subscriptionEnded('en', lateEvening).text).toContain('Your access ends on 1 September 1998.');
  });
});

describe('member erasure request email', () => {
  const input = {
    tenantName: 'Acme',
    memberEmail: 'member@example.com',
    requestedAt: '1998-08-17T10:00:00.000Z',
    dueAt: '1998-09-16T10:00:00.000Z',
    panelUrl: 'https://acme.example.com/panel/members/member-1',
  };

  it('renders localized dates and the panel link in the fallback locale', () => {
    const pl = memberErasureRequestEmail('pl', input);
    expect(pl).toEqual(expectedTransactionalEmailPl.memberErasureRequestEmail);
  });

  it('renders localized dates and the panel link in English', () => {
    const en = memberErasureRequestEmail('en', input);
    expect(en.subject).toBe('[Acme] Member erasure request');
    expect(en.html).toContain('Requested: 17 August 1998');
    expect(en.html).toContain('Due: 16 September 1998');
    expect(en.text).toContain('Due: 16 September 1998');
    expect(en.html).toContain('Review request');
  });
});

describe('reputation alert email', () => {
  const input = {
    tenantName: 'Acme',
    status: 'warn' as const,
    hardBounceRate: 0.0123,
    complaintRate: 0.001,
    windowStart: '1998-08-17T10:00:00.000Z',
    windowEnd: '1998-08-24T10:00:00.000Z',
    dashboardUrl: 'https://acme.example.com/panel/marketing',
  };

  it('translates the status and the reporting window in the fallback locale', () => {
    const pl = reputationAlertEmail('pl', input);
    const status = transactionalEmailMessagesPl.reputationAlertEmail.statusLabels.warn;
    expect(pl.subject).toContain(status);
    expect(pl.html).toContain(`<strong>${status}</strong>`);
    expect(pl.html).toContain(plDate(input.windowStart));
    expect(pl.html).toContain(plDate(input.windowEnd));
    expect(reputationAlertEmail('pl', { ...input, status: 'critical' }).subject)
      .toContain(transactionalEmailMessagesPl.reputationAlertEmail.statusLabels.critical);
  });

  it('translates the status and the reporting window in English', () => {
    const en = reputationAlertEmail('en', input);
    expect(en.subject).toBe('[Acme] E-mail reputation: warning');
    expect(en.html).toContain('<strong>warning</strong>');
    expect(en.html).toContain('Window: 17 August 1998 – 24 August 1998');
    expect(reputationAlertEmail('en', { ...input, status: 'critical' }).subject)
      .toBe('[Acme] E-mail reputation: critical');
  });

  it('replaces missing rates with localized placeholders', () => {
    const pl = reputationAlertEmail('pl', { ...input, hardBounceRate: null, complaintRate: null });
    expect(pl.text).toContain(transactionalEmailMessagesPl.reputationAlertEmail.missingRate);
    expect(reputationAlertEmail('en', { ...input, hardBounceRate: null, complaintRate: null }).text)
      .toContain('Hard bounce rate: n/a');
  });
});

describe('support message email', () => {
  it('renders PL and EN while escaping sender-controlled content', () => {
    const input = {
      tenantName: 'Acme <Studio>',
      memberEmail: 'member@example.com',
      memberDisplay: 'Marta & Jan',
      subject: 'Help <now>',
      body: 'Please <script>alert(1)</script>',
    };
    const branding = {
      logoUrl: null,
      accentColor: null,
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
    };
    const pl = supportMessage('pl', { ...input, branding });
    expect(pl.html).toContain('Acme &lt;Studio&gt;');
    expect(pl.html).not.toContain('<script>');
    expect(pl.html).not.toContain('youtube.com');
    const en = supportMessage('en', { ...input, branding });
    expect(en.html).toContain('Reply to: member@example.com');
    expect(en.text).not.toContain('youtube.com');
  });
});

describe('email transport test message', () => {
  it('names the tested transport in PL and EN', () => {
    expect(emailTransportTest('pl', { transport: 'resend' }))
      .toEqual(expectedTransactionalEmailPl.emailTransportTest);
    expect(emailTransportTest('en', { transport: 'smtp' })).toMatchObject({
      subject: 'Together test e-mail (smtp)',
      text: expect.stringContaining('Your smtp transport is configured correctly.'),
    });
  });

  it('falls back to the default locale for unknown languages', () => {
    expect(emailTransportTest('de', { transport: 'ses' })).toEqual(emailTransportTest('en', { transport: 'ses' }));
  });
});

describe('welcomeSignIn', () => {
  it('renders the fallback-locale template', () => {
    const actionUrl = 'https://acme.localhost/sign-in?token=abc';
    expect(welcomeSignIn('pl', { tenantName: 'Acme Courses', actionUrl }))
      .toEqual(expectedTransactionalEmailPl.welcomeSignIn);
  });

  it('renders the English template', () => {
    expect(
      welcomeSignIn('en', {
        tenantName: 'Acme Courses',
        actionUrl: 'https://acme.localhost/sign-in?token=abc',
      }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Hello!</p><p>Your account on Acme Courses is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.</p><p><a href="https://acme.localhost/sign-in?token=abc">Sign in and open your course</a></p>",
        "subject": "Hello, your Acme Courses account is ready",
        "text": "Hello!

      Your account on Acme Courses is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.

      Sign in and open your course: https://acme.localhost/sign-in?token=abc",
      }
    `);
  });

  it.each([
    ['course', 'Sign in and open your course'],
    ['digital_download', 'Sign in and download your files'],
    ['membership', 'Sign in to your account'],
  ] as const)('renders the %s action in both languages', (productType, enLabel) => {
    const input = {
      tenantName: 'Acme Courses',
      actionUrl: 'https://acme.localhost/sign-in?token=abc',
      productType,
    };
    const plLabel = transactionalEmailMessagesPl.welcomeSignIn.actionLabels[productType];
    const en = welcomeSignIn('en', input);
    const pl = welcomeSignIn('pl', input);

    expect(en.html).toContain(`>${enLabel}</a>`);
    expect(en.text).toContain(`${enLabel}: ${input.actionUrl}`);
    expect(pl.html).toContain(`>${plLabel}</a>`);
    expect(pl.text).toContain(`${plLabel}: ${input.actionUrl}`);
  });

  it('defaults an absent product type to the course action', () => {
    const input = {
      tenantName: 'Acme Courses',
      actionUrl: 'https://acme.localhost/sign-in?token=abc',
    };
    expect(welcomeSignIn('en', input).text).toContain(`Sign in and open your course: ${input.actionUrl}`);
    expect(welcomeSignIn('pl', input).text).toContain(`${transactionalEmailMessagesPl.welcomeSignIn.actionLabels.course}: ${input.actionUrl}`);
  });

  it('renders unknown product types with the neutral action', () => {
    const input = {
      tenantName: 'Acme Courses',
      actionUrl: 'https://acme.localhost/sign-in?token=abc',
      productType: 'unknown',
    } as const;
    expect(welcomeSignIn('en', input).text).toContain(`Sign in to your account: ${input.actionUrl}`);
    expect(welcomeSignIn('pl', input).text).toContain(`${transactionalEmailMessagesPl.welcomeSignIn.actionLabels.unknown}: ${input.actionUrl}`);
  });

  it('falls back to the default locale for unknown languages', () => {
    expect(welcomeSignIn('de', { tenantName: 'Acme', actionUrl: 'https://x/y' }).subject).toBe(
      welcomeSignIn('en', { tenantName: 'Acme', actionUrl: 'https://x/y' }).subject,
    );
  });

  it('escapes HTML in the tenant name and action url', () => {
    expect(
      welcomeSignIn('en', {
        tenantName: "Ben & Jerry's <Studio>",
        actionUrl: 'https://x/y?a=1&b=2',
      }).html,
    ).toMatchInlineSnapshot(`"<p>Hello!</p><p>Your account on Ben &amp; Jerry&#39;s &lt;Studio&gt; is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.</p><p><a href="https://x/y?a=1&amp;b=2">Sign in and open your course</a></p>"`);
  });
});

describe('resetPassword', () => {
  it('renders the fallback-locale template', () => {
    const actionUrl = 'https://acme.localhost/reset?token=abc';
    expect(resetPassword('pl', { actionUrl })).toEqual(expectedTransactionalEmailPl.resetPassword);
  });

  it('renders the English template', () => {
    expect(resetPassword('en', { actionUrl: 'https://acme.localhost/reset?token=abc' })).toMatchInlineSnapshot(`
      {
        "html": "<p>Hello!</p><p>Please click the link below to reset your password:</p><p><a href="https://acme.localhost/reset?token=abc">Reset password</a></p><p>The password reset link expires in one hour.</p>",
        "subject": "Reset your password",
        "text": "Hello!

      Please open the link below to reset your password:
      https://acme.localhost/reset?token=abc

      The password reset link expires in one hour.",
      }
    `);
  });
});

describe('magicLink', () => {
  it('renders the fallback-locale template', () => {
    const url = 'https://acme.localhost/magic?token=abc';
    expect(magicLink('pl', { tenantName: 'Acme Courses', url }))
      .toEqual(expectedTransactionalEmailPl.magicLink);
  });

  it('renders the English template', () => {
    expect(
      magicLink('en', { tenantName: 'Acme Courses', url: 'https://acme.localhost/magic?token=abc' }),
    ).toMatchInlineSnapshot(`
      {
        "html": "<p>Hello!</p><p>Use this link to sign in to Acme Courses:</p><p><a href="https://acme.localhost/magic?token=abc">Sign in</a></p><p>If you did not request this email, you can ignore it.</p>",
        "subject": "Sign in to Acme Courses",
        "text": "Hello!

      Use this link to sign in to Acme Courses:
      https://acme.localhost/magic?token=abc

      If you did not request this email, you can ignore it.",
      }
    `);
  });
});

describe('notification opt-out footer', () => {
  const replyInput = {
    tenantName: 'Acme Courses',
    lessonName: 'Variables',
    authorDisplay: 'Alex',
    snippet: 'Thanks!',
    url: 'https://acme.localhost/my/courses/c1/lessons/l1',
  };
  const postInput = {
    tenantName: 'Acme Courses',
    spaceName: 'Community',
    authorDisplay: 'Alex',
    snippet: 'Hello everyone!',
    url: 'https://acme.localhost/community/s1/posts/p1',
  };

  it('links thread-mute management from the thread-reply mail in both languages', () => {
    const pl = threadReply('pl', replyInput);
    const fallbackFooter = transactionalEmailMessagesPl.manageNotifications;
    expect(pl.html).toContain(
      `<a href="${replyInput.url}">${fallbackFooter.label}</a> (${fallbackFooter.hints.thread})`,
    );
    expect(pl.text).toContain(`${fallbackFooter.label} (${fallbackFooter.hints.thread}): ${replyInput.url}`);

    const en = threadReply('en', replyInput);
    expect(en.html).toContain(
      `<a href="${replyInput.url}">Manage notifications</a> (you can mute this thread in the discussion)`,
    );
    expect(en.text).toContain(`Manage notifications (you can mute this thread in the discussion): ${replyInput.url}`);
  });

  it('links space-unfollow management from the space-post mail in both languages', () => {
    const pl = spacePost('pl', postInput);
    const fallbackFooter = transactionalEmailMessagesPl.manageNotifications;
    expect(pl.html).toContain(
      `<a href="${postInput.url}">${fallbackFooter.label}</a> (${fallbackFooter.hints.space})`,
    );
    expect(pl.text).toContain(`${fallbackFooter.label} (${fallbackFooter.hints.space}): ${postInput.url}`);

    const en = spacePost('en', postInput);
    expect(en.html).toContain(
      `<a href="${postInput.url}">Manage notifications</a> (you can unfollow the space there)`,
    );
    expect(en.text).toContain(`Manage notifications (you can unfollow the space there): ${postInput.url}`);
  });

  it('renders lesson-question copy and thread management in both languages', () => {
    const pl = lessonQuestion('pl', replyInput);
    expect(pl).toEqual(expectedTransactionalEmailPl.lessonQuestion);

    const en = lessonQuestion('en', replyInput);
    expect(en.subject).toBe('New question under “Variables”');
    expect(en.text).toContain('Alex asked a question under “Variables”');
    expect(en.text).toContain('Manage notifications');
  });

  it('escapes angle-bracketed post excerpts in every notification mail', () => {
    const snippet = 'Generic<T> plus <script>alert(1)</script>';
    const messages = [
      threadReply('pl', { ...replyInput, snippet }),
      lessonQuestion('en', { ...replyInput, snippet }),
      spacePost('pl', { ...postInput, snippet }),
      spaceEvent('en', { ...postInput, snippet }),
      directMessage('pl', {
        tenantName: postInput.tenantName,
        senderDisplay: postInput.authorDisplay,
        snippet,
        url: postInput.url,
      }),
    ];
    for (const message of messages) {
      expect(message.html).toContain('Generic&lt;T&gt; plus &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(message.html).not.toContain('<script>');
      expect(message.text).toContain(snippet);
    }
  });
});

describe('email branding header', () => {
  const input = {
    tenantName: 'Academy Demo',
    actionUrl: 'https://academy.localhost/set-password?token=abc',
  };

  it('is byte-identical to the unbranded mail when both branding fields are null', () => {
    expect(
      welcomeSignIn('pl', { ...input, branding: { logoUrl: null, accentColor: null } }),
    ).toEqual(welcomeSignIn('pl', input));
    expect(
      magicLink('en', {
        tenantName: input.tenantName,
        url: input.actionUrl,
        branding: { logoUrl: null, accentColor: null },
      }),
    ).toEqual(magicLink('en', { tenantName: input.tenantName, url: input.actionUrl }));
  });

  it('prepends the accent rule and logo to the welcome mail', () => {
    const message = welcomeSignIn('pl', {
      ...input,
      branding: { logoUrl: 'https://academy.localhost/assets/academy-logo.svg', accentColor: '#0E7490' },
    });
    expect(message.html.startsWith('<div style="border-top:4px solid #0E7490;')).toBe(true);
    expect(message.html).toContain('<img src="https://academy.localhost/assets/academy-logo.svg"');
    expect(message.text).not.toContain('img');
  });

  it('brands the magic-link mail and escapes the logo URL', () => {
    const message = magicLink('pl', {
      tenantName: input.tenantName,
      url: input.actionUrl,
      branding: { logoUrl: 'https://x.dev/logo.svg?a=1&b=2', accentColor: null },
    });
    expect(message.html).toContain('<img src="https://x.dev/logo.svg?a=1&amp;b=2"');
    expect(message.html.startsWith('<div style="border-top:4px solid #191512;')).toBe(true);
  });

  it('renders social profiles in HTML and plain-text transactional mail', () => {
    const message = welcomeSignIn('en', {
      ...input,
      branding: {
        logoUrl: null,
        accentColor: null,
        socialLinks: [{ label: 'YouTube & more', url: 'https://youtube.com/@academy?a=1&b=2' }],
      },
    });

    expect(message.html).toContain('YouTube &amp; more');
    expect(message.html).toContain('https://youtube.com/@academy?a=1&amp;b=2');
    expect(message.text).toContain('YouTube & more: https://youtube.com/@academy?a=1&b=2');
  });
});

describe('emailBrandingFrom', () => {
  const baseUrl = 'https://academy.together.test/';

  it.each([null, '#786000'])('resolves the light accent %s for email rules', (accentLight) => {
    const branding = emailBrandingFrom({ logoUrl: null, accentColor: '#F5C842', accentLight }, baseUrl);
    expect(branding.accentColor).toBe(accentLight ?? deriveLightAccent('#F5C842'));
    expect(contrastRatio(branding.accentColor ?? '', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const message = welcomeSignIn('en', { tenantName: 'Acme', actionUrl: baseUrl, branding });
    expect(message.html).toContain(`border-top:4px solid ${branding.accentColor}`);
  });

  it('resolves app-relative branding assets against the tenant base URL', () => {
    expect(
      emailBrandingFrom({ logoUrl: '/api/public/assets/logo/abc.png', accentColor: '#7C2D92' }, baseUrl),
    ).toEqual({
      logoUrl: 'https://academy.together.test/api/public/assets/logo/abc.png',
      accentColor: '#7C2D92',
      socialLinks: undefined,
    });
  });

  it('keeps absolute logo URLs and a missing logo untouched', () => {
    expect(
      emailBrandingFrom({ logoUrl: 'https://cdn.test/logo.svg', accentColor: null }, baseUrl).logoUrl,
    ).toBe('https://cdn.test/logo.svg');
    expect(emailBrandingFrom({ logoUrl: null, accentColor: null }, baseUrl).logoUrl).toBeNull();
  });

  it('takes the light-background variant and ignores a dark one beside it', () => {
    expect(
      emailBrandingFrom(
        { logoUrl: '/light.svg', logoDarkUrl: '/dark.svg', accentColor: null },
        baseUrl,
      ).logoUrl,
    ).toBe('https://academy.together.test/light.svg');
  });

  it('falls back to the dark variant when it is the only uploaded logo', () => {
    expect(
      emailBrandingFrom({ logoUrl: null, logoDarkUrl: '/dark.svg', accentColor: null }, baseUrl).logoUrl,
    ).toBe('https://academy.together.test/dark.svg');
  });
});

describe('transactional message catalogue', () => {
  const notification = {
    tenantName: 'Acme Courses',
    lessonName: 'Lesson 1',
    spaceName: 'Announcements',
    authorDisplay: 'Alex',
    senderDisplay: 'Alex',
    snippet: 'Hello!',
    url: 'https://acme.test/thread',
  };
  const linkless = new Set(['support-message', 'email-transport-test']);
  const memberWrittenSubject = new Set(['support-message']);
  const catalogue: Array<[string, (language: string) => EmailMessage]> = [
    ['welcome-sign-in', (language) => welcomeSignIn(language, { tenantName: 'Acme Courses', actionUrl: 'https://acme.test/in' })],
    ['reset-password', (language) => resetPassword(language, { actionUrl: 'https://acme.test/reset' })],
    ['verify-email', (language) => verifyEmail(language, { actionUrl: 'https://acme.test/verify' })],
    ['magic-link', (language) => magicLink(language, { tenantName: 'Acme Courses', url: 'https://acme.test/in' })],
    ['thread-reply', (language) => threadReply(language, notification)],
    ['lesson-question', (language) => lessonQuestion(language, notification)],
    ['space-post', (language) => spacePost(language, notification)],
    ['space-event', (language) => spaceEvent(language, notification)],
    ['direct-message', (language) => directMessage(language, notification)],
    ['subscription-payment-failed', (language) => subscriptionPaymentFailed(language, {
      tenantName: 'Acme Courses', productTitle: 'Course', accessEndsAt: '1998-08-17T10:00:00.000Z',
      billingPortalUrl: 'https://acme.test/billing',
    })],
    ['subscription-ended', (language) => subscriptionEnded(language, {
      tenantName: 'Acme Courses', productTitle: 'Course', accessEndsAt: '1998-08-17T10:00:00.000Z',
      offerUrl: 'https://acme.test/offer',
    })],
    ['support-message', (language) => supportMessage(language, {
      tenantName: 'Acme Courses', memberEmail: 'alex@acme.test', memberDisplay: 'Alex',
      subject: 'Question', body: 'Body',
    })],
    ['member-erasure-request', (language) => memberErasureRequestEmail(language, {
      tenantName: 'Acme Courses', memberEmail: 'alex@acme.test',
      requestedAt: '1998-08-17T10:00:00.000Z', dueAt: '1998-09-17T10:00:00.000Z',
      panelUrl: 'https://acme.test/panel',
    })],
    ['reputation-alert', (language) => reputationAlertEmail(language, {
      tenantName: 'Acme Courses', status: 'warn', hardBounceRate: 0.02, complaintRate: null,
      windowStart: '1998-08-01T10:00:00.000Z', windowEnd: '1998-08-17T10:00:00.000Z',
      dashboardUrl: 'https://acme.test/reputation',
    })],
    ['email-transport-test', (language) => emailTransportTest(language, { transport: 'ses' })],
    ['marketing-consent-confirmation', (language) => marketingConsentConfirmation({
      language, wording: 'News and offers', confirmationUrl: 'https://acme.test/confirm',
    })],
  ];

  it('holds a rendering for every outbox payload kind built from a template', () => {
    const kindsWithoutTemplate = new Set<string>([
      'auth-magic-link',
      'auth-password-reset',
      'auth-email-verification',
      'm2m-transactional',
    ]);
    const catalogued = catalogue.map(([kind]) => kind);
    for (const option of emailOutboxPayloadSchema.options) {
      const kind: string = option.shape.kind.value;
      if (kindsWithoutTemplate.has(kind)) continue;
      expect(catalogued).toContain(kind);
    }
  });

  it.each(catalogue)('renders %s with a subject, body and CTA in both languages', (kind, render) => {
    for (const language of ['pl', 'en']) {
      const message = render(language);
      expect(message.subject.trim()).not.toBe('');
      expect(message.html.trim()).not.toBe('');
      expect(message.text.trim()).not.toBe('');
      if (linkless.has(kind)) continue;
      expect(message.html).toContain('http');
      expect(message.text).toContain('http');
    }
  });

  it.each(catalogue)('renders %s differently in Polish and English', (kind, render) => {
    expect(render('en').text).not.toEqual(render('pl').text);
    if (memberWrittenSubject.has(kind)) return;
    expect(render('en').subject).not.toEqual(render('pl').subject);
  });

  it.each(catalogue)('falls back to the default locale for %s when the language is unsupported', (_kind, render) => {
    expect(render('de')).toEqual(render('en'));
  });
});

describe('verifyEmail', () => {
  it('renders both languages with the confirmation link', () => {
    expect(verifyEmail('pl', { actionUrl: 'https://acme.test/verify' })).toMatchObject({
      subject: transactionalEmailMessagesPl.verifyEmail.render({
        actionUrl: 'https://acme.test/verify',
        actionLink: `<a href="https://acme.test/verify">${transactionalEmailMessagesPl.verifyEmail.actionLabel}</a>`,
      }).subject,
      text: expect.stringContaining('https://acme.test/verify'),
    });
    expect(verifyEmail('en', { actionUrl: 'https://acme.test/verify' })).toMatchObject({
      subject: 'Verify your email address',
      text: expect.stringContaining('Confirm that this email address belongs to you'),
    });
  });
});

describe('spaceEvent', () => {
  const input = {
    tenantName: 'Acme Courses',
    spaceName: 'Announcements',
    authorDisplay: 'Alex',
    snippet: 'Thursday meetup',
    url: 'https://acme.test/community/s1/events/e1',
  };

  it('names the space in the subject in both languages', () => {
    expect(spaceEvent('pl', input)).toEqual(expectedTransactionalEmailPl.spaceEvent);
    expect(spaceEvent('en', input).subject).toBe('New event in “Announcements”');
  });
});

describe('directMessage', () => {
  const input = {
    tenantName: 'Acme Courses',
    senderDisplay: 'Alex',
    snippet: 'Hello!',
    url: 'https://acme.test/messages/dc1',
  };

  it('names the sender in the subject in both languages', () => {
    expect(directMessage('pl', input)).toEqual(expectedTransactionalEmailPl.directMessage);
    expect(directMessage('en', input).subject).toBe('New message from Alex');
  });
});

it.each(['en', 'pl'])('includes escaped purchase lines, an order number and a linked QR in %s', (language) => {
  const verificationUrl = `https://shop.example.org/panel/orders/verify/${'a'.repeat(64)}`;
  const qrImageUrl = `https://shop.example.org/api/public/orders/qr/${'a'.repeat(64)}`;
  const message = welcomeSignIn(language, {
    tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', productType: 'physical',
    purchase: { orderNumber: 'order-42', verificationUrl, qrImageUrl, lines: ['Printed <material>', 'Digital companion'] },
  });
  expect(message.html).toContain('order-42');
  expect(message.html).toContain('<li>Printed &lt;material&gt;</li><li>Digital companion</li>');
  expect(message.html).toContain(`<a href="${verificationUrl}"><img src="${qrImageUrl}"`);
  expect(message.text).toContain('- Printed <material>\n- Digital companion');
  expect(message.text).toContain(verificationUrl);
  expect(message.text).toContain(language === 'en' ? 'Order number' : transactionalEmailMessagesPl.purchase.orderNumber);
});

it.each(['en', 'pl'])('places the purchase block before the social footer in %s', (language) => {
  const verificationUrl = `https://shop.example.org/panel/orders/verify/${'a'.repeat(64)}`;
  const qrImageUrl = `https://shop.example.org/api/public/orders/qr/${'a'.repeat(64)}`;
  const socialUrl = 'https://social.example.org/workspace';
  const message = welcomeSignIn(language, {
    tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', productType: 'physical',
    purchase: { orderNumber: 'order-42', verificationUrl, qrImageUrl, lines: ['Printed material'] },
    branding: { logoUrl: null, accentColor: null, socialLinks: [{ label: 'Community profile', url: socialUrl }] },
  });
  expect(message.html).toContain(`</a><p style="font-size:12px;margin-top:24px"><a href="${socialUrl}">Community profile</a></p>`);
  expect(message.html.indexOf(qrImageUrl)).toBeLessThan(message.html.indexOf(socialUrl));
  expect(message.html.match(/Community profile/g)).toHaveLength(1);
  expect(message.text).toContain(`${verificationUrl}\n\nCommunity profile: ${socialUrl}`);
  expect(message.text.match(/Community profile/g)).toHaveLength(1);
});

describe('purchase confirmation amounts', () => {
  const purchase = {
    orderNumber: 'order-42',
    verificationUrl: 'https://shop.example.org/panel/orders/verify/token',
    qrImageUrl: 'https://shop.example.org/api/public/orders/qr/token',
    lines: [
      { name: 'Printed <material>', grossCents: 4900, vatRate: 5 },
      { name: 'Digital companion', grossCents: 2100, vatRate: 23 },
      { name: 'Additional item', grossCents: 1000, vatRate: 8 },
      { name: 'Included item', grossCents: 0, vatRate: null },
      { name: 'Exempt item', grossCents: 0, vatRate: 'exempt' },
    ],
    currency: 'PLN',
    totalCents: 8000,
  };

  it.each([
    ['pl', 'PLN', ['49,00\u00a0z\u0142', '21,00\u00a0z\u0142', '10,00\u00a0z\u0142', '0,00\u00a0z\u0142'], '80,00\u00a0z\u0142'],
    ['en', 'PLN', ['PLN\u00a049.00', 'PLN\u00a021.00', 'PLN\u00a010.00', 'PLN\u00a00.00'], 'PLN\u00a080.00'],
    ['pl', 'EUR', ['49,00\u00a0€', '21,00\u00a0€', '10,00\u00a0€', '0,00\u00a0€'], '80,00\u00a0€'],
    ['en', 'EUR', ['€49.00', '€21.00', '€10.00', '€0.00'], '€80.00'],
  ] as const)('renders amounts, VAT, total and confirmation copy in %s with %s', (language, currency, amounts, total) => {
    const details = purchaseEmailDetailsSchema.parse({ ...purchase, currency });
    const labels = (language === 'pl' ? transactionalEmailMessagesPl : transactionalEmailMessagesEn).purchase;
    const message = welcomeSignIn(language, {
      tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', purchase: details,
    });
    expect(message.subject).toBe(labels.subject('order-42', 'Workspace'));
    if (language === 'en') expect(message.subject).toBe('Purchase confirmation order-42 — Workspace');
    expect(message.html).toContain(`<thead><tr><th>${labels.item}</th><th>${labels.amount}</th><th>${labels.vat}</th></tr></thead>`);
    expect(message.html).not.toContain('<ul>');
    const vats = ['5\u00a0%', '23\u00a0%', '8\u00a0%', labels.exempt, labels.exempt];
    details.lines.forEach((line, index) => {
      if (typeof line === 'string') throw new Error('Expected a structured purchase line');
      const amount = amounts[index] ?? amounts[3];
      const escapedName = line.name.replace('<', '&lt;').replace('>', '&gt;');
      expect(message.html).toContain(`<tr><td>${escapedName}</td><td>${amount}</td><td>${vats[index]}</td></tr>`);
      expect(message.text).toContain(`- ${line.name} — ${amount} (${vats[index]})`);
    });
    expect(message.html).toContain(`<tr><td><strong>${labels.total}</strong></td><td><strong>${total}</strong></td><td></td></tr>`);
    expect(message.text).toContain(`${labels.total}: ${total}`);
    expect(message.html).toContain(`</table><p>${labels.notInvoice}</p>`);
    expect(message.text).toContain(`\n\n${labels.notInvoice}\n\n${labels.verification}`);
    expect(message.html.indexOf('order-42')).toBeLessThan(message.html.indexOf('<table>'));
    expect(message.html).toContain(`<a href="${details.verificationUrl}"><img src="${details.qrImageUrl}"`);
  });

  it.each(['en', 'pl'])('retains name lists for legacy and mixed lines in %s', (language) => {
    const labels = (language === 'pl' ? transactionalEmailMessagesPl : transactionalEmailMessagesEn).purchase;
    for (const details of [
      purchaseEmailDetailsSchema.parse({ ...purchase, currency: undefined, totalCents: undefined }),
      purchaseEmailDetailsSchema.parse({ ...purchase, lines: ['Printed <material>', purchase.lines[1]] }),
    ]) {
      const message = welcomeSignIn(language, {
        tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', purchase: details,
      });
      expect(message.html).toContain('<ul><li>Printed &lt;material&gt;</li><li>Digital companion</li>');
      expect(message.html).not.toContain('<table>');
      expect(message.text).toContain('- Printed <material>\n- Digital companion');
      expect(message.subject).toBe(labels.subject('order-42', 'Workspace'));
      expect(message.html).toContain(`</ul><p>${labels.notInvoice}</p>`);
      expect(message.text).toContain(labels.notInvoice);
    }
  });

  it('escapes the order number, workspace name and purchase URLs in HTML', () => {
    const details = purchaseEmailDetailsSchema.parse({
      ...purchase, orderNumber: 'order-<42>',
      verificationUrl: `${purchase.verificationUrl}?a=1&b=2`,
      qrImageUrl: `${purchase.qrImageUrl}?a=1&b=2`,
    });
    const message = welcomeSignIn('en', {
      tenantName: 'Workspace <shop>', actionUrl: 'https://shop.example.org/sign-in', purchase: details,
    });
    expect(message.html).toContain('Workspace &lt;shop&gt;');
    expect(message.html).toContain('order-&lt;42&gt;');
    expect(message.html).toContain(`href="${purchase.verificationUrl}?a=1&amp;b=2"`);
    expect(message.html).toContain(`src="${purchase.qrImageUrl}?a=1&amp;b=2"`);
  });

  it.each([
    { currency: undefined }, { totalCents: undefined }, { currency: 'pln' }, { totalCents: -1 }, { totalCents: 1.5 },
    { lines: [{ name: '', grossCents: 4900, vatRate: 5 }] },
    { lines: [{ name: 'Item', grossCents: -1, vatRate: 5 }] },
    { lines: [{ name: 'Item', grossCents: 1.5, vatRate: 5 }] },
    { lines: [{ name: 'Item', grossCents: 4900, vatRate: 7 }] },
  ])('rejects invalid purchase details: %j', (overrides) => {
    expect(purchaseEmailDetailsSchema.safeParse({ ...purchase, ...overrides }).success).toBe(false);
  });

  it('accepts legacy strings and structured lines in the queued payload', () => {
    for (const details of [purchase, { ...purchase, lines: ['Printed material'], currency: undefined, totalCents: undefined }]) {
      expect(emailOutboxPayloadSchema.safeParse({
        kind: 'welcome-sign-in', language: 'en', tenantName: 'Workspace',
        actionUrl: 'https://shop.example.org/sign-in', purchase: details,
      }).success).toBe(true);
    }
  });
});
