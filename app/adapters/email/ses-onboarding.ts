import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  DescribeConfigurationSetCommand,
  GetIdentityDkimAttributesCommand,
  GetIdentityVerificationAttributesCommand,
  GetSendQuotaCommand,
  SendEmailCommand,
  SESClient,
  SetIdentityFeedbackForwardingEnabledCommand,
  UpdateConfigurationSetEventDestinationCommand,
  VerifyDomainDkimCommand,
  VerifyEmailIdentityCommand,
} from '@aws-sdk/client-ses';
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SetTopicAttributesCommand,
  SNSClient,
  SubscribeCommand,
  type SubscribeCommandInput,
  type SubscribeCommandOutput,
  type Subscription,
} from '@aws-sdk/client-sns';

import { integrationUnavailable, ok, type AppError, type Result } from '@core/domain/index.js';
import type {
  SesDkimRecord,
  SesMarketingCredentials,
  SesOnboardingControlPlane,
} from '@core/server/index.js';

const destinationName = 'together-events';
const eventTypes = ['send', 'delivery', 'bounce', 'complaint', 'open', 'click'] as const;

const clientsFor = (credentials: SesMarketingCredentials) => {
  const input = {
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  };
  return { ses: new SESClient(input), sns: new SNSClient(input) };
};

const errorName = (cause: unknown): string | null => {
  if (typeof cause !== 'object' || cause === null) return null;
  const name = Reflect.get(cause, 'name');
  return typeof name === 'string' ? name : null;
};

const failed = (action: string, cause: unknown): Result<never, AppError> => ({
  ok: false,
  error: integrationUnavailable(`${action}. Check the tenant AWS key permissions and Region, then retry. AWS: ${String(cause)}`),
});

const dkimRecords = (identity: string, tokens: readonly string[] | undefined): SesDkimRecord[] =>
  (tokens ?? []).map((token) => ({
    name: `${token}._domainkey.${identity}`,
    type: 'CNAME',
    value: `${token}.dkim.amazonses.com`,
  }));

const isConfigurationSetMissing = (cause: unknown): boolean =>
  errorName(cause) === 'ConfigurationSetDoesNotExistException';

const subscriptionArnState = (arn: string | undefined): { confirmed: boolean; arn: string | null } => {
  const pending = arn?.replaceAll(' ', '').toLowerCase() === 'pendingconfirmation';
  return {
    confirmed: arn !== undefined && !pending,
    arn: arn === undefined || pending ? null : arn,
  };
};

const configurationSetExists = async (
  ses: SESClient,
  name: string,
): Promise<boolean> => {
  try {
    await ses.send(new DescribeConfigurationSetCommand({ ConfigurationSetName: name }));
    return true;
  } catch (cause) {
    if (isConfigurationSetMissing(cause)) return false;
    throw cause;
  }
};

const listSubscriptions = async (
  sns: SNSClient,
  topicArn: string,
) => {
  const subscriptions = [];
  let nextToken: string | undefined;
  do {
    const output = await sns.send(new ListSubscriptionsByTopicCommand({
      TopicArn: topicArn,
      ...(nextToken === undefined ? {} : { NextToken: nextToken }),
    }));
    subscriptions.push(...(output.Subscriptions ?? []));
    nextToken = output.NextToken;
  } while (nextToken !== undefined);
  return subscriptions;
};

interface SnsSubscriptionOperations {
  list(sns: SNSClient, topicArn: string): Promise<Subscription[]>;
  subscribe(sns: SNSClient, input: SubscribeCommandInput): Promise<SubscribeCommandOutput>;
}

const snsSubscriptionOperations: SnsSubscriptionOperations = {
  list: listSubscriptions,
  subscribe: async (sns, input) => sns.send(new SubscribeCommand(input)),
};

const topicPolicy = (topicArn: string): string => {
  const accountId = topicArn.split(':')[4] ?? '';
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'TopicOwner',
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${accountId}:root` },
        Action: 'SNS:*',
        Resource: topicArn,
      },
      {
        Sid: 'SesPublish',
        Effect: 'Allow',
        Principal: { Service: 'ses.amazonaws.com' },
        Action: 'SNS:Publish',
        Resource: topicArn,
        Condition: { StringEquals: { 'AWS:SourceAccount': accountId } },
      },
    ],
  });
};

export const createSesOnboardingControlPlane = (
  factory: (credentials: SesMarketingCredentials) => { ses: SESClient; sns: SNSClient } = clientsFor,
  subscriptions: SnsSubscriptionOperations = snsSubscriptionOperations,
): SesOnboardingControlPlane => ({
  startDomainIdentity: async (credentials, identity) => {
    try {
      const output = await factory(credentials).ses.send(new VerifyDomainDkimCommand({ Domain: identity }));
      return ok({ records: dkimRecords(identity, output.DkimTokens) });
    } catch (cause) {
      return failed('Could not start SES domain and DKIM verification', cause);
    }
  },
  startEmailIdentity: async (credentials, identity) => {
    try {
      const ses = factory(credentials).ses;
      const existing = await ses.send(new GetIdentityVerificationAttributesCommand({ Identities: [identity] }));
      if (existing.VerificationAttributes?.[identity] === undefined) {
        await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: identity }));
      }
      return ok({ records: [] });
    } catch (cause) {
      return failed('Could not send the SES e-mail identity verification message', cause);
    }
  },
  readIdentity: async (credentials, identity) => {
    try {
      const ses = factory(credentials).ses;
      const [verification, dkim] = await Promise.all([
        ses.send(new GetIdentityVerificationAttributesCommand({ Identities: [identity] })),
        ses.send(new GetIdentityDkimAttributesCommand({ Identities: [identity] })),
      ]);
      const verificationStatus = verification.VerificationAttributes?.[identity]?.VerificationStatus;
      const dkimAttributes = dkim.DkimAttributes?.[identity];
      const isEmail = identity.includes('@');
      return ok({
        verified: verificationStatus === 'Success',
        dkimVerified: isEmail || dkimAttributes?.DkimVerificationStatus === 'Success',
        records: isEmail ? [] : dkimRecords(identity, dkimAttributes?.DkimTokens),
      });
    } catch (cause) {
      return failed('Could not poll the SES identity status', cause);
    }
  },
  ensureConfigurationSet: async (credentials, name) => {
    try {
      const ses = factory(credentials).ses;
      if (!await configurationSetExists(ses, name)) {
        await ses.send(new CreateConfigurationSetCommand({ ConfigurationSet: { Name: name } }));
      }
      return ok({ name });
    } catch (cause) {
      return failed('Could not create the SES configuration set', cause);
    }
  },
  ensureTopic: async (credentials, name) => {
    try {
      const sns = factory(credentials).sns;
      const output = await sns.send(new CreateTopicCommand({ Name: name }));
      if (output.TopicArn === undefined) {
        return failed('SNS created the topic without returning its ARN', 'missing TopicArn');
      }
      await sns.send(new SetTopicAttributesCommand({
        TopicArn: output.TopicArn,
        AttributeName: 'Policy',
        AttributeValue: topicPolicy(output.TopicArn),
      }));
      return ok({ arn: output.TopicArn });
    } catch (cause) {
      return failed('Could not create the SNS topic', cause);
    }
  },
  ensureSubscription: async (credentials, input) => {
    try {
      const sns = factory(credentials).sns;
      const existing = (await subscriptions.list(sns, input.topicArn))
        .find((subscription) => subscription.Protocol === 'https' && subscription.Endpoint === input.endpoint);
      if (existing !== undefined) {
        return ok(subscriptionArnState(existing.SubscriptionArn));
      }
      const created = await subscriptions.subscribe(sns, {
        TopicArn: input.topicArn,
        Protocol: 'https',
        Endpoint: input.endpoint,
      });
      return ok(subscriptionArnState(created.SubscriptionArn));
    } catch (cause) {
      return failed('Could not subscribe the Together webhook to SNS', cause);
    }
  },
  readInfrastructure: async (credentials, input) => {
    try {
      const { ses, sns } = factory(credentials);
      let configurationSetReady = false;
      let eventDestinationReady = false;
      try {
        const configuration = await ses.send(new DescribeConfigurationSetCommand({
          ConfigurationSetName: input.configurationSet,
          ConfigurationSetAttributeNames: ['eventDestinations'],
        }));
        configurationSetReady = true;
        const destination = configuration.EventDestinations?.find((item) => item.Name === destinationName);
        eventDestinationReady = destination?.Enabled === true
          && destination.SNSDestination?.TopicARN === input.topicArn
          && eventTypes.every((eventType) => destination.MatchingEventTypes?.includes(eventType));
      } catch (cause) {
        if (!isConfigurationSetMissing(cause)) throw cause;
      }
      const subscription = (await subscriptions.list(sns, input.topicArn))
        .find((item) => item.Protocol === 'https' && item.Endpoint === input.endpoint);
      return ok({
        configurationSetReady,
        eventDestinationReady,
        subscriptionConfirmed: subscriptionArnState(subscription?.SubscriptionArn).confirmed,
      });
    } catch (cause) {
      return failed('Could not inspect the SES and SNS onboarding state', cause);
    }
  },
  ensureEventDestination: async (credentials, input) => {
    try {
      const ses = factory(credentials).ses;
      const configuration = await ses.send(new DescribeConfigurationSetCommand({
        ConfigurationSetName: input.configurationSet,
        ConfigurationSetAttributeNames: ['eventDestinations'],
      }));
      const eventDestination = {
        Name: destinationName,
        Enabled: true,
        MatchingEventTypes: [...eventTypes],
        SNSDestination: { TopicARN: input.topicArn },
      };
      const exists = configuration.EventDestinations?.some((item) => item.Name === destinationName) ?? false;
      await ses.send(exists
        ? new UpdateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: input.configurationSet,
          EventDestination: eventDestination,
        })
        : new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: input.configurationSet,
          EventDestination: eventDestination,
        }));
      return ok({ ready: true });
    } catch (cause) {
      return failed('Could not wire SES events to the SNS topic', cause);
    }
  },
  disableFeedbackForwarding: async (credentials, identity) => {
    try {
      await factory(credentials).ses.send(new SetIdentityFeedbackForwardingEnabledCommand({
        Identity: identity,
        ForwardingEnabled: false,
      }));
      return ok({ disabled: true });
    } catch (cause) {
      return failed('Could not disable SES identity feedback forwarding after SNS confirmation', cause);
    }
  },
  readQuota: async (credentials) => {
    try {
      const quota = await factory(credentials).ses.send(new GetSendQuotaCommand({}));
      const daily = Math.floor(quota.Max24HourSend ?? 0);
      return ok({
        ratePerSecond: quota.MaxSendRate ?? 0,
        daily,
        sentLast24Hours: Math.floor(quota.SentLast24Hours ?? 0),
        inSandbox: daily <= 200,
      });
    } catch (cause) {
      return failed('Could not read the SES sending quota', cause);
    }
  },
  sendSimulator: async (credentials, input) => {
    try {
      const output = await factory(credentials).ses.send(new SendEmailCommand({
        Source: `${input.from.name} <${input.from.address}>`,
        Destination: { ToAddresses: [input.to] },
        Message: {
          Subject: { Data: 'Together SES webhook test', Charset: 'UTF-8' },
          Body: {
            Html: { Data: '<p>Together SES webhook round-trip test.</p>', Charset: 'UTF-8' },
            Text: { Data: 'Together SES webhook round-trip test.', Charset: 'UTF-8' },
          },
        },
        ConfigurationSetName: input.configurationSet,
      }));
      return output.MessageId === undefined
        ? failed('SES accepted the simulator test without returning a message id', 'missing MessageId')
        : ok({ messageId: output.MessageId });
    } catch (cause) {
      return failed('Could not send the SES mailbox simulator bounce', cause);
    }
  },
});
