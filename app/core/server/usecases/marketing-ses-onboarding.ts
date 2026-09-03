import {
  err,
  notFound,
  ok,
  tenantSesBroadcastsReady,
  transactionalSesConfigurationSetName,
  type AppError,
  type Result,
  type TenantSesSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type {
  Clock,
  MarketingSesCredentialResolver,
  SesAccountIdentities,
  SesMarketingCredentials,
  SesOnboardingControlPlane,
  TenantSesSettingsRepository,
} from '../ports.js';

export type { SesOnboardingControlPlane } from '../ports.js';

export interface SesOnboardingChecklist {
  credentials: boolean;
  identity: boolean;
  configurationSet: boolean;
  snsSubscription: boolean;
  webhook: boolean;
  footer: boolean;
  productionAccess: boolean;
}

export interface SesOnboardingStatus {
  identityVerified: boolean;
  dkimVerified: boolean;
  identityRegressed: boolean;
  records: { name: string; type: 'CNAME'; value: string }[];
  configurationSetReady: boolean;
  eventDestinationReady: boolean;
  subscriptionConfirmed: boolean;
  feedbackForwardingDisabled: boolean;
  checklist: SesOnboardingChecklist;
}

export interface SesOnboardingDeps {
  settings: TenantSesSettingsRepository;
  credentials: MarketingSesCredentialResolver;
  controlPlane: SesOnboardingControlPlane;
  clock: Clock;
  webhookBaseUrl: string;
}

const onboardingContext = async (ctx: Ctx, deps: SesOnboardingDeps) => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  const settings = await deps.settings.findByTenant(tenantId.value);
  if (settings === null) return err(notFound('Save sender settings before starting SES onboarding'));
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  return ok({
    tenantId: tenantId.value,
    settings,
    credentials: credentials.value,
    webhookUrl: `${deps.webhookBaseUrl}/${settings.webhookToken}`,
  });
};

const resourceName = (tenantId: string): string =>
  `together-${tenantId.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 64);

const store = async (
  deps: SesOnboardingDeps,
  tenantId: string,
  settings: TenantSesSettings,
  patch: Partial<TenantSesSettings>,
): Promise<TenantSesSettings> => {
  const next = { ...settings, ...patch, broadcastsEnabled: false };
  next.broadcastsEnabled = tenantSesBroadcastsReady(next);
  return deps.settings.upsert(tenantId, next);
};

export const deriveSesOnboardingChecklist = (input: {
  credentialsConfigured: boolean;
  identityVerified: boolean;
  configurationSetReady: boolean;
  subscriptionConfirmed: boolean;
  webhookVerifiedAt: string | null;
  footerConfigured: boolean;
  quotaRefreshed: boolean;
  inSandbox: boolean;
}): SesOnboardingChecklist => ({
  credentials: input.credentialsConfigured,
  identity: input.identityVerified,
  configurationSet: input.configurationSetReady,
  snsSubscription: input.subscriptionConfirmed,
  webhook: input.webhookVerifiedAt !== null,
  footer: input.footerConfigured,
  productionAccess: input.quotaRefreshed && !input.inSandbox,
});

export const startSesIdentityVerification = async (
  ctx: Ctx,
  input: { kind: 'domain' | 'email' },
  deps: SesOnboardingDeps,
) => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  const context = await onboardingContext(ctx, deps);
  if (!context.ok) return context;
  const started = input.kind === 'domain'
    ? await deps.controlPlane.startDomainIdentity(context.value.credentials, context.value.settings.identity)
    : await deps.controlPlane.startEmailIdentity(context.value.credentials, context.value.settings.identity);
  return started.ok
    ? ok({
      identity: context.value.settings.identity,
      kind: input.kind,
      records: started.value.records,
    })
    : started;
};

export const provisionSesInfrastructure = async (
  ctx: Ctx,
  deps: SesOnboardingDeps,
) => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  const context = await onboardingContext(ctx, deps);
  if (!context.ok) return context;
  const name = resourceName(context.value.tenantId);
  let current = context.value.settings;
  const configurationSet = await deps.controlPlane.ensureConfigurationSet(context.value.credentials, current.configurationSet ?? name);
  if (!configurationSet.ok) return configurationSet;
  const transactionalConfigurationSet = await deps.controlPlane.ensureConfigurationSet(
    context.value.credentials,
    transactionalSesConfigurationSetName(configurationSet.value.name),
  );
  if (!transactionalConfigurationSet.ok) return transactionalConfigurationSet;
  if (current.configurationSet !== configurationSet.value.name) {
    current = await store(deps, context.value.tenantId, current, { configurationSet: configurationSet.value.name });
  }
  const topic = await deps.controlPlane.ensureTopic(context.value.credentials, name);
  if (!topic.ok) return topic;
  if (current.snsTopicArn !== topic.value.arn) {
    current = await store(deps, context.value.tenantId, current, { snsTopicArn: topic.value.arn });
  }
  const subscription = await deps.controlPlane.ensureSubscription(context.value.credentials, {
    topicArn: topic.value.arn,
    endpoint: context.value.webhookUrl,
  });
  if (!subscription.ok) return subscription;
  const destination = await deps.controlPlane.ensureEventDestination(context.value.credentials, {
    configurationSet: configurationSet.value.name,
    topicArn: topic.value.arn,
    engagementTracking: true,
  });
  if (!destination.ok) return destination;
  const transactionalDestination = await deps.controlPlane.ensureEventDestination(
    context.value.credentials,
    {
      configurationSet: transactionalConfigurationSet.value.name,
      topicArn: topic.value.arn,
      engagementTracking: false,
    },
  );
  if (!transactionalDestination.ok) return transactionalDestination;
  let feedbackForwardingDisabled = false;
  if (subscription.value.confirmed) {
    const feedback = await deps.controlPlane.disableFeedbackForwarding(
      context.value.credentials,
      current.identity,
    );
    if (!feedback.ok) return feedback;
    feedbackForwardingDisabled = true;
  }
  const quota = await deps.controlPlane.readQuota(context.value.credentials);
  if (!quota.ok) return quota;
  current = await store(deps, context.value.tenantId, current, {
    quotaRatePerSec: quota.value.ratePerSecond,
    quotaDaily: quota.value.daily,
    quotaSentLast24Hours: quota.value.sentLast24Hours,
    quotaRefreshedAt: deps.clock.nowIso(),
    inSandbox: quota.value.inSandbox,
  });
  return ok({
    configurationSet: current.configurationSet ?? configurationSet.value.name,
    topicArn: current.snsTopicArn ?? topic.value.arn,
    subscriptionConfirmed: subscription.value.confirmed,
    feedbackForwardingDisabled,
  });
};

export const pollSesOnboarding = async (
  ctx: Ctx,
  deps: SesOnboardingDeps,
): Promise<Result<SesOnboardingStatus, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  const context = await onboardingContext(ctx, deps);
  if (!context.ok) return context;
  const identity = await deps.controlPlane.readIdentity(context.value.credentials, context.value.settings.identity);
  if (!identity.ok) return identity;
  const wasVerified = context.value.settings.identityVerifiedAt !== null;
  const identityReady = identity.value.verified && identity.value.dkimVerified;
  let current = await store(deps, context.value.tenantId, context.value.settings, {
    identityVerifiedAt: identityReady
      ? context.value.settings.identityVerifiedAt ?? deps.clock.nowIso()
      : null,
  });
  let configurationSetReady = false;
  let eventDestinationReady = false;
  let subscriptionConfirmed = false;
  if (current.configurationSet !== null && current.snsTopicArn !== null) {
    const infrastructure = await deps.controlPlane.readInfrastructure(context.value.credentials, {
      configurationSet: current.configurationSet,
      transactionalConfigurationSet: transactionalSesConfigurationSetName(
        current.configurationSet,
      ),
      topicArn: current.snsTopicArn,
      endpoint: context.value.webhookUrl,
    });
    if (!infrastructure.ok) return infrastructure;
    configurationSetReady = infrastructure.value.configurationSetReady;
    eventDestinationReady = infrastructure.value.eventDestinationReady;
    subscriptionConfirmed = infrastructure.value.subscriptionConfirmed;
  }
  let feedbackForwardingDisabled = false;
  if (subscriptionConfirmed) {
    const feedback = await deps.controlPlane.disableFeedbackForwarding(context.value.credentials, current.identity);
    if (!feedback.ok) return feedback;
    feedbackForwardingDisabled = true;
  }
  const quota = await deps.controlPlane.readQuota(context.value.credentials);
  if (!quota.ok) return quota;
  current = await store(deps, context.value.tenantId, current, {
    webhookVerifiedAt: configurationSetReady && eventDestinationReady && subscriptionConfirmed
      ? current.webhookVerifiedAt
      : null,
    quotaRatePerSec: quota.value.ratePerSecond,
    quotaDaily: quota.value.daily,
    quotaSentLast24Hours: quota.value.sentLast24Hours,
    quotaRefreshedAt: deps.clock.nowIso(),
    inSandbox: quota.value.inSandbox,
  });
  return ok({
    identityVerified: identityReady,
    dkimVerified: identity.value.dkimVerified,
    identityRegressed: wasVerified && !identityReady,
    records: identity.value.records,
    configurationSetReady,
    eventDestinationReady,
    subscriptionConfirmed,
    feedbackForwardingDisabled,
    checklist: deriveSesOnboardingChecklist({
      credentialsConfigured: true,
      identityVerified: identityReady,
      configurationSetReady: configurationSetReady && eventDestinationReady,
      subscriptionConfirmed,
      webhookVerifiedAt: current.webhookVerifiedAt,
      footerConfigured: current.footerLegalName.trim() !== '' && current.footerAddress.trim() !== '',
      quotaRefreshed: current.quotaRefreshedAt !== null,
      inSandbox: current.inSandbox,
    }),
  });
};

const readIdentityStatus = async (
  tenantId: string,
  settings: TenantSesSettings,
  deps: SesOnboardingDeps,
): Promise<{ patch: Partial<TenantSesSettings>; checkedWith: SesMarketingCredentials | null }> => {
  const identityCheckedAt = deps.clock.nowIso();
  const credentials = await deps.credentials.resolve(tenantId);
  if (!credentials.ok) {
    return { patch: { identityCheckedAt, identityCheckError: credentials.error.message }, checkedWith: null };
  }
  const identity = await deps.controlPlane.readIdentity(credentials.value, settings.identity);
  if (!identity.ok) {
    return { patch: { identityCheckedAt, identityCheckError: identity.error.message }, checkedWith: null };
  }
  return {
    patch: {
      identityVerifiedAt: identity.value.verified && identity.value.dkimVerified
        ? settings.identityVerifiedAt ?? identityCheckedAt
        : null,
      identityCheckedAt,
      identityCheckError: null,
    },
    checkedWith: credentials.value,
  };
};

export const refreshTenantSesIdentityStatus = async (
  tenantId: string,
  settings: TenantSesSettings,
  deps: SesOnboardingDeps,
): Promise<TenantSesSettings> =>
  store(deps, tenantId, settings, (await readIdentityStatus(tenantId, settings, deps)).patch);

const checkTenantSesIdentity = async (
  tenantId: string,
  settings: TenantSesSettings,
  deps: SesOnboardingDeps,
): Promise<TenantSesSettings> => {
  const { patch, checkedWith } = await readIdentityStatus(tenantId, settings, deps);
  if (checkedWith === null || settings.configurationSet === null || settings.snsTopicArn === null) {
    return store(deps, tenantId, settings, patch);
  }
  const infrastructure = await deps.controlPlane.readInfrastructure(
    checkedWith,
    {
      configurationSet: settings.configurationSet,
      transactionalConfigurationSet: transactionalSesConfigurationSetName(
        settings.configurationSet,
      ),
      topicArn: settings.snsTopicArn,
      endpoint: `${deps.webhookBaseUrl}/${settings.webhookToken}`,
    },
  );
  if (!infrastructure.ok) {
    return store(deps, tenantId, settings, {
      ...patch,
      identityCheckError: infrastructure.error.message,
    });
  }
  return store(deps, tenantId, settings, infrastructure.value.configurationSetReady
    ? patch
    : { ...patch, configurationSet: null, webhookVerifiedAt: null });
};

export const listSesIdentities = async (
  ctx: Ctx,
  deps: SesOnboardingDeps,
): Promise<Result<SesAccountIdentities, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  const credentials = await deps.credentials.resolve(tenantId.value);
  if (!credentials.ok) return credentials;
  return deps.controlPlane.listIdentities(credentials.value);
};

export const refreshSesIdentity = async (
  ctx: Ctx,
  deps: SesOnboardingDeps,
): Promise<Result<TenantSesSettings, AppError>> => {
  const tenantId = authorizeRequiredTenant(ctx, 'scheduler:dispatch');
  if (!tenantId.ok) return tenantId;
  const settings = await deps.settings.findByTenant(tenantId.value);
  if (settings === null) return err(notFound('SES sender settings do not exist'));
  return ok(await checkTenantSesIdentity(tenantId.value, settings, deps));
};

export const sendSesSimulatorTest = async (
  ctx: Ctx,
  deps: SesOnboardingDeps,
) => {
  const tenantId = authorizeRequiredTenant(ctx, 'marketing:ses:write');
  if (!tenantId.ok) return tenantId;
  const context = await onboardingContext(ctx, deps);
  if (!context.ok) return context;
  if (context.value.settings.configurationSet === null) {
    return err(notFound('Create the SES configuration set before sending a simulator test'));
  }
  const sent = await deps.controlPlane.sendSimulator(context.value.credentials, {
    from: {
      address: context.value.settings.fromAddress,
      name: context.value.settings.fromName,
    },
    to: 'bounce@simulator.amazonses.com',
    configurationSet: context.value.settings.configurationSet,
  });
  return sent.ok
    ? ok({
      messageId: sent.value.messageId,
      webhookVerifiedAt: context.value.settings.webhookVerifiedAt,
      waitingForWebhook: context.value.settings.webhookVerifiedAt === null,
    })
    : sent;
};
