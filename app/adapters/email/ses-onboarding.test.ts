import {
  CreateConfigurationSetEventDestinationCommand,
  DescribeConfigurationSetCommand,
  GetIdentityDkimAttributesCommand,
  GetIdentityVerificationAttributesCommand,
  ListIdentitiesCommand,
  SESClient,
} from '@aws-sdk/client-ses';
import { CreateTopicCommand, SetTopicAttributesCommand, SNSClient } from '@aws-sdk/client-sns';
import { describe, expect, it, vi } from 'vitest';

import { createSesOnboardingControlPlane } from './ses-onboarding.js';

const credentials = {
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  region: 'eu-central-1',
};

const topicArn = 'arn:aws:sns:eu-central-1:123456789012:together';
const endpoint = 'https://acme.example.test/api/webhooks/ses';
const factory = () => ({
  ses: new SESClient(credentials),
  sns: new SNSClient(credentials),
});

describe('SES onboarding AWS adapter', () => {
  it('omits engagement events from the transactional configuration set', async () => {
    const created: CreateConfigurationSetEventDestinationCommand[] = [];
    const ses = new SESClient(credentials);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- SES send also declares callback overloads, while this adapter uses the promise overload.
    vi.spyOn(ses, 'send').mockImplementation(async (command) => {
      if (command instanceof DescribeConfigurationSetCommand) {
        return { EventDestinations: [], $metadata: {} };
      }
      if (command instanceof CreateConfigurationSetEventDestinationCommand) {
        created.push(command);
        return { $metadata: {} };
      }
      throw new Error('unexpected command');
    });
    const controlPlane = createSesOnboardingControlPlane(
      () => ({ ses, sns: new SNSClient(credentials) }),
    );

    await controlPlane.ensureEventDestination(credentials, {
      configurationSet: 'marketing',
      topicArn,
      engagementTracking: true,
    });
    await controlPlane.ensureEventDestination(credentials, {
      configurationSet: 'marketing-transactional',
      topicArn,
      engagementTracking: false,
    });

    expect(created.map((command) => command.input)).toEqual([
      expect.objectContaining({
        ConfigurationSetName: 'marketing',
        EventDestination: expect.objectContaining({
          MatchingEventTypes: [
            'send',
            'delivery',
            'bounce',
            'complaint',
            'open',
            'click',
          ],
        }),
      }),
      expect.objectContaining({
        ConfigurationSetName: 'marketing-transactional',
        EventDestination: expect.objectContaining({
          MatchingEventTypes: ['send', 'delivery', 'bounce', 'complaint'],
        }),
      }),
    ]);
  });

  it('grants only topic-level actions in the SNS topic policy', async () => {
    const sns = new SNSClient(credentials);
    let policy = '';
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- SNS send also declares callback overloads, while this adapter uses the promise overload.
    vi.spyOn(sns, 'send').mockImplementation(async (command) => {
      if (command instanceof CreateTopicCommand) {
        return { TopicArn: topicArn, $metadata: {} };
      }
      if (command instanceof SetTopicAttributesCommand) {
        policy = command.input.AttributeValue ?? '';
        return { $metadata: {} };
      }
      throw new Error('unexpected command');
    });
    const controlPlane = createSesOnboardingControlPlane(
      () => ({ ses: new SESClient(credentials), sns }),
    );

    const result = await controlPlane.ensureTopic(credentials, 'together');

    expect(result).toEqual({ ok: true, value: { arn: topicArn } });
    const document: unknown = JSON.parse(policy);
    expect(document).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'TopicOwner',
          Effect: 'Allow',
          Principal: { AWS: 'arn:aws:iam::123456789012:root' },
          Action: [
            'SNS:Publish',
            'SNS:Subscribe',
            'SNS:GetTopicAttributes',
            'SNS:SetTopicAttributes',
            'SNS:AddPermission',
            'SNS:RemovePermission',
            'SNS:DeleteTopic',
            'SNS:ListSubscriptionsByTopic',
            'SNS:Receive',
          ],
          Resource: topicArn,
        },
        {
          Sid: 'SesPublish',
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 'SNS:Publish',
          Resource: topicArn,
          Condition: { StringEquals: { 'AWS:SourceAccount': '123456789012' } },
        },
      ],
    });
    expect(policy).not.toContain('*');
  });

  it('keeps a newly created HTTPS subscription pending until SNS confirms it', async () => {
    const subscribe = vi.fn(async () => ({
      SubscriptionArn: 'pending confirmation',
      $metadata: {},
    }));
    const controlPlane = createSesOnboardingControlPlane(factory, {
      list: async () => [],
      subscribe,
    });

    const result = await controlPlane.ensureSubscription(credentials, {
      topicArn,
      endpoint,
    });

    expect(result).toEqual({ ok: true, value: { confirmed: false, arn: null, endpoint } });
    expect(subscribe).toHaveBeenCalledWith(
      expect.any(SNSClient),
      {
        TopicArn: topicArn,
        Protocol: 'https',
        Endpoint: endpoint,
      },
    );
  });

  it.each([
    ['PendingConfirmation', false, null],
    ['pending confirmation', false, null],
    ['Deleted', false, null],
    ['arn:aws:sns:eu-central-1:123456789012:together:subscription-id', true, 'arn:aws:sns:eu-central-1:123456789012:together:subscription-id'],
  ])('maps the SNS subscription ARN %s to confirmed=%s', async (subscriptionArn, confirmed, arn) => {
    const controlPlane = createSesOnboardingControlPlane(factory, {
      list: async () => [{
        Protocol: 'https',
        Endpoint: endpoint,
        SubscriptionArn: subscriptionArn,
      }],
      subscribe: async () => ({ SubscriptionArn: 'pending confirmation', $metadata: {} }),
    });

    const result = await controlPlane.ensureSubscription(credentials, {
      topicArn,
      endpoint,
    });

    expect(result).toEqual({ ok: true, value: { confirmed, arn, endpoint } });
  });

  it.each([
    'HTTPS://ACME.EXAMPLE.TEST/api/webhooks/ses',
    'https://acme.example.test:443/api/webhooks/ses',
    'https://acme.example.test/api/webhooks/ses/',
  ])('reuses the subscription that SNS reports as %s', async (reported) => {
    const subscribe = vi.fn(async () => ({ SubscriptionArn: 'pending confirmation', $metadata: {} }));
    const controlPlane = createSesOnboardingControlPlane(factory, {
      list: async () => [{
        Protocol: 'https',
        Endpoint: reported,
        SubscriptionArn: 'arn:aws:sns:eu-central-1:123456789012:together:subscription-id',
      }],
      subscribe,
    });

    const result = await controlPlane.ensureSubscription(credentials, { topicArn, endpoint });

    expect(result).toEqual({
      ok: true,
      value: {
        confirmed: true,
        arn: 'arn:aws:sns:eu-central-1:123456789012:together:subscription-id',
        endpoint: reported,
      },
    });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('matches the persisted subscribe-time endpoint before the currently expected one', async () => {
    const persisted = 'https://old.example.test/api/webhooks/ses';
    const ses = new SESClient(credentials);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- SES send also declares callback overloads, while this adapter uses the promise overload.
    vi.spyOn(ses, 'send').mockImplementation(async () => ({ EventDestinations: [], $metadata: {} }));
    const controlPlane = createSesOnboardingControlPlane(
      () => ({ ses, sns: new SNSClient(credentials) }),
      {
        list: async () => [
          {
            Protocol: 'https',
            Endpoint: `${persisted}/`,
            SubscriptionArn: 'arn:aws:sns:eu-central-1:123456789012:together:persisted',
          },
          { Protocol: 'https', Endpoint: endpoint, SubscriptionArn: 'PendingConfirmation' },
        ],
        subscribe: async () => ({ SubscriptionArn: 'pending confirmation', $metadata: {} }),
      },
    );
    const infrastructure = (subscribedEndpoint: string | null) => controlPlane.readInfrastructure(credentials, {
      configurationSet: 'marketing',
      transactionalConfigurationSet: 'marketing-transactional',
      topicArn,
      endpoint,
      subscribedEndpoint,
    });

    expect(await infrastructure(persisted)).toMatchObject({
      ok: true, value: { subscriptionConfirmed: true },
    });
    expect(await infrastructure(null)).toMatchObject({
      ok: true, value: { subscriptionConfirmed: false },
    });
  });

  it('pages through every SES identity and reports its verification and DKIM state', async () => {
    const ses = new SESClient(credentials);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- SES send also declares callback overloads, while this adapter uses the promise overload.
    vi.spyOn(ses, 'send').mockImplementation(async (command) => {
      if (command instanceof ListIdentitiesCommand) {
        return command.input.NextToken === undefined
          ? { Identities: ['tenant.test'], NextToken: 'page-2', $metadata: {} }
          : { Identities: ['owner@tenant.test'], $metadata: {} };
      }
      if (command instanceof GetIdentityVerificationAttributesCommand) {
        return {
          VerificationAttributes: {
            'tenant.test': { VerificationStatus: 'Success' },
            'owner@tenant.test': { VerificationStatus: 'Pending' },
          },
          $metadata: {},
        };
      }
      if (command instanceof GetIdentityDkimAttributesCommand) {
        return {
          DkimAttributes: { 'tenant.test': { DkimVerificationStatus: 'Success' } },
          $metadata: {},
        };
      }
      throw new Error('unexpected command');
    });
    const controlPlane = createSesOnboardingControlPlane(
      () => ({ ses, sns: new SNSClient(credentials) }),
    );

    const result = await controlPlane.listIdentities(credentials);

    expect(result).toEqual({
      ok: true,
      value: {
        identities: [
          { identity: 'tenant.test', kind: 'domain', verified: true, dkimVerified: true },
          { identity: 'owner@tenant.test', kind: 'email', verified: false, dkimVerified: false },
        ],
        accessDeniedAction: null,
      },
    });
  });

  it('turns a missing ses:ListIdentities permission into a non-fatal hint', async () => {
    const ses = new SESClient(credentials);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- SES send also declares callback overloads, while this adapter uses the promise overload.
    vi.spyOn(ses, 'send').mockImplementation(async () => {
      throw Object.assign(new Error('User is not authorized to perform ses:ListIdentities'), {
        name: 'AccessDenied',
      });
    });
    const controlPlane = createSesOnboardingControlPlane(
      () => ({ ses, sns: new SNSClient(credentials) }),
    );

    expect(await controlPlane.listIdentities(credentials)).toEqual({
      ok: true,
      value: { identities: [], accessDeniedAction: 'ses:ListIdentities' },
    });
  });

  it('names the denied attribute action when only the identity listing is allowed', async () => {
    const ses = new SESClient(credentials);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- SES send also declares callback overloads, while this adapter uses the promise overload.
    vi.spyOn(ses, 'send').mockImplementation(async (command) => {
      if (command instanceof ListIdentitiesCommand) return { Identities: ['tenant.test'], $metadata: {} };
      if (command instanceof GetIdentityVerificationAttributesCommand) {
        return { VerificationAttributes: { 'tenant.test': { VerificationStatus: 'Success' } }, $metadata: {} };
      }
      throw Object.assign(new Error('not authorized to perform ses:GetIdentityDkimAttributes'), {
        name: 'AccessDeniedException',
      });
    });
    const controlPlane = createSesOnboardingControlPlane(
      () => ({ ses, sns: new SNSClient(credentials) }),
    );

    expect(await controlPlane.listIdentities(credentials)).toEqual({
      ok: true,
      value: { identities: [], accessDeniedAction: 'ses:GetIdentityDkimAttributes' },
    });
  });
});
