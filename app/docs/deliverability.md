# Transactional e-mail deliverability

Together records transport acceptance for every successful transactional send. Later provider
feedback depends on the selected transport.

| Transport | Feedback available to Together | Operational meaning |
|---|---|---|
| Tenant SES | Delivery, permanent and transient bounce, and complaint events through the non-engagement transactional configuration set and signed SNS webhook | Reputation reports and automated reactions reflect the SES event stream without open pixels or click redirects. |
| Tenant SMTP | Relay acceptance only | SMTP supplies no asynchronous delivery, bounce, or complaint feed. Reputation numbers under-report failures. |
| Tenant Resend | API acceptance and the returned message id only | Together does not consume Resend webhooks, so bounce and complaint handling stays in the Resend dashboard. |
| Platform pool | Pool-level acceptance and only the feedback exposed by the platform transport | Results describe the shared fallback pool rather than a tenant-owned sender identity. |

Permanent bounces and complaints received from tenant SES create a tenant suppression keyed by the
recipient address. This protects later marketing sends but does not silently block transactional
messages such as password resets or invoices.

Reputation dashboards and automatic campaign pausing are meaningful only for tenant SES traffic with
a working configuration-set event destination. SMTP and Resend operators must monitor reputation and
failed delivery through their provider.

Transactional sends pick the first configured transport in the order tenant SES, tenant SMTP, tenant
Resend, platform pool. The panel tests each transport with the same diagnostic and delivers a test
message to the signed-in creator's address.
