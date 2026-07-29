import {
  CreateConfigurationSetEventDestinationCommand,
  DescribeConfigurationSetCommand,
  SESClient,
} from '@aws-sdk/client-ses';
import { SNSClient } from '@aws-sdk/client-sns';
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

    expect(result).toEqual({ ok: true, value: { confirmed: false, arn: null } });
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

    expect(result).toEqual({ ok: true, value: { confirmed, arn } });
  });
});
