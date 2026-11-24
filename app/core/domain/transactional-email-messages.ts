import type { OrderRefundAlert } from './order-refund-job.js';
import type { StaffRefundReason } from './order-staff-refund.js';

interface TransactionalEmailMessageContent {
  subject: string;
  html: string;
  text: string;
}

interface RenderedTextParts {
  html: string;
  text: string;
}

export type NotificationFooterKind = 'thread' | 'space' | 'direct';
export type WelcomeSignInProductType = 'course' | 'digital_download' | 'membership' | 'physical' | 'unknown';

type ReputationStatus = 'warn' | 'critical';

interface BrandedInput {
  header: string;
  socialLinks: RenderedTextParts;
}

export interface TransactionalEmailMessages {
  manageNotifications: {
    label: string;
    hints: Record<NotificationFooterKind, string>;
  };
  purchase: {
    heading: string;
    paymentReceived: (orderReference: string, tenantName: string) => string;
    collectInPerson: string;
    nextSteps: Record<WelcomeSignInProductType, string>;
    orderNumber: string;
    lines: string;
    item: string;
    amount: string;
    vat: string;
    exempt: string;
    total: string;
    notInvoice: string;
    invoiceContact: (contact: string) => string;
    contactLabel: string;
    signInValidity: string;
    signInLater: (signInPage: string) => string;
    signInPageLabel: string;
    subject: (orderReference: string, tenantName: string) => string;
    verification: string;
    verificationText: string;
    qrAlt: string;
    delivery: string;
    pickupPoint: string;
    personalization: string;
    personalizationCondition: string;
  };
  orderShipped: {
    items: string;
    carrier: string;
    trackingNumber: string;
    trackLabel: string;
    carriers: Record<'inpost', string>;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      orderReference: string;
      orderReferenceHtml: string;
      track: RenderedTextParts;
      items: RenderedTextParts;
      delivery: RenderedTextParts;
      tracking: RenderedTextParts;
    }) => TransactionalEmailMessageContent;
  };
  welcomeSignIn: {
    actionLabels: Record<WelcomeSignInProductType, string>;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      actionUrl: string;
      actionLink: string;
      actionLabel: string;
    }) => TransactionalEmailMessageContent;
  };
  resetPassword: {
    actionLabel: string;
    render: (input: { actionUrl: string; actionLink: string }) => TransactionalEmailMessageContent;
  };
  verifyEmail: {
    actionLabel: string;
    render: (input: { actionUrl: string; actionLink: string }) => TransactionalEmailMessageContent;
  };
  threadReply: {
    actionLabel: string;
    render: (input: {
      tenantName: string;
      tenantNameHtml: string;
      lessonName: string;
      lessonNameHtml: string;
      authorDisplay: string;
      authorHtml: string;
      snippetText: string;
      snippetHtml: string;
      url: string;
      actionLink: string;
      footer: RenderedTextParts;
    }) => TransactionalEmailMessageContent;
  };
  lessonQuestion: {
    actionLabel: string;
    render: (input: {
      tenantName: string;
      tenantNameHtml: string;
      lessonName: string;
      lessonNameHtml: string;
      authorDisplay: string;
      authorHtml: string;
      snippetText: string;
      snippetHtml: string;
      url: string;
      actionLink: string;
      footer: RenderedTextParts;
    }) => TransactionalEmailMessageContent;
  };
  spacePost: {
    actionLabel: string;
    render: (input: {
      tenantName: string;
      tenantNameHtml: string;
      spaceName: string;
      spaceNameHtml: string;
      authorDisplay: string;
      authorHtml: string;
      snippetText: string;
      snippetHtml: string;
      url: string;
      actionLink: string;
      footer: RenderedTextParts;
    }) => TransactionalEmailMessageContent;
  };
  spaceEvent: {
    actionLabel: string;
    render: (input: {
      tenantName: string;
      tenantNameHtml: string;
      spaceName: string;
      spaceNameHtml: string;
      authorDisplay: string;
      authorHtml: string;
      snippetText: string;
      snippetHtml: string;
      url: string;
      actionLink: string;
      footer: RenderedTextParts;
    }) => TransactionalEmailMessageContent;
  };
  directMessage: {
    actionLabel: string;
    render: (input: {
      tenantName: string;
      tenantNameHtml: string;
      senderDisplay: string;
      senderHtml: string;
      snippetText: string;
      snippetHtml: string;
      url: string;
      actionLink: string;
      footer: RenderedTextParts;
    }) => TransactionalEmailMessageContent;
  };
  magicLink: {
    actionLabel: string;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      url: string;
      actionLink: string;
    }) => TransactionalEmailMessageContent;
  };
  subscriptionPaymentFailed: {
    billingPortalLabel: string;
    contactLabel: string;
    workspaceLabel: (tenantName: string) => string;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      productTitle: string;
      productTitleHtml: string;
      accessEndsAtText: string;
      accessEndsAtHtml: string;
      billingPortalUrl: string | null;
      portal: string;
      contactUrl: string | null;
      contactLink: string | null;
      workspaceUrl: string | null;
      workspaceLink: string | null;
    }) => TransactionalEmailMessageContent;
  };
  subscriptionEnded: {
    offerLabel: string;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      productTitle: string;
      productTitleHtml: string;
      accessEndsAtText: string;
      accessEndsAtHtml: string;
      offerUrl: string;
      offerLink: string;
    }) => TransactionalEmailMessageContent;
  };
  supportMessage: {
    render: (input: {
      tenantName: string;
      tenantNameHtml: string;
      memberEmail: string;
      memberEmailHtml: string;
      memberDisplay: string;
      memberDisplayHtml: string;
      subject: string;
      subjectHtml: string;
      body: string;
      bodyHtml: string;
      header: string;
    }) => TransactionalEmailMessageContent;
  };
  memberErasureRequestEmail: {
    render: (input: {
      tenantName: string;
      memberEmail: string;
      memberEmailHtml: string;
      requestedAtText: string;
      requestedAtHtml: string;
      dueAtText: string;
      dueAtHtml: string;
      panelUrl: string;
      panelUrlHtml: string;
    }) => TransactionalEmailMessageContent;
  };
  emailTransportTest: {
    render: (input: { transport: string; transportHtml: string }) => TransactionalEmailMessageContent;
  };
  reputationAlertEmail: {
    statusLabels: Record<ReputationStatus, string>;
    missingRate: string;
    render: (input: {
      tenantName: string;
      tenantNameHtml: string;
      status: string;
      hardBounceRate: string;
      complaintRate: string;
      windowStartText: string;
      windowStartHtml: string;
      windowEndText: string;
      windowEndHtml: string;
      dashboardUrl: string;
      dashboardUrlHtml: string;
    }) => TransactionalEmailMessageContent;
  };
  orderOutOfStockEmail: {
    render: (input: {
      tenantName: string;
      orderId: string;
      orderIdHtml: string;
      buyerEmail: string;
      buyerEmailHtml: string;
      refund: { amount: string; amountHtml: string } | null;
      productTitles: string;
      productTitlesHtml: string;
      orderUrl: string;
      orderUrlHtml: string;
    }) => TransactionalEmailMessageContent;
  };
  orderSoldOutRefundEmail: {
    shopLabel: string;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      orderId: string;
      orderIdHtml: string;
      orderReference: string;
      orderReferenceHtml: string;
      productTitles: string;
      productTitlesHtml: string;
      refund: { amount: string; amountHtml: string } | null;
      shopUrl: string;
      shopLink: string;
    }) => TransactionalEmailMessageContent;
  };
  orderRefundIssuedEmail: {
    shopLabel: string;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      orderReference: string;
      orderReferenceHtml: string;
      amount: string;
      amountHtml: string;
      shopUrl: string;
      shopLink: string;
    }) => TransactionalEmailMessageContent;
  };
  staffRefundAlertEmail: {
    subjects: Record<OrderRefundAlert, string>;
    retryingOutcomeUnknownSubject: string;
    lastErrorLabel: string;
    openOrder: string;
    paragraphs: (input: {
      alert: OrderRefundAlert;
      amount: string;
      orderId: string;
      mayHaveRefunded: boolean;
      reason: StaffRefundReason | null;
      restocked: boolean;
      removedFromPackingList: boolean;
    }) => string[];
  };
  orderRefundAlertEmail: {
    render: (input: {
      tenantName: string;
      alert: OrderRefundAlert;
      orderId: string;
      orderIdHtml: string;
      amount: string;
      amountHtml: string;
      error: string;
      errorHtml: string;
      orderUrl: string;
      orderUrlHtml: string;
    }) => TransactionalEmailMessageContent;
  };
  stockLowEmail: {
    noThreshold: string;
    render: (input: {
      tenantName: string;
      productTitle: string;
      productTitleHtml: string;
      available: string;
      threshold: string;
      oversold: boolean;
      studioUrl: string;
      studioUrlHtml: string;
    }) => TransactionalEmailMessageContent;
  };
}
