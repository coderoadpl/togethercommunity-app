# Amazon SES onboarding for Together

Together uses the tenant's own Amazon SES account for marketing mail and, once
the identity is verified, for transactional mail. SMTP remains a
transactional-only fallback. The platform SES key never sends tenant marketing.

## 1. Create a tenant AWS key

Create an IAM user or role for Together in the AWS account that owns the SES
identity. Generate an access key and save its access key ID, secret access key,
and AWS Region in **Sending settings → SES credentials**.

The wizard needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:VerifyDomainDkim",
        "ses:VerifyEmailIdentity",
        "ses:GetIdentityVerificationAttributes",
        "ses:GetIdentityDkimAttributes",
        "ses:CreateConfigurationSet",
        "ses:DescribeConfigurationSet",
        "ses:CreateConfigurationSetEventDestination",
        "ses:UpdateConfigurationSetEventDestination",
        "ses:SetIdentityFeedbackForwardingEnabled",
        "ses:GetSendQuota",
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:SetTopicAttributes",
        "sns:ListSubscriptionsByTopic",
        "sns:Subscribe"
      ],
      "Resource": "*"
    }
  ]
}
```

Use the same Region throughout. SES identities, sandbox status, quotas,
configuration sets, and the SNS topic are Region-specific.

## 2. Run the Together wizard

1. Save the sender name, sender address, identity, legal name, and footer
   address. Use the sending domain as the identity, for example `example.com`.
2. Select **Create domain identity**. Add all three CNAME rows shown by Together
   at the DNS provider. Keep the full names and targets; some DNS panels append
   the zone automatically.
3. If a domain cannot be changed, use **Use e-mail identity instead**. AWS sends
   a verification message to that exact address. This fallback does not provide
   domain-level DKIM control and is not recommended for sustained sending.
4. Select **Create SES + SNS infrastructure**. This repeat-safe step creates:
   the SES configuration set; an SNS topic and SES publish policy; the HTTPS
   subscription to `/api/webhooks/ses/:token`; and the SES event destination
   for Send, Delivery, Bounce, Complaint, Open, and Click. Together attaches
   the configuration set to every tenant SES send. Open/click events are stored
   only when the tenant enables engagement tracking.
5. Select **Poll AWS status**. Once SNS confirms the subscription, Together
   disables identity feedback forwarding so bounce and complaint handling stays
   on the authenticated SNS path. If AWS later reports that the identity or
   DKIM is no longer verified, the checklist regresses and broadcasts stop.
6. Select **Send bounce simulator test**. Together sends through SES to
   `bounce@simulator.amazonses.com`. The signed event must return through the
   tenant SNS topic before the webhook checklist item completes. AWS documents
   that simulator addresses work in the sandbox and do not enter the SES
   suppression list.

Every step can be retried. Completed resource identifiers are saved after each
successful step, so a later AWS error does not force the wizard to restart.

References: [SES mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html),
[configuration sets](https://docs.aws.amazon.com/ses/latest/dg/creating-configuration-sets.html).

## 3. Request SES production access

New SES accounts start in a Region-specific sandbox: recipients must be
verified and the account can send at most 200 messages per 24 hours. Verify the
domain first; AWS says this can make review and activation faster.

1. Open the [Amazon SES console](https://console.aws.amazon.com/ses/) in the
   Region saved in Together.
2. Open **Account dashboard**.
3. In the sandbox warning, select **View Get set up page**, then
   **Request production access**.
4. Choose **Marketing** if this tenant will send campaigns. Choose
   **Transactional** only if it will never send marketing through this account.
5. Enter the public website URL, operational contact addresses, preferred
   language, and acknowledge the AWS anti-abuse terms.
6. Paste the appropriate answers below into the use-case description. Replace
   every value in square brackets and make the stated volume realistic.
7. Submit the request. Monitor the contact addresses and answer any follow-up
   from AWS. Return to Together and poll again after approval.

Current AWS flow and sandbox limits:
[Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

### Ready-to-paste answer: marketing and transactional

```text
[ORGANIZATION LEGAL NAME] operates [WEBSITE URL] and uses Amazon SES for
one-to-one transactional messages triggered by user actions (sign-in links,
password resets, purchase receipts, and access notifications) and for marketing
messages only when the recipient has an active, specific e-mail marketing
consent.

Marketing consent is optional and never preselected. Together stores the exact
consent-definition version, linked document version, timestamp, and evidence.
Double opt-in is enabled per consent definition and is our default for new
definitions. Purchased, rented, scraped, and third-party lists are not used.

Together checks the current consent and tenant suppression list immediately
before every marketing send. Recipient addresses in suppression storage are
represented by a tenant-keyed HMAC. A signed Amazon SNS event for a permanent
bounce or complaint creates a suppression that blocks later sends. Soft bounces
are classified and monitored. The SNS topic is tenant-specific and the webhook
accepts only signed messages from that configured topic.

Every marketing message contains a visible preference link and the RFC 8058
List-Unsubscribe and List-Unsubscribe-Post one-click headers. Unsubscribe
requests are idempotent and enforced before future sends.

Together reads GetSendQuota for this AWS account and Region and throttles sends
against the SES per-second and 24-hour quotas. We will begin at approximately
[INITIAL MESSAGES] messages per day and expect to grow gradually to
[EXPECTED MESSAGES] messages per day. We monitor delivery, bounce, and complaint
events and will pause problematic campaigns while investigating address quality
or consent.
```

### Ready-to-paste answer: transactional only

```text
[ORGANIZATION LEGAL NAME] operates [WEBSITE URL] and uses Amazon SES only for
one-to-one transactional messages triggered by a user's action: sign-in links,
password resets, purchase receipts, and access notifications. We do not use
this SES account for purchased, rented, scraped, or unsolicited lists.

Together receives signed Delivery, Bounce, and Complaint events through a
tenant-specific Amazon SNS topic. Permanent bounces and complaints create a
tenant-keyed HMAC suppression that blocks later sends to the affected address.
Together reads GetSendQuota and throttles dispatch against the account's
per-second and 24-hour quotas. We expect approximately [INITIAL MESSAGES]
messages per day initially and [EXPECTED MESSAGES] messages per day after
growth.
```

These answers describe the implemented Together controls; do not claim a
volume, consent source, or website that does not match the tenant's operation.

## 4. Free SMTP options for transactional mail

SMTP in Together is only a layer-3 escape hatch for transactional messages.
Together records that the relay accepted the message, but it cannot correlate
later delivery, bounce, or complaint events. Marketing always requires the
tenant's verified SES account.

### Personal Gmail or Google Workspace

Enable two-step verification, create a Google app password, then enter:

- host `smtp.gmail.com`;
- port `465` with secure TLS enabled, or port `587` with secure TLS disabled so
  the connection upgrades with STARTTLS;
- user: the full Gmail address;
- password: the 16-character app password, not the account password.

A consumer Gmail account is approximately limited to 500 outgoing messages or
recipients per day. A paid Workspace user's ordinary Gmail/SMTP limit is
approximately 2,000 messages per day; trial accounts are lower. Workspace's
administrator-managed `smtp-relay.gmail.com` has separate configuration and
limits and is not the app-password setup above.

This works for low-volume tests and occasional notifications, but it is not
recommended for production deliverability. Google can temporarily block
sending after limit, bounce, or abuse signals, and a personal mailbox does not
give Together delivery/bounce telemetry.

References: [Google app passwords](https://support.google.com/accounts/answer/185833),
[consumer Gmail limits](https://support.google.com/mail/answer/22839),
[Workspace Gmail limits](https://support.google.com/a/answer/166852).

### Mailjet free SMTP relay

Mailjet's current free plan allows 6,000 messages per month with a limit of 200
per day and supports SMTP relay without a card. Verify the sender/domain, then
use:

- host `in-v3.mailjet.com`;
- port `465` with secure TLS, or `587` with STARTTLS;
- user: Mailjet API key;
- password: Mailjet secret key.

Mailjet permits transactional mail but requires consent for marketing, forbids
purchased/scraped lists, and applies its anti-abuse and deliverability policy.
Free-plan terms and limits can change, so verify them before relying on the
service.

References: [Mailjet free-plan limit](https://documentation.mailjet.com/hc/en-us/articles/360043048393-What-is-this-200-emails-per-day-limit-on-free-accounts),
[SMTP setup](https://documentation.mailjet.com/hc/en-us/articles/360043229473-How-can-I-configure-my-SMTP-parameters),
[compliance guide](https://documentation.mailjet.com/hc/en-us/articles/360043503313-Mailjet-Compliance-and-Email-Deliverability-Guide).
