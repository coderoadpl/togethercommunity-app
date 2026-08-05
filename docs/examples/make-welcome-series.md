# Make welcome series

This recipe uses two Make scenarios because a multi-day Sleep module is not durable enough for a welcome series. Scenario 1 accepts the enrollment, records explicit consent evidence, sends message 1 only when eligible, and stores the next due time. Scenario 2 runs hourly, finds due records, checks eligibility again, and sends message 2.

The accompanying [blueprint bundle](make-welcome-series-blueprint.json) contains both scenario blueprints. Make imports one scenario per blueprint, so copy each `scenarios[].blueprint` object into its own JSON file before choosing **Scenarios → Create a new scenario → Import Blueprint**. For example:

```bash
jq '.scenarios[0].blueprint' make-welcome-series-blueprint.json > welcome-enroll.json
jq '.scenarios[1].blueprint' make-welcome-series-blueprint.json > welcome-follow-up.json
```

## Prerequisites

Create these in Together:

- an API key;
- an active optional marketing consent definition, noted below as `cd_newsletter`;
- draft or scheduled templates `tpl_welcome_1` and `tpl_welcome_2`;
- complete BYO SES onboarding.

Create a Make Data store named `together_welcome_series` with:

| Field | Type | Purpose |
|---|---|---|
| record key | text | normalized recipient e-mail |
| `email` | text | recipient e-mail |
| `firstName` | text | template data |
| `stage` | text | `1`, `done`, or `done-skipped` |
| `dueAt` | date | time at which message 2 becomes due |

After import, reconnect the webhook and Data store modules because Make assigns connection-specific IDs during import. Replace every `https://acme.example.com`, `replace-with-api-key`, definition ID, and template ID. Store the API key in a Make secure connection or secret variable before enabling the scenarios; the literal placeholder exists only so the blueprint imports without exporting a credential.

## Scenario 1: enroll and send message 1

The custom webhook expects:

```json
{
  "email": "ala@example.com",
  "firstName": "Ala",
  "memberId": null,
  "collectedAt": "2026-07-22T08:30:00.000Z",
  "proofRef": "signup-form-v4/submission-819"
}
```

The modules do the following:

1. **Webhooks / Custom webhook** receives the signup or checkout event. A polling source can replace this module on a 15-minute schedule.
2. **HTTP / Make a request** posts the consent with `definitionId`, `collectedAt`, `source: api`, and `proofRef`. Together sends the confirmation mail itself when double opt-in is enabled.
3. **HTTP / Make a request** checks eligibility for the same e-mail and definition.
4. **Router** passes only `data.eligible = true`.
5. **HTTP / Make a request** sends `tpl_welcome_1`, using `campaignKey: welcome-series` and `Idempotency-Key: w1-<normalized-email>`.
6. **Data store / Add or replace a record** stores `stage = 1` and `dueAt = addDays(now; 2)`.

If double opt-in is enabled, the first webhook run normally ends at the eligibility filter with `pending_confirmation`. Re-submit or poll the enrollment after the recipient confirms; the API send gate still makes repeated or premature runs safe. Do not treat a pending confirmation as consent to mail.

## Scenario 2: send message 2

Schedule this scenario every hour. Its modules:

1. **Data store / Search records** selects `stage = 1` and `dueAt <= now`.
2. **Iterator** processes each due record.
3. **HTTP / Make a request** checks eligibility again so a late unsubscribe wins.
4. **Router** sends ineligible records to **Data store / Update a record** with `stage = done-skipped`.
5. The eligible route sends `tpl_welcome_2` with the same `campaignKey: welcome-series` and `Idempotency-Key: w2-<normalized-email>`. The campaign key groups both steps; the separate idempotency key protects the second step from retries.
6. **Data store / Update a record** sets `stage = done`.

Configure each send request to expose the response body. A `202` can contain `status: skipped`; treat that result as completed rather than retrying it. Retry `429` only after its `Retry-After` delay. Route `ses_not_configured`, `broadcasts_disabled`, and persistent validation errors to an operator alert.

## Test before activation

1. Use an address with no consent and confirm Scenario 1 does not send or create a due record.
2. Submit consent with evidence. If double opt-in is enabled, confirm the e-mail, then invoke the source again.
3. Confirm message 1 appears under `API: welcome-series` in Together and the Data store row has `stage = 1` with a due time two days ahead.
4. Temporarily set `dueAt` in the past and run Scenario 2 once.
5. Withdraw consent before a second test and confirm the record becomes `done-skipped` without an e-mail.
6. Repeat the same source event and verify the stable idempotency keys do not create a second recipient send.
