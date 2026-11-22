import { describe, expect, it } from 'vitest';

import { contrastRatio, deriveLightAccent } from './color.js';
import { emailOutboxPayloadSchema, renderEmailOutboxPayload } from './email-outbox.js';
import { marketingConsentConfirmation } from './marketing-email.js';
import { ORDER_REFUND_ALERTS } from './order-refund-job.js';
import { expectedPurchaseConfirmationPl, expectedPurchaseDeliveryPl, expectedPurchasePersonalizationPl, expectedTransactionalEmailPl, orderShippedFixturePl, purchaseDeliveryFixturesPl } from './transactional-email.expected.pl.js';
import { transactionalEmailMessagesEn } from './transactional-email.en.js';
import { transactionalEmailMessagesPl } from './transactional-email.pl.js';
import {
  directMessage,
  emailBrandingFrom,
  emailContactUrl,
  emailTransportTest,
  lessonQuestion,
  magicLink,
  memberErasureRequestEmail,
  purchaseEmailDetailsSchema,
  reputationAlertEmail,
  resetPassword,
  spaceEvent,
  spacePost,
  stockLowEmail,
  orderOutOfStockEmail,
  orderRefundAlertEmail,
  orderSoldOutRefundEmail,
  subscriptionEnded,
  orderShipped,
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
    expect(en.subject).toBe('Payment failed for Course "One" — Acme <Studio>');
    expect(en.html).toContain('https://billing.example.com/portal');
    expect(en.html).toContain('Unless the payment goes through, your access ends on 17 August 1998.');
    expect(en.text).toContain('Unless the payment goes through, your access ends on 17 August 1998.');
    expect(en.text).not.toContain('settle the payment');
  });

  it('points to the workspace contact when the payment failure has no billing portal', () => {
    const contactUrl = 'https://acme.example.com/account';
    const en = subscriptionPaymentFailed('en', { ...input, billingPortalUrl: null, contactUrl });
    expect(en.html).toContain('<p>To keep your access, contact Acme &lt;Studio&gt; to settle the payment.</p>');
    expect(en.html).toContain(`<a href="${contactUrl}">Contact support</a>`);
    expect(en.text).toContain(`To keep your access, contact Acme <Studio> to settle the payment.\n\nContact support: ${contactUrl}`);
    expect(en.text).not.toMatch(/retr/i);

    const pl = subscriptionPaymentFailed('pl', { ...input, billingPortalUrl: null, contactUrl });
    expect(pl.subject.endsWith('” — Acme <Studio>')).toBe(true);
    expect(pl.html).toContain(`<a href="${contactUrl}">${transactionalEmailMessagesPl.subscriptionPaymentFailed.contactLabel}</a>`);

    const withWorkspace = subscriptionPaymentFailed('en', { ...input, billingPortalUrl: null, contactUrl: null, workspaceUrl: 'https://acme.example.com/' });
    expect(withWorkspace.html).toContain('<p><a href="https://acme.example.com/">Open Acme &lt;Studio&gt;</a></p>');
    expect(withWorkspace.text).toContain('settle the payment.\n\nOpen Acme <Studio>: https://acme.example.com/');
    expect(subscriptionPaymentFailed('pl', { ...input, billingPortalUrl: null, contactUrl: null, workspaceUrl: 'https://acme.example.com/' }).html)
      .toContain(`<a href="https://acme.example.com/">${transactionalEmailMessagesPl.subscriptionPaymentFailed.workspaceLabel('Acme &lt;Studio&gt;')}</a>`);

    const withoutContact = subscriptionPaymentFailed('en', { ...input, billingPortalUrl: null, contactUrl: null });
    expect(withoutContact.text).toContain('To keep your access, contact Acme <Studio> to settle the payment.');
    expect(withoutContact.html).not.toContain('<a ');
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
    expect(en.subject).toBe('New reply in the “Variables” discussion — Acme Courses');
    expect(pl.subject.endsWith('„Variables” — Acme Courses')).toBe(true);
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
    expect(en.subject).toBe('New post in “Community” — Acme Courses');
    expect(pl.subject.endsWith('„Community” — Acme Courses')).toBe(true);
  });

  it('renders lesson-question copy and thread management in both languages', () => {
    const pl = lessonQuestion('pl', replyInput);
    expect(pl).toEqual(expectedTransactionalEmailPl.lessonQuestion);

    const en = lessonQuestion('en', replyInput);
    expect(en.subject).toBe('New question under “Variables” — Acme Courses');
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

describe('emailContactUrl', () => {
  it('prefers the account support form, then the support page, and promises nothing without either', () => {
    const base = 'https://acme.togethercommunity.app/';
    expect(emailContactUrl({ supportEmail: 'help@example.com', supportUrl: 'https://help.example.com' }, base)).toBe('https://acme.togethercommunity.app/account?support=open');
    expect(emailContactUrl({ supportEmail: null, supportUrl: 'https://help.example.com' }, base)).toBe('https://help.example.com');
    expect(emailContactUrl({ supportEmail: null, supportUrl: null }, base)).toBeNull();
    expect(emailContactUrl(null, base)).toBeNull();
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
    ['order-shipped', (language) => orderShipped(language, orderShippedFixturePl)],
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
    ['stock-low', (language) => stockLowEmail(language, {
      tenantName: 'Acme Courses', productTitle: 'Printed poster', available: 1, threshold: 2,
      oversold: false, studioUrl: 'https://acme.test/panel/products/p1',
    })],
    ['order-out-of-stock', (language) => orderOutOfStockEmail(language, {
      tenantName: 'Acme Courses', orderId: 'order-1', buyerEmail: 'buyer@acme.test', amountCents: 4099, currency: 'PLN',
      productTitles: ['Printed poster'], orderUrl: 'https://acme.test/panel/sales/order-1',
    })],
    ['order-refund-alert', (language) => orderRefundAlertEmail(language, {
      tenantName: 'Acme Courses', alert: 'retrying', orderId: 'order-1', amountCents: 4099, currency: 'PLN',
      error: 'Stripe is unavailable', orderUrl: 'https://acme.test/panel/sales/order-1',
    })],
    ['order-sold-out-refund', (language) => orderSoldOutRefundEmail(language, {
      tenantName: 'Acme Courses', orderId: 'order-1', amountCents: 4099, currency: 'PLN',
      productTitles: ['Printed poster'], shopUrl: 'https://acme.test/',
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

describe('orderShipped', () => {
  const addressDelivery = {
    tenantName: 'Acme Courses',
    shipment: {
      orderNumber: 'order-42',
      items: ['Printed <stand>'],
      delivery: { method: 'Courier', pickupPoint: null, address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' } },
      carrier: 'other' as const,
      trackingNumber: 'RR123456789PL',
      trackingUrl: null,
    },
  };

  it('matches the Polish golden message for a parcel locker shipment', () => {
    expect(orderShipped('pl', orderShippedFixturePl)).toEqual(expectedTransactionalEmailPl.orderShipped);
  });

  it('renders the postal address, escapes item names and omits the link for other carriers', () => {
    const message = orderShipped('en', addressDelivery);
    expect(message.subject).toBe('Order shipped — Acme Courses (#ORDER-42)');
    expect(message.html).toContain('<p>Your order #ORDER-42 from Acme Courses has been shipped.</p><p>Shipped items</p>');
    expect(message.html).toContain('<li>Printed &lt;stand&gt;</li>');
    expect(message.html).toContain('<p><strong>Delivery</strong>: Courier<br>Jane Buyer<br>Garden Street 5<br>00-950 Warsaw<br>Poland</p>');
    expect(message.html).toContain('<p>Order number: order-42<br>Tracking number: RR123456789PL</p>');
    expect(message.html).not.toContain('Carrier');
    expect(message.html).not.toContain('<a ');
    expect(message.text).toContain('Order number: order-42\nTracking number: RR123456789PL');
  });

  it('adds the workspace branding and social links', () => {
    const message = orderShipped('en', {
      ...addressDelivery,
      branding: { logoUrl: 'https://acme.test/logo.png', accentColor: '#112233', socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/acme' }] },
    });
    expect(message.html).toContain('src="https://acme.test/logo.png"');
    expect(message.text).toContain('Instagram: https://instagram.com/acme');
  });
});

describe('stock low email', () => {
  const input = {
    tenantName: 'Acme',
    productTitle: 'Printed <poster>',
    available: 1,
    threshold: 2,
    oversold: false,
    studioUrl: 'https://acme.example.com/panel/products/product-1',
  };

  it('renders the low-stock alert in Polish', () => {
    expect(stockLowEmail('pl', input)).toEqual(expectedTransactionalEmailPl.stockLowEmail);
  });

  it('renders the oversold alert in Polish without a threshold', () => {
    expect(stockLowEmail('pl', { ...input, available: 0, threshold: null, oversold: true })).toEqual(expectedTransactionalEmailPl.stockOversoldEmail);
  });

  it('renders the available count, threshold, oversold note and Studio link in English', () => {
    const low = stockLowEmail('en', input);
    expect(low.subject).toBe('[Acme] Low stock: Printed <poster>');
    expect(low.html).toContain('Printed &lt;poster&gt; is running low.');
    expect(low.text).toContain('Available: 1\nLow-stock threshold: 2');
    expect(low.html).toContain('href="https://acme.example.com/panel/products/product-1"');
    expect(low.text).not.toContain('no piece was left');
    const oversold = stockLowEmail('en', { ...input, available: 0, threshold: null, oversold: true });
    expect(oversold.subject).toBe('[Acme] Oversold: Printed <poster>');
    expect(oversold.text).toContain('Low-stock threshold: not set');
    expect(oversold.html).toContain('no piece was left');
  });
});

describe('order out of stock email', () => {
  const input = {
    tenantName: 'Acme', orderId: 'order-<1>', buyerEmail: 'buyer@example.com', amountCents: 4099, currency: 'PLN',
    productTitles: ['Printed <poster>', 'Mug'], orderUrl: 'https://acme.example.com/panel/sales/order-1',
  };

  it('tells staff the order was cancelled with the refunded amount, the short products and the order link', () => {
    const message = orderOutOfStockEmail('en', input);
    expect(message.subject).toBe('[Acme] Order cancelled, out of stock: order-<1>');
    expect(message.text).toBe('A paid order arrived after its goods sold out, so it was cancelled. Nothing was taken from stock and a full refund of PLN\u00a040.99 is in progress.\nOrder: order-<1>\nBuyer: buyer@example.com\nOut of stock: Printed <poster>, Mug\nhttps://acme.example.com/panel/sales/order-1');
    expect(message.html).toContain('Out of stock: Printed &lt;poster&gt;, Mug');
    expect(message.html).toContain('href="https://acme.example.com/panel/sales/order-1"');
  });

  it('renders the Polish alert with a Polish amount', () => {
    expect(orderOutOfStockEmail('pl', input)).toEqual(expectedTransactionalEmailPl.orderOutOfStockEmail);
  });

  it('promises no refund for an order cancelled with nothing charged, in English and Polish', () => {
    const en = orderOutOfStockEmail('en', { ...input, amountCents: 0 });
    expect(en.text).toBe('An order arrived after its goods sold out, so it was cancelled. Nothing was taken from stock, and nothing was charged, so there is nothing to refund.\nOrder: order-<1>\nBuyer: buyer@example.com\nOut of stock: Printed <poster>, Mug\nhttps://acme.example.com/panel/sales/order-1');
    expect(en.html).toContain('<p>An order arrived after its goods sold out, so it was cancelled. Nothing was taken from stock, and nothing was charged, so there is nothing to refund.</p>');
    expect(orderOutOfStockEmail('pl', { ...input, amountCents: 0 })).toEqual(expectedTransactionalEmailPl.orderOutOfStockNothingChargedEmail);
  });
});

describe('order refund alert email', () => {
  const input = {
    tenantName: 'Acme', orderId: 'order-<1>', amountCents: 4099, currency: 'PLN',
    error: 'The provided key does not have the required <permissions>', orderUrl: 'https://acme.example.com/panel/sales/order-1',
  };

  it('tells staff to add the missing permission so the next hourly attempt pays the refund and escapes the provider error', () => {
    const message = orderRefundAlertEmail('en', { ...input, alert: 'blocked_permission' });
    expect(message.subject).toBe('[Acme] Automatic refund blocked by a missing Stripe permission: order-<1>');
    expect(message.text).toContain('lacks the Charges and Refunds (write) permission. Add the permission to the key in the Stripe Dashboard; waiting refunds are then paid by the next hourly attempt.');
    expect(message.text).toContain('PLN\u00a040.99');
    expect(message.html).toContain('Last error: The provided key does not have the required &lt;permissions&gt;');
    expect(message.html).toContain('href="https://acme.example.com/panel/sales/order-1"');
  });

  it('tells staff to refund by hand once the permission is still missing after 72 hours, and words both permission alerts in Polish', () => {
    const en = orderRefundAlertEmail('en', { ...input, alert: 'blocked_permission_failed' });
    expect(en.subject).toBe('[Acme] Automatic refund still blocked after 72 hours, refund by hand: order-<1>');
    expect(en.text).toContain('after 72 hours of hourly attempts and is no longer retried. Refund the payment by hand in the Stripe Dashboard.');
    expect(orderRefundAlertEmail('pl', { ...input, alert: 'blocked_permission_failed' })).toEqual(expectedTransactionalEmailPl.orderRefundBlockedFailedAlertEmail);
    expect(orderRefundAlertEmail('pl', { ...input, alert: 'blocked_permission' })).toEqual(expectedTransactionalEmailPl.orderRefundBlockedAlertEmail);
  });

  it('tells staff to check a refund Stripe never confirmed and to return the money another way if it failed, in English and Polish', () => {
    const unconfirmed = { ...input, alert: 'unconfirmed' as const, error: 'Refund still pending at the last scheduled status check' };
    const en = orderRefundAlertEmail('en', unconfirmed);
    expect(en.subject).toBe('[Acme] Refund not confirmed by Stripe, check it by hand: order-<1>');
    expect(en.text).toBe('Stripe has not confirmed the refund of PLN\u00a040.99 for cancelled order order-<1>, and the refund is no longer checked automatically. Check it in the Stripe Dashboard; if it failed or was canceled, return the money to the buyer another way.\nLast error: Refund still pending at the last scheduled status check\nhttps://acme.example.com/panel/sales/order-1');
    expect(en.html).toContain('cancelled order order-&lt;1&gt;, and the refund is no longer checked automatically.');
    expect(orderRefundAlertEmail('pl', unconfirmed)).toEqual(expectedTransactionalEmailPl.orderRefundUnconfirmedAlertEmail);
  });

  it('gives every alert its own subject', () => {
    const subjects = ORDER_REFUND_ALERTS.map((alert) => orderRefundAlertEmail('en', { ...input, alert }).subject);
    expect(new Set(subjects).size).toBe(ORDER_REFUND_ALERTS.length);
  });

  it('renders the Polish alert with a Polish amount', () => {
    expect(orderRefundAlertEmail('pl', { ...input, alert: 'failed' })).toEqual(expectedTransactionalEmailPl.orderRefundAlertEmail);
  });
});

describe('order sold out refund email', () => {
  const input = {
    tenantName: 'Acme <Shop>', orderId: 'order-<1>', amountCents: 4099, currency: 'PLN',
    productTitles: ['Printed <poster>', 'Mug'], shopUrl: 'https://acme.example.com/',
  };

  it('tells the buyer the order was cancelled because it sold out and gives the refund timing by payment method', () => {
    const message = orderSoldOutRefundEmail('en', input);
    expect(message.subject).toBe('Order cancelled, full refund on its way — Acme <Shop> (#ORDER-<1)');
    expect(message.text).toBe([
      'Hello!',
      '',
      'Your payment for order #ORDER-<1 on Acme <Shop> arrived after the goods had sold out, so the whole order was cancelled and nothing will be sent.',
      '',
      'Order number: order-<1>',
      'Sold out: Printed <poster>, Mug',
      '',
      'A full refund of PLN\u00a040.99 to the payment method you used has been started automatically. You do not need to do anything.',
      '',
      'When the money comes back:',
      '- Card: a refund made soon after the payment usually shows as a reversal, so the charge disappears from your statement; otherwise it appears as a separate credit after about 5–10 business days.',
      '- BLIK: the refund takes about 120 minutes.',
      '- Przelewy24: the refund arrives as a separate transfer within 3 business days.',
      '- Other payment methods: the time depends on the payment provider.',
      '',
      'We are sorry for the trouble.',
      '',
      'Visit the shop: https://acme.example.com/',
    ].join('\n'));
    expect(message.html).toContain('order #ORDER-&lt;1 on Acme &lt;Shop&gt;');
    expect(message.html).toContain('<p>Order number: order-&lt;1&gt;<br>Sold out:');
    expect(message.html).toContain('Sold out: Printed &lt;poster&gt;, Mug');
    expect(message.html).toContain('<li>BLIK: the refund takes about 120 minutes.</li>');
    expect(message.html).toContain('<a href="https://acme.example.com/">Visit the shop</a>');
  });

  it('says nothing was charged instead of promising a refund for an order paid with zero', () => {
    const message = orderSoldOutRefundEmail('en', { ...input, amountCents: 0 });
    expect(message.subject).toBe('Order cancelled, nothing charged — Acme <Shop> (#ORDER-<1)');
    expect(message.text).toContain('You were not charged, so there is nothing to refund.');
    expect(message.text).not.toContain('BLIK');
  });

  it('renders the Polish message with a Polish amount', () => {
    expect(orderSoldOutRefundEmail('pl', input)).toEqual(expectedTransactionalEmailPl.orderSoldOutRefundEmail);
  });

  it('round-trips through the outbox payload and renders the branded header', () => {
    const payload = emailOutboxPayloadSchema.parse({
      kind: 'order-sold-out-refund', language: 'pl', ...input,
      branding: { logoUrl: 'https://acme.example.com/logo.png', accentColor: null },
    });
    expect(payload.kind).toBe('order-sold-out-refund');
    const rendered = renderEmailOutboxPayload(payload);
    expect(rendered).toMatchObject({ success: true, data: { subject: expectedTransactionalEmailPl.orderSoldOutRefundEmail?.subject } });
    expect(rendered.success && rendered.data.html).toContain('https://acme.example.com/logo.png');
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
    expect(spaceEvent('en', input).subject).toBe('New event in “Announcements” — Acme Courses');
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
    expect(directMessage('en', input).subject).toBe('New message from Alex — Acme Courses');
  });
});

it.each(['en', 'pl'])('includes escaped purchase lines, an order number and an unlinked QR label in %s', (language) => {
  const verificationUrl = `https://shop.example.org/panel/orders/verify/${'a'.repeat(64)}`;
  const qrImageUrl = `https://shop.example.org/api/public/orders/qr/${'a'.repeat(64)}`;
  const message = welcomeSignIn(language, {
    tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', productType: 'physical',
    purchase: { orderNumber: 'order-42', verificationUrl, qrImageUrl, lines: ['Printed <material>', 'Digital companion'] },
  });
  expect(message.html).toContain('order-42');
  expect(message.html).toContain('<li>Printed &lt;material&gt;</li><li>Digital companion</li>');
  const expected = language === 'pl' ? transactionalEmailMessagesPl.purchase : {
    verification: 'QR code for the seller: show it if the seller asks you to confirm the order.',
    verificationText: 'If the seller asks you to confirm the order, show the QR code from the HTML version of this e-mail.',
    qrAlt: 'Order QR code',
  };
  expect(message.html).toContain(`<p>${expected.verification}</p><img src="${qrImageUrl}" alt="${expected.qrAlt}" width="256" height="256" />`);
  expect(message.html).not.toContain(`<a href="${verificationUrl}">`);
  expect(message.html).not.toMatch(/<a\b[^>]*href="[^"]*\/panel\/orders\/verify\//);
  expect(message.text).toContain('- Printed <material>\n- Digital companion');
  expect(message.text.split('\n')).toContain(expected.verificationText);
  expect(message.text).not.toContain(verificationUrl);
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
  expect(message.html).toContain(`/><p style="font-size:12px;margin-top:24px"><a href="${socialUrl}">Community profile</a></p>`);
  expect(message.html.indexOf(qrImageUrl)).toBeLessThan(message.html.indexOf(socialUrl));
  expect(message.html.match(/Community profile/g)).toHaveLength(1);
  const labels = (language === 'pl' ? transactionalEmailMessagesPl : transactionalEmailMessagesEn).purchase;
  expect(message.text).toContain(`${labels.verificationText}\n\nCommunity profile: ${socialUrl}`);
  expect(message.text).not.toContain(verificationUrl);
  expect(message.text.match(/Community profile/g)).toHaveLength(1);
});

describe('purchase confirmation amounts', () => {
  const cell = 'padding:8px;text-align:left';
  const amountCell = 'padding:8px;text-align:right;white-space:nowrap';
  const totalBorder = 'border-top:1px solid #d4d4d8';
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
    const expected = language === 'pl' ? expectedPurchaseConfirmationPl : {
      subject: 'Purchase confirmation — Workspace (#ORDER-42)',
      total: 'Total',
      notInvoice: 'This confirmation is not an invoice.',
    };
    const message = welcomeSignIn(language, {
      tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', purchase: details,
    });
    expect(message.subject).toBe(expected.subject);
    expect(message.html).toContain(`<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${cell}">${labels.item}</th><th style="${amountCell}">${labels.amount}</th><th style="${amountCell}">${labels.vat}</th></tr></thead>`);
    expect(message.html).not.toContain('<ul>');
    const vats = ['5\u00a0%', '23\u00a0%', '8\u00a0%', '—', language === 'pl' ? 'zw.' : 'exempt'];
    details.lines.forEach((line, index) => {
      if (typeof line === 'string') throw new Error('Expected a structured purchase line');
      const amount = amounts[index] ?? amounts[3];
      const escapedName = line.name.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      expect(message.html).toContain(`<tr><td style="${cell}">${escapedName}</td><td style="${amountCell}">${amount}</td><td style="${amountCell}">${vats[index]}</td></tr>`);
      const textLine = `- ${line.name} — ${amount}`;
      expect(message.text).toContain(line.vatRate === null ? `${textLine}\n` : `${textLine} (${vats[index]})`);
      if (line.vatRate === null) expect(message.text).not.toContain(`${textLine} (`);
    });
    expect(message.html).toContain(`<tr><td style="${cell};${totalBorder}"><strong>${expected.total}</strong></td><td style="${amountCell};${totalBorder}"><strong>${total}</strong></td><td style="${amountCell};${totalBorder}"></td></tr>`);
    expect(message.text).toContain(`${expected.total}: ${total}`);
    expect(message.html).toContain(`<p>${expected.notInvoice}</p><p>${labels.verification}</p>`);
    expect(message.text).toContain(`\n\n${expected.notInvoice}\n\n${labels.verificationText}`);
    expect(message.html.indexOf('order-42')).toBeLessThan(message.html.indexOf('<table'));
    expect(message.html).toContain(`<p>${labels.verification}</p><img src="${details.qrImageUrl}" alt="${labels.qrAlt}" width="256" height="256" />`);
    expect(message.html).not.toContain(`<a href="${details.verificationUrl}">`);
    expect(message.text.split('\n')).toContain(labels.verificationText);
    expect(message.text).not.toContain(details.verificationUrl);
  });

  it('names the units of a line above one and leaves single units unchanged', () => {
    const details = purchaseEmailDetailsSchema.parse({ ...purchase, totalCents: 9000, lines: [
      { name: 'Printed workbook', quantity: 2, grossCents: 8000, vatRate: 5 },
      { name: 'Digital companion', quantity: 1, grossCents: 1000, vatRate: 23 },
    ] });
    const message = welcomeSignIn('en', { tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', purchase: details });
    expect(message.html).toContain(`<tr><td style="${cell}">2 × Printed workbook</td><td style="${amountCell}">PLN 80.00</td>`);
    expect(message.html).toContain(`<tr><td style="${cell}">Digital companion</td><td style="${amountCell}">PLN 10.00</td>`);
    expect(message.text).toContain('- 2 × Printed workbook — PLN 80.00 (5 %)');
    expect(message.text).toContain('- Digital companion — PLN 10.00 (23 %)');
  });

  it.each([
    ['pl', expectedPurchaseDeliveryPl, purchaseDeliveryFixturesPl],
    ['en', {
      lockerHtml: '<p><strong>Delivery</strong>: Parcel locker<br>Parcel locker: WAW01M<br>Station &lt;North&gt;<br>Main Street 1, Warsaw</p>',
      lockerText: '\n\nDelivery: Parcel locker\nParcel locker: WAW01M\nStation <North>\nMain Street 1, Warsaw',
      addressHtml: '<p><strong>Delivery</strong>: Courier<br>Jane Buyer<br>Garden Street 5<br>00-950 Warsaw<br>Poland</p>',
      addressText: '\n\nDelivery: Courier\nJane Buyer\nGarden Street 5\n00-950 Warsaw\nPoland',
    }, {
      locker: { method: 'Parcel locker', pickupPoint: { code: 'WAW01M', name: 'Station <North>', address: 'Main Street 1, Warsaw' }, address: null },
      address: { method: 'Courier', pickupPoint: null, address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' } },
    }],
  ] as const)('adds the delivery paragraph after the purchased items in %s', (language, expected, deliveries) => {
    const labels = (language === 'pl' ? transactionalEmailMessagesPl : transactionalEmailMessagesEn).purchase;
    for (const [kind, delivery] of [['locker', deliveries.locker], ['address', deliveries.address]] as const) {
      const message = welcomeSignIn(language, {
        tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in',
        purchase: purchaseEmailDetailsSchema.parse({ ...purchase, delivery }),
      });
      const html = kind === 'locker' ? expected.lockerHtml : expected.addressHtml;
      const text = kind === 'locker' ? expected.lockerText : expected.addressText;
      expect(message.html).toContain(`</table>${html}<p><strong><a href="https://shop.example.org/sign-in">`);
      expect(message.text).toContain(`${text}\n\n`);
    }
    const without = welcomeSignIn(language, { tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', purchase: purchaseEmailDetailsSchema.parse(purchase) });
    expect(without.html).not.toContain(labels.delivery);
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
      expect(message.subject).toBe(labels.subject('#ORDER-42', 'Workspace'));
      expect(message.html).toContain('</ul><p><strong><a href="https://shop.example.org/sign-in">');
      expect(message.text).toContain(labels.notInvoice);
    }
  });

  it('escapes the order number, workspace name and QR image URL in HTML', () => {
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
    expect(message.html).not.toContain(purchase.verificationUrl);
    expect(message.text).not.toContain(purchase.verificationUrl);
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

describe('purchase confirmation structure', () => {
  const details = purchaseEmailDetailsSchema.parse({
    orderNumber: '3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e',
    verificationUrl: 'https://shop.example.org/panel/orders/verify/token',
    qrImageUrl: 'https://shop.example.org/api/public/orders/qr/token',
    lines: [{ name: 'Printed workbook', grossCents: 8000, vatRate: 5 }, { name: 'Video course', grossCents: 1000, vatRate: 23 }],
    currency: 'PLN',
    totalCents: 9000,
    productTypes: ['physical', 'course'],
    delivery: { method: 'Courier', pickupPoint: null, address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' } },
    signInPageUrl: 'https://shop.example.org/login',
    contactUrl: 'https://shop.example.org/account',
  });
  const render = (language: string, purchase = details) => welcomeSignIn(language, {
    tenantName: 'Workspace', actionUrl: 'https://shop.example.org/magic?token=abc', productType: 'physical', purchase,
  });

  it('thanks the buyer, says the payment arrived and what comes next for every product type, without an account-ready sentence', () => {
    const message = render('en');
    expect(message.subject).toBe('Purchase confirmation — Workspace (#3F2A9C1E)');
    expect(message.html).toMatch(/^<h1>Thank you for your purchase<\/h1><p>We have received your payment for order #3F2A9C1E on Workspace\. We will e-mail you again when the parcel is on its way\. Your course is ready in your account\.<\/p><p><strong>Order number:<\/strong> 3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e<\/p>/);
    expect(message.text.startsWith('Thank you for your purchase\n\nWe have received your payment for order #3F2A9C1E on Workspace. We will e-mail you again when the parcel is on its way. Your course is ready in your account.\n\nOrder number: 3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e\n')).toBe(true);
    expect(`${message.html}${message.text}`).not.toMatch(/account is ready|Hello!/);

    const pl = render('pl');
    expect(pl.subject).toBe('Potwierdzenie zakupu — Workspace (#3F2A9C1E)');
    expect(pl.html.startsWith(`<h1>${transactionalEmailMessagesPl.purchase.heading}</h1><p>${transactionalEmailMessagesPl.purchase.paymentReceived('#3F2A9C1E', 'Workspace')} ${transactionalEmailMessagesPl.purchase.nextSteps.physical} ${transactionalEmailMessagesPl.purchase.nextSteps.course}</p>`)).toBe(true);
    expect(pl.text.startsWith(`${transactionalEmailMessagesPl.purchase.heading}\n\n`)).toBe(true);
  });

  it('states the one-hour sign-in link beside the action, links the permanent sign-in page and a real contact for an invoice', () => {
    const message = render('en');
    expect(message.html).toContain('<p><strong><a href="https://shop.example.org/magic?token=abc">Sign in to your account</a></strong></p><p>The sign-in link is valid for one hour. Later, you can sign in at any time on the <a href="https://shop.example.org/login">sign-in page</a>.</p><p>This confirmation is not an invoice. If you need one, <a href="https://shop.example.org/account">contact the shop</a>.</p>');
    expect(message.text).toContain('Sign in to your account: https://shop.example.org/magic?token=abc\nThe sign-in link is valid for one hour.\nLater, you can sign in at any time on the sign-in page (https://shop.example.org/login).\n\nThis confirmation is not an invoice. If you need one, contact the shop (https://shop.example.org/account).');
  });

  it('promises no contact and no sign-in page when the payload carries neither', () => {
    const message = render('en', purchaseEmailDetailsSchema.parse({ ...details, signInPageUrl: undefined, contactUrl: null, productTypes: undefined }));
    expect(message.html).toContain('<p>The sign-in link is valid for one hour.</p><p>This confirmation is not an invoice.</p>');
    expect(message.html).not.toContain('contact the shop');
    expect(message.html).toContain('<p>We have received your payment for order #3F2A9C1E on Workspace. We will e-mail you again when the parcel is on its way.</p>');
  });

  it('tells the buyer of a physical order without delivery to collect it in person, and keeps the parcel sentence when there is a delivery', () => {
    const pickup = purchaseEmailDetailsSchema.parse({ ...details, delivery: undefined, productTypes: ['physical'] });
    expect(render('en', pickup).html).toContain('<p>We have received your payment for order #3F2A9C1E on Workspace. You will collect your order in person — show the QR code from this e-mail when you collect it.</p>');
    expect(render('en', pickup).text).not.toContain('parcel');
    expect(render('pl', pickup).html).toContain(`${transactionalEmailMessagesPl.purchase.collectInPerson}</p>`);
    expect(render('pl', pickup).html).not.toContain(transactionalEmailMessagesPl.purchase.nextSteps.physical);
    expect(render('en').html).toContain('We will e-mail you again when the parcel is on its way.');
  });

  it('keeps the new purchase fields valid for the outbox and renders them from the queued payload', () => {
    const rendered = renderEmailOutboxPayload({
      kind: 'welcome-sign-in', language: 'en', tenantName: 'Workspace',
      actionUrl: 'https://shop.example.org/magic?token=abc', productType: 'physical', purchase: details,
    });
    expect(rendered).toMatchObject({ success: true, data: { subject: 'Purchase confirmation — Workspace (#3F2A9C1E)' } });
    expect(purchaseEmailDetailsSchema.safeParse({ ...details, productTypes: [] }).success).toBe(false);
  });
});

describe('purchase confirmation personalisation', () => {
  const base = {
    orderNumber: 'order-42',
    verificationUrl: 'https://shop.example.org/panel/orders/verify/token',
    qrImageUrl: 'https://shop.example.org/api/public/orders/qr/token',
    lines: [{ name: 'Printed <book>', grossCents: 4900, vatRate: 5 }, { name: 'Card', grossCents: 100, vatRate: 23 }],
    currency: 'PLN',
    totalCents: 5000,
  };
  const personalizations = [
    { name: 'Printed <book>', text: 'For "Alex" & Sam', condition: 'I understand a personalised item is made to my order.' },
    { name: 'Card', text: 'Hi', condition: null },
  ];

  it.each([
    ['en', {
      conditionHtml: '<p><strong>Personalisation: Printed &lt;book&gt;</strong><br>For &quot;Alex&quot; &amp; Sam<br>Condition you accepted: I understand a personalised item is made to my order.</p>',
      plainHtml: '<p><strong>Personalisation: Card</strong><br>Hi</p>',
      conditionText: '\n\nPersonalisation: Printed <book>\nFor "Alex" & Sam\nCondition you accepted: I understand a personalised item is made to my order.',
      plainText: '\n\nPersonalisation: Card\nHi',
    }],
    ['pl', expectedPurchasePersonalizationPl],
  ] as const)('renders each personalised line after the items table, escaped, with and without a condition in %s', (language, expected) => {
    const labels = (language === 'pl' ? transactionalEmailMessagesPl : transactionalEmailMessagesEn).purchase;
    const delivery = { method: 'Courier', pickupPoint: null, address: null };
    const message = welcomeSignIn(language, {
      tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in',
      purchase: purchaseEmailDetailsSchema.parse({ ...base, delivery, personalizations }),
    });
    expect(message.html).toContain(`</table>${expected.conditionHtml}${expected.plainHtml}<p><strong>${labels.delivery}</strong>`);
    expect(message.text).toContain(`${expected.conditionText}${expected.plainText}\n\n${labels.delivery}`);
    expect(message.html).not.toContain('<book>');
    const without = welcomeSignIn(language, { tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in', purchase: purchaseEmailDetailsSchema.parse(base) });
    expect(without.html).not.toContain(labels.personalization);
    expect(without.text).not.toContain(labels.personalization);
  });

  it('keeps purchase payloads with personalisations valid for the outbox', () => {
    expect(emailOutboxPayloadSchema.safeParse({
      kind: 'welcome-sign-in', language: 'en', tenantName: 'Workspace', actionUrl: 'https://shop.example.org/sign-in',
      purchase: { ...base, personalizations },
    }).success).toBe(true);
  });
});
