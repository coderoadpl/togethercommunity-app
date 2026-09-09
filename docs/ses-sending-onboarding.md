# E-mail sending setup

The current guide is [SES onboarding for Together](ses-onboarding.md).

## Leaving the Amazon SES sandbox

Sandbox status is separate for each AWS Region. Verify your domain and DKIM in
the same region configured in Together, then:

1. Open Amazon SES → **Account dashboard** → **Request production access**.
2. Choose **Marketing** for campaigns, or **Transactional** if the account will
   send only messages triggered by user actions.
3. Enter your public website URL and contact addresses.
4. Confirm that recipients requested your messages and that you handle bounces
   and complaints.
5. Submit the application. AWS typically sends its first reply within 24 hours.

Official guide: [Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

### Sample use-case description

Replace the bracketed placeholders with your organization's details:

> [NAME] uses Amazon SES for one-to-one transactional messages triggered by
> user actions (sign-in links, password resets, purchase and access
> notifications) and for marketing messages only where the recipient has an
> active, specific e-mail marketing consent. Marketing consent is optional and
> not preselected. Definitions and wording versions are stored with timestamped
> evidence; double opt-in can be required. Every marketing message includes an
> unsubscribe mechanism. Together checks consent and the tenant suppression
> list again immediately before sending. Permanent bounces and complaints are
> written to the suppression list; future sends to suppressed recipients are
> blocked. SES delivery, bounce, and complaint events are received through an
> authenticated SNS endpoint and retained in the tenant-scoped event history.
> We do not use purchased, rented, or scraped lists. Expected initial volume is
> [NUMBER] messages per day, growing to [NUMBER] per day.

Before applying, complete the Together checklist: identity and DKIM,
configuration set, SNS webhook test, and footer details.

## Free SMTP options for transactional messages

Together uses SMTP only for transactional messages. The panel records relay
acceptance without subsequent delivery, bounce, or complaint correlation.
Marketing campaigns never use SMTP.

### Personal Gmail

Enable two-step verification, create a 16-character app password, and configure:

- host: `smtp.gmail.com`;
- port: `465` with TLS, or `587` with STARTTLS;
- username: your full Gmail address;
- password: the app password, not your account password.

Google requires two-step verification for app passwords and does not recommend
them as an integration method. Consumer accounts may be blocked after roughly
500 messages or recipients per day. Paid Workspace accounts have different
limits, typically up to 2,000 messages per day for ordinary sending. This works
at small scale but is not recommended because of deliverability and temporary
account-blocking risks.

Sources: [Google App Passwords](https://support.google.com/accounts/answer/185833),
[Gmail limits](https://support.google.com/mail/answer/22839),
[Workspace sending limits](https://support.google.com/a/answer/166852).

### Brevo or Mailjet

- Brevo: the free plan includes 300 sends per day.
- Mailjet: the free plan includes 6,000 sends per month, up to 200 per day.

Both provide SMTP credentials. Plan limits and terms can change; check them
before connecting:
[Brevo Free plan](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan),
[Mailjet Free plan](https://documentation.mailjet.com/hc/en-us/articles/8625025643803-Mailjet-Subscription-Management).

## Summary

Verify the SES domain and DKIM in the selected AWS Region, request production
access from the SES account dashboard, and use the sample use-case statement
above. Complete the Together checklist for the configuration set, SNS round-trip,
and footer. SMTP is a transactional-only fallback with relay-acceptance tracking;
marketing always requires the tenant's verified SES identity.
