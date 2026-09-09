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
  welcomeSignIn: {
    actionLabel: string;
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      actionUrl: string;
      actionLink: string;
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
    render: (input: BrandedInput & {
      tenantName: string;
      tenantNameHtml: string;
      productTitle: string;
      productTitleHtml: string;
      accessEndsAtText: string;
      accessEndsAtHtml: string;
      billingPortalUrl: string | null;
      portal: string;
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
}
