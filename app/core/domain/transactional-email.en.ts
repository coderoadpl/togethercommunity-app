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
  purchase: {
    heading: 'Thank you for your purchase',
    paymentReceived: (orderReference, tenantName) => `We have received your payment for order ${orderReference} on ${tenantName}.`,
    collectInPerson: 'You will collect your order in person — show the QR code from this e-mail when you collect it.',
    nextSteps: {
      course: 'Your course is ready in your account.',
      digital_download: 'Your files are ready to download in your account.',
      membership: 'Your membership is active.',
      physical: 'We will e-mail you again when the parcel is on its way.',
      unknown: 'Your purchase is available in your account.',
    },
    orderNumber: 'Order number',
    lines: 'Purchased items',
    item: 'Item',
    amount: 'Amount (gross)',
    vat: 'VAT',
    exempt: 'exempt',
    total: 'Total',
    notInvoice: 'This confirmation is not an invoice.',
    invoiceContact: (contact) => `If you need one, ${contact}.`,
    contactLabel: 'contact the shop',
    signInValidity: 'The sign-in link is valid for one hour.',
    signInLater: (signInPage) => `Later, you can sign in at any time on the ${signInPage}.`,
    signInPageLabel: 'sign-in page',
    subject: (orderReference, tenantName) => `Purchase confirmation — ${tenantName} (${orderReference})`,
    verification: 'QR code for the seller: show it if the seller asks you to confirm the order.',
    verificationText: 'If the seller asks you to confirm the order, show the QR code from the HTML version of this e-mail.',
    qrAlt: 'Order QR code',
    delivery: 'Delivery',
    pickupPoint: 'Parcel locker',
    personalization: 'Personalisation',
    personalizationCondition: 'Condition you accepted',
  },
  orderShipped: {
    items: 'Shipped items',
    carrier: 'Carrier',
    trackingNumber: 'Tracking number',
    trackLabel: 'Track the parcel',
    carriers: { inpost: 'InPost' },
    render: ({ header, tenantName, tenantNameHtml, orderReference, orderReferenceHtml, track, items, delivery, tracking, socialLinks }) => ({
      subject: `Order shipped — ${tenantName} (${orderReference})`,
      html: `${header}<p>Hello!</p><p>Your order ${orderReferenceHtml} from ${tenantNameHtml} has been shipped.</p>${track.html}${items.html}${delivery.html}${tracking.html}${socialLinks.html}`,
      text: `Hello!\n\nYour order ${orderReference} from ${tenantName} has been shipped.${track.text}${items.text}${delivery.text}${tracking.text}${socialLinks.text}`,
    }),
  },
  welcomeSignIn: {
    actionLabels: {
      course: 'Sign in and open your course',
      digital_download: 'Sign in and download your files',
      membership: 'Sign in to your account',
      physical: 'Sign in to your account',
      unknown: 'Sign in to your account',
    },
    render: ({ header, tenantName, tenantNameHtml, actionUrl, actionLink, actionLabel, socialLinks }) => ({
      subject: `Hello, your ${tenantName} account is ready`,
      html: `${header}<p>Hello!</p><p>Your account on ${tenantNameHtml} is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.</p><p>${actionLink}</p>${socialLinks.html}`,
      text: `Hello!\n\nYour account on ${tenantName} is ready. Click to sign in — the link is valid for one hour. If it stops working, request a new one on the login page.\n\n${actionLabel}: ${actionUrl}${socialLinks.text}`,
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
      subject: `New reply in the “${lessonName}” discussion — ${tenantName}`,
      html: `<p>Hello!</p><p>${authorHtml} replied in the “${lessonNameHtml}” discussion on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} replied in the “${lessonName}” discussion on ${tenantName}:\n\n${snippetText}\n\nOpen the discussion: ${url}${footer.text}`,
    }),
  },
  lessonQuestion: {
    actionLabel: 'Open the question',
    render: ({ tenantName, tenantNameHtml, lessonName, lessonNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New question under “${lessonName}” — ${tenantName}`,
      html: `<p>Hello!</p><p>${authorHtml} asked a question under “${lessonNameHtml}” on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} asked a question under “${lessonName}” on ${tenantName}:\n\n${snippetText}\n\nOpen the question: ${url}${footer.text}`,
    }),
  },
  spacePost: {
    actionLabel: 'Open the space',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New post in “${spaceName}” — ${tenantName}`,
      html: `<p>Hello!</p><p>${authorHtml} posted in “${spaceNameHtml}” on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} posted in “${spaceName}” on ${tenantName}:\n\n${snippetText}\n\nOpen the space: ${url}${footer.text}`,
    }),
  },
  spaceEvent: {
    actionLabel: 'Open the event',
    render: ({ tenantName, tenantNameHtml, spaceName, spaceNameHtml, authorDisplay, authorHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New event in “${spaceName}” — ${tenantName}`,
      html: `<p>Hello!</p><p>${authorHtml} scheduled an event in “${spaceNameHtml}” on ${tenantNameHtml}:</p><blockquote>${snippetHtml}</blockquote><p>${actionLink}</p>${footer.html}`,
      text: `Hello!\n\n${authorDisplay} scheduled an event in “${spaceName}” on ${tenantName}:\n\n${snippetText}\n\nOpen the event: ${url}${footer.text}`,
    }),
  },
  directMessage: {
    actionLabel: 'Open the conversation',
    render: ({ tenantName, tenantNameHtml, senderDisplay, senderHtml, snippetText, snippetHtml, url, actionLink, footer }) => ({
      subject: `New message from ${senderDisplay} — ${tenantName}`,
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
    contactLabel: 'Contact support',
    workspaceLabel: (tenantName) => `Open ${tenantName}`,
    render: ({ header, tenantName, tenantNameHtml, productTitle, productTitleHtml, accessEndsAtText, accessEndsAtHtml, billingPortalUrl, portal, contactUrl, contactLink, workspaceUrl, workspaceLink, socialLinks }) => {
      const settle = `To keep your access, contact ${tenantName} to settle the payment.`;
      const settleHtml = `To keep your access, contact ${tenantNameHtml} to settle the payment.`;
      const fallbackLink = contactLink ?? workspaceLink;
      const actionHtml = billingPortalUrl !== null ? portal : `<p>${settleHtml}</p>${fallbackLink === null ? '' : `<p>${fallbackLink}</p>`}`;
      const fallbackText = contactUrl !== null
        ? `\n\nContact support: ${contactUrl}`
        : workspaceUrl === null ? '' : `\n\nOpen ${tenantName}: ${workspaceUrl}`;
      const actionText = billingPortalUrl !== null
        ? `\n\nUpdate billing details: ${billingPortalUrl}`
        : `\n\n${settle}${fallbackText}`;
      return {
        subject: `Payment failed for ${productTitle} — ${tenantName}`,
        html: `${header}<p>Hello!</p><p>We could not collect payment for ${productTitleHtml} on ${tenantNameHtml}.</p><p>Unless the payment goes through, your access ends on ${accessEndsAtHtml}.</p>${actionHtml}${socialLinks.html}`,
        text: `Hello!\n\nWe could not collect payment for ${productTitle} on ${tenantName}.\n\nUnless the payment goes through, your access ends on ${accessEndsAtText}.${actionText}${socialLinks.text}`,
      };
    },
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
  orderOutOfStockEmail: {
    render: ({ tenantName, orderId, orderIdHtml, buyerEmail, buyerEmailHtml, refund, productTitles, productTitlesHtml, orderUrl, orderUrlHtml }) => {
      const summary = (amount: string | null) => amount === null
        ? 'An order arrived after its goods sold out, so it was cancelled. Nothing was taken from stock, and nothing was charged, so there is nothing to refund.'
        : `A paid order arrived after its goods sold out, so it was cancelled. Nothing was taken from stock and a full refund of ${amount} is in progress.`;
      return {
        subject: `[${tenantName}] Order cancelled, out of stock: ${orderId}`,
        html: `<p>${summary(refund?.amountHtml ?? null)}</p><p>Order: ${orderIdHtml}<br>Buyer: ${buyerEmailHtml}<br>Out of stock: ${productTitlesHtml}</p><p><a href="${orderUrlHtml}">Open the order</a></p>`,
        text: `${summary(refund?.amount ?? null)}\nOrder: ${orderId}\nBuyer: ${buyerEmail}\nOut of stock: ${productTitles}\n${orderUrl}`,
      };
    },
  },
  orderSoldOutRefundEmail: {
    shopLabel: 'Visit the shop',
    render: ({ header, socialLinks, tenantName, tenantNameHtml, orderId, orderIdHtml, orderReference, orderReferenceHtml, productTitles, productTitlesHtml, refund, shopUrl, shopLink }) => {
      const timing = [
        'Card: a refund made soon after the payment usually shows as a reversal, so the charge disappears from your statement; otherwise it appears as a separate credit after about 5–10 business days.',
        'BLIK: the refund takes about 120 minutes.',
        'Przelewy24: the refund arrives as a separate transfer within 3 business days.',
        'Other payment methods: the time depends on the payment provider.',
      ];
      const refundText = refund === null
        ? 'You were not charged, so there is nothing to refund.'
        : `A full refund of ${refund.amount} to the payment method you used has been started automatically. You do not need to do anything.\n\nWhen the money comes back:\n${timing.map((line) => `- ${line}`).join('\n')}`;
      const refundHtml = refund === null
        ? '<p>You were not charged, so there is nothing to refund.</p>'
        : `<p>A full refund of ${refund.amountHtml} to the payment method you used has been started automatically. You do not need to do anything.</p><p>When the money comes back:</p><ul>${timing.map((line) => `<li>${line}</li>`).join('')}</ul>`;
      return {
        subject: `Order cancelled, ${refund === null ? 'nothing charged' : 'full refund on its way'} — ${tenantName} (${orderReference})`,
        html: `${header}<p>Hello!</p><p>Your payment for order ${orderReferenceHtml} on ${tenantNameHtml} arrived after the goods had sold out, so the whole order was cancelled and nothing will be sent.</p><p>Order number: ${orderIdHtml}<br>Sold out: ${productTitlesHtml}</p>${refundHtml}<p>We are sorry for the trouble.</p><p>${shopLink}</p>${socialLinks.html}`,
        text: `Hello!\n\nYour payment for order ${orderReference} on ${tenantName} arrived after the goods had sold out, so the whole order was cancelled and nothing will be sent.\n\nOrder number: ${orderId}\nSold out: ${productTitles}\n\n${refundText}\n\nWe are sorry for the trouble.\n\nVisit the shop: ${shopUrl}${socialLinks.text}`,
      };
    },
  },
  orderRefundIssuedEmail: {
    shopLabel: 'Visit the shop',
    render: ({ header, socialLinks, tenantName, tenantNameHtml, orderReference, orderReferenceHtml, amount, amountHtml, shopUrl, shopLink }) => {
      const timing = [
        'Card: a refund made soon after the payment usually shows as a reversal, so the charge disappears from your statement; otherwise it usually appears as a separate credit after about 5–10 business days, depending on your bank.',
        'Other payment methods: the time usually depends on the payment method and your bank.',
      ];
      return {
        subject: `Refund of ${amount} on its way — ${tenantName} (${orderReference})`,
        html: `${header}<p>Hello!</p><p>A refund of ${amountHtml} for order ${orderReferenceHtml} on ${tenantNameHtml} has been issued to the payment method you used. You do not need to do anything.</p><p>When the money comes back:</p><ul>${timing.map((line) => `<li>${line}</li>`).join('')}</ul><p>${shopLink}</p>${socialLinks.html}`,
        text: `Hello!\n\nA refund of ${amount} for order ${orderReference} on ${tenantName} has been issued to the payment method you used. You do not need to do anything.\n\nWhen the money comes back:\n${timing.map((line) => `- ${line}`).join('\n')}\n\nVisit the shop: ${shopUrl}${socialLinks.text}`,
      };
    },
  },
  staffRefundAlertEmail: {
    subjects: {
      retrying: 'Staff refund not issued yet, retrying',
      blocked_permission: 'Staff refund blocked by a missing Stripe permission',
      blocked_permission_failed: 'Staff refund still blocked after 72 hours, not issued',
      failed: 'Staff refund failed, nothing refunded',
      failed_after_submission: 'Staff refund failed after it was issued',
      unconfirmed: 'Staff refund not confirmed by Stripe, check it',
    },
    retryingOutcomeUnknownSubject: 'Staff refund outcome not known yet, retrying',
    lastErrorLabel: 'Last error',
    openOrder: 'Open the order',
    paragraphs: ({ alert, amount, orderId, mayHaveRefunded, reason, restocked, removedFromPackingList }) => {
      const checkInDashboard = 'Check the payment in the Stripe Dashboard: if this refund is listed there, nothing more is needed; if it is not, refund it there, and the order is updated once Stripe reports the refund.';
      const unconfirmedBecause = reason === 'create_outcome_unknown'
        ? 'A request for this refund may have reached Stripe, but the payment\'s refunds could not be read before the automatic retries ended, so it is not known whether it was paid.'
        : reason === 'awaiting_provider'
          ? 'Stripe still had this refund in progress at the last automatic check, and it is no longer checked automatically, so it is not known whether it was paid.'
          : reason === 'refunded_outside'
            ? 'The payment shows a full refund made outside the platform that the workspace\'s Stripe key could not confirm, so it is not known whether this refund was paid.'
            : 'Stripe has not confirmed the refund, and it is no longer checked automatically, so it is not known whether it was paid.';
      const states = {
        retrying: mayHaveRefunded
          ? 'Stripe may already have received this refund request, but its answer was lost. The same request is repeated automatically for 7 days, so the order is never refunded twice; you get another message if it still fails.'
          : 'The refund has not reached Stripe yet, so nothing has been refunded yet. It is retried automatically for 7 days; you get another message if it still fails.',
        blocked_permission: 'Stripe refused it because the workspace\'s restricted Stripe key lacks the Charges and Refunds (write) permission, so nothing has been refunded yet. Add the permission to the key in the Stripe Dashboard; the refund is then paid by the next hourly attempt. Attempts continue every hour for 72 hours.',
        blocked_permission_failed: 'The refund was still blocked by the missing Charges and Refunds (write) permission after 72 hours of hourly attempts and is no longer retried. Nothing was refunded. Once the permission is added, refund the order again from its page, or refund it by hand in the Stripe Dashboard.',
        failed: 'The refund failed and is no longer retried. Nothing was refunded by this request. Refund the order again from its page, or by hand in the Stripe Dashboard.',
        failed_after_submission: 'Stripe reports that the refund failed after it was issued, so the money did not reach the buyer. Refund the order again from its page, or return the money another way.',
        unconfirmed: `${unconfirmedBecause} ${checkInDashboard}`,
      } as const;
      const settled = alert !== 'retrying' && alert !== 'blocked_permission';
      const backToPacking = 'To send the order after all, put it back on the packing list from its page.';
      const kept = !settled ? null
        : restocked && removedFromPackingList ? `The goods returned to stock and the order taken off the packing list with this refund stay that way. ${backToPacking}`
          : restocked ? 'The goods returned to stock with this refund stay in stock.'
            : removedFromPackingList ? `The order taken off the packing list with this refund stays off it. ${backToPacking}` : null;
      const access = alert === 'failed_after_submission'
        ? 'If Stripe had already reported the refund, the order shows as refunded and the access it gave was ended; that access is not given back automatically: grant it again on the member page.'
        : null;
      return [`A staff member asked to refund ${amount} of order ${orderId}.`, states[alert], ...(kept === null ? [] : [kept]), ...(access === null ? [] : [access])];
    },
  },
  orderRefundAlertEmail: {
    render: ({ tenantName, alert, orderId, orderIdHtml, amount, amountHtml, error, errorHtml, orderUrl, orderUrlHtml }) => {
      const subjects = {
        retrying: 'Automatic refund failed, retrying',
        blocked_permission: 'Automatic refund blocked by a missing Stripe permission',
        blocked_permission_failed: 'Automatic refund still blocked after 72 hours, refund by hand',
        failed: 'Automatic refund failed, refund by hand',
        failed_after_submission: 'Refund failed after it was issued, refund by hand',
        unconfirmed: 'Refund not confirmed by Stripe, check it by hand',
      } as const;
      const bodies = {
        retrying: [`The automatic refund of ${amount} for cancelled order ${orderId} failed. It is retried automatically for 7 days; you get another message if it still fails.`,
          `The automatic refund of ${amountHtml} for cancelled order ${orderIdHtml} failed. It is retried automatically for 7 days; you get another message if it still fails.`],
        blocked_permission: [`The refund of ${amount} for cancelled order ${orderId} was not issued because the workspace's Stripe restricted key lacks the Charges and Refunds (write) permission. Add the permission to the key in the Stripe Dashboard; waiting refunds are then paid by the next hourly attempt. Attempts continue every hour for 72 hours.`,
          `The refund of ${amountHtml} for cancelled order ${orderIdHtml} was not issued because the workspace's Stripe restricted key lacks the Charges and Refunds (write) permission. Add the permission to the key in the Stripe Dashboard; waiting refunds are then paid by the next hourly attempt. Attempts continue every hour for 72 hours.`],
        blocked_permission_failed: [`The refund of ${amount} for cancelled order ${orderId} was still blocked by the missing Charges and Refunds (write) permission after 72 hours of hourly attempts and is no longer retried. Refund the payment by hand in the Stripe Dashboard.`,
          `The refund of ${amountHtml} for cancelled order ${orderIdHtml} was still blocked by the missing Charges and Refunds (write) permission after 72 hours of hourly attempts and is no longer retried. Refund the payment by hand in the Stripe Dashboard.`],
        failed: [`The automatic refund of ${amount} for cancelled order ${orderId} could not be completed and is no longer retried. Refund the payment by hand in the Stripe Dashboard.`,
          `The automatic refund of ${amountHtml} for cancelled order ${orderIdHtml} could not be completed and is no longer retried. Refund the payment by hand in the Stripe Dashboard.`],
        failed_after_submission: [`Stripe reports that the refund of ${amount} for cancelled order ${orderId} failed after it was issued. Return the money to the buyer another way.`,
          `Stripe reports that the refund of ${amountHtml} for cancelled order ${orderIdHtml} failed after it was issued. Return the money to the buyer another way.`],
        unconfirmed: [`Stripe has not confirmed the refund of ${amount} for cancelled order ${orderId}, and the refund is no longer checked automatically. Check it in the Stripe Dashboard; if it failed or was canceled, return the money to the buyer another way.`,
          `Stripe has not confirmed the refund of ${amountHtml} for cancelled order ${orderIdHtml}, and the refund is no longer checked automatically. Check it in the Stripe Dashboard; if it failed or was canceled, return the money to the buyer another way.`],
      } as const;
      const [text, html] = bodies[alert];
      return {
        subject: `[${tenantName}] ${subjects[alert]}: ${orderId}`,
        html: `<p>${html}</p><p>Last error: ${errorHtml}</p><p><a href="${orderUrlHtml}">Open the order</a></p>`,
        text: `${text}\nLast error: ${error}\n${orderUrl}`,
      };
    },
  },
  stockLowEmail: {
    noThreshold: 'not set',
    render: ({ tenantName, productTitle, productTitleHtml, available, threshold, oversold, studioUrl, studioUrlHtml }) => ({
      subject: oversold ? `[${tenantName}] Oversold: ${productTitle}` : `[${tenantName}] Low stock: ${productTitle}`,
      html: `<p>${oversold ? `${productTitleHtml} was sold after its stock ran out.` : `${productTitleHtml} is running low.`}</p><p>Available: ${available}<br>Low-stock threshold: ${threshold}</p>${oversold ? '<p>A paid order arrived when no piece was left. Check the order and adjust the stock.</p>' : ''}<p><a href="${studioUrlHtml}">Open the product</a></p>`,
      text: `${oversold ? `${productTitle} was sold after its stock ran out.` : `${productTitle} is running low.`}\nAvailable: ${available}\nLow-stock threshold: ${threshold}\n${oversold ? 'A paid order arrived when no piece was left. Check the order and adjust the stock.\n' : ''}${studioUrl}`,
    }),
  },
};
