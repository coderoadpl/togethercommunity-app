# Marketing automation API

Together supplies the delivery and compliance boundary for marketing e-mail while n8n, Make, or another automation tool decides when to send. Every API send uses the same consent, suppression, unsubscribe, footer, SES, and send-log pipeline as a campaign created in the panel.

This guide uses `https://acme.together.app` as the tenant base URL. Replace it with your tenant domain. JSON examples are abbreviated only where a value is tenant-specific.

## Before you start

You need:

- a tenant API key;
- at least one active optional marketing consent definition;
- the tenant's own verified Amazon SES identity and credentials;
- a verified SES event webhook, legal sender name, and sender address configured in Together;

Together is BYO SES: marketing messages are sent through each tenant's Amazon SES account. Tenant transactional mail may also select that account before its SMTP and platform-pool fallbacks, but marketing never uses those fallbacks. Together injects the legal footer, unsubscribe link, RFC 8058 headers, and bulk-mail headers. An API caller cannot remove them.

### SES onboarding and optional tracking

Complete the M19 checklist in the sending-settings panel before enabling broadcasts:

1. Verify the sending identity and DKIM in the same AWS Region as the tenant SES credentials.
2. Create an SNS topic in that Region and subscribe the Together webhook URL shown in the panel. Copy the topic ARN into the tenant settings and allow SES to publish to the topic.
3. In the Amazon SES console, open **Configuration → Configuration sets**, select the tenant configuration set, open **Event destinations**, and choose **Add destination**. Enable event publishing, select **Delivery**, **Bounce**, and **Complaint**, choose **Amazon SNS** as the destination, and select the tenant SNS topic. AWS documents the current console flow in [Creating Amazon SES event destinations](https://docs.aws.amazon.com/ses/latest/dg/event-destinations-manage.html) and the required SNS topic policy in [Set up an Amazon SNS event destination](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html).
4. Save the configuration-set name in Together. Together attaches this configuration set to every marketing send so delivery, bounce, and complaint processing remains active whether engagement tracking is on or off. Then use the SES mailbox simulator bounce and complaint addresses to verify that the SNS webhook completes a round trip.
5. Fill in the tenant legal sender name and postal or electronic address.

#### Open and click events

Open/click tracking is off by default. To enable it, edit the same SES event destination and additionally publish **Open** and **Click**, then turn on **Track marketing opens and clicks** in Together. The tenant is the data controller and must update its privacy notice before enabling tracking. Together acknowledges but does not store Open or Click records while the toggle is off. Transactional and test messages never receive the configuration set and are never open/click tracked.

## Authentication and response envelope

Send the tenant API key in every request:

```http
x-api-key: replace-with-api-key
```

The tenant is resolved from the request host. Local and non-browser integrations may also select it with `x-tenant`, but production automations should call the tenant domain.

Successful JSON responses use:

```json
{
  "ok": true,
  "data": {}
}
```

Errors use:

```json
{
  "ok": false,
  "error": {
    "code": "validation",
    "message": "Invalid marketing messages payload",
    "details": {}
  }
}
```

Missing or invalid keys return `401 unauthorized`. IDs, e-mail addresses, and cursors are always scoped to the tenant selected by the host.

## Eligibility pre-flight

Check eligibility before a delayed step. This keeps a normal unsubscribe or pending confirmation on the successful branch of your automation. The send endpoint checks eligibility again immediately before delivery, so the pre-flight is an optimization rather than an authorization token.

```bash
curl --get 'https://acme.together.app/api/m2m/marketing/eligibility' \
  --header 'x-api-key: replace-with-api-key' \
  --data-urlencode 'email=ala@example.com' \
  --data-urlencode 'definitionId=cd_newsletter'
```

`definitionId` is optional. When omitted, Together selects the first active optional marketing consent definition. Supply it whenever the tenant has more than one marketing purpose.

Eligible response:

```json
{
  "ok": true,
  "data": {
    "eligible": true,
    "reasons": [],
    "consent": {
      "definitionId": "cd_newsletter",
      "status": "active",
      "since": "2026-07-22T08:30:00.000Z"
    }
  }
}
```

Ineligible response:

```json
{
  "ok": true,
  "data": {
    "eligible": false,
    "reasons": ["pending_confirmation"],
    "consent": {
      "definitionId": "cd_newsletter",
      "status": "pending_confirmation",
      "since": "2026-07-22T08:30:00.000Z"
    }
  }
}
```

If no consent row exists, `consent` is `null`. An unknown `definitionId` returns `404 not_found`; omitting it when no active marketing definition exists returns `400 validation`.

## Send messages

`POST /api/m2m/marketing/messages` accepts either one message directly or `{ "messages": [...] }` with 1–50 messages. A message must use exactly one of `templateId` and `bodyHtml`. Inline HTML also requires `subject`.

Template send:

```bash
curl 'https://acme.together.app/api/m2m/marketing/messages' \
  --request POST \
  --header 'content-type: application/json' \
  --header 'x-api-key: replace-with-api-key' \
  --header 'Idempotency-Key: welcome-ord_8f12' \
  --data '{
    "to": "ala@example.com",
    "consentDefinitionId": "cd_newsletter",
    "templateId": "tpl_welcome",
    "data": {
      "firstName": "Ala",
      "offerUrl": "https://acme.example/offers/summer"
    },
    "campaignKey": "welcome-series",
    "subject": "A subject override"
  }'
```

Inline send:

```bash
curl 'https://acme.together.app/api/m2m/marketing/messages' \
  --request POST \
  --header 'content-type: application/json' \
  --header 'x-api-key: replace-with-api-key' \
  --header 'Idempotency-Key: tips-ord_8f12' \
  --data '{
    "to": "ala@example.com",
    "consentDefinitionId": "cd_newsletter",
    "subject": "Three ways to get started",
    "bodyHtml": "<h1>Hello {{firstName}}</h1><p>Here are your next steps.</p>",
    "data": { "firstName": "Ala" },
    "campaignKey": "post-purchase-course_42"
  }'
```

Accepted response (`202`):

```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "to": "ala@example.com",
        "sendId": "send_01J3W2",
        "status": "queued"
      }
    ]
  }
}
```

The call completes the SES hand-off before returning, but the public result calls a successful item `queued`. Delivery, bounce, and complaint status arrives later through SES and is visible through the message-read endpoints.

A batch is not atomic. Ineligible recipients remain inside the `202` response:

```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "to": "withdrawn@example.com",
        "sendId": "send_01J3W3",
        "status": "skipped",
        "reason": "unsubscribed"
      },
      {
        "to": "new@example.com",
        "sendId": null,
        "status": "skipped",
        "reason": "not_consented"
      }
    ]
  }
}
```

Other per-item results are `failed`, with an `error` object, and `deduplicated`, with `sendId: null`. Treat `skipped` and `deduplicated` as a successful automation outcome. Decide whether a `failed` item should retry based on its nested error code.

The free `data` object supplies template variables. `{{path}}` is HTML-escaped; `{{{path}}}` is raw. A nullish fallback such as `{{firstName ?? "there"}}` is supported. Together also supplies `member.email`, `tenant.name`, `tenant.legalName`, `tenant.address`, `brand.name`, `brand.identity`, and `unsubscribeUrl`. Unsupported expressions fail validation.

### Campaign grouping

`campaignKey` is optional and has a maximum length of 120 characters. For each distinct key, Together finds or creates a running API campaign named `API: <campaignKey>`. All sends with that key share its panel grouping and can be read back with the same `campaignKey` filter.

Use one stable key for the complete automation, such as `post-purchase-course_42`, and put the individual event and sequence step in `Idempotency-Key`. API campaigns do not deduplicate recipients: the same address can receive every step grouped under one campaign. `Idempotency-Key`, not `campaignKey`, prevents a retried step from sending twice.

Omitting `campaignKey` leaves the send ungrouped (`campaignId: null`). Ineligible ungrouped sends with no consent row may have no send-log row and therefore return `sendId: null`.

### Idempotency-Key

`Idempotency-Key` is optional and applies only to `POST /api/m2m/marketing/messages`.

- Together claims `(tenant, key)` before parsing or executing the request.
- A second use is refused with `409 conflict`; Together never replays the original response.
- The conflict includes the original `requestMethod`, `requestPath`, SHA-256 `requestHash`, and `claimedAt` timestamp.
- A claim from the current request is released when that request ends in `4xx`, including validation and throttling, so a corrected request may reuse the key. The `409` returned for an already-claimed key does not release the original claim.
- A claim is retained after `2xx` or `5xx` and expires after 24 hours.
- Concurrent requests with the same key have one winner.

```json
{
  "ok": false,
  "error": {
    "code": "conflict",
    "message": "Idempotency key was already used",
    "details": {
      "requestMethod": "POST",
      "requestPath": "/api/m2m/marketing/messages",
      "requestHash": "8a2a...",
      "claimedAt": "2026-07-22T09:00:00.000Z"
    }
  }
}
```

Generate keys from immutable business identifiers and the sequence step, for example `drip3-ord_8f12`. Do not use the current timestamp.

### Throttling

Before dispatch, Together compares the number of messages in the request with the tenant's cached SES per-second quota, rounded down with a minimum budget of one. A larger batch returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1
```

```json
{
  "ok": false,
  "error": {
    "code": "rate_limited",
    "message": "Tenant SES throttle budget is exhausted"
  }
}
```

Wait for the integer number of seconds in `Retry-After`, then retry. Because `429` releases the idempotency claim, reuse the same key. Split larger audiences into batches no larger than the current tenant allowance; the API maximum remains 50.

## Record consent

`POST /api/m2m/marketing/consents` never infers consent. Evidence is mandatory and the definition must be active, optional marketing, and have a wording version.

```bash
curl 'https://acme.together.app/api/m2m/marketing/consents' \
  --request POST \
  --header 'content-type: application/json' \
  --header 'x-api-key: replace-with-api-key' \
  --data '{
    "email": "ala@example.com",
    "memberId": null,
    "definitionId": "cd_newsletter",
    "collectedAt": "2026-07-22T08:30:00.000Z",
    "source": "api",
    "proofRef": "checkout-form-v4/order-8f12",
    "ip": "203.0.113.8",
    "userAgent": "Mozilla/5.0"
  }'
```

`memberId` defaults to `null`; `source` defaults to `api` and may be `checkout`, `panel`, `import`, `api`, or `preference_page`. `collectedAt` must be an ISO 8601 timestamp and `proofRef` must be non-empty. `ip` and `userAgent` are optional.

Response (`201`), with record fields abbreviated:

```json
{
  "ok": true,
  "data": {
    "consent": {
      "id": "consent_01J3W0",
      "tenantId": "tenant_acme",
      "memberId": null,
      "email": "ala@example.com",
      "definitionId": "cd_newsletter",
      "definitionVersion": 4,
      "wordingSnapshot": "I want to receive product news by e-mail.",
      "documentRefSnapshot": {
        "mode": "url",
        "url": "https://acme.example/privacy?v=4"
      },
      "status": "granted",
      "previousId": null,
      "source": "api",
      "evidence": {
        "collectedAt": "2026-07-22T08:30:00.000Z",
        "proofRef": "checkout-form-v4/order-8f12"
      },
      "occurredAt": "2026-07-22T08:30:00.000Z"
    },
    "state": "pending_confirmation"
  }
}
```

For double opt-in, Together queues the transactional confirmation e-mail and returns `pending_confirmation`; no marketing send is eligible until the recipient confirms. The e-mail link opens a tenant-branded confirmation page without changing consent. The recipient must submit the confirmation button, which sends `POST /marketing/confirm/:token`; repeated submissions are safe, while invalid or expired tokens show the expired state. Without double opt-in, the response state is `active`. Recording consent has no `Idempotency-Key` support, so deduplicate source events in your automation.

## Suppressions

### Read suppressions

```bash
curl --get 'https://acme.together.app/api/m2m/marketing/suppressions' \
  --header 'x-api-key: replace-with-api-key' \
  --data-urlencode 'email=ala@example.com' \
  --data-urlencode 'limit=50'
```

All query parameters are optional. `limit` defaults to 50 and accepts 1–100. Pass `nextCursor` back as `cursor` to read the next page.

```json
{
  "ok": true,
  "data": {
    "suppressions": [
      {
        "id": "sup_01J3W4",
        "tenantId": "tenant_acme",
        "email": "ala@example.com",
        "emailHmac": "5d2f...",
        "reason": "manual",
        "sourceRef": "support-ticket-481",
        "meta": null,
        "createdAt": "2026-07-22T09:15:00.000Z",
        "liftedAt": null,
        "liftedBy": null
      }
    ],
    "nextCursor": null
  }
}
```

Rows may also have `hard_bounce`, `complaint`, `unsubscribe_global`, or `erasure` reasons. An erased address may be `null`. This API has no delete or lift operation.

### Add a manual suppression

```bash
curl 'https://acme.together.app/api/m2m/marketing/suppressions' \
  --request POST \
  --header 'content-type: application/json' \
  --header 'x-api-key: replace-with-api-key' \
  --data '{
    "email": "ala@example.com",
    "reason": "manual",
    "sourceRef": "support-ticket-481"
  }'
```

`reason` must be exactly `manual`; `sourceRef` defaults to `null`. The `201` response contains the suppression row shown above. Repeating the call while an active suppression exists returns that existing row.

## Read send status

### List messages

```bash
curl --get 'https://acme.together.app/api/m2m/marketing/messages' \
  --header 'x-api-key: replace-with-api-key' \
  --data-urlencode 'campaignKey=welcome-series' \
  --data-urlencode 'email=ala@example.com' \
  --data-urlencode 'status=sent' \
  --data-urlencode 'limit=50'
```

All filters are optional. `status` is one of `pending`, `sending`, `sent`, `failed`, or `skipped`. `limit` defaults to 50 and accepts 1–100. Pagination is ascending by opaque send ID; pass `nextCursor` as `cursor`. An unknown `campaignKey` returns an empty page.

```json
{
  "ok": true,
  "data": {
    "sends": [
      {
        "id": "send_01J3W2",
        "tenantId": "tenant_acme",
        "campaignId": "campaign_01J3VZ",
        "source": "api",
        "memberId": null,
        "email": "ala@example.com",
        "consentRowId": "consent_01J3W0",
        "unsubscribeTokenId": "unsub_01J3W1",
        "status": "sent",
        "skipReason": null,
        "sesMessageId": "010201...",
        "deliveryStatus": "delivered",
        "deliveryOccurredAt": "2026-07-22T09:01:04.000Z",
        "idempotencySource": "welcome-ord_8f12",
        "renderedBodyPurgedAt": null,
        "createdAt": "2026-07-22T09:00:00.000Z",
        "sentAt": "2026-07-22T09:00:01.000Z"
      }
    ],
    "nextCursor": null
  }
}
```

`deliveryStatus` is `delivered`, `bounced`, `complained`, or `null` while no SES delivery event has been correlated.

### Get one message

```bash
curl 'https://acme.together.app/api/m2m/marketing/messages/send_01J3W2' \
  --header 'x-api-key: replace-with-api-key'
```

The `200` response contains the send projection and its immutable event history:

```json
{
  "ok": true,
  "data": {
    "id": "send_01J3W2",
    "status": "sent",
    "deliveryStatus": "delivered",
    "events": [
      {
        "id": "event_01J3W4",
        "type": "opened",
        "occurredAt": "2026-07-22T09:03:00.000Z",
        "meta": {
          "rawProviderPayload": {}
        }
      },
      {
        "id": "event_01J3W5",
        "type": "clicked",
        "occurredAt": "2026-07-22T09:04:00.000Z",
        "meta": {
          "linkUrl": "https://acme.example/offers/summer",
          "rawProviderPayload": {}
        }
      }
    ]
  }
}
```

The `events[]` array is ordered by occurrence time and includes lifecycle events such as `queued`, `accepted`, `delivered`, `bounced`, and `complained`. When tenant tracking is enabled, it also includes `opened` and `clicked`; click metadata contains the link URL reported by SES. Repeated opens and clicks remain separate events so callers can calculate total activity, while the campaign panel also shows unique-per-send counts. An unknown message ID returns `404 not_found`.

## Open and click events

Together does not host a tracking pixel or redirector. Amazon SES performs engagement tracking through the tenant configuration set and publishes `Open` and `Click` records to the existing tenant SNS topic. Together correlates them using the SES MessageId already stored on the send log.

Stray valid records from the tenant-authorized SNS topic are acknowledged even when no local MessageId matches, preventing retry storms. Enabling or disabling tracking changes future marketing sends only; events already authorized and published by the tenant are retained in the append-only event history.

## List templates and layouts

```bash
curl 'https://acme.together.app/api/m2m/marketing/templates' \
  --header 'x-api-key: replace-with-api-key'
```

```json
{
  "ok": true,
  "data": {
    "templates": [
      {
        "id": "tpl_welcome",
        "name": "Welcome message",
        "subject": "Welcome, {{firstName ?? \"there\"}}"
      }
    ],
    "layouts": [
      {
        "id": "layout_default",
        "name": "Default brand layout"
      }
    ]
  }
}
```

The endpoint exposes draft and scheduled campaigns as send templates. Pass a template `id` as `templateId`; layouts are listed for discovery but the automation send body does not accept a layout ID directly.

## Machine-readable refusal reasons

| Code | Where it appears | Meaning | Automation action |
|---|---|---|---|
| `not_consented` | `results[].reason`, eligibility `reasons[]` | No active consent row exists for this definition. | Skip. Record explicit consent only if your source captured valid evidence. |
| `suppressed` | `results[].reason`, eligibility `reasons[]` | An active tenant suppression exists. Suppression wins over consent. | Skip permanently unless staff resolves a liftable suppression. |
| `unsubscribed` | `results[].reason`, eligibility `reasons[]` | The latest consent state is withdrawn. | Skip. Do not silently re-consent. |
| `pending_confirmation` | `results[].reason`, eligibility `reasons[]` | Double opt-in was requested but not confirmed. | Skip now; retry the eligibility check only after confirmation. |
| `ses_not_configured` | top-level `412` error | Tenant SES settings or credentials are absent. | Stop the scenario and ask the tenant owner to finish SES setup. |
| `broadcasts_disabled` | top-level `412` error | The SES identity, webhook, footer, or sandbox readiness gate is incomplete. | Stop the scenario and finish onboarding in the panel. |
| `validation` | top-level `400` or nested failed item | Request, template, definition, or rendered footer validation failed. | Fix data or configuration; do not retry unchanged. |
| `rate_limited` | top-level `429` error | The request exceeds the cached SES per-second allowance. | Wait for `Retry-After`, then retry with the same idempotency key. |

The four M30 recipient reasons are data, not transport failures. A send request containing them still returns `202`; branch on every item in `data.results`.

## Recommended automation pattern

1. Read a purchase, signup, or other event from your own system.
2. If the event includes a newly captured consent, record it once with its evidence.
3. Check eligibility with the exact `definitionId` used by the series.
4. End successfully when `eligible` is false.
5. Send with a series-specific `campaignKey` and an event-and-step `Idempotency-Key`.
6. After every multi-day wait, check eligibility again.
7. Treat `skipped` and `deduplicated` items as successful completion.
8. Retry `429` after `Retry-After`; alert on setup errors and unchanged validation errors.
9. Poll the message endpoint if downstream logic needs SES delivery status.

Ready-made starting points:

- [n8n post-purchase drip](examples/n8n-post-purchase-drip.json)
- [Make welcome-series setup](examples/make-welcome-series.md)
- [Make welcome-series blueprint bundle](examples/make-welcome-series-blueprint.json)
