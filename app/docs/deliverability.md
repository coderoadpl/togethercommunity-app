# E-mail deliverability

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

## Marketing message bodies and replies

Campaigns have an optional plaintext editor field (`bodyText`). Leaving it unset generates text
from parsed HTML, preserving paragraph and list boundaries, decoded entities, and link
URLs. Both authored and generated text receive the legal name, postal address, consent wording,
and absolute unsubscribe URL. The same renderer serves broadcasts, M2M sends and test-to-self.
SES receives a UTF-8 `multipart/alternative` message with plaintext and HTML parts.

Reply-To resolves from the message/campaign override, then tenant SES settings, then the sender
address. It is a single validated mailbox; CR/LF and caller attempts to replace mandatory marketing
headers are rejected or excluded. The tenant setting also reaches every transactional SES message,
including consent confirmations. A transactional message may explicitly override Reply-To.

## Durable dispatch and feedback

M2M HTTP 202 means the send receipt, unsubscribe token and final payload have committed to the
marketing outbox. A scheduled campaign advances its member cursor in that same transaction.
The dispatcher claims one row at a time, paces it, then checks campaign state, current consent,
suppression, SES readiness and shared tenant quota before submitting to SES. Suppressions committed
before that final check prevent marketing delivery; an already submitted message cannot be recalled.
Transactional password resets, invoices and other service messages retain their existing policy.

Pending and explicitly throttled requests can be retried under a fenced lease. The worker persists
`dispatching` before calling SES and disables opaque SDK retries. An expired dispatch lease or an
ambiguous transport failure becomes `uncertain`; it is never automatically resent. Signed provider
feedback can reconcile that state through the stable `together-send-id` SES tag. Unresolved acceptance
keeps a broadcast unfinished. API campaign keys remain reusable across separate automation steps.

The SNS webhook verifies the signature and topic binding, commits the exact raw envelope and its
SHA-256 hash, and only then returns 200. Receipt identity is `(tenant, topic ARN, verified SNS MessageId)`.
Duplicates retain the original receipt; conflicting bodies return 409. Storage failures return 5xx,
allowing SNS redelivery. Unsupported verified payloads are durably ignored with a reason.

Workers process receipts before bulk sends. Feedback projection changes, suppression creation and
receipt completion commit together. Callback-before-send correlation retries with exponential
backoff capped at 15 minutes; unresolved receipts become dead letters after 24 hours. Replayed
receipts are audited, and duplicate delivery cannot apply the same receipt twice. Late delivery
feedback cannot overwrite a complaint or bounce. Only applied feedback (including the signed SES
bounce simulator probe) establishes webhook readiness.

Operator commands use the existing SES read/write permissions:

```sh
pnpm --silent run cli --tenant acme sns-inbox list
pnpm --silent run cli --tenant acme sns-inbox retry RECEIPT_ID
pnpm --silent run cli --json campaign dispatch --secret "$MARKETING_TICK_SECRET"
```

The last command runs one bounded global worker tick. Receipt listings omit raw message bodies.
Inspect unresolved acceptance and pre-outbox legacy recovery cases with tenant-scoped SQL:

```sql
SELECT s.id, s.status, o.status AS delivery_attempt_status
FROM campaign_sends s
LEFT JOIN marketing_outbox o ON o.tenant_id = s.tenant_id AND o.campaign_send_id = s.id
WHERE s.tenant_id = $1
  AND (o.status = 'uncertain' OR (o.id IS NULL AND s.status IN ('pending', 'sending')));
```

Legacy rows without payloads require operator investigation; the worker does not reconstruct or
resend them. The retention pass purges completed outbox bodies after
`MARKETING_RETENTION_RENDERED_BODIES_DAYS` and processed or ignored SNS raw envelopes after
`MARKETING_RETENTION_RAW_SNS_INBOX_DAYS`; both windows are configurable and default below.
Pending and uncertain payloads remain available for recovery.
Member erasure removes matching payloads immediately, fences active claims and preserves receipt
identities and audit events; unprocessed SNS envelopes containing that recipient become ignored.

## Cadence, budgets and throughput

`vercel.json` schedules `GET /api/internal/marketing/tick` every minute and allows 60 seconds of
function runtime. Configure the deployed scheduler to provide that cadence; hosting plans that
cannot run every minute need an external scheduler or a standalone worker. The endpoint uses
`CRON_SECRET` for cron bearer authentication or `MARKETING_TICK_SECRET` for operator dispatch.

| Setting | Default | Purpose |
|---|---:|---|
| `MARKETING_WORKER_SECONDS` | 55 | Global tick deadline, maximum 55 seconds |
| `MARKETING_SEND_SECONDS` | 50 | Campaign enumeration and sending window, maximum 50 seconds |
| `MARKETING_BATCH_CAP` | 1000 | Maximum recipients allocated to a batch |
| `MARKETING_WORKER_INTERVAL_MS` | 60000 | Standalone worker interval; hosted cadence is set in `vercel.json` |
| `MARKETING_RETENTION_RAW_SNS_INBOX_DAYS` | 7 | Raw SNS payload retention after processing or ignoring |
| `MARKETING_RETENTION_RENDERED_BODIES_DAYS` | 14 | Rendered campaign body and marketing outbox payload retention |
| `MARKETING_RETENTION_ENGAGEMENT_EVENTS_DAYS` | 30 | Open and click event metadata retention |
| `MARKETING_RETENTION_PENDING_CONSENTS_DAYS` | 30 | Unconfirmed double opt-in consent retention |
| `MARKETING_RETENTION_SCHEDULER_RUNS_DAYS` | 14 | Non-idle scheduler run retention |
| `MARKETING_RETENTION_SCHEDULER_IDLE_RUNS_DAYS` | 2 | Idle scheduler run retention |

SNS processing gets at most the first five seconds; bulk work shares the remaining global deadline
across campaigns and tenants. Retention and identity/reputation maintenance use the last completed
`marketing_maintenance` scheduler run to keep their 30-minute schedule. Overdue maintenance runs
before campaigns so bulk sending cannot consume its entire budget. The batch budget is `min(floor(0.9 × SES rate × send seconds), daily remaining, batch cap)`.
Delayed cron invocations still run overdue maintenance; failed or incomplete passes retry on the next tick.
Every transport attempt consumes the shared tenant limiter; transactional traffic reserves half the
marketing allocation when pending. Cached provider daily usage and local reservations constrain it
further. Database work and provider latency consume the window, so these are capacity estimates.

At 5 recipients/second, a 50-second window budgets 225 recipients: 3,000 recipients require 14 ticks
(about 14 minutes). At 14/second, the budget is 630 and requires five ticks. The fake-clock dispatcher
regression sends all 3,000 at 5/second, including a full minute of initial cron delay, five seconds
of overhead per tick, 100 ms provider latency per send and the 90% safety margin, within one hour.

At 1/second, minute cron budgets only 45 recipients per tick (67 ticks), so it does not meet the
one-hour target. Use a continuously polling standalone worker for that rate:

```sh
NODE_ENV=production MARKETING_WORKER_INTERVAL_MS=1000 pnpm run worker:marketing
```

This reuses server composition without starting an HTTP server. It waits only for the unused portion
of the configured interval; a busy tick can start the next tick immediately. At 90% of 1/second,
3,000 sends take about 56 minutes of send time. Lower SES quotas, sustained transactional load,
provider throttling or prolonged storage/network latency can extend completion. Configure SES daily
quota above the whole campaign plus expected transactional volume; sandbox limits cannot deliver
3,000 recipients in an hour.

### Contact campaign snapshots

List campaigns freeze selected contact membership and personalization when
scheduled. Each candidate receives a send projection, including skipped contacts
without consent. A durable payload, unsubscribe token and contact cursor commit
with each eligible send. The legacy member cursor remains available for version 1
campaigns. Version 2 dispatch additionally checks contact archival, erasure and
address consistency; later consent or suppression changes can remove eligibility
but cannot add a recipient to a frozen snapshot.

Campaign reports use the frozen snapshot count as the audience total and group
the send projection into waiting, sent, failed, skipped, delivered, bounced,
complained and unresolved-delivery counts. Waiting excludes sends whose provider
acceptance is uncertain.
The separate queued and unresolved acceptance counters come from indexed
send/outbox aggregates. Contact send history uses the same journal and events as
member campaigns. The synthetic end-to-end regression is
`scripts/marketing-contacts.e2e.test.ts`; it runs the real HTTP app, typed client,
CLI and PostgreSQL repositories with fake SES/clock boundaries and signed feedback.
