# ADR-0007: Optional local Mailpit

Status: accepted, 2026-07-28.

## Context

Together already has a database-backed development e-mail sink, an SMTP
adapter, SES delivery, a transactional outbox, and separate marketing delivery.
The development sink is deterministic and supports the existing smoke and e2e
flows, but it does not exercise a real SMTP connection.

## Decision

The database-backed sink remains the default with `EMAIL_PROVIDER=dev`.
Mailpit is an optional local SMTP target for auth and transactional delivery.
It runs under the opt-in `mailpit` Compose profile, captures messages without
external delivery, exposes SMTP on port `48925`, and provides its inbox and
HTTP API on `http://localhost:48980`. These ports differ from the foundation
repository so both development stacks can run at once.

To exercise the real SMTP path locally:

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM=Together <dev@together.local>
SMTP_HOST=localhost
SMTP_PORT=48925
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
```

Then start the local services and server:

```bash
docker compose -f docker-compose.dev.yml --profile mailpit up -d
pnpm run dev:server
```

Magic links and other platform transactional messages pass through the outbox
and real SMTP adapter before appearing in Mailpit. Open the Mailpit inbox to
follow a captured link. SMTP credentials are optional for the local sink, but
they must be supplied as a complete user/password pair for an authenticated
relay.

Local marketing delivery stays on the database-backed development path even
when Mailpit is selected. Production behavior is unchanged: platform delivery
uses its explicitly selected provider, and tenant marketing continues to use
the tenant transport policy.

## Consequences

Developers can test the real transport without changing the default quickstart,
opening an external account, or delivering real mail. Mailpit is local tooling,
not an application dependency or a production service.
