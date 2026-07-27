import { SESClient } from '@aws-sdk/client-ses';
import { SNSClient, type SubscribeCommandInput } from '@aws-sdk/client-sns';
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
  it('keeps a newly created HTTPS subscription pending until SNS confirms it', async () => {
    const subscribe = vi.fn(async (_sns: SNSClient, _input: SubscribeCommandInput) => ({
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
