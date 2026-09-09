import type { TransactionalEmailMessages } from './transactional-email-messages.js';

export const transactionalEmailMessagesEn: TransactionalEmailMessages = {
  manageNotifications: {
    label: 'Manage notifications',
    hints: {
      thread: 'you can mute this thread in the discussion',
      space: 'you can unfollow the space there',
      direct: 'you can turn off messages from community members in your account settings',
    },
  },
  welcomeSignIn: {
    actionLabel: 'Sign in and open your course',
    render: ({ header, tenantName, tenantNameHtml, actionUrl, actionLink, socialLinks }) => ({
      subject: `Hello, your ${tenantName} account is ready`,
      html: `${header}<p>Hello!</p><p>Your account on ${tenantNameHtml} is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.</p><p>${actionLink}</p>${socialLinks.html}`,
      text: `Hello!\n\nYour account on ${tenantName} is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.\n\nSign in and open your course: ${actionUrl}${socialLinks.text}`,
    }),
  },
  resetPassword: {
    actionLabel: 'Reset password',
    render: ({ actionUrl, actionLink }) => ({
      subject: 'Reset your password',
      html: `<p>Hello!</p><p>Please click the link below to reset your password:</p><p>${actionLink}</p><p>The password reset link expires in one hour.</p>`,
      text: `Hello!\n\nPlease open the link below to reset your password:\n${actionUrl}\n\nThe password reset link expires in one hour.`,
    }),
  },
  verifyEmail: {
    actionLabel: 'Verify email',
    render: ({ actionUrl, actionLink }) => ({
      subject: 'Verify your email address',
      html: `<p>Hello!</p><p>Confirm that this email address belongs to you:</p><p>${actionLink}</p><p>You can sign in and use Together before confirming it. Verification is required only to create a new workspace.</p><p>The link expires in one hour.</p>`,
      text: `Hello!\n\nConfirm that this email address belongs to you:\n${actionUrl}\n\nYou can sign in and use Together before confirming it. Verification is required only to create a new workspace.\n\nThe link expires in one hour.`,
    }),
  },
  threadReply: {
    actionLabel: 'Open the discussion',
    render: ({ tenantName, tenantNameHtml, lessonName, lessonNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New reply in the "${lessonName}" discussion`,
      html: `<p>Hello!</p><p>${authorHtml} replied in the "${lessonNameHtml}" discussion on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} replied in the "${lessonName}" discussion on ${tenantName}:\n\n${snippetText}\n\nOpen the discussion: ${url}${footer.text}`,
    }),
  },
  lessonQuestion: {
    actionLabel: 'Open the question',
    render: ({ tenantName, tenantNameHtml, lessonName, lessonNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New question under “${lessonName}”`,
      html: `<p>Hello!</p><p>${authorHtml} asked a question under “${lessonNameHtml}” on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} asked a question under “${lessonName}” on ${tenantName}:\n\n${snippetText}\n\nOpen the question: ${url}${footer.text}`,
    }),
  },
  spacePost: {
    actionLabel: 'Open the space',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New post in “${spaceName}”`,
      html: `<p>Hello!</p><p>${authorHtml} posted in “${spaceNameHtml}” on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} posted in “${spaceName}” on ${tenantName}:\n\n${snippetText}\n\nOpen the space: ${url}${footer.text}`,
    }),
  },
  spaceEvent: {
    actionLabel: 'Open the event',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New event in “${spaceName}”`,
      html: `<p>Hello!</p><p>${authorHtml} scheduled an event in “${spaceNameHtml}” on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} scheduled an event in “${spaceName}” on ${tenantName}:\n\n${snippetText}\n\nOpen the event: ${url}${footer.text}`,
    }),
  },
  directMessage: {
    actionLabel: 'Open the conversation',
    render: ({ tenantName, tenantNameHtml, senderDisplay, senderHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New message from ${senderDisplay}`,
      html: `<p>Hello!</p><p>${senderHtml} sent you a message on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${senderDisplay} sent you a message on ${tenantName}:\n\n${snippetText}\n\nOpen the conversation: ${url}${footer.text}`,
    }),
  },
  magicLink: {
    actionLabel: 'Sign in',
    render: ({ header, tenantName, tenantNameHtml, url, actionLink, socialLinks }) => ({
      subject: `Sign in to ${tenantName}`,
      html: `${header}<p>Hello!</p><p>Use this link to sign in to ${tenantNameHtml}:</p><p>${actionLink}</p><p>If you did not request this email, you can ignore it.</p>${socialLinks.html}`,
      text: `Hello!\n\nUse this link to sign in to ${tenantName}:\n${url}\n\nIf you did not request this email, you can ignore it.${socialLinks.text}`,
    }),
  },
  subscriptionPaymentFailed: {
    billingPortalLabel: 'Update billing details',
    render: ({ header, tenantName, tenantNameHtml, productTitle, productTitleHtml, accessEndsAtText, accessEndsAtHtml, billingPortalUrl, portal, socialLinks }) => ({
      subject: `Payment failed for ${productTitle}`,
      html: `${header}<p>Hello!</p><p>We could not collect payment for ${productTitleHtml} on ${tenantNameHtml}.</p><p>Your access ends on ${accessEndsAtHtml}.</p>${portal}${socialLinks.html}`,
      text: `Hello!\n\nWe could not collect payment for ${productTitle} on ${tenantName}.\n\nYour access ends on ${accessEndsAtText}.${billingPortalUrl === null ? '' : `\n\nUpdate billing details: ${billingPortalUrl}`}${socialLinks.text}`,
    }),
  },
  subscriptionEnded: {
    offerLabel: 'View the offer',
    render: ({ header, tenantName, tenantNameHtml, productTitle, productTitleHtml, accessEndsAtText, accessEndsAtHtml, offerUrl, offerLink, socialLinks }) => ({
      subject: `Your ${productTitle} subscription has ended`,
      html: `${header}<p>Hello!</p><p>Your subscription to ${productTitleHtml} on ${tenantNameHtml} has ended.</p><p>Your access ends on ${accessEndsAtHtml}.</p><p>${offerLink}</p>${socialLinks.html}`,
      text: `Hello!\n\nYour subscription to ${productTitle} on ${tenantName} has ended.\n\nYour access ends on ${accessEndsAtText}.\n\nView the offer: ${offerUrl}${socialLinks.text}`,
    }),
  },
  supportMessage: {
    render: ({ tenantName, tenantNameHtml, memberEmail, memberEmailHtml, memberDisplay, memberDisplayHtml, subject, subjectHtml, body, bodyHtml, header }) => ({
      subject: `[${tenantName}] ${subject}`,
      html: `${header}<p>Support message from ${memberDisplayHtml} on ${tenantNameHtml}.</p><p>Reply to: ${memberEmailHtml}</p><p><strong>${subjectHtml}</strong></p><blockquote>${bodyHtml}</blockquote>`,
      text: `Support message from ${memberDisplay} on ${tenantName}.\n\nReply to: ${memberEmail}\n\n${subject}\n\n${body}`,
    }),
  },
  memberErasureRequestEmail: {
    render: ({ tenantName, memberEmail, memberEmailHtml, requestedAtText, requestedAtHtml, dueAtText, dueAtHtml, panelUrl, panelUrlHtml }) => ({
      subject: `[${tenantName}] Member erasure request`,
      html: `<p>${memberEmailHtml} requested account erasure.</p><p>Requested: ${requestedAtHtml}<br>Due: ${dueAtHtml}</p><p><a href="${panelUrlHtml}">Review request</a></p>`,
      text: `${memberEmail} requested account erasure.\nRequested: ${requestedAtText}\nDue: ${dueAtText}\n${panelUrl}`,
    }),
  },
  emailTransportTest: {
    render: ({ transport, transportHtml }) => ({
      subject: `Together test e-mail (${transport})`,
      html: `<p>Your ${transportHtml} transport is configured correctly.</p><p>This message was sent from the panel to confirm delivery.</p>`,
      text: `Your ${transport} transport is configured correctly.\n\nThis message was sent from the panel to confirm delivery.`,
    }),
  },
  reputationAlertEmail: {
    statusLabels: { warn: 'warning', critical: 'critical' },
    missingRate: 'n/a',
    render: ({ tenantName, tenantNameHtml, status, hardBounceRate, complaintRate, windowStartText, windowStartHtml, windowEndText, windowEndHtml, dashboardUrl, dashboardUrlHtml }) => ({
      subject: `[${tenantName}] E-mail reputation: ${status}`,
      html: `<p>E-mail reputation for ${tenantNameHtml}: <strong>${status}</strong>.</p><p>Hard bounce rate: ${hardBounceRate}<br>Complaint rate: ${complaintRate}<br>Window: ${windowStartHtml} – ${windowEndHtml}</p><p><a href="${dashboardUrlHtml}">Review reputation</a></p>`,
      text: `E-mail reputation for ${tenantName}: ${status}.\nHard bounce rate: ${hardBounceRate}\nComplaint rate: ${complaintRate}\nWindow: ${windowStartText} – ${windowEndText}\n${dashboardUrl}`,
    }),
  },
};
