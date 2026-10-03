# Operator tenant provisioning

An instance operator can add a workspace after public tenant creation has closed.
Provisioning creates the tenant, one owner grant and a `tenant_provisioned` audit
event in one database transaction. It never creates a user account.

## Prerequisites

Use the CLI for the intended instance and an existing owner account with a verified
email address. The instance must have its operator secret configured. Supply the
matching value to the CLI through `OPERATOR_SECRET` in its process environment.
Do not put it in command arguments, shell history, tickets, logs or screenshots.
The commands have no secret option. Set `TOGETHER_CLI_API_URL` or pass `--api-url`
to select the intended API origin explicitly.

## Create the workspace

```bash
pnpm --silent run cli --api-url https://platform.example \
  --json operator tenant provision \
  --slug acme --name 'Acme' --owner-email owner@example.test --language en
```

`--language` accepts `en` or `pl` and defaults to English when omitted. Slugs use
the same length, character and reserved-name rules as ordinary tenant creation.
An unknown account and an unverified account produce the same validation error.
The response includes only the tenant ID, slug and name, `created`, the owner's
user ID and a readiness checklist. JSON uses the usual CLI envelope and exit codes.
Without `--json`, the CLI prints the checklist as `key=value` lines.

## Owner setup

The owner signs in to the new workspace and completes these steps:

1. In Settings, confirm the language, name and branding.
2. Set both terms and privacy URLs.
3. In Integrations, configure storage with a private bucket. Its CORS policy must
   allow the tenant's platform origin, including the correct scheme and port.
   Run the storage configuration probe and resolve any CORS errors.
4. In Integrations, configure Stripe with a restricted live key. The existing
   owner configuration flow registers the webhook and stores its registration
   evidence. Test mode is useful for testing but is not live payment readiness.
5. Publish at least one product when the workspace is ready for its audience.

Storage and Stripe credentials are **not accepted by the operator provisioning
route or commands**. The owner uses the panel or the existing `storage configure`
and `stripe configure` CLI commands after the tenant exists. These owner commands
retain their existing authentication and configuration contracts.

## Verify readiness

```bash
pnpm --silent run cli --api-url https://platform.example \
  --json operator tenant readiness --slug acme
```

| Field | Meaning |
|---|---|
| `tenantExists` | A tenant with this slug exists. |
| `ownerGrantPresent` | Exactly one owner grant exists. |
| `storageConfigured` | A stored storage configuration exists. |
| `lastProbeOk` | The latest persisted storage CORS results are nonempty, all successful, and no older than the stored configuration. |
| `lastProbeAt` | Timestamp of that persisted CORS evidence, or null. |
| `stripeConfigured` | Both restricted-key and webhook-secret records exist in a Stripe slot. |
| `mode` | `live` takes precedence when both slots are configured; otherwise `test`, or null. |
| `webhookEndpointRegistered` | The selected slot has a stored webhook endpoint registration ID. |
| `legalUrlsSet` | Both terms and privacy URLs are non-null. |
| `publishedProducts` | Number of published products. |

For live launch, all booleans should be true, `mode` should be `live`, and the
published product count should be positive. Storage and payment setup are optional
for provisioning itself. A missing tenant returns false booleans, null timestamps
and mode, and a zero product count.

Readiness reads persisted evidence only. It does not contact a provider or run a
new probe, cannot detect a webhook deleted outside the application, and does not
prove current bucket availability. Review the probe timestamp. Live Stripe
configurations created before endpoint IDs were retained need the owner to rerun
`stripe configure` to populate registration evidence. Do not invent a marker or
manually modify the database to make the checklist green.

## Security model

`POST /api/internal/tenants/provision` and
`GET /api/internal/tenants/:slug/readiness` require the same
`x-scheduler-operator-secret` header and constant-time comparison as neighboring
operator routes. Authentication happens before body parsing or database access.
Clients sending the operator secret refuse redirects so the header cannot be
forwarded to another origin.
Session owners, admins and members cannot obtain either operator capability.
These routes are absent from the public app and public route manifests. Like the
neighboring operator routes, they have no separate request-rate limiter.

`TENANT_CREATION` retains its existing open, bootstrap and closed behavior for
session users. Operator provisioning always creates through the transactional
tenant repository with `requireEmpty=false`. The audit identifies the operator
action, without storing the operator secret. Readiness exposes no credentials,
credential fragments, email addresses or customer records.

## Idempotency and recovery

Retry the same normalized slug and verified owner email after a timeout or lost
response. A tenant with the same sole owner returns `created=false`; its name,
language, owner grant and audit event are left unchanged. Concurrent requests are
serialized by the tenant creation transaction lock. A slug with another owner,
no owner or multiple owners returns a conflict and is never repaired implicitly.

The tenant, owner grant and audit event commit together or roll back together.
Readiness is computed after commit: if that read fails, retry the provisioning
command or query readiness. A retry does not create a second owner. Configuration
failures after provisioning belong to the existing owner setup flows; the operator
rechecks readiness once the owner has corrected them.
